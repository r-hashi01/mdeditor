import { EditorView, basicSetup } from "codemirror";
import { keymap, ViewPlugin, WidgetType, Decoration, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { oneDark } from "@codemirror/theme-one-dark";
import { EditorState, StateField, Compartment, Prec, RangeSetBuilder, StateEffect, type Extension } from "@codemirror/state";
import { LanguageDescription } from "@codemirror/language";
import { openSearchPanel } from "@codemirror/search";
/** Languages available inside Markdown fenced code blocks.
 *  Each entry dynamic-imports its grammar only when the fenced block's lang is matched,
 *  so unused grammars don't bloat the initial bundle. */
const codeLanguages = [
  LanguageDescription.of({ name: "JavaScript", alias: ["js", "jsx", "ts", "tsx", "typescript"], load: async () => (await import("@codemirror/lang-javascript")).javascript() }),
  LanguageDescription.of({ name: "Python", alias: ["py"], load: async () => (await import("@codemirror/lang-python")).python() }),
  LanguageDescription.of({ name: "Rust", alias: ["rs"], load: async () => (await import("@codemirror/lang-rust")).rust() }),
  LanguageDescription.of({ name: "CSS", alias: ["scss", "less"], load: async () => (await import("@codemirror/lang-css")).css() }),
  LanguageDescription.of({ name: "HTML", alias: ["htm", "xml", "svg"], load: async () => (await import("@codemirror/lang-html")).html() }),
  LanguageDescription.of({ name: "JSON", load: async () => (await import("@codemirror/lang-json")).json() }),
  LanguageDescription.of({ name: "YAML", alias: ["yml"], load: async () => (await import("@codemirror/lang-yaml")).yaml() }),
  LanguageDescription.of({ name: "XML", load: async () => (await import("@codemirror/lang-xml")).xml() }),
  LanguageDescription.of({ name: "SQL", load: async () => (await import("@codemirror/lang-sql")).sql() }),
  LanguageDescription.of({ name: "Dockerfile", alias: ["docker"], load: async () => (await import("./lang-dockerfile")).dockerfile() }),
  LanguageDescription.of({ name: "Shell", alias: ["sh", "bash", "zsh"], load: async () => (await import("./lang-bash")).bash() }),
];

/* ── Shared helpers for YAML value decoration ──
 * Uses inline styles with CSS custom properties (--syn-*) instead of
 * CSS classes to work around WebKit/Tauri WebView style-mod scoping issues.
 */
const YAML_BOOL = /^(true|false|yes|no|on|off)$/i;
const YAML_NULL = /^(null|~)$/i;
const YAML_NUMBER = /^[+-]?(\d[\d_]*\.?[\d_]*([eE][+-]?\d+)?|0x[\da-fA-F_]+|0o[0-7_]+|\.inf|\.nan)$/;

const yamlBoolDeco = Decoration.mark({ attributes: { style: "color: var(--syn-bool); font-weight: bold;" } });
const yamlNullDeco = Decoration.mark({ attributes: { style: "color: var(--syn-null); font-style: italic;" } });
const yamlNumberDeco = Decoration.mark({ attributes: { style: "color: var(--syn-number);" } });
const yamlPlainDeco = Decoration.mark({ attributes: { style: "color: var(--syn-string);" } });
const fmDelimiterDeco = Decoration.mark({ attributes: { style: "color: var(--syn-meta); font-weight: bold;" } });
const fmKeyDeco = Decoration.mark({ attributes: { style: "color: var(--syn-property);" } });
const fmCommentDeco = Decoration.mark({ attributes: { style: "color: var(--syn-comment); font-style: italic;" } });

// CSS decorations (for style: | block scalars in frontmatter)
const cssSelectorDeco = Decoration.mark({ attributes: { style: "color: var(--syn-tag);" } });
const cssPropDeco = Decoration.mark({ attributes: { style: "color: var(--syn-property);" } });
const cssValueDeco = Decoration.mark({ attributes: { style: "color: var(--syn-string);" } });
const cssNumDeco = Decoration.mark({ attributes: { style: "color: var(--syn-number);" } });
const cssPuncDeco = Decoration.mark({ attributes: { style: "color: var(--syn-operator);" } });

const CSS_NUMBER = /^[\d.]+(?:px|em|rem|%|vh|vw|pt|cm|mm|in|s|ms|deg|fr)?$/;
const CSS_COLOR_HEX = /^#[\da-fA-F]{3,8}$/;

function addCssDecorations(builder: RangeSetBuilder<Decoration>, line: { from: number; to: number; text: string }): void {
  const text = line.text;
  const trimmed = text.trimStart();
  const indent = text.length - trimmed.length;
  if (!trimmed || trimmed.startsWith("/*") || trimmed.startsWith("*")) return;

  if (trimmed === "}") {
    // Closing brace
    builder.add(line.from + indent, line.from + indent + 1, cssPuncDeco);
  } else if (trimmed.endsWith("{")) {
    // Selector line: "h1 {" or "section {"
    const braceIdx = trimmed.lastIndexOf("{");
    const selector = trimmed.slice(0, braceIdx).trimEnd();
    if (selector) {
      builder.add(line.from + indent, line.from + indent + selector.length, cssSelectorDeco);
    }
    builder.add(line.from + text.lastIndexOf("{"), line.from + text.lastIndexOf("{") + 1, cssPuncDeco);
  } else {
    // Property: value; line
    const colonIdx = trimmed.indexOf(":");
    if (colonIdx >= 0) {
      const prop = trimmed.slice(0, colonIdx).trimEnd();
      if (prop) {
        builder.add(line.from + indent, line.from + indent + prop.length, cssPropDeco);
      }
      // Value part (after colon, before optional semicolon)
      let valPart = trimmed.slice(colonIdx + 1).trim();
      if (valPart.endsWith(";")) valPart = valPart.slice(0, -1).trimEnd();
      if (valPart) {
        // Find value position in original text
        const afterColonPos = text.indexOf(":", indent) + 1;
        const valInRest = text.slice(afterColonPos);
        const valOffset = afterColonPos + (valInRest.length - valInRest.trimStart().length);
        const valEnd = text.endsWith(";") ? line.to - 1 : line.to;
        const valStart = line.from + valOffset;
        if (valStart < valEnd) {
          // Use number deco for numeric/hex values, string deco otherwise
          if (CSS_NUMBER.test(valPart) || CSS_COLOR_HEX.test(valPart)) {
            builder.add(valStart, valEnd, cssNumDeco);
          } else {
            builder.add(valStart, valEnd, cssValueDeco);
          }
        }
      }
      // Semicolon
      if (text.trimEnd().endsWith(";")) {
        const semiPos = line.from + text.lastIndexOf(";");
        builder.add(semiPos, semiPos + 1, cssPuncDeco);
      }
    }
  }
}

/** Classify a YAML scalar value and add the appropriate decoration */
function addYamlValueDeco(builder: RangeSetBuilder<Decoration>, from: number, to: number, val: string): void {
  if (YAML_BOOL.test(val)) builder.add(from, to, yamlBoolDeco);
  else if (YAML_NULL.test(val)) builder.add(from, to, yamlNullDeco);
  else if (YAML_NUMBER.test(val)) builder.add(from, to, yamlNumberDeco);
  else builder.add(from, to, yamlPlainDeco);
}

/** Check if a value string should be decorated (not a quoted/block/flow scalar) */
function isDecorableYamlValue(val: string): boolean {
  return !!val && !"'\"|>&*[{#".includes(val[0]);
}

/* ── YAML value decorator (for .yaml/.yml files) ── */
function buildYamlDecorations(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  for (const { from, to } of view.visibleRanges) {
    for (let pos = from; pos < to; ) {
      const line = view.state.doc.lineAt(pos);
      const text = line.text;
      if (!text.trimStart().startsWith("#")) {
        const colonIdx = text.indexOf(": ");
        if (colonIdx >= 0) {
          const valStart = colonIdx + 2;
          const val = text.slice(valStart).trim();
          if (isDecorableYamlValue(val)) {
            const absStart = line.from + valStart + (text.slice(valStart).length - text.slice(valStart).trimStart().length);
            const absEnd = line.from + text.length;
            if (absStart < absEnd) addYamlValueDeco(builder, absStart, absEnd, val);
          }
        }
      }
      pos = line.to + 1;
    }
  }
  return builder.finish();
}

const yamlValuePlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) { this.decorations = buildYamlDecorations(view); }
    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged) {
        this.decorations = buildYamlDecorations(update.view);
      }
    }
  },
  { decorations: (v) => v.decorations },
);

/* ── Frontmatter decorator (StateField — more reliable than ViewPlugin in WebKit) ──
 * Detects the YAML frontmatter block (--- ... ---) at the start of a
 * Markdown document and decorates keys, values, delimiters, and comments.
 */
function buildFrontmatterDecorations(state: EditorState): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const doc = state.doc;
  if (doc.lines === 0) return builder.finish();

  const firstLine = doc.line(1);
  if (firstLine.text.trim() !== "---") return builder.finish();

  let endLineNum = -1;
  for (let i = 2; i <= doc.lines; i++) {
    if (/^---\s*$/.test(doc.line(i).text)) { endLineNum = i; break; }
  }
  if (endLineNum === -1) return builder.finish();

  let blockScalarIndent = -1; // track YAML block scalar (| or >)
  for (let i = 1; i <= endLineNum; i++) {
    const line = doc.line(i);
    const text = line.text;

    // Inside a block scalar: decorate as CSS until indentation returns to base level
    if (blockScalarIndent >= 0) {
      const indent = text.length - text.trimStart().length;
      if (text.trim() === "" || indent > blockScalarIndent) {
        addCssDecorations(builder, line);
        continue;
      }
      // Indentation returned to base → block scalar ended
      blockScalarIndent = -1;
    }

    if (i === 1 || i === endLineNum) {
      builder.add(line.from, line.to, fmDelimiterDeco);
    } else if (text.trimStart().startsWith("#")) {
      builder.add(line.from, line.to, fmCommentDeco);
    } else {
      const colonIdx = text.indexOf(":");
      if (colonIdx >= 0) {
        const keyStart = line.from + (text.length - text.trimStart().length);
        const keyEnd = line.from + colonIdx;
        if (keyStart < keyEnd) builder.add(keyStart, keyEnd, fmKeyDeco);
        const afterColon = colonIdx + 1;
        const rest = text.slice(afterColon);
        const val = rest.trim();
        // Detect block scalar indicators (| or >)
        if (val === "|" || val === ">" || val === "|-" || val === ">-") {
          blockScalarIndent = text.length - text.trimStart().length;
        } else if (isDecorableYamlValue(val)) {
          const absStart = line.from + afterColon + (rest.length - rest.trimStart().length);
          const absEnd = line.to;
          if (absStart < absEnd) addYamlValueDeco(builder, absStart, absEnd, val);
        }
      } else if (text.trimStart().startsWith("- ")) {
        const dashIdx = text.indexOf("- ");
        const val = text.slice(dashIdx + 2).trim();
        if (val) {
          const absStart = line.from + dashIdx + 2 + (text.slice(dashIdx + 2).length - text.slice(dashIdx + 2).trimStart().length);
          const absEnd = line.to;
          if (absStart < absEnd) builder.add(absStart, absEnd, yamlPlainDeco);
        }
      }
    }
  }
  return builder.finish();
}

const frontmatterField = StateField.define<DecorationSet>({
  create(state) { return buildFrontmatterDecorations(state); },
  update(value, tr) {
    if (tr.docChanged) return buildFrontmatterDecorations(tr.state);
    return value;
  },
  // Prec.highest ensures our decorations are innermost, overriding
  // the markdown parser's syntax highlighting (which misparses
  // frontmatter content as setext headings).
  provide: (f) => Prec.highest(EditorView.decorations.from(f)),
});

/* ── Color swatch widget for hex colors ── */
class ColorSwatchWidget extends WidgetType {
  constructor(readonly color: string) { super(); }
  toDOM() {
    const el = document.createElement("span");
    el.style.display = "inline-block";
    el.style.width = "0.85em";
    el.style.height = "0.85em";
    el.style.backgroundColor = this.color;
    el.style.borderRadius = "2px";
    el.style.marginRight = "3px";
    el.style.verticalAlign = "middle";
    el.style.border = "1px solid var(--text-secondary)";
    return el;
  }
  eq(other: ColorSwatchWidget) { return this.color === other.color; }
}

const HEX_COLOR_RE = /#(?:[\da-fA-F]{6}|[\da-fA-F]{3})\b/g;

function buildColorSwatches(state: EditorState): DecorationSet {
  const widgets: ReturnType<Decoration["range"]>[] = [];
  for (let i = 1; i <= state.doc.lines; i++) {
    const line = state.doc.line(i);
    HEX_COLOR_RE.lastIndex = 0;
    let match;
    while ((match = HEX_COLOR_RE.exec(line.text)) !== null) {
      const pos = line.from + match.index;
      widgets.push(
        Decoration.widget({ widget: new ColorSwatchWidget(match[0]), side: -1 }).range(pos),
      );
    }
  }
  return Decoration.set(widgets, true);
}

const colorSwatchField = StateField.define<DecorationSet>({
  create(state) { return buildColorSwatches(state); },
  update(value, tr) {
    if (tr.docChanged) return buildColorSwatches(tr.state);
    return value;
  },
  provide: (f) => EditorView.decorations.from(f),
});

/** Return the CodeMirror language extension for a given file path */
/** Async language loader — dynamic-imports the grammar so non-markdown languages
 *  aren't pulled into the initial bundle. Returns [] for unknown/plain text. */
async function loadLanguageForFile(filePath: string | null): Promise<Extension> {
  if (!filePath) return markdown({ base: markdownLanguage, codeLanguages });

  const fileName = filePath.split(/[\\/]/).pop()?.toLowerCase() ?? "";
  if (fileName === "dockerfile" || fileName.startsWith("dockerfile.")) {
    return (await import("./lang-dockerfile")).dockerfile();
  }

  const ext = fileName.split(".").pop() ?? "";
  switch (ext) {
    case "md": case "markdown":
      return markdown({ base: markdownLanguage, codeLanguages });
    case "json":
      return (await import("@codemirror/lang-json")).json();
    case "yaml": case "yml":
      return [(await import("@codemirror/lang-yaml")).yaml(), yamlValuePlugin];
    case "xml": case "svg":
      return (await import("@codemirror/lang-xml")).xml();
    case "html": case "htm":
      return (await import("@codemirror/lang-html")).html();
    case "js": case "jsx": case "mjs": case "cjs":
      return (await import("@codemirror/lang-javascript")).javascript();
    case "ts": case "tsx": case "mts": case "cts":
      return (await import("@codemirror/lang-javascript")).javascript({ typescript: true });
    case "py":
      return (await import("@codemirror/lang-python")).python();
    case "rs":
      return (await import("@codemirror/lang-rust")).rust();
    case "css": case "scss": case "less":
      return (await import("@codemirror/lang-css")).css();
    case "sql":
      return (await import("@codemirror/lang-sql")).sql();
    case "sh": case "bash": case "zsh":
      return (await import("./lang-bash")).bash();
    default:
      return [];
  }
}

/* ── Compartments for dynamic reconfiguration ── */
const themeCompartment = new Compartment();
const fontCompartment = new Compartment();
const languageCompartment = new Compartment();

/* ── Module-level state for reapplyStyle ── */
let sharedExtensions: Extension[] | null = null;
let currentTheme: Extension = oneDark;
let currentFontFamily = "";
let currentFontSize = 0;
let currentShowLineNumbers = true;
let currentLanguage: Extension = markdown({ base: markdownLanguage, codeLanguages });

export function createEditor(
  container: HTMLElement,
  onChange: (content: string) => void,
  onScroll?: (ratio: number) => void,
  initialTheme?: Extension,
): EditorView {
  const updateListener = EditorView.updateListener.of((update) => {
    if (update.docChanged) {
      onChange(update.state.doc.toString());
    }
  });

  currentTheme = initialTheme ?? oneDark;

  // Cmd+H → open search panel (with replace field) and focus replace input
  const replaceKeymap = keymap.of([
    {
      key: "Mod-h",
      run: (v: EditorView) => {
        openSearchPanel(v);
        // Focus the replace field after the panel opens
        requestAnimationFrame(() => {
          const panel = v.dom.querySelector(".cm-search");
          const replaceInput = panel?.querySelector('input[name="replace"]') as HTMLInputElement | null;
          if (replaceInput) replaceInput.focus();
        });
        return true;
      },
      scope: "editor search-panel",
    },
  ]);

  sharedExtensions = [
    basicSetup,
    replaceKeymap,
    languageCompartment.of(currentLanguage),
    themeCompartment.of(currentTheme),
    fontCompartment.of([]),
    updateListener,
    EditorView.lineWrapping,
    frontmatterField,
    colorSwatchField,
  ];

  const view = new EditorView({
    parent: container,
    state: EditorState.create({
      doc: "",
      extensions: sharedExtensions,
    }),
  });

  if (onScroll) {
    view.scrollDOM.addEventListener("scroll", () => {
      const el = view.scrollDOM;
      const maxScroll = el.scrollHeight - el.clientHeight;
      const ratio = maxScroll > 0 ? el.scrollTop / maxScroll : 0;
      onScroll(ratio);
    });
  }

  return view;
}

/** Switch syntax highlighting to match the given file path */
export function setEditorLanguage(view: EditorView, filePath: string | null): void {
  // Fire-and-forget: the compartment is empty for a few ms until the grammar loads,
  // then highlighting snaps in. Good enough for a local app on SSD.
  void loadLanguageForFile(filePath).then((ext) => {
    currentLanguage = ext;
    view.dispatch({ effects: languageCompartment.reconfigure(ext) });
  });
}

export function setEditorTheme(view: EditorView, themeExtension: Extension): void {
  currentTheme = themeExtension;
  view.dispatch({
    effects: themeCompartment.reconfigure(themeExtension),
  });
}

export function setEditorFont(
  view: EditorView,
  fontFamily: string,
  fontSize: number,
): void {
  currentFontFamily = fontFamily;
  currentFontSize = fontSize;
  view.dispatch({
    effects: fontCompartment.reconfigure(
      EditorView.theme({
        "&": { fontFamily, fontSize: fontSize + "px" },
        ".cm-content": { fontFamily, fontSize: fontSize + "px" },
        ".cm-gutters": { fontFamily, fontSize: fontSize + "px" },
      }),
    ),
  });
}

export function setEditorContent(view: EditorView, content: string): void {
  view.dispatch({
    changes: { from: 0, to: view.state.doc.length, insert: content },
  });
}

export function getEditorContent(view: EditorView): string {
  return view.state.doc.toString();
}

export function setLineNumbers(view: EditorView, show: boolean): void {
  currentShowLineNumbers = show;
  const gutters = view.dom.querySelector(".cm-gutters") as HTMLElement | null;
  if (gutters) {
    gutters.style.display = show ? "" : "none";
  }
}

/**
 * Create a new EditorState with the same extensions as the main EditorView.
 * Used by TabManager to create states for new tabs.
 */
export function createEditorState(content: string): EditorState {
  if (!sharedExtensions) {
    throw new Error("createEditor must be called before createEditorState");
  }
  return EditorState.create({
    doc: content,
    extensions: sharedExtensions,
  });
}

/**
 * Re-apply the current theme, font, and language to the EditorView after a setState() call.
 * Compartment configurations are baked into each EditorState, so after swapping
 * states we need to re-apply the current settings.
 */
export function reapplyStyle(view: EditorView): void {
  const effects: StateEffect<unknown>[] = [];
  effects.push(themeCompartment.reconfigure(currentTheme));
  effects.push(languageCompartment.reconfigure(currentLanguage));
  if (currentFontFamily && currentFontSize) {
    effects.push(
      fontCompartment.reconfigure(
        EditorView.theme({
          "&": { fontFamily: currentFontFamily, fontSize: currentFontSize + "px" },
          ".cm-content": { fontFamily: currentFontFamily, fontSize: currentFontSize + "px" },
          ".cm-gutters": { fontFamily: currentFontFamily, fontSize: currentFontSize + "px" },
        }),
      ),
    );
  }
  view.dispatch({ effects });
  // Re-apply line number visibility
  const gutters = view.dom.querySelector(".cm-gutters") as HTMLElement | null;
  if (gutters) {
    gutters.style.display = currentShowLineNumbers ? "" : "none";
  }
}
