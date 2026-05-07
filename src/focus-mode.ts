/**
 * Focus mode + typewriter mode toggles.
 *
 * - Focus mode: hides toolbar, tab bar, status bar, sidebar via a body class.
 * - Typewriter mode: keeps the active line near the vertical centre by
 *   scrolling the editor on every cursor / doc change. Pure CSS padding
 *   gives the runway; this module dispatches the scroll.
 */

import { EditorView } from "@codemirror/view";

let focusEnabled = false;
let typewriterEnabled = false;
let typewriterListener: ((view: EditorView) => void) | null = null;

export function isFocusMode(): boolean {
  return focusEnabled;
}

export function isTypewriterMode(): boolean {
  return typewriterEnabled;
}

export function toggleFocusMode(): boolean {
  focusEnabled = !focusEnabled;
  document.body.classList.toggle("focus-mode", focusEnabled);
  // Editor's measured height changes — let CM recompute viewport.
  window.dispatchEvent(new Event("resize"));
  return focusEnabled;
}

export function toggleTypewriterMode(view: EditorView): boolean {
  typewriterEnabled = !typewriterEnabled;
  document.body.classList.toggle("typewriter-mode", typewriterEnabled);
  if (typewriterEnabled) {
    centerActiveLine(view);
  }
  return typewriterEnabled;
}

/**
 * Scroll the editor so the cursor's line sits at the vertical centre.
 * Called whenever the cursor moves and typewriter mode is on.
 */
export function centerActiveLine(view: EditorView): void {
  if (!typewriterEnabled) return;
  const head = view.state.selection.main.head;
  view.dispatch({
    effects: EditorView.scrollIntoView(head, { y: "center" }),
  });
}

/**
 * Install a listener that re-centres on every selection / doc change.
 * Idempotent — safe to call multiple times.
 */
export function installTypewriterListener(view: EditorView): void {
  if (typewriterListener) return;
  typewriterListener = (v) => centerActiveLine(v);
  // ViewPlugin would be the canonical way, but a DOM event listener is
  // sufficient and easier to retrofit into the existing keyup/mouseup setup.
  view.dom.addEventListener("keyup", () => typewriterListener?.(view));
  view.dom.addEventListener("mouseup", () => typewriterListener?.(view));
}
