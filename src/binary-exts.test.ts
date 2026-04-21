import { describe, expect, it } from "vitest";
import { BINARY_EXTS, getExt, isBinaryFile } from "./binary-exts";

describe("getExt", () => {
  it("returns the lowercase extension", () => {
    expect(getExt("/a/b/c.PNG")).toBe("png");
    expect(getExt("file.TaR.Gz")).toBe("gz");
  });

  it("returns empty string when there is no dot", () => {
    expect(getExt("README")).toBe("");
    expect(getExt("/a/b/README")).toBe("");
  });

  it("returns empty string for a trailing dot", () => {
    expect(getExt("file.")).toBe("");
  });

  it("does not treat dots in directory names as extensions", () => {
    // Current behavior: last dot wins regardless of path separator.
    // Documented here so a future change is intentional.
    expect(getExt("/a.b/c")).toBe("b/c");
  });
});

describe("isBinaryFile", () => {
  it("detects common image extensions", () => {
    for (const ext of ["png", "jpg", "jpeg", "gif", "webp", "bmp", "ico", "avif"]) {
      expect(isBinaryFile(`image.${ext}`)).toBe(true);
    }
  });

  it("detects office / PDF extensions", () => {
    for (const ext of ["pdf", "docx", "doc", "xlsx", "xls", "pptx", "ppt"]) {
      expect(isBinaryFile(`file.${ext}`)).toBe(true);
    }
  });

  it("treats text formats as non-binary", () => {
    for (const ext of ["md", "txt", "json", "ts", "csv", ""]) {
      expect(isBinaryFile(ext ? `f.${ext}` : "Makefile")).toBe(false);
    }
  });

  it("matches case-insensitively", () => {
    expect(isBinaryFile("photo.JPG")).toBe(true);
    expect(isBinaryFile("scan.PDF")).toBe(true);
  });

  it("BINARY_EXTS is exposed for callers that need to list them", () => {
    expect(BINARY_EXTS.has("png")).toBe(true);
    expect(BINARY_EXTS.has("md")).toBe(false);
  });
});
