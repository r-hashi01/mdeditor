import { invoke } from "@tauri-apps/api/core";
import {
  createPalette,
  highlightRange,
  escapeHtml,
  type PaletteHandle,
} from "./palette";

interface SearchHit {
  path: string;
  rel: string;
  line: number;
  text: string;
  match_start: number;
  match_end: number;
}

export interface ProjectSearchDeps {
  getRoot: () => string | null;
  /** Open the file and jump to the given 1-based line. */
  onPick: (path: string, line: number) => void;
}

/**
 * Project-wide plain-text search (Cmd+Shift+F). Wraps the Rust
 * `search_in_dir` command in the palette UI.
 */
export function createProjectSearch(deps: ProjectSearchDeps): PaletteHandle {
  return createPalette<{ path: string; line: number }>({
    placeholder: "Search in project…",
    emptyMessage: "Type to search the project",
    debounceMs: 150,
    onQuery: async (query) => {
      const root = deps.getRoot();
      if (!root || query.trim().length < 2) return [];
      let hits: SearchHit[];
      try {
        hits = await invoke<SearchHit[]>("search_in_dir", {
          path: root,
          query,
          caseSensitive: false,
        });
      } catch {
        return [];
      }
      return hits.map((h) => ({
        key: `${h.path}:${h.line}:${h.match_start}`,
        value: { path: h.path, line: h.line },
        primary: highlightRange(h.text, h.match_start, h.match_end),
        secondary: `${escapeHtml(h.rel)}<span class="palette-line">:${h.line}</span>`,
      }));
    },
    onSelect: (v) => deps.onPick(v.path, v.line),
  });
}
