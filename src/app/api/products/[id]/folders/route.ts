import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/session";
import { db } from "@/lib/db";
import { products, folders, clips } from "@/lib/schema";
import { eq, and, sql } from "drizzle-orm";

async function assertOwnership(productId: string, userId: string) {
  const [p] = await db
    .select({ id: products.id })
    .from(products)
    .where(and(eq(products.id, productId), eq(products.userId, userId)));
  return p ?? null;
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireAuth();
  const { id } = await params;
  if (!(await assertOwnership(id, session.user.id))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const rows = await db
    .select({
      id: folders.id,
      name: folders.name,
      sortOrder: folders.sortOrder,
      createdAt: folders.createdAt,
      clipCount: sql<number>`cast(count(${clips.id}) as int)`,
    })
    .from(folders)
    .leftJoin(clips, eq(clips.folderId, folders.id))
    .where(eq(folders.productId, id))
    .groupBy(folders.id)
    .orderBy(folders.sortOrder, folders.name);
  return NextResponse.json(rows);
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireAuth();
  const { id } = await params;
  if (!(await assertOwnership(id, session.user.id))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const { name } = await req.json();
  if (!name?.trim()) return NextResponse.json({ error: "Name required" }, { status: 400 });
  try {
    const [folder] = await db
      .insert(folders)
      .values({ productId: id, name: name.trim() })
      .returning();
    return NextResponse.json(folder, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Folder name already exists" }, { status: 409 });
  }
}
