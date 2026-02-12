import { EditorView, basicSetup } from "codemirror";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { oneDark } from "@codemirror/theme-one-dark";
import { EditorState } from "@codemirror/state";
import { LanguageDescription } from "@codemirror/language";
import { javascript } from "@codemirror/lang-javascript";
import { python } from "@codemirror/lang-python";
import { rust } from "@codemirror/lang-rust";
import { css } from "@codemirror/lang-css";
import { html } from "@codemirror/lang-html";
import { json } from "@codemirror/lang-json";

const codeLanguages = [
  LanguageDescription.of({ name: "JavaScript", alias: ["js", "jsx", "ts", "tsx", "typescript"], load: async () => javascript() }),
  LanguageDescription.of({ name: "Python", alias: ["py"], load: async () => python() }),
  LanguageDescription.of({ name: "Rust", alias: ["rs"], load: async () => rust() }),
  LanguageDescription.of({ name: "CSS", alias: ["scss", "less"], load: async () => css() }),
  LanguageDescription.of({ name: "HTML", alias: ["htm", "xml", "svg"], load: async () => html() }),
  LanguageDescription.of({ name: "JSON", load: async () => json() }),
];

export function createEditor(
  container: HTMLElement,
  onChange: (content: string) => void,
  onScroll?: (ratio: number) => void,
): EditorView {
  const updateListener = EditorView.updateListener.of((update) => {
    if (update.docChanged) {
      onChange(update.state.doc.toString());
    }
  });

  const view = new EditorView({
    parent: container,
    state: EditorState.create({
      doc: "# Welcome to mdeditor\n\nStart typing Markdown here...\n\n## Features\n\n- **Real-time preview** on the right\n- Syntax highlighting\n- Open/Save files with `Cmd+O` / `Cmd+S`\n\n```js\nconsole.log(\"Hello, mdeditor!\");\n```\n",
      extensions: [
        basicSetup,
        markdown({ base: markdownLanguage, codeLanguages }),
        oneDark,
        updateListener,
        EditorView.lineWrapping,
      ],
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

export function setEditorContent(view: EditorView, content: string): void {
  view.dispatch({
    changes: { from: 0, to: view.state.doc.length, insert: content },
  });
}

export function getEditorContent(view: EditorView): string {
  return view.state.doc.toString();
}
