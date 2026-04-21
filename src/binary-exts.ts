/** Extensions for binary files that must not be saved as text. */
export const BINARY_EXTS = new Set([
  "png", "jpg", "jpeg", "gif", "webp", "bmp", "ico", "avif",
  "pdf", "docx", "doc", "xlsx", "xls", "pptx", "ppt",
]);

export function getExt(path: string): string {
  const dot = path.lastIndexOf(".");
  return dot >= 0 ? path.slice(dot + 1).toLowerCase() : "";
}

export function isBinaryFile(path: string): boolean {
  return BINARY_EXTS.has(getExt(path));
}
