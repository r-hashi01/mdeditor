import { describe, it, expect } from "vitest";
import { parseOutline, buildOutlineTree, findActiveOutlineIndex } from "./outline";

describe("parseOutline", () => {
  it("extracts ATX headings with level + line", () => {
    const md = "# H1\n\nbody\n## H2\n### H3";
    expect(parseOutline(md)).toEqual([
      { line: 1, level: 1, text: "H1" },
      { line: 4, level: 2, text: "H2" },
      { line: 5, level: 3, text: "H3" },
    ]);
  });

  it("trims trailing closing hashes", () => {
    const md = "# Title #\n## Sub ##\n";
    expect(parseOutline(md).map((h) => h.text)).toEqual(["Title", "Sub"]);
  });

  it("ignores headings inside fenced code blocks", () => {
    const md = "# Real\n```\n# fake\n```\n## Real2";
    expect(parseOutline(md)).toEqual([
      { line: 1, level: 1, text: "Real" },
      { line: 5, level: 2, text: "Real2" },
    ]);
  });

  it("handles tilde fences too", () => {
    const md = "~~~\n# fake\n~~~\n# Real";
    expect(parseOutline(md)).toEqual([
      { line: 4, level: 1, text: "Real" },
    ]);
  });

  it("does not match a fence opened with one marker and closed with another", () => {
    const md = "```\n# inside\n~~~\n# still inside\n```\n# Real";
    expect(parseOutline(md).map((h) => h.text)).toEqual(["Real"]);
  });

  it("skips YAML frontmatter at the top", () => {
    const md = "---\ntitle: x\n---\n# Real";
    expect(parseOutline(md)).toEqual([{ line: 4, level: 1, text: "Real" }]);
  });

  it("requires a space after the # markers", () => {
    expect(parseOutline("#Notheading\n# Heading").map((h) => h.text)).toEqual(["Heading"]);
  });

  it("supports up to 6 levels", () => {
    const md = "# 1\n## 2\n### 3\n#### 4\n##### 5\n###### 6\n####### 7";
    const levels = parseOutline(md).map((h) => h.level);
    expect(levels).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("returns an empty list for documents without headings", () => {
    expect(parseOutline("just text\nmore text")).toEqual([]);
  });
});

describe("buildOutlineTree", () => {
  it("nests h2 under h1", () => {
    const tree = buildOutlineTree([
      { line: 1, level: 1, text: "A" },
      { line: 2, level: 2, text: "A.1" },
      { line: 3, level: 2, text: "A.2" },
    ]);
    expect(tree).toHaveLength(1);
    expect(tree[0].text).toBe("A");
    expect(tree[0].children.map((c) => c.text)).toEqual(["A.1", "A.2"]);
  });

  it("creates a new root when level decreases past previous root", () => {
    const tree = buildOutlineTree([
      { line: 1, level: 2, text: "A" },
      { line: 2, level: 1, text: "B" },
    ]);
    expect(tree.map((t) => t.text)).toEqual(["A", "B"]);
  });

  it("nests under the nearest lower-level ancestor when levels are skipped", () => {
    const tree = buildOutlineTree([
      { line: 1, level: 1, text: "A" },
      { line: 2, level: 3, text: "A.1.1" }, // skipped h2
    ]);
    expect(tree[0].children[0].text).toBe("A.1.1");
  });
});

describe("findActiveOutlineIndex", () => {
  const items = [
    { line: 1, level: 1, text: "A" },
    { line: 5, level: 2, text: "A.1" },
    { line: 10, level: 1, text: "B" },
  ];

  it("returns -1 when cursor is above the first heading", () => {
    expect(findActiveOutlineIndex([{ line: 5, level: 1, text: "A" }], 1)).toBe(-1);
  });

  it("returns the closest preceding heading", () => {
    expect(findActiveOutlineIndex(items, 1)).toBe(0);
    expect(findActiveOutlineIndex(items, 4)).toBe(0);
    expect(findActiveOutlineIndex(items, 5)).toBe(1);
    expect(findActiveOutlineIndex(items, 9)).toBe(1);
    expect(findActiveOutlineIndex(items, 10)).toBe(2);
    expect(findActiveOutlineIndex(items, 50)).toBe(2);
  });
});
