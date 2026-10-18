import { parseTimeScale } from "@padova/shared";
import { createGameServer } from "./app.ts";
import { databaseConfigFromEnv, openDatabase } from "./db/database.ts";
import { migrate } from "./db/migrate.ts";
import { log } from "./log.ts";

const port = Number(process.env.PORT ?? 2567);

const db = await openDatabase(databaseConfigFromEnv());
log.info("server", `database: ${db.describe()}`);
if (process.env.DB_MIGRATE_ON_START !== "false") {
  const applied = await migrate(db);
  if (applied.length) log.info("server", `applied migrations: ${applied.join(", ")}`);
}

/** Optional override of the per-IP guest creation limit (default in shared PROFILE_CONFIG). */
function guestLimitFromEnv(): number | undefined {
  const raw = process.env.GUEST_CREATIONS_PER_IP_PER_HOUR?.trim();
  if (!raw) return undefined;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`GUEST_CREATIONS_PER_IP_PER_HOUR must be a whole number of at least 1 (got "${raw}")`);
  }
  return value;
}

const guestCreationsPerIpPerHour = guestLimitFromEnv();
// Game minutes per real minute (D-021). Changing it moves the clock: for development and tests.
const timeScale = parseTimeScale(process.env.GAME_TIME_SCALE);
const server = createGameServer({ db, tuning: { timeScale, ...(guestCreationsPerIpPerHour ? { guestCreationsPerIpPerHour } : {}) } });
log.info("server", `game time: ${timeScale} game minutes per real minute`);
await server.listen(port, "0.0.0.0");
log.info("server", `Padova Life SIM server listening on ws://0.0.0.0:${port}`);

const shutdown = async (signal: string) => {
  log.info("server", `${signal} received, shutting down`);
  await server.gracefullyShutdown(false);
  await db.close();
  process.exit(0);
};
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
