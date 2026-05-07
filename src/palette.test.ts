import { describe, it, expect } from "vitest";
import { fuzzyMatch, highlightIndices, highlightRange, escapeHtml } from "./palette";

describe("fuzzyMatch", () => {
  it("returns null when query chars do not appear in order", () => {
    expect(fuzzyMatch("hello", "lh")).toBeNull();
    expect(fuzzyMatch("abc", "z")).toBeNull();
  });

  it("returns indices for subsequence match", () => {
    const r = fuzzyMatch("hello-world", "hlw")!;
    expect(r).not.toBeNull();
    expect(r.indices).toEqual([0, 2, 6]);
  });

  it("rewards consecutive characters when word-boundary cues are equal", () => {
    // Both candidates start with 'h' (boundary at i=0); after that there are
    // no more boundaries. Tight run should beat scattered run.
    const tight = fuzzyMatch("helxx", "hel")!;
    const loose = fuzzyMatch("hxexl", "hel")!;
    expect(tight.score).toBeGreaterThan(loose.score);
  });

  it("rewards word-boundary matches", () => {
    const boundary = fuzzyMatch("foo-bar", "fb")!;
    const middle = fuzzyMatch("foofbar", "fb")!;
    expect(boundary.score).toBeGreaterThan(middle.score);
  });

  it("is case-insensitive", () => {
    const r = fuzzyMatch("Hello", "hl")!;
    expect(r).not.toBeNull();
    expect(r.indices).toEqual([0, 2]);
  });

  it("treats empty query as zero-score match", () => {
    const r = fuzzyMatch("anything", "")!;
    expect(r).toEqual({ score: 0, indices: [] });
  });
});

describe("highlightIndices", () => {
  it("wraps matched chars in <mark>, escaping the rest", () => {
    expect(highlightIndices("abc", [1])).toBe("a<mark>b</mark>c");
  });

  it("merges adjacent indices into one <mark>", () => {
    expect(highlightIndices("abcd", [1, 2])).toBe("a<mark>bc</mark>d");
  });

  it("escapes HTML special chars", () => {
    expect(highlightIndices("<a>", [0])).toBe("<mark>&lt;</mark>a&gt;");
  });

  it("handles empty index list", () => {
    expect(highlightIndices("a&b", [])).toBe("a&amp;b");
  });
});

describe("highlightRange", () => {
  it("highlights a contiguous range", () => {
    expect(highlightRange("hello world", 6, 11)).toBe("hello <mark>world</mark>");
  });

  it("returns escaped text for invalid range", () => {
    expect(highlightRange("a<b", -1, 1)).toBe("a&lt;b");
  });
});

describe("escapeHtml", () => {
  it("escapes all HTML-significant characters", () => {
    expect(escapeHtml(`<>&"'`)).toBe("&lt;&gt;&amp;&quot;&#39;");
  });
});
