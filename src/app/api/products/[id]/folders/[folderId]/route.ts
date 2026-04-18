import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { folders, clips } from "@/lib/schema";
import { eq, and } from "drizzle-orm";

async function getFolder(productId: string, folderId: string) {
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
  const { id, folderId } = await params;
  const folder = await getFolder(id, folderId);
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
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; folderId: string }> },
) {
  const { id, folderId } = await params;
  const folder = await getFolder(id, folderId);
  if (!folder) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const clipRows = await db
    .select({ id: clips.id })
    .from(clips)
    .where(eq(clips.folderId, folderId));
  await db.delete(folders).where(eq(folders.id, folderId));
  return NextResponse.json({ deletedClipIds: clipRows.map((c) => c.id) });
}
