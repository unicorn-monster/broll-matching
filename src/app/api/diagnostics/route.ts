import { NextResponse } from "next/server";

type StatusLevel = "ok" | "warn" | "error";

interface DiagnosticsResponse {
  timestamp: string;
  env: {
    POSTGRES_URL: boolean;
    OPENROUTER_API_KEY: boolean;
    NEXT_PUBLIC_APP_URL: boolean;
  };
  database: {
    connected: boolean;
    schemaApplied: boolean;
    error?: string;
  };
  ai: {
    configured: boolean;
  };
  storage: {
    configured: boolean;
    type: "local" | "remote";
  };
  overallStatus: StatusLevel;
}

export async function GET() {
  const env = {
    POSTGRES_URL: Boolean(process.env.POSTGRES_URL),
    OPENROUTER_API_KEY: Boolean(process.env.OPENROUTER_API_KEY),
    NEXT_PUBLIC_APP_URL: Boolean(process.env.NEXT_PUBLIC_APP_URL),
  } as const;

  let dbConnected = false;
  let schemaApplied = false;
  let dbError: string | undefined;
  if (env.POSTGRES_URL) {
    try {
      const dbCheckPromise = (async () => {
        const [{ db }, { sql }, schema] = await Promise.all([
          import("@/lib/db"),
          import("drizzle-orm"),
          import("@/lib/schema"),
        ]);

        const result = await db.execute(sql`SELECT 1 as ping`);
        if (!result) throw new Error("Database query returned no result");
        dbConnected = true;

        try {
          await db.select().from(schema.products).limit(1);
          schemaApplied = true;
        } catch {
          schemaApplied = false;
          if (!dbError) dbError = "Schema not applied. Run: pnpm db:migrate";
        }
      })();

      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Database connection timeout (5s)")), 5000)
      );

      await Promise.race([dbCheckPromise, timeoutPromise]);
    } catch {
      dbConnected = false;
      schemaApplied = false;
      dbError = "Database not connected. Please start your PostgreSQL database and verify your POSTGRES_URL in .env";
    }
  } else {
    dbConnected = false;
    schemaApplied = false;
    dbError = "POSTGRES_URL is not set";
  }

  const aiConfigured = env.OPENROUTER_API_KEY;
  const storageConfigured = Boolean(process.env.BLOB_READ_WRITE_TOKEN);
  const storageType: "local" | "remote" = storageConfigured ? "remote" : "local";

  const overallStatus: StatusLevel = (() => {
    if (!env.POSTGRES_URL || !dbConnected || !schemaApplied) return "error";
    if (!aiConfigured) return "warn";
    return "ok";
  })();

  const body: DiagnosticsResponse = {
    timestamp: new Date().toISOString(),
    env,
    database: {
      connected: dbConnected,
      schemaApplied,
      ...(dbError !== undefined && { error: dbError }),
    },
    ai: { configured: aiConfigured },
    storage: { configured: storageConfigured, type: storageType },
    overallStatus,
  };

  return NextResponse.json(body, { status: 200 });
}
