import { db } from "@/lib/db";
import { products, tags, clips } from "@/lib/schema";
import { eq, count, desc } from "drizzle-orm";
import { z } from "zod";

const DEFAULT_TAGS = [
  "Hook",
  "Lead",
  "Solution Mechanism",
  "Problem Mechanism",
  "Metaphor",
  "Agitate Problem",
  "Discredit Solution 01",
  "Discredit Solution 02",
  "Product Intro",
  "Supporting Benefits",
  "Social Proof",
  "Authority",
  "Guarantee",
  "Risk Free",
  "Offer",
  "Urgency",
  "CTA",
];

export async function GET() {
  const rows = await db
    .select({
      id: products.id,
      name: products.name,
      createdAt: products.createdAt,
      updatedAt: products.updatedAt,
      clipCount: count(clips.id),
    })
    .from(products)
    .leftJoin(tags, eq(tags.productId, products.id))
    .leftJoin(clips, eq(clips.tagId, tags.id))
    .groupBy(products.id, products.name, products.createdAt, products.updatedAt)
    .orderBy(desc(products.updatedAt));

  return Response.json(rows);
}

const createProductSchema = z.object({
  name: z.string().min(1).max(255),
});

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = createProductSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "Invalid request", details: parsed.error.flatten() }, { status: 400 });
  }

  const inserted = await db
    .insert(products)
    .values({ name: parsed.data.name })
    .returning();
  const product = inserted[0]!;

  await db.insert(tags).values(
    DEFAULT_TAGS.map((name, i) => ({
      productId: product.id,
      name,
      sortOrder: i,
    }))
  );

  return Response.json(product, { status: 201 });
}
