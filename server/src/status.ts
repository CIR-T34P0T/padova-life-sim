// Health and status for operations (M12): what a hosting provider's health
// check and a person watching the server need, without any personal data.
//   GET /health  → 200 {"status":"ok"} when the server can reach its
//                  database, 503 otherwise (for load balancers and uptime checks).
//   GET /status  → aggregate numbers only: uptime, memory, CPU, database
//                  latency, and per room the players, NPCs and tick time
//                  against its budget. No names, ids or addresses.

import { NPC_CONFIG } from "@padova/shared";
import type { Database } from "./db/database.ts";
import type { StaticHandler } from "./staticFiles.ts";
import type { TickSummary } from "./tickStats.ts";

/** What a room reports about itself. */
export interface RoomStatus {
  players: number;
  npcs: number;
  tick: TickSummary;
}

export interface StatusSource {
  statusSummary(): RoomStatus;
}

/** The part of an express app the routes need (express comes with Colyseus's transport). */
export interface RouteApp {
  get(path: string, handler: (req: unknown, res: RouteResponse) => void): void;
  use(handler: StaticHandler): void;
}
interface RouteResponse {
  status(code: number): RouteResponse;
  set(field: string, value: string): RouteResponse;
  json(body: unknown): void;
}

export interface StatusDeps {
  db: Database;
  rooms: ReadonlySet<StatusSource>;
  npcs: boolean;
  version: string;
}

/** How long the database may take to answer a health check (ms). */
const DATABASE_TIMEOUT_MS = 2_000;

export async function databaseCheck(db: Database): Promise<{ ok: boolean; latencyMs: number }> {
  const started = performance.now();
  try {
    await Promise.race([db.query("SELECT 1"), new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), DATABASE_TIMEOUT_MS))]);
    return { ok: true, latencyMs: performance.now() - started };
  } catch {
    return { ok: false, latencyMs: performance.now() - started };
  }
}

/** CPU used by this process since the previous call, as a share of one core (0–1 per core). */
function cpuMeter() {
  let last = process.cpuUsage();
  let lastAt = performance.now();
  return () => {
    const now = performance.now();
    const usage = process.cpuUsage(last);
    const share = (usage.user + usage.system) / 1000 / Math.max(1, now - lastAt);
    last = process.cpuUsage();
    lastAt = now;
    return share;
  };
}

export function mountStatusRoutes(app: RouteApp, deps: StatusDeps): void {
  const startedAt = Date.now();
  const cpu = cpuMeter();
  app.get("/health", (_req, res) => {
    void databaseCheck(deps.db).then((db) => {
      res.set("Cache-Control", "no-store");
      if (db.ok) res.status(200).json({ status: "ok" });
      else res.status(503).json({ status: "error", database: "unreachable" });
    });
  });
  app.get("/status", (_req, res) => {
    void databaseCheck(deps.db).then((db) => {
      const memory = process.memoryUsage();
      const rooms = [...deps.rooms].map((room) => room.statusSummary());
      res.set("Cache-Control", "no-store");
      res.status(200).json({
        status: db.ok ? "ok" : "degraded",
        version: deps.version,
        uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
        memory: { rssMb: Math.round(memory.rss / 1048576), heapUsedMb: Math.round(memory.heapUsed / 1048576) },
        cpu: { sinceLastStatus: Number(cpu().toFixed(3)) },
        database: { ok: db.ok, latencyMs: Number(db.latencyMs.toFixed(1)), kind: deps.db.describe().startsWith("PostgreSQL") ? "postgresql" : "pglite" },
        npcs: deps.npcs ? "on" : "off",
        tickBudgetMs: NPC_CONFIG.tickBudgetMs,
        players: rooms.reduce((sum, r) => sum + r.players, 0),
        rooms: rooms.map((r) => ({
          players: r.players,
          npcs: r.npcs,
          tick: { ticks: r.tick.ticks, avgMs: Number(r.tick.avgMs.toFixed(3)), p95Ms: Number(r.tick.p95Ms.toFixed(3)), maxMs: Number(r.tick.maxMs.toFixed(2)) },
        })),
      });
    });
  });
}
