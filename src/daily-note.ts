/**
 * Daily note: open `YYYY-MM-DD.md` for today in the current vault. Creates
 * the file if it doesn't exist (empty), then opens it in a tab.
 *
 * The note is placed at the vault root by default. If a `daily/` subfolder
 * exists at the vault root, it's used instead so users can opt into a
 * scoped layout without configuration.
 */

import { invoke } from "@tauri-apps/api/core";

export interface DailyNoteDeps {
  getRoot: () => string | null;
  /** Open the path in a tab (creates a tab; same as the editor's open file flow). */
  onOpen: (path: string) => Promise<void> | void;
  /** Optional callback after we created a brand-new file (for vault refresh). */
  onCreated?: () => void | Promise<void>;
}

/** ISO yyyy-mm-dd in the user's local timezone. */
export function todayISO(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

interface DirEntry {
  name: string;
  path: string;
  is_dir: boolean;
}

async function dailyDir(vaultRoot: string): Promise<string> {
  // Prefer `daily/` subfolder at vault root if it exists.
  try {
    const entries = await invoke<DirEntry[]>("list_directory", { path: vaultRoot });
    const daily = entries.find((e) => e.is_dir && e.name.toLowerCase() === "daily");
    if (daily) return daily.path;
  } catch {
    // Fall through to root fallback.
  }
  return vaultRoot;
}

/**
 * Open today's daily note, creating it (empty) if needed.
 */
export async function openDailyNote(deps: DailyNoteDeps): Promise<void> {
  const root = deps.getRoot();
  if (!root) {
    throw new Error("No folder open — open a folder first.");
  }
  const dir = await dailyDir(root);
  const filename = `${todayISO()}.md`;
  const sep = dir.includes("\\") ? "\\" : "/";
  const path = dir.replace(/[\\/]$/, "") + sep + filename;

  // create_text_file refuses to overwrite, so swallow that specific error
  // — the file already existing is the success case.
  try {
    await invoke("create_text_file", { path });
    if (deps.onCreated) await deps.onCreated();
  } catch (e) {
    const msg = String(e);
    if (!msg.includes("File already exists")) {
      throw e;
    }
  }

  await deps.onOpen(path);
}
