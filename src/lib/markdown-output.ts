import {
  renderMarkdownTree,
  sourceLines,
  type MarkdownTreeNode,
  type RenderedBlock,
  type SourceLines,
} from "./markdown.js";

/** A top-level block of a text output, with the Markdown lines it was written from. */
export interface TextBlock {
  text: string;
  lines?: SourceLines;
}

export const PLAIN_TEXT_SEPARATOR = "\n\n";
export const HTML_SOURCE_SEPARATOR = "\n";

export function joinTextBlocks(blocks: TextBlock[], separator: string): string {
  return blocks.map((block) => block.text).join(separator);
}

const INLINE_TAGS = new Set([
  "a",
  "abbr",
  "b",
  "br",
  "code",
  "del",
  "em",
  "i",
  "img",
  "input",
  "kbd",
  "mark",
  "s",
  "small",
  "span",
  "strong",
  "sub",
  "sup",
  "u",
]);

const VOID_TAGS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "source",
  "track",
  "wbr",
]);

// Blocks whose text is significant, so their contents are copied through untouched.
const PRESERVED_TAGS = new Set(["pre", "code", "textarea", "script", "style"]);

/**
 * Indents the rendered fragment for reading. Inline elements and preserved blocks keep their
 * original spacing, because breaking them would change what the document says.
 */
export function formatHtmlSource(html: string): string {
  const lines: string[] = [];
  let depth = 0;
  let index = 0;
  let text = "";

  const flushText = (): void => {
    const value = text.trim();
    text = "";
    if (value) lines.push(`${"  ".repeat(depth)}${value}`);
  };

  while (index < html.length) {
    const start = html.indexOf("<", index);
    if (start === -1) {
      text += html.slice(index);
      break;
    }
    const end = html.indexOf(">", start);
    if (end === -1) {
      text += html.slice(index);
      break;
    }
    text += html.slice(index, start);
    const tag = html.slice(start, end + 1);
    const name = tag.match(/^<\/?\s*([a-z\d-]+)/i)?.[1]?.toLowerCase() ?? "";
    const closing = tag.startsWith("</");
    if (INLINE_TAGS.has(name) && !PRESERVED_TAGS.has(name)) {
      text += tag;
      index = end + 1;
      continue;
    }
    if (PRESERVED_TAGS.has(name) && !closing) {
      const closeIndex = html.toLowerCase().indexOf(`</${name}`, end + 1);
      const closeEnd = closeIndex === -1 ? -1 : html.indexOf(">", closeIndex);
      const block = html.slice(start, closeEnd === -1 ? html.length : closeEnd + 1);
      flushText();
      lines.push(`${"  ".repeat(depth)}${block}`);
      index = closeEnd === -1 ? html.length : closeEnd + 1;
      continue;
    }
    flushText();
    if (closing) depth = Math.max(0, depth - 1);
    lines.push(`${"  ".repeat(depth)}${tag}`);
    if (!closing && !VOID_TAGS.has(name) && !tag.endsWith("/>")) depth += 1;
    index = end + 1;
  }
  flushText();
  return lines.join("\n");
}

/** Formats rendered blocks one at a time; joined by `HTML_SOURCE_SEPARATOR` they read as `formatHtmlSource`. */
export function formatHtmlBlocks(blocks: RenderedBlock[]): TextBlock[] {
  return blocks
    .map((block) => ({ text: formatHtmlSource(block.html), lines: block.lines }))
    .filter((block) => block.text);
}

export interface HtmlDocumentOptions {
  title: string;
  body: string;
}

/** Wraps rendered Markdown in a standalone document that reads well on its own. */
export function createHtmlDocument({ title, body }: HtmlDocumentOptions): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <style>
      :root { color-scheme: light dark; }
      body {
        margin: 0 auto;
        max-width: 46rem;
        padding: 3rem 1.5rem 5rem;
        font-family: ui-serif, Georgia, "Times New Roman", serif;
        font-size: 1.05rem;
        line-height: 1.7;
      }
      h1, h2, h3, h4, h5, h6 { line-height: 1.25; margin: 2.2em 0 0.6em; }
      h1 { margin-top: 0; }
      a { color: inherit; }
      code, pre { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.9em; }
      pre { overflow-x: auto; padding: 1rem; border-radius: 8px; background: #282724; color: #f4f2ec; }
      pre code.hljs { display: block; overflow-x: auto; padding: 0; background: transparent; font-size: inherit; }
      pre code .hljs-comment, pre code .hljs-quote, pre code .hljs-doctag { color: #8b949e; font-style: italic; }
      pre code .hljs-keyword, pre code .hljs-selector-tag, pre code .hljs-literal, pre code .hljs-section, pre code .hljs-name { color: #ff7b72; }
      pre code .hljs-string, pre code .hljs-regexp { color: #a5d6ff; }
      pre code .hljs-attribute, pre code .hljs-attr { color: #79c0ff; }
      pre code .hljs-number, pre code .hljs-symbol, pre code .hljs-bullet { color: #79c0ff; }
      pre code .hljs-title, pre code .hljs-title.class_, pre code .hljs-title.function_ { color: #d2a8ff; }
      pre code .hljs-variable, pre code .hljs-template-variable, pre code .hljs-type, pre code .hljs-built_in, pre code .hljs-selector-class, pre code .hljs-selector-id, pre code .hljs-selector-attr, pre code .hljs-selector-pseudo { color: #ffa657; }
      pre code .hljs-meta, pre code .hljs-meta .hljs-string, pre code .hljs-params { color: #d2a8ff; }
      pre code .hljs-tag { color: #7ee787; }
      pre code .hljs-addition { color: #aff5b4; }
      pre code .hljs-deletion { color: #ffa198; }
      pre code .hljs-link { color: #a5d6ff; text-decoration: underline; }
      pre code .hljs-emphasis { font-style: italic; }
      pre code .hljs-strong { font-weight: 700; }
      blockquote { margin: 1.5em 0; padding-left: 1.1em; border-left: 3px solid currentColor; opacity: 0.85; }
      img { max-width: 100%; height: auto; }
      table { width: 100%; border-collapse: collapse; }
      th, td { padding: 0.45em 0.7em; border: 1px solid rgb(128 128 128 / 0.35); }
      hr { border: 0; border-top: 1px solid rgb(128 128 128 / 0.35); }
    </style>
  </head>
  <body>
${body
  .split("\n")
  .map((line) => (line ? `    ${line}` : line))
  .join("\n")}
  </body>
</html>
`;
}

/** Turns a note title into a file name that every platform accepts. */
export function outputFileName(title: string, extension: string): string {
  const stem =
    title
      .normalize("NFKD")
      .replace(/[^\w\s-]+/g, "")
      .trim()
      .replace(/\s+/g, "-")
      .toLowerCase()
      .slice(0, 60) || "note";
  return `${stem}.${extension}`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

const BLOCK_TAGS = new Set([
  "blockquote",
  "dd",
  "details",
  "div",
  "dl",
  "dt",
  "figure",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "hr",
  "li",
  "ol",
  "p",
  "pre",
  "section",
  "summary",
  "table",
  "ul",
]);

/** Reads a note as plain text: the words, list markers, and table cells, without any markup. */
export function markdownToPlainText(source: string): string {
  return joinTextBlocks(plainTextBlocks(source), PLAIN_TEXT_SEPARATOR);
}

export function plainTextBlocks(source: string): TextBlock[] {
  return groupBlocks(renderMarkdownTree(source).children ?? [])
    .map((group) => ({ text: plainGroup(group), lines: groupLines(group) }))
    .filter((block) => block.text);
}

function groupLines(group: MarkdownTreeNode[]): SourceLines | undefined {
  const first = group.map(sourceLines).find(Boolean);
  const last = group.map(sourceLines).findLast(Boolean);
  return first && last ? { start: first.start, end: last.end } : undefined;
}

function isBlock(node: MarkdownTreeNode): boolean {
  return node.type === "element" && BLOCK_TAGS.has(node.tagName ?? "");
}

/** Splits children into block elements and runs of inline content, dropping blank runs. */
function groupBlocks(children: MarkdownTreeNode[]): MarkdownTreeNode[][] {
  const groups: MarkdownTreeNode[][] = [];
  let run: MarkdownTreeNode[] = [];
  const flush = (): void => {
    if (run.some((node) => node.type !== "text" || node.value?.trim())) groups.push(run);
    run = [];
  };
  for (const child of children) {
    if (isBlock(child)) {
      flush();
      groups.push([child]);
    } else {
      run.push(child);
    }
  }
  flush();
  return groups;
}

function plainBlocks(children: MarkdownTreeNode[]): string[] {
  return groupBlocks(children).map(plainGroup).filter(Boolean);
}

function plainGroup(group: MarkdownTreeNode[]): string {
  return group.length === 1 && isBlock(group[0]!)
    ? plainBlock(group[0]!)
    : group.map(plainInline).join("").trim();
}

function plainBlock(node: MarkdownTreeNode): string {
  const children = node.children ?? [];
  switch (node.tagName) {
    case "hr":
      return "* * *";
    case "pre":
      return textContent(node).replace(/\n$/, "");
    case "ul":
    case "ol": {
      const start = Number(node.properties?.start ?? 1);
      return children
        .filter((child) => child.tagName === "li")
        .map((item, index) => {
          const marker = node.tagName === "ol" ? `${start + index}. ` : "- ";
          const body = plainBlocks(item.children ?? []).join("\n");
          if (!body) return marker.trimEnd();
          return indentLines(body, " ".repeat(marker.length)).replace(/^ */, marker);
        })
        .join("\n");
    }
    case "blockquote":
      return plainBlocks(children)
        .join("\n\n")
        .split("\n")
        .map((line) => (line ? `> ${line}` : ">"))
        .join("\n");
    case "table":
      return plainTable(node);
    default:
      return children.some(isBlock)
        ? plainBlocks(children).join("\n\n")
        : children.map(plainInline).join("").trim();
  }
}

function plainInline(node: MarkdownTreeNode): string {
  if (node.type === "text") return node.value ?? "";
  const properties = node.properties ?? {};
  switch (node.tagName) {
    case "br":
      return "\n";
    case "img":
      return typeof properties.alt === "string" ? properties.alt : "";
    case "input":
      return properties.checked ? "[x]" : "[ ]";
    case "a": {
      if (properties.dataFootnoteBackref !== undefined) return "";
      const text = (node.children ?? []).map(plainInline).join("");
      if (properties.dataFootnoteRef !== undefined) return `[${text}]`;
      const href = linkTarget(node);
      return href && href !== text && `mailto:${text}` !== href ? `${text} (${href})` : text;
    }
    default:
      return (node.children ?? []).map(plainInline).join("");
  }
}

function plainTable(table: MarkdownTreeNode): string {
  const rows = tableRows(table).map((row) =>
    row.cells.map((cell) => (cell.children ?? []).map(plainInline).join("").trim()),
  );
  const widths = rows.reduce<number[]>(
    (sizes, row) => row.map((cell, index) => Math.max(sizes[index] ?? 0, cell.length)),
    [],
  );
  const lines = rows.map((row) =>
    row
      .map((cell, index) => cell.padEnd(widths[index] ?? 0))
      .join("  ")
      .trimEnd(),
  );
  if (tableRows(table)[0]?.header) {
    lines.splice(1, 0, widths.map((width) => "-".repeat(width)).join("  "));
  }
  return lines.join("\n");
}

interface TableRow {
  header: boolean;
  cells: MarkdownTreeNode[];
}

function tableRows(table: MarkdownTreeNode): TableRow[] {
  const rows: TableRow[] = [];
  const collect = (node: MarkdownTreeNode): void => {
    for (const child of node.children ?? []) {
      if (child.tagName === "tr") {
        const cells = (child.children ?? []).filter(
          (cell) => cell.tagName === "th" || cell.tagName === "td",
        );
        rows.push({ header: cells.every((cell) => cell.tagName === "th"), cells });
      } else if (child.type === "element") {
        collect(child);
      }
    }
  };
  collect(table);
  return rows;
}

/** The destination of a link that leads outside the note, which is worth spelling out. */
function linkTarget(node: MarkdownTreeNode): string | undefined {
  const href = node.properties?.href;
  return typeof href === "string" && /^(?:https?:|mailto:)/i.test(href) ? href : undefined;
}

function textContent(node: MarkdownTreeNode): string {
  if (node.type === "text") return node.value ?? "";
  return (node.children ?? []).map(textContent).join("");
}

function indentLines(value: string, indent: string): string {
  return value
    .split("\n")
    .map((line) => (line ? `${indent}${line}` : line))
    .join("\n");
}

const RTF_HEADING_SIZES: Record<string, number> = {
  h1: 40,
  h2: 32,
  h3: 28,
  h4: 24,
  h5: 24,
  h6: 24,
};

// Six and a half inches, the text width of a Letter or A4 page with one-inch margins.
const RTF_TABLE_WIDTH = 9360;

interface RtfContext {
  indent: number;
  quote: boolean;
  marker?: { value?: string };
}

/**
 * Writes a note as an RTF document, which word processors open with its headings, emphasis,
 * lists, links, and tables intact.
 */
export function markdownToRtf(source: string): string {
  const body = rtfBlocks(renderMarkdownTree(source).children ?? [], { indent: 0, quote: false });
  return [
    String.raw`{\rtf1\ansi\ansicpg1252\deff0\uc1`,
    String.raw`{\fonttbl{\f0\froman Georgia;}{\f1\fmodern Courier New;}}`,
    String.raw`{\colortbl;\red37\green99\blue235;\red100\green100\blue100;\red255\green240\blue140;}`,
    String.raw`\viewkind4`,
    ...body,
    "}",
    "",
  ].join("\n");
}

function rtfBlocks(children: MarkdownTreeNode[], context: RtfContext): string[] {
  return groupBlocks(children).flatMap((group) =>
    group.length === 1 && isBlock(group[0]!)
      ? rtfBlock(group[0]!, context)
      : [rtfParagraph(context, rtfInlines(group).trim())],
  );
}

function rtfBlock(node: MarkdownTreeNode, context: RtfContext): string[] {
  const children = node.children ?? [];
  const tagName = node.tagName ?? "";
  if (tagName in RTF_HEADING_SIZES) {
    const level = Number(tagName.slice(1)) - 1;
    const format = String.raw`\keepn\sb240\outlinelevel${level}\b\fs${RTF_HEADING_SIZES[tagName]}`;
    return [rtfParagraph(context, rtfInlines(children).trim(), format)];
  }
  switch (tagName) {
    case "hr":
      return [rtfParagraph(context, "", String.raw`\brdrb\brdrs\brdrw10\brsp20`)];
    case "pre": {
      const lines = textContent(node).replace(/\n$/, "").split("\n").map(escapeRtf);
      return [rtfParagraph(context, lines.join(String.raw`\line `), String.raw`\f1\fs20`)];
    }
    case "ul":
    case "ol": {
      const start = Number(node.properties?.start ?? 1);
      return children
        .filter((child) => child.tagName === "li")
        .flatMap((item, index) =>
          rtfListItem(item, tagName === "ol" ? `${start + index}.` : "•", context),
        );
    }
    case "blockquote":
      return rtfBlocks(children, { ...context, indent: context.indent + 480, quote: true });
    case "table":
      return rtfTable(node, context);
    default:
      return children.some(isBlock)
        ? rtfBlocks(children, context)
        : [rtfParagraph(context, rtfInlines(children).trim())];
  }
}

function rtfListItem(item: MarkdownTreeNode, marker: string, context: RtfContext): string[] {
  const children = [...(item.children ?? [])];
  const first = children.findIndex((child) => child.type !== "text" || child.value?.trim());
  if (children[first]?.tagName === "input") {
    marker = children[first]!.properties?.checked ? "☑" : "☐";
    children.splice(first, 1);
  }
  const nested = { indent: context.indent + 360, quote: context.quote, marker: { value: marker } };
  const paragraphs = rtfBlocks(children, nested);
  return paragraphs.length ? paragraphs : [rtfParagraph(nested, "")];
}

function rtfParagraph(context: RtfContext, content: string, format = ""): string {
  const quote = context.quote ? String.raw`\cf2\i` : "";
  let indent = String.raw`\li${context.indent}`;
  let marker = "";
  // Only an item's first paragraph carries its marker, hung into the indent before a tab.
  if (context.marker?.value) {
    indent += String.raw`\fi-360\tx${context.indent}`;
    marker = String.raw`${escapeRtf(context.marker.value)}\tab `;
    context.marker.value = undefined;
  }
  return String.raw`\pard\plain\sa160\sl276\slmult1${indent}\f0\fs24${quote}${format} ${marker}${content}\par`;
}

function rtfTable(table: MarkdownTreeNode, context: RtfContext): string[] {
  const rows = tableRows(table);
  const columns = Math.max(1, ...rows.map((row) => row.cells.length));
  const width = Math.floor((RTF_TABLE_WIDTH - context.indent) / columns);
  const border = String.raw`\clbrdrt\brdrs\brdrw10\clbrdrl\brdrs\brdrw10\clbrdrb\brdrs\brdrw10\clbrdrr\brdrs\brdrw10`;
  return [
    ...rows.map((row) => {
      const edges = row.cells.map(
        (_, index) => `${border}\\cellx${context.indent + width * (index + 1)}`,
      );
      const cells = row.cells.map((cell) => {
        const align =
          cell.properties?.align === "right"
            ? String.raw`\qr`
            : cell.properties?.align === "center"
              ? String.raw`\qc`
              : "";
        const weight = row.header ? String.raw`\b` : "";
        return String.raw`\pard\plain\intbl${align}\f0\fs22${weight} ${rtfInlines(cell.children ?? []).trim()}\cell`;
      });
      return String.raw`\trowd\trgaph108\trleft${context.indent}${row.header ? String.raw`\trhdr` : ""}${edges.join("")} ${cells.join(" ")}\row`;
    }),
    rtfParagraph(context, ""),
  ];
}

function rtfInlines(nodes: MarkdownTreeNode[]): string {
  return nodes.map(rtfInline).join("");
}

function rtfInline(node: MarkdownTreeNode): string {
  // Soft line breaks reflow in rich text, just as they do in HTML.
  if (node.type === "text") return escapeRtf((node.value ?? "").replace(/\s*\n\s*/g, " "));
  const properties = node.properties ?? {};
  const inner = rtfInlines(node.children ?? []);
  switch (node.tagName) {
    case "br":
      return String.raw`\line `;
    case "strong":
    case "b":
      return String.raw`{\b ${inner}}`;
    case "em":
    case "i":
      return String.raw`{\i ${inner}}`;
    case "del":
    case "s":
      return String.raw`{\strike ${inner}}`;
    case "u":
      return String.raw`{\ul ${inner}}`;
    case "sup":
      return String.raw`{\super ${inner}}`;
    case "sub":
      return String.raw`{\sub ${inner}}`;
    case "mark":
      return String.raw`{\highlight3 ${inner}}`;
    case "code":
      return String.raw`{\f1\fs20 ${inner}}`;
    case "img":
      return typeof properties.alt === "string"
        ? String.raw`{\i ${escapeRtf(properties.alt)}}`
        : "";
    case "input":
      return escapeRtf(properties.checked ? "☑" : "☐");
    case "a": {
      if (properties.dataFootnoteBackref !== undefined) return "";
      if (properties.dataFootnoteRef !== undefined) return inner;
      const href = linkTarget(node);
      if (!href) return inner;
      return String.raw`{\field{\*\fldinst{HYPERLINK "${escapeRtf(href.replaceAll('"', "%22"))}"}}{\fldrslt{\ul\cf1 ${inner}}}}`;
    }
    default:
      return inner;
  }
}

/** Escapes RTF control characters and writes everything outside ASCII as Unicode escapes. */
function escapeRtf(value: string): string {
  let escaped = "";
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    const character = value[index]!;
    if (character === "\\" || character === "{" || character === "}") escaped += `\\${character}`;
    else if (character === "\t") escaped += String.raw`\tab `;
    else if (code > 126) escaped += `\\u${code > 32767 ? code - 65536 : code}?`;
    else escaped += character;
  }
  return escaped;
}
