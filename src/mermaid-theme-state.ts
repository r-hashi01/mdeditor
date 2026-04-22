/**
 * Shared pending Mermaid theme state.
 * Lives in its own tiny module so that theme-apply.ts can update the theme
 * synchronously without pulling the full preview renderer into the main chunk.
 * The renderer (preview.ts) reads pendingMermaidTheme when Mermaid initializes
 * and listens for theme changes via the subscriber hook.
 */

let pendingMermaidTheme = "default";
type Listener = (theme: string) => void;
const listeners = new Set<Listener>();

export function setMermaidTheme(theme: string): void {
  pendingMermaidTheme = theme;
  for (const l of listeners) l(theme);
}

export function getPendingMermaidTheme(): string {
  return pendingMermaidTheme;
}

export function subscribeMermaidTheme(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
