/**
 * Lightweight drawio (.drawio) renderer.
 * Parses the mxGraphModel XML and renders shapes/edges as inline SVG.
 *
 * Drawio encoding chain (compressed format):
 *   XML → encodeURIComponent → deflate-raw → base64
 * Some files store uncompressed XML directly inside <diagram>.
 */

/* ── Decompression ── */

const MAX_DECOMPRESSED_SIZE = 50 * 1024 * 1024; // 50 MB limit for decompression

async function decompressDrawio(encoded: string): Promise<string> {
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }

  const ds = new DecompressionStream("deflate-raw");
  const writer = ds.writable.getWriter();
  const reader = ds.readable.getReader();

  writer.write(bytes);
  writer.close();

  const chunks: Uint8Array[] = [];
  let totalSize = 0;
  for (;;) {
    const result = await reader.read();
    if (result.done) break;
    totalSize += result.value.byteLength;
    if (totalSize > MAX_DECOMPRESSED_SIZE) {
      await reader.cancel();
      throw new Error("Decompressed data exceeds size limit");
    }
    chunks.push(result.value);
  }

  const decoder = new TextDecoder();
  const raw = chunks.map((c) => decoder.decode(c, { stream: true })).join("") + decoder.decode();
  // draw.io URL-encodes the XML before compressing
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

/* ── Style parser ── */

interface MxStyle {
  [key: string]: string;
}

export function parseStyle(style: string | null): MxStyle {
  if (!style) return {};
  const result: MxStyle = {};
  for (const part of style.split(";")) {
    if (!part) continue;
    const eq = part.indexOf("=");
    if (eq >= 0) {
      result[part.slice(0, eq)] = part.slice(eq + 1);
    } else {
      // shape identifier like "ellipse", "rhombus", "text", etc.
      result[part] = "1";
    }
  }
  return result;
}

/* ── Geometry ── */

interface Geom {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Point {
  x: number;
  y: number;
}

function parseGeom(cell: Element): Geom | null {
  const g = cell.querySelector("mxGeometry");
  if (!g) return null;
  return {
    x: parseFloat(g.getAttribute("x") || "0") || 0,
    y: parseFloat(g.getAttribute("y") || "0") || 0,
    width: parseFloat(g.getAttribute("width") || "0") || 0,
    height: parseFloat(g.getAttribute("height") || "0") || 0,
  };
}

function parsePoints(cell: Element): Point[] {
  const points: Point[] = [];
  const g = cell.querySelector("mxGeometry");
  if (!g) return points;

  const sourcePoint = g.querySelector('mxPoint[as="sourcePoint"]');
  if (sourcePoint) {
    points.push({
      x: parseFloat(sourcePoint.getAttribute("x") || "0"),
      y: parseFloat(sourcePoint.getAttribute("y") || "0"),
    });
  }

  const arrayEl = g.querySelector('Array[as="points"]');
  if (arrayEl) {
    for (const pt of arrayEl.querySelectorAll("mxPoint")) {
      points.push({
        x: parseFloat(pt.getAttribute("x") || "0"),
        y: parseFloat(pt.getAttribute("y") || "0"),
      });
    }
  }

  const targetPoint = g.querySelector('mxPoint[as="targetPoint"]');
  if (targetPoint) {
    points.push({
      x: parseFloat(targetPoint.getAttribute("x") || "0"),
      y: parseFloat(targetPoint.getAttribute("y") || "0"),
    });
  }

  return points;
}

/* ── SVG rendering ── */

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Sanitize a value for use in an SVG attribute (color, etc.).
 *
 * Strategy: strip all potentially dangerous characters (`'"<>&;()`).
 * Parentheses are preserved only when the *entire* string matches
 * a strict `rgb(…)` / `rgba(…)` pattern — so "rgb(0,0,0)" passes
 * but "rgb(0,0,0) url(evil)" does not (the full-string regex fails,
 * causing all parentheses to be stripped).
 */
export function safeSvgAttr(s: string): string {
  const isRgb = /^rgba?\s*\([\d,.\s%]+\)$/i.test(s);
  return s.replace(/['"<>&;()]/g, (ch) => {
    if ((ch === "(" || ch === ")") && isRgb) return ch;
    return "";
  });
}

/** Break long text into lines that fit within a given width (rough estimate). */
function wrapText(text: string, maxWidth: number, fontSize: number): string[] {
  const charsPerLine = Math.max(1, Math.floor(maxWidth / (fontSize * 0.55)));
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    if (current && (current.length + 1 + word.length) > charsPerLine) {
      lines.push(current);
      current = word;
    } else {
      current = current ? current + " " + word : word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

/** Strip HTML from drawio labels safely using DOMParser for proper entity handling. */
function stripHtml(html: string): string {
  // Replace <br> with newlines before parsing
  const withBreaks = html.replace(/<br\s*\/?>/gi, "\n");
  const doc = new DOMParser().parseFromString(withBreaks, "text/html");
  return (doc.body.textContent || "").trim();
}

interface Vertex {
  id: string;
  label: string;
  geom: Geom;
  style: MxStyle;
  parentId: string;
}

interface Edge {
  id: string;
  label: string;
  sourceId: string | null;
  targetId: string | null;
  style: MxStyle;
  points: Point[];
}

function renderVertexSvg(v: Vertex): string {
  const x = v.geom.x, y = v.geom.y, width = v.geom.width, height = v.geom.height;
  const s = v.style;

  const fill = safeSvgAttr(s.fillColor || "#ffffff");
  const stroke = safeSvgAttr(s.strokeColor || "#000000");
  const strokeWidth = parseFloat(s.strokeWidth || "1") || 1;
  const fontColor = safeSvgAttr(s.fontColor || "#000000");
  const fontSize = parseFloat(s.fontSize || "12") || 12;
  const opacity = (parseFloat(s.opacity || "100") || 100) / 100;
  const rounded = s.rounded === "1" || s.shape === "mxgraph.flowchart.process";
  const dashed = s.dashed === "1";

  // Determine if this is a "no-fill" text-only element
  const noFill = fill === "none" || s.fillColor === "none";
  const noStroke = stroke === "none" || s.strokeColor === "none";

  const dashAttr = dashed ? ` stroke-dasharray="6 3"` : "";
  const opacityAttr = opacity < 1 ? ` opacity="${opacity}"` : "";

  let shapeEl: string;

  if (s.ellipse === "1" || s.shape === "ellipse") {
    const cx = x + width / 2;
    const cy = y + height / 2;
    shapeEl = `<ellipse cx="${cx}" cy="${cy}" rx="${width / 2}" ry="${height / 2}" ` +
      `fill="${noFill ? "none" : fill}" stroke="${noStroke ? "none" : stroke}" stroke-width="${strokeWidth}"${dashAttr}${opacityAttr}/>`;
  } else if (s.rhombus === "1" || s.shape === "rhombus") {
    const cx = x + width / 2;
    const cy = y + height / 2;
    const pts = `${cx},${y} ${x + width},${cy} ${cx},${y + height} ${x},${cy}`;
    shapeEl = `<polygon points="${pts}" ` +
      `fill="${noFill ? "none" : fill}" stroke="${noStroke ? "none" : stroke}" stroke-width="${strokeWidth}"${dashAttr}${opacityAttr}/>`;
  } else if (s.shape === "cylinder" || s.shape === "cylinder3") {
    const ry = Math.min(height * 0.12, 15);
    shapeEl =
      `<path d="M${x},${y + ry} ` +
      `A${width / 2},${ry} 0 0,1 ${x + width},${y + ry} ` +
      `V${y + height - ry} ` +
      `A${width / 2},${ry} 0 0,1 ${x},${y + height - ry} Z" ` +
      `fill="${noFill ? "none" : fill}" stroke="${noStroke ? "none" : stroke}" stroke-width="${strokeWidth}"${dashAttr}${opacityAttr}/>` +
      `<ellipse cx="${x + width / 2}" cy="${y + ry}" rx="${width / 2}" ry="${ry}" ` +
      `fill="${noFill ? "none" : fill}" stroke="${noStroke ? "none" : stroke}" stroke-width="${strokeWidth}"${opacityAttr}/>`;
  } else {
    // Default: rectangle
    const rx = rounded ? Math.min(6, width / 4, height / 4) : 0;
    shapeEl = `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${rx}" ` +
      `fill="${noFill ? "none" : fill}" stroke="${noStroke ? "none" : stroke}" stroke-width="${strokeWidth}"${dashAttr}${opacityAttr}/>`;
  }

  // Label
  let labelEl = "";
  if (v.label) {
    const text = stripHtml(v.label);
    const lines = text.split("\n").flatMap((line) => wrapText(line, width - 8, fontSize));
    const lineHeight = fontSize * 1.3;
    const totalHeight = lines.length * lineHeight;
    const startY = y + (height - totalHeight) / 2 + fontSize;

    labelEl = lines
      .map(
        (line, i) =>
          `<text x="${x + width / 2}" y="${startY + i * lineHeight}" ` +
          `text-anchor="middle" font-size="${fontSize}" fill="${fontColor}" ` +
          `font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"` +
          `>${escapeXml(line)}</text>`,
      )
      .join("");
  }

  return shapeEl + labelEl;
}

function getVertexCenter(vertices: Map<string, Vertex>, id: string | null): Point | null {
  if (!id) return null;
  const v = vertices.get(id);
  if (!v) return null;
  return {
    x: v.geom.x + v.geom.width / 2,
    y: v.geom.y + v.geom.height / 2,
  };
}

function renderEdgeSvg(e: Edge, vertices: Map<string, Vertex>): string {
  const s = e.style;
  const stroke = safeSvgAttr(s.strokeColor || "#000000");
  const strokeWidth = parseFloat(s.strokeWidth || "1") || 1;
  const dashed = s.dashed === "1";
  const dashAttr = dashed ? ` stroke-dasharray="6 3"` : "";

  const source = getVertexCenter(vertices, e.sourceId);
  const target = getVertexCenter(vertices, e.targetId);

  // Build point list: source → waypoints → target
  const pts: Point[] = [];
  if (source) pts.push(source);
  for (const p of e.points) pts.push(p);
  if (target) pts.push(target);

  if (pts.length < 2) return "";

  const pathData = pts.map((p, i) => (i === 0 ? `M${p.x},${p.y}` : `L${p.x},${p.y}`)).join(" ");

  let svg = `<path d="${pathData}" fill="none" stroke="${stroke}" stroke-width="${strokeWidth}"${dashAttr} marker-end="url(#arrowhead)"/>`;

  // Edge label
  if (e.label) {
    const text = stripHtml(e.label);
    // Place label at midpoint
    const mid = pts[Math.floor(pts.length / 2)];
    svg += `<text x="${mid.x}" y="${mid.y - 6}" text-anchor="middle" font-size="11" fill="${stroke}" ` +
      `font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif">${escapeXml(text)}</text>`;
  }

  return svg;
}

/* ── Main renderer ── */

const MAX_CELLS = 10000;
const MAX_NESTING_DEPTH = 100;

async function parseMxGraphModel(xmlStr: string): Promise<string> {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlStr, "text/xml");

  // Check for XML parse errors
  const parseError = doc.querySelector("parsererror");
  if (parseError) {
    return `<text x="10" y="20" fill="red">XML parse error</text>`;
  }

  const cells = doc.querySelectorAll("mxCell");
  if (cells.length > MAX_CELLS) {
    return `<text x="10" y="20" fill="red">Diagram too large (${cells.length} cells, max ${MAX_CELLS})</text>`;
  }

  const vertices = new Map<string, Vertex>();
  const edges: Edge[] = [];

  for (const cell of cells) {
    const id = cell.getAttribute("id") || "";
    const value = cell.getAttribute("value") || "";
    const style = parseStyle(cell.getAttribute("style"));
    const parentId = cell.getAttribute("parent") || "";

    if (cell.getAttribute("vertex") === "1") {
      const geom = parseGeom(cell);
      if (geom && geom.width > 0 && geom.height > 0) {
        vertices.set(id, { id, label: value, geom, style, parentId });
      }
    } else if (cell.getAttribute("edge") === "1") {
      edges.push({
        id,
        label: value,
        sourceId: cell.getAttribute("source"),
        targetId: cell.getAttribute("target"),
        style,
        points: parsePoints(cell),
      });
    }
  }

  if (vertices.size === 0 && edges.length === 0) {
    return "";
  }

  // Resolve parent offsets (groups/containers) with cycle detection
  for (const v of vertices.values()) {
    const visited = new Set<string>();
    let parent = vertices.get(v.parentId);
    let depth = 0;
    while (parent && !visited.has(parent.id) && depth < MAX_NESTING_DEPTH) {
      visited.add(parent.id);
      v.geom.x += parent.geom.x;
      v.geom.y += parent.geom.y;
      parent = vertices.get(parent.parentId);
      depth++;
    }
  }

  // Calculate bounding box
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const v of vertices.values()) {
    const g = v.geom;
    minX = Math.min(minX, g.x);
    minY = Math.min(minY, g.y);
    maxX = Math.max(maxX, g.x + g.width);
    maxY = Math.max(maxY, g.y + g.height);
  }

  const pad = 40;
  minX -= pad;
  minY -= pad;
  maxX += pad;
  maxY += pad;
  const vw = maxX - minX;
  const vh = maxY - minY;

  // Build SVG
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${minX} ${minY} ${vw} ${vh}" ` +
    `width="100%" height="100%" style="max-width:${vw}px;">`;

  // Arrowhead marker
  svg += `<defs><marker id="arrowhead" markerWidth="10" markerHeight="7" refX="10" refY="3.5" orient="auto">` +
    `<polygon points="0 0, 10 3.5, 0 7" fill="var(--text-secondary, #666)"/></marker></defs>`;

  // Render edges first (below shapes)
  for (const e of edges) {
    svg += renderEdgeSvg(e, vertices);
  }

  // Render vertices
  for (const v of vertices.values()) {
    svg += renderVertexSvg(v);
  }

  svg += "</svg>";
  return svg;
}

/**
 * Render a drawio file's XML content into an HTML string for the preview pane.
 */
export async function renderDrawio(xmlContent: string): Promise<string> {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlContent, "text/xml");

  const diagrams = doc.querySelectorAll("diagram");
  if (diagrams.length === 0) {
    return '<div class="drawio-error">Invalid drawio file: no diagrams found</div>';
  }

  const MAX_DIAGRAMS = 50;
  const pages: string[] = [];

  let diagramCount = 0;
  for (const diagram of diagrams) {
    if (++diagramCount > MAX_DIAGRAMS) {
      pages.push('<div class="drawio-page"><p>Too many diagrams — only first 50 shown</p></div>');
      break;
    }
    const name = diagram.getAttribute("name") || "Page";

    let mxXml: string;
    try {
      // Check for uncompressed format: <mxGraphModel> as a direct child element
      const mxModel = diagram.querySelector("mxGraphModel");
      if (mxModel) {
        mxXml = new XMLSerializer().serializeToString(mxModel);
      } else {
        // Compressed format: base64+deflate text content
        const encoded = diagram.textContent?.trim() || "";
        if (encoded.length > 0) {
          mxXml = await decompressDrawio(encoded);
        } else {
          pages.push(`<div class="drawio-page"><div class="drawio-page-title">${escapeXml(name)}</div><p>Empty diagram</p></div>`);
          continue;
        }
      }
    } catch {
      pages.push(`<div class="drawio-page"><div class="drawio-page-title">${escapeXml(name)}</div><p>Failed to decode diagram</p></div>`);
      continue;
    }

    const svg = await parseMxGraphModel(mxXml);
    if (svg) {
      pages.push(
        `<div class="drawio-page">` +
        (diagrams.length > 1 ? `<div class="drawio-page-title">${escapeXml(name)}</div>` : "") +
        `<div class="drawio-svg-wrapper">${svg}</div>` +
        `</div>`,
      );
    } else {
      pages.push(`<div class="drawio-page"><div class="drawio-page-title">${escapeXml(name)}</div><p>No shapes found</p></div>`);
    }
  }

  return `<div class="drawio-preview">` +
    `<button class="drawio-open-external" title="Edit in draw.io">` +
    `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>` +
    ` Edit in draw.io</button>` +
    pages.join("") +
    `</div>`;
}
