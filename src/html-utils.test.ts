import { describe, expect, it } from "vitest";
import { escapeHtml } from "./html-utils";

describe("escapeHtml", () => {
  it("escapes the five HTML-sensitive characters", () => {
    expect(escapeHtml(`<a href="x">&'y'</a>`)).toBe(
      "&lt;a href=&quot;x&quot;&gt;&amp;&#39;y&#39;&lt;/a&gt;",
    );
  });

  it("returns an empty string unchanged", () => {
    expect(escapeHtml("")).toBe("");
  });

  it("is idempotent on already-escaped output only up to the & rule", () => {
    // & is always re-escaped; callers must never pass pre-escaped text
    expect(escapeHtml("&amp;")).toBe("&amp;amp;");
  });

  it("leaves safe characters untouched", () => {
    expect(escapeHtml("hello world 123 あいう")).toBe("hello world 123 あいう");
  });
});
