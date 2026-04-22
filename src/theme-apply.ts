import type { EditorView } from "codemirror";
import type { AppSettings } from "./settings";
import { THEME_PRESETS, getCodemirrorTheme, applyHljsTheme, getSyntaxColors } from "./themes";
import { setEditorTheme, setEditorFont, setLineNumbers } from "./editor";
import { setMermaidTheme } from "./mermaid-theme-state";

function applyCssVariables(preset: (typeof THEME_PRESETS)[keyof typeof THEME_PRESETS]): void {
  const root = document.documentElement;
  root.style.setProperty("--bg-primary", preset.vars.bgPrimary);
  root.style.setProperty("--bg-secondary", preset.vars.bgSecondary);
  root.style.setProperty("--bg-toolbar", preset.vars.bgToolbar);
  root.style.setProperty("--text-primary", preset.vars.textPrimary);
  root.style.setProperty("--text-secondary", preset.vars.textSecondary);
  root.style.setProperty("--accent", preset.vars.accent);
  root.style.setProperty("--border", preset.vars.border);
  root.style.setProperty("--preview-bg", preset.vars.previewBg);

  // Syntax colours for frontmatter / YAML decorations (WebKit workaround)
  const syn = getSyntaxColors(preset);
  root.style.setProperty("--syn-meta", syn.meta);
  root.style.setProperty("--syn-property", syn.property);
  root.style.setProperty("--syn-comment", syn.comment);
  root.style.setProperty("--syn-bool", syn.bool);
  root.style.setProperty("--syn-null", syn.null_);
  root.style.setProperty("--syn-number", syn.number);
  root.style.setProperty("--syn-string", syn.string);
  root.style.setProperty("--syn-keyword", syn.keyword);
  root.style.setProperty("--syn-tag", syn.tag);
  root.style.setProperty("--syn-operator", syn.operator);
}

function applyFontVariables(settings: AppSettings): void {
  const root = document.documentElement;
  root.style.setProperty("--editor-font-family", settings.editorFontFamily);
  root.style.setProperty("--editor-font-size", settings.editorFontSize + "px");
  root.style.setProperty("--preview-font-family", settings.previewFontFamily);
  root.style.setProperty("--preview-font-size", settings.previewFontSize + "px");
  root.style.setProperty("--preview-line-height", String(settings.previewLineHeight));
}

export function applySettings(settings: AppSettings, editorView: EditorView): void {
  const preset = THEME_PRESETS[settings.theme];

  // 1. CSS variables (UI chrome + preview)
  applyCssVariables(preset);
  applyFontVariables(settings);

  // 2. CodeMirror theme + font
  setEditorTheme(editorView, getCodemirrorTheme(preset));
  setEditorFont(editorView, settings.editorFontFamily, settings.editorFontSize);

  // 3. Highlight.js CSS
  applyHljsTheme(preset.hljsTheme);

  // 4. Mermaid theme
  setMermaidTheme(preset.mermaidTheme);

  // 5. Line numbers
  setLineNumbers(editorView, settings.showLineNumbers);
}
