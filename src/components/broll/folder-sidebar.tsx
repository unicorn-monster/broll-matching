"use client";

import { useState } from "react";
import { Plus, Pencil, Trash2, FolderOpen, Library } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export type Folder = { id: string; name: string; clipCount: number };

interface FolderSidebarProps {
  folders: Folder[];
  activeFolderId: string | null;
  onSelect: (id: string | null) => void;
  onCreate: (name: string) => Promise<void>;
  onRename: (id: string, name: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  totalClipCount: number;
}

export function FolderSidebar({
  folders,
  activeFolderId,
  onSelect,
  onCreate,
  onRename,
  onDelete,
  totalClipCount,
}: FolderSidebarProps) {
  const [newName, setNewName] = useState("");
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");

  async function handleCreate() {
    if (!newName.trim()) return;
    await onCreate(newName.trim());
    setNewName("");
    setAdding(false);
  }

  async function handleRename(id: string) {
    if (!editName.trim()) return;
    await onRename(id, editName.trim());
    setEditingId(null);
  }

  return (
    <aside className="w-56 shrink-0 border-r border-border h-full overflow-y-auto flex flex-col">
      <div className="p-3 font-semibold text-sm uppercase tracking-wide text-muted-foreground">
        Library
      </div>

      <button
        onClick={() => onSelect(null)}
        className={`flex items-center gap-2 px-3 py-2 text-sm w-full text-left hover:bg-accent ${activeFolderId === null ? "bg-accent font-medium" : ""}`}
      >
        <Library className="w-4 h-4 shrink-0" />
        <span className="flex-1 truncate">All clips</span>
        <span className="text-xs text-muted-foreground">{totalClipCount}</span>
      </button>

      <div className="p-3 text-xs uppercase tracking-wide text-muted-foreground mt-2">Folders</div>

      {folders.map((f) => (
        <div key={f.id} className="group relative">
          {editingId === f.id ? (
            <div className="px-2 py-1 flex gap-1">
              <Input
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleRename(f.id);
                  if (e.key === "Escape") setEditingId(null);
                }}
                autoFocus
                className="h-7 text-sm"
              />
              <Button size="sm" variant="ghost" onClick={() => handleRename(f.id)} className="h-7 px-2">✓</Button>
            </div>
          ) : (
            <button
              onClick={() => onSelect(f.id)}
              className={`flex items-center gap-2 px-3 py-2 text-sm w-full text-left hover:bg-accent ${activeFolderId === f.id ? "bg-accent font-medium" : ""}`}
            >
              <FolderOpen className="w-4 h-4 shrink-0" />
              <span className="flex-1 truncate">{f.name}</span>
              <span className="text-xs text-muted-foreground">{f.clipCount}</span>
            </button>
          )}
          <div className="absolute right-2 top-1.5 hidden group-hover:flex gap-1">
            <button
              onClick={() => { setEditingId(f.id); setEditName(f.name); }}
              className="text-muted-foreground hover:text-foreground"
            >
              <Pencil className="w-3 h-3" />
            </button>
            <button onClick={() => onDelete(f.id)} className="text-muted-foreground hover:text-destructive">
              <Trash2 className="w-3 h-3" />
            </button>
          </div>
        </div>
      ))}

      <div className="p-2 mt-auto border-t border-border">
        {adding ? (
          <div className="flex gap-1">
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleCreate();
                if (e.key === "Escape") setAdding(false);
              }}
              autoFocus
              placeholder="Folder name"
              className="h-7 text-sm"
            />
            <Button size="sm" variant="ghost" onClick={handleCreate} className="h-7 px-2">✓</Button>
          </div>
        ) : (
          <Button variant="ghost" size="sm" className="w-full" onClick={() => setAdding(true)}>
            <Plus className="w-4 h-4 mr-1" /> Add Folder
          </Button>
        )}
      </div>
    </aside>
  );
}
