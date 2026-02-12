import { createEditor, setEditorContent, getEditorContent } from "./editor";
import { renderPreview } from "./preview";
import { openFile, saveFile } from "./fileio";
import { loadSettings, saveSettings, type AppSettings } from "./settings";
import { THEME_PRESETS, getCodemirrorTheme, applyHljsTheme } from "./themes";
import { applySettings } from "./theme-apply";
import { createSettingsModal } from "./settings-modal";
import { checkForUpdates } from "./update-checker";
import folderOpenIcon from "lucide-static/icons/folder-open.svg?raw";
import saveIcon from "lucide-static/icons/save.svg?raw";
import settingsIcon from "lucide-static/icons/settings.svg?raw";

document.getElementById("btn-open")!.innerHTML = folderOpenIcon;
document.getElementById("btn-save")!.innerHTML = saveIcon;
document.getElementById("btn-settings")!.innerHTML = settingsIcon;

let currentFilePath: string | null = null;
const filenameEl = document.getElementById("filename")!;
const previewPane = document.getElementById("preview-pane")!;

/* ── Debounced settings save ── */
let saveTimer: ReturnType<typeof setTimeout> | null = null;
function debouncedSave(settings: AppSettings): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => saveSettings(settings), 400);
}

/* ── Async initialisation ── */
async function init(): Promise<void> {
  const currentSettings = await loadSettings();
  const preset = THEME_PRESETS[currentSettings.theme];

  // Apply HLJS theme before first render
  applyHljsTheme(preset.hljsTheme);

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
    getCodemirrorTheme(preset),
  );

  // Apply all settings (CSS vars, CM font, mermaid, etc.)
  applySettings(currentSettings, editor);
  renderPreview(previewPane, getEditorContent(editor));

  // Settings modal
  const modal = createSettingsModal(currentSettings, (updated) => {
    applySettings(updated, editor);
    renderPreview(previewPane, getEditorContent(editor), currentFilePath);
    debouncedSave(updated);
  });

  document.getElementById("btn-settings")!.addEventListener("click", () => {
    modal.show();
  });

  // File handlers
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

  // Fire-and-forget update check (don't block startup)
  checkForUpdates();
}

function basename(path: string): string {
  return path.split(/[/\\]/).pop() || path;
}

init();
