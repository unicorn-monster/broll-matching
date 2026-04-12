import { db } from "@/lib/db";
import { products, tags, clips } from "@/lib/schema";
import { eq, and } from "drizzle-orm";

async function getClip(productId: string, tagId: string, clipId: string) {
  const [product] = await db.select().from(products).where(eq(products.id, productId)).limit(1);
  if (!product) return null;

  const [tag] = await db
    .select()
    .from(tags)
    .where(and(eq(tags.id, tagId), eq(tags.productId, productId)))
    .limit(1);
  if (!tag) return null;

  const [clip] = await db
    .select()
    .from(clips)
    .where(and(eq(clips.id, clipId), eq(clips.tagId, tagId)))
    .limit(1);
  return clip ?? null;
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string; tagId: string; clipId: string }> }
) {
  const { id, tagId, clipId } = await params;
  const clip = await getClip(id, tagId, clipId);
  if (!clip) return Response.json({ error: "Not found" }, { status: 404 });

  await db.delete(clips).where(eq(clips.id, clipId));
  return Response.json({ success: true });
}
