"use client";

import { useState } from "react";
import { Plus, Pencil, Trash2, Tag } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface TagItem {
  id: string;
  name: string;
  sortOrder: number;
  clipCount: number;
}

interface TagSidebarProps {
  productId: string;
  tags: TagItem[];
  activeTagId: string | null;
  onSelectTag: (tagId: string) => void;
  onTagsChanged: () => void;
}

export function TagSidebar({
  productId,
  tags,
  activeTagId,
  onSelectTag,
  onTagsChanged,
}: TagSidebarProps) {
  const [addOpen, setAddOpen] = useState(false);
  const [newTagName, setNewTagName] = useState("");
  const [addLoading, setAddLoading] = useState(false);

  const [renameOpen, setRenameOpen] = useState(false);
  const [renamingTag, setRenamingTag] = useState<TagItem | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [renameLoading, setRenameLoading] = useState(false);

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deletingTag, setDeletingTag] = useState<TagItem | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  async function handleAddTag() {
    if (!newTagName.trim()) return;
    setAddLoading(true);
    try {
      const res = await fetch(`/api/products/${productId}/tags`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newTagName.trim() }),
      });
      if (!res.ok) throw new Error("Failed to create tag");
      toast.success("Tag created");
      setNewTagName("");
      setAddOpen(false);
      onTagsChanged();
    } catch {
      toast.error("Failed to create tag");
    } finally {
      setAddLoading(false);
    }
  }

  function openRename(tag: TagItem) {
    setRenamingTag(tag);
    setRenameValue(tag.name);
    setRenameOpen(true);
  }

  async function handleRename() {
    if (!renamingTag || !renameValue.trim()) return;
    setRenameLoading(true);
    try {
      const res = await fetch(
        `/api/products/${productId}/tags/${renamingTag.id}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: renameValue.trim() }),
        }
      );
      if (!res.ok) throw new Error("Failed to rename tag");
      toast.success("Tag renamed");
      setRenameOpen(false);
      setRenamingTag(null);
      onTagsChanged();
    } catch {
      toast.error("Failed to rename tag");
    } finally {
      setRenameLoading(false);
    }
  }

  function openDelete(tag: TagItem) {
    setDeletingTag(tag);
    setDeleteOpen(true);
  }

  async function handleDelete() {
    if (!deletingTag) return;
    setDeleteLoading(true);
    try {
      const res = await fetch(
        `/api/products/${productId}/tags/${deletingTag.id}`,
        { method: "DELETE" }
      );
      if (!res.ok) throw new Error("Failed to delete tag");
      toast.success("Tag deleted");
      setDeleteOpen(false);
      setDeletingTag(null);
      onTagsChanged();
    } catch {
      toast.error("Failed to delete tag");
    } finally {
      setDeleteLoading(false);
    }
  }

  return (
    <>
      <div className="w-56 border-r border-border flex flex-col shrink-0 bg-background">
        <div className="p-3 border-b border-border flex items-center justify-between">
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            Tags
          </span>
          <Button
            variant="ghost"
            size="icon"
            className="w-6 h-6"
            onClick={() => setAddOpen(true)}
          >
            <Plus className="w-3.5 h-3.5" />
          </Button>
        </div>

        <div className="flex-1 overflow-y-auto py-1">
          {tags.length === 0 ? (
            <div className="px-4 py-6 text-center">
              <Tag className="w-6 h-6 mx-auto mb-2 text-muted-foreground/50" />
              <p className="text-xs text-muted-foreground">No tags yet</p>
              <button
                onClick={() => setAddOpen(true)}
                className="text-xs text-primary hover:underline mt-1"
              >
                Add a tag
              </button>
            </div>
          ) : (
            tags.map((tag) => (
              <TagRow
                key={tag.id}
                tag={tag}
                isActive={tag.id === activeTagId}
                onSelect={() => onSelectTag(tag.id)}
                onRename={() => openRename(tag)}
                onDelete={() => openDelete(tag)}
              />
            ))
          )}
        </div>
      </div>

      {/* Add tag dialog */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Add Tag</DialogTitle>
          </DialogHeader>
          <Input
            placeholder="Tag name"
            value={newTagName}
            onChange={(e) => setNewTagName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleAddTag()}
            autoFocus
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)} disabled={addLoading}>
              Cancel
            </Button>
            <Button onClick={handleAddTag} disabled={!newTagName.trim() || addLoading}>
              {addLoading ? "Adding..." : "Add"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Rename tag dialog */}
      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Rename Tag</DialogTitle>
          </DialogHeader>
          <Input
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleRename()}
            autoFocus
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameOpen(false)} disabled={renameLoading}>
              Cancel
            </Button>
            <Button onClick={handleRename} disabled={!renameValue.trim() || renameLoading}>
              {renameLoading ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete tag dialog */}
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete tag?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            This will permanently delete <strong>{deletingTag?.name}</strong> and all{" "}
            {deletingTag?.clipCount ?? 0} clip{deletingTag?.clipCount === 1 ? "" : "s"} in it. This cannot be undone.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteOpen(false)} disabled={deleteLoading}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleteLoading}>
              {deleteLoading ? "Deleting..." : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function TagRow({
  tag,
  isActive,
  onSelect,
  onRename,
  onDelete,
}: {
  tag: TagItem;
  isActive: boolean;
  onSelect: () => void;
  onRename: () => void;
  onDelete: () => void;
}) {
  return (
    <div
      className={cn(
        "group flex items-center justify-between px-3 py-2 cursor-pointer rounded-sm mx-1 transition-colors",
        isActive
          ? "bg-accent text-accent-foreground"
          : "hover:bg-muted/60 text-foreground"
      )}
      onClick={onSelect}
    >
      <div className="flex-1 min-w-0">
        <p className="text-sm truncate leading-tight">{tag.name}</p>
        <p className="text-xs text-muted-foreground leading-tight">
          {tag.clipCount} {tag.clipCount === 1 ? "clip" : "clips"}
        </p>
      </div>
      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0 ml-1">
        <button
          onClick={(e) => { e.stopPropagation(); onRename(); }}
          className="p-1 rounded hover:bg-background/80 text-muted-foreground hover:text-foreground"
          aria-label="Rename tag"
        >
          <Pencil className="w-3 h-3" />
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          className="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive"
          aria-label="Delete tag"
        >
          <Trash2 className="w-3 h-3" />
        </button>
      </div>
    </div>
  );
}
