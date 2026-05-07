import { describe, it, expect } from "vitest";
import { buildStandaloneHtml } from "./export";

describe("buildStandaloneHtml", () => {
  it("wraps the preview HTML in a full document with a title", () => {
    const out = buildStandaloneHtml("<h1>Hi</h1>", "My Doc");
    expect(out).toContain("<!DOCTYPE html>");
    expect(out).toContain("<title>My Doc</title>");
    expect(out).toContain("<h1>Hi</h1>");
  });

  it("escapes HTML in the title", () => {
    const out = buildStandaloneHtml("", "<x>");
    expect(out).toContain("<title>&lt;x&gt;</title>");
    expect(out).not.toContain("<title><x></title>");
  });

  it("emits a preview-pane wrapper with the inlined preview body", () => {
    const out = buildStandaloneHtml("<p>body</p>", "Doc");
    expect(out).toMatch(/<div class="export-wrap" id="preview-pane">\s*<p>body<\/p>/);
  });
});
