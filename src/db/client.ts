import { neon, Pool } from "@neondatabase/serverless";
import { drizzle as drizzleHttp } from "drizzle-orm/neon-http";
import { drizzle as drizzlePool } from "drizzle-orm/neon-serverless";
import * as schema from "./schema";
import type { Db, Store } from "./store";

export class DatabaseNotConfiguredError extends Error {
  constructor() {
    super("DATABASE_URL is not set. Add the pooled Neon connection string to the environment.");
  }
}

export function isDatabaseConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.DATABASE_URL);
}

let readDb: Db | undefined;

/**
 * Neon-backed store for serverless functions.
 *  - Reads use the HTTP driver: one stateless request per query, nothing left open.
 *  - Writes that must be atomic open a short-lived pooled connection, run one transaction, and
 *    always close it, so no connection outlives the request.
 * Server-only: never import this from a client component (DATABASE_URL must stay private).
 */
export function getStore(): Store {
  const url = process.env.DATABASE_URL;
  if (!url) throw new DatabaseNotConfiguredError();
  readDb ??= drizzleHttp(neon(url), { schema }) as unknown as Db;
  return {
    db: readDb,
    async tx(fn) {
      const pool = new Pool({ connectionString: url, max: 1 });
      try {
        return await drizzlePool(pool, { schema }).transaction((tx) => fn(tx as unknown as Db));
      } finally {
        await pool.end();
      }
    },
  };
}
