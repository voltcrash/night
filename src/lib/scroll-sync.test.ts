import { describe, expect, it } from "vite-plus/test";

import { interpolateAnchor, scrollAnchors, syncedScrollTop } from "./scroll-sync.js";

describe("scrollAnchors", () => {
  it("brackets the anchors with the content bounds and drops ones that run backwards", () => {
    const anchors = scrollAnchors(
      [
        { line: 4, top: 300 },
        { line: 2, top: 100 },
        { line: 3, top: 50 },
      ],
      10,
      1000,
    );

    expect(anchors).toEqual([
      { line: 0, top: 0 },
      { line: 2, top: 100 },
      { line: 4, top: 300 },
      { line: 10, top: 1000 },
    ]);
  });
});

describe("interpolateAnchor", () => {
  const anchors = [
    { line: 0, top: 0 },
    { line: 0, top: 50 },
    { line: 10, top: 250 },
    { line: 20, top: 1250 },
  ];

  it("interpolates between neighbouring anchors in either direction", () => {
    expect(interpolateAnchor(anchors, "line", 5)).toBe(150);
    expect(interpolateAnchor(anchors, "line", 15)).toBe(750);
    expect(interpolateAnchor(anchors, "top", 750)).toBe(15);
  });

  it("reads the first of anchors that share a value and clamps past the end", () => {
    expect(interpolateAnchor(anchors, "line", 0)).toBe(0);
    expect(interpolateAnchor(anchors, "line", 40)).toBe(1250);
  });
});

describe("syncedScrollTop", () => {
  // The source lays each of its 100 lines out 20px tall, the target spends 900px on line 10 alone.
  const source = {
    anchors: scrollAnchors([], 100, 2000),
    scrollHeight: 2000,
    clientHeight: 500,
  };
  const target = {
    anchors: scrollAnchors(
      [
        { line: 10, top: 100 },
        { line: 11, top: 1000 },
      ],
      100,
      2000,
    ),
    scrollHeight: 2000,
    clientHeight: 400,
  };

  it("starts and ends both panes together", () => {
    expect(syncedScrollTop({ ...source, scrollTop: 0 }, target)).toBe(0);
    expect(syncedScrollTop({ ...source, scrollTop: 1500 }, target)).toBe(1600);
  });

  it("follows the content rather than the scroll proportion", () => {
    // Line 10.5 sits at the reference point of the source, and halfway through the tall block.
    const scrollTop = (210 * 1500) / 2000;
    expect(syncedScrollTop({ ...source, scrollTop }, target)).toBeCloseTo((550 * 1600) / 2000);
  });

  it("leaves a pane without room to scroll at the top", () => {
    expect(syncedScrollTop({ ...source, scrollTop: 800 }, { ...target, scrollHeight: 400 })).toBe(
      0,
    );
  });
});
