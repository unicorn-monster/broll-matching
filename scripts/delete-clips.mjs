import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { pgTable, uuid, varchar, integer, timestamp, bigint } from "drizzle-orm/pg-core";

const clips = pgTable("clips", {
  id: uuid("id").defaultRandom().primaryKey(),
});

const sql = postgres(process.env.POSTGRES_URL);
const db = drizzle(sql);

const result = await db.delete(clips);
console.log("Done. Clips deleted.");

await sql.end();
