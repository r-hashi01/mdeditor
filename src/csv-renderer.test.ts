import { describe, expect, it } from "vitest";
import { renderCsv } from "./csv-renderer";

function extractRows(html: string): string[][] {
  // Very small HTML scraper keyed on the specific output shape of renderCsv.
  // Avoids pulling in a parser and keeps the assertions tied to the actual output.
  const rows: string[][] = [];
  const rowRe = /<tr>([\s\S]*?)<\/tr>/g;
  const cellRe = /<t[hd]>([\s\S]*?)<\/t[hd]>/g;
  let r;
  while ((r = rowRe.exec(html))) {
    const cells: string[] = [];
    let c;
    while ((c = cellRe.exec(r[1]))) cells.push(c[1]);
    rows.push(cells);
  }
  return rows;
}

describe("renderCsv", () => {
  it("renders a simple CSV with header + body", () => {
    const html = renderCsv("a,b,c\n1,2,3\n4,5,6");
    const rows = extractRows(html);
    expect(rows).toEqual([
      ["a", "b", "c"],
      ["1", "2", "3"],
      ["4", "5", "6"],
    ]);
    expect(html).toContain("3 rows, 3 columns");
  });

  it("detects TSV based on line sampling", () => {
    // All commas are inside quoted cells — tab count wins, so TSV is detected.
    const html = renderCsv(`name\tcity\n"A,B"\tTokyo\n"C,D"\tOsaka`);
    const rows = extractRows(html);
    expect(rows).toEqual([
      ["name", "city"],
      ["A,B", "Tokyo"],
      ["C,D", "Osaka"],
    ]);
  });

  it("handles quoted fields with commas", () => {
    const html = renderCsv(`name,note\n"Smith, John","hi"`);
    const rows = extractRows(html);
    expect(rows[1]).toEqual(["Smith, John", "hi"]);
  });

  it("handles quoted fields with embedded newlines", () => {
    const html = renderCsv(`a,b\n"line1\nline2",x`);
    const rows = extractRows(html);
    expect(rows[1]).toEqual(["line1\nline2", "x"]);
  });

  it("unescapes doubled quotes inside quoted fields", () => {
    const html = renderCsv(`a,b\n"She said ""hi""",y`);
    const rows = extractRows(html);
    // Cell text is HTML-escaped in the rendered output; verify via raw HTML.
    expect(rows[1]).toEqual([`She said &quot;hi&quot;`, "y"]);
  });

  it("escapes HTML-dangerous characters in cells", () => {
    const html = renderCsv(`a,b\n<script>,"&amp;"`);
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&amp;amp;");
    expect(html).not.toContain("<script>");
  });

  it("pads rows to the widest column count", () => {
    const html = renderCsv("a,b,c\n1,2\n3,4,5,6");
    const rows = extractRows(html);
    // Header has 3 columns but row2 has 4 — table is widened to 4.
    expect(rows[0]).toHaveLength(4);
    expect(rows[1]).toEqual(["1", "2", "", ""]);
    expect(rows[2]).toEqual(["3", "4", "5", "6"]);
  });

  it("tolerates CRLF line endings", () => {
    const html = renderCsv("a,b\r\n1,2\r\n");
    const rows = extractRows(html);
    expect(rows).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("returns the empty-file placeholder for empty input", () => {
    expect(renderCsv("")).toContain("Empty file");
  });
});
