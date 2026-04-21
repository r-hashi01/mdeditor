import { describe, expect, it } from "vitest";
import { basename } from "./path-utils";

describe("basename", () => {
  it("returns the last segment of a unix path", () => {
    expect(basename("/a/b/c.md")).toBe("c.md");
  });

  it("returns the last segment of a windows-style path", () => {
    expect(basename("C:\\Users\\alice\\Documents\\note.md")).toBe("note.md");
  });

  it("strips trailing separators", () => {
    expect(basename("/a/b/c/")).toBe("c");
    expect(basename("C:\\a\\b\\")).toBe("b");
  });

  it("collapses repeated separators", () => {
    expect(basename("/a//b///c.md")).toBe("c.md");
  });

  it("returns the input for a bare name", () => {
    expect(basename("file.md")).toBe("file.md");
  });

  it("returns the raw path when it is just separators", () => {
    // Cannot produce a non-empty segment — falls back to the original string.
    expect(basename("/")).toBe("/");
    expect(basename("\\\\")).toBe("\\\\");
  });
});
