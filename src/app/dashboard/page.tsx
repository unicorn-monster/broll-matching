"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, Film } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Product = { id: string; name: string; updatedAt: string };

export default function DashboardPage() {
  const router = useRouter();
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);

  useEffect(() => {
    fetch("/api/products")
      .then((r) => r.json())
      .then((data) => { setProducts(data); setLoading(false); });
  }, []);

  async function createProduct() {
    if (!newName.trim()) return;
    setCreating(true);
    const res = await fetch("/api/products", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newName.trim() }),
    });
    const product = await res.json();
    setProducts((prev) => [product, ...prev]);
    setNewName("");
    setDialogOpen(false);
    setCreating(false);
  }

  async function deleteProduct(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    if (!confirm("Delete this product and all its clips?")) return;
    const res = await fetch(`/api/products/${id}`, { method: "DELETE" });
    const { deletedClipIds } = await res.json();
    if (deletedClipIds?.length) {
      const { deleteProductClips } = await import("@/lib/clip-storage");
      await deleteProductClips(deletedClipIds);
    }
    setProducts((prev) => prev.filter((p) => p.id !== id));
  }

  return (
    <div className="container mx-auto p-6">
      <div className="flex justify-between items-center mb-8">
        <h1 className="text-3xl font-bold">Products</h1>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button><Plus className="w-4 h-4 mr-2" />New Product</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Create Product</DialogTitle></DialogHeader>
            <div className="space-y-4">
              <div>
                <Label htmlFor="name">Product name</Label>
                <Input
                  id="name"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && createProduct()}
                  placeholder="Dog Grooming VSL"
                />
              </div>
              <Button onClick={createProduct} disabled={creating || !newName.trim()} className="w-full">
                {creating ? "Creating…" : "Create"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {loading ? (
        <p className="text-muted-foreground">Loading…</p>
      ) : products.length === 0 ? (
        <div className="text-center py-24 text-muted-foreground">
          <Film className="w-12 h-12 mx-auto mb-4 opacity-30" />
          <p>No products yet. Create your first one.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {products.map((p) => (
            <div
              key={p.id}
              onClick={() => router.push(`/dashboard/${p.id}`)}
              className="p-5 border border-border rounded-lg cursor-pointer hover:bg-accent transition-colors relative group"
            >
              <h2 className="font-semibold text-lg mb-1">{p.name}</h2>
              <p className="text-sm text-muted-foreground">
                Updated {new Date(p.updatedAt).toLocaleDateString()}
              </p>
              <button
                onClick={(e) => deleteProduct(p.id, e)}
                className="absolute top-4 right-4 opacity-0 group-hover:opacity-100 text-destructive hover:text-destructive/80"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
