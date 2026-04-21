export interface TableEditor {
  show(): void;
  hide(): void;
}

type Align = "left" | "center" | "right";

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function buildMarkdownTable(
  headers: string[],
  aligns: Align[],
  rows: number,
): string {
  const cols = headers.length;
  // Pad headers to at least 3 chars for readability
  const padded = headers.map((h) => (h || "     ").padEnd(5));
  const separators = aligns.map((a, i) => {
    const w = Math.max(padded[i].length, 3);
    const dashes = "-".repeat(w);
    if (a === "center") return `:${dashes.slice(1, -1)}:`;
    if (a === "right") return `${dashes.slice(0, -1)}:`;
    return dashes;
  });
  const emptyRow = padded.map((h) => " ".repeat(h.length));

  let md = `| ${padded.join(" | ")} |\n`;
  md += `| ${separators.join(" | ")} |\n`;
  for (let r = 0; r < rows; r++) {
    md += `| ${emptyRow.join(" | ")} |\n`;
  }
  return md;
}

export function createTableEditor(
  onInsert: (markdown: string) => void,
): TableEditor {
  const overlay = document.createElement("div");
  overlay.id = "table-editor-overlay";
  overlay.innerHTML = `
    <div id="table-editor-modal">
      <div class="te-header">
        <h2>Insert Table</h2>
        <button class="te-close">&times;</button>
      </div>
      <div class="te-body">
        <div class="te-size-row">
          <label>
            <span>Columns</span>
            <input type="number" id="te-cols" value="3" min="1" max="10" />
          </label>
          <label>
            <span>Rows (data)</span>
            <input type="number" id="te-rows" value="3" min="1" max="50" />
          </label>
        </div>
        <div class="te-section-title">Column Settings</div>
        <div id="te-columns-config"></div>
        <div class="te-section-title">Preview</div>
        <pre id="te-preview"></pre>
        <button id="te-insert" class="te-insert-btn">Insert</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const colsInput = overlay.querySelector("#te-cols") as HTMLInputElement;
  const rowsInput = overlay.querySelector("#te-rows") as HTMLInputElement;
  const columnsConfig = overlay.querySelector("#te-columns-config") as HTMLElement;
  const previewEl = overlay.querySelector("#te-preview") as HTMLPreElement;
  const insertBtn = overlay.querySelector("#te-insert") as HTMLButtonElement;
  const closeBtn = overlay.querySelector(".te-close") as HTMLButtonElement;

  let columnCount = 3;
  let rowCount = 3;
  let headers: string[] = ["", "", ""];
  let aligns: Align[] = ["left", "left", "left"];

  function renderColumnsConfig(): void {
    columnsConfig.innerHTML = "";
    for (let i = 0; i < columnCount; i++) {
      const row = document.createElement("div");
      row.className = "te-col-row";
      row.innerHTML = `
        <input type="text" class="te-header-input" placeholder="Column ${i + 1}" value="${escapeAttr(headers[i] || "")}" data-idx="${i}" />
        <select class="te-align-select" data-idx="${i}">
          <option value="left"${aligns[i] === "left" ? " selected" : ""}>Left</option>
          <option value="center"${aligns[i] === "center" ? " selected" : ""}>Center</option>
          <option value="right"${aligns[i] === "right" ? " selected" : ""}>Right</option>
        </select>
      `;
      columnsConfig.appendChild(row);
    }

    // Event delegation for header inputs and align selects
    columnsConfig.querySelectorAll<HTMLInputElement>(".te-header-input").forEach((input) => {
      input.addEventListener("input", () => {
        const idx = parseInt(input.dataset.idx!, 10);
        headers[idx] = input.value;
        updatePreview();
      });
    });
    columnsConfig.querySelectorAll<HTMLSelectElement>(".te-align-select").forEach((select) => {
      select.addEventListener("change", () => {
        const idx = parseInt(select.dataset.idx!, 10);
        aligns[idx] = select.value as Align;
        updatePreview();
      });
    });
  }

  function updatePreview(): void {
    const md = buildMarkdownTable(headers, aligns, rowCount);
    previewEl.textContent = md;
  }

  function syncColumns(): void {
    const newCount = parseInt(colsInput.value, 10) || 1;
    if (newCount === columnCount) return;

    // Extend or shrink arrays
    while (headers.length < newCount) headers.push("");
    while (aligns.length < newCount) aligns.push("left");
    headers.length = newCount;
    aligns.length = newCount;
    columnCount = newCount;
    renderColumnsConfig();
    updatePreview();
  }

  function syncRows(): void {
    rowCount = parseInt(rowsInput.value, 10) || 1;
    updatePreview();
  }

  colsInput.addEventListener("change", syncColumns);
  colsInput.addEventListener("input", syncColumns);
  rowsInput.addEventListener("change", syncRows);
  rowsInput.addEventListener("input", syncRows);

  closeBtn.addEventListener("click", () => {
    overlay.classList.remove("visible");
  });
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) overlay.classList.remove("visible");
  });

  insertBtn.addEventListener("click", () => {
    const md = buildMarkdownTable(headers, aligns, rowCount);
    onInsert(md);
    overlay.classList.remove("visible");
  });

  // ESC to close
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && overlay.classList.contains("visible")) {
      overlay.classList.remove("visible");
    }
  });

  // Initial render
  renderColumnsConfig();
  updatePreview();

  return {
    show() {
      overlay.classList.add("visible");
    },
    hide() {
      overlay.classList.remove("visible");
    },
  };
}
