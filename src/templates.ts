/**
 * Templates: lists `.md` / `.markdown` files in `<vault>/.templates/`,
 * substitutes simple variables, and inserts the result at the editor cursor.
 *
 * Variables (mustache-ish syntax kept intentionally tiny — no expressions):
 *
 *   {{date}}       2026-05-07
 *   {{time}}       14:23
 *   {{datetime}}   2026-05-07 14:23
 *   {{title}}      filename without extension, or "Untitled"
 *   {{cursor}}     stripped during substitution; selection is placed here
 *
 * Templates are not validated beyond UTF-8 read; whatever the user wrote is
 * what they get.
 */

import { invoke } from "@tauri-apps/api/core";
import { todayISO } from "./daily-note";

export interface TemplateFile {
  name: string;
  path: string;
}

export interface TemplateContext {
  /** Current file's basename without extension (for {{title}}). */
  title?: string;
}

export interface SubstitutedTemplate {
  /** Body with variables substituted and {{cursor}} removed. */
  body: string;
  /** Offset where {{cursor}} appeared, or body.length if absent. */
  cursorOffset: number;
}

interface DirEntry {
  name: string;
  path: string;
  is_dir: boolean;
}

const TEMPLATE_DIR_NAME = ".templates";

export async function findTemplatesDir(vaultRoot: string): Promise<string | null> {
  try {
    const entries = await invoke<DirEntry[]>("list_directory", { path: vaultRoot });
    const tpl = entries.find((e) => e.is_dir && e.name === TEMPLATE_DIR_NAME);
    return tpl ? tpl.path : null;
  } catch {
    return null;
  }
}

export async function listTemplates(vaultRoot: string): Promise<TemplateFile[]> {
  const dir = await findTemplatesDir(vaultRoot);
  if (!dir) return [];
  try {
    const entries = await invoke<DirEntry[]>("list_directory", { path: dir });
    return entries
      .filter((e) => !e.is_dir && /\.(md|markdown)$/i.test(e.name))
      .map((e) => ({ name: e.name, path: e.path }))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  } catch {
    return [];
  }
}

export async function readTemplate(path: string): Promise<string> {
  return invoke<string>("read_file", { path });
}

/** Apply mustache variable substitution + extract `{{cursor}}` position. */
export function substitute(template: string, ctx: TemplateContext = {}, now: Date = new Date()): SubstitutedTemplate {
  const date = todayISO(now);
  const time = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  const datetime = `${date} ${time}`;
  const title = ctx.title ?? "Untitled";

  let body = template
    .replace(/\{\{date\}\}/g, date)
    .replace(/\{\{time\}\}/g, time)
    .replace(/\{\{datetime\}\}/g, datetime)
    .replace(/\{\{title\}\}/g, title);

  const cursorIdx = body.indexOf("{{cursor}}");
  if (cursorIdx >= 0) {
    body = body.slice(0, cursorIdx) + body.slice(cursorIdx + "{{cursor}}".length);
    return { body, cursorOffset: cursorIdx };
  }
  return { body, cursorOffset: body.length };
}
