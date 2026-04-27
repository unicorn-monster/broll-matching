"use client";

import { Folder, FolderPlus, Layers, MoreVertical, Pencil, Search, Trash2 } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { filterFoldersByName } from "@/lib/folder-filter";

export interface FolderTile {
  id: string;
  name: string;
  clipCount: number;
}

interface FoldersGridProps {
  folders: FolderTile[];
  totalClipCount: number;
  onSelect: (folderId: string | null) => void;
  onCreate: (name: string) => Promise<void> | void;
  onRename: (id: string, name: string) => Promise<void> | void;
  onDelete: (id: string) => Promise<void> | void;
}

export function FoldersGrid({
  folders,
  totalClipCount,
  onSelect,
  onCreate,
  onRename,
  onDelete,
}: FoldersGridProps) {
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [query, setQuery] = useState("");

  const visibleFolders = filterFoldersByName(folders, query);

  async function handleCreate() {
    const trimmed = newName.trim();
    if (!trimmed) {
      setCreating(false);
      return;
    }
    await onCreate(trimmed);
    setNewName("");
    setCreating(false);
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border text-xs">
        <span className="font-medium text-muted-foreground uppercase tracking-wide shrink-0">Library</span>
        <div className="relative flex-1 min-w-0">
          <Search className="w-3 h-3 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setQuery("");
            }}
            placeholder="Search folders…"
            aria-label="Search folders"
            className="w-full pl-6 pr-2 py-1 bg-background border border-border rounded text-xs focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="inline-flex items-center gap-1 px-2 py-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground shrink-0"
          aria-label="New folder"
        >
          <FolderPlus className="w-3.5 h-3.5" /> New
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-3">
        <div className="grid grid-cols-3 gap-3">
          <FolderTile
            icon={<Layers className="w-10 h-10" />}
            name="All clips"
            count={totalClipCount}
            tone="neutral"
            onClick={() => onSelect(null)}
          />

          {visibleFolders.map((f) => (
            <FolderTile
              key={f.id}
              icon={<Folder className="w-10 h-10 fill-yellow-400 text-yellow-500" />}
              name={f.name}
              count={f.clipCount}
              tone="yellow"
              onClick={() => onSelect(f.id)}
              onRename={async () => {
                const next = prompt("Rename folder", f.name);
                if (next && next.trim() && next.trim() !== f.name) await onRename(f.id, next.trim());
              }}
              onDelete={async () => {
                if (confirm(`Delete folder "${f.name}" and all its clips?`)) await onDelete(f.id);
              }}
            />
          ))}

          {creating && (
            <div className="flex flex-col items-center gap-1 p-2 rounded-md border border-dashed border-border bg-muted/30">
              <Folder className="w-10 h-10 fill-yellow-400 text-yellow-500" />
              <input
                autoFocus
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleCreate();
                  if (e.key === "Escape") { setCreating(false); setNewName(""); }
                }}
                onBlur={handleCreate}
                placeholder="Folder name"
                className="w-full px-1 py-0.5 text-xs text-center bg-background border border-border rounded"
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

interface FolderTileInnerProps {
  icon: React.ReactNode;
  name: string;
  count: number;
  tone: "yellow" | "neutral";
  onClick: () => void;
  onRename?: () => void;
  onDelete?: () => void;
}

function FolderTile({ icon, name, count, tone, onClick, onRename, onDelete }: FolderTileInnerProps) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div
      className={cn(
        "relative group rounded-md border p-2 flex flex-col items-center gap-1 cursor-pointer transition",
        tone === "yellow"
          ? "border-border hover:border-yellow-500/60 hover:bg-yellow-500/5"
          : "border-border hover:border-foreground/30 hover:bg-muted/40",
      )}
      onClick={onClick}
    >
      {icon}
      <div className="w-full text-xs text-center truncate" title={name}>
        {name}
      </div>
      <div className="text-[10px] text-muted-foreground">{count} clip{count === 1 ? "" : "s"}</div>

      {(onRename || onDelete) && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); setMenuOpen((v) => !v); }}
          className="absolute top-1 right-1 p-1 rounded opacity-0 group-hover:opacity-100 hover:bg-muted text-muted-foreground"
          aria-label="Folder actions"
        >
          <MoreVertical className="w-3 h-3" />
        </button>
      )}

      {menuOpen && (onRename || onDelete) && (
        <div
          className="absolute top-7 right-1 z-10 bg-popover border border-border rounded-md shadow-md py-1 text-xs"
          onClick={(e) => e.stopPropagation()}
        >
          {onRename && (
            <button
              type="button"
              onClick={() => { setMenuOpen(false); onRename(); }}
              className="flex items-center gap-2 px-3 py-1 hover:bg-muted w-full text-left"
            >
              <Pencil className="w-3 h-3" /> Rename
            </button>
          )}
          {onDelete && (
            <button
              type="button"
              onClick={() => { setMenuOpen(false); onDelete(); }}
              className="flex items-center gap-2 px-3 py-1 hover:bg-muted w-full text-left text-destructive"
            >
              <Trash2 className="w-3 h-3" /> Delete
            </button>
          )}
        </div>
      )}
    </div>
  );
}
