import { createEditor, setEditorContent, getEditorContent } from "./editor";
import { renderPreview } from "./preview";
import { openFile, saveFile } from "./fileio";
import "highlight.js/styles/atom-one-dark.css";
import folderOpenIcon from "lucide-static/icons/folder-open.svg?raw";
import saveIcon from "lucide-static/icons/save.svg?raw";

document.getElementById("btn-open")!.innerHTML = folderOpenIcon;
document.getElementById("btn-save")!.innerHTML = saveIcon;

let currentFilePath: string | null = null;
const filenameEl = document.getElementById("filename")!;
const previewPane = document.getElementById("preview-pane")!;

function syncPreviewScroll(ratio: number): void {
  const maxScroll = previewPane.scrollHeight - previewPane.clientHeight;
  if (maxScroll > 0) {
    previewPane.scrollTop = ratio * maxScroll;
  }
}

const editor = createEditor(
  document.getElementById("editor-pane")!,
  (content) => renderPreview(previewPane, content, currentFilePath),
  syncPreviewScroll,
);

renderPreview(previewPane, getEditorContent(editor));

document.getElementById("btn-open")!.addEventListener("click", handleOpen);
document.getElementById("btn-save")!.addEventListener("click", handleSave);

document.addEventListener("keydown", (e) => {
  const mod = e.metaKey || e.ctrlKey;
  if (mod && e.key === "o") {
    e.preventDefault();
    handleOpen();
  }
  if (mod && e.key === "s") {
    e.preventDefault();
    handleSave();
  }
});

async function handleOpen(): Promise<void> {
  const result = await openFile();
  if (!result) return;
  currentFilePath = result.path;
  filenameEl.textContent = basename(result.path);
  setEditorContent(editor, result.content);
  renderPreview(previewPane, result.content, currentFilePath);
}

async function handleSave(): Promise<void> {
  const content = getEditorContent(editor);
  const savedPath = await saveFile(content, currentFilePath);
  if (savedPath) {
    currentFilePath = savedPath;
    filenameEl.textContent = basename(savedPath);
  }
}

function basename(path: string): string {
  return path.split(/[/\\]/).pop() || path;
}
