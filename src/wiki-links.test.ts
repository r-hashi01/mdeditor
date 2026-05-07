import { describe, it, expect, beforeEach, vi } from "vitest";
import { Marked } from "marked";
import { wikiLinkExtensions, resolveWikiLinksInDom } from "./wiki-links";
import * as vault from "./vault";

function makeParser(): Marked {
  return new Marked({ extensions: wikiLinkExtensions, gfm: true });
}

describe("wiki link tokenizer", () => {
  let m: Marked;
  beforeEach(() => {
    m = makeParser();
  });

  it("emits an anchor with the target", () => {
    const html = m.parse("see [[notes]] here") as string;
    expect(html).toContain('class="wikilink"');
    expect(html).toContain('data-wiki-target="notes"');
    expect(html).toContain(">notes</a>");
  });

  it("uses alias text when [[target|alias]] is present", () => {
    const html = m.parse("[[notes|My notes]]") as string;
    expect(html).toContain('data-wiki-target="notes"');
    expect(html).toContain(">My notes</a>");
  });

  it("does not match across newlines", () => {
    const html = m.parse("[[\nnotes]]") as string;
    expect(html).not.toContain("wikilink");
  });

  it("does not match empty brackets", () => {
    const html = m.parse("[[]]") as string;
    expect(html).not.toContain("wikilink");
  });

  it("escapes HTML in target", () => {
    const html = m.parse("[[a<b>c]]") as string;
    expect(html).not.toContain("<b>");
    expect(html).toContain("&lt;b&gt;");
  });
});

describe("resolveWikiLinksInDom", () => {
  it("marks resolved links with data-wiki-resolved", () => {
    const spy = vi.spyOn(vault, "resolveLink").mockReturnValue({
      name: "notes.md",
      path: "/vault/notes.md",
      rel: "notes.md",
    });
    const div = document.createElement("div");
    div.innerHTML = '<a class="wikilink" data-wiki-target="notes">notes</a>';
    resolveWikiLinksInDom(div);
    const a = div.querySelector("a")!;
    expect(a.getAttribute("data-wiki-resolved")).toBe("/vault/notes.md");
    expect(a.classList.contains("wikilink-unresolved")).toBe(false);
    spy.mockRestore();
  });

  it("marks unresolved links with .wikilink-unresolved", () => {
    const spy = vi.spyOn(vault, "resolveLink").mockReturnValue(null);
    const div = document.createElement("div");
    div.innerHTML = '<a class="wikilink" data-wiki-target="missing">missing</a>';
    resolveWikiLinksInDom(div);
    const a = div.querySelector("a")!;
    expect(a.classList.contains("wikilink-unresolved")).toBe(true);
    expect(a.getAttribute("data-wiki-resolved")).toBeNull();
    spy.mockRestore();
  });
});
