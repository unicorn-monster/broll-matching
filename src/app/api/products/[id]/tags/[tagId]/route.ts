import { db } from "@/lib/db";
import { products, tags } from "@/lib/schema";
import { eq, and } from "drizzle-orm";
import { z } from "zod";

async function getTag(productId: string, tagId: string) {
  const [product] = await db.select().from(products).where(eq(products.id, productId)).limit(1);
  if (!product) return null;

  const [tag] = await db
    .select()
    .from(tags)
    .where(and(eq(tags.id, tagId), eq(tags.productId, productId)))
    .limit(1);
  return tag ?? null;
}

const renameTagSchema = z.object({
  name: z.string().min(1).max(100),
});

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string; tagId: string }> }
) {
  const { id, tagId } = await params;
  const tag = await getTag(id, tagId);
  if (!tag) return Response.json({ error: "Not found" }, { status: 404 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = renameTagSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "Invalid request" }, { status: 400 });
  }

  const [updated] = await db
    .update(tags)
    .set({ name: parsed.data.name })
    .where(eq(tags.id, tagId))
    .returning();

  return Response.json(updated);
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string; tagId: string }> }
) {
  const { id, tagId } = await params;
  const tag = await getTag(id, tagId);
  if (!tag) return Response.json({ error: "Not found" }, { status: 404 });

  await db.delete(tags).where(eq(tags.id, tagId));
  return Response.json({ success: true });
}
