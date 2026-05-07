/**
 * Outline panel — collapsible list of the active markdown file's headings,
 * stacked under the file tree in the left sidebar. Click a heading to jump.
 */

import { buildOutlineTree, findActiveOutlineIndex, parseOutline, type OutlineItem, type OutlineNode } from "./outline";
import chevronDownIcon from "lucide-static/icons/chevron-down.svg?raw";
import chevronRightIcon from "lucide-static/icons/chevron-right.svg?raw";
import { escapeHtml } from "./html-utils";

export interface OutlinePanelDeps {
  /** Open the editor and place the cursor at `line` (1-based). */
  onPick: (line: number) => void;
}

export interface OutlinePanel {
  mount(container: HTMLElement): void;
  /** Re-parse the source and re-render. Cheap — call freely on doc change. */
  setSource(source: string): void;
  /** Highlight the heading whose section contains the cursor line. */
  setCursorLine(line: number): void;
  /** Toggle collapsed state. */
  toggle(): void;
  isCollapsed(): boolean;
}

export function createOutlinePanel(deps: OutlinePanelDeps): OutlinePanel {
  const root = document.createElement("div");
  root.className = "outline-root";

  const header = document.createElement("button");
  header.className = "outline-header";
  header.type = "button";
  const chevron = document.createElement("span");
  chevron.className = "outline-chevron";
  chevron.innerHTML = chevronRightIcon;
  header.appendChild(chevron);
  const label = document.createElement("span");
  label.className = "outline-header-label";
  label.textContent = "Outline";
  header.appendChild(label);
  root.appendChild(header);

  const body = document.createElement("div");
  body.className = "outline-body";
  body.style.display = "none";
  root.appendChild(body);

  let collapsed = true;
  let items: OutlineItem[] = [];
  let activeIndex = -1;

  header.addEventListener("click", () => {
    collapsed = !collapsed;
    chevron.innerHTML = collapsed ? chevronRightIcon : chevronDownIcon;
    body.style.display = collapsed ? "none" : "";
  });

  function mount(container: HTMLElement): void {
    container.appendChild(root);
  }

  function setSource(source: string): void {
    items = parseOutline(source);
    render();
  }

  function setCursorLine(line: number): void {
    const idx = findActiveOutlineIndex(items, line);
    if (idx === activeIndex) return;
    activeIndex = idx;
    updateActiveHighlight();
  }

  function render(): void {
    body.innerHTML = "";
    if (items.length === 0) {
      const empty = document.createElement("div");
      empty.className = "outline-empty";
      empty.textContent = "No headings";
      body.appendChild(empty);
      return;
    }
    const tree = buildOutlineTree(items);
    const frag = document.createDocumentFragment();
    for (const node of tree) {
      renderNode(frag, node);
    }
    body.appendChild(frag);
    updateActiveHighlight();
  }

  function renderNode(parent: ParentNode, node: OutlineNode): void {
    const row = document.createElement("button");
    row.type = "button";
    row.className = `outline-row outline-level-${node.level}`;
    row.dataset.line = String(node.line);
    row.title = node.text;
    row.innerHTML = `<span class="outline-row-text">${escapeHtml(node.text)}</span>`;
    row.addEventListener("click", () => deps.onPick(node.line));
    parent.appendChild(row);
    for (const child of node.children) {
      renderNode(parent, child);
    }
  }

  function updateActiveHighlight(): void {
    const rows = body.querySelectorAll<HTMLElement>(".outline-row");
    rows.forEach((row, idx) => {
      row.classList.toggle("active", idx === activeIndex);
    });
    // Scroll the active row into view if it's outside the panel viewport.
    if (activeIndex >= 0) {
      const target = rows[activeIndex];
      target?.scrollIntoView({ block: "nearest" });
    }
  }

  function toggle(): void {
    header.click();
  }

  function isCollapsed(): boolean {
    return collapsed;
  }

  return { mount, setSource, setCursorLine, toggle, isCollapsed };
}
