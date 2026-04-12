import { headers } from "next/headers";
import { auth } from "@/lib/auth";
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
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

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
    .where(eq(products.userId, session.user.id))
    .groupBy(products.id, products.name, products.createdAt, products.updatedAt)
    .orderBy(desc(products.updatedAt));

  return Response.json(rows);
}

const createProductSchema = z.object({
  name: z.string().min(1).max(255),
});

export async function POST(req: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

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

  const [product] = await db
    .insert(products)
    .values({ name: parsed.data.name, userId: session.user.id })
    .returning();

  // Auto-create 17 default tags
  await db.insert(tags).values(
    DEFAULT_TAGS.map((name, i) => ({
      productId: product.id,
      name,
      sortOrder: i,
    }))
  );

  return Response.json(product, { status: 201 });
}
