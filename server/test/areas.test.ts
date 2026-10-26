// Indoor rooms through the real room, database and WebSocket clients (M7c):
// doors move characters between areas, each client receives only the players
// in its own area, desks inside work, the area is saved, and nothing crosses
// areas (greetings, walking distance).

import type { Room } from "@colyseus/sdk";
import { ClientMessage, type ActionUpdatePayload, type LifePayload } from "@padova/shared";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { connectAndPlay, joinWithNewCharacter, sleep, startTestServer, waitFor, type ProfileClient, type TestServer } from "./helpers/gameClient.ts";

const FAST = { walkSpeed: 9, actionDurationsMs: { study: 800, sketch: 600, wash: 400, greet: 300, work: 1_200 } };
const ROOM = "hall/lecture-room";

const context = { server: undefined as unknown as TestServer };
const rooms: Room[] = [];
beforeAll(async () => {
  context.server = await startTestServer(2636, FAST);
});
afterEach(async () => {
  await Promise.all(rooms.splice(0).map((room) => Promise.race([room.leave(true).catch(() => undefined), sleep(500)])));
  await sleep(150);
});
afterAll(async () => {
  await context.server.stop();
});
const track = <T extends ProfileClient>(client: T): T => {
  rooms.push(client.room);
  return client;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const stateOf = (viewer: ProfileClient, sessionId: string): any => viewer.room.state.players?.get(sessionId);
const visibleIds = (viewer: ProfileClient) => [...(viewer.room.state.players?.keys() ?? [])].sort();
const me = (client: ProfileClient) => stateOf(client, client.room.sessionId);
const characterIdOf = (client: ProfileClient) => client.profiles.find((p) => p.profile)!.profile!.characterId;

/** Sends an object interaction and waits for it to end; returns how it ended (or the refusal). */
async function act(client: ProfileClient, targetId: string, action: string): Promise<ActionUpdatePayload> {
  const from = client.actions.length;
  client.room.send(ClientMessage.Interact, { targetKind: "object", targetId, action });
  await waitFor(() => client.actions.length > from, 4000, `reply to ${action} ${targetId}`);
  if (client.actions[from]!.status === "rejected") return client.actions[from]!;
  const done = (u: ActionUpdatePayload) => u.action === action && ["completed", "failed", "cancelled"].includes(u.status);
  await waitFor(() => client.actions.slice(from).some(done), 15_000, `${action} ${targetId} ended`);
  return client.actions.slice(from).find(done)!;
}

async function goThrough(client: ProfileClient, door: string, area: string): Promise<void> {
  expect((await act(client, door, "enter")).status).toBe("completed");
  await waitFor(() => me(client)?.area === area, 4000, `${client.room.sessionId} in ${area}`);
}

const lifeOf = async (client: ProfileClient, predicate: (life: LifePayload) => boolean, what: string) => {
  await waitFor(() => client.lives.some(predicate), 6000, what);
  return [...client.lives].reverse().find(predicate)!;
};

describe("indoor rooms", () => {
  it("goes in through the hall's door; only players in the same area see each other", async () => {
    const ada = track(await joinWithNewCharacter(context.server.url, "Ada"));
    const ben = track(await joinWithNewCharacter(context.server.url, "Ben"));
    await waitFor(() => visibleIds(ada).length === 2 && visibleIds(ben).length === 2, 3000, "both on the square");
    expect(me(ada).area).toBe("plaza");

    await goThrough(ada, "hall-door", ROOM);
    // Inside, just in front of the room's door, facing into the room.
    expect(Math.abs(me(ada).z - 4.35)).toBeLessThan(0.01);
    expect(Math.cos(me(ada).rotation)).toBeLessThan(-0.99); // facing north, into the room
    await waitFor(() => visibleIds(ada).length === 1 && visibleIds(ben).length === 1, 3000, "out of each other's sight");
    expect(visibleIds(ada)).toEqual([ada.room.sessionId]);
    expect(visibleIds(ben)).toEqual([ben.room.sessionId]);

    await goThrough(ben, "hall-door", ROOM);
    await waitFor(() => visibleIds(ada).length === 2 && visibleIds(ben).length === 2, 3000, "together in the room");
    expect(stateOf(ben, ada.room.sessionId).area).toBe(ROOM);
  });

  it("studies at a lecture desk inside, then goes back out in front of the hall without walking-distance fitness for the jump", async () => {
    const cleo = track(await joinWithNewCharacter(context.server.url, "Cleo"));
    await goThrough(cleo, "hall-door", ROOM);
    const before = await lifeOf(cleo, () => true, "life");
    const fitnessAtArrival = before.skills.fitness.xp;
    expect((await act(cleo, "lecture-desk-1a", "study")).status).toBe("completed");
    const studied = await lifeOf(cleo, (l) => l.skills.academic.xp > before.skills.academic.xp, "academic XP");
    expect(studied.skills.academic.xp).toBeGreaterThan(0);

    await goThrough(cleo, "lecture-room-door", "plaza");
    // Out on the square in front of the hall's door, facing the square.
    expect(Math.abs(me(cleo).x - -13.615)).toBeLessThan(0.05);
    expect(Math.abs(me(cleo).z - -18.7)).toBeLessThan(0.05);
    expect(Math.cos(me(cleo).rotation)).toBeGreaterThan(0.99);
    await sleep(600);
    const after = cleo.lastLife()!;
    // About 30 m from the square to the desk and back; the jump through two doors would add over 50 m more.
    expect(after.skills.fitness.xp - fitnessAtArrival).toBeLessThan(2);
  });

  it("leads from the library's door to the reading room and back", async () => {
    const dan = track(await joinWithNewCharacter(context.server.url, "Dan"));
    await goThrough(dan, "library-door", "library/reading-room");
    expect((await act(dan, "reading-table-1", "sit")).status).toBe("completed");
    await goThrough(dan, "reading-room-door", "plaza");
  });

  it("never lets anyone greet, or see, a player in another area", async () => {
    const eve = track(await joinWithNewCharacter(context.server.url, "Eve"));
    const fay = track(await joinWithNewCharacter(context.server.url, "Fay"));
    await goThrough(eve, "hall-door", ROOM);
    const from = eve.actions.length;
    eve.room.send(ClientMessage.Interact, { targetKind: "player", targetId: fay.room.sessionId, action: "greet" });
    await waitFor(() => eve.actions.length > from, 3000, "greet answered");
    expect(eve.actions[from]).toMatchObject({ status: "rejected", reason: "unknown_target" });
    // Objects of another area don't exist either.
    expect(await act(eve, "bench-1", "sit")).toMatchObject({ status: "rejected", reason: "unknown_target" });
  });

  it("saves the room: leaving inside and coming back puts you inside; an unknown saved area puts you on the square", async () => {
    const gil = await joinWithNewCharacter(context.server.url, "Gil");
    await goThrough(gil, "hall-door", ROOM);
    const inside = { x: me(gil).x, z: me(gil).z };
    const id = characterIdOf(gil);
    await gil.room.leave(true);
    await sleep(400);
    const saved = await context.server.db.query<{ area: string }>(`SELECT area FROM character_state WHERE character_id = $1`, [id]);
    expect(saved.rows[0]!.area).toBe(ROOM);

    const back = await connectAndPlay(context.server.url, gil.guestToken);
    await waitFor(() => me(back)?.area === ROOM, 3000, "back inside");
    expect(Math.hypot(me(back).x - inside.x, me(back).z - inside.z)).toBeLessThan(0.05);
    await back.room.leave(true);
    await sleep(400);

    await context.server.db.query(`UPDATE character_state SET area = 'gone/room' WHERE character_id = $1`, [id]);
    const again = track(await connectAndPlay(context.server.url, gil.guestToken));
    await waitFor(() => me(again)?.area === "plaza", 3000, "on the square");
    expect(me(again).z).toBeGreaterThan(10); // a square spawn point, not the room's coordinates
  });

  it("keeps a dropped player in the room and shows it again to the others after it reconnects", async () => {
    const hal = track(await joinWithNewCharacter(context.server.url, "Hal"));
    const ivy = track(await joinWithNewCharacter(context.server.url, "Ivy"));
    await goThrough(hal, "hall-door", ROOM);
    await goThrough(ivy, "hall-door", ROOM);
    await waitFor(() => visibleIds(ivy).length === 2, 3000, "Ivy sees Hal");
    hal.room.reconnection.minUptime = 0;
    const reconnected = new Promise<void>((resolve) => hal.room.onReconnect(() => resolve()));
    hal.room.connection.close(4010, "simulated network drop");
    await reconnected;
    await waitFor(() => stateOf(ivy, hal.room.sessionId)?.connected === true, 4000, "Hal back for Ivy");
    await waitFor(() => visibleIds(hal).length === 2 && me(hal)?.area === ROOM, 4000, "Hal sees the room again");
  });
});
