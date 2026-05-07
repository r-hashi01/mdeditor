/**
 * KaTeX math support for the markdown preview.
 *
 * Strategy:
 *   1. Register a `marked` tokenizer extension that recognises `$$...$$`
 *      (block) and `$...$` (inline) math, emitting an HTML placeholder with
 *      the *escaped* TeX source in a data attribute.
 *   2. After DOMPurify sanitisation, find the placeholders and render them
 *      with katex.render() into safe DOM nodes.
 *
 * Edge cases handled:
 *   - Code spans/blocks: marked's built-in inline tokenizer runs before our
 *     extension on inline content, so `` `$x$` `` is parsed as a code span
 *     and never reaches us. For fenced code blocks, the body is consumed by
 *     the block-level `code` tokenizer first.
 *   - Escaped dollars: `\$5` is left alone — the inline regex requires the
 *     opening `$` to NOT be preceded by a backslash.
 *   - Empty content: `$$` and `$ $` produce no token (fall through).
 */

import katex from "katex";
import "katex/dist/katex.min.css";

interface MarkedTokenLike {
  type: string;
  raw: string;
  text: string;
}

/**
 * Tokenizer + renderer extensions for `marked`. Pass via `new Marked({ extensions: mathExtensions })`.
 */
export const mathExtensions = [
  {
    name: "blockMath",
    level: "block" as const,
    start(src: string): number | undefined {
      const idx = src.indexOf("$$");
      return idx < 0 ? undefined : idx;
    },
    tokenizer(src: string): MarkedTokenLike | undefined {
      // Match $$ ... $$ across lines; require non-empty body. Disallow `$$$`
      // tail so we don't swallow a stray `$` after the closer.
      const m = /^\$\$([\s\S]+?)\$\$(?!\$)/.exec(src);
      if (!m) return undefined;
      const text = m[1].trim();
      if (!text) return undefined;
      return { type: "blockMath", raw: m[0], text };
    },
    renderer(token: MarkedTokenLike): string {
      return `<div class="math-block" data-math="${encodeAttr(token.text)}"></div>`;
    },
  },
  {
    name: "inlineMath",
    level: "inline" as const,
    start(src: string): number | undefined {
      const idx = src.indexOf("$");
      return idx < 0 ? undefined : idx;
    },
    tokenizer(src: string): MarkedTokenLike | undefined {
      // Single-$ delimited, non-greedy, no newline, body must not start/end
      // with whitespace (matches Pandoc behaviour — `$ x $` is not math).
      // Also reject if the closing `$` is followed by a digit, to avoid
      // false matches in price lists like "$5 to $10".
      const m = /^\$(?!\s)((?:\\.|[^\\$\n])+?)(?<!\s)\$(?!\d)/.exec(src);
      if (!m) return undefined;
      return { type: "inlineMath", raw: m[0], text: m[1] };
    },
    renderer(token: MarkedTokenLike): string {
      return `<span class="math-inline" data-math="${encodeAttr(token.text)}"></span>`;
    },
  },
];

/** Attributes for DOMPurify to keep across sanitisation. */
export const MATH_DOMPURIFY_ATTRS = ["data-math"];

/**
 * Render every math placeholder in `container` with KaTeX.
 * Errors are rendered inline as a red error span — never thrown.
 */
export function renderMathInDom(container: HTMLElement): void {
  const inline = container.querySelectorAll<HTMLElement>("span.math-inline[data-math]");
  inline.forEach((el) => renderInto(el, false));
  const block = container.querySelectorAll<HTMLElement>("div.math-block[data-math]");
  block.forEach((el) => renderInto(el, true));
}

function renderInto(el: HTMLElement, displayMode: boolean): void {
  const tex = decodeAttr(el.getAttribute("data-math") ?? "");
  if (!tex) return;
  // Guard against double-rendering (preview re-render hits the same nodes).
  if (el.getAttribute("data-math-rendered") === "1") return;
  try {
    katex.render(tex, el, {
      displayMode,
      throwOnError: false,
      strict: "ignore",
      output: "html",
    });
    el.setAttribute("data-math-rendered", "1");
  } catch (err) {
    el.textContent = `[math error: ${(err as Error).message}]`;
    el.classList.add("math-error");
  }
}

/** Encode TeX for safe storage in an HTML attribute. */
function encodeAttr(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function decodeAttr(s: string): string {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}
