import { type Extension } from "@codemirror/state";
import { EditorView } from "codemirror";
import { oneDark } from "@codemirror/theme-one-dark";
import {
  syntaxHighlighting,
  defaultHighlightStyle,
} from "@codemirror/language";
import type { ThemePresetId } from "./settings";

/* ── Highlight.js CSS (raw imports for dynamic injection) ── */
import hljsAtomDark from "highlight.js/styles/atom-one-dark.css?raw";
import hljsAtomLight from "highlight.js/styles/atom-one-light.css?raw";
import hljsGithubDark from "highlight.js/styles/github-dark.css?raw";
import hljsGithubLight from "highlight.js/styles/github.css?raw";

const HLJS_STYLES: Record<string, string> = {
  "atom-one-dark": hljsAtomDark,
  "atom-one-light": hljsAtomLight,
  "github-dark": hljsGithubDark,
  github: hljsGithubLight,
};

/* ── Theme preset type ── */
export interface ThemePreset {
  id: ThemePresetId;
  label: string;
  isDark: boolean;
  vars: {
    bgPrimary: string;
    bgSecondary: string;
    bgToolbar: string;
    textPrimary: string;
    textSecondary: string;
    accent: string;
    border: string;
    previewBg: string;
  };
  hljsTheme: string;
  mermaidTheme: string;
}

/* ── 4 Presets ── */
export const THEME_PRESETS: Record<ThemePresetId, ThemePreset> = {
  "catppuccin-mocha": {
    id: "catppuccin-mocha",
    label: "Catppuccin Mocha",
    isDark: true,
    vars: {
      bgPrimary: "#1e1e2e",
      bgSecondary: "#181825",
      bgToolbar: "#11111b",
      textPrimary: "#cdd6f4",
      textSecondary: "#a6adc8",
      accent: "#89b4fa",
      border: "#313244",
      previewBg: "#1e1e2e",
    },
    hljsTheme: "atom-one-dark",
    mermaidTheme: "dark",
  },
  "catppuccin-latte": {
    id: "catppuccin-latte",
    label: "Catppuccin Latte",
    isDark: false,
    vars: {
      bgPrimary: "#eff1f5",
      bgSecondary: "#e6e9ef",
      bgToolbar: "#dce0e8",
      textPrimary: "#4c4f69",
      textSecondary: "#6c6f85",
      accent: "#1e66f5",
      border: "#ccd0da",
      previewBg: "#eff1f5",
    },
    hljsTheme: "atom-one-light",
    mermaidTheme: "default",
  },
  "github-dark": {
    id: "github-dark",
    label: "GitHub Dark",
    isDark: true,
    vars: {
      bgPrimary: "#0d1117",
      bgSecondary: "#161b22",
      bgToolbar: "#010409",
      textPrimary: "#e6edf3",
      textSecondary: "#8b949e",
      accent: "#58a6ff",
      border: "#30363d",
      previewBg: "#0d1117",
    },
    hljsTheme: "github-dark",
    mermaidTheme: "dark",
  },
  "github-light": {
    id: "github-light",
    label: "GitHub Light",
    isDark: false,
    vars: {
      bgPrimary: "#ffffff",
      bgSecondary: "#f6f8fa",
      bgToolbar: "#f0f3f6",
      textPrimary: "#1f2328",
      textSecondary: "#656d76",
      accent: "#0969da",
      border: "#d0d7de",
      previewBg: "#ffffff",
    },
    hljsTheme: "github",
    mermaidTheme: "default",
  },
};

/* ── CodeMirror theme builder ── */
function buildLightCmTheme(preset: ThemePreset): Extension {
  return [
    EditorView.theme(
      {
        "&": {
          backgroundColor: preset.vars.bgPrimary,
          color: preset.vars.textPrimary,
        },
        ".cm-content": { caretColor: preset.vars.accent },
        "&.cm-focused .cm-cursor": { borderLeftColor: preset.vars.accent },
        "&.cm-focused .cm-selectionBackground, ::selection": {
          backgroundColor: preset.vars.accent + "33",
        },
        ".cm-gutters": {
          backgroundColor: preset.vars.bgSecondary,
          color: preset.vars.textSecondary,
          borderRight: "1px solid " + preset.vars.border,
        },
        ".cm-activeLineGutter": { backgroundColor: preset.vars.border },
        ".cm-activeLine": { backgroundColor: preset.vars.bgSecondary },
      },
      { dark: false },
    ),
    syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
  ];
}

export function getCodemirrorTheme(preset: ThemePreset): Extension {
  if (preset.isDark) {
    return oneDark;
  }
  return buildLightCmTheme(preset);
}

/* ── Highlight.js dynamic CSS injection ── */
export function applyHljsTheme(themeName: string): void {
  let styleEl = document.getElementById("hljs-theme") as HTMLStyleElement | null;
  if (!styleEl) {
    styleEl = document.createElement("style");
    styleEl.id = "hljs-theme";
    document.head.appendChild(styleEl);
  }
  styleEl.textContent = HLJS_STYLES[themeName] ?? HLJS_STYLES["atom-one-dark"];
}
