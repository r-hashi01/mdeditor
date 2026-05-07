/**
 * Obsidian-style wiki links (`[[target]]` / `[[target|alias]]`).
 *
 * Mirrors the structure of `math-renderer.ts`: a marked tokenizer extension
 * emits a placeholder anchor with the *raw* target encoded as an attribute,
 * and a post-render DOM pass resolves the target against the vault and
 * either marks the link as live or as unresolved (dashed-underline style).
 */

import { resolveLink } from "./vault";

interface MarkedTokenLike {
  type: string;
  raw: string;
  text: string;
  alias: string;
}

export const wikiLinkExtensions = [
  {
    name: "wikiLink",
    level: "inline" as const,
    start(src: string): number | undefined {
      const idx = src.indexOf("[[");
      return idx < 0 ? undefined : idx;
    },
    tokenizer(src: string): MarkedTokenLike | undefined {
      // Match [[target]] or [[target|alias]]. Require non-newline body and
      // a non-empty target.
      const m = /^\[\[([^\[\]\n]+?)\]\]/.exec(src);
      if (!m) return undefined;
      const inner = m[1];
      const pipe = inner.indexOf("|");
      const text = (pipe >= 0 ? inner.slice(0, pipe) : inner).trim();
      if (!text) return undefined;
      const alias = pipe >= 0 ? inner.slice(pipe + 1).trim() : text;
      return { type: "wikiLink", raw: m[0], text, alias };
    },
    renderer(token: MarkedTokenLike): string {
      const target = encodeAttr(token.text);
      const alias = escapeHtml(token.alias);
      return `<a class="wikilink" data-wiki-target="${target}" href="#">${alias}</a>`;
    },
  },
];

export const WIKI_DOMPURIFY_ATTRS = ["data-wiki-target"];

/**
 * Resolve every wiki-link placeholder in `container`. Resolved links get
 * `data-wiki-resolved` (the absolute path) so the click handler can open
 * the file directly without re-resolving. Unresolved links get the
 * `wikilink-unresolved` class.
 */
export function resolveWikiLinksInDom(container: HTMLElement): void {
  const links = container.querySelectorAll<HTMLAnchorElement>("a.wikilink[data-wiki-target]");
  links.forEach((a) => {
    const target = decodeAttr(a.getAttribute("data-wiki-target") ?? "");
    if (!target) return;
    const file = resolveLink(target);
    if (file) {
      a.setAttribute("data-wiki-resolved", file.path);
      a.classList.remove("wikilink-unresolved");
      a.title = file.rel;
    } else {
      a.classList.add("wikilink-unresolved");
      a.removeAttribute("data-wiki-resolved");
      a.title = `Unresolved: ${target}`;
    }
  });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

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
