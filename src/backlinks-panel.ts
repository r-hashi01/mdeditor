/**
 * Backlinks side panel — lists files that link to the active file via
 * `[[wiki link]]`. Sourced from the vault index.
 */

import { getBacklinksFor, type BacklinkHit } from "./vault";
import { escapeHtml } from "./html-utils";
import xIcon from "lucide-static/icons/x.svg?raw";

export interface BacklinksDeps {
  /** Open the file at the given line (1-based). */
  onPick: (path: string, line: number) => void;
}

export interface BacklinksPanel {
  mount(container: HTMLElement): void;
  setActiveFile(path: string | null): void;
  toggle(): void;
  isVisible(): boolean;
  refresh(): void;
}

export function createBacklinksPanel(deps: BacklinksDeps): BacklinksPanel {
  const root = document.createElement("div");
  root.className = "backlinks-root";

  const header = document.createElement("div");
  header.className = "backlinks-header";
  const headerLabel = document.createElement("span");
  headerLabel.className = "backlinks-header-label";
  headerLabel.textContent = "Backlinks";
  header.appendChild(headerLabel);
  const closeBtn = document.createElement("button");
  closeBtn.className = "backlinks-header-close";
  closeBtn.innerHTML = xIcon;
  closeBtn.title = "Close panel";
  header.appendChild(closeBtn);
  root.appendChild(header);

  const body = document.createElement("div");
  body.className = "backlinks-body";
  root.appendChild(body);

  let mountEl: HTMLElement | null = null;
  let activeFile: string | null = null;

  closeBtn.addEventListener("click", () => {
    if (mountEl) mountEl.classList.remove("visible");
  });

  function mount(container: HTMLElement): void {
    mountEl = container;
    container.appendChild(root);
  }

  function render(): void {
    body.innerHTML = "";
    if (!activeFile) {
      body.appendChild(emptyState("Open a file to see its backlinks."));
      return;
    }
    const hits = getBacklinksFor(activeFile);
    if (hits.length === 0) {
      body.appendChild(emptyState("No links to this file."));
      return;
    }
    // Group by source file so the panel doesn't show one row per duplicate link.
    const byFrom = new Map<string, BacklinkHit[]>();
    for (const h of hits) {
      let list = byFrom.get(h.from);
      if (!list) {
        list = [];
        byFrom.set(h.from, list);
      }
      list.push(h);
    }
    const ordered = Array.from(byFrom.entries()).sort((a, b) =>
      a[1][0].from_rel.localeCompare(b[1][0].from_rel),
    );
    const frag = document.createDocumentFragment();
    for (const [from, group] of ordered) {
      const groupEl = document.createElement("div");
      groupEl.className = "backlinks-group";
      const head = document.createElement("div");
      head.className = "backlinks-group-head";
      head.textContent = group[0].from_rel;
      head.title = from;
      groupEl.appendChild(head);
      for (const h of group) {
        const row = document.createElement("button");
        row.className = "backlinks-row";
        row.innerHTML = `<span class="backlinks-line">L${h.line}</span><span class="backlinks-snippet">${escapeHtml(h.snippet)}</span>`;
        row.addEventListener("click", () => deps.onPick(h.from, h.line));
        groupEl.appendChild(row);
      }
      frag.appendChild(groupEl);
    }
    body.appendChild(frag);
  }

  function emptyState(text: string): HTMLElement {
    const el = document.createElement("div");
    el.className = "backlinks-empty";
    el.textContent = text;
    return el;
  }

  function setActiveFile(path: string | null): void {
    activeFile = path;
    render();
  }

  function toggle(): void {
    if (!mountEl) return;
    mountEl.classList.toggle("visible");
  }

  function isVisible(): boolean {
    return mountEl?.classList.contains("visible") ?? false;
  }

  function refresh(): void {
    render();
  }

  return { mount, setActiveFile, toggle, isVisible, refresh };
}
