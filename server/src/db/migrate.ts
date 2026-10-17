// Versioned SQL migrations. Each file in server/migrations is named
// NNNN_description.sql and has a "-- migrate:up" and a "-- migrate:down"
// section. Each migration runs in its own transaction together with its
// record in schema_migrations, so a failed migration leaves nothing behind.

import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Database } from "./database.ts";

export const MIGRATIONS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../migrations");

export interface Migration {
  version: number;
  name: string;
  up: string;
  down: string;
}

const FILE_PATTERN = /^(\d{4})_([a-z0-9_]+)\.sql$/;

export function loadMigrations(dir: string = MIGRATIONS_DIR): Migration[] {
  const migrations = readdirSync(dir)
    .filter((file) => FILE_PATTERN.test(file))
    .sort()
    .map((file) => {
      const [, version, name] = FILE_PATTERN.exec(file)!;
      const text = readFileSync(path.join(dir, file), "utf8");
      const upIndex = text.indexOf("-- migrate:up");
      const downIndex = text.indexOf("-- migrate:down");
      if (upIndex === -1 || downIndex === -1 || downIndex < upIndex) {
        throw new Error(`Migration ${file} needs "-- migrate:up" followed by "-- migrate:down"`);
      }
      return {
        version: Number(version),
        name: name!,
        up: text.slice(upIndex + "-- migrate:up".length, downIndex).trim(),
        down: text.slice(downIndex + "-- migrate:down".length).trim(),
      };
    });
  migrations.forEach((migration, index) => {
    if (migration.version !== index + 1) {
      throw new Error(`Migrations must be numbered 0001, 0002, … without gaps (found ${migration.version} at position ${index + 1})`);
    }
  });
  return migrations;
}

async function ensureTable(db: Database): Promise<void> {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version     integer PRIMARY KEY,
      name        text NOT NULL,
      applied_at  timestamptz NOT NULL DEFAULT now()
    );
  `);
}

export async function appliedVersions(db: Database): Promise<number[]> {
  await ensureTable(db);
  const { rows } = await db.query<{ version: number }>("SELECT version FROM schema_migrations ORDER BY version");
  return rows.map((row) => Number(row.version));
}

/** Applies every pending migration in order. Returns the versions applied. */
export async function migrate(db: Database, migrations: Migration[] = loadMigrations()): Promise<number[]> {
  const applied = new Set(await appliedVersions(db));
  const done: number[] = [];
  for (const migration of migrations) {
    if (applied.has(migration.version)) continue;
    await db.transaction(async (tx) => {
      // Serialise concurrent migrators (e.g. two server processes starting at once).
      await tx.query("SELECT pg_advisory_xact_lock(424242)");
      const already = await tx.query("SELECT 1 FROM schema_migrations WHERE version = $1", [migration.version]);
      if (already.rows.length > 0) return;
      for (const statement of splitStatements(migration.up)) await tx.query(statement);
      await tx.query("INSERT INTO schema_migrations (version, name) VALUES ($1, $2)", [migration.version, migration.name]);
    });
    done.push(migration.version);
  }
  return done;
}

/** Reverts the most recent `steps` migrations. Returns the versions reverted. */
export async function rollback(db: Database, steps = 1, migrations: Migration[] = loadMigrations()): Promise<number[]> {
  const applied = (await appliedVersions(db)).reverse().slice(0, steps);
  for (const version of applied) {
    const migration = migrations.find((m) => m.version === version);
    if (!migration) throw new Error(`No migration file for applied version ${version}`);
    await db.transaction(async (tx) => {
      for (const statement of splitStatements(migration.down)) await tx.query(statement);
      await tx.query("DELETE FROM schema_migrations WHERE version = $1", [version]);
    });
  }
  return applied;
}

/**
 * Splits SQL into statements on semicolons at line ends, ignoring `--`
 * comments. Our migrations avoid semicolons inside strings and function
 * bodies; a migration that needs them should be split into its own file.
 */
export function splitStatements(sql: string): string[] {
  return sql
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n")
    .split(/;\s*(?:\n|$)/)
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);
}
