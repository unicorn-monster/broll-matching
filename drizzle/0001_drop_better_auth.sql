CREATE TABLE "clips" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"folder_id" uuid NOT NULL,
	"broll_name" varchar(255) NOT NULL,
	"filename" varchar(255) NOT NULL,
	"duration_ms" integer NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"indexeddb_key" varchar(255) NOT NULL,
	"file_size_bytes" bigint NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "folders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"name" varchar(100) NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP TABLE "account" CASCADE;--> statement-breakpoint
DROP TABLE "session" CASCADE;--> statement-breakpoint
DROP TABLE "user" CASCADE;--> statement-breakpoint
DROP TABLE "verification" CASCADE;--> statement-breakpoint
ALTER TABLE "clips" ADD CONSTRAINT "clips_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clips" ADD CONSTRAINT "clips_folder_id_folders_id_fk" FOREIGN KEY ("folder_id") REFERENCES "public"."folders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "folders" ADD CONSTRAINT "folders_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "clips_product_broll_name_unique" ON "clips" USING btree ("product_id","broll_name");--> statement-breakpoint
CREATE INDEX "clips_product_id_idx" ON "clips" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "clips_folder_id_idx" ON "clips" USING btree ("folder_id");--> statement-breakpoint
CREATE UNIQUE INDEX "folders_product_name_unique" ON "folders" USING btree ("product_id","name");--> statement-breakpoint
CREATE INDEX "folders_product_id_idx" ON "folders" USING btree ("product_id");