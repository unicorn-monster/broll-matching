"use client";

import { useState } from "react";
import Link from "next/link";
import { Trash2, Film, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";

interface ProductCardProps {
  id: string;
  name: string;
  clipCount: number;
  updatedAt: string;
  onDeleted: () => void;
}

export function ProductCard({ id, name, clipCount, updatedAt, onDeleted }: ProductCardProps) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function handleDelete() {
    setDeleting(true);
    try {
      const res = await fetch(`/api/products/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete");
      toast.success("Product deleted");
      setConfirmOpen(false);
      onDeleted();
    } catch {
      toast.error("Failed to delete product");
    } finally {
      setDeleting(false);
    }
  }

  const lastUpdated = new Date(updatedAt).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  return (
    <>
      <div className="group relative flex flex-col border border-border rounded-lg bg-card hover:border-foreground/30 transition-colors duration-150">
        <Link href={`/dashboard/${id}`} className="flex-1 p-5">
          <div className="flex items-start justify-between gap-3 mb-4">
            <div className="w-10 h-10 rounded-md bg-primary/10 flex items-center justify-center shrink-0">
              <Film className="w-5 h-5 text-primary" />
            </div>
          </div>
          <h3 className="font-semibold text-base leading-tight mb-3 line-clamp-2">{name}</h3>
          <div className="flex items-center gap-4 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <Film className="w-3 h-3" />
              {clipCount} {clipCount === 1 ? "clip" : "clips"}
            </span>
            <span className="flex items-center gap-1">
              <Clock className="w-3 h-3" />
              {lastUpdated}
            </span>
          </div>
        </Link>

        <button
          onClick={(e) => { e.preventDefault(); setConfirmOpen(true); }}
          className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity p-1.5 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive"
          aria-label="Delete product"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete product?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            This will permanently delete <strong>{name}</strong> and all its clips and tags. This cannot be undone.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)} disabled={deleting}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleting}>
              {deleting ? "Deleting..." : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
