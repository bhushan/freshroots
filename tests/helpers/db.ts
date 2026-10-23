import { readFileSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import * as schema from "@/db/schema";
import type { Db, Store } from "@/db/store";

/** Fresh in-memory Postgres with the real migrations applied. */
export async function createTestStore(): Promise<Store> {
  const db = drizzle(new PGlite(), { schema });
  await migrate(db, { migrationsFolder: path.join(import.meta.dirname, "../../drizzle") });
  return {
    db: db as unknown as Db,
    tx: (fn) => db.transaction((tx) => fn(tx as unknown as Db)),
  };
}

export function sample(file: string): string {
  return readFileSync(path.join(import.meta.dirname, "../../data/sample", file), "utf8");
}
