/**
 * Tags palette — two-step navigation:
 *
 *   1. First palette: list every distinct `#tag` in the vault, sorted by
 *      occurrence count (most-used first).
 *   2. After picking a tag: second palette listing files/lines that mention
 *      it. Picking a line opens the file at that line.
 *
 * Backed by the Rust `extract_tags` command. The first-step list is built
 * lazily on each show() so newly-added tags surface without restart.
 */

import { invoke } from "@tauri-apps/api/core";
import {
  createPalette,
  fuzzyMatch,
  highlightIndices,
  highlightRange,
  escapeHtml,
  type PaletteHandle,
  type PaletteItem,
} from "./palette";

interface TagHit {
  tag: string;
  path: string;
  rel: string;
  line: number;
  snippet: string;
}

export interface TagsPaletteDeps {
  getRoot: () => string | null;
  /** Open the file at the given 1-based line. */
  onPick: (path: string, line: number) => void;
}

export interface TagsPalette {
  show(): void;
}

export function createTagsPalette(deps: TagsPaletteDeps): TagsPalette {
  let cachedRoot: string | null = null;
  let cachedHits: TagHit[] = [];

  async function loadHits(root: string): Promise<TagHit[]> {
    if (cachedRoot === root && cachedHits.length > 0) return cachedHits;
    const hits = await invoke<TagHit[]>("extract_tags", { path: root });
    cachedRoot = root;
    cachedHits = hits;
    return hits;
  }

  // Step 1: pick a tag.
  const step1 = createPalette<string>({
    placeholder: "Pick a tag…",
    emptyMessage: "No tags in vault",
    onQuery: async (query) => {
      const root = deps.getRoot();
      if (!root) return [];
      let hits: TagHit[];
      try {
        hits = await loadHits(root);
      } catch {
        return [];
      }
      const counts = new Map<string, number>();
      for (const h of hits) counts.set(h.tag, (counts.get(h.tag) ?? 0) + 1);

      type Scored = { tag: string; count: number; score: number; indices: number[] };
      const scored: Scored[] = [];
      for (const [tag, count] of counts) {
        if (!query) {
          scored.push({ tag, count, score: count, indices: [] });
          continue;
        }
        const m = fuzzyMatch(tag, query);
        if (!m) continue;
        scored.push({ tag, count, score: m.score + count * 0.1, indices: m.indices });
      }
      scored.sort((a, b) => (query ? b.score - a.score : b.count - a.count));
      return scored.slice(0, 100).map<PaletteItem<string>>((s) => ({
        key: s.tag,
        value: s.tag,
        primary: `#${highlightIndices(s.tag, s.indices)}`,
        secondary: `${s.count} file${s.count === 1 ? "" : "s"}`,
      }));
    },
    onSelect: (tag) => showStep2(tag),
  });

  // Step 2: pick a line containing the chosen tag.
  function showStep2(tag: string): void {
    const root = deps.getRoot();
    if (!root) return;
    const palette = createPalette<{ path: string; line: number }>({
      placeholder: `#${tag} — pick a file:line`,
      emptyMessage: `No occurrences of #${tag}`,
      onQuery: async () => {
        const hits = cachedHits.filter((h) => h.tag === tag);
        return hits.map((h) => {
          const tagIdx = h.snippet.indexOf("#" + tag);
          const primary = tagIdx >= 0
            ? highlightRange(h.snippet, tagIdx, tagIdx + tag.length + 1)
            : escapeHtml(h.snippet);
          return {
            key: `${h.path}:${h.line}`,
            value: { path: h.path, line: h.line },
            primary,
            secondary: `${escapeHtml(h.rel)}<span class="palette-line">:${h.line}</span>`,
          };
        });
      },
      onSelect: ({ path, line }) => {
        deps.onPick(path, line);
        // One-shot palette — drop the DOM after select.
        palette.destroy();
      },
    });
    palette.show();
  }

  return {
    show: () => {
      // Bust the cache on each show so saving a file picks up new tags.
      cachedRoot = null;
      cachedHits = [];
      step1.show();
    },
  };
}
