import { Server } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { ROOM_NAME } from "@padova/shared";
import { PlazaRoom } from "./PlazaRoom.ts";
import type { Database } from "./db/database.ts";
import { LifeService } from "./life/LifeService.ts";
import { ProfileService } from "./profiles/ProfileService.ts";
import { SessionRegistry } from "./profiles/sessionRegistry.ts";
import { registerServices } from "./services.ts";
import { staticFileHandler } from "./staticFiles.ts";
import { mountStatusRoutes, type RouteApp, type StatusSource } from "./status.ts";
import { resolveTuning, type TuningOverrides } from "./tuning.ts";

/** The server's version, reported by /status (from package.json). */
const SERVER_VERSION = "0.1.0";

export interface GameServerOptions {
  /** A migrated database (see db/migrate.ts). */
  db: Database;
  /** Overrides for room defaults; production passes only environment settings. */
  tuning?: TuningOverrides;
  /** The built client (client/dist) to serve from the same address (M12, production); development uses Vite. */
  clientDist?: string | null;
}

/** Builds the game server. Shared by the entry point and the integration tests. */
export function createGameServer({ db, tuning, clientDist = null }: GameServerOptions): Server {
  const resolved = resolveTuning(tuning);
  const rooms = new Set<StatusSource>();
  const server = new Server({
    transport: new WebSocketTransport({ pingInterval: 3000, pingMaxRetries: 2 }),
    gracefullyShutdown: false,
    // Health and status for operations (M12), on the same port as the game, and the built client in production.
    express: (app) => {
      const routes = app as unknown as RouteApp;
      mountStatusRoutes(routes, { db, rooms, npcs: resolved.npcs, version: SERVER_VERSION });
      if (clientDist) routes.use(staticFileHandler(clientDist));
    },
  });
  const servicesKey = registerServices({
    profiles: new ProfileService(db, {
      guestCreationsPerIpPerHour: resolved.guestCreationsPerIpPerHour,
      maxCharactersPerAccount: resolved.maxCharactersPerAccount,
    }),
    life: new LifeService(db, { timeScale: resolved.timeScale, dailyAllowanceCents: resolved.dailyAllowanceCents }),
    sessions: new SessionRegistry(),
    rooms,
  });
  server.define(ROOM_NAME, PlazaRoom, { tuning, servicesKey });
  return server;
}
