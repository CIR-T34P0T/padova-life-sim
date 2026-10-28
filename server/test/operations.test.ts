// M12 operations without outside services: deleting a whole guest profile
// (every character and everything they own; every window of the profile is
// told; the guest token stops working), the health and status endpoints
// (aggregate numbers only, 503 when the database is unreachable), and the
// JSON log format; and a finding of the load test: clients at the title
// screen get no state for the player map they can't see.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Room } from "@colyseus/sdk";
import { ClientMessage, DEFAULT_APPEARANCE, ERROR_INVALID_GUEST_TOKEN, PROFILE_VERSION, cloneAppearance, type ProfilePayload } from "@padova/shared";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Database } from "../src/db/database.ts";
import { migrate } from "../src/db/migrate.ts";
import { createGameServer } from "../src/app.ts";
import { formatLine } from "../src/log.ts";
import { resolveStaticFile } from "../src/staticFiles.ts";
import { createGuestWithCharacter, deleteAccount, type Owner } from "../src/profiles/profileRepository.ts";
import { addStoryEvent, blockAccount, insertReport } from "../src/social/socialRepository.ts";
import { connect, joinWithNewCharacter, sleep, startTestServer, waitFor, type ProfileClient, type TestServer } from "./helpers/gameClient.ts";
import { migratedTestDatabase, testBackends } from "./helpers/testDatabase.ts";

async function request(client: ProfileClient, type: string, payload?: unknown): Promise<{ profile?: ProfilePayload; error?: string }> {
  const profiles = client.profiles.length;
  const errors = client.errors.length;
  client.room.send(type, payload);
  await waitFor(() => client.profiles.length > profiles || client.errors.length > errors, 6000, `reply to ${type}`);
  return { profile: client.profiles[profiles], error: client.errors[errors]?.reason };
}

describe("deleting a whole guest profile", () => {
  let server: TestServer;
  const rooms: Room[] = [];
  beforeAll(async () => {
    server = await startTestServer(2648);
  });
  afterEach(async () => {
    await Promise.all(rooms.splice(0).map((room) => Promise.race([room.leave(true).catch(() => undefined), sleep(500)])));
    await sleep(150);
  });
  afterAll(async () => {
    await server.stop();
  });
  const track = <T extends ProfileClient>(client: T): T => {
    rooms.push(client.room);
    return client;
  };
  const count = async (sql: string, params: unknown[]) => Number((await server.db.query<{ n: number }>(sql, params)).rows[0]!.n);

  it("removes every character and everything they own, tells every window of the profile, and the guest token stops working", async () => {
    const ada = track(await joinWithNewCharacter(server.url, "Ada"));
    const token = ada.guestToken;
    expect((await request(ada, ClientMessage.LeaveWorld)).profile?.status).toBe("lobby");
    const second = await request(ada, ClientMessage.CreateCharacter, { displayName: "Ada Two", ageCategory: "adult", appearance: cloneAppearance(DEFAULT_APPEARANCE), traits: [] });
    expect(second.profile?.status).toBe("ready");
    expect((await request(ada, ClientMessage.LeaveWorld)).profile?.characters).toHaveLength(2);
    const accountId = (await server.db.query<{ account_id: string }>(`SELECT account_id FROM guest_credentials LIMIT 1`)).rows[0]!.account_id;
    expect(await count(`SELECT count(*)::int AS n FROM characters WHERE account_id = $1`, [accountId])).toBe(2);
    // A second window of the same profile, at the title screen.
    const other = track(await connect(server.url, { guestToken: token }));
    expect(other.lastProfile()?.characters).toHaveLength(2);

    // The word must be typed.
    expect((await request(ada, ClientMessage.DeleteProfile, { confirm: "yes" })).error).toBe("confirm_mismatch");
    expect(await count(`SELECT count(*)::int AS n FROM accounts WHERE id = $1`, [accountId])).toBe(1);

    const deleted = await request(ada, ClientMessage.DeleteProfile, { confirm: "  Delete " });
    expect(deleted.profile).toMatchObject({ status: "lobby", characters: [] });
    expect(ada.received("profileDeleted")).toHaveLength(1);
    await waitFor(() => other.received("profileDeleted").length === 1, 4000, "the other window told");
    await waitFor(() => other.lastProfile()?.characters?.length === 0, 4000, "the other window's empty lobby");
    for (const table of ["accounts", "guest_credentials"]) {
      expect(await count(`SELECT count(*)::int AS n FROM ${table} WHERE ${table === "accounts" ? "id" : "account_id"} = $1`, [accountId]), table).toBe(0);
    }
    expect(await count(`SELECT count(*)::int AS n FROM characters`, [])).toBe(0);
    expect(await count(`SELECT count(*)::int AS n FROM wallet_transactions`, [])).toBe(0);
    await expect(connect(server.url, { guestToken: token })).rejects.toMatchObject({ code: ERROR_INVALID_GUEST_TOKEN });
    // Nothing left to delete; a new character makes a new profile.
    expect((await request(ada, ClientMessage.DeleteProfile, { confirm: "delete" })).error).toBe("profile_not_found");
  });

  it("is refused in the world, and while one of the profile's characters is played in another window", async () => {
    const ben = track(await joinWithNewCharacter(server.url, "Ben"));
    expect((await request(ben, ClientMessage.DeleteProfile, { confirm: "delete" })).error).toBe("in_world");
    const lobby = track(await connect(server.url, { guestToken: ben.guestToken }));
    expect((await request(lobby, ClientMessage.DeleteProfile, { confirm: "delete" })).error).toBe("character_in_use");
    expect((await request(lobby, ClientMessage.DeleteProfile, { nope: true })).error).toBe("invalid_payload");
    // Back at the title screen in the first window: now it can go.
    expect((await request(ben, ClientMessage.LeaveWorld)).profile?.status).toBe("lobby");
    expect((await request(lobby, ClientMessage.DeleteProfile, { confirm: "delete" })).profile?.characters).toEqual([]);
    await waitFor(() => ben.received("profileDeleted").length === 1, 4000, "the first window told");
  });
});

for (const backend of testBackends) {
  describe(`deleting an account on ${backend.name}`, () => {
    let db: Database;
    beforeEach(async () => {
      db = await backend.open();
      await migrate(db);
    });
    afterEach(async () => {
      await db.close();
    });
    const newOwner = async (name: string): Promise<Owner> => {
      const created = await createGuestWithCharacter(db, { displayName: name, ageCategory: "adult", appearance: cloneAppearance(DEFAULT_APPEARANCE), traits: [] }, PROFILE_VERSION, { area: "plaza", x: 0, z: 13, rotation: 0 }, { startingBalanceCents: 1_000, gameMinute: 600 });
      return { accountId: created.accountId, characterId: created.character.characterId };
    };
    const count = async (sql: string, params: unknown[] = []) => Number((await db.query<{ n: number }>(sql, params)).rows[0]!.n);

    it("cascades to its characters and blocks, keeps the reports it made without its name, and takes reports about it", async () => {
      const ada = await newOwner("Ada");
      const ben = await newOwner("Ben");
      await addStoryEvent(db, ada, { key: "first_shift", kind: "first_shift", gameMinute: 600, details: {} });
      expect(await blockAccount(db, ada, ben, "Ben")).toBe("blocked");
      expect(await blockAccount(db, ben, ada, "Ada")).toBe("blocked");
      const report = (by: Owner, about: Owner) => insertReport(db, { reporter: by, reported: about, reporterName: "R", reportedName: "S", reason: "other", note: "", area: "plaza", gameMinute: 600 });
      expect(await report(ada, ben)).toBe("sent");
      expect(await report(ben, ada)).toBe("sent");

      expect(await deleteAccount(db, ada.accountId)).toBe(1);
      expect(await count(`SELECT count(*)::int AS n FROM characters WHERE id = $1`, [ada.characterId])).toBe(0);
      for (const table of ["character_needs", "character_wallets", "wallet_transactions", "character_state", "story_events"]) {
        expect(await count(`SELECT count(*)::int AS n FROM ${table} WHERE character_id = $1`, [ada.characterId]), table).toBe(0);
      }
      expect(await count(`SELECT count(*)::int AS n FROM blocks WHERE blocker_account = $1 OR blocked_account = $1`, [ada.accountId])).toBe(0);
      expect(await count(`SELECT count(*)::int AS n FROM reports WHERE reported_account = $1`, [ada.accountId])).toBe(0);
      expect(await count(`SELECT count(*)::int AS n FROM reports WHERE reported_account = $1 AND reporter_account IS NULL AND reporter_character_id IS NULL`, [ben.accountId])).toBe(1);
      // Ben is untouched.
      expect(await count(`SELECT count(*)::int AS n FROM characters WHERE id = $1`, [ben.characterId])).toBe(1);
      expect(await deleteAccount(db, ada.accountId)).toBeNull();
    });
  });
}

describe("health and status", () => {
  let server: TestServer;
  let broken = false;
  const rooms: Room[] = [];
  beforeAll(async () => {
    const db = await migratedTestDatabase();
    // The database, made unreachable on demand.
    const flaky = new Proxy(db, {
      get(target, property) {
        if (property === "query" && broken) return async () => Promise.reject(new Error("database down"));
        const value = Reflect.get(target, property);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    server = await startTestServer(2649, {}, flaky);
  });
  afterAll(async () => {
    await Promise.all(rooms.map((room) => room.leave(true).catch(() => undefined)));
    await server.stop();
  });
  const http = (path: string) => fetch(server.url.replace("ws://", "http://") + path);

  it("/health answers ok while the database answers, 503 when it doesn't", async () => {
    const ok = await http("/health");
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ status: "ok" });
    broken = true;
    try {
      const down = await http("/health");
      expect(down.status).toBe(503);
      expect(await down.json()).toEqual({ status: "error", database: "unreachable" });
    } finally {
      broken = false;
    }
  });

  it("/status gives aggregate numbers only: players, NPCs, tick time against the budget, memory, database", async () => {
    const zoe = await joinWithNewCharacter(server.url, "Zoe Status");
    rooms.push(zoe.room);
    await sleep(500);
    const res = await http("/status");
    expect(res.status).toBe(200);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const body = (await res.json()) as any;
    expect(body).toMatchObject({ status: "ok", version: "0.1.0", npcs: "off", tickBudgetMs: 5, players: 1, database: { ok: true, kind: "pglite" } });
    expect(body.rooms).toHaveLength(1);
    expect(body.rooms[0]).toMatchObject({ players: 1, npcs: 0 });
    expect(body.rooms[0].tick.ticks).toBeGreaterThan(0);
    expect(typeof body.memory.rssMb).toBe("number");
    const text = JSON.stringify(body);
    expect(text).not.toContain("Zoe");
    expect(text).not.toContain(zoe.room.sessionId);
  });
});

describe("clients at the title screen (load test finding)", () => {
  it("receive nothing about the player map while others enter the world and move", async () => {
    const server = await startTestServer(2650);
    const decodeErrors: string[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((first: unknown) => void decodeErrors.push(String(first)));
    const rooms: Room[] = [];
    try {
      const watcher = await connect(server.url);
      rooms.push(watcher.room);
      for (const name of ["Ada", "Ben"]) rooms.push((await joinWithNewCharacter(server.url, name)).room);
      rooms[1]!.send(ClientMessage.MoveTo, { x: 2, z: 2 });
      await sleep(400);
      // Before the fix every arrival sent the title screen a delete for a map it didn't know ("refId" not found).
      expect(decodeErrors.filter((text) => text.includes("refId"))).toEqual([]);
      expect(watcher.room.state.players?.size ?? 0).toBe(0);
      await waitFor(() => rooms[1]!.state.players?.size === 2, 4000, "players in the world see each other");
    } finally {
      spy.mockRestore();
      await Promise.all(rooms.map((room) => Promise.race([room.leave(true).catch(() => undefined), sleep(500)])));
      await server.stop();
    }
  });
});

describe("serving the built client (production)", () => {
  const dist = mkdtempSync(join(tmpdir(), "padova-dist-"));
  mkdirSync(join(dist, "assets"));
  writeFileSync(join(dist, "index.html"), "<!doctype html><title>Padova</title>");
  writeFileSync(join(dist, "assets", "index-abc123.js"), "console.log(1)");
  writeFileSync(join(dist, ".env"), "SECRET=1");
  writeFileSync(join(dist, "..", "padova-outside.txt"), "outside");
  let stop: () => Promise<void>;
  const url = "http://127.0.0.1:2651";
  beforeAll(async () => {
    const db = await migratedTestDatabase();
    const server = createGameServer({ db, clientDist: dist, tuning: { guestCreationsPerIpPerHour: 10_000, npcs: false } });
    await server.listen(2651, "127.0.0.1");
    stop = async () => {
      await server.gracefullyShutdown(false);
      await db.close();
    };
  });
  afterAll(async () => {
    await stop();
    rmSync(dist, { recursive: true, force: true });
    rmSync(join(dist, "..", "padova-outside.txt"), { force: true });
  });

  it("serves the page and its assets with the right types and caching, and nothing else", async () => {
    const page = await fetch(`${url}/`);
    expect(page.status).toBe(200);
    expect(page.headers.get("content-type")).toContain("text/html");
    expect(page.headers.get("cache-control")).toBe("no-cache");
    expect(await page.text()).toContain("<title>Padova</title>");
    const asset = await fetch(`${url}/assets/index-abc123.js`);
    expect(asset.headers.get("content-type")).toContain("text/javascript");
    expect(asset.headers.get("cache-control")).toContain("immutable");
    expect(asset.headers.get("x-content-type-options")).toBe("nosniff");
    expect((await fetch(`${url}/index.html`, { method: "HEAD" })).status).toBe(200);
    for (const path of ["/.env", "/missing.js", "/%2e%2e/padova-outside.txt", "/assets/..%2f..%2fpadova-outside.txt", "/..%5cpadova-outside.txt"]) {
      expect((await fetch(`${url}${path}`)).status, path).toBe(404);
    }
    expect((await fetch(`${url}/`, { method: "POST" })).status).toBe(404);
    expect(resolveStaticFile(dist, "/../padova-outside.txt")).toBeNull();
    // The game's own routes and matchmaking still work beside it.
    expect(await (await fetch(`${url}/health`)).json()).toEqual({ status: "ok" });
    const client = await connect("ws://127.0.0.1:2651");
    expect(client.lastProfile()?.status).toBe("lobby");
    await client.room.leave(true);
  });
});

describe("the log format", () => {
  it("writes plain lines by default and one JSON object per line with LOG_FORMAT=json", () => {
    const time = new Date("2026-10-27T12:00:00.000Z");
    expect(formatLine("info", "plaza", "room created", false, time)).toBe("2026-10-27T12:00:00.000Z INFO [plaza] room created");
    expect(JSON.parse(formatLine("warn", "plaza", 'a "quoted" word', true, time))).toEqual({ time: "2026-10-27T12:00:00.000Z", level: "warn", scope: "plaza", message: 'a "quoted" word' });
  });
});
