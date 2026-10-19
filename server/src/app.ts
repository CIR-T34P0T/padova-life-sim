import { Server } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { ROOM_NAME } from "@padova/shared";
import { PlazaRoom } from "./PlazaRoom.ts";
import type { Database } from "./db/database.ts";
import { LifeService } from "./life/LifeService.ts";
import { ProfileService } from "./profiles/ProfileService.ts";
import { SessionRegistry } from "./profiles/sessionRegistry.ts";
import { registerServices } from "./services.ts";
import { resolveTuning, type TuningOverrides } from "./tuning.ts";

export interface GameServerOptions {
  /** A migrated database (see db/migrate.ts). */
  db: Database;
  /** Overrides for room defaults; production passes only environment settings. */
  tuning?: TuningOverrides;
}

/** Builds the game server. Shared by the entry point and the integration tests. */
export function createGameServer({ db, tuning }: GameServerOptions): Server {
  const resolved = resolveTuning(tuning);
  const server = new Server({
    transport: new WebSocketTransport({ pingInterval: 3000, pingMaxRetries: 2 }),
    gracefullyShutdown: false,
  });
  const servicesKey = registerServices({
    profiles: new ProfileService(db, {
      guestCreationsPerIpPerHour: resolved.guestCreationsPerIpPerHour,
      maxCharactersPerAccount: resolved.maxCharactersPerAccount,
    }),
    life: new LifeService(db, { timeScale: resolved.timeScale, dailyAllowanceCents: resolved.dailyAllowanceCents }),
    sessions: new SessionRegistry(),
  });
  server.define(ROOM_NAME, PlazaRoom, { tuning, servicesKey });
  return server;
}
