import { invoke } from "@tauri-apps/api/core";

export type ThemePresetId =
  | "catppuccin-mocha"
  | "catppuccin-latte"
  | "github-dark"
  | "github-light";

export interface AppSettings {
  theme: ThemePresetId;
  editorFontFamily: string;
  editorFontSize: number;
  previewFontFamily: string;
  previewFontSize: number;
  previewLineHeight: number;
}

export const DEFAULT_SETTINGS: AppSettings = {
  theme: "catppuccin-mocha",
  editorFontFamily: '"SF Mono", "Fira Code", monospace',
  editorFontSize: 14,
  previewFontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  previewFontSize: 15,
  previewLineHeight: 1.7,
};

export async function loadSettings(): Promise<AppSettings> {
  try {
    const json = await invoke<string>("load_settings");
    const parsed = JSON.parse(json);
    return { ...DEFAULT_SETTINGS, ...parsed };
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
