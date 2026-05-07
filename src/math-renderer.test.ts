import { describe, it, expect, beforeEach } from "vitest";
import { Marked } from "marked";
import { mathExtensions, renderMathInDom } from "./math-renderer";

function makeParser(): Marked {
  return new Marked({ extensions: mathExtensions, gfm: true });
}

describe("math tokenizer", () => {
  let m: Marked;
  beforeEach(() => {
    m = makeParser();
  });

  it("emits a block-math placeholder for $$...$$", () => {
    const html = m.parse("$$x^2 + 1$$") as string;
    expect(html).toContain('class="math-block"');
    expect(html).toContain('data-math="x^2 + 1"');
  });

  it("emits an inline-math placeholder for single-$", () => {
    const html = m.parse("see $a+b$ here") as string;
    expect(html).toContain('class="math-inline"');
    expect(html).toContain('data-math="a+b"');
  });

  it("does not treat prices as math", () => {
    const html = m.parse("From $5 to $10 dollars.") as string;
    expect(html).not.toContain("math-inline");
  });

  it("does not match across an unmatched single $", () => {
    const html = m.parse("only one $ sign here") as string;
    expect(html).not.toContain("math-inline");
  });

  it("ignores math inside code spans", () => {
    const html = m.parse("`$x$`") as string;
    expect(html).not.toContain("math-inline");
    expect(html).toContain("<code>");
  });

  it("ignores math inside fenced code blocks", () => {
    const md = "```\n$x^2$\n```";
    const html = m.parse(md) as string;
    expect(html).not.toContain("math-inline");
  });

  it("escapes HTML special chars in attribute", () => {
    const html = m.parse("$a < b$") as string;
    expect(html).toContain('data-math="a &lt; b"');
  });

  it("rejects $ ... $ with leading/trailing whitespace", () => {
    const html = m.parse("$ x $") as string;
    expect(html).not.toContain("math-inline");
  });

  it("supports multi-line block math", () => {
    const md = "$$\n\\sum_{i=1}^n i\n$$";
    const html = m.parse(md) as string;
    expect(html).toContain('class="math-block"');
    expect(html).toContain("\\sum");
  });

  it("rejects empty $$ $$", () => {
    const html = m.parse("$$$$") as string;
    expect(html).not.toContain("math-block");
  });
});

describe("renderMathInDom", () => {
  // KaTeX refuses to render HTML in quirks mode, which is what happy-dom
  // gives us by default. We only smoke-test the bookkeeping (idempotency
  // and graceful failure) here; visual rendering is verified manually.

  it("does not throw on missing data-math", () => {
    const div = document.createElement("div");
    div.innerHTML = '<span class="math-inline"></span>';
    expect(() => renderMathInDom(div)).not.toThrow();
  });

  it("does not throw on invalid TeX", () => {
    const div = document.createElement("div");
    div.innerHTML = '<span class="math-inline" data-math="\\invalidcmd{x}"></span>';
    expect(() => renderMathInDom(div)).not.toThrow();
  });

  it("is idempotent across repeated calls", () => {
    const div = document.createElement("div");
    div.innerHTML = '<span class="math-inline" data-math="a"></span>';
    renderMathInDom(div);
    const after1 = div.innerHTML;
    renderMathInDom(div);
    expect(div.innerHTML).toBe(after1);
  });
});
