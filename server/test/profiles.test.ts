// M4 identity and persistence through the real room and real database
// (in-memory PGlite), driven by real WebSocket clients.

import type { Room } from "@colyseus/sdk";
import {
  CLOSE_SIGNED_IN_ELSEWHERE,
  ClientMessage,
  DEFAULT_APPEARANCE,
  ERROR_INVALID_GUEST_TOKEN,
  GAME_CONFIG,
  PLAZA_LAYOUT,
  PROFILE_VERSION,
  findSeat,
  isPositionWalkable,
} from "@padova/shared";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { isWellFormedGuestToken } from "../src/identity/guestIdentity.ts";
import type { Database } from "../src/db/database.ts";
import { connect, joinWithNewCharacter, sleep, startTestServer, waitFor, type ProfileClient, type TestServer } from "./helpers/gameClient.ts";
import { migratedTestDatabase } from "./helpers/testDatabase.ts";

const count = async (server: TestServer, table: string) =>
  (await server.db.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${table}`)).rows[0]!.n;

function useProfileServer(port: number, tuning = {}) {
  const context = { server: undefined as unknown as TestServer };
  const rooms: Room[] = [];
  beforeAll(async () => {
    context.server = await startTestServer(port, { walkSpeed: 9, ...tuning });
  });
  afterEach(async () => {
    await Promise.all(rooms.splice(0).map((room) => Promise.race([room.leave(true).catch(() => undefined), sleep(500)])));
    await sleep(200);
  });
  afterAll(async () => {
    await context.server.stop();
  });
  const track = <T extends ProfileClient>(client: T): T => {
    rooms.push(client.room);
    return client;
  };
  return { context, track };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const playerIn = (client: ProfileClient, id: string): any => client.room.state.players.get(id);

describe("character profiles", () => {
  const { context, track } = useProfileServer(2616);

  it("treats a first visit as anonymous: nothing is stored and nobody is placed in the world", async () => {
    const accountsBefore = await count(context.server, "accounts");
    const visitor = track(await connect(context.server.url));
    expect(visitor.lastProfile()).toEqual({ status: "needs_character" });
    await sleep(200);
    expect(visitor.room.state.players.size).toBe(0);
    expect(await count(context.server, "accounts")).toBe(accountsBefore);
  });

  it("creates a character: guest token issued once, profile returned, others see the appearance", async () => {
    const watcher = track(await joinWithNewCharacter(context.server.url, "Watcher"));
    const appearance = { ...DEFAULT_APPEARANCE, preset: "male", skinTone: "skin-6", hairColour: "teal", outfit: "hoodie-navy" };
    const alice = track(await joinWithNewCharacter(context.server.url, "  Alice   R. ", appearance));
    expect(alice.identities).toHaveLength(1);
    expect(isWellFormedGuestToken(alice.guestToken)).toBe(true);
    const profile = alice.lastProfile()!.profile!;
    expect(profile).toMatchObject({ displayName: "Alice R.", ageCategory: "adult", appearance, profileVersion: PROFILE_VERSION });
    expect(profile.characterId).toMatch(/^[0-9a-f-]{36}$/);
    expect(Date.parse(profile.createdAt)).not.toBeNaN();
    expect(JSON.stringify(alice.lastProfile())).not.toContain(alice.guestToken); // the token is never echoed in profile data
    await waitFor(() => playerIn(watcher, alice.room.sessionId) !== undefined, 3000, "watcher sees Alice");
    expect(playerIn(watcher, alice.room.sessionId)).toMatchObject({ name: "Alice R.", preset: "male", skinTone: "skin-6", hairColour: "teal", outfit: "hoodie-navy" });
  });

  it("refuses invalid characters and keeps the visitor anonymous", async () => {
    const visitor = track(await connect(context.server.url));
    const send = (payload: unknown) => visitor.room.send(ClientMessage.CreateCharacter, payload);
    send({ displayName: "Teo", ageCategory: "teen", appearance: DEFAULT_APPEARANCE });
    send({ displayName: "Teo", ageCategory: "adult", appearance: { ...DEFAULT_APPEARANCE, outfit: "spacesuit" } });
    send("Teo");
    send({ displayName: "Teo", ageCategory: "adult" });
    await waitFor(() => visitor.errors.length === 4, 3000, "four rejections");
    expect(visitor.errors.map((e) => e.reason)).toEqual(["age_category_not_allowed", "invalid_appearance", "invalid_payload", "invalid_appearance"]);
    expect(visitor.errors[1]).toMatchObject({ field: "outfit" });
    expect(visitor.identities).toHaveLength(0);
    expect(visitor.room.state.players.get(visitor.room.sessionId)).toBeUndefined();
  });

  it("does not let a player create a second character", async () => {
    const alice = track(await joinWithNewCharacter(context.server.url, "Alice"));
    alice.room.send(ClientMessage.CreateCharacter, { displayName: "Second", ageCategory: "adult", appearance: DEFAULT_APPEARANCE });
    await waitFor(() => alice.errors.length === 1, 3000, "rejection");
    expect(alice.errors[0]).toMatchObject({ reason: "already_has_character" });
  });

  it("loads the same character on a later visit, at the saved position", async () => {
    const first = await joinWithNewCharacter(context.server.url, "Bruno");
    const characterId = first.lastProfile()!.profile!.characterId;
    first.room.send(ClientMessage.MoveTo, { x: -7, z: 11 });
    await waitFor(() => {
      const me = playerIn(first, first.room.sessionId);
      return Math.hypot(me.x + 7, me.z - 11) < 0.1 && !me.moving;
    }, 6000, "walked");
    await first.room.leave(true);
    await sleep(300);

    const again = track(await connect(context.server.url, { guestToken: first.guestToken }));
    expect(again.lastProfile()).toMatchObject({ status: "ready", profile: { characterId, displayName: "Bruno" } });
    expect(again.identities).toHaveLength(0); // no new account
    await waitFor(() => playerIn(again, again.room.sessionId) !== undefined, 3000, "spawned");
    const me = playerIn(again, again.room.sessionId);
    expect(me.x).toBeCloseTo(-7, 1);
    expect(me.z).toBeCloseTo(11, 1);
  });

  it("refuses an unknown or malformed guest token instead of silently starting over", async () => {
    const real = await joinWithNewCharacter(context.server.url, "Carla");
    track(real);
    const forged = real.guestToken.slice(0, -2) + (real.guestToken.endsWith("AA") ? "BB" : "AA");
    for (const guestToken of [forged, "plsg1_short", 12345 as unknown as string]) {
      await expect(connect(context.server.url, { guestToken })).rejects.toMatchObject({ code: ERROR_INVALID_GUEST_TOKEN });
    }
  });

  it("saves appearance changes, replicates them, and keeps them across visits", async () => {
    const watcher = track(await joinWithNewCharacter(context.server.url, "Watcher"));
    const dario = await joinWithNewCharacter(context.server.url, "Dario");
    const changed = { ...DEFAULT_APPEARANCE, hairStyle: "bun", hairColour: "rose", eyeColour: "violet" };
    const before = dario.profiles.length;
    dario.room.send(ClientMessage.UpdateAppearance, { appearance: changed });
    await waitFor(() => dario.profiles.length > before, 3000, "updated profile");
    expect(dario.lastProfile()!.profile!.appearance).toEqual(changed);
    await waitFor(() => playerIn(watcher, dario.room.sessionId)?.hairColour === "rose", 3000, "replicated");
    await dario.room.leave(true);
    await sleep(300);
    const again = track(await connect(context.server.url, { guestToken: dario.guestToken }));
    expect(again.lastProfile()!.profile!.appearance).toEqual(changed);
  });

  it("rejects invalid appearance and appearance changes before a character exists", async () => {
    const elena = track(await joinWithNewCharacter(context.server.url, "Elena"));
    elena.room.send(ClientMessage.UpdateAppearance, { appearance: { ...DEFAULT_APPEARANCE, skinTone: "green" } });
    elena.room.send(ClientMessage.UpdateAppearance, "pink");
    await waitFor(() => elena.errors.length === 2, 3000, "rejections");
    expect(elena.errors.map((e) => [e.reason, e.field])).toEqual([["invalid_appearance", "skinTone"], ["invalid_appearance", undefined]]);
    const visitor = track(await connect(context.server.url));
    visitor.room.send(ClientMessage.UpdateAppearance, { appearance: DEFAULT_APPEARANCE });
    await waitFor(() => visitor.errors.length === 1, 3000, "visitor rejection");
    expect(visitor.errors[0]).toMatchObject({ reason: "no_character" });
  });

  it("never lets one player change another player's profile", async () => {
    const alice = track(await joinWithNewCharacter(context.server.url, "Alice"));
    const bruno = track(await joinWithNewCharacter(context.server.url, "Bruno"));
    const aliceId = alice.lastProfile()!.profile!.characterId;
    const before = bruno.profiles.length;
    // Bruno names Alice's character id (and invents an owner) in his request.
    bruno.room.send(ClientMessage.UpdateAppearance, {
      characterId: aliceId,
      accountId: "someone-else",
      appearance: { ...DEFAULT_APPEARANCE, hairColour: "silver" },
    });
    await waitFor(() => bruno.profiles.length > before, 3000, "Bruno's update");
    expect(bruno.lastProfile()!.profile!.characterId).not.toBe(aliceId);
    expect(bruno.lastProfile()!.profile!.appearance.hairColour).toBe("silver");
    const stored = await context.server.db.query<{ hair_colour: string }>("SELECT hair_colour FROM character_appearance WHERE character_id = $1", [aliceId]);
    expect(stored.rows[0]!.hair_colour).toBe(DEFAULT_APPEARANCE.hairColour);
  });

  it("lets only the newest session play an account: the older window is saved and disconnected", async () => {
    const first = await joinWithNewCharacter(context.server.url, "Fabio");
    const firstLeft = new Promise<number>((resolve) => first.room.onLeave((code) => resolve(code)));
    const watcher = track(await joinWithNewCharacter(context.server.url, "Watcher"));
    const second = track(await connect(context.server.url, { guestToken: first.guestToken }));
    expect(await firstLeft).toBe(CLOSE_SIGNED_IN_ELSEWHERE);
    expect(second.lastProfile()).toMatchObject({ status: "ready", profile: { displayName: "Fabio" } });
    await waitFor(() => !watcher.room.state.players.has(first.room.sessionId), 3000, "old session removed");
    const fabios = [...watcher.room.state.players.values()].filter((p: any) => p.name === "Fabio");
    expect(fabios).toHaveLength(1);
  });

  it("keeps the same character through a brief network drop", async () => {
    const gina = track(await joinWithNewCharacter(context.server.url, "Gina"));
    const sessionId = gina.room.sessionId;
    const characterId = gina.lastProfile()!.profile!.characterId;
    gina.room.reconnection.minUptime = 0;
    const reconnected = new Promise<void>((resolve) => gina.room.onReconnect(() => resolve()));
    gina.room.connection.close(4010, "simulated drop");
    await reconnected;
    expect(gina.room.sessionId).toBe(sessionId);
    await waitFor(() => playerIn(gina, sessionId)?.connected === true, 3000, "connected again");
    expect(await count(context.server, `characters WHERE id = '${characterId}'`)).toBe(1);
    expect([...gina.room.state.players.values()].filter((p: any) => p.name === "Gina")).toHaveLength(1);
  });

  it("saves a seated character at the spot it stands up to", async () => {
    const hana = await joinWithNewCharacter(context.server.url, "Hana");
    const characterId = hana.lastProfile()!.profile!.characterId;
    hana.room.send(ClientMessage.Interact, { targetKind: "object", targetId: "bench-2", action: "sit" });
    await waitFor(() => (playerIn(hana, hana.room.sessionId)?.seatId ?? "") !== "", 8000, "seated");
    const seatId = playerIn(hana, hana.room.sessionId).seatId as string;
    await hana.room.leave(true);
    await sleep(300);
    const saved = await context.server.db.query<{ pos_x: number; pos_z: number }>("SELECT pos_x, pos_z FROM character_state WHERE character_id = $1", [characterId]);
    const approach = findSeat(PLAZA_LAYOUT, seatId)!.seat.approach;
    expect(saved.rows[0]!.pos_x).toBeCloseTo(approach.x, 3);
    expect(saved.rows[0]!.pos_z).toBeCloseTo(approach.z, 3);
    expect(isPositionWalkable(PLAZA_LAYOUT, saved.rows[0]!.pos_x, saved.rows[0]!.pos_z, GAME_CONFIG.playerRadius)).toBe(true);
  });
});

describe("outdated and unexpected stored data", () => {
  const { context, track } = useProfileServer(2617);

  it("repairs retired appearance options on load and saves the repair", async () => {
    const ivo = await joinWithNewCharacter(context.server.url, "Ivo");
    const characterId = ivo.lastProfile()!.profile!.characterId;
    await ivo.room.leave(true);
    await sleep(300);
    await context.server.db.query("UPDATE character_appearance SET hair_style = 'mohawk-retired', outfit = '' WHERE character_id = $1", [characterId]);

    const again = track(await connect(context.server.url, { guestToken: ivo.guestToken }));
    const payload = again.lastProfile()!;
    expect(payload.profile!.appearance).toMatchObject({ hairStyle: DEFAULT_APPEARANCE.hairStyle, outfit: DEFAULT_APPEARANCE.outfit });
    expect(payload.notices?.length).toBe(2);
    expect(payload.readOnly).toBe(false);
    const stored = await context.server.db.query<{ hair_style: string; outfit: string }>("SELECT hair_style, outfit FROM character_appearance WHERE character_id = $1", [characterId]);
    expect(stored.rows[0]).toEqual({ hair_style: DEFAULT_APPEARANCE.hairStyle, outfit: DEFAULT_APPEARANCE.outfit });
  });

  it("loads a profile from a newer version read-only and never overwrites it", async () => {
    const jun = await joinWithNewCharacter(context.server.url, "Jun");
    const characterId = jun.lastProfile()!.profile!.characterId;
    await jun.room.leave(true);
    await sleep(300);
    await context.server.db.query("UPDATE characters SET profile_version = $2 WHERE id = $1", [characterId, PROFILE_VERSION + 98]);
    await context.server.db.query("UPDATE character_appearance SET eye_colour = 'starlight' WHERE character_id = $1", [characterId]);

    const again = track(await connect(context.server.url, { guestToken: jun.guestToken }));
    expect(again.lastProfile()).toMatchObject({ status: "ready", readOnly: true, profile: { displayName: "Jun" } });
    expect(again.lastProfile()!.profile!.appearance.eyeColour).toBe(DEFAULT_APPEARANCE.eyeColour); // safe copy in memory
    again.room.send(ClientMessage.UpdateAppearance, { appearance: DEFAULT_APPEARANCE });
    await waitFor(() => again.errors.length === 1, 3000, "rejection");
    expect(again.errors[0]).toMatchObject({ reason: "profile_newer_version" });
    const stored = await context.server.db.query<{ profile_version: number; eye_colour: string }>(
      "SELECT c.profile_version, a.eye_colour FROM characters c JOIN character_appearance a ON a.character_id = c.id WHERE c.id = $1",
      [characterId],
    );
    expect(stored.rows[0]).toEqual({ profile_version: PROFILE_VERSION + 98, eye_colour: "starlight" });
  });
});

describe("guest creation limit", () => {
  const { context, track } = useProfileServer(2618, { guestCreationsPerIpPerHour: 2 });

  it("limits how many guest accounts one address can create", async () => {
    track(await joinWithNewCharacter(context.server.url, "One"));
    track(await joinWithNewCharacter(context.server.url, "Two"));
    const third = track(await connect(context.server.url));
    third.room.send(ClientMessage.CreateCharacter, { displayName: "Three", ageCategory: "adult", appearance: DEFAULT_APPEARANCE });
    await waitFor(() => third.errors.length === 1, 3000, "rejection");
    expect(third.errors[0]).toMatchObject({ reason: "rate_limited" });
    expect(third.identities).toHaveLength(0);
  });
});

describe("autosave", () => {
  const { context, track } = useProfileServer(2619, { autosaveIntervalMs: 300 });

  it("saves the position of players who are still online", async () => {
    const kai = track(await joinWithNewCharacter(context.server.url, "Kai"));
    const characterId = kai.lastProfile()!.profile!.characterId;
    kai.room.send(ClientMessage.MoveTo, { x: 5, z: 10 });
    await waitFor(() => {
      const me = playerIn(kai, kai.room.sessionId);
      return Math.hypot(me.x - 5, me.z - 10) < 0.1 && !me.moving;
    }, 6000, "walked");
    const savedAt = async () =>
      (await context.server.db.query<{ pos_x: number; pos_z: number }>("SELECT pos_x, pos_z FROM character_state WHERE character_id = $1", [characterId])).rows[0]!;
    const deadline = Date.now() + 3000;
    let saved = await savedAt();
    while (Math.hypot(saved.pos_x - 5, saved.pos_z - 10) > 0.1 && Date.now() < deadline) {
      await sleep(100);
      saved = await savedAt();
    }
    expect(saved.pos_x).toBeCloseTo(5, 1);
    expect(saved.pos_z).toBeCloseTo(10, 1);
    expect(playerIn(kai, kai.room.sessionId)).toBeDefined(); // still online: this was an autosave, not a save on leave
  });
});

describe("leaving and coming straight back", () => {
  // Regression test: a reload used to load the character from the database
  // before the closing tab's final position save had finished, putting the
  // player back at their previous saved spot. Saves are slowed down here so
  // the race happens every time.
  const SAVE_DELAY_MS = 400;
  const context = { server: undefined as unknown as TestServer };
  const rooms: Room[] = [];
  beforeAll(async () => {
    const db = await migratedTestDatabase();
    const slowSaves: Database = Object.assign(Object.create(db) as Database, {
      async query(sql: string, params?: unknown[]) {
        if (sql.includes("INSERT INTO character_state") && sql.includes("ON CONFLICT")) await sleep(SAVE_DELAY_MS);
        return db.query(sql, params);
      },
    });
    context.server = await startTestServer(2620, { walkSpeed: 9 }, slowSaves);
  });
  afterEach(async () => {
    await Promise.all(rooms.splice(0).map((room) => Promise.race([room.leave(true).catch(() => undefined), sleep(500)])));
  });
  afterAll(async () => {
    await context.server.stop();
  });

  it("loads the position saved by the session that just left, not an older one", async () => {
    const first = await joinWithNewCharacter(context.server.url, "Elena");
    rooms.push(first.room);
    first.room.send(ClientMessage.MoveTo, { x: -7, z: 11 });
    await waitFor(() => {
      const me = playerIn(first, first.room.sessionId);
      return Math.hypot(me.x + 7, me.z - 11) < 0.1 && !me.moving;
    }, 6000, "walked");
    // Leave and immediately come back, like a page reload: no waiting for the save.
    void first.room.leave(true);
    const again = await connect(context.server.url, { guestToken: first.guestToken });
    rooms.push(again.room);
    await waitFor(() => playerIn(again, again.room.sessionId) !== undefined, 4000, "spawned");
    const me = playerIn(again, again.room.sessionId);
    expect(Math.hypot(me.x + 7, me.z - 11)).toBeLessThan(0.1);
  });

  it("does the same when the new session arrives before the old one has left", async () => {
    const first = await joinWithNewCharacter(context.server.url, "Fabio");
    rooms.push(first.room);
    first.room.send(ClientMessage.MoveTo, { x: 5, z: 10 });
    await waitFor(() => {
      const me = playerIn(first, first.room.sessionId);
      return Math.hypot(me.x - 5, me.z - 10) < 0.1 && !me.moving;
    }, 6000, "walked");
    const again = await connect(context.server.url, { guestToken: first.guestToken });
    rooms.push(again.room);
    await waitFor(() => playerIn(again, again.room.sessionId) !== undefined, 4000, "spawned");
    const me = playerIn(again, again.room.sessionId);
    expect(Math.hypot(me.x - 5, me.z - 10)).toBeLessThan(0.1);
  });
});
