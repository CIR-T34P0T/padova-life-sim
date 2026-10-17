import { Server } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { ROOM_NAME } from "@padova/shared";
import { PlazaRoom } from "./PlazaRoom.ts";
import type { RoomTuning } from "./tuning.ts";

/**
 * Builds the game server. Shared by the entry point and the integration tests.
 * `tuning` overrides room defaults; production passes nothing.
 */
export function createGameServer(tuning?: Partial<RoomTuning>): Server {
  const server = new Server({
    transport: new WebSocketTransport({ pingInterval: 3000, pingMaxRetries: 2 }),
    gracefullyShutdown: false,
  });
  server.define(ROOM_NAME, PlazaRoom, { tuning });
  return server;
}
