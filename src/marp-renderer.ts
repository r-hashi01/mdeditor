/**
 * Lightweight Marp-compatible slide renderer.
 * Uses the project's existing marked + highlight.js instead of the heavy @marp-team/marp-core.
 * Slides are plain <section> elements styled with CSS container queries (cqw) for scaling.
 */
import { Marked } from "marked";
import hljs from "highlight.js/lib/core";
import DOMPurify from "dompurify";

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/* ── Slide-local Marked instance (hljs languages registered in preview.ts) ── */
const slideMarked = new Marked({
  renderer: {
    code({ text, lang }: { text: string; lang?: string }) {
      const language = lang && hljs.getLanguage(lang) ? lang : "plaintext";
      let highlighted: string;
      try {
        highlighted = hljs.highlight(text, { language }).value;
      } catch {
        highlighted = esc(text);
      }
      return `<pre><code class="hljs language-${language}">${highlighted}</code></pre>`;
    },
  },
  gfm: true,
  breaks: false,
});

/* ── Frontmatter ── */
export function parseFrontmatter(
  content: string,
): { directives: Record<string, string>; body: string } {
  const m = content.match(/^---\s*\n([\s\S]*?)\n---\s*(?:\n|$)/);
  if (!m) return { directives: {}, body: content };

  const directives: Record<string, string> = {};
  // Handle multi-line values (style: | ...)
  let currentKey = "";
  let multiline = false;
  for (const line of m[1].split("\n")) {
    if (multiline) {
      if (/^\s+/.test(line)) {
        directives[currentKey] += "\n" + line;
        continue;
      }
      multiline = false;
    }
    const kv = line.match(/^\s*([\w-]+)\s*:\s*(.*?)\s*$/);
    if (kv) {
      currentKey = kv[1];
      const val = kv[2];
      if (val === "|" || val === ">") {
        directives[currentKey] = "";
        multiline = true;
      } else {
        directives[currentKey] = val;
      }
    }
  }
  return { directives, body: content.slice(m[0].length) };
}

/* ── Slide splitting ── */
export interface RawSlide {
  content: string;
  directives: Record<string, string>;
}

export function splitSlides(body: string): RawSlide[] {
  const parts = body.split(/^---\s*$/m);
  return parts.map((part) => {
    const directives: Record<string, string> = {};
    const content = part.replace(
      /<!--\s*([\w_-]+)\s*:\s*([\s\S]*?)\s*-->/g,
      (_, key: string, value: string) => {
        directives[key.trim()] = value.trim();
        return "";
      },
    );
    return { content: content.trim(), directives };
  });
}

/* ── Directive resolution (carry-forward + scoped _ prefix) ── */
const DIR_KEYS = [
  "backgroundColor",
  "backgroundImage",
  "color",
  "class",
  "header",
  "footer",
  "paginate",
];

interface Resolved {
  html: string;
  backgroundColor: string;
  backgroundImage: string;
  color: string;
  className: string;
  header: string;
  footer: string;
  paginate: boolean;
}

function resolveAndRender(
  rawSlides: RawSlide[],
  global: Record<string, string>,
): Resolved[] {
  const carried: Record<string, string> = {};
  for (const k of DIR_KEYS) {
    if (global[k] !== undefined) carried[k] = global[k];
  }

  return rawSlides.map((slide) => {
    const scoped: Record<string, string> = {};
    for (const [key, value] of Object.entries(slide.directives)) {
      if (key.startsWith("_")) {
        scoped[key.slice(1)] = value;
      } else if (DIR_KEYS.includes(key)) {
        carried[key] = value;
      }
    }
    const eff = { ...carried, ...scoped };
    const raw = slideMarked.parse(slide.content) as string;
    const html = DOMPurify.sanitize(raw);

    return {
      html,
      backgroundColor: eff.backgroundColor || "",
      backgroundImage: eff.backgroundImage || "",
      color: eff.color || "",
      className: eff.class || "",
      header: eff.header || "",
      footer: eff.footer || "",
      paginate: eff.paginate === "true",
    };
  });
}

/* ── Theme CSS ── */
const THEMES: Record<string, string> = {
  default: `
.marp-slide{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Oxygen-Sans,Ubuntu,Cantarell,"Helvetica Neue","Noto Sans JP",sans-serif;color:#333;background:#fff}
.marp-slide h1{font-size:1.6em;color:#246;border-bottom:2px solid #e8e8e8;padding-bottom:.1em;margin:0 0 .4em}
.marp-slide h2{font-size:1.35em;color:#246;margin:0 0 .3em}
.marp-slide h3{font-size:1.15em;margin:0 0 .3em}
.marp-slide a{color:#0366d6}
.marp-slide code{background:#f0f0f0;padding:.1em .4em;border-radius:3px;font-size:.85em;font-family:"SF Mono","Fira Code",monospace}
.marp-slide pre{background:#f6f8fa;border-radius:6px;padding:.8em 1em;margin:.5em 0}
.marp-slide pre code{background:none;padding:0;font-size:.8em}
.marp-slide blockquote{border-left:4px solid #ddd;padding-left:1em;color:#666;margin:.5em 0}
.marp-slide table{border-collapse:collapse;width:100%;margin:.5em 0}
.marp-slide th,.marp-slide td{border:1px solid #ddd;padding:.4em .8em;text-align:left}
.marp-slide th{background:#f6f8fa}
.marp-slide img{max-width:100%}
.marp-slide ul,.marp-slide ol{padding-left:1.5em;margin:.3em 0}
.marp-slide li{margin:.15em 0}
.marp-slide p{margin:.4em 0}
.marp-slide hr{border:none;border-top:1px solid #e8e8e8;margin:1em 0}`,

  gaia: `
.marp-slide{font-family:Lato,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Noto Sans JP",sans-serif;color:#fff;background:#0288d1}
.marp-slide h1{font-size:1.6em;border-bottom:none;margin:0 0 .4em}
.marp-slide h2{font-size:1.35em;margin:0 0 .3em}
.marp-slide h3{font-size:1.15em;margin:0 0 .3em}
.marp-slide a{color:#b3e5fc}
.marp-slide code{background:rgba(255,255,255,.2);padding:.1em .4em;border-radius:3px;font-size:.85em;font-family:"SF Mono","Fira Code",monospace}
.marp-slide pre{background:rgba(0,0,0,.2);border-radius:6px;padding:.8em 1em;margin:.5em 0}
.marp-slide pre code{background:none;padding:0;font-size:.8em}
.marp-slide blockquote{border-left:4px solid rgba(255,255,255,.4);padding-left:1em;color:rgba(255,255,255,.8);margin:.5em 0}
.marp-slide table{border-collapse:collapse;width:100%;margin:.5em 0}
.marp-slide th,.marp-slide td{border:1px solid rgba(255,255,255,.3);padding:.4em .8em;text-align:left}
.marp-slide th{background:rgba(0,0,0,.15)}
.marp-slide img{max-width:100%}
.marp-slide ul,.marp-slide ol{padding-left:1.5em;margin:.3em 0}
.marp-slide li{margin:.15em 0}
.marp-slide p{margin:.4em 0}
.marp-slide hr{border:none;border-top:1px solid rgba(255,255,255,.3);margin:1em 0}`,

  uncover: `
.marp-slide{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Noto Sans JP",sans-serif;color:#333;background:#fafafa}
.marp-slide h1{font-size:1.6em;color:#e53935;border-bottom:none;margin:0 0 .4em}
.marp-slide h2{font-size:1.35em;color:#333;margin:0 0 .3em}
.marp-slide h3{font-size:1.15em;margin:0 0 .3em}
.marp-slide a{color:#e53935}
.marp-slide code{background:#eee;padding:.1em .4em;border-radius:3px;font-size:.85em;font-family:"SF Mono","Fira Code",monospace}
.marp-slide pre{background:#eee;border-radius:6px;padding:.8em 1em;margin:.5em 0}
.marp-slide pre code{background:none;padding:0;font-size:.8em}
.marp-slide blockquote{border-left:4px solid #e53935;padding-left:1em;color:#666;margin:.5em 0}
.marp-slide table{border-collapse:collapse;width:100%;margin:.5em 0}
.marp-slide th,.marp-slide td{border:1px solid #ddd;padding:.4em .8em;text-align:left}
.marp-slide th{background:#eee}
.marp-slide img{max-width:100%}
.marp-slide ul,.marp-slide ol{padding-left:1.5em;margin:.3em 0}
.marp-slide li{margin:.15em 0}
.marp-slide p{margin:.4em 0}
.marp-slide hr{border:none;border-top:1px solid #ddd;margin:1em 0}`,
};

/* ── CSS / class sanitizers (hoisted so they can be unit-tested) ── */

/** Sanitize a CSS value to prevent attribute injection. */
export function safeCssValue(v: string): string {
  // Strip characters that could break out of a quoted attribute
  return v.replace(/[;"'<>{}\\]/g, "");
}

/** Sanitize a CSS background-image value — only allow safe URL schemes. */
export function safeBgImage(v: string): string {
  const cleaned = safeCssValue(v);
  // Validate every url() expression — only permit http(s) and data:image/
  const urlPattern = /url\s*\(/gi;
  const safeScheme = /^url\(\s*(https?:|data:image\/)/i;
  let match;
  while ((match = urlPattern.exec(cleaned)) !== null) {
    const fromUrl = cleaned.slice(match.index);
    if (!safeScheme.test(fromUrl)) {
      return "";
    }
  }
  return cleaned;
}

/** Sanitize a CSS class name. */
export function safeClassName(v: string): string {
  return v.replace(/[^a-zA-Z0-9_ -]/g, "");
}

/* ── Public API ── */
export interface MarpRenderResult {
  /** Concatenated <section> elements for all slides */
  html: string;
  /** Theme CSS + custom style from frontmatter */
  css: string;
  slideCount: number;
}

export function renderMarp(content: string): MarpRenderResult {
  const { directives: global, body } = parseFrontmatter(content);
  const rawSlides = splitSlides(body);
  const slides = resolveAndRender(rawSlides, global);
  const theme = global.theme || "default";

  let html = "";
  slides.forEach((slide, i) => {
    const styles: string[] = [];
    if (slide.backgroundColor)
      styles.push(`background-color:${safeCssValue(slide.backgroundColor)}`);
    if (slide.backgroundImage)
      styles.push(`background-image:${safeBgImage(slide.backgroundImage)}`);
    if (slide.color) styles.push(`color:${safeCssValue(slide.color)}`);

    const cls = ["marp-slide", safeClassName(slide.className)].filter(Boolean).join(" ");
    const style = styles.length > 0 ? ` style="${styles.join(";")}"` : "";

    html += `<section class="${cls}" data-slide="${i}"${style}>`;
    html += `<div class="marp-slide-content">${slide.html}</div>`;
    if (slide.header)
      html += `<div class="marp-header">${esc(slide.header)}</div>`;
    if (slide.footer)
      html += `<div class="marp-footer">${esc(slide.footer)}</div>`;
    if (slide.paginate)
      html += `<div class="marp-pagination">${i + 1}</div>`;
    html += `</section>`;
  });

  // Theme CSS + user custom style (sanitize to prevent </style> escape)
  let css = THEMES[theme] || THEMES.default;
  if (global.style) {
    let userCss = global.style;
    // Strip </style> sequences to prevent tag escape XSS
    userCss = userCss.replace(/<\/style\s*>/gi, "/* blocked */");
    // Block @import to prevent loading external stylesheets
    userCss = userCss.replace(/@import\b[^;]*/gi, "/* @import blocked */");
    // Block url() with external origins (only allow data:image/ for inline assets)
    userCss = userCss.replace(/url\s*\(\s*(?!['"]?data:image\/)(["']?)https?:/gi, "url($1blocked:");
    css += "\n" + userCss;
  }

  return { html, css, slideCount: slides.length };
}
