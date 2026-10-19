// Integration tests: a real server on a real port, driven by the real client
// SDK over WebSockets. Nothing is mocked.

import { getStateCallbacks, type Room } from "@colyseus/sdk";
import {
  ClientMessage,
  GAME_CONFIG,
  PLAZA_LAYOUT,
  ServerMessage,
  isPositionWalkable,
  type RejectedPayload,
} from "@padova/shared";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { connect, joinWithNewCharacter, sleep, startTestServer, waitFor, type TestServer } from "./helpers/gameClient.ts";

const PORT = 2611;
let server: TestServer;
const openRooms: Room[] = [];

beforeAll(async () => {
  server = await startTestServer(PORT);
});

afterEach(async () => {
  // A room that already left never resolves a second leave(), so cap the wait.
  await Promise.all(
    openRooms.splice(0).map((room) => Promise.race([room.leave(true).catch(() => undefined), sleep(500)])),
  );
  await sleep(150);
});

afterAll(async () => {
  await server.stop();
});

/** Joins with a freshly created character (the M4 join flow). */
async function join(name: string): Promise<Room> {
  const { room } = await joinWithNewCharacter(server.url, name);
  openRooms.push(room);
  return room;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const playerIn = (room: Room, sessionId: string): any => room.state.players.get(sessionId);

describe("plaza room", () => {
  it("lets two players join and see each other", async () => {
    const a = await join("Alice");
    const b = await join("Bruno");
    await waitFor(() => a.state.players.size === 2 && b.state.players.size === 2);
    expect(playerIn(a, b.sessionId).name).toBe("Bruno");
    expect(playerIn(b, a.sessionId).name).toBe("Alice");
    expect(playerIn(b, a.sessionId).connected).toBe(true);
  });

  it("refuses a character with an unusable name and keeps the visitor out of the world", async () => {
    const visitor = await connect(server.url);
    openRooms.push(visitor.room);
    expect(visitor.lastProfile()).toMatchObject({ status: "lobby", characters: [] });
    visitor.room.send(ClientMessage.CreateCharacter, { displayName: "<", ageCategory: "adult", appearance: {} });
    await waitFor(() => visitor.errors.length === 1);
    expect(visitor.errors[0]).toMatchObject({ action: "createCharacter", reason: "invalid_name" });
    expect(visitor.room.state.players.get(visitor.room.sessionId)).toBeUndefined();
  });

  it("moves a player along a server-computed path and replicates it", async () => {
    const a = await join("Alice");
    const b = await join("Bruno");
    await waitFor(() => b.state.players.size === 2);
    const target = { x: 0, z: -8 }; // the far side of the fountain
    a.send(ClientMessage.MoveTo, target);
    await waitFor(() => {
      const seen = playerIn(b, a.sessionId);
      return Math.hypot(seen.x - target.x, seen.z - target.z) < 0.1 && !seen.moving;
    }, 15_000);
    const seen = playerIn(b, a.sessionId);
    expect(isPositionWalkable(PLAZA_LAYOUT, seen.x, seen.z, GAME_CONFIG.playerRadius)).toBe(true);
  });

  it("rejects a move into an obstacle and does not move the player", async () => {
    const a = await join("Alice");
    const start = { x: playerIn(a, a.sessionId).x, z: playerIn(a, a.sessionId).z };
    const rejection = new Promise<RejectedPayload>((resolve) => a.onMessage(ServerMessage.Rejected, resolve));
    a.send(ClientMessage.MoveTo, { x: 0, z: -3 }); // fountain centre
    expect(await rejection).toEqual({ action: ClientMessage.MoveTo, reason: "target_blocked" });
    await sleep(300);
    expect(playerIn(a, a.sessionId).x).toBeCloseTo(start.x);
    expect(playerIn(a, a.sessionId).z).toBeCloseTo(start.z);
  });

  it("ignores a forged position message (no teleporting)", async () => {
    const a = await join("Alice");
    const start = { x: playerIn(a, a.sessionId).x, z: playerIn(a, a.sessionId).z };
    a.send("position" as never, { x: -20, z: -20 } as never);
    a.send("setState" as never, { x: 5, z: 5 } as never);
    await sleep(400);
    expect(playerIn(a, a.sessionId).x).toBeCloseTo(start.x);
    expect(playerIn(a, a.sessionId).z).toBeCloseTo(start.z);
  });

  it("caps movement speed even when the client sends an oversized direction", async () => {
    const a = await join("Alice");
    const start = { x: playerIn(a, a.sessionId).x, z: playerIn(a, a.sessionId).z };
    a.send(ClientMessage.MoveDirection, { dx: 1000, dz: 0 });
    await sleep(1000);
    a.send(ClientMessage.Stop);
    await sleep(150);
    const travelled = Math.hypot(playerIn(a, a.sessionId).x - start.x, playerIn(a, a.sessionId).z - start.z);
    expect(travelled).toBeGreaterThan(1);
    expect(travelled).toBeLessThanOrEqual(GAME_CONFIG.walkSpeed * 1.35); // 1 s plus network/tick slack
  });

  it("rejects malformed and out-of-bounds moves", async () => {
    const a = await join("Alice");
    const reasons: string[] = [];
    a.onMessage(ServerMessage.Rejected, (payload: RejectedPayload) => reasons.push(payload.reason));
    a.send(ClientMessage.MoveTo, { x: "north", z: 1 });
    a.send(ClientMessage.MoveTo, { x: 500, z: 0 });
    await waitFor(() => reasons.length === 2);
    expect(reasons).toEqual(["invalid_payload", "target_out_of_bounds"]);
  });

  it("removes a player for everyone when they leave", async () => {
    const a = await join("Alice");
    const b = await join("Bruno");
    await waitFor(() => b.state.players.size === 2);
    const removed = new Promise<string>((resolve) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const $ = getStateCallbacks(b) as any;
      $(b.state).players.onRemove((_player: unknown, key: string) => resolve(key));
    });
    await a.leave(true);
    expect(await removed).toBe(a.sessionId);
    expect(b.state.players.size).toBe(1);
  });

  it("keeps the same character through a brief connection drop", async () => {
    const a = await join("Alice");
    const b = await join("Bruno");
    await waitFor(() => b.state.players.size === 2);
    a.reconnection.minUptime = 0; // the SDK default refuses to auto-reconnect in the first 5 s
    const sessionId = a.sessionId;
    const reconnected = new Promise<void>((resolve) => a.onReconnect(() => resolve()));

    a.connection.close(4010, "simulated network drop");
    await waitFor(() => playerIn(b, sessionId)?.connected === false);
    await reconnected;
    await waitFor(() => playerIn(b, sessionId)?.connected === true);

    expect(a.sessionId).toBe(sessionId);
    expect(b.state.players.size).toBe(2);
    // The reconnected client can still act.
    a.send(ClientMessage.MoveTo, { x: 3, z: 14 });
    await waitFor(() => Math.hypot(playerIn(b, sessionId).x - 3, playerIn(b, sessionId).z - 14) < 0.1, 8000);
  });
});
