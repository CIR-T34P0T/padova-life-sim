// Database commands: `npm run db:migrate`, `db:rollback`, `db:status`.
// Uses the same configuration as the server (DATABASE_URL or PGLITE_DATA_DIR).

import { databaseConfigFromEnv, openDatabase } from "./database.ts";
import { appliedVersions, loadMigrations, migrate, rollback } from "./migrate.ts";

const command = process.argv[2] ?? "status";
const db = await openDatabase(databaseConfigFromEnv());
console.log(`Database: ${db.describe()}`);

try {
  if (command === "migrate") {
    const done = await migrate(db);
    console.log(done.length ? `Applied migrations: ${done.join(", ")}` : "Already up to date.");
  } else if (command === "rollback") {
    const steps = Number(process.argv[3] ?? 1);
    const reverted = await rollback(db, steps);
    console.log(reverted.length ? `Reverted migrations: ${reverted.join(", ")}` : "Nothing to revert.");
  } else if (command === "status") {
    const applied = new Set(await appliedVersions(db));
    for (const migration of loadMigrations()) {
      console.log(`${applied.has(migration.version) ? "applied" : "pending"}  ${String(migration.version).padStart(4, "0")}_${migration.name}`);
    }
  } else {
    console.error(`Unknown command "${command}". Use migrate, rollback [steps] or status.`);
    process.exitCode = 1;
  }
} finally {
  await db.close();
}
