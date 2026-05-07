import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { Marked } from "marked";
import DOMPurify from "dompurify";
import { mathExtensions, MATH_DOMPURIFY_ATTRS, renderMathInDom } from "./math-renderer";
import { wikiLinkExtensions, WIKI_DOMPURIFY_ATTRS, resolveWikiLinksInDom } from "./wiki-links";
import hljs from "highlight.js/lib/core";
import type { EditorView } from "codemirror";
import { escapeHtml } from "./html-utils";
import javascript from "highlight.js/lib/languages/javascript";
import typescript from "highlight.js/lib/languages/typescript";
import python from "highlight.js/lib/languages/python";
import rust from "highlight.js/lib/languages/rust";
import bash from "highlight.js/lib/languages/bash";
import json from "highlight.js/lib/languages/json";
import css from "highlight.js/lib/languages/css";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";
import ini from "highlight.js/lib/languages/ini";
import properties from "highlight.js/lib/languages/properties";

hljs.registerLanguage("javascript", javascript);
hljs.registerLanguage("js", javascript);
hljs.registerLanguage("typescript", typescript);
hljs.registerLanguage("ts", typescript);
hljs.registerLanguage("python", python);
hljs.registerLanguage("rust", rust);
hljs.registerLanguage("bash", bash);
hljs.registerLanguage("shell", bash);
hljs.registerLanguage("json", json);
hljs.registerLanguage("css", css);
hljs.registerLanguage("html", xml);
hljs.registerLanguage("xml", xml);
hljs.registerLanguage("yaml", yaml);
hljs.registerLanguage("yml", yaml);
hljs.registerLanguage("ini", ini);
hljs.registerLanguage("toml", ini);
hljs.registerLanguage("properties", properties);
hljs.registerLanguage("env", properties);

/* ── Marp slide renderer (lightweight, no external Marp dependency) ── */
import { renderMarp } from "./marp-renderer";

let marpCurrentSlide = 0;
let marpTotalSlides = 0;


/** Monotonically increasing render token to detect stale async callbacks. */
let renderToken = 0;

/** Track the current PDF blob URL so we can revoke it on re-render. */
let currentPdfBlobUrl: string | null = null;
/** Track the current HTML preview blob URL so we can revoke it on re-render. */
let currentHtmlBlobUrl: string | null = null;

/** Check if content has `marp: true` in YAML frontmatter */
export function isMarpContent(content: string): boolean {
  const m = content.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!m) return false;
  return /^\s*marp\s*:\s*true\s*$/m.test(m[1]);
}

/** Navigate Marp slides from outside (keyboard shortcut etc.) */
export function navigateMarpSlide(
  container: HTMLElement,
  direction: "prev" | "next",
): void {
  if (direction === "prev" && marpCurrentSlide > 0) {
    marpCurrentSlide--;
  } else if (direction === "next" && marpCurrentSlide < marpTotalSlides - 1) {
    marpCurrentSlide++;
  } else {
    return;
  }
  updateMarpSlideVisibility(container);
}

/** Reset Marp slide index (call when switching tabs) */
export function resetMarpSlide(): void {
  marpCurrentSlide = 0;
  marpTotalSlides = 0;
  marpZoomIndex = 2;
}

function updateMarpSlideVisibility(container: HTMLElement): void {
  const slides = container.querySelectorAll<HTMLElement>(
    ".marp-slide-container > .marp-slide",
  );

  slides.forEach((slide, i) => {
    slide.style.display = i === marpCurrentSlide ? "" : "none";
  });

  const indicator = container.querySelector(".marp-page-indicator");
  if (indicator) {
    indicator.textContent = `${marpCurrentSlide + 1} / ${marpTotalSlides}`;
  }
  const prevBtn = container.querySelector(
    '[data-marp-nav="prev"]',
  ) as HTMLButtonElement | null;
  const nextBtn = container.querySelector(
    '[data-marp-nav="next"]',
  ) as HTMLButtonElement | null;
  if (prevBtn) prevBtn.disabled = marpCurrentSlide === 0;
  if (nextBtn) nextBtn.disabled = marpCurrentSlide >= marpTotalSlides - 1;
}

const ZOOM_STEPS = [50, 75, 100, 125, 150, 200];
let marpZoomIndex = 2;

const HTML_ZOOM_STEPS = [50, 75, 100, 125, 150, 200];
let htmlZoomIndex = 2;

function applyHtmlZoom(container: HTMLElement): void {
  const pct = HTML_ZOOM_STEPS[htmlZoomIndex];
  const frame = container.querySelector<HTMLElement>(".html-preview-frame");
  if (frame) {
    // `zoom` affects both rendering and layout box in WebKit, so the
    // surrounding scroller's overflow correctly picks up horizontal /
    // vertical overflow when zooming in.
    frame.style.zoom = `${pct / 100}`;
  }
  const label = container.querySelector(".html-zoom-label");
  if (label) label.textContent = `${pct}%`;
}

function applyZoom(container: HTMLElement): void {
  const scale = `${ZOOM_STEPS[marpZoomIndex] / 100}`;
  container.querySelectorAll<HTMLElement>(".marp-slide").forEach((slide) => {
    slide.style.setProperty("--marp-scale", scale);
  });
  const label = container.querySelector(".marp-zoom-label");
  if (label) label.textContent = `${ZOOM_STEPS[marpZoomIndex]}%`;
}

const marpResizeObservers = new WeakMap<HTMLElement, ResizeObserver>();

function fitMarpSlides(slideContainer: HTMLElement): void {
  const padX = 32;
  const availW = Math.max(0, slideContainer.clientWidth - padX);
  if (availW === 0) return;
  slideContainer.querySelectorAll<HTMLElement>(".marp-slide").forEach((slide) => {
    slide.style.setProperty("--marp-w", `${availW}px`);
  });
}

function observeMarpResize(slideContainer: HTMLElement): void {
  const existing = marpResizeObservers.get(slideContainer);
  if (existing) existing.disconnect();
  const ro = new ResizeObserver(() => fitMarpSlides(slideContainer));
  ro.observe(slideContainer);
  marpResizeObservers.set(slideContainer, ro);
  fitMarpSlides(slideContainer);
}


/**
 * Compute the starting line number (0-based) of each slide in the source.
 * Accounts for YAML frontmatter and --- separators.
 */
function computeSlideLineOffsets(content: string): number[] {
  const lines = content.split("\n");

  // Skip frontmatter (--- ... ---)
  let bodyStart = 0;
  if (lines[0]?.trim() === "---") {
    for (let i = 1; i < lines.length; i++) {
      if (/^---\s*$/.test(lines[i])) {
        bodyStart = i + 1;
        break;
      }
    }
  }

  // First slide starts right after frontmatter
  const offsets: number[] = [bodyStart];
  for (let i = bodyStart; i < lines.length; i++) {
    if (/^---\s*$/.test(lines[i])) {
      offsets.push(i + 1); // slide starts on the line after ---
    }
  }
  return offsets;
}

/**
 * Post-process Marp slide DOM to add data-source-line and data-editable
 * attributes, enabling click-to-navigate and inline editing.
 */
function annotateMarpSlideElements(container: HTMLElement, content: string): void {
  const allLines = content.split("\n");
  const slideOffsets = computeSlideLineOffsets(content);
  const slides = container.querySelectorAll<HTMLElement>(".marp-slide");

  slides.forEach((slideEl, slideIndex) => {
    const startLine = slideOffsets[slideIndex] ?? 0;
    const endLine = slideOffsets[slideIndex + 1] !== undefined
      ? slideOffsets[slideIndex + 1] - 1 // exclude the --- separator line
      : allLines.length;

    const slideLines = allLines.slice(startLine, endLine);
    const strippedLines = slideLines.map((l) => stripInlineMarkdown(l.trimStart()));

    const contentEl = slideEl.querySelector(".marp-slide-content") || slideEl;
    const blocks = contentEl.querySelectorAll<HTMLElement>(
      "h1, h2, h3, h4, h5, h6, p, li, pre, blockquote, table",
    );

    const used = new Set<number>();
    for (const el of blocks) {
      const parent = el.parentElement;
      if (parent && parent !== contentEl && parent.matches("blockquote, li")) continue;

      const text = (el.textContent || "").trim().split("\n")[0].trim();

      if (!text) {
        if (el.tagName === "LI") {
          for (let i = 0; i < slideLines.length; i++) {
            if (used.has(i)) continue;
            const line = slideLines[i].trimStart();
            if (/^(?:[-*+]|\d+\.)\s*$/.test(line)) {
              el.setAttribute("data-source-line", String(startLine + i));
              el.setAttribute("data-editable", "true");
              used.add(i);
              break;
            }
          }
        }
        continue;
      }

      for (let i = 0; i < strippedLines.length; i++) {
        if (used.has(i)) continue;
        const stripped = strippedLines[i];
        if (stripped === text || stripped.includes(text)) {
          el.setAttribute("data-source-line", String(startLine + i));
          used.add(i);
          if (/^(H[1-6]|P|LI)$/.test(el.tagName)) {
            el.setAttribute("data-editable", "true");
          }
          break;
        }
      }
    }
  });
}

function renderMarpContent(
  container: HTMLElement,
  content: string,
  filePath: string | null,
): void {
  const { html, css, slideCount } = renderMarp(content);

  marpTotalSlides = Math.max(slideCount, 1);
  if (marpCurrentSlide >= marpTotalSlides) marpCurrentSlide = marpTotalSlides - 1;
  if (marpCurrentSlide < 0) marpCurrentSlide = 0;

  container.innerHTML =
    `<style class="marp-theme">${css}</style>` +
    `<div class="marp-slide-container">${html}</div>` +
    `<div class="marp-nav-bar">` +
    `<button class="marp-nav-btn" data-marp-nav="zoom-out" title="Zoom Out">` +
    `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h14"/></svg>` +
    `</button>` +
    `<span class="marp-zoom-label">${ZOOM_STEPS[marpZoomIndex]}%</span>` +
    `<button class="marp-nav-btn" data-marp-nav="zoom-in" title="Zoom In">` +
    `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>` +
    `</button>` +
    `<span class="marp-nav-spacer"></span>` +
    `<button class="marp-nav-btn" data-marp-nav="prev">` +
    `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 18l-6-6 6-6"/></svg>` +
    `</button>` +
    `<span class="marp-page-indicator">${marpCurrentSlide + 1} / ${marpTotalSlides}</span>` +
    `<button class="marp-nav-btn" data-marp-nav="next">` +
    `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18l6-6-6-6"/></svg>` +
    `</button>` +
    `</div>`;

  updateMarpSlideVisibility(container);
  applyZoom(container);
  const slideContainer = container.querySelector<HTMLElement>(".marp-slide-container");
  if (slideContainer) observeMarpResize(slideContainer);
  resolveLocalImages(container, filePath);

  // Post-process: add source-line tracking + editable markers to slide elements
  annotateMarpSlideElements(container, content);
  annotateTableCells(container, content.split("\n"));

  // Navigation handlers
  container.querySelector('[data-marp-nav="prev"]')?.addEventListener("click", () => {
    if (marpCurrentSlide > 0) {
      marpCurrentSlide--;
      updateMarpSlideVisibility(container);
    }
  });
  container.querySelector('[data-marp-nav="next"]')?.addEventListener("click", () => {
    if (marpCurrentSlide < marpTotalSlides - 1) {
      marpCurrentSlide++;
      updateMarpSlideVisibility(container);
    }
  });
  container.querySelector('[data-marp-nav="zoom-in"]')?.addEventListener("click", () => {
    if (marpZoomIndex < ZOOM_STEPS.length - 1) {
      marpZoomIndex++;
      applyZoom(container);
    }
  });
  container.querySelector('[data-marp-nav="zoom-out"]')?.addEventListener("click", () => {
    if (marpZoomIndex > 0) {
      marpZoomIndex--;
      applyZoom(container);
    }
  });
}

/* ── Mermaid lazy loader ── */
let mermaidModule: typeof import("mermaid") | null = null;
let mermaidReady = false;
let mermaidId = 0;
let pendingMermaidTheme = "dark";

async function ensureMermaid(): Promise<void> {
  if (mermaidReady) return;
  if (!mermaidModule) {
    mermaidModule = await import("mermaid");
    mermaidModule.default.initialize({
      startOnLoad: false,
      theme: pendingMermaidTheme as Parameters<typeof mermaidModule.default.initialize>[0]["theme"],
      fontFamily: '"SF Mono", "Fira Code", monospace',
      securityLevel: "strict",
    });
    mermaidReady = true;
  }
}

export function setMermaidTheme(theme: string): void {
  pendingMermaidTheme = theme;
  if (mermaidModule && mermaidReady) {
    mermaidModule.default.initialize({
      startOnLoad: false,
      theme: theme as Parameters<typeof mermaidModule.default.initialize>[0]["theme"],
      fontFamily: '"SF Mono", "Fira Code", monospace',
      securityLevel: "strict",
    });
  }
}

/* ── Slug generation (Japanese-aware) ── */
const slugCounts = new Map<string, number>();

function slugify(text: string): string {
  const base = text
    .toLowerCase()
    .replace(/<[^>]*>/g, "")                        // strip HTML tags
    .replace(/[^\w\u3000-\u9fff\uff00-\uffef-]+/g, "-")  // non-word → hyphen (keep CJK)
    .replace(/^-+|-+$/g, "");                         // trim leading/trailing hyphens
  // Handle duplicate slugs
  const count = slugCounts.get(base) || 0;
  slugCounts.set(base, count + 1);
  return count === 0 ? base : `${base}-${count}`;
}

/* ── Source line map: built before each render to track markdown → HTML positions ── */
let sourceLines: string[] = [];

function buildSourceLineMap(content: string): void {
  sourceLines = content.split("\n");
}


const marked = new Marked({
  renderer: {
    code({ text, lang }: { text: string; lang?: string }) {
      // Mermaid blocks: render placeholder that will be processed after DOM insertion
      if (lang === "mermaid") {
        const id = `mermaid-${mermaidId++}`;
        return `<div class="mermaid-placeholder" data-mermaid-id="${id}">${escapeHtml(text)}</div>`;
      }
      const language = lang && hljs.getLanguage(lang) ? lang : "plaintext";
      let highlighted: string;
      try {
        highlighted = hljs.highlight(text, { language }).value;
      } catch {
        highlighted = escapeHtml(text);
      }
      return `<pre><code class="hljs language-${language}">${highlighted}</code></pre>`;
    },
  },
  extensions: [...mathExtensions, ...wikiLinkExtensions],
  gfm: true,
  breaks: false,
});

/** Strip common inline markdown syntax to get plain text for matching. */
function stripInlineMarkdown(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\*(.+?)\*/g, "$1")
    .replace(/~~(.+?)~~/g, "$1")
    .replace(/`(.+?)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1");
}

/**
 * Post-process the rendered DOM to add source-line tracking, heading IDs,
 * and editable markers. This avoids the marked v17 issue where custom
 * renderers receive raw token text instead of processed inline HTML.
 */
function annotatePreviewElements(container: HTMLElement): void {
  const used = new Set<number>();

  // Pre-compute stripped source lines for matching
  const strippedSourceLines = sourceLines.map((l) => stripInlineMarkdown(l.trimStart()));

  // Add slug IDs to headings
  const headings = container.querySelectorAll<HTMLElement>("h1, h2, h3, h4, h5, h6");
  for (const h of headings) {
    h.id = slugify(h.textContent || "");
  }

  // Add source-line + editable attributes to block elements
  const blocks = container.querySelectorAll<HTMLElement>(
    "h1, h2, h3, h4, h5, h6, p, li, pre, blockquote, table",
  );
  for (const el of blocks) {
    // Skip nested elements (e.g. <p> inside <blockquote>)
    const parent = el.parentElement;
    if (parent && parent !== container && parent.matches("blockquote, li")) continue;

    const text = (el.textContent || "").trim().split("\n")[0].trim();

    // For empty elements (e.g. empty list items), match against empty source lines
    if (!text) {
      if (el.tagName === "LI") {
        for (let i = 0; i < sourceLines.length; i++) {
          if (used.has(i)) continue;
          const line = sourceLines[i].trimStart();
          // Match empty list items: just a marker like "- ", "* ", "1. "
          if (/^(?:[-*+]|\d+\.)\s*$/.test(line)) {
            el.setAttribute("data-source-line", String(i));
            el.setAttribute("data-editable", "true");
            used.add(i);
            break;
          }
        }
      }
      continue;
    }

    for (let i = 0; i < sourceLines.length; i++) {
      if (used.has(i)) continue;
      const stripped = strippedSourceLines[i];
      // Match: stripped line equals text, or stripped line contains text (for prefixed lines)
      if (stripped === text || stripped.includes(text)) {
        el.setAttribute("data-source-line", String(i));
        used.add(i);
        // Make headings, paragraphs, and list items editable
        if (/^(H[1-6]|P|LI)$/.test(el.tagName)) {
          el.setAttribute("data-editable", "true");
        }
        break;
      }
    }
  }
}

/**
 * Annotate individual table cells (<th>, <td>) within tables that already
 * have a data-source-line attribute.  Each cell gets:
 *   data-source-line  – the 0-based source line of its row
 *   data-col-index    – 0-based column index
 *   data-editable     – "true"
 */
function annotateTableCells(container: HTMLElement, allLines: string[]): void {
  const tables = container.querySelectorAll<HTMLElement>("table[data-source-line]");
  for (const table of tables) {
    const startLine = parseInt(table.dataset.sourceLine!, 10);
    if (isNaN(startLine) || startLine < 0) continue;
    // Verify this looks like a pipe table row
    if (!allLines[startLine]?.trimStart().startsWith("|")) continue;

    // Header cells (thead > tr > th)
    const headerCells = table.querySelectorAll<HTMLElement>("thead th");
    headerCells.forEach((th, colIdx) => {
      th.setAttribute("data-source-line", String(startLine));
      th.setAttribute("data-col-index", String(colIdx));
      th.setAttribute("data-editable", "true");
    });

    // Body rows — skip separator line at startLine+1
    const bodyRows = table.querySelectorAll<HTMLElement>("tbody tr");
    bodyRows.forEach((tr, rowIdx) => {
      const lineNum = startLine + 2 + rowIdx;
      if (lineNum >= allLines.length) return;
      if (!allLines[lineNum]?.trimStart().startsWith("|")) return;
      const tds = tr.querySelectorAll<HTMLElement>("td");
      tds.forEach((td, colIdx) => {
        td.setAttribute("data-source-line", String(lineNum));
        td.setAttribute("data-col-index", String(colIdx));
        td.setAttribute("data-editable", "true");
      });
    });
  }
}


const MD_EXTENSIONS = new Set(["md", "markdown"]);
const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp", "bmp", "ico", "avif"]);
const SVG_EXTENSIONS = new Set(["svg"]);
const DRAWIO_EXTENSIONS = new Set(["drawio"]);
const CSV_EXTENSIONS = new Set(["csv", "tsv"]);
const PDF_EXTENSIONS = new Set(["pdf"]);
const DOCX_EXTENSIONS = new Set(["docx", "doc"]);
const HTML_EXTENSIONS = new Set(["html", "htm"]);
const EXTERNAL_ONLY_EXTENSIONS = new Set(["xlsx", "xls", "pptx", "ppt"]);

/**
 * Extract YAML frontmatter from markdown content.
 * Returns { yaml, body } where yaml is the frontmatter content (without ---),
 * and body is the rest of the markdown.
 */
function extractFrontmatter(content: string): { yaml: string; body: string } | null {
  const match = content.match(/^---[ \t]*\n([\s\S]*?)\n---[ \t]*(?:\n|$)/);
  if (!match) return null;
  return {
    yaml: match[1],
    body: content.slice(match[0].length),
  };
}

/** Render frontmatter as a highlighted YAML block. */
function renderFrontmatterHtml(yamlContent: string): string {
  let highlighted: string;
  try {
    highlighted = hljs.highlight(yamlContent, { language: "yaml" }).value;
  } catch {
    highlighted = escapeHtml(yamlContent);
  }
  return `<details class="preview-frontmatter" open><summary>Frontmatter</summary><pre><code class="hljs language-yaml">${highlighted}</code></pre></details>`;
}

const EXT_TO_LANG: Record<string, string> = {
  js: "javascript", jsx: "javascript", ts: "typescript", tsx: "typescript",
  py: "python", rs: "rust", sh: "bash", bash: "bash", zsh: "bash",
  json: "json", css: "css", html: "html", xml: "xml", svg: "xml",
  yaml: "yaml", yml: "yaml", ini: "ini", toml: "toml",
  env: "env", conf: "ini", cfg: "ini", properties: "properties",
  drawio: "xml",
};

function getExtension(filePath: string | null): string {
  if (!filePath) return "md";
  const name = filePath.split(/[/\\]/).pop() || "";
  // dotfiles like .env → "env"
  if (name.startsWith(".") && !name.includes(".", 1)) return name.slice(1);
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : "";
}

export function isMarkdownFile(filePath: string | null): boolean {
  return MD_EXTENSIONS.has(getExtension(filePath));
}

export function isImageFile(filePath: string | null): boolean {
  return IMAGE_EXTENSIONS.has(getExtension(filePath));
}

export function isSvgFile(filePath: string | null): boolean {
  return SVG_EXTENSIONS.has(getExtension(filePath));
}

export function isHtmlFile(filePath: string | null): boolean {
  return HTML_EXTENSIONS.has(getExtension(filePath));
}

export function isDrawioFile(filePath: string | null): boolean {
  return DRAWIO_EXTENSIONS.has(getExtension(filePath));
}

export function isCsvFile(filePath: string | null): boolean {
  return CSV_EXTENSIONS.has(getExtension(filePath));
}

export function isPdfFile(filePath: string | null): boolean {
  return PDF_EXTENSIONS.has(getExtension(filePath));
}

export function isDocxFile(filePath: string | null): boolean {
  return DOCX_EXTENSIONS.has(getExtension(filePath));
}

export function isExternalOnlyFile(filePath: string | null): boolean {
  return EXTERNAL_ONLY_EXTENSIONS.has(getExtension(filePath));
}

async function renderMermaidBlocks(container: HTMLElement, token: number): Promise<void> {
  const placeholders = container.querySelectorAll<HTMLElement>(".mermaid-placeholder");
  if (placeholders.length === 0) return;

  await ensureMermaid();
  if (token !== renderToken) return; // stale — a newer render started
  const mermaid = mermaidModule!.default;

  for (const el of placeholders) {
    if (token !== renderToken) return; // stale check between each diagram
    const id = el.dataset.mermaidId || `mermaid-${mermaidId++}`;
    const source = el.textContent || "";
    try {
      const { svg } = await mermaid.render(id, source);
      if (token !== renderToken) return;
      el.innerHTML = DOMPurify.sanitize(svg, { USE_PROFILES: { svg: true } });
      el.classList.remove("mermaid-placeholder");
      el.classList.add("mermaid-rendered");
    } catch {
      if (token !== renderToken) return;
      // Show source as code block on parse error
      el.innerHTML = `<pre class="mermaid-error"><code>${escapeHtml(source)}</code></pre>`;
      el.classList.remove("mermaid-placeholder");
      el.classList.add("mermaid-error-container");
    }
  }
}

/* ── Local image path resolution ── */
function resolveLocalImages(container: HTMLElement, filePath: string | null): void {
  const imgs = container.querySelectorAll<HTMLImageElement>("img");
  for (const img of imgs) {
    const src = img.getAttribute("src");
    if (!src) continue;
    // Skip already-resolved URLs (http, https, data, asset)
    if (/^(https?:|data:|asset:|blob:)/i.test(src)) continue;

    let absolutePath: string;
    if (src.startsWith("/")) {
      // Already absolute
      absolutePath = src;
    } else if (filePath) {
      // Relative path → resolve from the MD file's directory
      const dir = filePath.replace(/[/\\][^/\\]*$/, "");
      absolutePath = `${dir}/${src}`;
    } else {
      // No file path (Untitled) — can't resolve relative
      continue;
    }

    img.src = convertFileSrc(absolutePath);
  }
}

/* ── TOC generation ── */
function buildTocHtml(container: HTMLElement): string {
  const headings = container.querySelectorAll<HTMLElement>("h1, h2, h3");
  if (headings.length < 2) return "";

  let html = '<nav class="preview-toc"><div class="preview-toc-title">Table of Contents</div><ul>';
  for (const h of headings) {
    const level = parseInt(h.tagName[1], 10);
    const id = h.id;
    const text = h.textContent || "";
    html += `<li class="toc-level-${level}"><a href="#${id}">${escapeHtml(text)}</a></li>`;
  }
  html += "</ul></nav>";
  return html;
}

function attachTocClickHandlers(container: HTMLElement): void {
  const tocNav = container.querySelector(".preview-toc");
  if (!tocNav) return;
  tocNav.addEventListener("click", (e) => {
    const anchor = (e.target as HTMLElement).closest("a");
    if (!anchor) return;
    e.preventDefault();
    const href = anchor.getAttribute("href");
    if (!href) return;
    const target = container.querySelector(href);
    if (target) {
      target.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  });
}

export function renderPreview(
  container: HTMLElement,
  content: string,
  filePath?: string | null,
  showToc: boolean = true,
): void {
  // Skip re-render when the change originated from preview editing (prevents feedback loop)
  if (editingFromPreview) return;

  const ext = getExtension(filePath ?? null);
  const isMd = !filePath || MD_EXTENSIONS.has(ext);

  // Clear mode classes each render; each branch re-adds what it needs.
  container.classList.remove("html-mode");

  // ── Image preview mode ──
  if (filePath && IMAGE_EXTENSIONS.has(ext)) {
    container.classList.remove("marp-mode");
    const src = convertFileSrc(filePath);
    const name = filePath.split(/[/\\]/).pop() || filePath;
    container.innerHTML =
      `<div class="image-preview">` +
      `<div class="image-preview-filename">${escapeHtml(name)}</div>` +
      `<div class="image-preview-wrapper">` +
      `<img src="${src}" alt="${escapeHtml(name)}" />` +
      `</div>` +
      `</div>`;
    return;
  }

  // ── SVG preview (render SVG content directly) ──
  if (filePath && SVG_EXTENSIONS.has(ext)) {
    container.classList.remove("marp-mode");
    const name = filePath.split(/[/\\]/).pop() || filePath;
    const sanitized = DOMPurify.sanitize(content, { USE_PROFILES: { svg: true, svgFilters: false } });
    container.innerHTML =
      `<div class="image-preview">` +
      `<div class="image-preview-filename">${escapeHtml(name)}</div>` +
      `<div class="image-preview-wrapper">${sanitized}</div>` +
      `</div>`;
    return;
  }

  // ── HTML live preview (sandboxed iframe) ──
  if (filePath && HTML_EXTENSIONS.has(ext)) {
    container.classList.remove("marp-mode");
    container.classList.add("html-mode");
    ++renderToken;
    // Revoke previous HTML blob URL to prevent leak on rapid re-render
    if (currentHtmlBlobUrl) {
      URL.revokeObjectURL(currentHtmlBlobUrl);
      currentHtmlBlobUrl = null;
    }
    // Resolve local asset paths relative to the HTML file's directory
    const dirPath = filePath.replace(/[/\\][^/\\]*$/, "");
    const baseUrl = escapeHtml(convertFileSrc(dirPath) + "/");
    // CSP: allow images/styles/fonts from asset protocol & inline, block all
    // scripts and outbound network. The iframe sandbox also omits
    // `allow-scripts` as defence-in-depth — HTML previews are for viewing, not
    // code execution.
    const assetOrigin = new URL(convertFileSrc("/")).origin;
    const cspTag = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'none'; style-src 'unsafe-inline' ${assetOrigin}; img-src ${assetOrigin} data: blob:; font-src ${assetOrigin} data:; media-src ${assetOrigin}; connect-src 'none';">`;
    const baseTag = `<base href="${baseUrl}">`;
    // Force scrolling on in preview, even if the source page sets overflow:hidden.
    // Injected LAST so it overrides the page's own stylesheet.
    const scrollStyleTag =
      `<style id="__mdeditor_preview_overrides">` +
      `html,body{overflow:auto !important;height:auto !important;max-height:none !important}` +
      `</style>`;
    const headInjection = cspTag + baseTag;
    // Insert into <head> or prepend if no <head>
    let htmlContent: string;
    if (/<head[\s>]/i.test(content)) {
      htmlContent = content.replace(/(<head[\s>])/i, `$1${headInjection}`);
    } else if (/<html[\s>]/i.test(content)) {
      htmlContent = content.replace(/(<html[^>]*>)/i, `$1<head>${headInjection}</head>`);
    } else {
      htmlContent = `${headInjection}${content}`;
    }
    // Append the override style at the very end of <head> (or start of body if
    // no head) so it wins over any later-defined stylesheet in the source.
    if (/<\/head>/i.test(htmlContent)) {
      htmlContent = htmlContent.replace(/<\/head>/i, `${scrollStyleTag}</head>`);
    } else {
      htmlContent = `${scrollStyleTag}${htmlContent}`;
    }
    const blob = new Blob([htmlContent], { type: "text/html" });
    currentHtmlBlobUrl = URL.createObjectURL(blob);
    container.innerHTML =
      `<div class="html-preview-scroller">` +
      `<iframe class="html-preview-frame" sandbox="" src="${currentHtmlBlobUrl}"></iframe>` +
      `</div>` +
      `<div class="preview-zoom-bar">` +
      `<button class="marp-nav-btn" data-html-zoom="out" title="Zoom Out">` +
      `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h14"/></svg>` +
      `</button>` +
      `<span class="html-zoom-label">${HTML_ZOOM_STEPS[htmlZoomIndex]}%</span>` +
      `<button class="marp-nav-btn" data-html-zoom="in" title="Zoom In">` +
      `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>` +
      `</button>` +
      `</div>`;
    applyHtmlZoom(container);
    container.querySelector('[data-html-zoom="in"]')?.addEventListener("click", () => {
      if (htmlZoomIndex < HTML_ZOOM_STEPS.length - 1) {
        htmlZoomIndex++;
        applyHtmlZoom(container);
      }
    });
    container.querySelector('[data-html-zoom="out"]')?.addEventListener("click", () => {
      if (htmlZoomIndex > 0) {
        htmlZoomIndex--;
        applyHtmlZoom(container);
      }
    });
    return;
  }

  // ── CSV table preview ──
  if (filePath && CSV_EXTENSIONS.has(ext)) {
    container.classList.remove("marp-mode");
    const token = ++renderToken;
    import("./csv-renderer").then(({ renderCsv }) => {
      if (token !== renderToken) return;
      container.innerHTML = renderCsv(content);
    });
    return;
  }

  // ── Drawio diagram preview ──
  if (filePath && DRAWIO_EXTENSIONS.has(ext)) {
    container.classList.remove("marp-mode");
    const drawioPath = filePath;
    const token = ++renderToken;
    import("./drawio-renderer").then(({ renderDrawio }) => {
      renderDrawio(content).then((html) => {
        if (token !== renderToken) return;
        container.innerHTML = DOMPurify.sanitize(html, { USE_PROFILES: { svg: true, html: true } });
        container.querySelector(".drawio-open-external")?.addEventListener("click", () => {
          import("@tauri-apps/plugin-shell").then(({ open }) => open(drawioPath));
        });
      });
    });
    return;
  }

  // ── PDF inline preview ──
  if (filePath && PDF_EXTENSIONS.has(ext)) {
    container.classList.remove("marp-mode");
    const pdfPath = filePath;
    const token = ++renderToken;
    // Revoke previous blob URL to prevent memory leak
    if (currentPdfBlobUrl) {
      URL.revokeObjectURL(currentPdfBlobUrl);
      currentPdfBlobUrl = null;
    }
    // read_file_binary returns base64 — convert to Blob URL for <embed>
    invoke<string>("read_file_binary", { path: pdfPath }).then((b64) => {
      if (token !== renderToken) return;
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const blob = new Blob([bytes], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      currentPdfBlobUrl = url;
      container.innerHTML =
        `<embed src="${url}" type="application/pdf" class="pdf-embed" />`;
    }).catch(() => {
      if (token !== renderToken) return;
      container.innerHTML = '<div class="external-file-preview"><p>Failed to load PDF</p></div>';
    });
    return;
  }

  // ── DOCX preview (mammoth.js) ──
  if (filePath && DOCX_EXTENSIONS.has(ext)) {
    container.classList.remove("marp-mode");
    const docxPath = filePath;
    const token = ++renderToken;
    import("mammoth").then((mammoth) => {
      invoke<string>("read_file_binary", { path: docxPath }).then((b64) => {
        if (token !== renderToken) return;
        const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
        mammoth.convertToHtml({ arrayBuffer: bytes.buffer }).then((result: { value: string }) => {
          if (token !== renderToken) return;
          const clean = DOMPurify.sanitize(result.value);
          container.innerHTML = `<div class="docx-preview">${clean}</div>`;
        });
      }).catch(() => {
        if (token !== renderToken) return;
        container.innerHTML = '<div class="external-file-preview"><p>Failed to load DOCX</p></div>';
      });
    });
    return;
  }

  // ── External-only files (xlsx, pptx, etc.) — open with system app ──
  if (filePath && EXTERNAL_ONLY_EXTENSIONS.has(ext)) {
    container.classList.remove("marp-mode");
    const extPath = filePath;
    const name = filePath.split(/[/\\]/).pop() || filePath;
    const label = ext.toUpperCase();
    container.innerHTML =
      `<div class="external-file-preview">` +
      `<div class="external-file-icon">${label}</div>` +
      `<div class="external-file-name">${escapeHtml(name)}</div>` +
      `<button class="external-file-open">` +
      `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>` +
      ` Open with Default App</button>` +
      `</div>`;
    container.querySelector(".external-file-open")?.addEventListener("click", () => {
      import("@tauri-apps/plugin-shell").then(({ open }) => open(extPath));
    });
    return;
  }

  // Increment render token for all remaining synchronous paths to invalidate stale async callbacks
  ++renderToken;

  // Revoke stale blob URLs
  if (currentPdfBlobUrl) {
    URL.revokeObjectURL(currentPdfBlobUrl);
    currentPdfBlobUrl = null;
  }
  if (currentHtmlBlobUrl) {
    URL.revokeObjectURL(currentHtmlBlobUrl);
    currentHtmlBlobUrl = null;
  }

  // ── Marp slide mode ──
  if (isMd && isMarpContent(content)) {
    container.classList.add("marp-mode");
    renderMarpContent(container, content, filePath ?? null);
    return;
  }
  container.classList.remove("marp-mode");

  const scrollTop = container.scrollTop;

  // Reset slug counter for each render
  slugCounts.clear();

  if (isMd) {
    buildSourceLineMap(content);

    // Extract frontmatter before parsing markdown
    const fm = extractFrontmatter(content);
    const markdownBody = fm ? fm.body : content;

    const raw = marked.parse(markdownBody) as string;
    // DOMPurify: allow mermaid + math + wiki-link placeholders through
    const clean = DOMPurify.sanitize(raw, {
      ADD_ATTR: ["data-mermaid-id", ...MATH_DOMPURIFY_ATTRS, ...WIKI_DOMPURIFY_ATTRS],
    });
    container.innerHTML = clean;

    // Post-process: add heading IDs, source-line tracking, editable markers.
    // Math placeholders stay intact here so the source-line tracker sees the
    // original `<span class="math-inline">` wrappers without their KaTeX
    // children obscuring the structure.
    annotatePreviewElements(container);
    annotateTableCells(container, sourceLines);

    // KaTeX: replace math placeholders with rendered math (after annotation
    // so data-source-line attributes are already in place).
    renderMathInDom(container);

    // Wiki links: resolve `[[target]]` against the vault index. Must run
    // every render so newly-added vault entries become live links.
    resolveWikiLinksInDom(container);

    // Resolve local image paths to asset protocol URLs
    resolveLocalImages(container, filePath ?? null);

    // Insert frontmatter block at the top (before TOC)
    if (fm) {
      container.insertAdjacentHTML("afterbegin", renderFrontmatterHtml(fm.yaml));
    }

    // Insert TOC at the top if enabled
    if (showToc) {
      const tocHtml = buildTocHtml(container);
      if (tocHtml) {
        // Insert after frontmatter if present
        const fmEl = container.querySelector(".preview-frontmatter");
        if (fmEl) {
          fmEl.insertAdjacentHTML("afterend", tocHtml);
        } else {
          container.insertAdjacentHTML("afterbegin", tocHtml);
        }
        attachTocClickHandlers(container);
      }
    }

    // Async render mermaid diagrams after DOM insertion
    renderMermaidBlocks(container, renderToken);
  } else {
    const lang = EXT_TO_LANG[ext] || "plaintext";
    let highlighted: string;
    try {
      highlighted = hljs.getLanguage(lang)
        ? hljs.highlight(content, { language: lang }).value
        : hljs.highlightAuto(content).value;
    } catch {
      highlighted = content.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    }
    container.innerHTML = `<pre><code class="hljs language-${lang}">${highlighted}</code></pre>`;
  }
  container.scrollTop = scrollTop;
}

/* ── Preview editing: click-to-navigate + contenteditable sync-back ── */

/** Flag to prevent re-render feedback loops when editing from the preview pane. */
let editingFromPreview = false;

export function isEditingFromPreview(): boolean {
  return editingFromPreview;
}

export function setupPreviewEditing(
  previewPane: HTMLElement,
  editor: EditorView,
  onSyncBack: () => void,
): void {
  /** Check if the editor pane is currently visible (not preview-only mode). */
  function isEditorVisible(): boolean {
    return document.getElementById("container")?.dataset.viewMode !== "preview";
  }

  /** Activate contenteditable on an element. */
  function activateEditing(el: HTMLElement): void {
    if (el.closest("pre")) return;
    // Remove any hover "+" button that was appended as a child — otherwise its
    // "+" text would be picked up by el.textContent on blur and written into source.
    removeAddBtn();
    el.querySelectorAll(".preview-add-btn").forEach((b) => b.remove());
    el.contentEditable = "true";
    el.focus();
    el.classList.add("preview-editing");
    const range = document.createRange();
    range.selectNodeContents(el);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  }

  // ── Click handler: navigate to source OR start editing (preview-only mode) ──
  previewPane.addEventListener("click", (e) => {
    const target = e.target as HTMLElement;
    if (target.closest(".preview-add-btn")) return; // handled by the button itself
    const el = target.closest<HTMLElement>("[data-source-line]");
    if (!el) return;
    if (el.isContentEditable) return;

    const lineNum = parseInt(el.dataset.sourceLine!, 10);
    if (isNaN(lineNum) || lineNum < 0) return;

    if (isEditorVisible()) {
      // Split / code mode: jump to source line in editor
      const line = editor.state.doc.line(lineNum + 1);
      editor.dispatch({
        selection: { anchor: line.from },
        scrollIntoView: true,
      });
      editor.focus();
    } else {
      // Preview-only mode: single click starts editing directly
      if (el.dataset.editable) {
        activateEditing(el);
      }
    }
  });

  // ── Double-click to edit (works in all modes) ──
  previewPane.addEventListener("dblclick", (e) => {
    const target = e.target as HTMLElement;
    const el = target.closest<HTMLElement>("[data-editable]");
    if (!el) return;
    e.preventDefault();
    activateEditing(el);
  });

  // ── Blur handler: sync edited text back to source ──
  previewPane.addEventListener(
    "blur",
    (e) => {
      const el = e.target as HTMLElement;
      if (!el.isContentEditable || !el.dataset.sourceLine) return;

      el.contentEditable = "false";
      el.classList.remove("preview-editing");

      const lineNum = parseInt(el.dataset.sourceLine, 10);
      if (isNaN(lineNum) || lineNum < 0) return;

      const newText = el.textContent?.trim() ?? "";
      const docLine = editor.state.doc.line(lineNum + 1); // 1-based
      const oldText = docLine.text;

      // Table cell: use column-aware replacement
      const colIndex = el.dataset.colIndex;
      const replacementText = colIndex !== undefined
        ? rebuildTableCell(oldText, parseInt(colIndex, 10), newText)
        : rebuildMarkdownLine(oldText, newText);

      if (replacementText === oldText) return; // No change

      editingFromPreview = true;
      editor.dispatch({
        changes: { from: docLine.from, to: docLine.to, insert: replacementText },
      });
      // The dispatch above triggers CodeMirror's update listener synchronously,
      // which would re-render the preview — but we suppress that to avoid
      // clobbering the in-flight contenteditable DOM. Now that blur is done,
      // clear the flag and re-render so the typed markdown gets re-parsed
      // (e.g. `**foo**` → <strong>foo</strong>).
      requestAnimationFrame(() => {
        editingFromPreview = false;
        onSyncBack();
      });
    },
    true, // useCapture — blur doesn't bubble, so we need capture phase
  );

  // ── Escape to cancel editing ──
  previewPane.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      const el = document.activeElement as HTMLElement;
      if (el?.isContentEditable && previewPane.contains(el)) {
        el.contentEditable = "false";
        el.classList.remove("preview-editing");
        if (isEditorVisible()) editor.focus();
      }
    }
    // Enter confirms the edit (for single-line elements)
    if (e.key === "Enter" && !e.shiftKey) {
      const el = document.activeElement as HTMLElement;
      if (el?.isContentEditable && previewPane.contains(el)) {
        e.preventDefault();
        el.blur(); // Triggers the blur handler above
      }
    }
    // Tab navigates between table cells
    if (e.key === "Tab") {
      const el = document.activeElement as HTMLElement;
      if (el?.isContentEditable && previewPane.contains(el) && el.dataset.colIndex !== undefined) {
        e.preventDefault();
        el.blur(); // sync current cell first
        const table = el.closest("table");
        if (!table) return;
        const cells = Array.from(table.querySelectorAll<HTMLElement>("[data-editable][data-col-index]"));
        const idx = cells.indexOf(el);
        const next = e.shiftKey ? idx - 1 : idx + 1;
        if (next >= 0 && next < cells.length) {
          activateEditing(cells[next]);
        }
      }
    }
  });

  /* ── Hover "+" buttons for adding rows / list items ──────────────── */

  /** Insert a line after a given 0-based line number and focus the editor on it. */
  function insertLineAfterAndFocus(lineNum: number, text: string): void {
    const docLine = editor.state.doc.line(lineNum + 1);
    const insertPos = docLine.to;
    const insertText = "\n" + text;
    const newLineNum = lineNum + 1; // 0-based line number of the inserted line
    // Place cursor at end of new content
    const cursorPos = insertPos + insertText.length;
    editor.dispatch({
      changes: { from: insertPos, to: insertPos, insert: insertText },
      selection: { anchor: cursorPos },
      scrollIntoView: true,
    });
    editor.focus();
    onSyncBack();

    // Flash-highlight the newly inserted element in the preview.
    // Use setTimeout because the preview re-render is triggered by
    // CodeMirror's updateListener which may fire asynchronously.
    setTimeout(() => {
      const el = previewPane.querySelector<HTMLElement>(
        `[data-source-line="${newLineNum}"]`
      );
      if (el) {
        el.classList.add("preview-insert-highlight");
        el.scrollIntoView({ block: "nearest", behavior: "smooth" });
        el.addEventListener("animationend", () => {
          el.classList.remove("preview-insert-highlight");
        }, { once: true });
      }
    }, 50);
  }

  /** Build an empty table row matching the column count. */
  function emptyTableRow(existingRowLine: string): string {
    const cols = existingRowLine.split("|").length - 2;
    if (cols <= 0) return existingRowLine;
    return "|" + "  |".repeat(cols);
  }

  let addBtn: HTMLElement | null = null;
  let addBtnTarget: HTMLElement | null = null;

  function removeAddBtn(): void {
    if (addBtn) { addBtn.remove(); addBtn = null; addBtnTarget = null; }
  }

  function showAddBtn(anchor: HTMLElement): void {
    if (addBtnTarget === anchor && addBtn) return;
    removeAddBtn();
    addBtnTarget = anchor;

    addBtn = document.createElement("button");
    addBtn.className = "preview-add-btn";
    addBtn.textContent = "+";
    addBtn.title = "Add";

    addBtn.addEventListener("mousedown", (e) => {
      // Prevent the preview click handler from firing (which would jump to source)
      e.stopPropagation();
      e.preventDefault();
    });
    addBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      e.preventDefault();
      const lineNum = parseInt(anchor.dataset.sourceLine!, 10);
      if (isNaN(lineNum) || lineNum < 0) return;

      // Table row
      const cell = anchor.closest<HTMLElement>("td, th");
      const tr = cell ? anchor.closest("tr") : null;
      if (tr) {
        const rowCell = tr.querySelector<HTMLElement>("[data-source-line]");
        const rowLine = rowCell ? parseInt(rowCell.dataset.sourceLine!, 10) : lineNum;
        const rowText = editor.state.doc.line(rowLine + 1).text;
        insertLineAfterAndFocus(rowLine, emptyTableRow(rowText));
        removeAddBtn();
        return;
      }

      // List item
      const li = anchor.closest("li");
      if (li) {
        const oldLine = editor.state.doc.line(lineNum + 1).text;
        const prefixMatch = oldLine.match(/^(\s*(?:[-*+]|\d+\.)\s+)/);
        const prefix = prefixMatch ? prefixMatch[1] : "- ";
        const olMatch = prefix.match(/^(\s*)(\d+)(\.\s+)/);
        const nextPrefix = olMatch
          ? `${olMatch[1]}${parseInt(olMatch[2], 10) + 1}${olMatch[3]}`
          : prefix;
        insertLineAfterAndFocus(lineNum, nextPrefix);
        removeAddBtn();
        return;
      }

      // Block (paragraph, heading)
      insertLineAfterAndFocus(lineNum, "");
      removeAddBtn();
    });

    // Position the button at the bottom-right of the anchor
    anchor.style.position = "relative";
    anchor.appendChild(addBtn);
  }

  previewPane.addEventListener("mouseover", (e) => {
    const target = e.target as HTMLElement;

    // Table: show on row (via any cell)
    const cell = target.closest<HTMLElement>("td[data-source-line], th[data-source-line]");
    if (cell) {
      // Don't show on header row
      if (cell.tagName === "TH") return;
      const tr = cell.closest("tr");
      const lastCell = tr?.querySelector<HTMLElement>("td[data-source-line]:last-of-type");
      if (lastCell) showAddBtn(lastCell);
      return;
    }

    // List item
    const li = target.closest<HTMLElement>("li[data-source-line]");
    if (li) { showAddBtn(li); return; }

    // Other editable blocks
    const block = target.closest<HTMLElement>("[data-source-line][data-editable]");
    if (block) { showAddBtn(block); return; }
  });

  previewPane.addEventListener("mouseleave", () => {
    removeAddBtn();
  });

  // Remove button when mouse leaves the target area
  previewPane.addEventListener("mouseout", (e) => {
    if (!addBtnTarget) return;
    const related = (e as MouseEvent).relatedTarget as HTMLElement | null;
    if (related && (addBtnTarget.contains(related) || addBtn?.contains(related))) return;
    removeAddBtn();
  });

  /* ── Table context menu: column/row operations ──────────────────── */

  let ctxMenu: HTMLElement | null = null;

  function removeCtxMenu(): void {
    if (ctxMenu) { ctxMenu.remove(); ctxMenu = null; }
  }

  /** Find the contiguous block of lines forming a pipe table starting at startLine. */
  function findTableRange(startLine: number, lines: string[]): { start: number; end: number } | null {
    if (startLine < 0 || startLine >= lines.length) return null;
    if (!lines[startLine]?.trimStart().startsWith("|")) return null;
    let end = startLine;
    while (end + 1 < lines.length && lines[end + 1]?.trimStart().startsWith("|")) end++;
    return { start: startLine, end };
  }

  /** Rewrite the table source: apply `transform` to each row line (including separator). */
  function rewriteTable(tableStart: number, transform: (line: string, rowIdx: number) => string): void {
    const doc = editor.state.doc;
    const lines = doc.toString().split("\n");
    const range = findTableRange(tableStart, lines);
    if (!range) return;

    const newLines: string[] = [];
    for (let i = range.start; i <= range.end; i++) {
      newLines.push(transform(lines[i], i - range.start));
    }
    const fromPos = doc.line(range.start + 1).from;
    const toPos = doc.line(range.end + 1).to;

    editingFromPreview = true;
    editor.dispatch({ changes: { from: fromPos, to: toPos, insert: newLines.join("\n") } });
    requestAnimationFrame(() => {
      editingFromPreview = false;
      onSyncBack();
    });
  }

  /** Insert a cell at cellIdx (1-based inside split-by-| array) into a table row line. */
  function insertCellAt(line: string, cellIdx: number, isSeparator: boolean): string {
    const parts = line.split("|");
    if (parts.length < 3) return line;
    const insertValue = isSeparator ? " --- " : "  ";
    const clampedIdx = Math.max(1, Math.min(cellIdx, parts.length - 1));
    parts.splice(clampedIdx, 0, insertValue);
    return parts.join("|");
  }

  /** Remove the cell at cellIdx from a pipe row. */
  function removeCellAt(line: string, cellIdx: number): string {
    const parts = line.split("|");
    if (cellIdx < 1 || cellIdx >= parts.length - 1) return line;
    parts.splice(cellIdx, 1);
    return parts.join("|");
  }

  type CtxItem = { label: string; action: () => void; danger?: boolean; slot?: "n" | "s" | "e" | "w" };

  function showCtxMenu(x: number, y: number, items: CtxItem[]): void {
    removeCtxMenu();
    const menu = document.createElement("div");
    menu.className = "preview-ctx-menu";

    const compass = document.createElement("div");
    compass.className = "preview-ctx-compass";
    const slots: Record<string, HTMLElement> = {};
    for (const pos of ["n", "w", "c", "e", "s"]) {
      const cell = document.createElement("div");
      cell.className = `preview-ctx-slot preview-ctx-slot-${pos}`;
      compass.appendChild(cell);
      slots[pos] = cell;
    }
    menu.appendChild(compass);

    const makeBtn = (item: CtxItem): HTMLButtonElement => {
      const btn = document.createElement("button");
      btn.className = "preview-ctx-item" + (item.danger ? " danger" : "");
      btn.textContent = item.label;
      btn.addEventListener("click", (ev) => {
        ev.stopPropagation();
        removeCtxMenu();
        item.action();
      });
      return btn;
    };

    const linearItems: CtxItem[] = [];
    for (const item of items) {
      if (item.slot) {
        slots[item.slot].appendChild(makeBtn(item));
      } else {
        linearItems.push(item);
      }
    }
    if (linearItems.length > 0) {
      const sep = document.createElement("div");
      sep.className = "preview-ctx-sep";
      menu.appendChild(sep);
      for (const item of linearItems) menu.appendChild(makeBtn(item));
    }

    // Place off-screen first so we can measure, then clamp to viewport
    menu.style.left = "0px";
    menu.style.top = "0px";
    menu.style.visibility = "hidden";
    document.body.appendChild(menu);
    const rect = menu.getBoundingClientRect();
    const pad = 4;
    const maxX = window.innerWidth - rect.width - pad;
    const maxY = window.innerHeight - rect.height - pad;
    menu.style.left = `${Math.max(pad, Math.min(x, maxX))}px`;
    menu.style.top = `${Math.max(pad, Math.min(y, maxY))}px`;
    menu.style.visibility = "";
    ctxMenu = menu;

    // Dismiss on any click outside
    setTimeout(() => {
      const dismiss = (ev: MouseEvent) => {
        if (!menu.contains(ev.target as Node)) {
          removeCtxMenu();
          document.removeEventListener("mousedown", dismiss, true);
        }
      };
      document.addEventListener("mousedown", dismiss, true);
    }, 0);
  }

  previewPane.addEventListener("contextmenu", (e) => {
    const target = e.target as HTMLElement;
    const cell = target.closest<HTMLElement>("td[data-col-index], th[data-col-index]");
    if (!cell) return;
    e.preventDefault();

    const colIndex = parseInt(cell.dataset.colIndex!, 10);
    if (isNaN(colIndex)) return;
    const cellCellIdx = colIndex + 1;

    // Find table start line via the <table> wrapper
    const table = cell.closest<HTMLElement>("table[data-source-line]");
    if (!table) return;
    const tableStart = parseInt(table.dataset.sourceLine!, 10);
    if (isNaN(tableStart)) return;

    // Row line for delete-row: from the cell's tr
    const cellLine = parseInt(cell.dataset.sourceLine!, 10);
    const isHeaderRow = cell.tagName === "TH";

    const insertRowAt = (targetLine: number): void => {
      const doc = editor.state.doc;
      const lines = doc.toString().split("\n");
      const range = findTableRange(tableStart, lines);
      if (!range) return;
      // Build an empty row with the same pipe-column count as an existing data row
      const templateLine = lines[range.start + 2] ?? lines[range.end];
      const parts = templateLine.split("|");
      const emptyParts = parts.map((p, i) =>
        i === 0 || i === parts.length - 1 ? p : " ".repeat(Math.max(3, p.length))
      );
      const emptyRow = emptyParts.join("|");
      const linePos = doc.line(targetLine + 1);
      editingFromPreview = true;
      editor.dispatch({ changes: { from: linePos.from, to: linePos.from, insert: emptyRow + "\n" } });
      requestAnimationFrame(() => {
        editingFromPreview = false;
        onSyncBack();
      });
    };

    const items: CtxItem[] = [
      {
        slot: "w",
        label: "← 左に列",
        action: () => rewriteTable(tableStart, (line, rowIdx) =>
          insertCellAt(line, cellCellIdx, rowIdx === 1)
        ),
      },
      {
        slot: "e",
        label: "右に列 →",
        action: () => rewriteTable(tableStart, (line, rowIdx) =>
          insertCellAt(line, cellCellIdx + 1, rowIdx === 1)
        ),
      },
    ];

    if (!isNaN(cellLine)) {
      // 上に行: insert above the current cell's line. Skip for header row (can't insert above header).
      if (!isHeaderRow) {
        items.push({
          slot: "n",
          label: "↑ 上に行",
          action: () => insertRowAt(cellLine),
        });
      }
      // 下に行: insert below the current cell's line. For header, insert below separator.
      items.push({
        slot: "s",
        label: "↓ 下に行",
        action: () => insertRowAt(isHeaderRow ? cellLine + 2 : cellLine + 1),
      });
    }

    items.push({
      label: "この列を削除",
      danger: true,
      action: () => rewriteTable(tableStart, (line) => removeCellAt(line, cellCellIdx)),
    });

    if (!isHeaderRow && !isNaN(cellLine)) {
      items.push({
        label: "この行を削除",
        danger: true,
        action: () => {
          const doc = editor.state.doc;
          const line = doc.line(cellLine + 1);
          // Also eat the preceding newline so the surrounding lines collapse cleanly
          const from = line.from > 0 ? line.from - 1 : line.from;
          editingFromPreview = true;
          editor.dispatch({ changes: { from, to: line.to, insert: "" } });
          requestAnimationFrame(() => {
            editingFromPreview = false;
            onSyncBack();
          });
        },
      });
    }

    showCtxMenu(e.clientX, e.clientY, items);
  });

}

/**
 * Rebuild a markdown line by replacing the content while preserving the prefix.
 * e.g. "## Old heading" + "New heading" → "## New heading"
 *      "- list item"   + "new item"    → "- new item"
 *      "> quote"        + "new quote"   → "> new quote"
 */
function rebuildMarkdownLine(oldLine: string, newText: string): string {
  // Heading: # ...
  const headingMatch = oldLine.match(/^(#{1,6}\s+)/);
  if (headingMatch) return headingMatch[1] + newText;

  // Unordered list: - / * / +
  const ulMatch = oldLine.match(/^(\s*[-*+]\s+)/);
  if (ulMatch) return ulMatch[1] + newText;

  // Ordered list: 1. ...
  const olMatch = oldLine.match(/^(\s*\d+\.\s+)/);
  if (olMatch) return olMatch[1] + newText;

  // Blockquote: > ...
  const bqMatch = oldLine.match(/^(\s*>\s*)/);
  if (bqMatch) return bqMatch[1] + newText;

  // Plain paragraph — just replace the whole line
  return newText;
}

/**
 * Replace a single cell in a pipe-delimited markdown table row.
 * e.g. "| Alice | 30 |" with colIndex=1, newCellText="31" → "| Alice | 31 |"
 */
function rebuildTableCell(oldLine: string, colIndex: number, newCellText: string): string {
  // Split by | — e.g. "| A | B |" → ["", " A ", " B ", ""]
  const parts = oldLine.split("|");
  // The actual cell columns are parts[1] .. parts[parts.length-2]
  const cellIdx = colIndex + 1; // offset by the leading empty part
  if (cellIdx < 1 || cellIdx >= parts.length - 1) return oldLine;
  parts[cellIdx] = ` ${newCellText} `;
  return parts.join("|");
}
