// M4 identity and persistence through the real room and real database
// (in-memory PGlite), driven by real WebSocket clients.

import type { Room } from "@colyseus/sdk";
import {
  APPEARANCE_PRESETS,
  CLOSE_SIGNED_IN_ELSEWHERE,
  ClientMessage,
  DEFAULT_APPEARANCE,
  ERROR_INVALID_GUEST_TOKEN,
  GAME_CONFIG,
  PLAZA_LAYOUT,
  PROFILE_VERSION,
  cloneAppearance,
  decodeLook,
  findSeat,
  isPositionWalkable,
  type AppearanceConfig,
} from "@padova/shared";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { isWellFormedGuestToken } from "../src/identity/guestIdentity.ts";
import type { Database } from "../src/db/database.ts";
import { connect, connectAndPlay, enterWorld, joinWithNewCharacter, sleep, startTestServer, waitFor, type ProfileClient, type TestServer } from "./helpers/gameClient.ts";
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
/** The appearance another client sees for a player, decoded from the replicated look string. */
const lookIn = (client: ProfileClient, id: string): AppearanceConfig | undefined => {
  const look = playerIn(client, id)?.look as string | undefined;
  return look ? decodeLook(look).appearance : undefined;
};
const preset = (id: string) => APPEARANCE_PRESETS.find((p) => p.id === id)!.appearance;
/** A copy of the default appearance with one field changed (any value, even an invalid one). */
const withField = (section: string, field: string, value: unknown) => {
  const config = cloneAppearance(DEFAULT_APPEARANCE) as unknown as Record<string, Record<string, unknown>>;
  config[section]![field] = value;
  return config;
};

describe("character profiles", () => {
  const { context, track } = useProfileServer(2616);

  it("treats a first visit as anonymous: nothing is stored and nobody is placed in the world", async () => {
    const accountsBefore = await count(context.server, "accounts");
    const visitor = track(await connect(context.server.url));
    expect(visitor.lastProfile()).toEqual({ status: "lobby", characters: [], maxCharacters: 3 });
    await sleep(200);
    expect(visitor.room.state.players.size).toBe(0);
    expect(await count(context.server, "accounts")).toBe(accountsBefore);
  });

  it("creates a character: guest token issued once, profile returned, others see the appearance", async () => {
    const watcher = track(await joinWithNewCharacter(context.server.url, "Watcher"));
    const appearance = preset("locs-beard");
    const alice = track(await joinWithNewCharacter(context.server.url, "  Alice   R. ", appearance));
    expect(alice.identities).toHaveLength(1);
    expect(isWellFormedGuestToken(alice.guestToken)).toBe(true);
    const profile = alice.lastProfile()!.profile!;
    expect(profile).toMatchObject({ displayName: "Alice R.", ageCategory: "adult", appearance, profileVersion: PROFILE_VERSION });
    expect(profile.characterId).toMatch(/^[0-9a-f-]{36}$/);
    expect(Date.parse(profile.createdAt)).not.toBeNaN();
    expect(JSON.stringify(alice.lastProfile())).not.toContain(alice.guestToken); // the token is never echoed in profile data
    await waitFor(() => playerIn(watcher, alice.room.sessionId) !== undefined, 3000, "watcher sees Alice");
    expect(playerIn(watcher, alice.room.sessionId)).toMatchObject({ name: "Alice R." });
    expect(lookIn(watcher, alice.room.sessionId)).toEqual(appearance);
  });

  it("refuses invalid characters and keeps the visitor anonymous", async () => {
    const visitor = track(await connect(context.server.url));
    const send = (payload: unknown) => visitor.room.send(ClientMessage.CreateCharacter, payload);
    send({ displayName: "Teo", ageCategory: "teen", appearance: DEFAULT_APPEARANCE });
    send({ displayName: "Teo", ageCategory: "adult", appearance: withField("outfit", "top", "spacesuit") });
    send("Teo");
    send({ displayName: "Teo", ageCategory: "adult" });
    await waitFor(() => visitor.errors.length === 4, 3000, "four rejections");
    expect(visitor.errors.map((e) => e.reason)).toEqual(["age_category_not_allowed", "invalid_appearance", "invalid_payload", "invalid_appearance"]);
    expect(visitor.errors[1]).toMatchObject({ field: "outfit.top" });
    expect(visitor.identities).toHaveLength(0);
    expect(visitor.room.state.players.get(visitor.room.sessionId)).toBeUndefined();
  });

  it("does not create or enter another character while one is in the world", async () => {
    const alice = track(await joinWithNewCharacter(context.server.url, "Alice"));
    alice.room.send(ClientMessage.CreateCharacter, { displayName: "Second", ageCategory: "adult", appearance: DEFAULT_APPEARANCE, traits: [] });
    alice.room.send(ClientMessage.EnterWorld, { characterId: alice.lastProfile()!.profile!.characterId });
    await waitFor(() => alice.errors.length === 2, 3000, "rejections");
    expect(alice.errors.map((e) => [e.action, e.reason])).toEqual([["createCharacter", "in_world"], ["enterWorld", "in_world"]]);
    expect(await count(context.server, "characters WHERE display_name = 'Second'")).toBe(0);
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
    // The title screen first: the character is listed but not in the world yet.
    const lobby = again.lastProfile()!;
    expect(lobby).toMatchObject({ status: "lobby", maxCharacters: 3, characters: [{ characterId, displayName: "Bruno", readOnly: false, notices: [] }] });
    expect(decodeLook(lobby.characters![0]!.look).appearance).toEqual(DEFAULT_APPEARANCE);
    expect(Date.parse(lobby.characters![0]!.lastPlayedAt!)).not.toBeNaN();
    expect(JSON.stringify(lobby)).not.toContain("balance"); // life data is not part of the title screen
    await sleep(200);
    expect(playerIn(again, again.room.sessionId)).toBeUndefined();
    await enterWorld(again, characterId);
    expect(again.lastProfile()).toMatchObject({ status: "ready", profile: { characterId, displayName: "Bruno" } });
    expect(again.identities).toHaveLength(0); // no new account
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
    const changed = preset("lavender-ponytail");
    const before = dario.profiles.length;
    dario.room.send(ClientMessage.UpdateAppearance, { appearance: changed });
    await waitFor(() => dario.profiles.length > before, 3000, "updated profile");
    expect(dario.lastProfile()!.profile!.appearance).toEqual(changed);
    await waitFor(() => lookIn(watcher, dario.room.sessionId)?.hair.colour === "lavender", 3000, "replicated");
    expect(lookIn(watcher, dario.room.sessionId)).toEqual(changed);
    await dario.room.leave(true);
    await sleep(300);
    const again = track(await connect(context.server.url, { guestToken: dario.guestToken }));
    expect(decodeLook(again.lastProfile()!.characters![0]!.look).appearance).toEqual(changed);
    await enterWorld(again);
    expect(again.lastProfile()!.profile!.appearance).toEqual(changed);
  });

  it("rejects invalid appearance and appearance changes before a character exists", async () => {
    const elena = track(await joinWithNewCharacter(context.server.url, "Elena"));
    elena.room.send(ClientMessage.UpdateAppearance, { appearance: withField("skin", "tone", "green") });
    elena.room.send(ClientMessage.UpdateAppearance, { appearance: withField("body", "height", 1.5) });
    elena.room.send(ClientMessage.UpdateAppearance, { appearance: { ...cloneAppearance(DEFAULT_APPEARANCE), v: 99 } });
    elena.room.send(ClientMessage.UpdateAppearance, "pink");
    await waitFor(() => elena.errors.length === 4, 3000, "rejections");
    expect(elena.errors.map((e) => [e.reason, e.field])).toEqual([
      ["invalid_appearance", "skin.tone"],
      ["invalid_appearance", "body.height"],
      ["invalid_appearance", "v"],
      ["invalid_appearance", "appearance"],
    ]);
    const visitor = track(await connect(context.server.url));
    visitor.room.send(ClientMessage.UpdateAppearance, { appearance: DEFAULT_APPEARANCE });
    await waitFor(() => visitor.errors.length === 1, 3000, "visitor rejection");
    expect(visitor.errors[0]).toMatchObject({ reason: "character_not_found" });
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
      appearance: preset("silver-buzz"),
    });
    await waitFor(() => bruno.profiles.length > before, 3000, "Bruno's update");
    expect(bruno.lastProfile()!.profile!.characterId).not.toBe(aliceId);
    expect(bruno.lastProfile()!.profile!.appearance.hair.colour).toBe("silver");
    const stored = await context.server.db.query<{ config: unknown }>("SELECT config FROM character_appearance WHERE character_id = $1", [aliceId]);
    expect(stored.rows[0]!.config).toEqual(DEFAULT_APPEARANCE);
  });

  it("lets only the newest session play an account: the older window is saved and disconnected", async () => {
    const first = await joinWithNewCharacter(context.server.url, "Fabio");
    let firstClosed: number | null = null;
    const firstLeft = new Promise<number>((resolve) => first.room.onLeave((code) => resolve((firstClosed = code))));
    const watcher = track(await joinWithNewCharacter(context.server.url, "Watcher"));
    const second = track(await connect(context.server.url, { guestToken: first.guestToken }));
    // Only looking at the title screen in a second window doesn't disconnect the first one.
    await sleep(300);
    expect(firstClosed).toBeNull();
    expect(playerIn(watcher, first.room.sessionId)).toBeDefined();
    await enterWorld(second);
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

  it("removes a dropped player who never returns once the reconnection window ends, saved and free to play again", async () => {
    const watcher = track(await joinWithNewCharacter(context.server.url, "Wanda"));
    const ivo = await joinWithNewCharacter(context.server.url, "Ivo");
    const sessionId = ivo.room.sessionId;
    const characterId = ivo.lastProfile()!.profile!.characterId;
    ivo.room.send(ClientMessage.MoveTo, { x: 3, z: 14 });
    await waitFor(() => {
      const seen = playerIn(watcher, sessionId);
      return seen && Math.hypot(seen.x - 3, seen.z - 14) < 0.1 && !seen.moving;
    }, 8000, "Ivo walked");
    // A drop the client never recovers from (a phone switched off): no automatic reconnection.
    ivo.room.reconnection.enabled = false;
    ivo.room.connection.close(4010, "simulated drop, no return");
    await waitFor(() => playerIn(watcher, sessionId)?.connected === false, 3000, "shown as dropped");
    await waitFor(() => playerIn(watcher, sessionId) === undefined, (GAME_CONFIG.reconnectSeconds + 6) * 1000, "removed when the window ends");
    const saved = (await context.server.db.query<{ pos_x: number; pos_z: number }>("SELECT pos_x, pos_z FROM character_state WHERE character_id = $1", [characterId])).rows[0]!;
    expect(Math.hypot(saved.pos_x - 3, saved.pos_z - 14)).toBeLessThan(0.1);
    // The account is free again: the same guest token plays the character, once.
    const back = track(await connectAndPlay(context.server.url, ivo.guestToken, characterId));
    expect(back.lastProfile()!.profile!.characterId).toBe(characterId);
    await waitFor(() => [...watcher.room.state.players.values()].filter((p: any) => p.name === "Ivo").length === 1, 3000, "exactly one Ivo");
  }, (GAME_CONFIG.reconnectSeconds + 25) * 1000);

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
    const ivo = await joinWithNewCharacter(context.server.url, "Ivo", preset("rounded-afro"));
    const characterId = ivo.lastProfile()!.profile!.characterId;
    await ivo.room.leave(true);
    await sleep(300);
    await context.server.db.query(
      `UPDATE character_appearance
          SET config = jsonb_set(jsonb_set(config, '{hair,style}', '"mohawk-retired"'), '{outfit,shoes}', '42')
        WHERE character_id = $1`,
      [characterId],
    );

    const again = track(await connect(context.server.url, { guestToken: ivo.guestToken }));
    const summary = again.lastProfile()!.characters![0]!;
    const expected = cloneAppearance(preset("rounded-afro"));
    expected.hair.style = DEFAULT_APPEARANCE.hair.style;
    expected.outfit.shoes = DEFAULT_APPEARANCE.outfit.shoes;
    expect(decodeLook(summary.look).appearance).toEqual(expected); // only the broken fields fall back
    // The title screen tells the player what changed.
    expect(summary.notices).toEqual(["Some hair and outfit options you chose are no longer available, so defaults were chosen. You can change them any time."]);
    expect(summary.readOnly).toBe(false);
    await enterWorld(again);
    expect(again.lastProfile()!.profile!.appearance).toEqual(expected);
    const stored = await context.server.db.query<{ config: unknown }>("SELECT config FROM character_appearance WHERE character_id = $1", [characterId]);
    expect(stored.rows[0]!.config).toEqual(expected);
  });

  it("upgrades an M5 character (profile version 2) on load, keeping its look, and saves the new document", async () => {
    const kim = await joinWithNewCharacter(context.server.url, "Kim");
    const characterId = kim.lastProfile()!.profile!.characterId;
    await kim.room.leave(true);
    await sleep(300);
    // Exactly what the M5 server left behind: version 2, the six flat columns, no document.
    await context.server.db.query("UPDATE characters SET profile_version = 2 WHERE id = $1", [characterId]);
    await context.server.db.query(
      `UPDATE character_appearance SET preset = 'male', skin_tone = 'skin-7', hair_style = 'bun', hair_colour = 'teal',
              eye_colour = 'green', outfit = 'jacket-olive', config = NULL WHERE character_id = $1`,
      [characterId],
    );
    const watcher = track(await joinWithNewCharacter(context.server.url, "Watcher"));
    const again = track(await connectAndPlay(context.server.url, kim.guestToken));
    const profile = again.lastProfile()!.profile!;
    expect(profile.profileVersion).toBe(PROFILE_VERSION);
    expect(profile.appearance).toMatchObject({
      body: { frame: "masculine" },
      skin: { tone: 0.86 },
      hair: { style: "top-bun", colour: "teal" },
      face: { eyeColour: "green" },
      outfit: { outer: "denim-jacket", outerColour: "olive" },
    });
    expect(again.lastProfile()!.notices ?? []).toEqual([]);
    const stored = await context.server.db.query<{ profile_version: number; config: unknown }>(
      "SELECT c.profile_version, a.config FROM characters c JOIN character_appearance a ON a.character_id = c.id WHERE c.id = $1",
      [characterId],
    );
    expect(stored.rows[0]).toEqual({ profile_version: PROFILE_VERSION, config: profile.appearance });
    await waitFor(() => lookIn(watcher, again.room.sessionId) !== undefined, 3000, "watcher sees Kim");
    expect(lookIn(watcher, again.room.sessionId)).toEqual(profile.appearance);
  });

  it("loads a profile from a newer version read-only and never overwrites it", async () => {
    const jun = await joinWithNewCharacter(context.server.url, "Jun");
    const characterId = jun.lastProfile()!.profile!.characterId;
    await jun.room.leave(true);
    await sleep(300);
    await context.server.db.query("UPDATE characters SET profile_version = $2 WHERE id = $1", [characterId, PROFILE_VERSION + 98]);
    await context.server.db.query(`UPDATE character_appearance SET config = jsonb_set(config, '{face,eyeColour}', '"starlight"') WHERE character_id = $1`, [characterId]);

    const again = track(await connect(context.server.url, { guestToken: jun.guestToken }));
    expect(again.lastProfile()!.characters![0]).toMatchObject({ displayName: "Jun", readOnly: true });
    // Its look can't be changed from the title screen either.
    again.room.send(ClientMessage.UpdateAppearance, { characterId, appearance: DEFAULT_APPEARANCE });
    await waitFor(() => again.errors.length === 1, 3000, "title screen rejection");
    expect(again.errors[0]).toMatchObject({ reason: "profile_newer_version" });
    again.errors.length = 0;
    await enterWorld(again);
    expect(again.lastProfile()).toMatchObject({ status: "ready", readOnly: true, profile: { displayName: "Jun" } });
    expect(again.lastProfile()!.profile!.appearance.face.eyeColour).toBe(DEFAULT_APPEARANCE.face.eyeColour); // safe copy in memory
    again.room.send(ClientMessage.UpdateAppearance, { appearance: DEFAULT_APPEARANCE });
    await waitFor(() => again.errors.length === 1, 3000, "rejection");
    expect(again.errors[0]).toMatchObject({ reason: "profile_newer_version" });
    const stored = await context.server.db.query<{ profile_version: number; eye: string }>(
      "SELECT c.profile_version, a.config->'face'->>'eyeColour' AS eye FROM characters c JOIN character_appearance a ON a.character_id = c.id WHERE c.id = $1",
      [characterId],
    );
    expect(stored.rows[0]).toEqual({ profile_version: PROFILE_VERSION + 98, eye: "starlight" });
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
    const again = await connectAndPlay(context.server.url, first.guestToken);
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
    const again = await connectAndPlay(context.server.url, first.guestToken);
    rooms.push(again.room);
    await waitFor(() => playerIn(again, again.room.sessionId) !== undefined, 4000, "spawned");
    const me = playerIn(again, again.room.sessionId);
    expect(Math.hypot(me.x - 5, me.z - 10)).toBeLessThan(0.1);
  });
});
