import type { AppSettings, ThemePresetId } from "./settings";
import { THEME_PRESETS, type ThemePreset } from "./themes";
import { getVersion } from "@tauri-apps/api/app";

interface FontEntry {
  value: string;
  label: string;
}

const EDITOR_FONTS: FontEntry[] = [
  { value: '"SF Mono", "Fira Code", monospace', label: "SF Mono" },
  { value: '"Menlo", "Monaco", monospace', label: "Menlo" },
  { value: '"JetBrains Mono", monospace', label: "JetBrains Mono" },
  { value: '"Consolas", monospace', label: "Consolas" },
  { value: '"Courier New", monospace', label: "Courier New" },
];

const PREVIEW_FONTS: FontEntry[] = [
  { value: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif', label: "System Sans" },
  { value: '"Georgia", serif', label: "Georgia" },
  { value: '"Palatino", "Palatino Linotype", serif', label: "Palatino" },
  { value: '"Helvetica Neue", "Arial", sans-serif', label: "Helvetica Neue" },
  { value: '"Avenir Next", "Avenir", sans-serif', label: "Avenir Next" },
];

export interface SettingsModal {
  show: () => void;
  hide: () => void;
  updateValues: (settings: AppSettings) => void;
}

/* ── Helpers ── */

function fontLabel(fontValue: string): string {
  const allFonts = [...EDITOR_FONTS, ...PREVIEW_FONTS];
  const entry = allFonts.find((f) => f.value === fontValue);
  if (entry) return entry.label;
  return fontValue.replace(/"/g, "").split(",")[0].trim();
}

/** Find index in a font list; returns -1 if not found */
function fontIndex(fonts: FontEntry[], value: string): number {
  return fonts.findIndex((f) => f.value === value);
}

function updateSliderFill(input: HTMLInputElement): void {
  const min = Number(input.min);
  const max = Number(input.max);
  const val = Number(input.value);
  const pct = ((val - min) / (max - min)) * 100;
  input.style.background = `linear-gradient(to right, var(--accent) 0%, var(--accent) ${pct}%, var(--border) ${pct}%, var(--border) 100%)`;
}

function buildThemeCard(preset: ThemePreset, selected: boolean): string {
  const v = preset.vars;
  const sel = selected ? " selected" : "";
  return `
    <div class="theme-card${sel}" data-theme="${preset.id}">
      <div class="theme-swatches">
        <span style="background:${v.bgPrimary}"></span>
        <span style="background:${v.accent}"></span>
        <span style="background:${v.textPrimary}"></span>
        <span style="background:${v.bgSecondary}"></span>
      </div>
      <span class="theme-label">${preset.label}</span>
    </div>`;
}

/** Use numeric data-index instead of raw font-family string to avoid HTML attribute quoting issues */
function buildFontOptions(fonts: FontEntry[], currentValue: string): string {
  return fonts
    .map((font, idx) => {
      const sel = font.value === currentValue ? " selected" : "";
      return `<div class="custom-select-option${sel}" data-index="${idx}" style="font-family:${font.value}">${font.label}</div>`;
    })
    .join("");
}

/* ── Main export ── */

export function createSettingsModal(
  initialSettings: AppSettings,
  onChange: (settings: AppSettings) => void,
  onCheckUpdate?: () => void,
): SettingsModal {
  let current = { ...initialSettings };

  // Build DOM
  const overlay = document.createElement("div");
  overlay.id = "settings-overlay";

  const themeCardsHtml = Object.values(THEME_PRESETS)
    .map((p) => buildThemeCard(p, p.id === current.theme))
    .join("");

  overlay.innerHTML = `
    <div id="settings-modal">
      <div class="settings-header">
        <h2>Appearance</h2>
        <button id="settings-close">&times;</button>
      </div>
      <div class="settings-body">

        <div class="settings-section">
          <div class="settings-section-title">Theme</div>
          <div class="theme-grid">${themeCardsHtml}</div>
        </div>

        <div class="settings-section">
          <div class="settings-section-title">Editor</div>
          <div class="settings-group">
            <label>Font</label>
            <div class="custom-select" id="cs-editor-font">
              <div class="custom-select-trigger">
                <span>${fontLabel(current.editorFontFamily)}</span>
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M3 4.5L6 7.5L9 4.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
              </div>
              <div class="custom-select-options">${buildFontOptions(EDITOR_FONTS, current.editorFontFamily)}</div>
            </div>
          </div>
          <div class="settings-group">
            <label>Font Size: <span class="setting-value" id="editor-size-val">${current.editorFontSize}</span>px</label>
            <input type="range" id="setting-editor-size" min="10" max="24" step="1" value="${current.editorFontSize}" />
          </div>
          <div class="settings-group settings-toggle-group">
            <label for="setting-line-numbers">Line Numbers</label>
            <input type="checkbox" id="setting-line-numbers" ${current.showLineNumbers ? "checked" : ""} />
          </div>
        </div>

        <div class="settings-section">
          <div class="settings-section-title">Preview</div>
          <div class="settings-group">
            <label>Font</label>
            <div class="custom-select" id="cs-preview-font">
              <div class="custom-select-trigger">
                <span>${fontLabel(current.previewFontFamily)}</span>
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M3 4.5L6 7.5L9 4.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
              </div>
              <div class="custom-select-options">${buildFontOptions(PREVIEW_FONTS, current.previewFontFamily)}</div>
            </div>
          </div>
          <div class="settings-group">
            <label>Font Size: <span class="setting-value" id="preview-size-val">${current.previewFontSize}</span>px</label>
            <input type="range" id="setting-preview-size" min="12" max="28" step="1" value="${current.previewFontSize}" />
          </div>
          <div class="settings-group">
            <label>Line Height: <span class="setting-value" id="line-height-val">${current.previewLineHeight.toFixed(1)}</span></label>
            <input type="range" id="setting-line-height" min="1.2" max="2.2" step="0.1" value="${current.previewLineHeight}" />
          </div>
          <div class="settings-group settings-toggle-group">
            <label for="setting-toc">Table of Contents</label>
            <input type="checkbox" id="setting-toc" ${current.showToc ? "checked" : ""} />
          </div>
        </div>

        <div class="settings-section">
          <div class="settings-section-title">About</div>
          <div class="settings-about">
            <span class="settings-version" id="settings-version">mdeditor</span>
            <button id="btn-check-update" class="settings-update-btn">Check for Updates</button>
          </div>
        </div>

      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  // Load version asynchronously
  getVersion().then((v) => {
    const versionEl = overlay.querySelector("#settings-version");
    if (versionEl) versionEl.textContent = `mdeditor v${v}`;
  });

  // Update check button
  const updateBtn = overlay.querySelector("#btn-check-update") as HTMLButtonElement;
  if (updateBtn && onCheckUpdate) {
    updateBtn.addEventListener("click", () => onCheckUpdate());
  }

  // References
  const themeGrid = overlay.querySelector(".theme-grid") as HTMLElement;
  const editorSizeInput = overlay.querySelector("#setting-editor-size") as HTMLInputElement;
  const editorSizeVal = overlay.querySelector("#editor-size-val") as HTMLSpanElement;
  const previewSizeInput = overlay.querySelector("#setting-preview-size") as HTMLInputElement;
  const previewSizeVal = overlay.querySelector("#preview-size-val") as HTMLSpanElement;
  const lineHeightInput = overlay.querySelector("#setting-line-height") as HTMLInputElement;
  const lineHeightVal = overlay.querySelector("#line-height-val") as HTMLSpanElement;
  const closeBtn = overlay.querySelector("#settings-close") as HTMLButtonElement;
  const lineNumbersCheckbox = overlay.querySelector("#setting-line-numbers") as HTMLInputElement;
  const tocCheckbox = overlay.querySelector("#setting-toc") as HTMLInputElement;

  const csEditorFont = overlay.querySelector("#cs-editor-font") as HTMLElement;
  const csPreviewFont = overlay.querySelector("#cs-preview-font") as HTMLElement;

  function emit(): void {
    onChange({ ...current });
  }

  // ── Theme cards ──
  themeGrid.addEventListener("click", (e) => {
    const card = (e.target as HTMLElement).closest(".theme-card") as HTMLElement | null;
    if (!card) return;
    const themeId = card.dataset.theme as ThemePresetId;
    current.theme = themeId;
    themeGrid.querySelectorAll(".theme-card").forEach((c) => c.classList.remove("selected"));
    card.classList.add("selected");
    emit();
  });

  // ── Custom font selects ──
  function setupCustomSelect(
    container: HTMLElement,
    fonts: FontEntry[],
    setValue: (v: string) => void,
  ): void {
    const trigger = container.querySelector(".custom-select-trigger") as HTMLElement;
    const optionsPanel = container.querySelector(".custom-select-options") as HTMLElement;

    trigger.addEventListener("click", (e) => {
      e.stopPropagation();
      // Close other open selects
      overlay.querySelectorAll(".custom-select.open").forEach((el) => {
        if (el !== container) el.classList.remove("open");
      });
      container.classList.toggle("open");
    });

    optionsPanel.addEventListener("click", (e) => {
      const opt = (e.target as HTMLElement).closest(".custom-select-option") as HTMLElement | null;
      if (!opt) return;
      const idx = Number(opt.dataset.index);
      const entry = fonts[idx];
      if (!entry) return;
      setValue(entry.value);
      // Update trigger display
      const triggerSpan = trigger.querySelector("span") as HTMLSpanElement;
      triggerSpan.textContent = entry.label;
      // Update selected state
      optionsPanel.querySelectorAll(".custom-select-option").forEach((o) => o.classList.remove("selected"));
      opt.classList.add("selected");
      container.classList.remove("open");
      emit();
    });
  }

  setupCustomSelect(
    csEditorFont,
    EDITOR_FONTS,
    (v) => { current.editorFontFamily = v; },
  );

  setupCustomSelect(
    csPreviewFont,
    PREVIEW_FONTS,
    (v) => { current.previewFontFamily = v; },
  );

  // Close dropdowns on outside click
  document.addEventListener("click", () => {
    overlay.querySelectorAll(".custom-select.open").forEach((el) => el.classList.remove("open"));
  });

  // ── Sliders ──
  const sliders = [editorSizeInput, previewSizeInput, lineHeightInput];
  sliders.forEach((s) => updateSliderFill(s));

  editorSizeInput.addEventListener("input", () => {
    current.editorFontSize = Number(editorSizeInput.value);
    editorSizeVal.textContent = editorSizeInput.value;
    updateSliderFill(editorSizeInput);
    emit();
  });

  previewSizeInput.addEventListener("input", () => {
    current.previewFontSize = Number(previewSizeInput.value);
    previewSizeVal.textContent = previewSizeInput.value;
    updateSliderFill(previewSizeInput);
    emit();
  });

  lineHeightInput.addEventListener("input", () => {
    current.previewLineHeight = Number(lineHeightInput.value);
    lineHeightVal.textContent = Number(lineHeightInput.value).toFixed(1);
    updateSliderFill(lineHeightInput);
    emit();
  });

  // ── Line numbers toggle ──
  lineNumbersCheckbox.addEventListener("change", () => {
    current.showLineNumbers = lineNumbersCheckbox.checked;
    emit();
  });

  // ── TOC toggle ──
  tocCheckbox.addEventListener("change", () => {
    current.showToc = tocCheckbox.checked;
    emit();
  });

  // ── Close ──
  closeBtn.addEventListener("click", () => {
    overlay.classList.remove("visible");
  });
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) overlay.classList.remove("visible");
  });

  return {
    show() {
      overlay.classList.add("visible");
    },
    hide() {
      overlay.classList.remove("visible");
    },
    updateValues(settings: AppSettings) {
      current = { ...settings };

      // Theme cards
      themeGrid.querySelectorAll(".theme-card").forEach((card) => {
        const el = card as HTMLElement;
        el.classList.toggle("selected", el.dataset.theme === settings.theme);
      });

      // Font triggers — update label text
      const edTriggerSpan = csEditorFont.querySelector(".custom-select-trigger span") as HTMLSpanElement;
      edTriggerSpan.textContent = fontLabel(settings.editorFontFamily);
      const edIdx = fontIndex(EDITOR_FONTS, settings.editorFontFamily);
      csEditorFont.querySelectorAll(".custom-select-option").forEach((o, i) => {
        o.classList.toggle("selected", i === edIdx);
      });

      const pvTriggerSpan = csPreviewFont.querySelector(".custom-select-trigger span") as HTMLSpanElement;
      pvTriggerSpan.textContent = fontLabel(settings.previewFontFamily);
      const pvIdx = fontIndex(PREVIEW_FONTS, settings.previewFontFamily);
      csPreviewFont.querySelectorAll(".custom-select-option").forEach((o, i) => {
        o.classList.toggle("selected", i === pvIdx);
      });

      // Sliders
      editorSizeInput.value = String(settings.editorFontSize);
      editorSizeVal.textContent = String(settings.editorFontSize);
      updateSliderFill(editorSizeInput);

      previewSizeInput.value = String(settings.previewFontSize);
      previewSizeVal.textContent = String(settings.previewFontSize);
      updateSliderFill(previewSizeInput);

      lineHeightInput.value = String(settings.previewLineHeight);
      lineHeightVal.textContent = settings.previewLineHeight.toFixed(1);
      updateSliderFill(lineHeightInput);

      // Line numbers
      lineNumbersCheckbox.checked = settings.showLineNumbers;

      // TOC
      tocCheckbox.checked = settings.showToc;
    },
  };
}
