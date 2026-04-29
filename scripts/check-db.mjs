import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { count } from "drizzle-orm";
import { pgTable, timestamp, uuid, varchar, integer } from "drizzle-orm/pg-core";

const products = pgTable("products", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
});
const folders = pgTable("folders", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: varchar("name", { length: 100 }).notNull(),
});
const clips = pgTable("clips", {
  id: uuid("id").defaultRandom().primaryKey(),
  brollName: varchar("broll_name", { length: 255 }).notNull(),
  filename: varchar("filename", { length: 255 }).notNull(),
});

const sql = postgres(process.env.POSTGRES_URL);
const db = drizzle(sql);

const [clipCount] = await db.select({ count: count() }).from(clips);
const [folderCount] = await db.select({ count: count() }).from(folders);
const [productCount] = await db.select({ count: count() }).from(products);

console.log(`clips: ${clipCount.count}`);
console.log(`folders: ${folderCount.count}`);
console.log(`products: ${productCount.count}`);

const productList = await db.select({ name: products.name }).from(products);
console.log("\nProducts (sẽ GIỮ LẠI):");
productList.forEach(p => console.log(`  - ${p.name}`));

const folderList = await db.select({ name: folders.name }).from(folders);
console.log("\nFolders (sẽ GIỮ LẠI):");
folderList.forEach(f => console.log(`  - ${f.name}`));

await sql.end();
