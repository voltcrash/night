import { describe, expect, it } from "vite-plus/test";

import {
  codeLanguageLabel,
  highlightCodeLines,
  renderMarkdown,
  renderMarkdownBlocks,
  resolveLocalAttachmentUrl,
  titleFromMarkdown,
} from "./markdown.js";

describe("titleFromMarkdown", () => {
  it("ignores YAML and TOML front matter", () => {
    expect(titleFromMarkdown("---\ntitle: Hidden\n---\n\n# Heading")).toBe("Heading");
    expect(titleFromMarkdown("+++\ntitle = 'Hidden'\n+++\n\nBody")).toBe("Body");
  });

  it("supports YAML's alternate closing marker", () => {
    expect(titleFromMarkdown("---\ntitle: Hidden\n...\n\n# Heading")).toBe("Heading");
  });
});

describe("renderMarkdown", () => {
  it("renders CommonMark structure and GFM extensions", () => {
    const html = renderMarkdown(`# Heading

1. First
   1. Nested
2. Second

- [x] Finished
- [ ] Pending

> Quoted **text**

\`\`\`ts
const answer = 42;
\`\`\`

| Name | State |
| --- | ---: |
| Onyx | Ready |

[Website](https://example.com) and ![Diagram](attachments/diagram.png)`);

    expect(html).toContain('<h1 id="user-content-heading">Heading</h1>');
    expect(html).toContain("<ol>");
    expect(html.match(/<ol>/g)).toHaveLength(2);
    expect(html).toContain('<ul class="contains-task-list">');
    expect(html).toContain(
      '<li class="task-list-item"><input type="checkbox" checked disabled> Finished</li>',
    );
    expect(html).toContain("<blockquote>");
    expect(html).toContain('<code class="hljs language-ts">');
    expect(html).toContain(
      '<span class="hljs-keyword">const</span> answer = <span class="hljs-number">42</span>;',
    );
    expect(html).toContain("<table>");
    expect(html).toContain('<th align="right">State</th>');
    expect(html).toContain('<a href="https://example.com">Website</a>');
    expect(html).toContain('<img src="attachments/diagram.png" alt="Diagram">');
  });

  it("removes unsafe HTML and URL protocols", () => {
    const html = renderMarkdown(`<script>alert('xss')</script>

<img src=x onerror="alert('xss')">

[unsafe](javascript:alert('xss'))

![unsafe](javascript:alert('xss'))`);

    expect(html).not.toContain("<script");
    expect(html).not.toContain("onerror");
    expect(html).not.toContain("javascript:");
  });

  it("replaces local image and file destinations with resolved attachment URLs", () => {
    const resolve = (destination: string) =>
      resolveLocalAttachmentUrl(destination, "notes/trips/day-one.md", [
        {
          name: "lake view.png",
          sourcePath: "notes/trips/media/lake view.png",
          url: "blob:image-url",
        },
        {
          name: "guide.pdf",
          sourcePath: "notes/files/guide.pdf",
          url: "blob:file-url",
        },
      ]);

    const html = renderMarkdown(
      "![Lake](media/lake%20view.png) [Guide](../files/guide.pdf#page=2)",
      resolve,
    );

    expect(html).toContain('<img src="blob:image-url" alt="Lake">');
    expect(html).toContain('<a href="blob:file-url#page=2">Guide</a>');
  });

  it("blocks remote images while preserving local and unmatched destinations", () => {
    const attachments = [{ name: "photo.png", url: "blob:photo-url" }];
    const resolve = (destination: string) =>
      resolveLocalAttachmentUrl(destination, undefined, attachments);

    const html = renderMarkdown(
      "![Local](photo.png) ![Remote](https://example.com/photo.png) [Root](/photo.png) [Missing](missing.pdf)",
      resolve,
    );

    expect(html).toContain('<img src="blob:photo-url" alt="Local">');
    expect(html).toContain(
      '<span class="remote-image-blocked" role="img" aria-label="Remote image blocked by privacy settings">Remote image blocked</span>',
    );
    expect(html).toContain('<a href="/photo.png">Root</a>');
    expect(html).toContain('<a href="missing.pdf">Missing</a>');
  });

  it("does not resolve attachment paths that escape the note directory", () => {
    const resolve = (destination: string) =>
      resolveLocalAttachmentUrl(destination, "notes/day-one.md", [
        {
          name: "photo.png",
          sourcePath: "photo.png",
          url: "blob:photo-url",
        },
      ]);

    expect(resolve("../../photo.png")).toBeUndefined();
    expect(resolve("\\photo.png")).toBeUndefined();
    expect(resolve("photo.png")).toBeUndefined();
  });

  it("allows remote images only when explicitly requested", () => {
    const html = renderMarkdown("![Remote](https://example.com/photo.png)", undefined, {
      remoteImages: "allow",
    });

    expect(html).toContain('<img src="https://example.com/photo.png" alt="Remote">');
  });

  it("renders the extensions other Markdown platforms expect", () => {
    const html = renderMarkdown(`---
title: Hidden
---

Text with ==**a mark**==, H~2~O, x^2^, :tada:, and a [[Other Note|wiki link]].

> [!WARNING] Careful
> Mind the gap.

A footnote[^1] and math $a^2$.

[^1]: Footnote body.`);

    expect(html).not.toContain("title: Hidden");
    expect(html).toContain("<mark><strong>a mark</strong></mark>");
    expect(html).toContain("H<sub>2</sub>O");
    expect(html).toContain("x<sup>2</sup>");
    expect(html).toContain("\u{1F389}");
    expect(html).toContain('<a class="wikilink" data-wikilink="Other Note">wiki link</a>');
    expect(html).toContain('<blockquote class="callout callout-warning">');
    expect(html).toContain('<p class="callout-title">Careful</p>');
    expect(html).toContain('href="#user-content-fn-1"');
    expect(html).toContain("<math");
  });

  it("leaves spaced delimiters as plain text", () => {
    const html = renderMarkdown("a ~ b ~ c and 2 ^ 3 ^ 4");

    expect(html).toBe("<p>a ~ b ~ c and 2 ^ 3 ^ 4</p>");
  });

  it("highlights labeled code blocks without guessing unlabeled code", () => {
    const highlighted = renderMarkdown("```js\nconst answer = 42;\n```");
    const plain = renderMarkdown("```\nconst answer = 42;\n```");

    expect(highlighted).toContain('<pre data-code-language="JavaScript">');
    expect(highlighted).toContain('<code class="hljs language-js">');
    expect(highlighted).toContain('<span class="hljs-keyword">const</span>');
    expect(highlighted).toContain('<span class="hljs-number">42</span>');
    expect(plain).toBe("<pre><code>const answer = 42;\n</code></pre>");
  });

  it("uses friendly names for code language labels", () => {
    expect(codeLanguageLabel("ts")).toBe("TypeScript");
    expect(codeLanguageLabel("javascript")).toBe("JavaScript");
    expect(codeLanguageLabel("custom-lang")).toBe("Custom Lang");
  });

  it("keeps highlighted tokens available one line at a time for live preview", () => {
    const lines = highlightCodeLines("/* first line\nsecond line */", "js");

    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain('<span class="hljs-comment">/* first line</span>');
    expect(lines[1]).toContain('<span class="hljs-comment">second line */</span>');
  });
});

describe("renderMarkdownBlocks", () => {
  it("marks each top-level element with the lines it was written on", () => {
    const source = `---
title: Hidden
---

# Title

\`\`\`ts
const a = 1;
\`\`\`

A note[^1].

[^1]: Source.`;
    const blocks = renderMarkdownBlocks(source);

    expect(blocks.map((block) => block.html).join("")).toBe(renderMarkdown(source));
    const elements = blocks.filter((block) => block.element);
    expect(elements.map((block) => block.html.match(/^<([a-z\d]+)/)?.[1])).toEqual([
      "h1",
      "pre",
      "p",
      "section",
    ]);
    expect(elements.map((block) => block.lines)).toEqual([
      { start: 4, end: 5 },
      { start: 6, end: 9 },
      { start: 10, end: 11 },
      undefined,
    ]);
  });
});
