import { invoke } from "@tauri-apps/api/core";

export type ThemePresetId =
  | "catppuccin-mocha"
  | "catppuccin-latte"
  | "github-dark"
  | "github-light"
  | "dracula"
  | "nord"
  | "tokyo-night"
  | "rose-pine"
  | "solarized-dark"
  | "solarized-light";

export interface AppSettings {
  theme: ThemePresetId;
  editorFontFamily: string;
  editorFontSize: number;
  previewFontFamily: string;
  previewFontSize: number;
  previewLineHeight: number;
  showLineNumbers: boolean;
  showToc: boolean;
  lastOpenedFolder: string | null;
  recentFolders: string[];
}

export const DEFAULT_SETTINGS: AppSettings = {
  theme: "catppuccin-mocha",
  editorFontFamily: '"SF Mono", "Fira Code", monospace',
  editorFontSize: 14,
  previewFontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  previewFontSize: 15,
  previewLineHeight: 1.7,
  showLineNumbers: true,
  showToc: true,
  lastOpenedFolder: null,
  recentFolders: [],
};

/** Runtime-validate parsed settings to prevent corrupted/malicious values. */
export function sanitizeSettings(raw: Record<string, unknown>): Partial<AppSettings> {
  const safe: Partial<AppSettings> = {};
  if (typeof raw.theme === "string") safe.theme = raw.theme as ThemePresetId;
  if (typeof raw.editorFontFamily === "string") safe.editorFontFamily = raw.editorFontFamily;
  if (typeof raw.editorFontSize === "number" && raw.editorFontSize > 0) safe.editorFontSize = raw.editorFontSize;
  if (typeof raw.previewFontFamily === "string") safe.previewFontFamily = raw.previewFontFamily;
  if (typeof raw.previewFontSize === "number" && raw.previewFontSize > 0) safe.previewFontSize = raw.previewFontSize;
  if (typeof raw.previewLineHeight === "number" && raw.previewLineHeight > 0) safe.previewLineHeight = raw.previewLineHeight;
  if (typeof raw.showLineNumbers === "boolean") safe.showLineNumbers = raw.showLineNumbers;
  if (typeof raw.showToc === "boolean") safe.showToc = raw.showToc;
  if (raw.lastOpenedFolder === null || typeof raw.lastOpenedFolder === "string") safe.lastOpenedFolder = raw.lastOpenedFolder as string | null;
  if (Array.isArray(raw.recentFolders) && raw.recentFolders.every((f: unknown) => typeof f === "string")) {
    safe.recentFolders = raw.recentFolders as string[];
  }
  return safe;
}

export async function loadSettings(): Promise<AppSettings> {
  try {
    const json = await invoke<string>("load_settings");
    const parsed = JSON.parse(json);
    return { ...DEFAULT_SETTINGS, ...sanitizeSettings(parsed) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  try {
    await invoke("save_settings", { settings: JSON.stringify(settings) });
  } catch (e) {
    console.error("Failed to save settings:", e);
  }
}
