import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";

const FILE_FILTERS = [
  { name: "Markdown", extensions: ["md", "markdown"] },
  {
    name: "Config",
    extensions: [
      "yaml", "yml", "toml", "ini", "env", "json", "xml",
      "conf", "cfg", "properties",
    ],
  },
  { name: "Text", extensions: ["txt", "log"] },
  { name: "All Files", extensions: ["*"] },
];

export async function openFile(): Promise<{
  path: string;
  content: string;
} | null> {
  const filePath = await open({
    multiple: false,
    directory: false,
    filters: FILE_FILTERS,
  });
  if (!filePath) return null;
  const content = await invoke<string>("read_file", { path: filePath });
  return { path: filePath, content };
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
  await invoke("write_file", { path: filePath, content });
  return filePath;
}
