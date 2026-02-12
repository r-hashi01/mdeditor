import { Marked } from "marked";
import hljs from "highlight.js/lib/core";
import javascript from "highlight.js/lib/languages/javascript";
import typescript from "highlight.js/lib/languages/typescript";
import python from "highlight.js/lib/languages/python";
import rust from "highlight.js/lib/languages/rust";
import bash from "highlight.js/lib/languages/bash";
import json from "highlight.js/lib/languages/json";
import css from "highlight.js/lib/languages/css";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";
import ini from "highlight.js/lib/languages/ini";
import properties from "highlight.js/lib/languages/properties";

hljs.registerLanguage("javascript", javascript);
hljs.registerLanguage("js", javascript);
hljs.registerLanguage("typescript", typescript);
hljs.registerLanguage("ts", typescript);
hljs.registerLanguage("python", python);
hljs.registerLanguage("rust", rust);
hljs.registerLanguage("bash", bash);
hljs.registerLanguage("shell", bash);
hljs.registerLanguage("json", json);
hljs.registerLanguage("css", css);
hljs.registerLanguage("html", xml);
hljs.registerLanguage("xml", xml);
hljs.registerLanguage("yaml", yaml);
hljs.registerLanguage("yml", yaml);
hljs.registerLanguage("ini", ini);
hljs.registerLanguage("toml", ini);
hljs.registerLanguage("properties", properties);
hljs.registerLanguage("env", properties);

const marked = new Marked({
  renderer: {
    code({ text, lang }: { text: string; lang?: string }) {
      const language = lang && hljs.getLanguage(lang) ? lang : "plaintext";
      let highlighted: string;
      try {
        highlighted = hljs.highlight(text, { language }).value;
      } catch {
        highlighted = text;
      }
      return `<pre><code class="hljs language-${language}">${highlighted}</code></pre>`;
    },
  },
  gfm: true,
  breaks: false,
});

const MD_EXTENSIONS = new Set(["md", "markdown"]);

const EXT_TO_LANG: Record<string, string> = {
  js: "javascript", jsx: "javascript", ts: "typescript", tsx: "typescript",
  py: "python", rs: "rust", sh: "bash", bash: "bash", zsh: "bash",
  json: "json", css: "css", html: "html", xml: "xml", svg: "xml",
  yaml: "yaml", yml: "yaml", ini: "ini", toml: "toml",
  env: "env", conf: "ini", cfg: "ini", properties: "properties",
};

function getExtension(filePath: string | null): string {
  if (!filePath) return "md";
  const name = filePath.split(/[/\\]/).pop() || "";
  // dotfiles like .env → "env"
  if (name.startsWith(".") && !name.includes(".", 1)) return name.slice(1);
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : "";
}

export function isMarkdownFile(filePath: string | null): boolean {
  return MD_EXTENSIONS.has(getExtension(filePath));
}

export function renderPreview(
  container: HTMLElement,
  content: string,
  filePath?: string | null,
): void {
  const scrollTop = container.scrollTop;
  const ext = getExtension(filePath ?? null);

  if (!filePath || MD_EXTENSIONS.has(ext)) {
    container.innerHTML = marked.parse(content) as string;
  } else {
    const lang = EXT_TO_LANG[ext] || "plaintext";
    let highlighted: string;
    try {
      highlighted = hljs.getLanguage(lang)
        ? hljs.highlight(content, { language: lang }).value
        : hljs.highlightAuto(content).value;
    } catch {
      highlighted = content.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    }
    container.innerHTML = `<pre><code class="hljs language-${lang}">${highlighted}</code></pre>`;
  }
  container.scrollTop = scrollTop;
}
