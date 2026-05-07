/**
 * Markdown outline — parses `#`-style headings out of a markdown document
 * into a flat list and a nested tree. Used by the outline side panel.
 *
 * Design notes:
 *   - We intentionally only parse ATX headings (`# `, `## `, …). Setext
 *     headings (`===` / `---` underlines) are uncommon in user content
 *     and would require two-line lookahead.
 *   - YAML frontmatter at the top of the file is skipped so a `---`
 *     delimiter isn't mistaken for an h2 (which is itself a setext h2 — but
 *     we don't emit setext headings anyway, so the skip is purely so that
 *     the *first* `---` doesn't confuse anything later).
 *   - Fenced code blocks are skipped: `# heading` inside a code block must
 *     not appear in the outline.
 */

export interface OutlineItem {
  /** 1-based line number in the source. */
  line: number;
  /** 1–6 (matches `#`–`######`). */
  level: number;
  /** Heading text without the `#` markers, trimmed. */
  text: string;
}

export interface OutlineNode extends OutlineItem {
  children: OutlineNode[];
}

const ATX_HEADING = /^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/;

/**
 * Extract headings from a markdown document. Returns one entry per ATX
 * heading in document order.
 */
export function parseOutline(source: string): OutlineItem[] {
  const lines = source.split("\n");
  const out: OutlineItem[] = [];

  // Skip YAML frontmatter if it starts on line 1.
  let start = 0;
  if (lines[0]?.trim() === "---") {
    for (let i = 1; i < lines.length; i++) {
      if (lines[i].trim() === "---") {
        start = i + 1;
        break;
      }
    }
  }

  let inFence = false;
  let fenceMarker = "";
  for (let i = start; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trimStart();
    // Track fenced code blocks (``` or ~~~). Same marker must close.
    if (!inFence) {
      const m = trimmed.match(/^(```|~~~)/);
      if (m) {
        inFence = true;
        fenceMarker = m[1];
        continue;
      }
    } else {
      if (trimmed.startsWith(fenceMarker)) {
        inFence = false;
        fenceMarker = "";
      }
      continue;
    }

    const m = ATX_HEADING.exec(line);
    if (!m) continue;
    out.push({
      line: i + 1,
      level: m[1].length,
      text: m[2].trim(),
    });
  }
  return out;
}

/**
 * Build a tree from a flat list of headings. Each heading becomes a child
 * of the closest preceding heading at a strictly lower level.
 *
 * Note: real-world markdown often skips levels (h1 → h3). We preserve
 * that visually by just nesting under the nearest lower-level ancestor.
 */
export function buildOutlineTree(items: OutlineItem[]): OutlineNode[] {
  const roots: OutlineNode[] = [];
  const stack: OutlineNode[] = [];
  for (const item of items) {
    const node: OutlineNode = { ...item, children: [] };
    while (stack.length > 0 && stack[stack.length - 1].level >= node.level) {
      stack.pop();
    }
    if (stack.length === 0) {
      roots.push(node);
    } else {
      stack[stack.length - 1].children.push(node);
    }
    stack.push(node);
  }
  return roots;
}

/**
 * Given a flat outline and a 1-based line number (the cursor's line),
 * return the index of the heading whose section contains that line, or
 * -1 if the cursor is above the first heading.
 */
export function findActiveOutlineIndex(items: OutlineItem[], line: number): number {
  let active = -1;
  for (let i = 0; i < items.length; i++) {
    if (items[i].line <= line) {
      active = i;
    } else {
      break;
    }
  }
  return active;
}
