// Test helpers: start a real game server on an in-memory PostgreSQL (PGlite)
// and join it the way the browser client does.

import type { Server } from "@colyseus/core";
import { Client, type Room } from "@colyseus/sdk";
import {
  ClientMessage,
  DEFAULT_APPEARANCE,
  ROOM_NAME,
  ServerMessage,
  type Appearance,
  type IdentityPayload,
  type ProfileErrorPayload,
  type ProfilePayload,
} from "@padova/shared";
import { createGameServer } from "../../src/app.ts";
import type { Database } from "../../src/db/database.ts";
import type { RoomTuning } from "../../src/tuning.ts";
import { migratedTestDatabase } from "./testDatabase.ts";

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function waitFor(predicate: () => boolean, timeoutMs = 6000, what = "condition"): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error(`waitFor timed out: ${what}`);
    await sleep(20);
  }
}

export interface TestServer {
  server: Server;
  db: Database;
  url: string;
  stop(): Promise<void>;
}

export async function startTestServer(port: number, tuning: Partial<RoomTuning> = {}, db?: Database): Promise<TestServer> {
  const database = db ?? (await migratedTestDatabase());
  // Tests create many guests from 127.0.0.1; lift the per-IP limit unless a test sets it.
  const server = createGameServer({ db: database, tuning: { guestCreationsPerIpPerHour: 10_000, ...tuning } });
  await server.listen(port, "127.0.0.1");
  return {
    server,
    db: database,
    url: `ws://127.0.0.1:${port}`,
    async stop() {
      await server.gracefullyShutdown(false);
      if (!db) await database.close();
    },
  };
}

/** A connected test client that records profile-related messages. */
export interface ProfileClient {
  room: Room;
  profiles: ProfilePayload[];
  errors: ProfileErrorPayload[];
  identities: IdentityPayload[];
  lastProfile(): ProfilePayload | undefined;
}

export async function connect(url: string, options: { guestToken?: string } = {}): Promise<ProfileClient> {
  const room = await new Client(url).joinOrCreate(ROOM_NAME, options);
  const client: ProfileClient = {
    room,
    profiles: [],
    errors: [],
    identities: [],
    lastProfile: () => client.profiles.at(-1),
  };
  room.onMessage(ServerMessage.Profile, (payload: ProfilePayload) => client.profiles.push(payload));
  room.onMessage(ServerMessage.ProfileError, (payload: ProfileErrorPayload) => client.errors.push(payload));
  room.onMessage(ServerMessage.Identity, (payload: IdentityPayload) => client.identities.push(payload));
  await waitFor(() => client.profiles.length > 0, 6000, "first profile message");
  return client;
}

/** Connects anonymously and creates a character; resolves once it is in the world. */
export async function joinWithNewCharacter(
  url: string,
  displayName: string,
  appearance: Appearance = DEFAULT_APPEARANCE,
): Promise<ProfileClient & { guestToken: string }> {
  const client = await connect(url);
  client.room.send(ClientMessage.CreateCharacter, { displayName, ageCategory: "adult", appearance });
  await waitFor(() => client.lastProfile()?.status === "ready" || client.errors.length > 0, 8000, `character ${displayName} ready`);
  if (client.errors.length) throw new Error(`createCharacter failed: ${JSON.stringify(client.errors)}`);
  await waitFor(() => client.room.state.players.get(client.room.sessionId) !== undefined, 4000, "own player replicated");
  return Object.assign(client, { guestToken: client.identities[0]!.guestToken });
}
