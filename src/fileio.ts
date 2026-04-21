import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { isBinaryFile } from "./binary-exts";

const FILE_FILTERS = [
  { name: "Markdown", extensions: ["md", "markdown"] },
  { name: "Images", extensions: ["png", "jpg", "jpeg", "gif", "svg", "webp", "bmp", "ico", "avif"] },
  {
    name: "Config",
    extensions: [
      "yaml", "yml", "toml", "ini", "env", "json", "xml",
      "conf", "cfg", "properties",
    ],
  },
  { name: "Documents", extensions: ["pdf", "docx", "doc"] },
  { name: "Spreadsheets", extensions: ["csv", "tsv"] },
  { name: "Diagram", extensions: ["drawio"] },
  { name: "Text", extensions: ["txt", "log"] },
  { name: "All Files", extensions: ["*"] },
];

export async function openFile(): Promise<{
  path: string;
  content: string;
  binary: boolean;
} | null> {
  const filePath = await open({
    multiple: false,
    directory: false,
    filters: FILE_FILTERS,
  });
  if (!filePath) return null;
  await invoke("allow_path", { path: filePath });
  // Binary files — skip text reading
  if (isBinaryFile(filePath)) {
    return { path: filePath, content: "", binary: true };
  }
  const content = await invoke<string>("read_file", { path: filePath });
  return { path: filePath, content, binary: false };
}

export async function saveFile(
  content: string,
  currentPath: string | null,
): Promise<string | null> {
  let filePath = currentPath;
  if (!filePath) {
    filePath = await save({
      filters: FILE_FILTERS,
      defaultPath: "untitled.md",
    });
  }
  if (!filePath) return null;
  await invoke("allow_path", { path: filePath });
  await invoke("write_file", { path: filePath, content });
  return filePath;
}
