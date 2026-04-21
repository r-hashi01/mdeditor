import { listDirectory, type DirEntry } from "./folder-io";
import { getIcon } from "material-file-icons";
import { basename } from "./path-utils";
import chevronRightIcon from "lucide-static/icons/chevron-right.svg?raw";
import folderIcon from "lucide-static/icons/folder.svg?raw";
import folderOpenIcon from "lucide-static/icons/folder-open.svg?raw";
import xIcon from "lucide-static/icons/x.svg?raw";

export interface FileTreeSidebar {
  mount(container: HTMLElement): void;
  openFolder(folderPath: string): Promise<void>;
  toggle(): void;
  isVisible(): boolean;
  setSelectedFile(path: string | null): void;
}

const CODE_EXTENSIONS = new Set([
  "ts", "tsx", "js", "jsx", "rs", "py", "css", "html", "htm",
  "json", "xml", "svg", "yaml", "yml", "toml", "sh", "bash", "zsh",
  "go", "java", "c", "cpp", "h", "hpp", "rb", "php", "swift",
  "drawio",
]);
const TEXT_EXTENSIONS = new Set(["md", "markdown", "txt", "log", "csv", "tsv"]);
const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "svg", "webp", "bmp", "ico", "avif"]);
const BINARY_PREVIEW_EXTENSIONS = new Set(["pdf", "docx", "doc", "xlsx", "xls", "pptx", "ppt"]);

/** Returns true if the file can be opened in the editor or previewed. */
function isOpenableFile(name: string): boolean {
  const dot = name.lastIndexOf(".");
  if (dot < 0) return true;
  const ext = name.slice(dot + 1).toLowerCase();
  return TEXT_EXTENSIONS.has(ext) || CODE_EXTENSIONS.has(ext) || IMAGE_EXTENSIONS.has(ext) || BINARY_PREVIEW_EXTENSIONS.has(ext);
}

function sortEntries(entries: DirEntry[]): DirEntry[] {
  return entries.slice().sort((a, b) => {
    if (a.is_dir !== b.is_dir) return a.is_dir ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  });
}

export function createFileTree(
  onFileSelect: (path: string) => Promise<void>,
  onClose?: () => void,
): FileTreeSidebar {
  let container: HTMLElement | null = null;
  let rootEl: HTMLElement | null = null;
  let currentFolder: string | null = null;
  let selectedPath: string | null = null;
  const expandedPaths = new Set<string>();
  // Cache loaded children to avoid re-fetching on collapse/expand
  const loadedChildren = new Map<string, DirEntry[]>();
  // Map file paths to their DOM rows for O(1) selection lookup
  const fileRowMap = new Map<string, HTMLElement>();

  function mount(el: HTMLElement): void {
    container = el;
  }

  async function openFolder(folderPath: string): Promise<void> {
    currentFolder = folderPath;
    expandedPaths.clear();
    loadedChildren.clear();
    fileRowMap.clear();
    selectedPath = null;

    if (!container) return;
    container.innerHTML = "";

    rootEl = document.createElement("div");
    rootEl.className = "tree-root";

    // Header showing folder name + close button
    const header = document.createElement("div");
    header.className = "tree-header";
    const headerLabel = document.createElement("span");
    headerLabel.className = "tree-header-label";
    headerLabel.textContent = basename(folderPath);
    headerLabel.title = folderPath;
    header.appendChild(headerLabel);
    if (onClose) {
      const closeBtn = document.createElement("button");
      closeBtn.className = "tree-header-close";
      closeBtn.innerHTML = xIcon;
      closeBtn.title = "Close sidebar";
      closeBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        onClose();
      });
      header.appendChild(closeBtn);
    }
    rootEl.appendChild(header);

    container.appendChild(rootEl);

    // Load and render top-level entries
    await loadAndRenderChildren(rootEl, folderPath);
    container.classList.add("visible");
  }

  async function loadAndRenderChildren(
    parentEl: HTMLElement,
    dirPath: string,
  ): Promise<void> {
    let entries: DirEntry[];
    if (loadedChildren.has(dirPath)) {
      entries = loadedChildren.get(dirPath)!;
    } else {
      try {
        entries = sortEntries(await listDirectory(dirPath));
        loadedChildren.set(dirPath, entries);
      } catch (e) {
        console.warn("Failed to list directory:", dirPath, e);
        return;
      }
    }

    for (const entry of entries) {
      if (entry.is_dir) {
        renderDirNode(parentEl, entry);
      } else {
        renderFileNode(parentEl, entry);
      }
    }
  }

  function renderDirNode(parentEl: HTMLElement, entry: DirEntry): void {
    const wrapper = document.createElement("div");

    const row = document.createElement("div");
    row.className = "tree-row";
    row.dataset.path = entry.path;
    row.dataset.type = "dir";

    // Chevron
    const chevron = document.createElement("span");
    chevron.className = "tree-chevron";
    chevron.innerHTML = chevronRightIcon;
    row.appendChild(chevron);

    // Folder icon
    const icon = document.createElement("span");
    icon.innerHTML = folderIcon;
    row.appendChild(icon);

    // Name
    const nameSpan = document.createElement("span");
    nameSpan.className = "tree-name";
    nameSpan.textContent = entry.name;
    row.appendChild(nameSpan);

    wrapper.appendChild(row);

    // Children container (initially hidden)
    const childContainer = document.createElement("div");
    childContainer.className = "tree-children";
    wrapper.appendChild(childContainer);

    // Click handler
    row.addEventListener("click", async () => {
      const isExpanded = expandedPaths.has(entry.path);
      if (isExpanded) {
        // Collapse
        expandedPaths.delete(entry.path);
        childContainer.classList.remove("expanded");
        chevron.classList.remove("expanded");
        icon.innerHTML = folderIcon;
      } else {
        // Expand
        expandedPaths.add(entry.path);
        chevron.classList.add("expanded");
        icon.innerHTML = folderOpenIcon;
        // Load children if not yet loaded into DOM
        if (childContainer.children.length === 0) {
          await loadAndRenderChildren(childContainer, entry.path);
        }
        childContainer.classList.add("expanded");
      }
    });

    parentEl.appendChild(wrapper);
  }

  function renderFileNode(parentEl: HTMLElement, entry: DirEntry): void {
    const openable = isOpenableFile(entry.name);
    const row = document.createElement("div");
    row.className = "tree-row" + (openable ? "" : " disabled");
    row.dataset.path = entry.path;
    row.dataset.type = "file";

    // Spacer to align with directories (chevron width)
    const spacer = document.createElement("span");
    spacer.style.width = "14px";
    spacer.style.flexShrink = "0";
    row.appendChild(spacer);

    // File icon — material-file-icons provides colored SVG logos per file type
    const icon = document.createElement("span");
    icon.className = "tree-file-icon";
    icon.innerHTML = getIcon(entry.name).svg;
    row.appendChild(icon);

    // Name
    const nameSpan = document.createElement("span");
    nameSpan.className = "tree-name";
    nameSpan.textContent = entry.name;
    row.appendChild(nameSpan);

    // Click handler (only for openable files)
    if (openable) {
      row.addEventListener("click", () => {
        onFileSelect(entry.path);
      });
    }

    // Register in lookup map for O(1) selection
    fileRowMap.set(entry.path, row);
    parentEl.appendChild(row);
  }

  function setSelectedFile(path: string | null): void {
    // Remove previous selection via map lookup (O(1))
    if (selectedPath) {
      const prevRow = fileRowMap.get(selectedPath);
      if (prevRow) prevRow.classList.remove("selected");
    }

    selectedPath = path;
    if (!path) return;

    // Highlight the new selection via map lookup (O(1))
    const row = fileRowMap.get(path);
    if (row) {
      row.classList.add("selected");
      row.scrollIntoView({ block: "nearest" });
    }
  }

  function toggle(): void {
    if (!container) return;
    container.classList.toggle("visible");
  }

  function isVisible(): boolean {
    if (!container) return false;
    return container.classList.contains("visible");
  }

  return {
    mount,
    openFolder,
    toggle,
    isVisible,
    setSelectedFile,
  };
}
