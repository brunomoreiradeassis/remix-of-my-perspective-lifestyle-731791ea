import { useState, useRef, useEffect, useCallback } from "react";
import {
  FolderOpen,
  FileText,
  FileCode,
  Image,
  ChevronRight,
  ChevronDown,
  Trash2,
  FolderInput,
  FilePlus,
  X,
} from "lucide-react";
import { Sparkles } from "lucide-react";
import { useOllama } from "@/contexts/OllamaContext";
import { toast } from "@/components/ui/use-toast";

interface FileItem {
  name: string;
  type: "file" | "folder";
  icon?: React.ReactNode;
  children?: FileItem[];
  ai?: boolean;
  full?: string;
}

function getFileIcon(name: string) {
  if (name.endsWith(".tsx") || name.endsWith(".ts"))
    return <FileCode className="h-3.5 w-3.5 text-[#89b4fa]" />;
  if (name.endsWith(".jsx") || name.endsWith(".js"))
    return <FileCode className="h-3.5 w-3.5 text-[#f9e2af]" />;
  if (name.endsWith(".css"))
    return <FileText className="h-3.5 w-3.5 text-[#cba6f7]" />;
  if (name.endsWith(".json"))
    return <FileText className="h-3.5 w-3.5 text-[#a6e3a1]" />;
  if (name.endsWith(".svg") || name.endsWith(".ico") || name.endsWith(".png") || name.endsWith(".jpg"))
    return <Image className="h-3.5 w-3.5 text-[#f38ba8]" />;
  if (name.endsWith(".md") || name.endsWith(".txt"))
    return <FileText className="h-3.5 w-3.5 text-[#94e2d5]" />;
  return <FileText className="h-3.5 w-3.5 text-[#6c7086]" />;
}

// ----------- Context Menu Types -----------
type ContextMenuTarget =
  | { kind: "file"; path: string; name: string }
  | { kind: "folder"; path: string; name: string };

interface ContextMenuState {
  target: ContextMenuTarget;
  x: number;
  y: number;
}

// ----------- Modal Types -----------
type ModalState =
  | { kind: "none" }
  | { kind: "confirm-delete-file"; path: string; name: string }
  | { kind: "confirm-delete-folder"; path: string; name: string }
  | { kind: "move-file"; path: string; name: string; newPath: string }
  | { kind: "create-file"; folderPath: string; fileName: string };

// ----------- FileTreeNode -----------
function FileTreeNode({
  item,
  depth = 0,
  selectedFile,
  onSelect,
  parentPath = "",
  onContextMenu,
}: {
  item: FileItem;
  depth?: number;
  selectedFile: string;
  onSelect: (fullPath: string) => void;
  parentPath?: string;
  onContextMenu: (e: React.MouseEvent, target: ContextMenuTarget) => void;
}) {
  const [open, setOpen] = useState(false);
  const folderPath = parentPath ? `${parentPath}${item.name}` : item.name;

  if (item.type === "folder") {
    return (
      <div>
        <button
          onClick={() => setOpen(!open)}
          onContextMenu={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onContextMenu(e, { kind: "folder", path: folderPath, name: item.name });
          }}
          className="flex w-full min-w-0 items-center gap-1.5 px-2 py-1 text-xs hover:bg-[#313244] rounded-sm transition-colors text-[#cdd6f4] group"
          style={{ paddingLeft: `${depth * 14 + 8}px` }}
        >
          {open ? (
            <ChevronDown className="h-3 w-3 text-[#6c7086]" />
          ) : (
            <ChevronRight className="h-3 w-3 text-[#6c7086]" />
          )}
          <FolderOpen className="h-3.5 w-3.5 text-[#89b4fa]/70" />
          <span className="font-mono truncate flex-1 text-left" title={item.name}>{item.name}</span>
        </button>
        {open &&
          item.children?.map((child) => (
            <FileTreeNode
              key={child.name}
              item={child}
              depth={depth + 1}
              selectedFile={selectedFile}
              onSelect={onSelect}
              parentPath={`${folderPath}/`}
              onContextMenu={onContextMenu}
            />
          ))}
      </div>
    );
  }

  const fullPath = item.full ?? `${parentPath}${item.name}`;
  const isSelected = selectedFile === fullPath;

  return (
    <button
      onClick={() => onSelect(fullPath)}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onContextMenu(e, { kind: "file", path: fullPath, name: item.name });
      }}
      className={`flex w-full min-w-0 items-center gap-1.5 px-2 py-1 text-xs rounded-sm transition-colors font-mono group ${
        isSelected
          ? "bg-[#89b4fa]/10 text-[#89b4fa]"
          : "text-[#a6adc8] hover:bg-[#313244] hover:text-[#cdd6f4]"
      }`}
      style={{ paddingLeft: `${depth * 14 + 22}px` }}
    >
      {getFileIcon(item.name)}
      <span className="truncate flex-1 text-left" title={item.name}>{item.name}</span>
      {item.ai && <Sparkles className="h-3 w-3 text-[#89b4fa] ml-auto" />}
    </button>
  );
}

// ----------- Context Menu Popup -----------
function ContextMenuPopup({
  state,
  onClose,
  onAction,
}: {
  state: ContextMenuState;
  onClose: () => void;
  onAction: (action: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [onClose]);

  const items =
    state.target.kind === "file"
      ? [
          { key: "delete", label: "Excluir", icon: Trash2, danger: true },
          { key: "move", label: "Mover", icon: FolderInput, danger: false },
        ]
      : [
          { key: "delete-folder", label: "Excluir Pasta", icon: Trash2, danger: true },
          { key: "create-file", label: "Criar Arquivo", icon: FilePlus, danger: false },
        ];

  return (
    <div
      ref={ref}
      className="fixed z-[9999] min-w-[160px] rounded-lg border border-[#313244] bg-[#1e1e2e] shadow-xl py-1 animate-in fade-in-0 zoom-in-95"
      style={{ top: state.y, left: state.x }}
    >
      <div className="px-3 py-1.5 text-[10px] font-medium text-[#6c7086] uppercase tracking-wider truncate max-w-[200px]">
        {state.target.name}
      </div>
      <div className="h-px bg-[#313244] mx-1" />
      {items.map((item) => (
        <button
          key={item.key}
          onClick={() => onAction(item.key)}
          className={`flex w-full items-center gap-2 px-3 py-1.5 text-xs transition-colors ${
            item.danger
              ? "text-[#f38ba8] hover:bg-[#f38ba815]"
              : "text-[#cdd6f4] hover:bg-[#313244]"
          }`}
        >
          <item.icon className="h-3.5 w-3.5" />
          {item.label}
        </button>
      ))}
    </div>
  );
}

// ----------- Action Modal -----------
function ActionModal({
  modal,
  onClose,
  onConfirm,
  onChangeNewPath,
  onChangeFileName,
}: {
  modal: ModalState;
  onClose: () => void;
  onConfirm: () => void;
  onChangeNewPath: (val: string) => void;
  onChangeFileName: (val: string) => void;
}) {
  if (modal.kind === "none") return null;

  let title = "";
  let description = "";
  let confirmLabel = "";
  let isDanger = false;
  let showInput = false;
  let inputValue = "";
  let inputPlaceholder = "";
  let onInputChange: (v: string) => void = () => {};

  switch (modal.kind) {
    case "confirm-delete-file":
      title = "Excluir Arquivo";
      description = `Tem certeza que deseja excluir "${modal.name}"? Esta acao nao pode ser desfeita.`;
      confirmLabel = "Excluir";
      isDanger = true;
      break;
    case "confirm-delete-folder":
      title = "Excluir Pasta";
      description = `Tem certeza que deseja excluir a pasta "${modal.name}" e todo seu conteudo? Esta acao nao pode ser desfeita.`;
      confirmLabel = "Excluir";
      isDanger = true;
      break;
    case "move-file":
      title = "Mover Arquivo";
      description = `Mover "${modal.name}" para um novo caminho:`;
      confirmLabel = "Mover";
      showInput = true;
      inputValue = modal.newPath;
      inputPlaceholder = "ex: src/components/NomeArquivo.tsx";
      onInputChange = onChangeNewPath;
      break;
    case "create-file":
      title = "Criar Arquivo";
      description = `Criar um novo arquivo dentro de "${modal.folderPath}":`;
      confirmLabel = "Criar";
      showInput = true;
      inputValue = modal.fileName;
      inputPlaceholder = "ex: NomeArquivo.tsx";
      onInputChange = onChangeFileName;
      break;
  }

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 animate-in fade-in-0">
      <div className="relative w-full max-w-sm rounded-xl border border-[#313244] bg-[#1e1e2e] shadow-2xl p-5 mx-4 animate-in zoom-in-95">
        <button
          onClick={onClose}
          className="absolute top-3 right-3 text-[#6c7086] hover:text-[#cdd6f4] transition-colors"
        >
          <X className="h-4 w-4" />
        </button>

        <h3 className="text-sm font-semibold text-[#cdd6f4] mb-2">{title}</h3>
        <p className="text-xs text-[#a6adc8] mb-4 leading-relaxed">{description}</p>

        {showInput && (
          <input
            type="text"
            value={inputValue}
            onChange={(e) => onInputChange(e.target.value)}
            placeholder={inputPlaceholder}
            className="w-full mb-4 px-3 py-2 rounded-lg border border-[#313244] bg-[#181825] text-xs text-[#cdd6f4] font-mono placeholder:text-[#6c7086] outline-none focus:border-[#89b4fa] transition-colors"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter") onConfirm();
              if (e.key === "Escape") onClose();
            }}
          />
        )}

        <div className="flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            className="px-3 py-1.5 rounded-lg text-xs text-[#a6adc8] hover:bg-[#313244] transition-colors"
          >
            Cancelar
          </button>
          <button
            onClick={onConfirm}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              isDanger
                ? "bg-[#f38ba8] text-[#1e1e2e] hover:bg-[#f38ba8]/80"
                : "bg-[#89b4fa] text-[#1e1e2e] hover:bg-[#89b4fa]/80"
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

// ----------- Main FileSidebar -----------
export function FileSidebar() {
  const [selectedFile, setSelectedFile] = useState("");
  const { virtualFiles, setCurrentFile, dirHandle, deleteVirtualFile, moveVirtualFile, deleteFolderRemote, createFileRemote, nodeModulesAvailable } = useOllama();

  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [modal, setModal] = useState<ModalState>({ kind: "none" });

  const tree: FileItem[] = (() => {
    if (dirHandle || virtualFiles.length > 0) {
      const root: FileItem[] = [];

      virtualFiles.forEach((file) => {
        const parts = file.path.split(/[\\\/]/);
        let currentLevel = root;

        parts.forEach((part, index) => {
          const isFile = index === parts.length - 1;
          let existing = currentLevel.find((item) => item.name === part);

          if (!existing) {
            existing = {
              name: part,
              type: isFile ? "file" : "folder",
              ai: isFile ? file.ai : false,
              children: isFile ? undefined : [],
              ...(isFile ? { full: file.path } : {}),
            };
            currentLevel.push(existing);
          }

          if (!isFile) {
            currentLevel = existing.children!;
          }
        });
      });

      if (nodeModulesAvailable && !root.some((item) => item.name === "node_modules")) {
        root.push({ name: "node_modules", type: "folder", children: [] });
      }

      const sortItems = (items: FileItem[]) => {
        items.sort((a, b) => {
          if (a.type !== b.type) return a.type === "folder" ? -1 : 1;
          return a.name.localeCompare(b.name);
        });
        items.forEach((item) => {
          if (item.children) sortItems(item.children);
        });
      };

      sortItems(root);
      return root;
    }

    return [];
  })();

  const handleFileSelect = (path: string) => {
    setSelectedFile(path);
    setCurrentFile(path);
    window.dispatchEvent(new CustomEvent("file-selected"));
  };

  const handleContextMenu = useCallback((e: React.MouseEvent, target: ContextMenuTarget) => {
    e.preventDefault();
    setContextMenu({ target, x: e.clientX, y: e.clientY });
  }, []);

  const closeContextMenu = useCallback(() => {
    setContextMenu(null);
  }, []);

  const handleContextAction = useCallback(
    (action: string) => {
      if (!contextMenu) return;
      const { target } = contextMenu;
      closeContextMenu();

      switch (action) {
        case "delete":
          if (target.kind === "file") {
            setModal({ kind: "confirm-delete-file", path: target.path, name: target.name });
          }
          break;
        case "move":
          if (target.kind === "file") {
            setModal({ kind: "move-file", path: target.path, name: target.name, newPath: target.path });
          }
          break;
        case "delete-folder":
          if (target.kind === "folder") {
            setModal({ kind: "confirm-delete-folder", path: target.path, name: target.name });
          }
          break;
        case "create-file":
          if (target.kind === "folder") {
            setModal({ kind: "create-file", folderPath: target.path, fileName: "" });
          }
          break;
      }
    },
    [contextMenu, closeContextMenu]
  );

  const handleModalConfirm = useCallback(async () => {
    switch (modal.kind) {
      case "confirm-delete-file":
        deleteVirtualFile(modal.path);
        toast({ title: "Arquivo excluido", description: modal.name });
        break;
      case "confirm-delete-folder":
        await deleteFolderRemote(modal.path);
        toast({ title: "Pasta excluida", description: modal.name });
        break;
      case "move-file":
        if (modal.newPath && modal.newPath !== modal.path) {
          await moveVirtualFile(modal.path, modal.newPath);
          toast({ title: "Arquivo movido", description: `${modal.name} -> ${modal.newPath}` });
        }
        break;
      case "create-file": {
        if (modal.fileName.trim()) {
          const fullPath = `${modal.folderPath}/${modal.fileName.trim()}`;
          await createFileRemote(fullPath, "");
          toast({ title: "Arquivo criado", description: fullPath });
          handleFileSelect(fullPath);
        }
        break;
      }
    }
    setModal({ kind: "none" });
  }, [modal, deleteVirtualFile, moveVirtualFile, deleteFolderRemote, createFileRemote]);

  const handleChangeNewPath = useCallback(
    (val: string) => {
      if (modal.kind === "move-file") {
        setModal({ ...modal, newPath: val });
      }
    },
    [modal]
  );

  const handleChangeFileName = useCallback(
    (val: string) => {
      if (modal.kind === "create-file") {
        setModal({ ...modal, fileName: val });
      }
    },
    [modal]
  );

  return (
    <div className="h-full flex flex-col bg-[#181825] overflow-x-auto">
      <div className="px-3 py-3 border-b border-[#313244]">
        <h2 className="text-[11px] font-semibold uppercase tracking-wider text-[#6c7086]">
          Explorer
        </h2>
      </div>
      <div className="flex-1 overflow-y-auto overflow-x-auto py-1 scrollbar-thin">
        {tree.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 text-xs text-[#6c7086] px-4 text-center gap-2">
            <FolderOpen className="h-6 w-6 text-[#45475a]" />
            <span>Nenhum projeto aberto.</span>
            <span className="text-[10px] text-[#45475a]">Use "Abrir Pasta" no header.</span>
          </div>
        ) : (
          tree.map((item) => (
            <FileTreeNode
              key={item.name}
              item={item}
              selectedFile={selectedFile}
              onSelect={handleFileSelect}
              parentPath=""
              onContextMenu={handleContextMenu}
            />
          ))
        )}
      </div>

      {/* Context menu popup */}
      {contextMenu && (
        <ContextMenuPopup
          state={contextMenu}
          onClose={closeContextMenu}
          onAction={handleContextAction}
        />
      )}

      {/* Action modal */}
      <ActionModal
        modal={modal}
        onClose={() => setModal({ kind: "none" })}
        onConfirm={handleModalConfirm}
        onChangeNewPath={handleChangeNewPath}
        onChangeFileName={handleChangeFileName}
      />
    </div>
  );
}
