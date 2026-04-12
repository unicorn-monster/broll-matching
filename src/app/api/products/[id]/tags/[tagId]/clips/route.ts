import { db } from "@/lib/db";
import { products, tags, clips } from "@/lib/schema";
import { eq, and, asc } from "drizzle-orm";
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

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string; tagId: string }> }
) {
  const { id, tagId } = await params;
  const tag = await getTag(id, tagId);
  if (!tag) return Response.json({ error: "Not found" }, { status: 404 });

  const rows = await db
    .select()
    .from(clips)
    .where(eq(clips.tagId, tagId))
    .orderBy(asc(clips.createdAt));

  return Response.json(rows);
}

const createClipSchema = z.object({
  id: z.string().uuid(),
  filename: z.string().min(1).max(255),
  durationMs: z.number().int().positive(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  indexeddbKey: z.string().min(1).max(255),
  fileSizeBytes: z.number().int().positive(),
});

export async function POST(
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

  const parsed = createClipSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "Invalid request", details: parsed.error.flatten() }, { status: 400 });
  }

  const [inserted] = await db
    .insert(clips)
    .values({ tagId, ...parsed.data })
    .returning();

  return Response.json(inserted, { status: 201 });
}
