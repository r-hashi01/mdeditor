/**
 * Simple CSV parser + HTML table renderer.
 * Handles quoted fields (commas, newlines inside quotes) and TSV.
 */

import { escapeHtml } from "./html-utils";

/** Detect whether the content is tab-separated or comma-separated.
 *  Samples up to the first 5 lines for a more reliable heuristic. */
function detectDelimiter(content: string): string {
  const lines = content.split("\n").slice(0, 5);
  let tabs = 0;
  let commas = 0;
  for (const line of lines) {
    tabs += (line.match(/\t/g) || []).length;
    commas += (line.match(/,/g) || []).length;
  }
  return tabs > commas ? "\t" : ",";
}

const MAX_FIELD_LENGTH = 100000;

/** Parse CSV/TSV into a 2D string array. */
function parseCsv(content: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;

  while (i < content.length) {
    const ch = content[i];

    if (inQuotes) {
      if (ch === '"') {
        if (content[i + 1] === '"') {
          // Escaped quote
          field += '"';
          i += 2;
        } else {
          inQuotes = false;
          i++;
        }
      } else {
        field += ch;
        i++;
        // Prevent unbounded field accumulation from unclosed quotes
        if (field.length > MAX_FIELD_LENGTH) {
          inQuotes = false;
        }
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
        i++;
      } else if (ch === delimiter) {
        row.push(field);
        field = "";
        i++;
      } else if (ch === "\r") {
        // Skip CR
        i++;
      } else if (ch === "\n") {
        row.push(field);
        field = "";
        rows.push(row);
        row = [];
        i++;
      } else {
        field += ch;
        i++;
      }
    }
  }

  // Last field / row
  if (field || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}

export function renderCsv(content: string): string {
  const delimiter = detectDelimiter(content);
  const rows = parseCsv(content, delimiter);

  if (rows.length === 0) {
    return '<div class="csv-preview"><p>Empty file</p></div>';
  }

  // Normalise column count (avoid spread to prevent stack overflow on large files)
  const maxCols = rows.reduce((max, r) => Math.max(max, r.length), 0);

  const header = rows[0];
  const body = rows.slice(1);

  let html = '<div class="csv-preview"><table class="csv-table"><thead><tr>';
  for (let c = 0; c < maxCols; c++) {
    html += `<th>${escapeHtml(header[c] ?? "")}</th>`;
  }
  html += "</tr></thead><tbody>";

  for (const row of body) {
    html += "<tr>";
    for (let c = 0; c < maxCols; c++) {
      html += `<td>${escapeHtml(row[c] ?? "")}</td>`;
    }
    html += "</tr>";
  }

  html += "</tbody></table>";
  html += `<div class="csv-info">${rows.length} rows, ${maxCols} columns</div>`;
  html += "</div>";
  return html;
}
