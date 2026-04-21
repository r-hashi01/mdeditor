import { EditorView } from "codemirror";
import { type EditorState } from "@codemirror/state";
import { ask } from "@tauri-apps/plugin-dialog";
import { basename } from "./path-utils";

/* ── Types ── */

export interface Tab {
  id: string;
  filePath: string | null;
  displayName: string;
  editorState: EditorState;
  savedContent: string;
  isDirty: boolean;
  isBinary: boolean;
}

export interface TabManagerCallbacks {
  /** Called when the active tab changes. */
  onTabSwitch: (tab: Tab) => void;
  /** Called when the last tab is closed. */
  onAllTabsClosed: () => void;
  /** Create a fresh EditorState for a new tab. */
  createEditorState: (content: string) => EditorState;
}

export interface TabManager {
  openFile(filePath: string, content: string, binary?: boolean): void;
  newTab(): void;
  closeTab(tabId: string): Promise<boolean>;
  closeActiveTab(): Promise<boolean>;
  getActiveTab(): Tab | null;
  markSaved(filePath: string, currentContent: string): void;
  updateDirtyState(currentContent: string): void;
  mount(containerEl: HTMLElement): void;
}

/* ── Factory ── */

export function createTabManager(
  editorView: EditorView,
  callbacks: TabManagerCallbacks,
): TabManager {
  const tabs: Tab[] = [];
  let activeTab: Tab | null = null;
  let containerEl: HTMLElement | null = null;
  const closingTabs = new Set<string>(); // Guard against re-entrant closeTab calls

  /* ── DOM rendering ── */

  function renderTabBar(): void {
    if (!containerEl) return;
    containerEl.innerHTML = "";
    for (const tab of tabs) {
      const tabEl = document.createElement("div");
      tabEl.className =
        "tab" +
        (tab === activeTab ? " active" : "") +
        (tab.isDirty ? " dirty" : "");
      tabEl.dataset.tabId = tab.id;
      tabEl.title = tab.filePath || "Untitled";

      const dirty = document.createElement("span");
      dirty.className = "tab-dirty";
      dirty.textContent = "\u25CF";
      tabEl.appendChild(dirty);

      const name = document.createElement("span");
      name.className = "tab-name";
      name.textContent = tab.displayName;
      tabEl.appendChild(name);

      const closeBtn = document.createElement("button");
      closeBtn.className = "tab-close";
      closeBtn.title = "Close";
      closeBtn.textContent = "\u00D7";
      tabEl.appendChild(closeBtn);

      containerEl.appendChild(tabEl);
    }
  }

  function updateSingleTab(tab: Tab): void {
    if (!containerEl) return;
    const el = containerEl.querySelector(
      `.tab[data-tab-id="${tab.id}"]`,
    ) as HTMLElement | null;
    if (!el) return;
    el.classList.toggle("dirty", tab.isDirty);
    el.classList.toggle("active", tab === activeTab);
    const nameEl = el.querySelector(".tab-name") as HTMLElement;
    if (nameEl) nameEl.textContent = tab.displayName;
    el.title = tab.filePath || "Untitled";
  }

  /* ── Tab switching ── */

  function switchToTab(targetTabId: string): void {
    const targetTab = tabs.find((t) => t.id === targetTabId);
    if (!targetTab || targetTab === activeTab) return;

    // Save current tab's state
    if (activeTab) {
      activeTab.editorState = editorView.state;
    }

    // Load target tab's state
    editorView.setState(targetTab.editorState);
    activeTab = targetTab;

    renderTabBar();
    callbacks.onTabSwitch(targetTab);
  }

  /* ── Event handlers (delegation) ── */

  function handleClick(e: MouseEvent): void {
    const target = e.target as HTMLElement;

    // Close button
    const closeBtn = target.closest(".tab-close") as HTMLElement | null;
    if (closeBtn) {
      const tabEl = closeBtn.closest(".tab") as HTMLElement;
      if (tabEl?.dataset.tabId) {
        closeTab(tabEl.dataset.tabId);
      }
      return;
    }

    // Tab click → switch
    const tabEl = target.closest(".tab") as HTMLElement | null;
    if (tabEl?.dataset.tabId) {
      switchToTab(tabEl.dataset.tabId);
    }
  }

  function handleMouseDown(e: MouseEvent): void {
    if (e.button === 1) {
      // Middle-click → close
      e.preventDefault();
      const tabEl = (e.target as HTMLElement).closest(".tab") as HTMLElement | null;
      if (tabEl?.dataset.tabId) {
        closeTab(tabEl.dataset.tabId);
      }
    }
  }

  /* ── Public API ── */

  function mount(el: HTMLElement): void {
    containerEl = el;
    el.addEventListener("click", handleClick);
    el.addEventListener("mousedown", handleMouseDown);
  }

  function openFile(filePath: string, content: string, binary: boolean = false): void {
    // Check for existing tab with same path
    const existing = tabs.find((t) => t.filePath === filePath);
    if (existing) {
      switchToTab(existing.id);
      return;
    }

    // Save current active tab state
    if (activeTab) {
      activeTab.editorState = editorView.state;
    }

    // Create new tab
    const newState = callbacks.createEditorState(content);
    const tab: Tab = {
      id: crypto.randomUUID(),
      filePath,
      displayName: basename(filePath),
      editorState: newState,
      savedContent: content,
      isDirty: false,
      isBinary: binary,
    };
    tabs.push(tab);
    activeTab = tab;
    editorView.setState(newState);

    renderTabBar();
    callbacks.onTabSwitch(tab);
  }

  function newTab(): void {
    // Save current active tab state
    if (activeTab) {
      activeTab.editorState = editorView.state;
    }

    const defaultContent =
      "# Welcome to mdeditor\n\nStart typing Markdown here...\n\n## Features\n\n- **Real-time preview** on the right\n- Syntax highlighting\n- Open/Save files with `Cmd+O` / `Cmd+S`\n\n```js\nconsole.log(\"Hello, mdeditor!\");\n```\n";
    const newState = callbacks.createEditorState(defaultContent);
    const tab: Tab = {
      id: crypto.randomUUID(),
      filePath: null,
      displayName: "Untitled",
      editorState: newState,
      savedContent: defaultContent,
      isDirty: false,
      isBinary: false,
    };
    tabs.push(tab);
    activeTab = tab;
    editorView.setState(newState);

    renderTabBar();
    callbacks.onTabSwitch(tab);
  }

  async function closeTab(tabId: string): Promise<boolean> {
    if (closingTabs.has(tabId)) return false;
    const tab = tabs.find((t) => t.id === tabId);
    if (!tab) return true;
    closingTabs.add(tabId);

    // If closing the active tab, sync its state first
    if (tab === activeTab) {
      tab.editorState = editorView.state;
      tab.isDirty = tab.editorState.doc.toString() !== tab.savedContent;
    }

    if (tab.isDirty) {
      const shouldClose = await ask(
        `"${tab.displayName}" has unsaved changes. Close without saving?`,
        {
          title: "Unsaved Changes",
          okLabel: "Close",
          cancelLabel: "Cancel",
          kind: "warning",
        },
      );
      if (!shouldClose) { closingTabs.delete(tabId); return false; }
    }

    // Remove tab
    const index = tabs.indexOf(tab);
    tabs.splice(index, 1);

    // If closing the active tab, switch to adjacent
    if (tab === activeTab) {
      if (tabs.length === 0) {
        activeTab = null;
        renderTabBar();
        callbacks.onAllTabsClosed();
      } else {
        const newIndex = Math.min(index, tabs.length - 1);
        activeTab = null; // Reset so switchToTab doesn't save stale state
        switchToTab(tabs[newIndex].id);
      }
    } else {
      renderTabBar();
    }

    closingTabs.delete(tabId);
    return true;
  }

  async function closeActiveTab(): Promise<boolean> {
    if (!activeTab) return true;
    return closeTab(activeTab.id);
  }

  function getActiveTab(): Tab | null {
    return activeTab;
  }

  function markSaved(filePath: string, currentContent: string): void {
    if (!activeTab) return;
    activeTab.filePath = filePath;
    activeTab.displayName = basename(filePath);
    activeTab.savedContent = currentContent;
    activeTab.isDirty = false;
    updateSingleTab(activeTab);
  }

  function updateDirtyState(currentContent: string): void {
    if (!activeTab) return;
    const wasDirty = activeTab.isDirty;
    activeTab.isDirty = currentContent !== activeTab.savedContent;
    if (wasDirty !== activeTab.isDirty) {
      updateSingleTab(activeTab);
    }
  }

  return {
    openFile,
    newTab,
    closeTab,
    closeActiveTab,
    getActiveTab,
    markSaved,
    updateDirtyState,
    mount,
  };
}
