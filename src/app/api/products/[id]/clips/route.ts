import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/session";
import { db } from "@/lib/db";
import { products, clips } from "@/lib/schema";
import { eq, and } from "drizzle-orm";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireAuth();
  const { id } = await params;
  const [p] = await db
    .select({ id: products.id })
    .from(products)
    .where(and(eq(products.id, id), eq(products.userId, session.user.id)));
  if (!p) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const rows = await db
    .select()
    .from(clips)
    .where(eq(clips.productId, id))
    .orderBy(clips.brollName);
  return NextResponse.json(rows);
}
