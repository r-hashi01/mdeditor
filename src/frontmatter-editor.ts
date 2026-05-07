/**
 * Frontmatter editor modal — table-style UI for the YAML block at the top
 * of a markdown file. Click "Edit Frontmatter" in the command palette,
 * tweak fields, hit Save → the editor doc is patched in place.
 */

import { parseFrontmatter, serializeFrontmatter, replaceFrontmatter, type FrontmatterField } from "./frontmatter";
import { escapeHtml } from "./html-utils";
import xIcon from "lucide-static/icons/x.svg?raw";
import plusIcon from "lucide-static/icons/plus.svg?raw";

export interface FrontmatterEditorDeps {
  /** Read the current document contents. */
  getDoc: () => string;
  /** Apply a fully-rebuilt document body. */
  setDoc: (next: string) => void;
}

export interface FrontmatterEditor {
  show(): void;
  hide(): void;
}

export function createFrontmatterEditor(deps: FrontmatterEditorDeps): FrontmatterEditor {
  const overlay = document.createElement("div");
  overlay.className = "fm-overlay";
  overlay.innerHTML = `
    <div class="fm-modal" role="dialog" aria-label="Edit frontmatter">
      <div class="fm-header">
        <span>Edit Frontmatter</span>
        <button class="fm-close" type="button">${xIcon}</button>
      </div>
      <div class="fm-body"></div>
      <div class="fm-footer">
        <button class="fm-add" type="button">${plusIcon}<span>Add field</span></button>
        <span class="fm-spacer"></span>
        <button class="fm-cancel" type="button">Cancel</button>
        <button class="fm-save" type="button">Save</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const body = overlay.querySelector(".fm-body") as HTMLElement;
  const closeBtn = overlay.querySelector(".fm-close") as HTMLButtonElement;
  const cancelBtn = overlay.querySelector(".fm-cancel") as HTMLButtonElement;
  const saveBtn = overlay.querySelector(".fm-save") as HTMLButtonElement;
  const addBtn = overlay.querySelector(".fm-add") as HTMLButtonElement;

  let fields: FrontmatterField[] = [];

  function show(): void {
    const doc = deps.getDoc();
    const parsed = parseFrontmatter(doc);
    fields = parsed ? [...parsed.fields] : [];
    render();
    overlay.classList.add("visible");
  }

  function hide(): void {
    overlay.classList.remove("visible");
  }

  function render(): void {
    body.innerHTML = "";
    if (fields.length === 0) {
      const empty = document.createElement("div");
      empty.className = "fm-empty";
      empty.textContent = "No frontmatter — click \"Add field\" to start.";
      body.appendChild(empty);
      return;
    }
    fields.forEach((f, idx) => {
      const row = document.createElement("div");
      row.className = "fm-row" + (f.raw ? " fm-row-raw" : "");
      const isArray = Array.isArray(f.value);
      const valueText = isArray ? (f.value as string[]).join(", ") : (f.value as string);
      const typeBadge = isArray ? "list" : f.bareLiteral ? "literal" : "string";
      row.innerHTML = `
        <input class="fm-key" type="text" value="${escapeHtml(f.key)}" ${f.raw ? "readonly" : ""} />
        <input class="fm-value" type="text" value="${escapeHtml(valueText)}" placeholder="${isArray ? "comma-separated" : ""}" />
        <span class="fm-type">${typeBadge}</span>
        <button class="fm-remove" type="button" title="Remove">×</button>
      `;
      const keyInput = row.querySelector(".fm-key") as HTMLInputElement;
      const valueInput = row.querySelector(".fm-value") as HTMLInputElement;
      const removeBtn = row.querySelector(".fm-remove") as HTMLButtonElement;
      keyInput.addEventListener("input", () => {
        fields[idx].key = keyInput.value.trim();
      });
      valueInput.addEventListener("input", () => {
        if (isArray) {
          fields[idx].value = valueInput.value
            .split(",")
            .map((s) => s.trim())
            .filter((s) => s.length > 0);
        } else {
          fields[idx].value = valueInput.value;
          // User typed something — drop the bare-literal hint so we re-classify on save.
          fields[idx].bareLiteral = undefined;
        }
      });
      removeBtn.addEventListener("click", () => {
        fields.splice(idx, 1);
        render();
      });
      body.appendChild(row);
    });
  }

  addBtn.addEventListener("click", () => {
    fields.push({ key: "", value: "", raw: false });
    render();
  });

  function commit(): void {
    // Drop fields with empty keys to keep the YAML valid.
    const cleaned = fields.filter((f) => f.raw || f.key.length > 0);
    const yaml = serializeFrontmatter(cleaned);
    const next = replaceFrontmatter(deps.getDoc(), yaml);
    deps.setDoc(next);
    hide();
  }

  saveBtn.addEventListener("click", commit);
  cancelBtn.addEventListener("click", hide);
  closeBtn.addEventListener("click", hide);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) hide();
  });

  return { show, hide };
}
