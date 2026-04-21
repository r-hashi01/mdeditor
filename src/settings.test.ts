import { describe, expect, it, vi } from "vitest";

// @tauri-apps/api/core is imported at the top of settings.ts but we only
// exercise the pure sanitizer here — stub it so the module loads in Node.
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

import { DEFAULT_SETTINGS, sanitizeSettings } from "./settings";

describe("sanitizeSettings", () => {
  it("passes through well-typed values", () => {
    const result = sanitizeSettings({
      theme: "dracula",
      editorFontFamily: "Menlo",
      editorFontSize: 16,
      previewFontFamily: "serif",
      previewFontSize: 18,
      previewLineHeight: 1.5,
      showLineNumbers: false,
      showToc: false,
      lastOpenedFolder: "/Users/me/notes",
      recentFolders: ["/a", "/b"],
    });

    expect(result.theme).toBe("dracula");
    expect(result.editorFontSize).toBe(16);
    expect(result.showLineNumbers).toBe(false);
    expect(result.recentFolders).toEqual(["/a", "/b"]);
  });

  it("rejects wrong types silently (field left undefined, defaults applied)", () => {
    const result = sanitizeSettings({
      theme: 123,
      editorFontSize: "huge",
      showLineNumbers: "yes",
      recentFolders: "not-an-array",
    } as Record<string, unknown>);

    expect(result.theme).toBeUndefined();
    expect(result.editorFontSize).toBeUndefined();
    expect(result.showLineNumbers).toBeUndefined();
    expect(result.recentFolders).toBeUndefined();
  });

  it("rejects negative / zero font sizes", () => {
    expect(sanitizeSettings({ editorFontSize: 0 }).editorFontSize).toBeUndefined();
    expect(sanitizeSettings({ editorFontSize: -5 }).editorFontSize).toBeUndefined();
    expect(sanitizeSettings({ previewFontSize: 0 }).previewFontSize).toBeUndefined();
    expect(sanitizeSettings({ previewLineHeight: 0 }).previewLineHeight).toBeUndefined();
  });

  it("accepts lastOpenedFolder = null explicitly", () => {
    const result = sanitizeSettings({ lastOpenedFolder: null });
    expect(result.lastOpenedFolder).toBeNull();
  });

  it("rejects recentFolders when any element is not a string", () => {
    const result = sanitizeSettings({ recentFolders: ["/a", 42, "/b"] });
    expect(result.recentFolders).toBeUndefined();
  });

  it("ignores unknown keys (no prototype pollution risk)", () => {
    const result = sanitizeSettings({
      __proto__: { polluted: true },
      constructor: "evil",
      arbitrary: "ignored",
    } as Record<string, unknown>);

    expect(result).not.toHaveProperty("arbitrary");
    expect(result).not.toHaveProperty("polluted");
  });

  it("DEFAULT_SETTINGS satisfies its own sanitizer round-trip", () => {
    // Every default value must survive sanitizeSettings unchanged,
    // otherwise loadSettings would silently replace a default with another default.
    const sanitized = sanitizeSettings(
      DEFAULT_SETTINGS as unknown as Record<string, unknown>,
    );
    expect(sanitized).toEqual(DEFAULT_SETTINGS);
  });
});
