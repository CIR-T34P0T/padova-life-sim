// M5 life simulation through the real room, real database (in-memory PGlite)
// and real WebSocket clients: the first gameplay loop, money rules, needs over
// time, offline catch-up, skills, traits and privacy of life data.

import type { Room } from "@colyseus/sdk";
import {
  ClientMessage,
  ECONOMY_CONFIG,
  NEEDS_CONFIG,
  gameDayOf,
  gameMinuteAt,
  type ActionUpdatePayload,
  type LifePayload,
} from "@padova/shared";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "../src/db/database.ts";
import type { TuningOverrides } from "../src/tuning.ts";
import { connectAndPlay, joinWithNewCharacter, sleep, startTestServer, waitFor, type ProfileClient, type TestServer } from "./helpers/gameClient.ts";
import { migratedTestDatabase } from "./helpers/testDatabase.ts";

/** Starting money plus today's daily allowance (paid on entering). */
const START_PLUS_DAY = 10_000 + ECONOMY_CONFIG.dailyAllowanceCents;

const FAST: TuningOverrides = {
  walkSpeed: 9,
  actionDurationsMs: { study: 800, sketch: 600, wash: 400, greet: 300 },
  consumeDurationFactor: 0.06, // panino 0.9 s, espresso 0.3 s
};

function useLifeServer(port: number, tuning: TuningOverrides = {}, makeDb?: () => Promise<Database>) {
  const context = { server: undefined as unknown as TestServer };
  const rooms: Room[] = [];
  beforeAll(async () => {
    context.server = await startTestServer(port, { ...FAST, ...tuning }, makeDb ? await makeDb() : undefined);
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
  return { context, track };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const me = (client: ProfileClient): any => client.room.state.players?.get(client.room.sessionId);
const characterIdOf = (client: ProfileClient) => client.profiles.find((p) => p.profile)!.profile!.characterId;

async function lifeAfter(client: ProfileClient, predicate: (life: LifePayload) => boolean, what: string, timeoutMs = 6000) {
  await waitFor(() => client.lives.some(predicate), timeoutMs, what);
  return [...client.lives].reverse().find(predicate)!;
}

/** Sends an interaction and returns the first update that answers it. */
async function act(client: ProfileClient, targetKind: "object" | "player", targetId: string, action: string, extra: object = {}) {
  const seen = client.actions.length;
  client.room.send(ClientMessage.Interact, { targetKind, targetId, action, ...extra });
  await waitFor(() => client.actions.length > seen, 4000, `reply to ${action}`);
  return client.actions[seen]!;
}

async function finished(client: ProfileClient, action: string, timeoutMs = 10_000): Promise<ActionUpdatePayload> {
  const from = client.actions.length;
  await waitFor(
    () => client.actions.slice(from).some((u) => u.action === action && ["completed", "failed", "cancelled"].includes(u.status)),
    timeoutMs,
    `${action} finished`,
  );
  return client.actions.slice(from).find((u) => u.action === action && ["completed", "failed", "cancelled"].includes(u.status))!;
}

/** Leaves, overwrites saved needs (as of now unless `savedAgoMs`), and returns the token to rejoin with. */
async function leaveWithNeeds(server: TestServer, client: ProfileClient & { guestToken: string }, needs: Partial<Record<string, number>>, savedAgoMs = 0) {
  const characterId = characterIdOf(client);
  await client.room.leave(true);
  await sleep(300);
  const sets = Object.entries(needs).map(([need, value], i) => `${need} = $${i + 3}`);
  await server.db.query(
    `UPDATE character_needs SET ${[...sets, "updated_at = now() - ($2 || ' milliseconds')::interval"].join(", ")} WHERE character_id = $1`,
    [characterId, String(savedAgoMs), ...Object.values(needs)],
  );
  return client.guestToken;
}

const ledger = async (server: TestServer, characterId: string) =>
  (await server.db.query<{ category: string; direction: string; amount_cents: number; item_id: string | null }>(
    `SELECT category, direction, amount_cents, item_id FROM wallet_transactions WHERE character_id = $1 ORDER BY created_at, id`,
    [characterId],
  )).rows;

describe("the first life loop", () => {
  const { context, track } = useLifeServer(2621);

  it("enters with starting needs, money and an empty skill sheet, and the clock comes from the server", async () => {
    const alice = track(await joinWithNewCharacter(context.server.url, "Alice"));
    const life = await lifeAfter(alice, (l) => l.money.balanceCents === START_PLUS_DAY, "starting allowance + daily allowance");
    expect(Object.keys(life).sort()).toEqual(["gameMinute", "job", "money", "mood", "needs", "skills", "traits"]);
    expect(life.job).toBeNull();
    expect(life.needs).toEqual(NEEDS_CONFIG.initial);
    expect(Object.values(life.skills).every((s) => s.xp === 0 && s.level === 0)).toBe(true);
    expect(life.traits).toEqual([]);
    expect(life.money.recent.map((t) => t.description).sort()).toEqual(["Daily allowance", "Starting allowance"]);
    expect(Math.abs(alice.room.state.gameMinute - gameMinuteAt(Date.now()))).toBeLessThan(2);
  });

  it("buys a panino, eats it, studies, sees every change, and keeps it all after coming back", async () => {
    const first = track(await joinWithNewCharacter(context.server.url, "Giulia"));
    const characterId = characterIdOf(first);
    const token = await leaveWithNeeds(context.server, first, { hunger: 30, energy: 60 });
    const alice = track(await connectAndPlay(context.server.url, token));
    const start = await lifeAfter(alice, (l) => l.needs.hunger < 31, "hungry on entry");
    expect(start.money.balanceCents).toBe(START_PLUS_DAY);

    // Walk to the café and buy. A price sent by the client is ignored.
    const reply = await act(alice, "object", "cafe-counter", "buy", { itemId: "panino", requestId: "req_loop_0001", priceCents: 1 });
    expect(reply).toMatchObject({ status: "queued", action: "buy", itemId: "panino" });
    await waitFor(() => me(alice)?.activity === "eating", 8000, "eating at the counter");
    expect(await finished(alice, "buy")).toMatchObject({ status: "completed" });
    const fed = await lifeAfter(alice, (l) => l.money.balanceCents === START_PLUS_DAY - 450 && l.needs.hunger > 70, "paid and fed");
    expect(fed.needs.hunger).toBeGreaterThan(74);
    expect(fed.needs.hunger).toBeLessThanOrEqual(75);
    expect(fed.money.recent[0]).toMatchObject({ direction: "expense", category: "purchase", itemId: "panino", amountCents: 450, balanceAfterCents: START_PLUS_DAY - 450 });
    expect(fed.mood.reasons.map((r) => r.label)).toContain("Good meal");
    await waitFor(() => me(alice)?.activity === "idle", 2000, "done eating");

    // Study at a desk; academic skill improves.
    expect((await act(alice, "object", "desk-2", "study")).status).toBe("queued");
    expect(await finished(alice, "study")).toMatchObject({ status: "completed" });
    const studied = await lifeAfter(alice, (l) => l.skills.academic.xp > 0, "academic XP");
    expect(studied.skills.academic.xp).toBeGreaterThanOrEqual(20);
    expect(studied.skills.academic.xp).toBeLessThanOrEqual(25);
    expect(studied.skills.academic.progress).toBeCloseTo(studied.skills.academic.xp / 100, 2);
    expect(studied.mood.reasons.map((r) => r.label)).toContain("Learned something");

    // Leave and come back: needs, skills, money and mood events are all still there.
    const before = alice.lastLife()!;
    await alice.room.leave(true);
    await sleep(300);
    const again = track(await connectAndPlay(context.server.url, token));
    const restored = await lifeAfter(again, () => true, "life after rejoining");
    expect(restored.money.balanceCents).toBe(START_PLUS_DAY - 450);
    expect(restored.skills.academic.xp).toBeCloseTo(before.skills.academic.xp, 1);
    expect(restored.needs.hunger).toBeCloseTo(before.needs.hunger, 0);
    expect(restored.mood.events.map((e) => e.id).sort()).toEqual(["good_meal", "learned_something"]);
    // One starting allowance, one daily allowance for today (not paid twice), one purchase.
    expect((await ledger(context.server, characterId)).map((t) => t.category)).toEqual(["allowance", "allowance", "purchase"]);
  });

  it("charges and serves a repeated purchase request only once", async () => {
    const alice = track(await joinWithNewCharacter(context.server.url, "Repeat"));
    const characterId = characterIdOf(alice);
    await act(alice, "object", "cafe-counter", "buy", { itemId: "espresso", requestId: "req_repeat_01" });
    expect(await finished(alice, "buy")).toMatchObject({ status: "completed" });
    await act(alice, "object", "cafe-counter", "buy", { itemId: "espresso", requestId: "req_repeat_01" });
    expect(await finished(alice, "buy")).toMatchObject({ status: "failed", reason: "duplicate_request" });
    const purchases = (await ledger(context.server, characterId)).filter((t) => t.category === "purchase");
    expect(purchases).toHaveLength(1);
    await lifeAfter(alice, (l) => l.money.balanceCents === START_PLUS_DAY - 150, "charged once");
  });

  it("charges only for the order that reaches the counter when requests are sent in a burst", async () => {
    const alice = track(await joinWithNewCharacter(context.server.url, "Burst"));
    const characterId = characterIdOf(alice);
    for (let i = 0; i < 5; i++) {
      alice.room.send(ClientMessage.Interact, { targetKind: "object", targetId: "cafe-counter", action: "buy", itemId: "cornetto", requestId: `req_burst_0${i}` });
    }
    await waitFor(() => alice.actions.some((u) => u.status === "completed" && u.action === "buy"), 10_000, "one order served");
    await sleep(500);
    expect((await ledger(context.server, characterId)).filter((t) => t.category === "purchase")).toHaveLength(1);
  });

  it("rejects unknown items and missing item ids", async () => {
    const alice = track(await joinWithNewCharacter(context.server.url, "Picky"));
    expect(await act(alice, "object", "cafe-counter", "buy", { itemId: "caviar" })).toMatchObject({ status: "rejected", reason: "unknown_item" });
    expect(await act(alice, "object", "cafe-counter", "buy")).toMatchObject({ status: "rejected", reason: "unknown_item" });
  });

  it("refuses to study when too tired, until an espresso helps", async () => {
    const first = track(await joinWithNewCharacter(context.server.url, "Sleepy"));
    const token = await leaveWithNeeds(context.server, first, { energy: 5 });
    const alice = track(await connectAndPlay(context.server.url, token));
    await lifeAfter(alice, (l) => l.needs.energy < 6, "tired on entry");
    expect(await act(alice, "object", "desk-1", "study")).toMatchObject({ status: "rejected", reason: "too_tired" });
    await act(alice, "object", "cafe-counter", "buy", { itemId: "espresso" });
    expect(await finished(alice, "buy")).toMatchObject({ status: "completed" });
    await lifeAfter(alice, (l) => l.needs.energy >= 19, "espresso energy");
    expect((await act(alice, "object", "desk-1", "study")).status).toBe("queued");
  });

  it("greeting lifts both players' social need and the greeter's communication", async () => {
    const alice = track(await joinWithNewCharacter(context.server.url, "Alice"));
    const bruno = track(await joinWithNewCharacter(context.server.url, "Bruno"));
    await waitFor(() => alice.room.state.players?.get(bruno.room.sessionId) !== undefined, 3000, "Bruno visible");
    expect((await act(alice, "player", bruno.room.sessionId, "greet")).status).toMatch(/queued|started/);
    const greeter = await lifeAfter(alice, (l) => l.skills.communication.xp > 0, "communication XP");
    expect(greeter.needs.social).toBeGreaterThan(80);
    expect(greeter.mood.reasons.map((r) => r.label)).toContain("Friendly hello");
    const greeted = await lifeAfter(bruno, (l) => l.mood.reasons.some((r) => r.label === "Someone said hello"), "greeted mood");
    expect(greeted.needs.social).toBeGreaterThan(75);
  });

  it("sketching improves creativity and fun; washing at the fountain freshens up", async () => {
    const first = track(await joinWithNewCharacter(context.server.url, "Artist"));
    const token = await leaveWithNeeds(context.server, first, { hygiene: 20, fun: 30 });
    const alice = track(await connectAndPlay(context.server.url, token));
    await lifeAfter(alice, (l) => l.needs.hygiene < 21, "grubby on entry");
    await act(alice, "object", "bench-2", "sketch");
    expect(await finished(alice, "sketch")).toMatchObject({ status: "completed" });
    const sketched = await lifeAfter(alice, (l) => l.skills.creativity.xp > 0, "creativity XP");
    expect(sketched.needs.fun).toBeGreaterThan(40);
    await act(alice, "object", "fountain", "wash");
    expect(await finished(alice, "wash")).toMatchObject({ status: "completed" });
    await lifeAfter(alice, (l) => l.needs.hygiene > 55, "washed");
  });

  it("an organised character learns about 20% more from the same study session", async () => {
    const plain = track(await joinWithNewCharacter(context.server.url, "Plain"));
    const organised = track(await joinWithNewCharacter(context.server.url, "Tidy", undefined, ["organised"]));
    expect((await lifeAfter(organised, () => true, "traits")).traits).toEqual(["organised"]);
    await Promise.all([act(plain, "object", "desk-1", "study"), act(organised, "object", "desk-2", "study")]);
    await Promise.all([finished(plain, "study"), finished(organised, "study")]);
    const a = (await lifeAfter(plain, (l) => l.skills.academic.xp > 0, "plain XP")).skills.academic.xp;
    const b = (await lifeAfter(organised, (l) => l.skills.academic.xp > 0, "organised XP")).skills.academic.xp;
    expect(b / a).toBeGreaterThan(1.15);
    expect(b / a).toBeLessThan(1.25);
  });

  it("keeps life data private: other players never receive it", async () => {
    const alice = track(await joinWithNewCharacter(context.server.url, "Private"));
    const bruno = track(await joinWithNewCharacter(context.server.url, "Watcher"));
    await act(alice, "object", "cafe-counter", "buy", { itemId: "espresso" });
    await finished(alice, "buy");
    await sleep(300);
    const seen = bruno.room.state.players?.get(alice.room.sessionId);
    const fields = Object.keys(seen.toJSON());
    for (const secret of ["hunger", "energy", "needs", "skills", "balanceCents", "money", "traits"]) expect(fields).not.toContain(secret);
    // Bruno only ever receives his own wallet: starting money, then the daily allowance. Never Alice's purchase.
    expect(bruno.lives.length).toBeGreaterThan(0);
    expect(bruno.lives.every((l) => [10_000, START_PLUS_DAY].includes(l.money.balanceCents))).toBe(true);
    expect(bruno.lives.some((l) => l.money.recent.some((t) => t.category === "purchase"))).toBe(false);
  });
});

describe("not enough money", () => {
  const { context, track } = useLifeServer(2622, { startingBalanceCents: 100, dailyAllowanceCents: 0 });

  it("refuses a purchase the balance can't cover before walking, and charges nothing", async () => {
    const alice = track(await joinWithNewCharacter(context.server.url, "Broke"));
    await lifeAfter(alice, (l) => l.money.balanceCents === 100, "€1 balance");
    expect(await act(alice, "object", "cafe-counter", "buy", { itemId: "panino" })).toMatchObject({ status: "rejected", reason: "insufficient_funds" });
    expect(await act(alice, "object", "cafe-counter", "buy", { itemId: "espresso" })).toMatchObject({ status: "rejected", reason: "insufficient_funds" });
    const life = await lifeAfter(alice, (l) => l.mood.reasons.some((r) => r.label === "Couldn't afford it"), "mood event");
    expect(life.money.balanceCents).toBe(100);
    expect((await ledger(context.server, characterIdOf(alice))).filter((t) => t.category === "purchase")).toHaveLength(0);
  });
});

describe("cancelling while paying", () => {
  // Purchases are slowed down so the player can cancel while the payment is in progress.
  const slowPurchases = async (): Promise<Database> => {
    const db = await migratedTestDatabase();
    return Object.assign(Object.create(db) as Database, {
      transaction<T>(fn: (tx: Parameters<Parameters<Database["transaction"]>[0]>[0]) => Promise<T>) {
        return db.transaction((tx) =>
          fn({
            async query(sql: string, params?: unknown[]) {
              if (sql.includes("INSERT INTO wallet_transactions") && params?.[3] === "purchase") await sleep(600);
              return tx.query(sql, params);
            },
          } as typeof tx),
        );
      },
    });
  };
  const { context, track } = useLifeServer(2623, {}, slowPurchases);

  it("refunds an order abandoned during payment", async () => {
    const alice = track(await joinWithNewCharacter(context.server.url, "Changed Mind"));
    const characterId = characterIdOf(alice);
    await lifeAfter(alice, (l) => l.money.balanceCents === START_PLUS_DAY, "starting money");
    await act(alice, "object", "cafe-counter", "buy", { itemId: "panino" });
    await waitFor(() => me(alice)?.activity === "ordering", 8000, "paying at the counter");
    alice.room.send(ClientMessage.CancelAction);
    expect(await finished(alice, "buy")).toMatchObject({ status: "cancelled", reason: "cancelled" });
    await sleep(1500);
    const rows = await ledger(context.server, characterId);
    expect(rows.filter((t) => t.category === "purchase")).toHaveLength(1);
    expect(rows.filter((t) => t.category === "refund")).toMatchObject([{ direction: "income", amount_cents: 450, item_id: "panino" }]);
    await lifeAfter(alice, (l) => l.money.balanceCents === START_PLUS_DAY && l.money.recent[0]?.category === "refund", "refund visible");
    expect(me(alice).activity).toBe("idle");
  });
});

describe("time", () => {
  // 600 game minutes per real minute: one game hour every 6 real seconds.
  const { context, track } = useLifeServer(2624, { timeScale: 600 });

  it("needs fall with the server's game clock, not with client frames", async () => {
    const alice = track(await joinWithNewCharacter(context.server.url, "Clockwatcher"));
    const start = await lifeAfter(alice, () => true, "first life");
    const minuteAtStart = alice.room.state.gameMinute;
    const t0 = Date.now();
    await sleep(3000);
    const later = alice.lastLife()!;
    const gameHours = ((Date.now() - t0) / 60_000) * 600 / 60;
    const expectedDrop = 6 * gameHours;
    expect(start.needs.hunger - later.needs.hunger).toBeGreaterThan(expectedDrop * 0.6);
    expect(start.needs.hunger - later.needs.hunger).toBeLessThan(expectedDrop * 1.3);
    expect(alice.room.state.gameMinute - minuteAtStart).toBeGreaterThanOrEqual(25);
  });
});

describe("offline", () => {
  const { context, track } = useLifeServer(2625);

  it("applies at most 8 game hours, at half rate, never below 35, and counts as rest", async () => {
    const first = track(await joinWithNewCharacter(context.server.url, "Traveller"));
    // Saved 30 real hours ago: far beyond the 8 game hour cap.
    const token = await leaveWithNeeds(context.server, first, { hunger: 80, energy: 20, hygiene: 36, social: 30, fun: 70 }, 30 * 3_600_000);
    const back = track(await connectAndPlay(context.server.url, token));
    const life = await lifeAfter(back, () => true, "life after a long absence");
    expect(life.needs.hunger).toBeCloseTo(56, 0); // 80 − 6 × 0.5 × 8
    expect(life.needs.energy).toBeCloseTo(90, 0); // rested, capped at 90
    expect(life.needs.hygiene).toBeCloseTo(35, 0); // floored
    expect(life.needs.social).toBeCloseTo(30, 0); // already below the floor: untouched
    expect(life.needs.fun).toBeCloseTo(50, 0); // 70 − 5 × 0.5 × 8
  });
});

describe("daily allowance", () => {
  // One game day every 6 real seconds.
  const { context, track } = useLifeServer(2626, { timeScale: 14_400 });

  it("is paid once per game day while playing", async () => {
    const alice = track(await joinWithNewCharacter(context.server.url, "Saver"));
    const characterId = characterIdOf(alice);
    const allowances = async () => (await ledger(context.server, characterId)).filter((t) => t.category === "allowance").length;
    const startDay = gameDayOf(alice.room.state.gameMinute);
    await sleep(6_500);
    expect(gameDayOf(alice.room.state.gameMinute)).toBeGreaterThan(startDay);
    // Starting allowance + one per game day seen.
    const days = gameDayOf(alice.room.state.gameMinute) - startDay + 1;
    await sleep(300);
    expect(await allowances()).toBe(1 + days);
    await alice.room.leave(true);
    await sleep(200);
    const again = track(await connectAndPlay(context.server.url, alice.guestToken));
    await lifeAfter(again, () => true, "life after rejoining");
    await sleep(300);
    const sameDay = gameDayOf(again.room.state.gameMinute) === gameDayOf(alice.room.state.gameMinute);
    if (sameDay) expect(await allowances()).toBe(1 + days); // no second payment for the same day
  });
});
