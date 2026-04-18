import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { products, clips } from "@/lib/schema";
import { eq } from "drizzle-orm";

async function getProduct(productId: string) {
  const [product] = await db.select().from(products).where(eq(products.id, productId));
  return product ?? null;
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const product = await getProduct(id);
  if (!product) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(product);
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const product = await getProduct(id);
  if (!product) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const { name } = await req.json();
  if (!name?.trim()) return NextResponse.json({ error: "Name required" }, { status: 400 });
  const [updated] = await db
    .update(products)
    .set({ name: name.trim(), updatedAt: new Date() })
    .where(eq(products.id, id))
    .returning();
  return NextResponse.json(updated);
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const product = await getProduct(id);
  if (!product) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const clipRows = await db
    .select({ id: clips.id })
    .from(clips)
    .where(eq(clips.productId, id));
  await db.delete(products).where(eq(products.id, id));
  return NextResponse.json({ deletedClipIds: clipRows.map((c) => c.id) });
}
