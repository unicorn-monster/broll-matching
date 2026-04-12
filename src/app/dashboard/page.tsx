"use client";

import { useEffect, useState, useCallback } from "react";
import { useSession } from "@/lib/auth-client";
import { NewProductDialog } from "@/components/products/new-product-dialog";
import { ProductCard } from "@/components/products/product-card";
import { Skeleton } from "@/components/ui/skeleton";
import { Film } from "lucide-react";

interface Product {
  id: string;
  name: string;
  clipCount: number;
  updatedAt: string;
  createdAt: string;
}

export default function DashboardPage() {
  const { data: session, isPending: sessionPending } = useSession();
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchProducts = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/products");
      if (res.ok) {
        const data = await res.json();
        setProducts(data);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (session) fetchProducts();
  }, [session, fetchProducts]);

  if (sessionPending) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-muted-foreground text-sm">Loading...</div>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-muted-foreground text-sm">Please sign in to continue.</div>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8 max-w-6xl">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Products</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Each product has its own B-roll library and assembly workspace.
          </p>
        </div>
        <NewProductDialog onCreated={fetchProducts} />
      </div>

      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-36 rounded-lg" />
          ))}
        </div>
      ) : products.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <div className="w-14 h-14 rounded-full bg-muted flex items-center justify-center mb-4">
            <Film className="w-7 h-7 text-muted-foreground" />
          </div>
          <h2 className="text-base font-semibold mb-1">No products yet</h2>
          <p className="text-sm text-muted-foreground mb-6 max-w-xs">
            Create your first product to start building your B-roll library and assembling VSL videos.
          </p>
          <NewProductDialog onCreated={fetchProducts} />
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {products.map((product) => (
            <ProductCard
              key={product.id}
              id={product.id}
              name={product.name}
              clipCount={product.clipCount}
              updatedAt={product.updatedAt}
              onDeleted={fetchProducts}
            />
          ))}
        </div>
      )}
    </div>
  );
}
