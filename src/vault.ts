/**
 * Vault index — keeps an in-memory map of every markdown/text file in the
 * currently open folder. Drives wiki-link resolution and autocomplete.
 *
 * The index is rebuilt whenever the user opens a folder, and refreshed
 * after a save (so newly-added files become valid link targets).
 */

import { invoke } from "@tauri-apps/api/core";

export interface VaultFile {
  name: string;
  path: string;
  rel: string;
}

export interface VaultIndex {
  /** Absolute path of the vault root. */
  root: string;
  /** All files keyed by absolute path. */
  files: VaultFile[];
  /** Lowercase rel path → file (for exact relative-path resolution). */
  byRel: Map<string, VaultFile>;
  /** Lowercase basename without extension → first file (case-insensitive). */
  byBaseName: Map<string, VaultFile>;
}

let current: VaultIndex | null = null;

export function getVault(): VaultIndex | null {
  return current;
}

export async function rebuildVault(root: string): Promise<VaultIndex> {
  const files = await invoke<VaultFile[]>("list_files_recursive", { path: root });
  const byRel = new Map<string, VaultFile>();
  const byBaseName = new Map<string, VaultFile>();
  for (const f of files) {
    byRel.set(f.rel.toLowerCase(), f);
    const stem = stripExt(f.name).toLowerCase();
    if (!byBaseName.has(stem)) {
      byBaseName.set(stem, f);
    }
  }
  current = { root, files, byRel, byBaseName };
  return current;
}

export function clearVault(): void {
  current = null;
}

/**
 * Resolve a wiki-link target ("notes" / "subdir/notes" / "Notes.md") to a
 * concrete file in the vault. Returns null if no match is found.
 */
export function resolveLink(target: string): VaultFile | null {
  if (!current) return null;
  return resolveAgainst(target, current.byRel, current.byBaseName);
}

function resolveAgainst(
  target: string,
  byRel: Map<string, VaultFile>,
  byBaseName: Map<string, VaultFile>,
): VaultFile | null {
  const trimmed = target.trim();
  if (!trimmed) return null;
  const lower = trimmed.toLowerCase();

  // Exact relative path (with or without extension).
  const exact = byRel.get(lower);
  if (exact) return exact;
  // Append .md / .markdown if the user omitted the extension.
  for (const ext of [".md", ".markdown"]) {
    const withExt = byRel.get(lower + ext);
    if (withExt) return withExt;
  }
  // Bare basename (last path segment, stem only).
  const lastSlash = lower.lastIndexOf("/");
  const stem = stripExt(lastSlash >= 0 ? lower.slice(lastSlash + 1) : lower);
  const byStem = byBaseName.get(stem);
  if (byStem) return byStem;
  return null;
}

/** Strip a single trailing extension. "foo.bar.md" → "foo.bar". */
export function stripExt(name: string): string {
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return name;
  return name.slice(0, dot);
}

/**
 * Compute the absolute path for a *new* note created by clicking an
 * unresolved wiki link. Strategy: place it next to the current file with
 * a `.md` extension; fall back to the vault root if nothing is open.
 */
export function newNotePathForTarget(
  target: string,
  currentFilePath: string | null,
  vaultRoot: string,
): string {
  const cleaned = target.trim().replace(/[/\\]+$/, "");
  const hasExt = /\.(md|markdown)$/i.test(cleaned);
  const filename = hasExt ? cleaned : cleaned + ".md";
  // If target contains a path separator, treat it as relative to vault root.
  if (filename.includes("/") || filename.includes("\\")) {
    return joinPath(vaultRoot, filename);
  }
  // Otherwise create alongside the current file (or at vault root).
  const baseDir = currentFilePath
    ? currentFilePath.replace(/[\\/][^\\/]*$/, "")
    : vaultRoot;
  return joinPath(baseDir, filename);
}

function joinPath(a: string, b: string): string {
  const sep = a.includes("\\") ? "\\" : "/";
  return a.replace(/[\\/]$/, "") + sep + b.replace(/^[\\/]/, "");
}
