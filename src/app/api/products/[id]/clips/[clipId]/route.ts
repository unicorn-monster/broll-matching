import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { clips, folders } from "@/lib/schema";
import { eq, and } from "drizzle-orm";
import { isValidBrollName } from "@/lib/broll";

async function getClip(productId: string, clipId: string) {
  const [clip] = await db
    .select()
    .from(clips)
    .where(and(eq(clips.id, clipId), eq(clips.productId, productId)));
  return clip ?? null;
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; clipId: string }> },
) {
  const { id, clipId } = await params;
  const clip = await getClip(id, clipId);
  if (!clip) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await req.json();
  const updates: Partial<typeof clips.$inferInsert> = {};

  if (body.brollName !== undefined) {
    if (!isValidBrollName(body.brollName)) {
      return NextResponse.json({ error: "Invalid brollName" }, { status: 400 });
    }
    updates.brollName = body.brollName;
  }

  if (body.folderId !== undefined) {
    const [folder] = await db
      .select({ id: folders.id })
      .from(folders)
      .where(and(eq(folders.id, body.folderId), eq(folders.productId, id)));
    if (!folder) return NextResponse.json({ error: "Folder not found" }, { status: 400 });
    updates.folderId = body.folderId;
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  try {
    const [updated] = await db
      .update(clips)
      .set(updates)
      .where(eq(clips.id, clipId))
      .returning();
    return NextResponse.json(updated);
  } catch {
    return NextResponse.json({ error: "B-roll name already exists in this product" }, { status: 409 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; clipId: string }> },
) {
  const { id, clipId } = await params;
  const clip = await getClip(id, clipId);
  if (!clip) return NextResponse.json({ error: "Not found" }, { status: 404 });
  await db.delete(clips).where(eq(clips.id, clipId));
  return NextResponse.json({ deletedClipId: clipId });
}
