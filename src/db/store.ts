import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import type * as schema from "./schema";

export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

/**
 * What the services need from a database: `db` for reads and `tx` for atomic writes.
 * Production wires this to Neon (src/db/client.ts); tests wire it to in-memory Postgres.
 */
export interface Store {
  db: Db;
  tx<T>(fn: (tx: Db) => Promise<T>): Promise<T>;
}
