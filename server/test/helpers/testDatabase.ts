// Fresh, isolated databases for tests.
//   - Always: in-memory PGlite.
//   - Also, when TEST_DATABASE_URL points at a real PostgreSQL server: a
//     throwaway database created for the test and dropped afterwards.

import { randomBytes } from "node:crypto";
import { openDatabase, type Database } from "../../src/db/database.ts";
import { migrate } from "../../src/db/migrate.ts";

export interface TestBackend {
  name: string;
  open(): Promise<Database>;
}

export const pgliteBackend: TestBackend = {
  name: "PGlite (in memory)",
  open: () => openDatabase({ kind: "pglite", dataDir: null }),
};

function postgresBackend(adminUrl: string): TestBackend {
  return {
    name: "PostgreSQL server",
    async open() {
      const admin = await openDatabase({ kind: "postgres", url: adminUrl });
      const name = `padova_test_${randomBytes(6).toString("hex")}`;
      await admin.exec(`CREATE DATABASE ${name}`);
      const url = new URL(adminUrl);
      url.pathname = `/${name}`;
      const db = await openDatabase({ kind: "postgres", url: url.toString() });
      const close = db.close.bind(db);
      return Object.assign(db, {
        async close() {
          await close();
          await admin.exec(`DROP DATABASE IF EXISTS ${name}`);
          await admin.close();
        },
      });
    },
  };
}

/** Backends to run database tests against. */
export const testBackends: TestBackend[] = process.env.TEST_DATABASE_URL
  ? [pgliteBackend, postgresBackend(process.env.TEST_DATABASE_URL)]
  : [pgliteBackend];

/** An in-memory PGlite with all migrations applied (for room/integration tests). */
export async function migratedTestDatabase(): Promise<Database> {
  const db = await pgliteBackend.open();
  await migrate(db);
  return db;
}
