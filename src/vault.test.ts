import { describe, it, expect } from "vitest";
import { stripExt, newNotePathForTarget } from "./vault";

describe("stripExt", () => {
  it("removes the last extension", () => {
    expect(stripExt("notes.md")).toBe("notes");
    expect(stripExt("foo.bar.md")).toBe("foo.bar");
  });

  it("returns name unchanged when no extension", () => {
    expect(stripExt("notes")).toBe("notes");
  });

  it("does not strip leading dot files", () => {
    expect(stripExt(".gitignore")).toBe(".gitignore");
  });
});

describe("newNotePathForTarget", () => {
  it("creates beside current file when target is a bare name", () => {
    expect(newNotePathForTarget("notes", "/vault/sub/cur.md", "/vault")).toBe(
      "/vault/sub/notes.md",
    );
  });

  it("creates at vault root when no current file", () => {
    expect(newNotePathForTarget("notes", null, "/vault")).toBe("/vault/notes.md");
  });

  it("preserves explicit .md extension", () => {
    expect(newNotePathForTarget("notes.md", null, "/vault")).toBe("/vault/notes.md");
  });

  it("treats path-like targets as relative to vault root", () => {
    expect(newNotePathForTarget("sub/notes", "/vault/cur.md", "/vault")).toBe(
      "/vault/sub/notes.md",
    );
  });

  it("strips trailing path separators", () => {
    expect(newNotePathForTarget("notes/", null, "/vault")).toBe("/vault/notes.md");
  });
});
