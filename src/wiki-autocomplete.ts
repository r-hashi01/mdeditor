/**
 * CodeMirror autocomplete for `[[wiki link]]` syntax.
 *
 * Triggers when the cursor is inside an unclosed `[[...` and the closest
 * `]]` is not before it. Uses the vault index for the candidate list.
 */

import { autocompletion, type CompletionContext, type CompletionResult, type Completion } from "@codemirror/autocomplete";
import { getVault, stripExt } from "./vault";

const MAX_SUGGESTIONS = 50;

function wikiLinkSource(context: CompletionContext): CompletionResult | null {
  const line = context.state.doc.lineAt(context.pos);
  const before = line.text.slice(0, context.pos - line.from);
  // Find the latest unclosed `[[` on this line.
  const open = before.lastIndexOf("[[");
  if (open < 0) return null;
  // Closed already by `]]` before the cursor → not in a wiki link.
  const closeAfterOpen = before.indexOf("]]", open + 2);
  if (closeAfterOpen >= 0) return null;
  // The query is everything between `[[` and the cursor.
  const query = before.slice(open + 2);
  // If the query contains a newline or a stray `[`, bail.
  if (/[\n\[]/.test(query)) return null;

  const vault = getVault();
  if (!vault) return null;

  const lower = query.toLowerCase();
  const options: Completion[] = [];
  for (const f of vault.files) {
    if (!f.name.toLowerCase().endsWith(".md") && !f.name.toLowerCase().endsWith(".markdown")) {
      // Restrict candidates to markdown files; non-markdown files in vault
      // shouldn't normally be wiki-link targets.
      continue;
    }
    const stem = stripExt(f.name);
    const rel = stripExt(f.rel);
    const haystack = (rel + " " + stem).toLowerCase();
    if (lower && !haystack.includes(lower)) continue;
    options.push({
      label: stem,
      detail: f.rel,
      // Apply replaces the in-progress query with the file's stem, then
      // the user types `]]` themselves (or the editor inserts it — we keep
      // it conservative to avoid breaking existing closers).
      apply: stem,
      boost: stem.toLowerCase() === lower ? 99 : 0,
    });
    if (options.length >= MAX_SUGGESTIONS) break;
  }
  if (options.length === 0) return null;
  return {
    from: line.from + open + 2,
    to: context.pos,
    options,
    validFor: /^[^\[\]\n]*$/,
  };
}

export const wikiLinkAutocomplete = autocompletion({
  override: [wikiLinkSource],
  // Don't override the default autocomplete activation — let users still
  // get word completion from basicSetup; ours layers on top via override
  // returning null when not in a `[[`.
  activateOnTyping: true,
});
