import { createEditor, getEditorContent, createEditorState, reapplyStyle, setEditorLanguage } from "./editor";
import { renderPreview, isMarpContent, isImageFile, isSvgFile, isHtmlFile, isDrawioFile, isCsvFile, isPdfFile, isDocxFile, isExternalOnlyFile, navigateMarpSlide, resetMarpSlide, setupPreviewEditing } from "./preview";
import { openFile, saveFile } from "./fileio";
import { loadSettings, saveSettings, type AppSettings } from "./settings";
import { THEME_PRESETS, getCodemirrorTheme, applyHljsTheme } from "./themes";
import { applySettings } from "./theme-apply";
import { createSettingsModal } from "./settings-modal";
import { checkForUpdates } from "./update-checker";
import { createFileTree } from "./file-tree";
import { openFolder, reopenFolder, openFileFromTree } from "./folder-io";
import { createTabManager } from "./tab-manager";
import { setupImageHandlers } from "./image-handler";
import { createTableEditor } from "./table-editor";
import { createWelcome, addRecentFolder } from "./welcome";
import { basename } from "./path-utils";
import { createAiPane } from "./ai-pane";
import { undo, redo } from "@codemirror/commands";
import { listen } from "@tauri-apps/api/event";
import { ask } from "@tauri-apps/plugin-dialog";
import folderOpenIcon from "lucide-static/icons/folder-open.svg?raw";
import folderTreeIcon from "lucide-static/icons/folder-tree.svg?raw";
import saveIcon from "lucide-static/icons/save.svg?raw";
import undoIcon from "lucide-static/icons/undo-2.svg?raw";
import redoIcon from "lucide-static/icons/redo-2.svg?raw";
import tableIcon from "lucide-static/icons/table.svg?raw";
import settingsIcon from "lucide-static/icons/settings.svg?raw";
import codeIcon from "lucide-static/icons/code-2.svg?raw";
import columnsIcon from "lucide-static/icons/columns-2.svg?raw";
import eyeIcon from "lucide-static/icons/eye.svg?raw";
import botIcon from "lucide-static/icons/bot.svg?raw";
import panelLeftOpenIcon from "lucide-static/icons/panel-left-open.svg?raw";

document.getElementById("btn-open")!.innerHTML = folderOpenIcon;
document.getElementById("btn-open-folder")!.innerHTML = folderTreeIcon;
document.getElementById("btn-save")!.innerHTML = saveIcon;
document.getElementById("btn-undo")!.innerHTML = undoIcon;
document.getElementById("btn-redo")!.innerHTML = redoIcon;
document.getElementById("btn-table")!.innerHTML = tableIcon;
document.getElementById("btn-settings")!.innerHTML = settingsIcon;
document.getElementById("btn-view-code")!.innerHTML = codeIcon;
document.getElementById("btn-view-split")!.innerHTML = columnsIcon;
document.getElementById("btn-view-preview")!.innerHTML = eyeIcon;
document.getElementById("btn-ai-pane")!.innerHTML = botIcon;

const filenameEl = document.getElementById("filename")!;
const previewPane = document.getElementById("preview-pane")!;
const container = document.getElementById("container")!;

/* ── View mode (code / split / preview) ── */
type ViewMode = "code" | "split" | "preview";
let currentViewMode: ViewMode = "split";
let markdownViewMode: ViewMode = "split"; // user's preferred mode for markdown files

const MARKDOWN_EXTS = new Set(["md", "markdown"]);
function isMarkdownFile(path: string | null): boolean {
  if (!path) return true; // untitled → treat as markdown
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return MARKDOWN_EXTS.has(ext);
}

const viewModeGroup = document.querySelector<HTMLElement>(".view-mode-group")!;

function setViewMode(mode: ViewMode): void {
  currentViewMode = mode;
  container.dataset.viewMode = mode;
  document.querySelectorAll(".view-mode-group button").forEach((btn) => {
    btn.classList.toggle("active", btn.id === `btn-view-${mode}`);
  });
}

function applyViewModeForFile(path: string | null): void {
  if (isImageFile(path) || isDrawioFile(path) || isPdfFile(path) || isDocxFile(path) || isExternalOnlyFile(path)) {
    setViewMode("preview");
    viewModeGroup.classList.add("disabled");
  } else if (isSvgFile(path) || isCsvFile(path) || isHtmlFile(path)) {
    // SVG / CSV / HTML: default to preview, allow switching views
    setViewMode("preview");
    viewModeGroup.classList.remove("disabled");
  } else if (isMarkdownFile(path)) {
    setViewMode(markdownViewMode);
    viewModeGroup.classList.remove("disabled");
  } else {
    setViewMode("code");
    viewModeGroup.classList.add("disabled");
  }
}

document.getElementById("btn-view-code")!.addEventListener("click", () => {
  setViewMode("code");
  markdownViewMode = "code";
});
document.getElementById("btn-view-split")!.addEventListener("click", () => {
  setViewMode("split");
  markdownViewMode = "split";
});
document.getElementById("btn-view-preview")!.addEventListener("click", () => {
  setViewMode("preview");
  markdownViewMode = "preview";
});

/* ── Debounced settings save ── */
let saveTimer: ReturnType<typeof setTimeout> | null = null;
function debouncedSave(settings: AppSettings): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => saveSettings(settings), 400);
}

/* ── Async initialisation ── */
async function init(): Promise<void> {
  let currentSettings = await loadSettings();
  const preset = THEME_PRESETS[currentSettings.theme];

  // Apply HLJS theme before first render
  applyHljsTheme(preset.hljsTheme);

  // Bidirectional scroll sync: whichever pane the user last interacted with
  // is the "source" — the other follows. Avoids feedback loops without locks.
  type ScrollSource = "preview" | "editor" | null;
  let scrollSource: ScrollSource = null;

  function markSource(src: ScrollSource): void {
    scrollSource = src;
  }

  function syncPreviewScroll(ratio: number): void {
    // Only sync editor → preview when editor is the active source.
    if (scrollSource !== "editor") return;
    const maxScroll = previewPane.scrollHeight - previewPane.clientHeight;
    if (maxScroll > 0) previewPane.scrollTop = ratio * maxScroll;
  }

  const editor = createEditor(
    document.getElementById("editor-pane")!,
    (content) => {
      // On every doc change: update preview + dirty state
      const activeTab = tabManager.getActiveTab();
      renderPreview(previewPane, content, activeTab?.filePath ?? null, currentSettings.showToc);
      tabManager.updateDirtyState(content);
    },
    syncPreviewScroll,
    getCodemirrorTheme(preset),
  );

  // Apply all settings (CSS vars, CM font, mermaid, etc.)
  applySettings(currentSettings, editor);

  // Prefetch heavy preview deps during idle so the first mermaid / docx render
  // has no perceptible delay. Errors are swallowed — this is best-effort only.
  const idle = (window as Window & { requestIdleCallback?: (cb: () => void) => void }).requestIdleCallback
    ?? ((cb: () => void) => setTimeout(cb, 1500));
  idle(() => { void import("mermaid").catch(() => {}); });
  idle(() => { void import("mammoth").catch(() => {}); });

  // ── Status bar ──
  const statusCursor = document.getElementById("status-cursor")!;
  const statusFiletype = document.getElementById("status-filetype")!;

  function updateStatusCursor(): void {
    const pos = editor.state.selection.main.head;
    const line = editor.state.doc.lineAt(pos);
    const col = pos - line.from + 1;
    statusCursor.textContent = `${line.number}:${col}`;
  }
  editor.dom.addEventListener("keyup", updateStatusCursor);
  editor.dom.addEventListener("mouseup", updateStatusCursor);

  function updateStatusFiletype(filePath: string | null): void {
    if (!filePath) { statusFiletype.textContent = "Markdown"; return; }
    const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
    const map: Record<string, string> = {
      md: "Markdown", markdown: "Markdown",
      json: "JSON", js: "JavaScript", ts: "TypeScript",
      html: "HTML", css: "CSS", yaml: "YAML", yml: "YAML",
      py: "Python", rs: "Rust", go: "Go", sh: "Shell",
      csv: "CSV", tsv: "TSV", svg: "SVG", xml: "XML",
      txt: "Plain Text", drawio: "draw.io", pdf: "PDF",
    };
    statusFiletype.textContent = map[ext] || ext.toUpperCase() || "Markdown";
  }

  // ── File tree sidebar (must be created before tabManager so callbacks can reference it) ──
  const sidebar = document.getElementById("sidebar")!;
  const folderBtn = document.getElementById("btn-open-folder")!;
  const aiPaneBtn = document.getElementById("btn-ai-pane")!;
  let currentFolderPath: string | null = null;

  // ── AI pane (Claude Code / Codex in a PTY) ──
  const aiPane = createAiPane({
    pane: document.getElementById("ai-pane")!,
    divider: document.getElementById("ai-divider")!,
    initialCwd: null,
    getEditorSelection: () => {
      const { from, to } = editor.state.selection.main;
      return editor.state.sliceDoc(from, to);
    },
    getCurrentFilePath: () => tabManager?.getActiveTab()?.filePath ?? null,
  });
  aiPaneBtn.addEventListener("click", () => {
    const visible = aiPane.toggle();
    aiPaneBtn.classList.toggle("active", visible);
  });

  // fileTree is created early but its onFileSelect callback references tabManager.
  // Both are defined inside init(), so by the time the callback actually runs
  // (user clicks a file), tabManager is already initialised.
  const fileTree = createFileTree(
    async (filePath: string) => {
      const result = await openFileFromTree(filePath);
      tabManager.openFile(result.path, result.content, result.binary);
      fileTree.setSelectedFile(filePath);
    },
    () => {
      fileTree.toggle();
      folderBtn.classList.toggle("active", fileTree.isVisible());
    },
  );
  fileTree.mount(sidebar);

  // ── Tab Manager ──
  const tabManager = createTabManager(editor, {
    onTabSwitch: (tab) => {
      hideWelcome();
      // Switch language + re-apply theme/font after state swap
      setEditorLanguage(editor, tab.filePath);
      reapplyStyle(editor);
      // Reset Marp slide index when switching tabs
      resetMarpSlide();
      // Auto-switch view mode based on file type
      applyViewModeForFile(tab.filePath);
      // Update preview (only meaningful for markdown, but harmless for others)
      const content = tab.editorState.doc.toString();
      renderPreview(previewPane, content, tab.filePath, currentSettings.showToc);
      // Update filename + status bar
      filenameEl.textContent = tab.filePath ? basename(tab.filePath) : "Untitled";
      updateStatusFiletype(tab.filePath);
      updateStatusCursor();
      // Update file tree selection
      if (tab.filePath) {
        fileTree.setSelectedFile(tab.filePath);
      } else {
        fileTree.setSelectedFile(null);
      }
    },
    onAllTabsClosed: () => {
      // Clear stale editor content when all tabs are closed, but stay in
      // the editor view — don't bounce back to the welcome screen. Also
      // collapse the empty preview pane by switching to code-only view.
      editor.dispatch({
        changes: { from: 0, to: editor.state.doc.length, insert: "" },
      });
      setViewMode("code");
      viewModeGroup.classList.add("disabled");
    },
    createEditorState: (content: string) => createEditorState(content),
  });

  tabManager.mount(document.getElementById("tab-bar")!);

  // Image paste / drag & drop
  setupImageHandlers(editor, () => tabManager.getActiveTab()?.filePath ?? null);

  // Mark the active scroll source whenever the user interacts with a pane.
  // wheel + pointerdown + keydown cover mouse, trackpad, and keyboard scrolling.
  const markPreview = (): void => markSource("preview");
  const markEditor = (): void => markSource("editor");
  previewPane.addEventListener("wheel", markPreview, { passive: true });
  previewPane.addEventListener("pointerdown", markPreview, { passive: true });
  editor.scrollDOM.addEventListener("wheel", markEditor, { passive: true });
  editor.scrollDOM.addEventListener("pointerdown", markEditor, { passive: true });
  // Keyboard scroll (arrows / pageup / pagedown) in editor
  editor.scrollDOM.addEventListener("keydown", markEditor);

  // Preview → editor scroll sync (anchor-interpolated to avoid jitter at
  // block boundaries where preview and editor have different heights).
  previewPane.addEventListener("scroll", () => {
    if (scrollSource !== "preview") return;
    if (document.getElementById("container")?.dataset.viewMode === "preview") return;
    const paneRect = previewPane.getBoundingClientRect();
    const anchors = previewPane.querySelectorAll<HTMLElement>("[data-source-line]");
    let above: { lineNum: number; top: number } | null = null;
    let below: { lineNum: number; top: number } | null = null;
    for (const el of anchors) {
      const lineNum = parseInt(el.dataset.sourceLine!, 10);
      if (isNaN(lineNum) || lineNum < 0) continue;
      const top = el.getBoundingClientRect().top - paneRect.top;
      if (top <= 0) {
        above = { lineNum, top };
      } else {
        below = { lineNum, top };
        break;
      }
    }
    const doc = editor.state.doc;
    const scroller = editor.scrollDOM;
    // Map a source line + its preview-pane top offset → editor scrollTop
    // such that the corresponding editor line sits at that same offset.
    const targetFor = (a: { lineNum: number; top: number }): number | null => {
      const line = Math.max(1, Math.min(doc.lines, a.lineNum + 1));
      const block = editor.lineBlockAt(doc.line(line).from);
      return block.top - a.top;
    };
    const aTarget = above ? targetFor(above) : null;
    const bTarget = below ? targetFor(below) : null;
    let target: number | null = null;
    if (aTarget !== null && bTarget !== null && above && below) {
      const span = below.top - above.top;
      const f = span > 0 ? (0 - above.top) / span : 0;
      target = aTarget + f * (bTarget - aTarget);
    } else if (aTarget !== null) {
      target = aTarget;
    } else if (bTarget !== null) {
      target = bTarget;
    }
    if (target === null) return;
    const clamped = Math.max(0, Math.min(target, scroller.scrollHeight - scroller.clientHeight));
    if (Math.abs(scroller.scrollTop - clamped) < 1) return;
    scroller.scrollTop = clamped;
  }, { passive: true });

  /* ── Pane resize: sidebar-divider and editor/preview divider ──────── */
  const sidebarEl = document.getElementById("sidebar")!;
  const editorPaneEl = document.getElementById("editor-pane")!;
  const sidebarDivider = document.getElementById("sidebar-divider")!;
  const mainDivider = document.getElementById("divider")!;

  // Restore persisted widths
  const savedSidebarWidth = localStorage.getItem("paneWidth.sidebar");
  if (savedSidebarWidth) sidebarEl.style.width = `${parseInt(savedSidebarWidth, 10)}px`;
  const savedEditorWidth = localStorage.getItem("paneWidth.editor");
  if (savedEditorWidth) {
    editorPaneEl.style.flex = `0 0 ${parseInt(savedEditorWidth, 10)}px`;
  }

  function attachResizer(
    divider: HTMLElement,
    target: HTMLElement,
    opts: { min: number; max: number; storageKey: string; mode: "width" | "flex-basis" },
  ): void {
    let dragging = false;
    let startX = 0;
    let startWidth = 0;
    divider.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      dragging = true;
      startX = e.clientX;
      startWidth = target.getBoundingClientRect().width;
      divider.setPointerCapture(e.pointerId);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    });
    // Suppress the click that fires after pointerup if we just dragged.
    divider.addEventListener("click", (e) => {
      e.stopPropagation();
      e.preventDefault();
    });
    divider.addEventListener("pointermove", (e) => {
      if (!dragging) return;
      const delta = e.clientX - startX;
      const newWidth = Math.max(opts.min, Math.min(opts.max, startWidth + delta));
      if (opts.mode === "width") {
        target.style.width = `${newWidth}px`;
      } else {
        target.style.flex = `0 0 ${newWidth}px`;
      }
    });
    divider.addEventListener("pointerup", (e) => {
      if (!dragging) return;
      dragging = false;
      divider.releasePointerCapture(e.pointerId);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      localStorage.setItem(opts.storageKey, String(Math.round(target.getBoundingClientRect().width)));
    });
    // Double-click resets to default
    divider.addEventListener("dblclick", () => {
      if (opts.mode === "width") target.style.width = "";
      else target.style.flex = "";
      localStorage.removeItem(opts.storageKey);
    });
  }

  attachResizer(sidebarDivider, sidebarEl, {
    min: 140, max: 500, storageKey: "paneWidth.sidebar", mode: "width",
  });
  attachResizer(mainDivider, editorPaneEl, {
    min: 240, max: 2000, storageKey: "paneWidth.editor", mode: "flex-basis",
  });

  // ── Status-bar button to reopen sidebar ──
  const sidebarEdge = document.getElementById("sidebar-edge")!;
  sidebarEdge.innerHTML = panelLeftOpenIcon;
  sidebarEdge.addEventListener("click", () => {
    if (fileTree.isVisible()) return;
    fileTree.toggle();
    folderBtn.classList.toggle("active", fileTree.isVisible());
  });

  // ── Preview editing: click-to-navigate + contenteditable sync-back ──
  setupPreviewEditing(previewPane, editor, () => {
    const content = getEditorContent(editor);
    tabManager.updateDirtyState(content);
    // Force a re-render — the editor updateListener's render was suppressed
    // during the dispatch to avoid clobbering the in-flight contenteditable DOM.
    renderPreview(previewPane, content, tabManager.getActiveTab()?.filePath ?? null, currentSettings.showToc);
  });

  // Settings modal
  const modal = createSettingsModal(
    currentSettings,
    (updated) => {
      currentSettings = updated;
      applySettings(updated, editor);
      renderPreview(previewPane, getEditorContent(editor), tabManager.getActiveTab()?.filePath ?? null, updated.showToc);
      debouncedSave(updated);
    },
    () => checkForUpdates(),
  );

  document.getElementById("btn-settings")!.addEventListener("click", () => {
    modal.show();
  });

  // Table editor modal
  const tableEditor = createTableEditor((markdown: string) => {
    const pos = editor.state.selection.main.head;
    editor.dispatch({
      changes: { from: pos, insert: markdown },
      selection: { anchor: pos + markdown.length },
    });
    editor.focus();
  });

  document.getElementById("btn-table")!.addEventListener("click", () => {
    tableEditor.show();
  });

  // ── File & folder handlers ──
  async function handleOpen(): Promise<void> {
    try {
      const result = await openFile();
      if (!result) return;
      tabManager.openFile(result.path, result.content, result.binary);
      if (currentFolderPath && result.path.startsWith(currentFolderPath)) {
        fileTree.setSelectedFile(result.path);
      }
    } catch (e) {
      console.error("Open file failed:", e);
    }
  }

  async function handleOpenFolder(): Promise<void> {
    try {
      const folder = await openFolder();
      if (!folder) return;
      hideWelcome();
      currentFolderPath = folder;
      await fileTree.openFolder(folder);
      folderBtn.classList.add("active");
      aiPane.setCwd(folder);
      // Persist to recent folders
      currentSettings.recentFolders = addRecentFolder(currentSettings.recentFolders, folder);
      currentSettings.lastOpenedFolder = folder;
      debouncedSave(currentSettings);
    } catch (e) {
      console.error("Open folder failed:", e);
    }
  }

  async function handleOpenRecent(folder: string): Promise<void> {
    const ok = await reopenFolder(folder);
    if (!ok) {
      // Ask before removing — the folder may just be temporarily unavailable
      const remove = await ask(
        `Could not open folder "${folder.split(/[/\\]/).pop()}".\nThe path may not exist or is inaccessible.\n\nRemove from recent projects?`,
        { title: "Cannot Open Folder", kind: "warning" },
      );
      if (remove) {
        currentSettings.recentFolders = currentSettings.recentFolders.filter((f) => f !== folder);
        debouncedSave(currentSettings);
      }
      showWelcome();
      return;
    }
    hideWelcome();
    currentFolderPath = folder;
    await fileTree.openFolder(folder);
    folderBtn.classList.add("active");
    aiPane.setCwd(folder);
    currentSettings.recentFolders = addRecentFolder(currentSettings.recentFolders, folder);
    currentSettings.lastOpenedFolder = folder;
    debouncedSave(currentSettings);
  }

  async function handleSave(): Promise<void> {
    const activeTab = tabManager.getActiveTab();
    if (!activeTab) return;
    // Never save binary files through the text editor — this would corrupt them
    if (activeTab.isBinary) return;
    const content = getEditorContent(editor);
    const savedPath = await saveFile(content, activeTab.filePath);
    if (savedPath) {
      tabManager.markSaved(savedPath, content);
      filenameEl.textContent = basename(savedPath);
    }
  }

  // ── Welcome screen ──
  let welcomeVisible = false;

  const welcome = createWelcome({
    onNewFile: () => tabManager.newTab(),
    onOpenFile: () => handleOpen(),
    onOpenFolder: () => handleOpenFolder(),
    onOpenRecent: (folder) => handleOpenRecent(folder),
  });

  const containerEl = document.getElementById("container")!;

  function showWelcome(): void {
    filenameEl.textContent = "";
    renderPreview(previewPane, "", null, false);
    welcome.show(currentSettings.recentFolders);
    welcomeVisible = true;
    containerEl.dataset.noContent = "true";
  }

  function hideWelcome(): void {
    welcome.hide();
    welcomeVisible = false;
    delete containerEl.dataset.noContent;
  }

  // Show welcome on startup
  showWelcome();

  // ── Toolbar handlers ──
  folderBtn.addEventListener("click", handleOpenFolder);
  document.getElementById("btn-open")!.addEventListener("click", handleOpen);
  document.getElementById("btn-save")!.addEventListener("click", handleSave);
  document.getElementById("btn-undo")!.addEventListener("click", () => {
    undo(editor);
    editor.focus();
  });
  document.getElementById("btn-redo")!.addEventListener("click", () => {
    redo(editor);
    editor.focus();
  });

  document.addEventListener("keydown", (e) => {
    const mod = e.metaKey || e.ctrlKey;
    // Cmd/Ctrl+Z (undo) and Cmd+Shift+Z / Cmd+Y (redo) — forward to CodeMirror
    // when focus is outside the editor (e.g. right after a preview context-menu edit).
    if (mod && (e.key === "z" || e.key === "Z" || e.key === "y")) {
      const editorFocused = document.activeElement?.closest(".cm-editor") != null;
      const inTextField = document.activeElement instanceof HTMLInputElement
        || document.activeElement instanceof HTMLTextAreaElement
        || (document.activeElement as HTMLElement | null)?.isContentEditable;
      if (!editorFocused && !inTextField) {
        e.preventDefault();
        const isRedo = e.key === "y" || (e.shiftKey && (e.key === "z" || e.key === "Z"));
        if (isRedo) redo(editor); else undo(editor);
        editor.focus();
        return;
      }
    }
    if (mod && e.key === "n") {
      e.preventDefault();
      tabManager.newTab();
    }
    if (mod && e.key === "o") {
      e.preventDefault();
      handleOpen();
    }
    if (mod && e.key === "s") {
      e.preventDefault();
      handleSave();
    }
    if (mod && e.key === "w") {
      e.preventDefault();
      tabManager.closeActiveTab();
    }
    if (mod && e.key === "b") {
      e.preventDefault();
      fileTree.toggle();
      folderBtn.classList.toggle("active", fileTree.isVisible());
    }
    if (mod && e.key === "j") {
      e.preventDefault();
      const visible = aiPane.toggle();
      aiPaneBtn.classList.toggle("active", visible);
    }
    // On welcome screen: Cmd+1-9 opens recent projects
    if (mod && welcomeVisible && e.key >= "1" && e.key <= "9") {
      const idx = parseInt(e.key, 10) - 1;
      if (idx < currentSettings.recentFolders.length) {
        e.preventDefault();
        handleOpenRecent(currentSettings.recentFolders[idx]);
        return;
      }
    }
    // View mode: Cmd/Ctrl + 1/2/3 (only when view mode switching is allowed)
    if (mod && !viewModeGroup.classList.contains("disabled")) {
      if (e.key === "1") { e.preventDefault(); setViewMode("code"); markdownViewMode = "code"; }
      if (e.key === "2") { e.preventDefault(); setViewMode("split"); markdownViewMode = "split"; }
      if (e.key === "3") { e.preventDefault(); setViewMode("preview"); markdownViewMode = "preview"; }
    }
    // Marp / HTML preview navigation: Arrow keys
    // Works in preview mode always, in split mode when editor is not focused, or with Cmd/Ctrl modifier
    if (e.key === "ArrowLeft" || e.key === "ArrowRight" || e.key === "ArrowUp" || e.key === "ArrowDown") {
      const activeTab = tabManager.getActiveTab();
      const inPreview = currentViewMode === "preview" || currentViewMode === "split";
      const editorFocused = document.activeElement?.closest(".cm-editor") != null;
      const canNavigate = mod || (inPreview && !editorFocused);
      if (activeTab && canNavigate) {
        const content = activeTab.editorState.doc.toString();
        if (isMarpContent(content)) {
          const dir = (e.key === "ArrowLeft" || e.key === "ArrowUp") ? "prev" : "next";
          e.preventDefault();
          navigateMarpSlide(previewPane, dir);
        } else if (isHtmlFile(activeTab.filePath) && inPreview) {
          const iframe = previewPane.querySelector<HTMLIFrameElement>(".html-preview-frame");
          if (iframe?.contentWindow) {
            e.preventDefault();
            const vertical = e.key === "ArrowUp" || e.key === "ArrowDown";
            const amount = (e.key === "ArrowUp" || e.key === "ArrowLeft") ? -200 : 200;
            iframe.contentWindow.scrollBy({
              top: vertical ? amount : 0,
              left: vertical ? 0 : amount,
              behavior: "smooth",
            });
          }
        }
        // No handler matched — let the event propagate normally
      }
    }
  });

  // Menu bar event: Check for Updates (manual → show result)
  listen("menu-check-updates", () => checkForUpdates(false));

  // Fire-and-forget update check (silent — don't block startup)
  checkForUpdates(true);
}

init();
