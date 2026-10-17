// One small database interface with two PostgreSQL backends:
//   - "postgres": a real PostgreSQL server via node-postgres (`pg`), used when
//     DATABASE_URL is set. This is what production uses.
//   - "pglite": PostgreSQL compiled to WebAssembly, embedded in the server
//     process, stored in a local folder (or in memory). Used for development
//     and tests so nobody has to install a database server.
// Both run the same SQL and the same migrations. See docs/DECISIONS.md D-015/D-016.

import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type Row = Record<string, unknown>;

export interface QueryResult<T> {
  rows: T[];
  /** Rows inserted/updated/deleted, or rows returned for SELECT. */
  rowCount: number;
}

export interface Queryable {
  query<T = Row>(sql: string, params?: unknown[]): Promise<QueryResult<T>>;
}

export interface Database extends Queryable {
  readonly kind: "postgres" | "pglite";
  /** Runs several statements without parameters (used by migrations). */
  exec(sql: string): Promise<void>;
  /** Runs `fn` in a transaction: committed if it resolves, rolled back if it throws. */
  transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T>;
  close(): Promise<void>;
  /** Where the data lives, safe to log (never includes passwords). */
  describe(): string;
}

export type DatabaseConfig =
  | { kind: "postgres"; url: string }
  | { kind: "pglite"; dataDir: string | null };

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
export const DEFAULT_PGLITE_DIR = path.join(repoRoot, ".data", "pglite");

/**
 * DATABASE_URL set → real PostgreSQL. Otherwise embedded PGlite stored in
 * PGLITE_DATA_DIR (default `.data/pglite` in the repo), or in memory when
 * PGLITE_DATA_DIR is "memory://".
 */
export function databaseConfigFromEnv(env: NodeJS.ProcessEnv = process.env): DatabaseConfig {
  const url = env.DATABASE_URL?.trim();
  if (url) return { kind: "postgres", url };
  const dir = env.PGLITE_DATA_DIR?.trim();
  if (dir === "memory://") return { kind: "pglite", dataDir: null };
  return { kind: "pglite", dataDir: dir ? path.resolve(dir) : DEFAULT_PGLITE_DIR };
}

export async function openDatabase(config: DatabaseConfig): Promise<Database> {
  return config.kind === "postgres" ? openPostgres(config.url) : openPglite(config.dataDir);
}

/** Hides the password in a connection URL. */
export function redactUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.password) parsed.password = "***";
    return parsed.toString();
  } catch {
    return "(unparseable DATABASE_URL)";
  }
}

async function openPostgres(url: string): Promise<Database> {
  const { default: pg } = await import("pg");
  const pool = new pg.Pool({ connectionString: url, max: 10 });
  pool.on("error", (error) => console.error("[db] idle client error:", error.message));
  // Fail fast with a clear message if the server is unreachable.
  await pool.query("select 1");
  const wrap = (client: { query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[]; rowCount: number | null }> }): Queryable => ({
    async query<T>(sql: string, params?: unknown[]) {
      const result = await client.query(sql, params);
      return { rows: result.rows as T[], rowCount: result.rowCount ?? result.rows.length };
    },
  });
  const poolQuery = wrap(pool);
  return {
    kind: "postgres",
    query: poolQuery.query,
    async exec(sql) {
      await pool.query(sql);
    },
    async transaction(fn) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const result = await fn(wrap(client));
        await client.query("COMMIT");
        return result;
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    },
    async close() {
      await pool.end();
    },
    describe: () => `PostgreSQL at ${redactUrl(url)}`,
  };
}

async function openPglite(dataDir: string | null): Promise<Database> {
  const { PGlite } = await import("@electric-sql/pglite");
  if (dataDir) mkdirSync(dataDir, { recursive: true });
  const db = dataDir ? await PGlite.create({ dataDir }) : await PGlite.create();
  const wrap = (target: { query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[]; affectedRows?: number }> }): Queryable => ({
    async query<T>(sql: string, params?: unknown[]) {
      const result = await target.query(sql, params);
      return { rows: result.rows as T[], rowCount: result.affectedRows || result.rows.length };
    },
  });
  return {
    kind: "pglite",
    query: wrap(db).query,
    async exec(sql) {
      await db.exec(sql);
    },
    async transaction(fn) {
      return db.transaction((tx) => fn(wrap(tx)));
    },
    async close() {
      await db.close();
    },
    describe: () => (dataDir ? `embedded PGlite in ${dataDir}` : "embedded PGlite in memory"),
  };
}
