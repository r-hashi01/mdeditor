import { invoke } from "@tauri-apps/api/core";
import type { EditorView } from "codemirror";

const IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"];

function extensionForMime(mime: string): string {
  switch (mime) {
    case "image/png":
      return "png";
    case "image/jpeg":
      return "jpg";
    case "image/gif":
      return "gif";
    case "image/webp":
      return "webp";
    default:
      return "png";
  }
}

function generateFilename(ext: string): string {
  const ts = Date.now();
  const rand = Math.random().toString(36).slice(2, 8);
  return `img_${ts}_${rand}.${ext}`;
}

async function fileToBase64(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function dirname(filePath: string): string {
  const sep = filePath.includes("\\") ? "\\" : "/";
  const parts = filePath.split(sep);
  parts.pop();
  return parts.join(sep);
}

async function saveAndInsertImage(
  view: EditorView,
  file: File,
  getFilePath: () => string | null,
): Promise<void> {
  const ext = extensionForMime(file.type);
  const filename = generateFilename(ext);
  const filePath = getFilePath();

  let imageDir: string;
  let markdownRef: string;

  if (filePath) {
    // Saved file → images/ subfolder next to the MD file
    const dir = dirname(filePath);
    imageDir = `${dir}/images`;
    markdownRef = `images/${filename}`;
  } else {
    // Untitled file → app-managed temp directory (auto-registered in AllowedDirs)
    const tmpDir: string = await invoke("get_image_temp_dir");
    imageDir = tmpDir;
    markdownRef = `${imageDir}/${filename}`;
  }

  // Ensure the images directory exists and is allowed
  if (filePath) {
    // Saved-file case: images/ subfolder needs explicit allow
    try {
      await invoke("allow_dir", { path: imageDir });
      await invoke("ensure_dir", { path: imageDir });
    } catch {
      const parent = dirname(imageDir);
      await invoke("allow_dir", { path: parent });
      await invoke("ensure_dir", { path: imageDir });
      await invoke("allow_dir", { path: imageDir });
    }
  }
  // Temp dir case: already created and allowed by get_image_temp_dir

  // Convert file to base64 and write
  const base64Data = await fileToBase64(file);
  const fullPath = `${imageDir}/${filename}`;
  await invoke("write_file_binary", { path: fullPath, data: base64Data });

  // Insert markdown image reference at cursor
  const pos = view.state.selection.main.head;
  const insert = `![](${markdownRef})\n`;
  view.dispatch({
    changes: { from: pos, insert },
    selection: { anchor: pos + insert.length },
  });
  view.focus();
}

function getImageFiles(dataTransfer: DataTransfer): File[] {
  const files: File[] = [];
  for (let i = 0; i < dataTransfer.files.length; i++) {
    const f = dataTransfer.files[i];
    if (IMAGE_TYPES.includes(f.type)) {
      files.push(f);
    }
  }
  return files;
}

/**
 * Set up image paste and drag & drop handlers on the editor.
 * Call after editor is created and tabManager is ready.
 */
export function setupImageHandlers(
  view: EditorView,
  getFilePath: () => string | null,
): void {
  const editorDom = view.dom;
  const editorPane = editorDom.closest("#editor-pane") as HTMLElement | null;

  // Paste handler
  editorDom.addEventListener("paste", (e: Event) => {
    const ce = e as ClipboardEvent;
    if (!ce.clipboardData) return;
    const images = getImageFiles(ce.clipboardData);
    if (images.length === 0) return;
    e.preventDefault();
    for (const img of images) {
      saveAndInsertImage(view, img, getFilePath).catch((err) => console.error("Image paste failed:", err));
    }
  });

  // Drag over — visual feedback
  editorDom.addEventListener("dragover", (e: Event) => {
    const de = e as DragEvent;
    if (!de.dataTransfer) return;
    // Check if dragging files
    if (de.dataTransfer.types.includes("Files")) {
      de.preventDefault();
      de.dataTransfer.dropEffect = "copy";
      editorPane?.classList.add("drag-over");
    }
  });

  editorDom.addEventListener("dragleave", (e: Event) => {
    const de = e as DragEvent;
    // Only remove if actually leaving the editor pane
    if (!editorDom.contains(de.relatedTarget as Node)) {
      editorPane?.classList.remove("drag-over");
    }
  });

  // Drop handler
  editorDom.addEventListener("drop", (e: Event) => {
    const de = e as DragEvent;
    editorPane?.classList.remove("drag-over");
    if (!de.dataTransfer) return;
    const images = getImageFiles(de.dataTransfer);
    if (images.length === 0) return;
    de.preventDefault();
    for (const img of images) {
      saveAndInsertImage(view, img, getFilePath).catch((err) => console.error("Image drop failed:", err));
    }
  });
}
