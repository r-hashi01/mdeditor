/**
 * Lightweight file-type predicates and Marp detection.
 * Split out of preview.ts so that consumers (main.ts routing, theme-apply)
 * don't pull the heavy renderer (marked/hljs/DOMPurify) into the main chunk.
 */

const MD_EXTENSIONS = new Set(["md", "markdown"]);
const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp", "bmp", "ico", "avif"]);
const SVG_EXTENSIONS = new Set(["svg"]);
const DRAWIO_EXTENSIONS = new Set(["drawio"]);
const CSV_EXTENSIONS = new Set(["csv", "tsv"]);
const PDF_EXTENSIONS = new Set(["pdf"]);
const DOCX_EXTENSIONS = new Set(["docx", "doc"]);
const HTML_EXTENSIONS = new Set(["html", "htm"]);
const EXTERNAL_ONLY_EXTENSIONS = new Set(["xlsx", "xls", "pptx", "ppt"]);

function getExtension(filePath: string | null): string {
  if (!filePath) return "md";
  const name = filePath.split(/[/\\]/).pop() || "";
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

/** Check if markdown content opts into Marp slide rendering (`marp: true` in frontmatter). */
export function isMarpContent(content: string): boolean {
  const m = content.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!m) return false;
  return /^\s*marp\s*:\s*true\s*$/m.test(m[1]);
}

export {
  MD_EXTENSIONS,
  IMAGE_EXTENSIONS,
  SVG_EXTENSIONS,
  DRAWIO_EXTENSIONS,
  CSV_EXTENSIONS,
  PDF_EXTENSIONS,
  DOCX_EXTENSIONS,
  HTML_EXTENSIONS,
  EXTERNAL_ONLY_EXTENSIONS,
  getExtension,
};
