import { describe, expect, it } from "vite-plus/test";

import { renderMarkdown, renderMarkdownBlocks } from "./markdown.js";
import {
  createHtmlDocument,
  formatHtmlBlocks,
  formatHtmlSource,
  HTML_SOURCE_SEPARATOR,
  joinTextBlocks,
  markdownToPlainText,
  plainTextBlocks,
  markdownToRtf,
  outputFileName,
} from "./markdown-output.js";

describe("formatHtmlSource", () => {
  it("indents block elements and keeps inline markup on one line", () => {
    const formatted = formatHtmlSource(
      "<h1>Title</h1><ul><li>One <strong>bold</strong> word</li><li>Two</li></ul>",
    );

    expect(formatted).toBe(
      [
        "<h1>",
        "  Title",
        "</h1>",
        "<ul>",
        "  <li>",
        "    One <strong>bold</strong> word",
        "  </li>",
        "  <li>",
        "    Two",
        "  </li>",
        "</ul>",
      ].join("\n"),
    );
  });

  it("copies preserved blocks and void elements through untouched", () => {
    const formatted = formatHtmlSource(
      '<pre><code>const a = 1;\n  const b = 2;</code></pre><hr><p><img src="a.png" alt="a"></p>',
    );

    expect(formatted).toBe(
      [
        "<pre><code>const a = 1;",
        "  const b = 2;</code></pre>",
        "<hr>",
        "<p>",
        '  <img src="a.png" alt="a">',
        "</p>",
      ].join("\n"),
    );
  });
});

describe("formatHtmlBlocks", () => {
  it("reads the same as formatting the whole note, block by block", () => {
    const source = `# Title

- One
- **Two**

$$
x^2
$$

| A | B |
| - | - |
| 1 | 2 |

Text[^1].

[^1]: Note.`;
    const blocks = formatHtmlBlocks(renderMarkdownBlocks(source));

    expect(joinTextBlocks(blocks, HTML_SOURCE_SEPARATOR)).toBe(
      formatHtmlSource(renderMarkdown(source)),
    );
    expect(blocks[0]).toEqual({
      text: '<h1 id="user-content-title">\n  Title\n</h1>',
      lines: { start: 0, end: 1 },
    });
    expect(blocks[1]?.lines).toEqual({ start: 2, end: 4 });
  });
});

describe("createHtmlDocument", () => {
  it("produces a standalone document with an escaped title", () => {
    const document = createHtmlDocument({ title: 'Notes & "plans"', body: "<p>Hello</p>" });

    expect(document.startsWith("<!doctype html>")).toBe(true);
    expect(document).toContain("<title>Notes &amp; &quot;plans&quot;</title>");
    expect(document).toContain("<p>Hello</p>");
    expect(document).toContain("<style>");
  });
});

describe("markdownToPlainText", () => {
  it("keeps the words and structure of a note without its markup", () => {
    const text = markdownToPlainText(`---
title: Hidden
---

# Plan **ahead**

Read the [guide](https://example.com/guide) and <https://example.com>.
Soft wrapped line.

1. First
   - Nested _item_
2. Second

- [x] Done
- [ ] Pending

> Quoted \`code\`

\`\`\`ts
const a = 1;
  const b = 2;
\`\`\`

---

| Name | State |
| --- | --- |
| Onyx | Ready |

![Diagram](diagram.png) and $x^2$.`);

    expect(text).toBe(
      [
        "Plan ahead",
        "",
        "Read the guide (https://example.com/guide) and https://example.com.\nSoft wrapped line.",
        "",
        "1. First\n   - Nested item\n2. Second",
        "",
        "- [x] Done\n- [ ] Pending",
        "",
        "> Quoted code",
        "",
        "const a = 1;\n  const b = 2;",
        "",
        "* * *",
        "",
        "Name  State\n----  -----\nOnyx  Ready",
        "",
        "Diagram and x^2.",
      ].join("\n"),
    );
  });

  it("marks each block with the lines it was written on", () => {
    expect(plainTextBlocks("# Title\n\nFirst line\nsecond line\n\n\n- item")).toEqual([
      { text: "Title", lines: { start: 0, end: 1 } },
      { text: "First line\nsecond line", lines: { start: 2, end: 4 } },
      { text: "- item", lines: { start: 6, end: 7 } },
    ]);
  });

  it("marks footnote references and drops their back links", () => {
    expect(markdownToPlainText("Claim[^1].\n\n[^1]: Source.")).toBe(
      "Claim[1].\n\nFootnotes\n\n1. Source.",
    );
  });
});

describe("markdownToRtf", () => {
  it("writes formatting, lists, links, and tables as RTF", () => {
    const rtf = markdownToRtf(`# Plan

**Bold**, _italic_, ~~gone~~, \`code\`, and [a link](https://example.com/?q="x").

- One
- [x] Done

1. First

> Quoted

| Name | State |
| --- | ---: |
| Onyx | Ready |`);

    expect(rtf.startsWith("{\\rtf1\\ansi")).toBe(true);
    expect(rtf.trimEnd().endsWith("}")).toBe(true);
    expect(rtf).toContain("\\outlinelevel0\\b\\fs40 Plan\\par");
    expect(rtf).toContain("{\\b Bold}, {\\i italic}, {\\strike gone}, {\\f1\\fs20 code}");
    expect(rtf).toContain(
      '{\\field{\\*\\fldinst{HYPERLINK "https://example.com/?q=%22x%22"}}{\\fldrslt{\\ul\\cf1 a link}}}',
    );
    expect(rtf).toContain("\\li360\\fi-360\\tx360\\f0\\fs24 \\u8226?\\tab One\\par");
    expect(rtf).toContain("\\u9745?\\tab Done\\par");
    expect(rtf).toContain("\\fs24 1.\\tab First\\par");
    expect(rtf).toContain("\\li480\\f0\\fs24\\cf2\\i Quoted\\par");
    expect(rtf).toContain("\\trhdr");
    expect(rtf).toContain("\\qr\\f0\\fs22 Ready\\cell");
  });

  it("escapes control characters and writes Unicode as escapes", () => {
    const rtf = markdownToRtf("Braces {} and \\\\ café 😀");

    expect(rtf).toContain("Braces \\{\\} and \\\\ caf\\u233? \\u-10179?\\u-8704?\\par");
  });
});

describe("outputFileName", () => {
  it("builds a safe file name from a note title", () => {
    expect(outputFileName("Project Aurora: résumé", "html")).toBe("project-aurora-resume.html");
    expect(outputFileName("   ", "pdf")).toBe("note.pdf");
  });
});
