import { escapeHtml } from "./html-utils";
import filePlusIcon from "lucide-static/icons/file-plus.svg?raw";
import folderOpenIcon from "lucide-static/icons/folder-open.svg?raw";
import fileTextIcon from "lucide-static/icons/file-text.svg?raw";
import folderIcon from "lucide-static/icons/folder.svg?raw";

const MAX_RECENT = 8;

export interface WelcomeActions {
  onNewFile: () => void;
  onOpenFile: () => void;
  onOpenFolder: () => void;
  onOpenRecent: (folderPath: string) => void;
}

export function createWelcome(actions: WelcomeActions) {
  const el = document.getElementById("welcome")!;

  function render(recentFolders: string[]): void {
    const recentsHtml = recentFolders.length > 0
      ? recentFolders.map((folder, i) => {
        const name = folder.split(/[/\\]/).pop() || folder;
        const shortcut = i < 9 ? `<span class="welcome-shortcut">\u2318${i + 1}</span>` : "";
        return `<li class="welcome-action" data-folder="${escapeAttr(folder)}">
          <span class="welcome-icon">${folderIcon}</span>
          <span class="welcome-action-label">${escapeHtml(name)}</span>
          <span class="welcome-action-path">${escapeHtml(shortenPath(folder))}</span>
          ${shortcut}
        </li>`;
      }).join("")
      : '<li class="welcome-empty">No recent projects</li>';

    el.innerHTML = `
      <div class="welcome-inner">
        <div class="welcome-hero">
          <span class="welcome-logo">${fileTextIcon}</span>
          <div>
            <h1 class="welcome-title">Welcome to mdeditor</h1>
            <p class="welcome-subtitle">Lightweight Markdown editor</p>
          </div>
        </div>

        <div class="welcome-section">
          <div class="welcome-section-title">GET STARTED</div>
          <ul class="welcome-list">
            <li class="welcome-action" data-action="new-file">
              <span class="welcome-icon">${filePlusIcon}</span>
              <span class="welcome-action-label">New File</span>
              <span class="welcome-shortcut">\u2318N</span>
            </li>
            <li class="welcome-action" data-action="open-file">
              <span class="welcome-icon">${folderOpenIcon}</span>
              <span class="welcome-action-label">Open File</span>
              <span class="welcome-shortcut">\u2318O</span>
            </li>
            <li class="welcome-action" data-action="open-folder">
              <span class="welcome-icon">${folderOpenIcon}</span>
              <span class="welcome-action-label">Open Folder</span>
            </li>
          </ul>
        </div>

        <div class="welcome-section">
          <div class="welcome-section-title">RECENT PROJECTS</div>
          <ul class="welcome-list">${recentsHtml}</ul>
        </div>
      </div>
    `;

    // Single delegated click handler (replaces per-element listeners)
    el.onclick = (e) => {
      const target = (e.target as HTMLElement).closest<HTMLElement>(".welcome-action");
      if (!target) return;

      if (target.dataset.action) {
        const action = target.dataset.action;
        if (action === "new-file") actions.onNewFile();
        else if (action === "open-file") actions.onOpenFile();
        else if (action === "open-folder") actions.onOpenFolder();
      } else if (target.dataset.folder) {
        actions.onOpenRecent(target.dataset.folder);
      }
    };
  }

  function show(recentFolders: string[]): void {
    render(recentFolders);
    el.style.display = "flex";
  }

  function hide(): void {
    el.style.display = "none";
  }

  return { show, hide };
}

/** Add a folder to the front of the recent list, dedup + cap. */
export function addRecentFolder(recentFolders: string[], folder: string): string[] {
  const filtered = recentFolders.filter((f) => f !== folder);
  return [folder, ...filtered].slice(0, MAX_RECENT);
}

/** Escape for use in HTML attributes (reuses escapeHtml which covers all needed chars). */
const escapeAttr = escapeHtml;

function shortenPath(path: string): string {
  // Show ~/ for home directory paths
  // macOS: /Users/<name>, Linux: /home/<name>, Windows: C:\Users\<name>
  const home = path.match(/^\/Users\/[^/]+/) || path.match(/^\/home\/[^/]+/) || path.match(/^[A-Z]:\\Users\\[^\\]+/i);
  if (home) {
    return "~" + path.slice(home[0].length).replace(/\\/g, "/");
  }
  return path;
}
