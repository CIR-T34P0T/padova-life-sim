// Title screen (lobby) and several characters per guest profile (D-031),
// through the real room and database with real WebSocket clients: list,
// create up to the limit, enter, go back to the title, change a look from the
// title screen, delete with confirmation, and the ownership rules for all of it.

import type { Room } from "@colyseus/sdk";
import {
  APPEARANCE_PRESETS,
  CLOSE_SIGNED_IN_ELSEWHERE,
  ClientMessage,
  ServerMessage,
  DEFAULT_APPEARANCE,
  NEEDS_CONFIG,
  decodeLook,
  type NewCharacterInput,
  type ProfilePayload,
} from "@padova/shared";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { connect, enterWorld, joinWithNewCharacter, sleep, startTestServer, waitFor, type ProfileClient, type TestServer } from "./helpers/gameClient.ts";

function useServer(port: number, tuning = {}) {
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
const playerIn = (client: ProfileClient, id: string): any => client.room.state.players?.get(id);
const preset = (id: string) => APPEARANCE_PRESETS.find((p) => p.id === id)!.appearance;
const newCharacter = (displayName: string, appearance = DEFAULT_APPEARANCE): NewCharacterInput => ({ displayName, ageCategory: "adult", appearance, traits: [] });

/** Sends a message and waits for the next profile payload or error. */
async function request(client: ProfileClient, type: string, payload?: unknown): Promise<{ profile?: ProfilePayload; error?: string }> {
  const profiles = client.profiles.length;
  const errors = client.errors.length;
  client.room.send(type, payload);
  await waitFor(() => client.profiles.length > profiles || client.errors.length > errors, 6000, `reply to ${type}`);
  return { profile: client.profiles[profiles], error: client.errors[errors]?.reason };
}

async function backToTitle(client: ProfileClient): Promise<ProfilePayload> {
  const reply = await request(client, ClientMessage.LeaveWorld);
  expect(reply.profile?.status).toBe("lobby");
  // The reply is a direct message; the player's removal arrives with the next state patch.
  await waitFor(() => playerIn(client, client.room.sessionId) === undefined, 3000, "removed from the piazza");
  return reply.profile!;
}

async function createFromTitle(client: ProfileClient, input: NewCharacterInput): Promise<{ profile?: ProfilePayload; error?: string }> {
  const reply = await request(client, ClientMessage.CreateCharacter, input);
  if (reply.profile?.status === "ready") await waitFor(() => playerIn(client, client.room.sessionId) !== undefined, 4000, "spawned");
  return reply;
}

/** Rows that appearance changes must never touch. */
async function lifeRows(server: TestServer, characterId: string) {
  const one = async (sql: string) => (await server.db.query(sql, [characterId])).rows;
  return {
    needs: await one("SELECT hunger, energy, hygiene, social, fun, updated_at FROM character_needs WHERE character_id = $1"),
    wallet: await one("SELECT balance_cents FROM character_wallets WHERE character_id = $1"),
    ledger: await one("SELECT id, amount_cents FROM wallet_transactions WHERE character_id = $1 ORDER BY id"),
    skills: await one("SELECT skill, xp FROM character_skills WHERE character_id = $1 ORDER BY skill"),
    traits: await one("SELECT trait FROM character_traits WHERE character_id = $1 ORDER BY trait"),
    state: await one("SELECT pos_x, pos_z FROM character_state WHERE character_id = $1"),
  };
}

describe("title screen and several lives", () => {
  const { context, track } = useServer(2627);

  it("creates lives up to the limit from the title screen and plays any of them", async () => {
    const watcher = track(await joinWithNewCharacter(context.server.url, "Watcher"));
    const alice = track(await joinWithNewCharacter(context.server.url, "Alice A"));
    const firstId = alice.lastProfile()!.profile!.characterId;
    const lobby = await backToTitle(alice);
    expect(lobby.characters!.map((c) => c.displayName)).toEqual(["Alice A"]);
    await waitFor(() => playerIn(watcher, alice.room.sessionId) === undefined, 3000, "Alice A left the piazza");

    const second = await createFromTitle(alice, newCharacter("Alice B", preset("box-braids")));
    expect(second.profile).toMatchObject({ status: "ready", profile: { displayName: "Alice B" } });
    expect(alice.identities).toHaveLength(1); // same guest profile, no new token
    await waitFor(() => playerIn(watcher, alice.room.sessionId)?.name === "Alice B", 3000, "watcher sees Alice B");
    const secondId = second.profile!.profile!.characterId;

    await backToTitle(alice);
    expect((await createFromTitle(alice, newCharacter("Alice C"))).profile?.status).toBe("ready");
    const full = await backToTitle(alice);
    expect(full).toMatchObject({ maxCharacters: 3 });
    expect(full.characters!.map((c) => c.displayName).sort()).toEqual(["Alice A", "Alice B", "Alice C"]);
    expect(full.characters![0]!.displayName).toBe("Alice C"); // most recently played first

    expect((await createFromTitle(alice, newCharacter("Alice D"))).error).toBe("too_many_characters");
    expect(playerIn(alice, alice.room.sessionId)).toBeUndefined();

    await enterWorld(alice, secondId);
    expect(alice.lastProfile()!.profile!.displayName).toBe("Alice B");
    await waitFor(() => playerIn(watcher, alice.room.sessionId)?.name === "Alice B", 3000, "watcher sees Alice B again");
    expect(decodeLook(playerIn(watcher, alice.room.sessionId).look).appearance).toEqual(preset("box-braids"));
    expect(firstId).not.toBe(secondId);
  });

  it("keeps each life's needs, money and skills separate", async () => {
    const alice = track(await joinWithNewCharacter(context.server.url, "Sara"));
    const saraId = alice.lastProfile()!.profile!.characterId;
    await backToTitle(alice);
    await context.server.db.query("UPDATE character_needs SET hunger = 12, updated_at = now() WHERE character_id = $1", [saraId]);
    await context.server.db.query("UPDATE character_wallets SET balance_cents = 777 WHERE character_id = $1", [saraId]);
    const other = await createFromTitle(alice, newCharacter("Teresa"));
    await waitFor(() => alice.lives.some((l) => l.money.balanceCents > 777), 4000, "Teresa's life");
    const teresa = alice.lastLife()!;
    expect(teresa.needs.hunger).toBeGreaterThan(NEEDS_CONFIG.initial.hunger - 2);
    expect(other.profile!.profile!.characterId).not.toBe(saraId);
    await backToTitle(alice);
    const livesBefore = alice.lives.length;
    await enterWorld(alice, saraId);
    await waitFor(() => alice.lives.length > livesBefore, 4000, "Sara's life");
    const sara = alice.lastLife()!;
    expect(sara.needs.hunger).toBeLessThan(14);
    expect(sara.money.balanceCents).toBeLessThan(teresa.money.balanceCents);
  });

  it("goes back to the title and in again at the same spot, and the character still moves", async () => {
    const watcher = track(await joinWithNewCharacter(context.server.url, "Watcher"));
    const ugo = track(await joinWithNewCharacter(context.server.url, "Ugo"));
    const id = ugo.lastProfile()!.profile!.characterId;
    ugo.room.send(ClientMessage.MoveTo, { x: -6, z: 10 });
    await waitFor(() => {
      const me = playerIn(ugo, ugo.room.sessionId);
      return Math.hypot(me.x + 6, me.z - 10) < 0.1 && !me.moving;
    }, 6000, "walked");
    const lobby = await backToTitle(ugo);
    expect(lobby.characters![0]).toMatchObject({ characterId: id });
    await waitFor(() => playerIn(watcher, ugo.room.sessionId) === undefined, 3000, "removed for others");
    const saved = await context.server.db.query<{ pos_x: number; pos_z: number }>("SELECT pos_x, pos_z FROM character_state WHERE character_id = $1", [id]);
    expect(saved.rows[0]!.pos_x).toBeCloseTo(-6, 1);

    await enterWorld(ugo, id);
    const back = playerIn(ugo, ugo.room.sessionId);
    expect(back.x).toBeCloseTo(-6, 1);
    expect(back.z).toBeCloseTo(10, 1);
    ugo.room.send(ClientMessage.MoveTo, { x: -3, z: 10 });
    await waitFor(() => Math.hypot(playerIn(ugo, ugo.room.sessionId).x + 3, playerIn(ugo, ugo.room.sessionId).z - 10) < 0.1, 6000, "walks again");
    await waitFor(() => playerIn(watcher, ugo.room.sessionId) !== undefined, 3000, "watcher sees Ugo again");
  });

  it("enters the world once even if Continue is pressed twice", async () => {
    const first = await joinWithNewCharacter(context.server.url, "Vera");
    const token = first.guestToken;
    await first.room.leave(true);
    await sleep(300);
    const again = track(await connect(context.server.url, { guestToken: token }));
    const id = again.lastProfile()!.characters![0]!.characterId;
    again.room.send(ClientMessage.EnterWorld, { characterId: id });
    again.room.send(ClientMessage.EnterWorld, { characterId: id });
    await waitFor(() => again.lastProfile()?.status === "ready", 6000, "ready");
    await waitFor(() => again.errors.length === 1, 3000, "second press refused");
    expect(["busy", "in_world"]).toContain(again.errors[0]!.reason);
    // "ready" is a direct message; the player appears with the next state patch.
    await waitFor(() => again.room.state.players?.get(again.room.sessionId) !== undefined, 3000, "replicated");
    await sleep(200);
    expect([...(again.room.state.players?.values() ?? [])].filter((p: any) => p.name === "Vera")).toHaveLength(1);
  });

  it("creates one character and one guest profile even if Begin is pressed twice", async () => {
    // First visit: two create requests back to back (a double click).
    const visitor = track(await connect(context.server.url));
    const input = newCharacter("Doppio");
    visitor.room.send(ClientMessage.CreateCharacter, input);
    visitor.room.send(ClientMessage.CreateCharacter, input);
    await waitFor(() => visitor.lastProfile()?.status === "ready", 8000, "ready");
    await waitFor(() => visitor.errors.length === 1, 3000, "second press refused");
    expect(["busy", "in_world"]).toContain(visitor.errors[0]!.reason);
    await sleep(300);
    expect(visitor.identities).toHaveLength(1); // one guest token, issued once
    const rows = async (name: string) =>
      (await context.server.db.query("SELECT account_id FROM characters WHERE display_name = $1", [name])).rows as { account_id: string }[];
    expect(await rows("Doppio")).toHaveLength(1);

    // Adding a second life to the same profile: a double click adds one, not two.
    await backToTitle(visitor);
    visitor.room.send(ClientMessage.CreateCharacter, newCharacter("Doppio B"));
    visitor.room.send(ClientMessage.CreateCharacter, newCharacter("Doppio B"));
    await waitFor(() => visitor.lastProfile()?.status === "ready" && visitor.lastProfile()?.profile?.displayName === "Doppio B", 8000, "second life ready");
    await waitFor(() => visitor.errors.length === 2, 3000, "second press refused again");
    await sleep(300);
    const second = await rows("Doppio B");
    expect(second).toHaveLength(1);
    expect(second[0]!.account_id).toBe((await rows("Doppio"))[0]!.account_id);
    expect(visitor.identities).toHaveLength(1);
    expect([...(visitor.room.state.players?.values() ?? [])].filter((p: any) => p.name.startsWith("Doppio"))).toHaveLength(1);
  });

  it("ignores gameplay messages from a session at the title screen (audit 2026-10-20)", async () => {
    const watcher = track(await joinWithNewCharacter(context.server.url, "Wally"));
    const first = await joinWithNewCharacter(context.server.url, "Tina");
    const characterId = first.lastProfile()!.profile!.characterId;
    await backToTitle(first);
    // Give Tina a job (M7) so a quit message from the title screen would have something to remove.
    await context.server.db.query("INSERT INTO character_employment (character_id, job, hired_game_minute) VALUES ($1, 'cafe', 0)", [characterId]);
    const rejected: unknown[] = [];
    first.room.onMessage(ServerMessage.Rejected, (payload: unknown) => rejected.push(payload));
    const actionsBefore = first.actions.length;
    // Everything a player in the world could send, from the title screen.
    first.room.send(ClientMessage.MoveTo, { x: 2, z: 2 });
    first.room.send(ClientMessage.MoveDirection, { dx: 1, dz: 0 });
    first.room.send(ClientMessage.Stop);
    first.room.send(ClientMessage.Interact, { targetKind: "object", targetId: "bench-1", action: "sit" });
    first.room.send(ClientMessage.Interact, { targetKind: "object", targetId: "cafe-counter", action: "buy", itemId: "espresso", requestId: "req_title_0001" });
    first.room.send(ClientMessage.Interact, { targetKind: "object", targetId: "cafe-counter", action: "work" });
    first.room.send(ClientMessage.Interact, { targetKind: "object", targetId: "cafe-counter", action: "ask_work" });
    first.room.send(ClientMessage.QuitJob);
    first.room.send(ClientMessage.CancelAction);
    await sleep(800);
    // Nothing appeared, moved, was reserved, answered or charged.
    expect(playerIn(watcher, first.room.sessionId)).toBeUndefined();
    expect([...watcher.room.state.seats.keys()]).toEqual([]);
    expect(first.actions.length).toBe(actionsBefore);
    expect(rejected).toEqual([]);
    const ledger = await context.server.db.query("SELECT description FROM wallet_transactions WHERE character_id = $1", [characterId]);
    expect(ledger.rows.map((row: any) => row.description)).not.toContain("Espresso");
    const job = await context.server.db.query("SELECT job FROM character_employment WHERE character_id = $1", [characterId]);
    expect(job.rows).toEqual([{ job: "cafe" }]);
    // And the session still works normally.
    await enterWorld(first, characterId);
    await waitFor(() => playerIn(watcher, first.room.sessionId)?.name === "Tina", 3000, "Tina in the world");
    track(first);
  });

  it("keeps the title screen through a brief network drop", async () => {
    const first = await joinWithNewCharacter(context.server.url, "Walt");
    await first.room.leave(true);
    await sleep(300);
    const again = track(await connect(context.server.url, { guestToken: first.guestToken }));
    again.room.reconnection.minUptime = 0;
    const reconnected = new Promise<void>((resolve) => again.room.onReconnect(() => resolve()));
    again.room.connection.close(4010, "simulated drop");
    await reconnected;
    await enterWorld(again);
    expect(again.lastProfile()!.profile!.displayName).toBe("Walt");
  });
});

describe("changing a look never touches the rest of a life", () => {
  const { context, track } = useServer(2628);

  it("in the world and from the title screen, only the appearance changes", async () => {
    const nina = track(await joinWithNewCharacter(context.server.url, "Nina", DEFAULT_APPEARANCE, ["sociable"]));
    const id = nina.lastProfile()!.profile!.characterId;
    await backToTitle(nina); // saves needs and position
    const before = await lifeRows(context.server, id);

    // From the title screen.
    const fromTitle = await request(nina, ClientMessage.UpdateAppearance, { characterId: id, appearance: preset("afro-puffs") });
    expect(fromTitle.profile?.status).toBe("lobby");
    expect(decodeLook(fromTitle.profile!.characters![0]!.look).appearance).toEqual(preset("afro-puffs"));
    expect(await lifeRows(context.server, id)).toEqual(before);

    // In the world.
    await enterWorld(nina, id);
    const lifeBefore = await lifeRows(context.server, id);
    const inWorld = await request(nina, ClientMessage.UpdateAppearance, { appearance: preset("silver-buzz") });
    expect(inWorld.profile).toMatchObject({ status: "ready", profile: { appearance: preset("silver-buzz"), traits: ["sociable"] } });
    expect(await lifeRows(context.server, id)).toEqual(lifeBefore);
    expect(lifeBefore.traits).toEqual([{ trait: "sociable" }]);
  });
});

describe("deleting characters and ownership at the title screen", () => {
  const { context, track } = useServer(2629);

  it("deletes only from the title screen, with the name typed, and never a character being played", async () => {
    const playing = track(await joinWithNewCharacter(context.server.url, "Olga Rossi"));
    const olgaId = playing.lastProfile()!.profile!.characterId;
    const title = track(await connect(context.server.url, { guestToken: playing.guestToken }));
    // Olga is in the world in the other window.
    expect((await request(title, ClientMessage.DeleteCharacter, { characterId: olgaId, confirmName: "Olga Rossi" })).error).toBe("character_in_use");

    await backToTitle(playing);
    const kept = await createFromTitle(playing, newCharacter("Pietro"));
    const pietroId = kept.profile!.profile!.characterId;
    // The playing window can't delete while in the world.
    expect((await request(playing, ClientMessage.DeleteCharacter, { characterId: olgaId, confirmName: "Olga Rossi" })).error).toBe("in_world");
    expect((await request(title, ClientMessage.DeleteCharacter, { characterId: olgaId, confirmName: "Olga" })).error).toBe("confirm_name_mismatch");
    expect((await request(title, ClientMessage.DeleteCharacter, { characterId: olgaId, confirmName: "" })).error).toBe("confirm_name_mismatch");

    const deleted = await request(title, ClientMessage.DeleteCharacter, { characterId: olgaId, confirmName: "  olga rossi " });
    expect(deleted.profile?.characters?.map((c) => c.displayName)).toEqual(["Pietro"]);
    for (const table of ["characters", "character_needs", "wallet_transactions"]) {
      const column = table === "characters" ? "id" : "character_id";
      const rows = await context.server.db.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${table} WHERE ${column} = $1`, [olgaId]);
      expect(rows.rows[0]!.n, table).toBe(0);
    }
    expect((await request(title, ClientMessage.EnterWorld, { characterId: olgaId })).error).toBe("character_not_found");
    expect(pietroId).toBeTruthy();
  });

  it("never lets another profile see, play, change or delete a character", async () => {
    const alice = track(await joinWithNewCharacter(context.server.url, "Alice"));
    const aliceId = alice.lastProfile()!.profile!.characterId;
    const brunoFirst = await joinWithNewCharacter(context.server.url, "Bruno");
    await backToTitle(brunoFirst);
    const bruno = track(brunoFirst);
    expect(bruno.lastProfile()!.characters!.map((c) => c.characterId)).not.toContain(aliceId);
    expect((await request(bruno, ClientMessage.EnterWorld, { characterId: aliceId })).error).toBe("character_not_found");
    expect((await request(bruno, ClientMessage.UpdateAppearance, { characterId: aliceId, appearance: preset("silver-buzz") })).error).toBe("character_not_found");
    expect((await request(bruno, ClientMessage.DeleteCharacter, { characterId: aliceId, confirmName: "Alice" })).error).toBe("character_not_found");
    const stored = await context.server.db.query<{ config: unknown }>("SELECT config FROM character_appearance WHERE character_id = $1", [aliceId]);
    expect(stored.rows[0]!.config).toEqual(DEFAULT_APPEARANCE);
    expect(playerIn(alice, alice.room.sessionId)).toMatchObject({ name: "Alice" });
    // A brand-new visitor has no profile at all.
    const visitor = track(await connect(context.server.url));
    expect((await request(visitor, ClientMessage.EnterWorld, { characterId: aliceId })).error).toBe("character_not_found");
    expect((await request(visitor, ClientMessage.DeleteCharacter, { characterId: aliceId, confirmName: "Alice" })).error).toBe("character_not_found");
  });

  it("refuses malformed title screen requests", async () => {
    const first = await joinWithNewCharacter(context.server.url, "Quinn");
    await backToTitle(first);
    const quinn = track(first);
    for (const payload of [{ characterId: "../../etc" }, { characterId: 42 }, "x", null]) {
      expect((await request(quinn, ClientMessage.EnterWorld, payload)).error).toBe("invalid_payload");
    }
    const id = quinn.lastProfile()!.characters![0]!.characterId;
    expect((await request(quinn, ClientMessage.DeleteCharacter, { characterId: id })).error).toBe("invalid_payload");
    expect((await request(quinn, ClientMessage.DeleteCharacter, { characterId: id, confirmName: "q".repeat(500) })).error).toBe("invalid_payload");
    expect((await request(quinn, ClientMessage.UpdateAppearance, { characterId: id, appearance: { v: 1 } })).error).toBe("invalid_appearance");
    // Leaving the world when not in it just sends the title screen again.
    expect((await request(quinn, ClientMessage.LeaveWorld)).profile?.status).toBe("lobby");
  });

  it("a window entering the world takes over from another window playing a different life", async () => {
    const first = await joinWithNewCharacter(context.server.url, "Rita");
    let closed: number | null = null;
    first.room.onLeave((code) => (closed = code));
    await backToTitle(first);
    await createFromTitle(first, newCharacter("Rosa"));
    expect(first.lastProfile()!.profile!.displayName).toBe("Rosa");
    const second = track(await connect(context.server.url, { guestToken: first.guestToken }));
    const rita = second.lastProfile()!.characters!.find((c) => c.displayName === "Rita")!;
    await enterWorld(second, rita.characterId);
    await waitFor(() => closed !== null, 4000, "first window closed");
    expect(closed).toBe(CLOSE_SIGNED_IN_ELSEWHERE);
  });
});
