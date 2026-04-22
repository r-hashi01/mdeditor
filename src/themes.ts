import { type Extension } from "@codemirror/state";
import { EditorView } from "codemirror";
import { oneDark } from "@codemirror/theme-one-dark";
import {
  syntaxHighlighting,
  defaultHighlightStyle,
  HighlightStyle,
} from "@codemirror/language";
import { tags } from "@lezer/highlight";
import type { ThemePresetId } from "./settings";

/* ── Highlight.js CSS (on-demand loaders; only active theme reaches the wire) ── */
type CssLoader = () => Promise<{ default: string }>;
const HLJS_LOADERS: Record<string, CssLoader> = {
  "atom-one-dark": () => import("highlight.js/styles/atom-one-dark.css?raw"),
  "atom-one-light": () => import("highlight.js/styles/atom-one-light.css?raw"),
  "github-dark": () => import("highlight.js/styles/github-dark.css?raw"),
  github: () => import("highlight.js/styles/github.css?raw"),
  dracula: () => import("highlight.js/styles/base16/dracula.css?raw"),
  nord: () => import("highlight.js/styles/nord.css?raw"),
  "tokyo-night-dark": () => import("highlight.js/styles/tokyo-night-dark.css?raw"),
  "tokyo-night-light": () => import("highlight.js/styles/tokyo-night-light.css?raw"),
  "rose-pine": () => import("highlight.js/styles/rose-pine.css?raw"),
  "rose-pine-dawn": () => import("highlight.js/styles/rose-pine-dawn.css?raw"),
  "solarized-dark": () => import("highlight.js/styles/base16/solarized-dark.css?raw"),
  "solarized-light": () => import("highlight.js/styles/base16/solarized-light.css?raw"),
};

const HLJS_CACHE = new Map<string, string>();

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
  dracula: {
    id: "dracula",
    label: "Dracula",
    isDark: true,
    vars: {
      bgPrimary: "#282a36",
      bgSecondary: "#21222c",
      bgToolbar: "#191a21",
      textPrimary: "#f8f8f2",
      textSecondary: "#6272a4",
      accent: "#bd93f9",
      border: "#44475a",
      previewBg: "#282a36",
    },
    hljsTheme: "dracula",
    mermaidTheme: "dark",
  },
  nord: {
    id: "nord",
    label: "Nord",
    isDark: true,
    vars: {
      bgPrimary: "#2e3440",
      bgSecondary: "#3b4252",
      bgToolbar: "#272c36",
      textPrimary: "#d8dee9",
      textSecondary: "#7b88a1",
      accent: "#88c0d0",
      border: "#434c5e",
      previewBg: "#2e3440",
    },
    hljsTheme: "nord",
    mermaidTheme: "dark",
  },
  "tokyo-night": {
    id: "tokyo-night",
    label: "Tokyo Night",
    isDark: true,
    vars: {
      bgPrimary: "#1a1b26",
      bgSecondary: "#16161e",
      bgToolbar: "#13131a",
      textPrimary: "#a9b1d6",
      textSecondary: "#565f89",
      accent: "#7aa2f7",
      border: "#292e42",
      previewBg: "#1a1b26",
    },
    hljsTheme: "tokyo-night-dark",
    mermaidTheme: "dark",
  },
  "rose-pine": {
    id: "rose-pine",
    label: "Rosé Pine",
    isDark: true,
    vars: {
      bgPrimary: "#191724",
      bgSecondary: "#1f1d2e",
      bgToolbar: "#15131e",
      textPrimary: "#e0def4",
      textSecondary: "#6e6a86",
      accent: "#c4a7e7",
      border: "#26233a",
      previewBg: "#191724",
    },
    hljsTheme: "rose-pine",
    mermaidTheme: "dark",
  },
  "solarized-dark": {
    id: "solarized-dark",
    label: "Solarized Dark",
    isDark: true,
    vars: {
      bgPrimary: "#002b36",
      bgSecondary: "#073642",
      bgToolbar: "#00212b",
      textPrimary: "#839496",
      textSecondary: "#586e75",
      accent: "#268bd2",
      border: "#094352",
      previewBg: "#002b36",
    },
    hljsTheme: "solarized-dark",
    mermaidTheme: "dark",
  },
  "solarized-light": {
    id: "solarized-light",
    label: "Solarized Light",
    isDark: false,
    vars: {
      bgPrimary: "#fdf6e3",
      bgSecondary: "#eee8d5",
      bgToolbar: "#e6dfcc",
      textPrimary: "#657b83",
      textSecondary: "#93a1a1",
      accent: "#268bd2",
      border: "#d3cbb7",
      previewBg: "#fdf6e3",
    },
    hljsTheme: "solarized-light",
    mermaidTheme: "default",
  },
};

/* ── Syntax highlight color palettes per theme ── */
interface SyntaxColors {
  keyword: string;
  string: string;
  number: string;
  bool: string;
  null_: string;
  property: string;
  comment: string;
  type: string;
  function_: string;
  operator: string;
  tag: string;
  attribute: string;
  meta: string;
  heading: string;
  link: string;
  code: string;
}

const SYNTAX_COLORS: Record<ThemePresetId, SyntaxColors> = {
  "catppuccin-mocha": {
    keyword: "#cba6f7",   // mauve
    string: "#a6e3a1",    // green
    number: "#fab387",    // peach
    bool: "#fab387",      // peach
    null_: "#f38ba8",     // red
    property: "#89b4fa",  // blue
    comment: "#6c7086",   // overlay0
    type: "#f9e2af",      // yellow
    function_: "#89dceb", // sky
    operator: "#94e2d5",  // teal
    tag: "#f38ba8",       // red
    attribute: "#fab387", // peach
    meta: "#f5c2e7",      // pink
    heading: "#89b4fa",   // blue
    link: "#89dceb",      // sky
    code: "#a6e3a1",      // green
  },
  "catppuccin-latte": {
    keyword: "#8839ef",   // mauve
    string: "#40a02b",    // green
    number: "#fe640b",    // peach
    bool: "#fe640b",      // peach
    null_: "#d20f39",     // red
    property: "#1e66f5",  // blue
    comment: "#9ca0b0",   // overlay0
    type: "#df8e1d",      // yellow
    function_: "#04a5e5", // sky
    operator: "#179299",  // teal
    tag: "#d20f39",       // red
    attribute: "#fe640b", // peach
    meta: "#ea76cb",      // pink
    heading: "#1e66f5",   // blue
    link: "#04a5e5",      // sky
    code: "#40a02b",      // green
  },
  "github-dark": {
    keyword: "#ff7b72",   // red
    string: "#a5d6ff",    // light blue
    number: "#79c0ff",    // blue
    bool: "#79c0ff",      // blue
    null_: "#ff7b72",     // red
    property: "#d2a8ff",  // purple
    comment: "#8b949e",   // grey
    type: "#ffa657",      // orange
    function_: "#d2a8ff", // purple
    operator: "#ff7b72",  // red
    tag: "#7ee787",       // green
    attribute: "#79c0ff", // blue
    meta: "#ffa657",      // orange
    heading: "#58a6ff",   // blue
    link: "#58a6ff",      // blue
    code: "#a5d6ff",      // light blue
  },
  "github-light": {
    keyword: "#cf222e",   // red
    string: "#0a3069",    // dark blue
    number: "#0550ae",    // blue
    bool: "#0550ae",      // blue
    null_: "#cf222e",     // red
    property: "#8250df",  // purple
    comment: "#6e7781",   // grey
    type: "#953800",      // orange
    function_: "#8250df", // purple
    operator: "#cf222e",  // red
    tag: "#116329",       // green
    attribute: "#0550ae", // blue
    meta: "#953800",      // orange
    heading: "#0969da",   // blue
    link: "#0969da",      // blue
    code: "#0a3069",      // dark blue
  },
  dracula: {
    keyword: "#ff79c6",   // pink
    string: "#f1fa8c",    // yellow
    number: "#bd93f9",    // purple
    bool: "#bd93f9",      // purple
    null_: "#ff79c6",     // pink
    property: "#66d9ef",  // cyan
    comment: "#6272a4",   // comment grey
    type: "#8be9fd",      // cyan italic
    function_: "#50fa7b", // green
    operator: "#ff79c6",  // pink
    tag: "#ff79c6",       // pink
    attribute: "#50fa7b", // green
    meta: "#f1fa8c",      // yellow
    heading: "#bd93f9",   // purple
    link: "#8be9fd",      // cyan
    code: "#f1fa8c",      // yellow
  },
  nord: {
    keyword: "#81a1c1",   // nord9
    string: "#a3be8c",    // nord14 green
    number: "#b48ead",    // nord15 purple
    bool: "#b48ead",      // nord15
    null_: "#81a1c1",     // nord9
    property: "#88c0d0",  // nord8 cyan
    comment: "#616e88",   // muted
    type: "#ebcb8b",      // nord13 yellow
    function_: "#88c0d0", // nord8
    operator: "#81a1c1",  // nord9
    tag: "#bf616a",       // nord11 red
    attribute: "#d08770", // nord12 orange
    meta: "#b48ead",      // nord15
    heading: "#88c0d0",   // nord8 cyan
    link: "#88c0d0",      // nord8
    code: "#a3be8c",      // nord14 green
  },
  "tokyo-night": {
    keyword: "#bb9af7",   // purple
    string: "#9ece6a",    // green
    number: "#ff9e64",    // orange
    bool: "#ff9e64",      // orange
    null_: "#f7768e",     // red
    property: "#7dcfff",  // cyan
    comment: "#565f89",   // comment
    type: "#2ac3de",      // teal
    function_: "#7aa2f7", // blue
    operator: "#89ddff",  // light cyan
    tag: "#f7768e",       // red
    attribute: "#bb9af7", // purple
    meta: "#ff9e64",      // orange
    heading: "#7aa2f7",   // blue
    link: "#7dcfff",      // cyan
    code: "#9ece6a",      // green
  },
  "rose-pine": {
    keyword: "#31748f",   // pine
    string: "#f6c177",    // gold
    number: "#ea9a97",    // rose
    bool: "#ea9a97",      // rose
    null_: "#eb6f92",     // love
    property: "#c4a7e7",  // iris
    comment: "#6e6a86",   // muted
    type: "#9ccfd8",      // foam
    function_: "#c4a7e7", // iris
    operator: "#31748f",  // pine
    tag: "#eb6f92",       // love
    attribute: "#f6c177", // gold
    meta: "#ea9a97",      // rose
    heading: "#c4a7e7",   // iris
    link: "#9ccfd8",      // foam
    code: "#f6c177",      // gold
  },
  "solarized-dark": {
    keyword: "#859900",   // green
    string: "#2aa198",    // cyan
    number: "#d33682",    // magenta
    bool: "#cb4b16",      // orange
    null_: "#dc322f",     // red
    property: "#268bd2",  // blue
    comment: "#586e75",   // base01
    type: "#b58900",      // yellow
    function_: "#268bd2", // blue
    operator: "#859900",  // green
    tag: "#cb4b16",       // orange
    attribute: "#2aa198", // cyan
    meta: "#6c71c4",      // violet
    heading: "#268bd2",   // blue
    link: "#268bd2",      // blue
    code: "#2aa198",      // cyan
  },
  "solarized-light": {
    keyword: "#859900",   // green
    string: "#2aa198",    // cyan
    number: "#d33682",    // magenta
    bool: "#cb4b16",      // orange
    null_: "#dc322f",     // red
    property: "#268bd2",  // blue
    comment: "#93a1a1",   // base1
    type: "#b58900",      // yellow
    function_: "#268bd2", // blue
    operator: "#859900",  // green
    tag: "#cb4b16",       // orange
    attribute: "#2aa198", // cyan
    meta: "#6c71c4",      // violet
    heading: "#268bd2",   // blue
    link: "#268bd2",      // blue
    code: "#2aa198",      // cyan
  },
};

function buildHighlightStyle(c: SyntaxColors): HighlightStyle {
  return HighlightStyle.define([
    { tag: tags.keyword, color: c.keyword, fontWeight: "bold" },
    { tag: tags.controlKeyword, color: c.keyword, fontWeight: "bold" },
    { tag: tags.moduleKeyword, color: c.keyword, fontWeight: "bold" },
    { tag: tags.operatorKeyword, color: c.keyword, fontWeight: "bold" },
    { tag: tags.string, color: c.string },
    { tag: tags.special(tags.string), color: c.string },
    { tag: tags.number, color: c.number },
    { tag: tags.integer, color: c.number },
    { tag: tags.float, color: c.number },
    { tag: tags.bool, color: c.bool, fontWeight: "bold" },
    { tag: tags.null, color: c.null_, fontStyle: "italic" },
    { tag: tags.propertyName, color: c.property },
    { tag: tags.definition(tags.propertyName), color: c.property },
    { tag: tags.comment, color: c.comment, fontStyle: "italic" },
    { tag: tags.lineComment, color: c.comment, fontStyle: "italic" },
    { tag: tags.blockComment, color: c.comment, fontStyle: "italic" },
    { tag: tags.typeName, color: c.type },
    { tag: tags.className, color: c.type },
    { tag: tags.function(tags.variableName), color: c.function_ },
    { tag: tags.definition(tags.variableName), color: c.function_ },
    { tag: tags.operator, color: c.operator },
    { tag: tags.punctuation, color: c.operator },
    { tag: tags.tagName, color: c.tag },
    { tag: tags.attributeName, color: c.attribute },
    { tag: tags.meta, color: c.meta },
    { tag: tags.atom, color: c.bool },
    { tag: tags.variableName, color: c.property },
    { tag: tags.labelName, color: c.property },
    // Markdown
    { tag: tags.heading1, color: c.heading, fontWeight: "bold" },
    { tag: tags.heading2, color: c.heading, fontWeight: "bold" },
    { tag: tags.heading3, color: c.heading, fontWeight: "bold" },
    { tag: tags.heading4, color: c.heading, fontWeight: "bold" },
    { tag: tags.heading5, color: c.heading, fontWeight: "bold" },
    { tag: tags.heading6, color: c.heading, fontWeight: "bold" },
    { tag: tags.emphasis, fontStyle: "italic" },
    { tag: tags.strong, fontWeight: "bold" },
    { tag: tags.link, color: c.link, textDecoration: "underline" },
    { tag: tags.url, color: c.link },
    { tag: tags.monospace, color: c.code },
    { tag: tags.strikethrough, textDecoration: "line-through" },
    { tag: tags.quote, color: c.comment, fontStyle: "italic" },
    { tag: tags.contentSeparator, color: c.comment },
  ]);
}

/* ── CodeMirror theme builder ── */
function buildCmTheme(preset: ThemePreset): Extension {
  const colors = SYNTAX_COLORS[preset.id];
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
        // YAML unquoted value decorations (used in YAML files & frontmatter)
        ".cm-yaml-bool": { color: colors.bool, fontWeight: "bold" },
        ".cm-yaml-null": { color: colors.null_, fontStyle: "italic" },
        ".cm-yaml-number": { color: colors.number },
        ".cm-yaml-plain": { color: colors.string },
        // Frontmatter decorations
        ".cm-fm-delimiter": { color: colors.meta, fontWeight: "bold" },
        ".cm-fm-key": { color: colors.property },
        ".cm-fm-comment": { color: colors.comment, fontStyle: "italic" },
      },
      { dark: preset.isDark },
    ),
    syntaxHighlighting(buildHighlightStyle(colors)),
    syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
  ];
}

export function getCodemirrorTheme(preset: ThemePreset): Extension {
  return buildCmTheme(preset);
}

/** Return syntax colour palette for the given preset (used by theme-apply for CSS vars) */
export function getSyntaxColors(preset: ThemePreset): SyntaxColors {
  return SYNTAX_COLORS[preset.id];
}

/* ── Highlight.js dynamic CSS injection ── */
export function applyHljsTheme(themeName: string): void {
  let styleEl = document.getElementById("hljs-theme") as HTMLStyleElement | null;
  if (!styleEl) {
    styleEl = document.createElement("style");
    styleEl.id = "hljs-theme";
    document.head.appendChild(styleEl);
  }
  const target = styleEl;
  const cached = HLJS_CACHE.get(themeName);
  if (cached !== undefined) {
    target.textContent = cached;
    return;
  }
  const loader = HLJS_LOADERS[themeName] ?? HLJS_LOADERS["atom-one-dark"];
  void loader().then((mod) => {
    HLJS_CACHE.set(themeName, mod.default);
    if (document.getElementById("hljs-theme") === target) {
      target.textContent = mod.default;
    }
  }).catch(() => {});
}
