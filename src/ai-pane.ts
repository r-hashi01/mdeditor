/**
 * AI pane — chat interface powered by ACP (Agent Client Protocol).
 * Communicates with Claude Code via the claude-agent-acp adapter,
 * getting real model lists, slash commands, and streaming responses.
 */

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { Marked } from "marked";
import hljs from "highlight.js/lib/core";
import DOMPurify from "dompurify";
import { escapeHtml } from "./html-utils";
import plusIcon from "lucide-static/icons/plus.svg?raw";
import historyIcon from "lucide-static/icons/clock.svg?raw";
import xIcon from "lucide-static/icons/x.svg?raw";
import paperclipIcon from "lucide-static/icons/paperclip.svg?raw";
import chevronDownIcon from "lucide-static/icons/chevron-down.svg?raw";
import fileIcon from "lucide-static/icons/file.svg?raw";
import codeIcon from "lucide-static/icons/code.svg?raw";
import messageIcon from "lucide-static/icons/message-circle.svg?raw";
import listIcon from "lucide-static/icons/list.svg?raw";
import imageIcon from "lucide-static/icons/image.svg?raw";
import cursorIcon from "lucide-static/icons/text-cursor.svg?raw";
import branchIcon from "lucide-static/icons/git-branch.svg?raw";
import claudeIcon from "./icons/ai_claude.svg?raw";
import openaiIcon from "./icons/ai_open_ai.svg?raw";

export interface AiPaneController {
  toggle(): boolean;
  isVisible(): boolean;
  setCwd(cwd: string | null): void;
}

interface Options {
  pane: HTMLElement;
  divider: HTMLElement;
  initialCwd: string | null;
  /** Return the current editor selection text (empty string if none). */
  getEditorSelection?: () => string;
  /** Return the path of the file currently open in the editor. */
  getCurrentFilePath?: () => string | null;
}

/* ── Types from ACP ────────────────────────────────────────────────── */

interface AcpModel {
  modelId: string;
  name: string;
  description?: string;
}

interface AcpConfigOption {
  type: "select" | "boolean";
  id: string;
  name: string;
  description?: string;
  category?: string;
  currentValue: string | boolean;
  options?: Array<AcpConfigSelectOption | AcpConfigSelectGroup>;
}

interface AcpConfigSelectOption {
  value: string;
  name: string;
  description?: string;
}

interface AcpConfigSelectGroup {
  group: string;
  name: string;
  options: AcpConfigSelectOption[];
}

interface AcpCommand {
  name: string;
  description: string;
  input?: { hint: string };
}

interface AcpSessionInfo {
  sessionId: string;
  cwd: string;
  title?: string;
  updatedAt?: string;
}

type AiToolId = "claude" | "codex";

interface AiToolOption {
  id: AiToolId;
  label: string;
  icon: string;
}

/* ── Markdown renderer ──────────────────────────────────────────────── */

const marked = new Marked({
  renderer: {
    code({ text, lang }: { text: string; lang?: string }) {
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
  gfm: true,
  breaks: true,
});

function renderMd(text: string): string {
  return DOMPurify.sanitize(marked.parse(text) as string);
}

const AI_TOOL_OPTIONS: AiToolOption[] = [
  { id: "claude", label: "Claude", icon: claudeIcon },
  { id: "codex", label: "Codex", icon: openaiIcon },
];

export function createAiPane(opts: Options): AiPaneController {
  const { pane, divider } = opts;
  let _cwd: string | null = opts.initialCwd;

  // ── Persistence keys ──
  const STORAGE_KEY_TOOL = "ai-pane:tool";
  const STORAGE_KEY_MODEL = "ai-pane:model";

  function loadCached<T>(key: string, fallback: T): T {
    try {
      const v = localStorage.getItem(key);
      return v != null ? JSON.parse(v) : fallback;
    } catch { return fallback; }
  }
  function saveCache(key: string, value: unknown): void {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
  }

  // ── ACP State ──
  let acpInitialized = false;
  let acpInitializing: Promise<void> | null = null;
  let acpSessionId: string | null = null;
  let isGenerating = false;
  let streamingText = "";
  let showingHistory = false;
  let unlistenUpdate: UnlistenFn | null = null;
  let currentTool: AiToolId = loadCached(STORAGE_KEY_TOOL, "claude" as AiToolId);

  // Dynamic data from ACP
  let availableModels: AcpModel[] = [];
  let currentModelId = "";
  let cachedModelId: string = loadCached(STORAGE_KEY_MODEL, "");
  let configOptions: AcpConfigOption[] = [];
  let availableCommands: AcpCommand[] = [];

  // Slash menu
  let slashMenuVisible = false;
  let slashMenuIndex = 0;
  let filteredCommands: AcpCommand[] = [];

  /* ── DOM scaffold ───────────────────────────────────────────────── */

  pane.innerHTML = `
    <div class="ai-pane-loading-screen">
      <div class="ai-pane-loading-header">
        <span class="ai-loading-spinner"></span>
        <span class="ai-loading-header-text">Loading...</span>
      </div>
      <div class="ai-pane-loading-body">Loading...</div>
    </div>
    <div class="ai-pane-ready" style="display:none">
      <div class="ai-pane-header">
        <button class="ai-tool-selector">
          <span class="ai-tool-icon">${claudeIcon}</span>
          <span class="ai-tool-label">Claude</span>
          <span class="ai-tool-chevron">${chevronDownIcon}</span>
        </button>
        <button class="ai-model-selector" title="Switch Model">
          <span class="ai-model-label">...</span>
          <span class="ai-model-chevron">${chevronDownIcon}</span>
        </button>
        <div class="ai-pane-actions">
          <button class="ai-action" data-action="history" title="Session History">${historyIcon}</button>
          <button class="ai-action" data-action="new" title="New Chat">${plusIcon}</button>
          <button class="ai-action" data-action="close-pane" title="Close (⌘J)">${xIcon}</button>
        </div>
      </div>
      <div class="ai-tool-dropdown" style="display:none"></div>
      <div class="ai-model-dropdown" style="display:none"></div>
      <div class="ai-session-list" style="display:none"></div>
      <div class="ai-chat-messages">
        <div class="ai-chat-empty">Type a message to start chatting with AI<br><span class="ai-chat-hint">Type / to see available commands</span></div>
      </div>
      <div class="ai-chat-input-area">
        <div class="ai-slash-menu" style="display:none"></div>
        <div class="ai-context-chips" style="display:none"></div>
        <div class="ai-chat-input-row">
          <textarea class="ai-chat-input" placeholder="Type a message... (/ for commands)" rows="1"></textarea>
          <button class="ai-chat-attach" title="Attach file as context">${paperclipIcon}</button>
          <button class="ai-chat-send" title="Send (Enter)">↑</button>
        </div>
      </div>
    </div>
  `;

  const loadingScreen = pane.querySelector<HTMLElement>(".ai-pane-loading-screen")!;
  const loadingHeaderText = pane.querySelector<HTMLElement>(".ai-loading-header-text")!;
  const loadingBody = pane.querySelector<HTMLElement>(".ai-pane-loading-body")!;
  const readyScreen = pane.querySelector<HTMLElement>(".ai-pane-ready")!;
  const sessionListEl = pane.querySelector<HTMLElement>(".ai-session-list")!;
  const messagesEl = pane.querySelector<HTMLElement>(".ai-chat-messages")!;
  const emptyEl = pane.querySelector<HTMLElement>(".ai-chat-empty")!;
  const emptyHintEl = pane.querySelector<HTMLElement>(".ai-chat-hint")!;
  const inputEl = pane.querySelector<HTMLTextAreaElement>(".ai-chat-input")!;
  const sendBtn = pane.querySelector<HTMLButtonElement>(".ai-chat-send")!;
  const attachBtn = pane.querySelector<HTMLButtonElement>(".ai-chat-attach")!;
  const chipsEl = pane.querySelector<HTMLElement>(".ai-context-chips")!;
  const slashMenuEl = pane.querySelector<HTMLElement>(".ai-slash-menu")!;
  const toolIconEl = pane.querySelector<HTMLElement>(".ai-tool-icon")!;
  const toolLabelEl = pane.querySelector<HTMLElement>(".ai-tool-label")!;
  const toolDropdown = pane.querySelector<HTMLElement>(".ai-tool-dropdown")!;
  const modelLabel = pane.querySelector<HTMLElement>(".ai-model-label")!;
  const modelDropdown = pane.querySelector<HTMLElement>(".ai-model-dropdown")!;
  updateToolUI();

  /* ── Loading screen (Zed-style) ────────────────────────────────── */

  function setInputLocked(locked: boolean, msg?: string): void {
    if (locked) {
      const text = msg || "Loading...";
      loadingHeaderText.textContent = text;
      loadingBody.textContent = text;
      loadingScreen.style.display = "";
      readyScreen.style.display = "none";
    } else {
      loadingScreen.style.display = "none";
      readyScreen.style.display = "";
    }
  }

  /* ── Auto-resize textarea ──────────────────────────────────────── */

  function autoResize(): void {
    inputEl.style.height = "auto";
    inputEl.style.height = Math.min(inputEl.scrollHeight, 120) + "px";
  }
  inputEl.addEventListener("input", autoResize);

  /* ── Context attachments ───────────────────────────────────────── */

  type ContextItem =
    | { kind: "file"; path: string }
    | { kind: "image"; path: string }
    | { kind: "selection"; label: string; content: string }
    | { kind: "rules"; path: string };

  const contextItems: ContextItem[] = [];

  function basename(p: string): string {
    return p.split(/[/\\]/).pop() || p;
  }

  function chipLabel(item: ContextItem): string {
    switch (item.kind) {
      case "file":
      case "image":
      case "rules":
        return basename(item.path);
      case "selection":
        return item.label;
    }
  }

  function chipTitle(item: ContextItem): string {
    switch (item.kind) {
      case "file":
      case "image":
      case "rules":
        return item.path;
      case "selection":
        return item.content.slice(0, 200);
    }
  }

  function renderChips(): void {
    if (contextItems.length === 0) {
      chipsEl.style.display = "none";
      chipsEl.replaceChildren();
      return;
    }
    chipsEl.style.display = "";
    chipsEl.innerHTML = contextItems
      .map(
        (item, i) =>
          `<span class="ai-context-chip ai-context-chip-${item.kind}" title="${escapeHtml(chipTitle(item))}">` +
          `<span class="ai-context-chip-name">${escapeHtml(chipLabel(item))}</span>` +
          `<button class="ai-context-chip-remove" data-chip-idx="${i}" aria-label="Remove">×</button>` +
          `</span>`,
      )
      .join("");
  }

  chipsEl.addEventListener("click", (e) => {
    const target = e.target;
    if (!(target instanceof HTMLElement)) return;
    const btn = target.closest<HTMLElement>(".ai-context-chip-remove");
    if (!btn) return;
    const idx = Number(btn.dataset.chipIdx);
    if (!Number.isNaN(idx)) {
      contextItems.splice(idx, 1);
      renderChips();
    }
  });

  /* ── Context menu (paperclip dropdown) ─────────────────────────── */

  interface MenuItem {
    id: string;
    label: string;
    icon: string;
    disabled?: boolean;
    run?: () => void | Promise<void>;
  }

  const IMAGE_EXTS = ["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "ico"];
  const RULE_FILENAMES = ["CLAUDE.md", "AGENTS.md", ".cursorrules", ".windsurfrules"];

  async function addFilesOrDirs(): Promise<void> {
    const picked = await openDialog({
      multiple: true,
      directory: false,
      defaultPath: _cwd ?? undefined,
    });
    if (!picked) return;
    const paths = Array.isArray(picked) ? picked : [picked];
    for (const p of paths) {
      if (!contextItems.some((it) => it.kind === "file" && it.path === p)) {
        contextItems.push({ kind: "file", path: p });
      }
    }
    renderChips();
  }

  async function addImage(): Promise<void> {
    const picked = await openDialog({
      multiple: true,
      directory: false,
      defaultPath: _cwd ?? undefined,
      filters: [{ name: "Images", extensions: IMAGE_EXTS }],
    });
    if (!picked) return;
    const paths = Array.isArray(picked) ? picked : [picked];
    for (const p of paths) {
      if (!contextItems.some((it) => it.kind === "image" && it.path === p)) {
        contextItems.push({ kind: "image", path: p });
      }
    }
    renderChips();
  }

  function addSelection(): void {
    const sel = opts.getEditorSelection?.() ?? "";
    if (!sel.trim()) {
      appendMsg("system", "No editor selection to attach.");
      return;
    }
    const curPath = opts.getCurrentFilePath?.() ?? null;
    const label = curPath ? `${basename(curPath)} selection` : "Selection";
    contextItems.push({ kind: "selection", label, content: sel });
    renderChips();
  }

  async function addRules(): Promise<void> {
    const picked = await openDialog({
      multiple: true,
      directory: false,
      defaultPath: _cwd ?? undefined,
      filters: [{ name: "Rules", extensions: ["md", "cursorrules", "windsurfrules"] }],
    });
    if (!picked) return;
    const paths = Array.isArray(picked) ? picked : [picked];
    for (const p of paths) {
      if (!contextItems.some((it) => it.kind === "rules" && it.path === p)) {
        contextItems.push({ kind: "rules", path: p });
      }
    }
    renderChips();
  }

  const MENU_ITEMS: MenuItem[] = [
    { id: "files", label: "Files & Directories", icon: fileIcon, run: addFilesOrDirs },
    { id: "symbols", label: "Symbols", icon: codeIcon, disabled: true },
    { id: "threads", label: "Threads", icon: messageIcon, disabled: true },
    { id: "rules", label: "Rules", icon: listIcon, run: addRules },
    { id: "image", label: "Image", icon: imageIcon, run: addImage },
    { id: "selection", label: "Selection", icon: cursorIcon, run: addSelection },
    { id: "branch", label: "Branch Diff", icon: branchIcon, disabled: true },
  ];

  let contextMenuVisible = false;
  const contextMenuEl = document.createElement("div");
  contextMenuEl.className = "ai-context-menu";
  contextMenuEl.style.display = "none";
  contextMenuEl.innerHTML =
    `<div class="ai-context-menu-title">Context</div>` +
    MENU_ITEMS.map(
      (item) =>
        `<button class="ai-context-menu-item${item.disabled ? " disabled" : ""}" data-menu-id="${item.id}"${item.disabled ? " disabled" : ""}>` +
        `<span class="ai-context-menu-icon">${item.icon}</span>` +
        `<span>${item.label}</span>` +
        `</button>`,
    ).join("");
  pane.querySelector(".ai-chat-input-area")!.appendChild(contextMenuEl);

  function toggleContextMenu(force?: boolean): void {
    const next = force ?? !contextMenuVisible;
    contextMenuVisible = next;
    contextMenuEl.style.display = next ? "" : "none";
  }

  attachBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleContextMenu();
  });
  contextMenuEl.addEventListener("click", (e) => {
    const target = e.target;
    if (!(target instanceof HTMLElement)) return;
    const btn = target.closest<HTMLElement>(".ai-context-menu-item");
    if (!btn || btn.classList.contains("disabled")) return;
    const id = btn.dataset.menuId;
    const item = MENU_ITEMS.find((m) => m.id === id);
    toggleContextMenu(false);
    if (item?.run) void item.run();
  });
  document.addEventListener("click", (e) => {
    if (!contextMenuVisible) return;
    const target = e.target;
    if (target instanceof Node && contextMenuEl.contains(target)) return;
    toggleContextMenu(false);
  });

  async function buildContextPreamble(): Promise<string> {
    if (contextItems.length === 0) return "";
    const parts: string[] = [];
    for (const item of contextItems) {
      try {
        if (item.kind === "file" || item.kind === "rules") {
          const content = await invoke<string>("read_file", { path: item.path });
          parts.push(`\`\`\`${basename(item.path)}\n${content}\n\`\`\``);
        } else if (item.kind === "image") {
          parts.push(`[image attached: ${item.path}]`);
        } else if (item.kind === "selection") {
          parts.push(`\`\`\`${item.label}\n${item.content}\n\`\`\``);
        }
      } catch (e) {
        parts.push(`<!-- failed to load ${chipLabel(item)}: ${String(e)} -->`);
      }
    }
    return `Context:\n\n${parts.join("\n\n")}\n\n---\n\n`;
  }

  function resetToEmptyState(hint = "Type / to see available commands"): void {
    messagesEl.replaceChildren(emptyEl);
    emptyEl.style.display = "";
    emptyHintEl.textContent = hint;
  }

  function updateToolUI(): void {
    const current = AI_TOOL_OPTIONS.find((tool) => tool.id === currentTool) || AI_TOOL_OPTIONS[0];
    toolIconEl.innerHTML = current.icon;
    toolLabelEl.textContent = current.label;
    toolDropdown.innerHTML = AI_TOOL_OPTIONS
      .map(
        (tool) =>
          `<button class="ai-tool-option${tool.id === currentTool ? " active" : ""}" data-tool="${tool.id}">
            <span class="ai-tool-icon">${tool.icon}</span>
            <span>${tool.label}</span>
          </button>`,
      )
      .join("");
  }

  // loadCurrentTool is no longer needed — tool is cached in localStorage

  async function switchTool(next: AiToolId): Promise<void> {
    if (next === currentTool) {
      toolDropdown.style.display = "none";
      return;
    }
    const prev = currentTool;
    currentTool = next;
    saveCache(STORAGE_KEY_TOOL, next);
    toolDropdown.style.display = "none";
    modelDropdown.style.display = "none";
    updateToolUI();
    const toolLabel = AI_TOOL_OPTIONS.find((tool) => tool.id === next)?.label ?? "AI";
    setInputLocked(true, `Switching to ${toolLabel}...`);
    try {
      await invoke<string>("acp_set_adapter", { adapter: next });
      acpInitialized = false;
      acpSessionId = null;
      availableModels = [];
      currentModelId = "";
      configOptions = [];
      availableCommands = [];
      resetToEmptyState(`Switched to ${toolLabel}`);
      hideHistory();
      await startNewSession();
      requestAnimationFrame(() => inputEl.focus());
    } catch (e) {
      currentTool = prev;
      updateToolUI();
      setInputLocked(false);
      appendMsg("system", `Tool switch error: ${String(e)}`);
    }
  }

  /* ── ACP initialization ────────────────────────────────────────── */

  async function initAcp(): Promise<void> {
    if (acpInitialized) return;
    if (acpInitializing) { await acpInitializing; return; }
    acpInitializing = (async () => {
      try {
        const json = await invoke<string>("acp_initialize");
        const _result = JSON.parse(json);
        acpInitialized = true;
      } catch (e) {
        appendMsg("system", `ACP initialization error: ${String(e)}`);
      } finally {
        acpInitializing = null;
      }
    })();
    await acpInitializing;
  }

  async function startNewSession(): Promise<void> {
    setInputLocked(true, "Initializing...");
    resetToEmptyState("Initializing...");
    hideHistory();
    await initAcp();
    const cwd = _cwd || "/tmp";
    try {
      const json = await invoke<string>("acp_new_session", { cwd });
      const result = JSON.parse(json);
      acpSessionId = result.sessionId;

      // Extract models
      if (result.models) {
        availableModels = result.models.availableModels || [];
        currentModelId = result.models.currentModelId || "";
        updateModelUI();
      }

      // Extract config options (may include model selector with more options)
      if (result.configOptions) {
        configOptions = result.configOptions;
        applyConfigOptions();
      }

      // Auto-apply cached model if it differs from what ACP returned
      if (cachedModelId && cachedModelId !== currentModelId && acpSessionId) {
        const modelConfig = configOptions.find(
          (c) => c.category === "model" && c.type === "select",
        );
        if (modelConfig) {
          const allOpts = flattenConfigOptions(modelConfig.options || []);
          if (allOpts.some((o) => o.value === cachedModelId)) {
            void selectModel(cachedModelId, modelConfig.id);
          }
        } else if (availableModels.some((m) => m.modelId === cachedModelId)) {
          void selectModel(cachedModelId);
        }
      }

      resetToEmptyState();
      setInputLocked(false);
    } catch (e) {
      appendMsg("system", `Session creation error: ${String(e)}`);
      setInputLocked(false);
    }
  }

  /* ── Listen for ACP session updates ────────────────────────────── */

  async function setupListener(): Promise<void> {
    if (unlistenUpdate) return;
    unlistenUpdate = await listen<Record<string, unknown>>("acp:session-update", (ev) => {
      const params = ev.payload;
      const update = params.update as Record<string, unknown> | undefined;
      if (!update) return;

      const sid = params.sessionId as string;
      if (sid !== acpSessionId) return;

      const kind = update.sessionUpdate as string;
      switch (kind) {
        case "agent_message_chunk": {
          const content = update.content as { type: string; text: string } | undefined;
          if (content?.text) {
            streamingText += content.text;
            updateStreamingMsg(streamingText);
          }
          break;
        }
        case "agent_thought_chunk": {
          // Show thinking as dimmed text
          const content = update.content as { type: string; text: string } | undefined;
          if (content?.text) {
            updateThinkingIndicator(content.text);
          }
          break;
        }
        case "tool_call": {
          const title = update.title as string || "Tool call";
          const status = update.status as string || "";
          appendToolCall(title, status);
          break;
        }
        case "tool_call_update": {
          const title = update.title as string | undefined;
          const status = update.status as string || "";
          if (title) updateToolCall(title, status);
          break;
        }
        case "available_commands_update": {
          const cmds = update.availableCommands as AcpCommand[] | undefined;
          if (cmds) availableCommands = cmds;
          break;
        }
        case "config_option_update": {
          const opts = update.configOptions as AcpConfigOption[] | undefined;
          if (opts) {
            configOptions = opts;
            applyConfigOptions();
          }
          break;
        }
        case "session_info_update": {
          // Title updated, etc.
          break;
        }
        case "usage_update": {
          // Could show token usage in UI
          break;
        }
      }
    });
  }

  /* ── Model UI ──────────────────────────────────────────────────── */

  function updateModelUI(): void {
    const current = availableModels.find((m) => m.modelId === currentModelId);
    modelLabel.textContent = current ? current.name : currentModelId || cachedModelId || "...";

    // Rebuild dropdown from real data
    // Check configOptions for a model-category select with grouped options
    const modelConfig = configOptions.find(
      (c) => c.category === "model" && c.type === "select",
    );
    if (modelConfig && modelConfig.options) {
      renderModelDropdownFromConfig(modelConfig);
    } else if (availableModels.length > 0) {
      modelDropdown.innerHTML = availableModels
        .map(
          (m) =>
            `<button class="ai-model-option${m.modelId === currentModelId ? " active" : ""}" data-model="${escapeHtml(m.modelId)}">${escapeHtml(m.name)}</button>`,
        )
        .join("");
    }
  }

  function renderModelDropdownFromConfig(config: AcpConfigOption): void {
    const currentVal = config.currentValue as string;
    let html = "";
    for (const opt of config.options || []) {
      if ("group" in opt) {
        const group = opt as AcpConfigSelectGroup;
        html += `<div class="ai-model-group-label">${escapeHtml(group.name)}</div>`;
        for (const o of group.options) {
          html += `<button class="ai-model-option${o.value === currentVal ? " active" : ""}" data-model="${escapeHtml(o.value)}" data-config="${escapeHtml(config.id)}">${escapeHtml(o.name)}</button>`;
        }
      } else {
        const o = opt as AcpConfigSelectOption;
        html += `<button class="ai-model-option${o.value === currentVal ? " active" : ""}" data-model="${escapeHtml(o.value)}" data-config="${escapeHtml(config.id)}">${escapeHtml(o.name)}</button>`;
      }
    }
    modelDropdown.innerHTML = html;
    // Update label
    const allOpts = flattenConfigOptions(config.options || []);
    const selected = allOpts.find((o) => o.value === currentVal);
    if (selected) modelLabel.textContent = selected.name;
  }

  function flattenConfigOptions(
    opts: Array<AcpConfigSelectOption | AcpConfigSelectGroup>,
  ): AcpConfigSelectOption[] {
    const result: AcpConfigSelectOption[] = [];
    for (const o of opts) {
      if ("group" in o) {
        result.push(...(o as AcpConfigSelectGroup).options);
      } else {
        result.push(o as AcpConfigSelectOption);
      }
    }
    return result;
  }

  function applyConfigOptions(): void {
    const modelConfig = configOptions.find(
      (c) => c.category === "model" && c.type === "select",
    );
    if (modelConfig) {
      renderModelDropdownFromConfig(modelConfig);
    }
  }

  async function selectModel(modelId: string, configId?: string): Promise<void> {
    if (!acpSessionId) return;
    modelDropdown.style.display = "none";
    // Persist immediately so next session uses this model
    cachedModelId = modelId;
    saveCache(STORAGE_KEY_MODEL, modelId);
    try {
      if (configId) {
        const json = await invoke<string>("acp_set_config", {
          sessionId: acpSessionId,
          configId,
          value: modelId,
        });
        const result = JSON.parse(json);
        if (result.configOptions) {
          configOptions = result.configOptions;
          applyConfigOptions();
        }
      } else {
        await invoke<string>("acp_set_model", {
          sessionId: acpSessionId,
          modelId,
        });
        currentModelId = modelId;
        updateModelUI();
      }
    } catch (e) {
      console.error("Model switch error:", e);
    }
  }

  /* ── Message rendering ─────────────────────────────────────────── */

  function appendMsg(role: "user" | "assistant" | "system", content: string, streaming = false): void {
    emptyEl.style.display = "none";
    const msg = document.createElement("div");
    msg.className = `ai-msg ai-msg-${role}${streaming ? " ai-msg-streaming" : ""}`;
    const body = document.createElement("div");
    body.className = "ai-msg-content";
    if (role === "assistant" && !streaming && content) {
      body.innerHTML = renderMd(content);
    } else if (role === "system") {
      body.innerHTML = `<span class="ai-system-msg">${escapeHtml(content)}</span>`;
    } else {
      body.textContent = content;
    }
    msg.appendChild(body);
    messagesEl.appendChild(msg);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function updateStreamingMsg(text: string): void {
    const el = messagesEl.querySelector<HTMLElement>(".ai-msg-streaming .ai-msg-content");
    if (el) {
      el.textContent = text;
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }
  }

  function finalizeStreamingMsg(text: string): void {
    const msg = messagesEl.querySelector<HTMLElement>(".ai-msg-streaming");
    if (!msg) return;
    msg.classList.remove("ai-msg-streaming");
    const el = msg.querySelector<HTMLElement>(".ai-msg-content");
    if (el) {
      el.innerHTML = renderMd(text);
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }
  }

  function appendToolCall(title: string, status: string): void {
    emptyEl.style.display = "none";
    const el = document.createElement("div");
    el.className = "ai-tool-call";
    el.dataset.status = status;
    el.innerHTML = `<span class="ai-tool-call-icon">${status === "completed" ? "✓" : "⟳"}</span><span class="ai-tool-call-title">${escapeHtml(title)}</span>`;
    messagesEl.appendChild(el);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function updateToolCall(title: string, status: string): void {
    const els = messagesEl.querySelectorAll<HTMLElement>(".ai-tool-call");
    const last = els[els.length - 1];
    if (last) {
      last.dataset.status = status;
      const icon = last.querySelector(".ai-tool-call-icon");
      if (icon) icon.textContent = status === "completed" ? "✓" : status === "failed" ? "✗" : "⟳";
      const titleEl = last.querySelector(".ai-tool-call-title");
      if (titleEl) titleEl.textContent = title;
    }
  }

  function updateThinkingIndicator(_text: string): void {
    let el = messagesEl.querySelector<HTMLElement>(".ai-thinking-indicator");
    if (!el) {
      el = document.createElement("div");
      el.className = "ai-thinking-indicator";
      el.textContent = "Thinking...";
      messagesEl.appendChild(el);
    }
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function removeThinkingIndicator(): void {
    const el = messagesEl.querySelector(".ai-thinking-indicator");
    if (el) el.remove();
  }

  /* ── Slash command menu ────────────────────────────────────────── */

  function showSlashMenu(filter: string): void {
    const q = filter.toLowerCase();
    filteredCommands = availableCommands.filter(
      (c) => c.name.toLowerCase().includes(q) || c.description.toLowerCase().includes(q),
    );
    if (filteredCommands.length === 0) {
      hideSlashMenu();
      return;
    }
    slashMenuIndex = 0;
    slashMenuVisible = true;
    renderSlashMenu();
    slashMenuEl.style.display = "flex";
  }

  function hideSlashMenu(): void {
    slashMenuVisible = false;
    slashMenuEl.style.display = "none";
  }

  function renderSlashMenu(): void {
    slashMenuEl.innerHTML = filteredCommands
      .map(
        (c, i) =>
          `<div class="ai-slash-item${i === slashMenuIndex ? " active" : ""}" data-cmd="${i}">
          <span class="ai-slash-name">/${escapeHtml(c.name)}</span>
          <span class="ai-slash-desc">${escapeHtml(c.description)}</span>
        </div>`,
      )
      .join("");
    const active = slashMenuEl.querySelector<HTMLElement>(".ai-slash-item.active");
    if (active) active.scrollIntoView({ block: "nearest" });
  }

  function executeSlashCommand(index: number): void {
    const cmd = filteredCommands[index];
    if (cmd) {
      // Slash commands are sent as prompts with the command text
      inputEl.value = `/${cmd.name} `;
      autoResize();
      hideSlashMenu();
      inputEl.focus();
    }
  }

  slashMenuEl.addEventListener("click", (e) => {
    const item = (e.target as HTMLElement).closest<HTMLElement>(".ai-slash-item");
    if (item && item.dataset.cmd != null) {
      executeSlashCommand(parseInt(item.dataset.cmd, 10));
    }
  });

  inputEl.addEventListener("input", () => {
    const val = inputEl.value;
    if (val.startsWith("/") && !val.includes("\n")) {
      const parts = val.split(" ");
      if (parts.length <= 1) {
        showSlashMenu(val.slice(1));
      } else {
        hideSlashMenu();
      }
    } else {
      hideSlashMenu();
    }
  });

  /* ── History panel ─────────────────────────────────────────────── */

  async function showHistory(): Promise<void> {
    showingHistory = true;
    sessionListEl.style.display = "flex";
    messagesEl.style.display = "none";

    try {
      const json = await invoke<string>("acp_list_sessions", { cwd: _cwd });
      const result = JSON.parse(json);
      const sessions: AcpSessionInfo[] = result.sessions || [];

      if (sessions.length === 0) {
        sessionListEl.innerHTML = '<div class="ai-session-empty">No session history</div>';
        return;
      }

      sessionListEl.innerHTML = sessions
        .map((s) => {
          const date = s.updatedAt
            ? new Date(s.updatedAt).toLocaleDateString("ja-JP", {
                month: "short",
                day: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              })
            : "";
          const title = escapeHtml(s.title || "(Untitled)");
          return `<div class="ai-session-item" data-id="${escapeHtml(s.sessionId)}">
            <div class="ai-session-info">
              <span class="ai-session-title">${title}</span>
              <span class="ai-session-meta">${date}</span>
            </div>
          </div>`;
        })
        .join("");
    } catch (e) {
      sessionListEl.innerHTML = `<div class="ai-session-empty">Failed to load history: ${escapeHtml(String(e))}</div>`;
    }
  }

  function hideHistory(): void {
    showingHistory = false;
    sessionListEl.style.display = "none";
    messagesEl.style.display = "";
  }

  async function resumeSession(sessionId: string): Promise<void> {
    const cwd = _cwd || "/tmp";
    setInputLocked(true, "Resuming session...");
    try {
      const json = await invoke<string>("acp_resume_session", { sessionId, cwd });
      const result = JSON.parse(json);
      acpSessionId = sessionId;

      if (result.models) {
        availableModels = result.models.availableModels || [];
        currentModelId = result.models.currentModelId || "";
        updateModelUI();
      }
      if (result.configOptions) {
        configOptions = result.configOptions;
        applyConfigOptions();
      }

      resetToEmptyState("Session resumed");
      hideHistory();
      setInputLocked(false);
    } catch (e) {
      appendMsg("system", `Session resume error: ${String(e)}`);
      hideHistory();
      setInputLocked(false);
    }
  }

  /* ── Send logic ────────────────────────────────────────────────── */

  async function send(): Promise<void> {
    const text = inputEl.value.trim();
    if (!text || isGenerating) return;

    if (!acpSessionId) {
      await startNewSession();
      if (!acpSessionId) return;
    }

    const preamble = await buildContextPreamble();
    const fullPrompt = preamble + text;
    const userDisplay = contextItems.length > 0
      ? `📎 ${contextItems.map(chipLabel).join(", ")}\n\n${text}`
      : text;
    contextItems.length = 0;
    renderChips();

    inputEl.value = "";
    autoResize();
    hideSlashMenu();
    isGenerating = true;
    sendBtn.disabled = true;
    sendBtn.textContent = "…";

    appendMsg("user", userDisplay);

    // Prepare streaming
    streamingText = "";
    appendMsg("assistant", "", true);

    try {
      const json = await invoke<string>("acp_prompt", {
        sessionId: acpSessionId,
        prompt: fullPrompt,
      });
      // Prompt finished — finalize
      removeThinkingIndicator();
      if (streamingText) {
        finalizeStreamingMsg(streamingText);
      } else {
        // No streaming content received — remove empty streaming msg
        const streamingMsg = messagesEl.querySelector(".ai-msg-streaming");
        if (streamingMsg) streamingMsg.remove();
      }

      const result = JSON.parse(json);
      if (result.stopReason === "cancelled") {
        appendMsg("system", "Cancelled");
      }
    } catch (e) {
      removeThinkingIndicator();
      const streamingMsg = messagesEl.querySelector(".ai-msg-streaming");
      if (streamingMsg) streamingMsg.remove();
      appendMsg("system", `Error: ${String(e)}`);
    }

    isGenerating = false;
    sendBtn.disabled = false;
    sendBtn.textContent = "↑";
  }

  /* ── Event handlers ────────────────────────────────────────────── */

  inputEl.addEventListener("keydown", (e) => {
    if (slashMenuVisible) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        slashMenuIndex = (slashMenuIndex + 1) % filteredCommands.length;
        renderSlashMenu();
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        slashMenuIndex = (slashMenuIndex - 1 + filteredCommands.length) % filteredCommands.length;
        renderSlashMenu();
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        executeSlashCommand(slashMenuIndex);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        hideSlashMenu();
        return;
      }
    }

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  });

  sendBtn.addEventListener("click", () => void send());

  pane.addEventListener("click", (e) => {
    const target = e.target;
    if (!(target instanceof Element)) return;

    // Tool selector toggle
    if (target.closest(".ai-tool-selector")) {
      const visible = toolDropdown.style.display !== "none";
      toolDropdown.style.display = visible ? "none" : "flex";
      modelDropdown.style.display = "none";
      return;
    }

    // Tool option selection
    const toolOpt = target.closest<HTMLElement>(".ai-tool-option");
    const toolId = toolOpt?.dataset.tool;
    if (toolId === "claude" || toolId === "codex") {
      void switchTool(toolId);
      return;
    }

    // Model selector toggle
    if (target.closest(".ai-model-selector")) {
      const visible = modelDropdown.style.display !== "none";
      modelDropdown.style.display = visible ? "none" : "flex";
      toolDropdown.style.display = "none";
      return;
    }

    // Model option selection
    const modelOpt = target.closest<HTMLElement>(".ai-model-option");
    if (modelOpt && modelOpt.dataset.model) {
      void selectModel(modelOpt.dataset.model, modelOpt.dataset.config);
      return;
    }

    // Session list item
    const item = target.closest<HTMLElement>(".ai-session-item");
    if (item && item.dataset.id) {
      void resumeSession(item.dataset.id);
      return;
    }

    // Action buttons
    const action = target.closest<HTMLElement>(".ai-action");
    if (!action) return;
    const kind = action.dataset.action;
    if (kind === "history") {
      if (showingHistory) hideHistory();
      else void showHistory();
    } else if (kind === "new") {
      void startNewSession();
    } else if (kind === "close-pane") {
      setVisible(false);
    }
  });

  // Close dropdowns when clicking outside
  document.addEventListener("click", (e) => {
    if (!pane.contains(e.target as Node)) {
      toolDropdown.style.display = "none";
      modelDropdown.style.display = "none";
    }
  });

  /* ── Divider drag-to-resize ─────────────────────────────────────── */

  let dragging = false;
  let startX = 0;
  let startWidth = 0;
  divider.addEventListener("pointerdown", (e) => {
    dragging = true;
    startX = e.clientX;
    startWidth = pane.getBoundingClientRect().width;
    divider.setPointerCapture(e.pointerId);
    document.body.style.cursor = "col-resize";
  });
  divider.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    const delta = startX - e.clientX;
    const newWidth = Math.max(260, Math.min(900, startWidth + delta));
    pane.style.width = `${newWidth}px`;
  });
  divider.addEventListener("pointerup", (e) => {
    dragging = false;
    divider.releasePointerCapture(e.pointerId);
    document.body.style.cursor = "";
  });

  /* ── Visibility ─────────────────────────────────────────────────── */

  function setVisible(v: boolean): void {
    pane.classList.toggle("visible", v);
    divider.classList.toggle("visible", v);
    // Sync floating button state
    const fab = document.getElementById("btn-ai-pane");
    if (fab) fab.classList.toggle("active", v);
    if (v) {
      void (async () => {
        await setupListener();
        if (!acpSessionId) await startNewSession();
        requestAnimationFrame(() => inputEl.focus());
      })();
    } else {
      toolDropdown.style.display = "none";
      modelDropdown.style.display = "none";
    }
  }

  // Show cached model name immediately (before ACP init)
  if (cachedModelId) {
    modelLabel.textContent = cachedModelId;
  }
  // Update tool UI from cached preference
  updateToolUI();

  // Eagerly start ACP initialization in the background so it's ready when pane opens
  void initAcp();
  void setupListener();

  return {
    toggle() {
      const v = !pane.classList.contains("visible");
      setVisible(v);
      return v;
    },
    isVisible() {
      return pane.classList.contains("visible");
    },
    setCwd(next) {
      _cwd = next;
    },
  };
}
