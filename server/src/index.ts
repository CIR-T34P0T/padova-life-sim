import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseClockOffset, parseTimeScale } from "@padova/shared";
import { createGameServer } from "./app.ts";
import { databaseConfigFromEnv, openDatabase } from "./db/database.ts";
import { migrate } from "./db/migrate.ts";
import { log } from "./log.ts";

const port = Number(process.env.PORT ?? 2567);
// 0.0.0.0 by default (development, phones on the same Wi-Fi); 127.0.0.1 behind an HTTPS proxy in production.
const host = process.env.HOST?.trim() || "0.0.0.0";
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** The built client to serve (CLIENT_DIST, relative to the repository), or null. */
function clientDistFromEnv(): string | null {
  const raw = process.env.CLIENT_DIST?.trim();
  if (!raw) return null;
  const dir = resolve(repoRoot, raw);
  if (!existsSync(resolve(dir, "index.html"))) throw new Error(`CLIENT_DIST has no index.html (${dir}); run npm run build first`);
  return dir;
}
const clientDist = clientDistFromEnv();

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
// Shifts the whole clock by whole game minutes (e.g. to try opening hours or night): for development and tests.
const clockOffsetMinutes = parseClockOffset(process.env.GAME_CLOCK_OFFSET_MINUTES);
// Non-player characters (M11) are on unless NPCS is "off", "false" or "0".
const npcs = !["off", "false", "0"].includes((process.env.NPCS ?? "").trim().toLowerCase());
const server = createGameServer({
  db,
  clientDist,
  tuning: { timeScale, clockOffsetMinutes, npcs, ...(guestCreationsPerIpPerHour ? { guestCreationsPerIpPerHour } : {}) },
});
log.info("server", `game time: ${timeScale} game minutes per real minute${clockOffsetMinutes ? `, clock shifted by ${clockOffsetMinutes} game minutes` : ""}; NPCs ${npcs ? "on" : "off"}`);
await server.listen(port, host);
log.info("server", `Padova Life SIM server listening on ws://${host}:${port}${clientDist ? `; serving the client from ${clientDist}` : ""}`);

const shutdown = async (signal: string) => {
  log.info("server", `${signal} received, shutting down`);
  await server.gracefullyShutdown(false);
  await db.close();
  process.exit(0);
};
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
