/**
 * Minimal YAML frontmatter parser/serializer for the editor UI.
 *
 * Supports the small slice of YAML mdeditor users actually have in their
 * frontmatter: scalars (string / number / bool / null) and one-level
 * sequences (`tags: [a, b]` or block-list with `- `). Nested maps and
 * complex flow syntax are returned as raw strings so we don't lose data.
 */

export interface FrontmatterField {
  key: string;
  /** Scalar string, or array of strings for sequences. */
  value: string | string[];
  /** True if we couldn't recognise the value shape — UI should treat as raw string. */
  raw: boolean;
  /**
   * True if the source had an unquoted scalar (e.g. `draft: true`, `n: 42`).
   * We preserve this so the round-trip doesn't accidentally promote literals
   * to strings by re-quoting them.
   */
  bareLiteral?: boolean;
}

export interface ParsedFrontmatter {
  /** Full original YAML body (between the --- delimiters). */
  yaml: string;
  fields: FrontmatterField[];
  /** Index in the source where the frontmatter begins (0-based). */
  start: number;
  /** Index *after* the closing `---\n`. */
  end: number;
}

const DELIMITER = /^---\s*$/;

/** Detect + parse a frontmatter block at the top of a document. */
export function parseFrontmatter(source: string): ParsedFrontmatter | null {
  const lines = source.split("\n");
  if (lines.length < 2 || !DELIMITER.test(lines[0])) return null;
  let closing = -1;
  for (let i = 1; i < lines.length; i++) {
    if (DELIMITER.test(lines[i])) {
      closing = i;
      break;
    }
  }
  if (closing < 0) return null;
  const body = lines.slice(1, closing).join("\n");

  // Compute byte offsets in the original source.
  let start = 0;
  let end = 0;
  // Reconstruct: line 0 (---) + \n, body lines + \n each, closing --- + \n.
  end = lines.slice(0, closing + 1).join("\n").length + 1; // +1 for trailing \n
  if (end > source.length) end = source.length;

  return {
    yaml: body,
    fields: parseFields(body),
    start,
    end,
  };
}

/** Best-effort parse of top-level YAML key/value pairs. */
function parseFields(yaml: string): FrontmatterField[] {
  const out: FrontmatterField[] = [];
  const lines = yaml.split("\n");
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim() || line.trimStart().startsWith("#")) {
      i++;
      continue;
    }
    const m = /^([A-Za-z_][\w.-]*)\s*:\s*(.*)$/.exec(line);
    if (!m) {
      // Unrecognised — emit as raw line so a round-trip preserves it.
      out.push({ key: `__raw_${i}`, value: line, raw: true });
      i++;
      continue;
    }
    const key = m[1];
    const after = m[2];
    if (after === "" || after === undefined) {
      // Possible block sequence on next lines.
      const items: string[] = [];
      let j = i + 1;
      while (j < lines.length && /^\s+-\s*/.test(lines[j])) {
        items.push(lines[j].replace(/^\s+-\s*/, "").trim());
        j++;
      }
      if (items.length > 0) {
        out.push({ key, value: items, raw: false });
        i = j;
        continue;
      }
      // Empty value — treat as empty string.
      out.push({ key, value: "", raw: false });
      i++;
      continue;
    }
    // Inline flow sequence: [a, b, c]
    const flow = /^\[\s*(.*)\s*\]$/.exec(after.trim());
    if (flow) {
      const items = flow[1]
        .split(",")
        .map((s) => stripQuotes(s.trim()))
        .filter((s) => s.length > 0);
      out.push({ key, value: items, raw: false });
      i++;
      continue;
    }
    const trimmed = after.trim();
    const wasQuoted = /^["'].*["']$/.test(trimmed);
    const value = stripQuotes(trimmed);
    const bareLiteral = !wasQuoted && isYamlLiteral(value);
    out.push({ key, value, raw: false, bareLiteral });
    i++;
  }
  return out;
}

function isYamlLiteral(s: string): boolean {
  return /^[+-]?(\d+(\.\d+)?|\.\d+)$/.test(s) || /^(true|false|null|yes|no|~)$/i.test(s);
}

function stripQuotes(s: string): string {
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1);
  }
  return s;
}

/** Serialize fields back to YAML (preserving raw lines verbatim). */
export function serializeFrontmatter(fields: FrontmatterField[]): string {
  const lines: string[] = [];
  for (const f of fields) {
    if (f.raw) {
      lines.push(typeof f.value === "string" ? f.value : "");
      continue;
    }
    if (Array.isArray(f.value)) {
      const escaped = f.value.map((v) => quoteIfNeeded(v));
      lines.push(`${f.key}: [${escaped.join(", ")}]`);
      continue;
    }
    // Preserve original bareness for literals so `draft: true` round-trips.
    if (f.bareLiteral && isYamlLiteral(f.value)) {
      lines.push(`${f.key}: ${f.value}`);
      continue;
    }
    lines.push(`${f.key}: ${quoteIfNeeded(f.value)}`);
  }
  return lines.join("\n");
}

function quoteIfNeeded(s: string): string {
  if (s === "") return '""';
  // Quote if the string contains characters that would break the simple parser
  // or look like a different YAML scalar type.
  if (/^[+-]?(\d+(\.\d+)?|\.\d+)$/.test(s)) return `"${s}"`; // looks like number
  if (/^(true|false|null|yes|no|~)$/i.test(s)) return `"${s}"`;
  if (/[:#\[\]{},&*!|>'"%@`]/.test(s)) return `"${s.replace(/"/g, '\\"')}"`;
  if (/^\s|\s$/.test(s)) return `"${s}"`;
  return s;
}

/**
 * Replace the frontmatter block in `source` with a new YAML body. If
 * `source` doesn't have frontmatter, prepend one.
 */
export function replaceFrontmatter(source: string, newYaml: string): string {
  const parsed = parseFrontmatter(source);
  const block = `---\n${newYaml}\n---\n`;
  if (!parsed) {
    return block + source;
  }
  return block + source.slice(parsed.end);
}
