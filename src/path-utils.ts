/** Extract the file name from an absolute or relative path. */
export function basename(path: string): string {
  return path.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || path;
}
