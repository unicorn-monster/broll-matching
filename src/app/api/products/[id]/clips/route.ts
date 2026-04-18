import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { products, clips } from "@/lib/schema";
import { eq } from "drizzle-orm";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [p] = await db.select({ id: products.id }).from(products).where(eq(products.id, id));
  if (!p) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const rows = await db
    .select()
    .from(clips)
    .where(eq(clips.productId, id))
    .orderBy(clips.brollName);
  return NextResponse.json(rows);
}
