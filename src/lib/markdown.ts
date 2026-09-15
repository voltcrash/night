import rehypeKatex from "rehype-katex";
import rehypeHighlight from "rehype-highlight";
import rehypeSanitize, { defaultSchema, type Options } from "rehype-sanitize";
import rehypeSlug from "rehype-slug";
import rehypeStringify from "rehype-stringify";
import remarkFrontmatter from "remark-frontmatter";
import remarkGemoji from "remark-gemoji";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified, type Plugin } from "unified";

import { remarkCallouts, remarkInlineMarks, remarkWikiLinks } from "./markdown-extensions.js";

export interface LocalAttachmentUrl {
  name: string;
  sourcePath?: string;
  url: string;
}

export type MarkdownTreeNode = {
  children?: MarkdownTreeNode[];
  position?: { start: { line: number }; end: { line: number } };
  properties?: Record<string, unknown>;
  tagName?: string;
  type?: string;
  value?: string;
};

type LocalUrlResolver = (destination: string) => string | undefined;

export type RemoteImagePolicy = "block" | "allow";

export interface MarkdownRenderOptions {
  remoteImages?: RemoteImagePolicy;
}

// Sanitizing strips generated ids of their prefix-free form, so anchors are re-pointed after.
const ID_PREFIX = "user-content-";

const markdownSchema: Options = {
  ...defaultSchema,
  tagNames: [...(defaultSchema.tagNames ?? []), "mark"],
  attributes: {
    ...defaultSchema.attributes,
    a: allowClasses("a", [/^wikilink/], "dataWikilink"),
    blockquote: allowClasses("blockquote", [/^callout/]),
    code: allowClasses("code", ["math-inline", "math-display"]),
    div: allowClasses("div", ["math", "math-display"]),
    input: [
      ...(defaultSchema.attributes?.input ?? []),
      ["type", "checkbox"],
      ["checked", true],
      ["disabled", true],
    ],
    li: allowClasses("li", ["task-list-item"]),
    p: allowClasses("p", ["callout-title"]),
    pre: allowClasses("pre", ["math", "math-display"]),
    span: allowClasses("span", ["math", "math-inline"]),
    ul: allowClasses("ul", ["contains-task-list"]),
  },
};

/**
 * Sanitizing honours only the first `className` rule per tag, so added classes have to be
 * folded into the default rule rather than appended beside it.
 */
function allowClasses(
  tagName: string,
  classes: Array<string | RegExp>,
  ...extras: string[]
): Array<string | [string, ...Array<string | RegExp | boolean>]> {
  const defaults = (defaultSchema.attributes?.[tagName] ?? []) as Array<
    string | [string, ...Array<string | RegExp | boolean>]
  >;
  const inherited = defaults.flatMap((entry) =>
    Array.isArray(entry) && entry[0] === "className" ? entry.slice(1) : [],
  );
  return [
    ...defaults.filter((entry) => !(Array.isArray(entry) && entry[0] === "className")),
    ["className", ...inherited, ...classes] as [string, ...Array<string | RegExp | boolean>],
    ...extras,
  ];
}

/** The Markdown lines a block was written on, counted from zero and ending before `end`. */
export interface SourceLines {
  start: number;
  end: number;
}

export interface RenderedBlock {
  html: string;
  /** Whether the node is an element, rather than the whitespace between elements. */
  element: boolean;
  /** Absent for top-level elements that were generated rather than written, such as footnotes. */
  lines?: SourceLines;
}

export function renderMarkdown(
  source: string,
  resolveLocalUrl?: LocalUrlResolver,
  options: MarkdownRenderOptions = {},
): string {
  return renderMarkdownBlocks(source, resolveLocalUrl, options)
    .map((block) => block.html)
    .join("");
}

/** Highlights a fenced block and returns HTML for each code line, preserving token spans across lines. */
export function highlightCodeLines(source: string, language: string): string[] {
  const normalizedLanguage = language.trim().split(/\s+/)[0] ?? "";
  if (!normalizedLanguage) return source.split("\n").map(escapeHtml);

  const marker = "`".repeat(Math.max(3, longestBacktickRun(source) + 1));
  const rendered = renderMarkdown(`${marker}${normalizedLanguage}\n${source}\n${marker}`);
  const inner = rendered.match(/^<pre><code(?:\s[^>]*)?>([\s\S]*)<\/code><\/pre>$/)?.[1];
  if (inner === undefined) return source.split("\n").map(escapeHtml);
  return splitHighlightedLines(inner.endsWith("\n") ? inner.slice(0, -1) : inner);
}

/**
 * Renders a note as its top-level nodes, which join into the HTML of `renderMarkdown`. Elements
 * carry the lines they came from, so views of the note can be lined up with its source.
 */
export function renderMarkdownBlocks(
  source: string,
  resolveLocalUrl?: LocalUrlResolver,
  options: MarkdownRenderOptions = {},
): RenderedBlock[] {
  const remoteImagePolicy = options.remoteImages ?? "block";
  const processor = markdownProcessor()
    // Generated markup runs after sanitizing, so authored HTML stays constrained by the schema.
    .use(rehypeHighlight)
    .use(rehypeKatex, { output: "mathml" })
    .use(prefixInternalLinks);
  if (resolveLocalUrl || remoteImagePolicy === "block") {
    processor.use(resolveMarkdownUrls, resolveLocalUrl, remoteImagePolicy);
  }
  processor.use(rehypeStringify);
  const tree = processor.runSync(processor.parse(source)) as MarkdownTreeNode;
  return (tree.children ?? []).map((node) => ({
    html: String(processor.stringify(node as Parameters<typeof processor.stringify>[0])),
    element: node.type === "element",
    lines: sourceLines(node),
  }));
}

export function sourceLines(node: MarkdownTreeNode): SourceLines | undefined {
  const position = node.position;
  return position ? { start: position.start.line - 1, end: position.end.line } : undefined;
}

/**
 * The sanitized HTML tree of a note, before math is typeset, so math keeps its TeX source. Output
 * formats other than HTML are written from this tree.
 */
export function renderMarkdownTree(source: string): MarkdownTreeNode {
  const processor = markdownProcessor();
  return processor.runSync(processor.parse(source)) as MarkdownTreeNode;
}

export function titleFromMarkdown(value: string, fallback = "Untitled"): string {
  const firstLine =
    stripFrontmatter(value)
      .split("\n")
      .find((line) => line.trim())
      ?.trim() ?? "";
  const title = firstLine
    .replace(/^#{1,6}\s*/, "")
    .replace(/[*_`~[\]]/g, "")
    .trim();
  return title.slice(0, 80) || fallback;
}

function stripFrontmatter(value: string): string {
  const lines = value.split(/\r?\n/);
  let firstContentLine = 0;
  while (firstContentLine < lines.length && !lines[firstContentLine]!.trim()) firstContentLine += 1;
  const opening = lines[firstContentLine]?.trim();
  if (opening !== "---" && opening !== "+++") return value;

  for (let index = firstContentLine + 1; index < lines.length; index += 1) {
    const line = lines[index]!.trim();
    if (line === opening || (opening === "---" && line === "...")) {
      return lines.slice(index + 1).join("\n");
    }
  }
  return value;
}

function markdownProcessor() {
  return (
    unified()
      .use(remarkParse)
      .use(remarkFrontmatter, ["yaml", "toml"])
      .use(remarkGfm, { singleTilde: false })
      .use(remarkMath)
      .use(remarkGemoji)
      .use(remarkCallouts)
      .use(remarkWikiLinks)
      .use(remarkInlineMarks)
      // Front matter is metadata, not prose, so it is dropped rather than printed.
      .use(remarkRehype, { clobberPrefix: "", handlers: { toml: noHandler, yaml: noHandler } })
      .use(rehypeSlug)
      .use(rehypeSanitize, markdownSchema)
  );
}

function noHandler(): undefined {
  return undefined;
}

function longestBacktickRun(value: string): number {
  let longest = 0;
  for (const match of value.matchAll(/`+/g)) longest = Math.max(longest, match[0].length);
  return longest;
}

function splitHighlightedLines(value: string): string[] {
  const lines: string[] = [];
  const openTags: string[] = [];
  const tags = /<\/?span(?:\s[^>]*)?>/gi;
  let line = "";
  let cursor = 0;

  const appendText = (text: string): void => {
    let start = 0;
    let newline = text.indexOf("\n", start);
    while (newline !== -1) {
      line += text.slice(start, newline);
      line += openTags
        .map(() => "</span>")
        .reverse()
        .join("");
      lines.push(line);
      line = openTags.join("");
      start = newline + 1;
      newline = text.indexOf("\n", start);
    }
    line += text.slice(start);
  };

  for (const match of value.matchAll(tags)) {
    const start = match.index ?? 0;
    appendText(value.slice(cursor, start));
    const tag = match[0];
    line += tag;
    if (tag.startsWith("</")) openTags.pop();
    else openTags.push(tag);
    cursor = start + tag.length;
  }
  appendText(value.slice(cursor));
  lines.push(line);
  return lines;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

// Sanitizing rewrites every id to avoid DOM clobbering; hash links have to follow it.
const prefixInternalLinks: Plugin<[]> = () => (tree) => {
  visit(tree as MarkdownTreeNode, (node) => {
    const href = node.tagName === "a" ? node.properties?.href : undefined;
    if (typeof href === "string" && href.startsWith("#") && !href.startsWith(`#${ID_PREFIX}`)) {
      node.properties!.href = `#${ID_PREFIX}${href.slice(1)}`;
    }
  });
};

export function resolveLocalAttachmentUrl(
  destination: string,
  noteSourcePath: string | undefined,
  attachments: LocalAttachmentUrl[],
): string | undefined {
  if (/^(?:[a-z][a-z\d+.-]*:|#|[\\/])/i.test(destination)) return;
  const suffixIndex = destination.search(/[?#]/);
  const path = suffixIndex === -1 ? destination : destination.slice(0, suffixIndex);
  const suffix = suffixIndex === -1 ? "" : destination.slice(suffixIndex);
  let decodedPath: string;
  try {
    decodedPath = decodeURIComponent(path);
  } catch {
    decodedPath = path;
  }
  const resolvedPath = resolveRelativePath(dirname(noteSourcePath ?? ""), decodedPath);
  if (!resolvedPath) return;
  const attachment =
    attachments.find(
      (candidate) =>
        candidate.sourcePath !== undefined && normalizePath(candidate.sourcePath) === resolvedPath,
    ) ??
    attachments.find(
      (candidate) => candidate.sourcePath === undefined && candidate.name === basename(decodedPath),
    );
  return attachment ? `${attachment.url}${suffix}` : undefined;
}

const resolveMarkdownUrls: Plugin<[LocalUrlResolver | undefined, RemoteImagePolicy]> = (
  resolve,
  remoteImagePolicy,
) => {
  return (tree) => {
    const root = tree as MarkdownTreeNode;
    visit(root, (node) => {
      const property = node.tagName === "img" ? "src" : node.tagName === "a" ? "href" : undefined;
      if (!property || typeof node.properties?.[property] !== "string") return;
      const destination = node.properties[property];
      const resolved = resolve?.(destination);
      if (resolved) node.properties[property] = resolved;
      if (
        property === "src" &&
        remoteImagePolicy === "block" &&
        isRemoteImageUrl(destination) &&
        !resolved
      ) {
        node.tagName = "span";
        node.type = "element";
        node.properties = {
          className: ["remote-image-blocked"],
          role: "img",
          "aria-label": "Remote image blocked by privacy settings",
        };
        node.children = [{ type: "text", value: "Remote image blocked" }];
      }
    });
  };
};

function isRemoteImageUrl(destination: string): boolean {
  return /^(?:https?:)?\/\//i.test(destination);
}

function visit(node: MarkdownTreeNode, callback: (node: MarkdownTreeNode) => void): void {
  callback(node);
  for (const child of node.children ?? []) visit(child, callback);
}

function resolveRelativePath(directory: string, destination: string): string | undefined {
  if (!destination || destination.includes("\\")) return;
  const parts: string[] = [];
  for (const part of `${directory}/${destination}`.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (parts.length === 0) return;
      parts.pop();
    } else {
      parts.push(part);
    }
  }
  return parts.join("/") || undefined;
}

function normalizePath(path: string): string | undefined {
  return resolveRelativePath("", path);
}

function dirname(path: string): string {
  return path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
}

function basename(path: string): string {
  return path.slice(Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\")) + 1);
}
