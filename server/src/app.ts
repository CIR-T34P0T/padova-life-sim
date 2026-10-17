import { Server } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { ROOM_NAME } from "@padova/shared";
import { PlazaRoom } from "./PlazaRoom.ts";

/** Builds the game server. Shared by the entry point and the integration tests. */
export function createGameServer(): Server {
  const server = new Server({
    transport: new WebSocketTransport({ pingInterval: 3000, pingMaxRetries: 2 }),
    gracefullyShutdown: false,
  });
  server.define(ROOM_NAME, PlazaRoom);
  return server;
}
