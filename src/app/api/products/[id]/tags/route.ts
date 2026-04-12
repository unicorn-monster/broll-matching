import { db } from "@/lib/db";
import { products, tags, clips } from "@/lib/schema";
import { eq, count, asc } from "drizzle-orm";
import { z } from "zod";

async function getProduct(productId: string) {
  const [product] = await db
    .select()
    .from(products)
    .where(eq(products.id, productId))
    .limit(1);
  return product ?? null;
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const product = await getProduct(id);
  if (!product) return Response.json({ error: "Not found" }, { status: 404 });

  const rows = await db
    .select({
      id: tags.id,
      name: tags.name,
      sortOrder: tags.sortOrder,
      createdAt: tags.createdAt,
      clipCount: count(clips.id),
    })
    .from(tags)
    .leftJoin(clips, eq(clips.tagId, tags.id))
    .where(eq(tags.productId, id))
    .groupBy(tags.id, tags.name, tags.sortOrder, tags.createdAt)
    .orderBy(asc(tags.sortOrder), asc(tags.createdAt));

  return Response.json(rows);
}

const createTagSchema = z.object({
  name: z.string().min(1).max(100),
});

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const product = await getProduct(id);
  if (!product) return Response.json({ error: "Not found" }, { status: 404 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = createTagSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "Invalid request", details: parsed.error.flatten() }, { status: 400 });
  }

  // Get max sortOrder to append new tag at end
  const existingTags = await db
    .select({ sortOrder: tags.sortOrder })
    .from(tags)
    .where(eq(tags.productId, id))
    .orderBy(asc(tags.sortOrder));

  const maxSortOrder = existingTags.length > 0
    ? Math.max(...existingTags.map((t) => t.sortOrder))
    : -1;

  const [inserted] = await db
    .insert(tags)
    .values({ productId: id, name: parsed.data.name, sortOrder: maxSortOrder + 1 })
    .returning();

  return Response.json(inserted, { status: 201 });
}
