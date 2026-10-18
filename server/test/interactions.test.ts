// Interaction integration tests: real servers, real WebSocket clients, real
// game rules. Tuning only shortens waits (faster walking, shorter timers) and,
// in two suites, the distance limit and the world layout.

import type { Room } from "@colyseus/sdk";
import {
  ClientMessage,
  INTERACTION_CONFIG,
  PLAZA_LAYOUT,
  ServerMessage,
  findSeat,
  type ActionUpdatePayload,
  type GreetedPayload,
  type RejectedPayload,
  type WorldLayout,
} from "@padova/shared";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { TuningOverrides } from "../src/tuning.ts";
import { joinWithNewCharacter, sleep, startTestServer, waitFor, type TestServer } from "./helpers/gameClient.ts";

const STUDY_MS = 1200;
const FAST: TuningOverrides = { walkSpeed: 9, actionDurationsMs: { study: STUDY_MS, greet: 500 } };


interface TestPlayer {
  room: Room;
  id: string;
  updates: ActionUpdatePayload[];
  rejected: RejectedPayload[];
  greetings: GreetedPayload[];
  /** Latest update for this player's own action. */
  last(): ActionUpdatePayload | undefined;
  waitForStatus(status: ActionUpdatePayload["status"], timeoutMs?: number): Promise<ActionUpdatePayload>;
}

/** Starts a server for one suite and returns helpers bound to it. */
function useServer(port: number, tuning: TuningOverrides) {
  let server: TestServer;
  const open: Room[] = [];

  beforeAll(async () => {
    server = await startTestServer(port, tuning);
  });
  afterEach(async () => {
    await Promise.all(open.splice(0).map((room) => Promise.race([room.leave(true).catch(() => undefined), sleep(500)])));
    await sleep(150);
  });
  afterAll(async () => {
    await server.stop();
  });

  async function join(name: string): Promise<TestPlayer> {
    const { room } = await joinWithNewCharacter(server.url, name);
    open.push(room);
    const player: TestPlayer = {
      room,
      id: room.sessionId,
      updates: [],
      rejected: [],
      greetings: [],
      last: () => player.updates.at(-1),
      /** Waits for an update with this status. Updates already received count too. */
      async waitForStatus(status, timeoutMs = 8000) {
        const seen = 0;
        await waitFor(() => player.updates.slice(seen).some((u) => u.status === status), timeoutMs, `status ${status}`);
        return player.updates.slice(seen).find((u) => u.status === status)!;
      },
    };
    room.onMessage(ServerMessage.ActionUpdate, (payload: ActionUpdatePayload) => player.updates.push(payload));
    room.onMessage(ServerMessage.Rejected, (payload: RejectedPayload) => player.rejected.push(payload));
    room.onMessage(ServerMessage.Greeted, (payload: GreetedPayload) => player.greetings.push(payload));
    return player;
  }

  /** Joins several players and waits until every client sees all of them. */
  async function joinAll<const N extends readonly string[]>(...names: N): Promise<{ [K in keyof N]: TestPlayer }> {
    const players: TestPlayer[] = [];
    for (const name of names) players.push(await join(name));
    await waitFor(
      () => players.every((p) => players.every((other) => p.room.state.players.get(other.id) !== undefined)),
      4000,
      "everyone sees everyone",
    );
    return players as { [K in keyof N]: TestPlayer };
  }

  return { join, joinAll };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const stateOf = (observer: TestPlayer, id: string): any => observer.room.state.players.get(id);
const seatOwner = (observer: TestPlayer, seatId: string): string | undefined => observer.room.state.seats.get(seatId);
const interact = (p: TestPlayer, targetKind: "object" | "player", targetId: string, action: string) =>
  p.room.send(ClientMessage.Interact, { targetKind, targetId, action });

/** Sends a request and resolves with the first update that answers it. */
async function request(p: TestPlayer, targetKind: "object" | "player", targetId: string, action: string) {
  const seen = p.updates.length;
  interact(p, targetKind, targetId, action);
  await waitFor(() => p.updates.length > seen, 4000, `reply to ${action} ${targetId}`);
  return p.updates[seen]!;
}

describe("object interactions", () => {
  const { join, joinAll } = useServer(2612, FAST);

  it("walks to a bench, sits on a reserved seat, and everyone sees it", async () => {
    const [alice, bruno] = await joinAll("Alice", "Bruno");
    const reply = await request(alice, "object", "bench-1", "sit");
    expect(reply).toMatchObject({ status: "queued", action: "sit", targetId: "bench-1" });
    expect(reply.actionId).toBeGreaterThan(0);
    // The seat is reserved for Alice while she walks (state patches trail direct messages by up to one patch).
    const benchSeats = PLAZA_LAYOUT.interactables[0]!.seats;
    await waitFor(() => benchSeats.some((s) => seatOwner(bruno, s.id) === alice.id), 2000, "reservation replicated");
    const reserved = benchSeats.find((s) => seatOwner(bruno, s.id) === alice.id);

    await alice.waitForStatus("completed");
    expect(alice.updates.map((u) => u.status)).toEqual(["queued", "started", "completed"]);
    await waitFor(() => stateOf(bruno, alice.id).activity === "sitting", 3000, "Bruno sees Alice sitting");
    const seen = stateOf(bruno, alice.id);
    const seat = findSeat(PLAZA_LAYOUT, seen.seatId)!.seat;
    expect(seen.seatId).toBe(reserved!.id);
    expect(seen.x).toBeCloseTo(seat.x, 3);
    expect(seen.z).toBeCloseTo(seat.z, 3);
  });

  it("stands up again, freeing the seat", async () => {
    const alice = await join("Alice");
    await request(alice, "object", "bench-2", "sit");
    await alice.waitForStatus("completed");
    await waitFor(() => stateOf(alice, alice.id).seatId !== "", 2000, "seated state");
    const seatId = stateOf(alice, alice.id).seatId as string;
    expect(seatId).toMatch(/^bench-2\//);
    const reply = await request(alice, "object", "bench-2", "stand");
    expect(reply.status).toBe("completed");
    await waitFor(() => stateOf(alice, alice.id).seatId === "" && seatOwner(alice, seatId) === undefined, 3000, "seat freed");
    expect(stateOf(alice, alice.id).activity).toBe("idle");
  });

  it("gives simultaneous requests for one seat to exactly one player", async () => {
    const [alice, bruno] = await joinAll("Alice", "Bruno");
    // desk-1 has a single seat; both ask in the same instant.
    interact(alice, "object", "desk-1", "study");
    interact(bruno, "object", "desk-1", "study");
    await waitFor(() => alice.updates.length > 0 && bruno.updates.length > 0, 4000, "both answered");
    const statuses = [alice.updates[0]!.status, bruno.updates[0]!.status].sort();
    expect(statuses).toEqual(["queued", "rejected"]);
    const loser = alice.updates[0]!.status === "rejected" ? alice : bruno;
    expect(loser.updates[0]!.reason).toBe("no_free_seat");
  });

  it("fills a bench and refuses a third player", async () => {
    const players = await joinAll("Anna", "Bea", "Cleo");
    for (const p of players) interact(p, "object", "bench-1", "sit");
    await waitFor(() => players.every((p) => p.updates.length > 0), 4000, "all answered");
    const firstReplies = players.map((p) => p.updates[0]!);
    expect(firstReplies.filter((u) => u.status === "queued")).toHaveLength(2);
    expect(firstReplies.filter((u) => u.status === "rejected").map((u) => u.reason)).toEqual(["no_free_seat"]);
  });

  it("rejects invalid interactions with a reason", async () => {
    const alice = await join("Alice");
    expect(await request(alice, "object", "bench-99", "sit")).toMatchObject({ status: "rejected", reason: "unknown_target" });
    expect(await request(alice, "object", "bench-1", "greet")).toMatchObject({ status: "rejected", reason: "action_not_available" });
    expect(await request(alice, "object", "bench-1", "study")).toMatchObject({ status: "rejected", reason: "action_not_available" });
    expect(await request(alice, "object", "bench-1", "stand")).toMatchObject({ status: "rejected", reason: "action_not_available" });
    expect(await request(alice, "player", alice.id, "greet")).toMatchObject({ status: "rejected", reason: "target_is_self" });
    expect(await request(alice, "player", "nobody", "greet")).toMatchObject({ status: "rejected", reason: "unknown_target" });
    alice.room.send(ClientMessage.Interact, { targetKind: "object", targetId: "bench-1", action: "dance" });
    await waitFor(() => alice.rejected.length === 1, 3000, "malformed rejection");
    expect(alice.rejected[0]).toEqual({ action: "interact", reason: "invalid_payload" });
    expect(stateOf(alice, alice.id).activity).toBe("idle");
  });

  it("cancels while walking: stops, frees the seat, and lets someone else take it", async () => {
    const [alice, bruno] = await joinAll("Alice", "Bruno");
    expect((await request(alice, "object", "desk-1", "study")).status).toBe("queued");
    await sleep(300);
    alice.room.send(ClientMessage.CancelAction);
    const cancelled = await alice.waitForStatus("cancelled");
    expect(cancelled.reason).toBe("cancelled");
    await waitFor(() => seatOwner(bruno, "desk-1/seat-a") === undefined, 3000, "desk freed");
    await waitFor(() => !stateOf(alice, alice.id).moving, 3000, "Alice stopped");
    const stoppedAt = { x: stateOf(alice, alice.id).x, z: stateOf(alice, alice.id).z };
    await sleep(300);
    expect(stateOf(alice, alice.id).x).toBeCloseTo(stoppedAt.x, 3);
    expect((await request(bruno, "object", "desk-1", "study")).status).toBe("queued");
  });

  it("interrupts an action when the player walks somewhere else", async () => {
    const alice = await join("Alice");
    expect((await request(alice, "object", "bench-1", "sit")).status).toBe("queued");
    alice.room.send(ClientMessage.MoveTo, { x: 4, z: 14 });
    const cancelled = await alice.waitForStatus("cancelled");
    expect(cancelled.reason).toBe("interrupted");
  });

  it("times studying on the server and ignores a client claiming it is done", async () => {
    const alice = await join("Alice");
    expect((await request(alice, "object", "desk-2", "study")).status).toBe("queued");
    const started = await alice.waitForStatus("started");
    const startedAt = Date.now();
    expect(started.durationMs).toBe(STUDY_MS);
    await waitFor(() => stateOf(alice, alice.id).activity === "studying", 1000, "studying replicated");
    // A forged completion message must not end the session early.
    alice.room.send("actionComplete" as never, { actionId: started.actionId } as never);
    alice.room.send("complete" as never, {} as never);
    await sleep(400);
    expect(alice.updates.some((u) => u.status === "completed")).toBe(false);
    await alice.waitForStatus("completed", 4000);
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(STUDY_MS - 100);
    await waitFor(() => stateOf(alice, alice.id).activity === "sitting", 2000, "back to sitting");
    expect(stateOf(alice, alice.id).seatId).toBe("desk-2/seat-a");
  });

  it("keeps a seat through a brief disconnect and frees it on leave", async () => {
    const [alice, bruno] = await joinAll("Alice", "Bruno");
    await request(alice, "object", "bench-2", "sit");
    await alice.waitForStatus("completed");
    await waitFor(() => stateOf(bruno, alice.id)?.seatId !== "", 2000, "Bruno sees Alice seated");
    const seatId = stateOf(bruno, alice.id).seatId as string;
    alice.room.reconnection.minUptime = 0;
    const reconnected = new Promise<void>((resolve) => alice.room.onReconnect(() => resolve()));
    alice.room.connection.close(4010, "simulated network drop");
    await waitFor(() => stateOf(bruno, alice.id)?.connected === false, 3000, "drop seen");
    expect(seatOwner(bruno, seatId)).toBe(alice.id);
    await reconnected;
    await waitFor(() => stateOf(bruno, alice.id)?.connected === true, 3000, "reconnect seen");
    expect(stateOf(bruno, alice.id).seatId).toBe(seatId);
    await alice.room.leave(true);
    await waitFor(() => seatOwner(bruno, seatId) === undefined, 3000, "seat freed on leave");
  });
});

describe("greeting another player", () => {
  const { join, joinAll } = useServer(2613, FAST);

  it("walks over, greets, notifies the other player and replicates the gesture", async () => {
    const [alice, bruno] = await joinAll("Alice", "Bruno");
    // Move Bruno away so Alice has to walk.
    bruno.room.send(ClientMessage.MoveTo, { x: 8, z: 12 });
    await waitFor(() => !stateOf(alice, bruno.id).moving && Math.hypot(stateOf(alice, bruno.id).x - 8, stateOf(alice, bruno.id).z - 12) < 0.2, 5000, "Bruno moved");

    const reply = await request(alice, "player", bruno.id, "greet");
    expect(reply.status).toBe("queued");
    await alice.waitForStatus("started");
    await waitFor(() => bruno.greetings.length === 1, 3000, "Bruno notified");
    expect(bruno.greetings[0]).toEqual({ fromId: alice.id, fromName: "Alice" });
    await waitFor(() => stateOf(bruno, alice.id).activity === "greeting", 2000, "gesture replicated");
    expect(stateOf(bruno, alice.id).targetId).toBe(bruno.id);
    const a = stateOf(bruno, alice.id);
    expect(Math.hypot(a.x - 8, a.z - 12)).toBeLessThanOrEqual(INTERACTION_CONFIG.greetRange);
    await alice.waitForStatus("completed");
    await waitFor(() => stateOf(bruno, alice.id).activity === "idle", 2000, "gesture ended");

    // Cooldown: greeting the same player again at once is refused.
    expect(await request(alice, "player", bruno.id, "greet")).toMatchObject({ status: "rejected", reason: "too_soon" });
  });

  it("fails cleanly when the other player leaves before being reached", async () => {
    const [alice, bruno] = await joinAll("Alice", "Bruno");
    bruno.room.send(ClientMessage.MoveTo, { x: -10, z: -6 });
    await waitFor(() => Math.hypot(stateOf(alice, bruno.id).x + 10, stateOf(alice, bruno.id).z + 6) < 0.2, 6000, "Bruno far");
    expect((await request(alice, "player", bruno.id, "greet")).status).toBe("queued");
    await bruno.room.leave(true);
    const failed = await alice.waitForStatus("failed");
    expect(failed.reason).toBe("target_left");
    expect(stateOf(alice, alice.id).activity).toBe("idle");
  });

  it("can greet a seated player", async () => {
    const [alice, bruno] = await joinAll("Alice", "Bruno");
    await request(bruno, "object", "bench-1", "sit");
    await bruno.waitForStatus("completed");
    expect((await request(alice, "player", bruno.id, "greet")).status).toBe("queued");
    await alice.waitForStatus("completed");
    expect(bruno.greetings).toHaveLength(1);
    expect(stateOf(bruno, bruno.id).activity).toBe("sitting"); // greeting does not disturb the target
  });
});

describe("distance limit", () => {
  const { join } = useServer(2614, { ...FAST, maxInteractionDistance: 25 });

  it("refuses targets beyond the configured distance", async () => {
    const alice = await join("Alice");
    // desk-1 is ~30 m from spawn; bench-1 is ~22 m.
    expect(await request(alice, "object", "desk-1", "study")).toMatchObject({ status: "rejected", reason: "too_far" });
    expect((await request(alice, "object", "bench-1", "sit")).status).toBe("queued");
  });
});

describe("reachability", () => {
  // A world where one bench is walled in and cannot be reached.
  const walled: WorldLayout = {
    halfSize: 12,
    obstacles: [
      { id: "w-n", kind: "building", minX: -6, maxX: 6, minZ: -6, maxZ: -5, height: 3 },
      { id: "w-s", kind: "building", minX: -6, maxX: 6, minZ: 5, maxZ: 6, height: 3 },
      { id: "w-w", kind: "building", minX: -6, maxX: -5, minZ: -6, maxZ: 6, height: 3 },
      { id: "w-e", kind: "building", minX: 5, maxX: 6, minZ: -6, maxZ: 6, height: 3 },
      { id: "caged-bench", kind: "bench", minX: -1, maxX: 1, minZ: -0.3, maxZ: 0.3, height: 0.5 },
    ],
    interactables: [
      {
        id: "caged-bench",
        kind: "bench",
        label: "Bench",
        seats: [{ id: "caged-bench/seat-a", x: 0, z: 0.35, rotation: 0, approach: { x: 0, z: 1.2 } }],
      },
    ],
    spawnPoints: [{ x: 9, z: 9 }],
  };
  const { join } = useServer(2615, { ...FAST, world: walled });

  it("rejects an object that cannot be reached and reserves nothing", async () => {
    const alice = await join("Alice");
    expect(await request(alice, "object", "caged-bench", "sit")).toMatchObject({ status: "rejected", reason: "unreachable" });
    expect(seatOwner(alice, "caged-bench/seat-a")).toBeUndefined();
  });
});
