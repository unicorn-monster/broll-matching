"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { TagSidebar } from "@/components/broll/tag-sidebar";
import { ClipGrid } from "@/components/broll/clip-grid";

interface Product {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

interface Tag {
  id: string;
  name: string;
  sortOrder: number;
  createdAt: string;
  clipCount: number;
}

export default function ProductWorkspacePage() {
  const params = useParams<{ productId: string }>();
  const router = useRouter();
  const productId = params.productId;

  const [product, setProduct] = useState<Product | null>(null);
  const [tags, setTags] = useState<Tag[]>([]);
  const [activeTagId, setActiveTagId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchProduct = useCallback(async () => {
    const res = await fetch(`/api/products/${productId}`);
    if (!res.ok) {
      router.push("/dashboard");
      return;
    }
    setProduct(await res.json());
  }, [productId, router]);

  const fetchTags = useCallback(async () => {
    const res = await fetch(`/api/products/${productId}/tags`);
    if (!res.ok) return;
    const data: Tag[] = await res.json();
    setTags(data);
    if (data.length > 0 && !activeTagId) {
      setActiveTagId(data[0]!.id);
    }
  }, [productId, activeTagId]);

  useEffect(() => {
    async function init() {
      setLoading(true);
      await Promise.all([fetchProduct(), fetchTags()]);
      setLoading(false);
    }
    init();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productId]);

  if (loading) {
    return (
      <div className="flex h-[calc(100vh-4rem)]">
        <div className="w-60 border-r border-border p-4 space-y-2 shrink-0">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-8 rounded" />
          ))}
        </div>
        <div className="flex-1 p-6">
          <Skeleton className="h-8 w-48 mb-6 rounded" />
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="aspect-[9/16] rounded-md" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)]">
      {/* Header */}
      <div className="border-b border-border px-4 py-3 flex items-center gap-3 shrink-0">
        <Link
          href="/dashboard"
          className="text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
        </Link>
        <h1 className="font-semibold text-sm truncate">{product?.name}</h1>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="broll" className="flex-1 flex flex-col min-h-0">
        <div className="border-b border-border px-4 shrink-0">
          <TabsList className="h-10 bg-transparent p-0 gap-0">
            <TabsTrigger
              value="broll"
              className="rounded-none border-b-2 border-transparent data-[state=active]:border-foreground data-[state=active]:bg-transparent data-[state=active]:shadow-none px-4 h-10 text-sm font-medium"
            >
              B-Roll Library
            </TabsTrigger>
            <TabsTrigger
              value="build"
              className="rounded-none border-b-2 border-transparent data-[state=active]:border-foreground data-[state=active]:bg-transparent data-[state=active]:shadow-none px-4 h-10 text-sm font-medium"
            >
              Build Video
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="broll" className="flex-1 flex min-h-0 mt-0 overflow-hidden">
          <TagSidebar
            productId={productId}
            tags={tags}
            activeTagId={activeTagId}
            onSelectTag={setActiveTagId}
            onTagsChanged={fetchTags}
          />
          <div className="flex-1 overflow-y-auto">
            {activeTagId ? (
              <ClipGrid
                productId={productId}
                tagId={activeTagId}
                tag={tags.find((t) => t.id === activeTagId) ?? null}
                onClipsChanged={fetchTags}
              />
            ) : (
              <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
                No tags yet. Add a tag to get started.
              </div>
            )}
          </div>
        </TabsContent>

        <TabsContent value="build" className="flex-1 mt-0 overflow-y-auto">
          <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
            Build Video — coming in Phase 6
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
