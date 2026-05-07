/**
 * Reusable searchable-modal primitive ("palette") used by:
 *  - command palette  (Cmd+Shift+P)
 *  - quick file open  (Cmd+P)
 *  - project search   (Cmd+Shift+F)
 *
 * Caller supplies: a placeholder, an `onQuery` that returns items for the
 * current input, and an `onSelect` for the chosen item. The palette renders
 * a list with keyboard navigation and arbitrary per-item HTML.
 */

export interface PaletteItem<T> {
  /** Stable key (used for DOM diffing — keep it cheap). */
  key: string;
  /** Underlying value handed back to `onSelect`. */
  value: T;
  /** Primary line, may include highlight HTML (already escaped). */
  primary: string;
  /** Optional second line (greyer). */
  secondary?: string;
}

export interface PaletteOptions<T> {
  placeholder: string;
  /** Initial query (defaults to ""). */
  initialQuery?: string;
  /**
   * Resolve items for a given query. Called on every input change after a
   * small debounce. Return [] for "no items".
   */
  onQuery: (query: string) => Promise<PaletteItem<T>[]> | PaletteItem<T>[];
  onSelect: (value: T) => void;
  /** Optional empty-state message shown when results are empty. */
  emptyMessage?: string;
  /** Debounce for `onQuery` in ms (default 80). */
  debounceMs?: number;
}

export interface PaletteHandle {
  show(): void;
  hide(): void;
  isOpen(): boolean;
  /** Re-issue the current query (e.g. after external state change). */
  refresh(): void;
  destroy(): void;
}

/** Escape user-provided text for safe innerHTML insertion. */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Highlight a single substring match, given a *plain* text and indices. */
export function highlightRange(text: string, start: number, end: number): string {
  if (start < 0 || end > text.length || start >= end) return escapeHtml(text);
  return (
    escapeHtml(text.slice(0, start)) +
    `<mark>${escapeHtml(text.slice(start, end))}</mark>` +
    escapeHtml(text.slice(end))
  );
}

/**
 * Subsequence fuzzy match. Returns score + match indices, or null if the
 * query characters don't appear in order.
 */
export function fuzzyMatch(
  text: string,
  query: string,
): { score: number; indices: number[] } | null {
  if (!query) return { score: 0, indices: [] };
  const t = text.toLowerCase();
  const q = query.toLowerCase();
  const indices: number[] = [];
  let qi = 0;
  let consecutive = 0;
  let score = 0;
  for (let i = 0; i < t.length && qi < q.length; i++) {
    if (t[i] === q[qi]) {
      indices.push(i);
      qi++;
      consecutive++;
      // Reward consecutive matches and word-start boundaries.
      score += 1 + consecutive;
      if (i === 0 || /[\s/_\-.\\]/.test(t[i - 1])) score += 3;
    } else {
      consecutive = 0;
    }
  }
  if (qi < q.length) return null;
  // Shorter strings score higher (denser match).
  score -= Math.max(0, t.length - q.length) * 0.05;
  return { score, indices };
}

/** Apply `<mark>` highlighting given an index list (output of fuzzyMatch). */
export function highlightIndices(text: string, indices: number[]): string {
  if (indices.length === 0) return escapeHtml(text);
  let out = "";
  let inMark = false;
  let i = 0;
  let next = indices[0];
  let nextIdx = 0;
  while (i < text.length) {
    if (i === next) {
      if (!inMark) {
        out += "<mark>";
        inMark = true;
      }
      out += escapeHtml(text[i]);
      nextIdx++;
      next = nextIdx < indices.length ? indices[nextIdx] : -1;
    } else {
      if (inMark) {
        out += "</mark>";
        inMark = false;
      }
      out += escapeHtml(text[i]);
    }
    i++;
  }
  if (inMark) out += "</mark>";
  return out;
}

export function createPalette<T>(opts: PaletteOptions<T>): PaletteHandle {
  const overlay = document.createElement("div");
  overlay.className = "palette-overlay";
  overlay.setAttribute("aria-hidden", "true");

  const modal = document.createElement("div");
  modal.className = "palette-modal";
  modal.setAttribute("role", "dialog");

  const input = document.createElement("input");
  input.className = "palette-input";
  input.type = "text";
  input.placeholder = opts.placeholder;
  input.spellcheck = false;
  input.autocapitalize = "off";
  input.autocomplete = "off";

  const list = document.createElement("ul");
  list.className = "palette-list";
  list.setAttribute("role", "listbox");

  const empty = document.createElement("div");
  empty.className = "palette-empty";
  empty.textContent = opts.emptyMessage ?? "No results";
  empty.style.display = "none";

  modal.appendChild(input);
  modal.appendChild(list);
  modal.appendChild(empty);
  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  let items: PaletteItem<T>[] = [];
  let activeIndex = 0;
  let queryToken = 0;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  const debounceMs = opts.debounceMs ?? 80;

  function render(): void {
    list.innerHTML = "";
    if (items.length === 0) {
      empty.style.display = "";
      return;
    }
    empty.style.display = "none";
    const frag = document.createDocumentFragment();
    items.forEach((item, idx) => {
      const li = document.createElement("li");
      li.className = "palette-item" + (idx === activeIndex ? " active" : "");
      li.setAttribute("role", "option");
      li.dataset.idx = String(idx);
      const primary = document.createElement("div");
      primary.className = "palette-item-primary";
      primary.innerHTML = item.primary;
      li.appendChild(primary);
      if (item.secondary) {
        const secondary = document.createElement("div");
        secondary.className = "palette-item-secondary";
        secondary.innerHTML = item.secondary;
        li.appendChild(secondary);
      }
      li.addEventListener("mousemove", () => {
        if (activeIndex !== idx) {
          activeIndex = idx;
          updateActive();
        }
      });
      li.addEventListener("click", () => commit(idx));
      frag.appendChild(li);
    });
    list.appendChild(frag);
    scrollActiveIntoView();
  }

  function updateActive(): void {
    list.querySelectorAll<HTMLElement>(".palette-item").forEach((el, idx) => {
      el.classList.toggle("active", idx === activeIndex);
    });
    scrollActiveIntoView();
  }

  function scrollActiveIntoView(): void {
    const el = list.querySelector<HTMLElement>(".palette-item.active");
    el?.scrollIntoView({ block: "nearest" });
  }

  async function runQuery(): Promise<void> {
    const q = input.value;
    const token = ++queryToken;
    const result = await opts.onQuery(q);
    // A newer query started while we awaited — drop this result.
    if (token !== queryToken) return;
    items = result;
    activeIndex = items.length > 0 ? 0 : -1;
    render();
  }

  function scheduleQuery(): void {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      void runQuery();
    }, debounceMs);
  }

  function commit(idx: number): void {
    const item = items[idx];
    if (!item) return;
    hide();
    opts.onSelect(item.value);
  }

  function onKey(e: KeyboardEvent): void {
    if (e.key === "Escape") {
      e.preventDefault();
      hide();
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      if (activeIndex >= 0) commit(activeIndex);
      return;
    }
    if (e.key === "ArrowDown" || (e.ctrlKey && e.key === "n")) {
      e.preventDefault();
      if (items.length === 0) return;
      activeIndex = (activeIndex + 1) % items.length;
      updateActive();
      return;
    }
    if (e.key === "ArrowUp" || (e.ctrlKey && e.key === "p")) {
      e.preventDefault();
      if (items.length === 0) return;
      activeIndex = (activeIndex - 1 + items.length) % items.length;
      updateActive();
      return;
    }
  }

  function onOverlayClick(e: MouseEvent): void {
    if (e.target === overlay) hide();
  }

  input.addEventListener("input", scheduleQuery);
  input.addEventListener("keydown", onKey);
  overlay.addEventListener("click", onOverlayClick);

  function show(): void {
    overlay.classList.add("visible");
    overlay.setAttribute("aria-hidden", "false");
    input.value = opts.initialQuery ?? "";
    items = [];
    activeIndex = -1;
    render();
    setTimeout(() => input.focus(), 0);
    void runQuery();
  }

  function hide(): void {
    overlay.classList.remove("visible");
    overlay.setAttribute("aria-hidden", "true");
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
  }

  function isOpen(): boolean {
    return overlay.classList.contains("visible");
  }

  function refresh(): void {
    void runQuery();
  }

  function destroy(): void {
    overlay.remove();
  }

  return { show, hide, isOpen, refresh, destroy };
}
