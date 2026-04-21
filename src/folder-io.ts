import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { isBinaryFile } from "./binary-exts";

export interface DirEntry {
  name: string;
  path: string;
  is_dir: boolean;
}

/**
 * Open a native folder picker dialog, then whitelist the selected directory.
 */
export async function openFolder(): Promise<string | null> {
  const folderPath = await open({
    multiple: false,
    directory: true,
  });
  if (!folderPath) return null;
  await invoke("allow_dir", { path: folderPath });
  return folderPath;
}

/**
 * Re-open a previously opened folder (no dialog — validated against saved settings).
 * Returns false if the directory no longer exists or wasn't in saved settings.
 */
export async function reopenFolder(folderPath: string): Promise<boolean> {
  try {
    await invoke("reopen_dir", { path: folderPath });
    // Verify the directory is still accessible
    await invoke<DirEntry[]>("list_directory", { path: folderPath });
    return true;
  } catch {
    return false;
  }
}

/**
 * List contents of a directory (must be under an allowed folder).
 */
export async function listDirectory(path: string): Promise<DirEntry[]> {
  return invoke<DirEntry[]>("list_directory", { path });
}

/**
 * Open a file from the tree — no allow_path needed since read_file checks AllowedDirs.
 */
export async function openFileFromTree(
  path: string,
): Promise<{ path: string; content: string; binary: boolean }> {
  // Binary files — skip text reading, just pass the path
  if (isBinaryFile(path)) {
    return { path, content: "", binary: true };
  }
  const content = await invoke<string>("read_file", { path });
  return { path, content, binary: false };
}
