import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/session";
import { db } from "@/lib/db";
import { products, folders, clips } from "@/lib/schema";
import { eq, and } from "drizzle-orm";

async function assertFolderOwnership(productId: string, folderId: string, userId: string) {
  const [p] = await db
    .select({ id: products.id })
    .from(products)
    .where(and(eq(products.id, productId), eq(products.userId, userId)));
  if (!p) return null;
  const [f] = await db
    .select()
    .from(folders)
    .where(and(eq(folders.id, folderId), eq(folders.productId, productId)));
  return f ?? null;
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; folderId: string }> },
) {
  const session = await requireAuth();
  const { id, folderId } = await params;
  const folder = await assertFolderOwnership(id, folderId, session.user.id);
  if (!folder) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const { name } = await req.json();
  if (!name?.trim()) return NextResponse.json({ error: "Name required" }, { status: 400 });
  try {
    const [updated] = await db
      .update(folders)
      .set({ name: name.trim() })
      .where(eq(folders.id, folderId))
      .returning();
    return NextResponse.json(updated);
  } catch {
    return NextResponse.json({ error: "Folder name already exists" }, { status: 409 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; folderId: string }> },
) {
  const session = await requireAuth();
  const { id, folderId } = await params;
  const folder = await assertFolderOwnership(id, folderId, session.user.id);
  if (!folder) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const clipRows = await db
    .select({ id: clips.id })
    .from(clips)
    .where(eq(clips.folderId, folderId));
  await db.delete(folders).where(eq(folders.id, folderId));
  return NextResponse.json({ deletedClipIds: clipRows.map((c) => c.id) });
}
