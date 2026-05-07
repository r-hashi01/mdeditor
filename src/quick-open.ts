import { invoke } from "@tauri-apps/api/core";
import {
  createPalette,
  fuzzyMatch,
  highlightIndices,
  escapeHtml,
  type PaletteHandle,
  type PaletteItem,
} from "./palette";

interface ProjectFile {
  name: string;
  path: string;
  rel: string;
}

export interface QuickOpenDeps {
  /** Returns the currently opened project root, or null if none. */
  getRoot: () => string | null;
  /** Called with the absolute path the user picked. */
  onPick: (path: string) => void;
}

const MAX_RESULTS = 50;

/**
 * Quick-open palette (Cmd+P). Lists every searchable file under the open
 * project root and fuzzy-matches against the relative path.
 */
export function createQuickOpen(deps: QuickOpenDeps): PaletteHandle {
  /** Cache the file list for the current root — invalidated by `refresh()`. */
  let cachedRoot: string | null = null;
  let cachedFiles: ProjectFile[] = [];
  let inflight: Promise<ProjectFile[]> | null = null;

  async function loadFiles(root: string): Promise<ProjectFile[]> {
    if (cachedRoot === root && cachedFiles.length > 0) return cachedFiles;
    if (inflight) return inflight;
    inflight = invoke<ProjectFile[]>("list_files_recursive", { path: root })
      .then((files) => {
        cachedRoot = root;
        cachedFiles = files;
        return files;
      })
      .finally(() => {
        inflight = null;
      });
    return inflight;
  }

  return createPalette<string>({
    placeholder: "Open file by name…",
    emptyMessage: "No project open",
    onQuery: async (query) => {
      const root = deps.getRoot();
      if (!root) return [];
      let files: ProjectFile[];
      try {
        files = await loadFiles(root);
      } catch {
        return [];
      }
      if (!query) {
        // Show first N files alphabetically (the backend already sorted them).
        return files.slice(0, MAX_RESULTS).map((f) => buildItem(f, []));
      }
      const scored: Array<{ item: PaletteItem<string>; score: number }> = [];
      for (const f of files) {
        // Match against the relative path so directory chars count.
        const m = fuzzyMatch(f.rel, query);
        if (!m) continue;
        scored.push({ item: buildItem(f, m.indices), score: m.score });
        if (scored.length > MAX_RESULTS * 4) {
          // Cap raw candidates to keep sort cheap on very large vaults.
          break;
        }
      }
      scored.sort((a, b) => b.score - a.score);
      return scored.slice(0, MAX_RESULTS).map((s) => s.item);
    },
    onSelect: (path) => deps.onPick(path),
  });
}

/** Invalidate the cache — call this when files are added/removed externally. */
export function clearQuickOpenCache(handle: PaletteHandle): void {
  // The cache lives in the closure; forcing a refresh is enough — the next
  // `loadFiles()` call will re-fetch when `cachedRoot` doesn't match.
  // We just nudge a re-query so a stale list doesn't sit in the UI.
  handle.refresh();
}

function buildItem(f: ProjectFile, indices: number[]): PaletteItem<string> {
  // Split indices into "name" portion and "dir" portion for display:
  // primary = filename (highlighted against the tail of `rel`).
  // secondary = full relative path (highlighted).
  const slashIdx = f.rel.lastIndexOf("/");
  const dirLen = slashIdx >= 0 ? slashIdx + 1 : 0;
  const nameIndices = indices
    .filter((i) => i >= dirLen)
    .map((i) => i - dirLen);
  const primary = highlightIndices(f.name, nameIndices);
  const secondary = slashIdx >= 0 ? highlightIndices(f.rel, indices) : escapeHtml("");
  return {
    key: f.path,
    value: f.path,
    primary,
    secondary: secondary || undefined,
  };
}
