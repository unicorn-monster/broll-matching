import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { folders, clips } from "@/lib/schema";
import { eq, and } from "drizzle-orm";
import { isValidBrollName } from "@/lib/broll";

async function folderExists(productId: string, folderId: string): Promise<boolean> {
  const [f] = await db
    .select({ id: folders.id })
    .from(folders)
    .where(and(eq(folders.id, folderId), eq(folders.productId, productId)));
  return Boolean(f);
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; folderId: string }> },
) {
  const { id, folderId } = await params;
  if (!(await folderExists(id, folderId))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const rows = await db
    .select()
    .from(clips)
    .where(eq(clips.folderId, folderId))
    .orderBy(clips.brollName);
  return NextResponse.json(rows);
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; folderId: string }> },
) {
  const { id, folderId } = await params;
  if (!(await folderExists(id, folderId))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const body = await req.json();
  const { brollName, filename, durationMs, width, height, indexeddbKey, fileSizeBytes } = body;

  if (!isValidBrollName(brollName)) {
    return NextResponse.json(
      { error: "Invalid brollName. Must match ^[a-z0-9-]+-\\d+$" },
      { status: 400 },
    );
  }

  try {
    const [clip] = await db
      .insert(clips)
      .values({ productId: id, folderId, brollName, filename, durationMs, width, height, indexeddbKey, fileSizeBytes })
      .returning();
    return NextResponse.json(clip, { status: 201 });
  } catch {
    return NextResponse.json({ error: "B-roll name already exists in this product" }, { status: 409 });
  }
}
