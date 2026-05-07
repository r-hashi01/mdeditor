import {
  createPalette,
  fuzzyMatch,
  highlightIndices,
  escapeHtml,
  type PaletteHandle,
  type PaletteItem,
} from "./palette";

export interface Command {
  id: string;
  title: string;
  /** Human-readable shortcut hint, e.g. "Cmd+S". */
  shortcut?: string;
  run: () => void;
}

export function createCommandPalette(getCommands: () => Command[]): PaletteHandle {
  return createPalette<Command>({
    placeholder: "Type a command…",
    emptyMessage: "No matching commands",
    onQuery: (query) => {
      const cmds = getCommands();
      if (!query) {
        return cmds.map((c) => buildItem(c, c.title, []));
      }
      const scored: Array<{ item: PaletteItem<Command>; score: number }> = [];
      for (const c of cmds) {
        const m = fuzzyMatch(c.title, query);
        if (!m) continue;
        scored.push({ item: buildItem(c, c.title, m.indices), score: m.score });
      }
      scored.sort((a, b) => b.score - a.score);
      return scored.map((s) => s.item);
    },
    onSelect: (cmd) => cmd.run(),
  });
}

function buildItem(cmd: Command, title: string, indices: number[]): PaletteItem<Command> {
  const primary = cmd.shortcut
    ? `${highlightIndices(title, indices)} <span class="palette-shortcut">${escapeHtml(cmd.shortcut)}</span>`
    : highlightIndices(title, indices);
  return {
    key: cmd.id,
    value: cmd,
    primary,
  };
}
