import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { products, folders, clips } from "@/lib/schema";
import { eq, sql } from "drizzle-orm";

async function productExists(productId: string): Promise<boolean> {
  const [p] = await db.select({ id: products.id }).from(products).where(eq(products.id, productId));
  return Boolean(p);
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!(await productExists(id))) {
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
  const { id } = await params;
  if (!(await productExists(id))) {
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
