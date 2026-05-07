/**
 * Export the current preview as a standalone HTML file or PDF.
 *
 * - HTML: snapshot the rendered preview DOM, inline the relevant page
 *   styles + highlight.js + KaTeX CSS, save via the native save dialog.
 * - PDF: open the same standalone HTML in a hidden iframe and call its
 *   `print()` — WebKit's print dialog has a "Save as PDF" affordance on
 *   macOS, and on Windows / Linux the user picks "Microsoft Print to PDF"
 *   or equivalent. We can't bundle a PDF engine without bloating the
 *   binary, so this is the pragmatic baseline.
 */

import { save } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";

export interface ExportDeps {
  /** The preview pane element to snapshot. */
  previewPane: HTMLElement;
  /** Optional title (defaults to active filename, then "Document"). */
  getTitle: () => string;
}

/**
 * Build the standalone HTML body — preview innerHTML wrapped with the page
 * styles needed for it to render correctly outside the app.
 */
export function buildStandaloneHtml(previewInnerHtml: string, title: string): string {
  // Pull the relevant <style> / <link> nodes from the live document so the
  // exported file stays visually faithful (themes, hljs, katex).
  const styleNodes = Array.from(document.querySelectorAll<HTMLStyleElement | HTMLLinkElement>(
    'style, link[rel="stylesheet"]',
  ));
  const inlinedStyles = styleNodes
    .map((node) => {
      if (node instanceof HTMLStyleElement) {
        return `<style>${node.textContent ?? ""}</style>`;
      }
      // <link rel="stylesheet" href="..."> — copy as-is. External hosts
      // (KaTeX CDN etc.) will load when the file is opened.
      return node.outerHTML;
    })
    .join("\n");

  // Use a clean white-on-black-agnostic body so user themes still look ok
  // when the file is opened in any browser. CSS vars from the live page
  // were captured into <style> nodes above, so we just need a wrapper.
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<title>${escapeHtml(title)}</title>
${inlinedStyles}
<style>
  body { margin: 0; background: var(--preview-bg, #fff); color: var(--text-primary, #222); }
  .export-wrap { max-width: 880px; margin: 0 auto; padding: 32px 48px; }
  /* The preview-only chrome (toolbar, sidebar) is intentionally absent. */
</style>
</head>
<body>
<div class="export-wrap" id="preview-pane">
${previewInnerHtml}
</div>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Save the standalone HTML to a path chosen by the user. */
export async function exportHtml(deps: ExportDeps): Promise<void> {
  const html = buildStandaloneHtml(deps.previewPane.innerHTML, deps.getTitle());
  const target = await save({
    title: "Export as HTML",
    defaultPath: `${sanitizeFilename(deps.getTitle())}.html`,
    filters: [{ name: "HTML", extensions: ["html"] }],
  });
  if (!target) return;
  // The path-sandbox needs an explicit allow_path before write_file accepts it.
  await invoke("allow_path", { path: target });
  await invoke("write_file", { path: target, content: html });
}

/**
 * Open the standalone HTML in a hidden iframe and call print() on it.
 * The user picks "Save as PDF" / a real printer in the system dialog.
 */
export function exportPdf(deps: ExportDeps): void {
  const html = buildStandaloneHtml(deps.previewPane.innerHTML, deps.getTitle());
  const iframe = document.createElement("iframe");
  iframe.style.position = "fixed";
  iframe.style.right = "0";
  iframe.style.bottom = "0";
  iframe.style.width = "0";
  iframe.style.height = "0";
  iframe.style.border = "0";
  document.body.appendChild(iframe);
  iframe.srcdoc = html;
  iframe.addEventListener("load", () => {
    // Give styles a tick to settle; print(), then clean up after dialog closes.
    setTimeout(() => {
      try {
        iframe.contentWindow?.focus();
        iframe.contentWindow?.print();
      } finally {
        // Remove a couple seconds later — print() returns immediately on
        // most platforms but the user's "Save as PDF" flow can take
        // longer to open. Keeping the iframe alive briefly avoids a
        // race where the dialog disappears mid-render.
        setTimeout(() => iframe.remove(), 60_000);
      }
    }, 50);
  });
}

function sanitizeFilename(name: string): string {
  // Strip path separators, control chars, leading dots; keep it cross-OS.
  return name.replace(/[\\/:*?"<>|\x00-\x1f]/g, "_").replace(/^\.+/, "").slice(0, 200) || "export";
}
