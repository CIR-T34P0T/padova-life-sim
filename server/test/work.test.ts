// M7 work through the real room, real database (in-memory PGlite) and real
// WebSocket clients: hiring, a shift from start to wage, unpaid early ends,
// limits, two employees at once, quitting, persistence and privacy.

import type { Room } from "@colyseus/sdk";
import { ClientMessage, ECONOMY_CONFIG, JOBS, gameMinuteAt, xpForLevel, type ActionUpdatePayload, type LifePayload } from "@padova/shared";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "../src/db/database.ts";
import type { TuningOverrides } from "../src/tuning.ts";
import { connectAndPlay, joinWithNewCharacter, sleep, startTestServer, waitFor, type ProfileClient, type TestServer } from "./helpers/gameClient.ts";
import { migratedTestDatabase } from "./helpers/testDatabase.ts";

const SHIFT_MS = 1_200;

/** A clock offset that makes the game time read `hours`:00 now (the day is whatever today is). */
function clockAt(hours: number): number {
  const now = gameMinuteAt(Date.now());
  return Math.round(Math.floor(now / 1440) * 1440 + hours * 60 - now);
}

const FAST: TuningOverrides = {
  walkSpeed: 9,
  actionDurationsMs: { study: 800, sketch: 600, wash: 400, greet: 300, work: SHIFT_MS },
  consumeDurationFactor: 0.06,
  clockOffsetMinutes: clockAt(10),
};

function useWorkServer(port: number, tuning: TuningOverrides = {}, db?: () => Promise<Database>) {
  const context = { server: undefined as unknown as TestServer };
  const rooms: Room[] = [];
  beforeAll(async () => {
    context.server = await startTestServer(port, { ...FAST, ...tuning }, db ? await db() : undefined);
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
const stateOf = (viewer: ProfileClient, sessionId: string): any => viewer.room.state.players.get(sessionId);
const characterIdOf = (client: ProfileClient) => client.profiles.find((p) => p.profile)!.profile!.characterId;
const seatOwner = (viewer: ProfileClient, seatId: string): string | undefined => viewer.room.state.seats.get(seatId);

/** Sends an interaction and returns the first update that answers it. */
async function act(client: ProfileClient, action: string, extra: object = {}): Promise<ActionUpdatePayload> {
  const seen = client.actions.length;
  client.room.send(ClientMessage.Interact, { targetKind: "object", targetId: "cafe-counter", action, ...extra });
  await waitFor(() => client.actions.length > seen, 4000, `reply to ${action}`);
  return client.actions[seen]!;
}

/** Waits for an action to end and returns how it ended. */
async function ended(client: ProfileClient, action: string, from: number, timeoutMs = 10_000): Promise<ActionUpdatePayload> {
  const done = (u: ActionUpdatePayload) => u.action === action && ["completed", "failed", "cancelled"].includes(u.status);
  await waitFor(() => client.actions.slice(from).some(done), timeoutMs, `${action} ended`);
  return client.actions.slice(from).find(done)!;
}

async function started(client: ProfileClient, action: string, from: number): Promise<ActionUpdatePayload> {
  await waitFor(() => client.actions.slice(from).some((u) => u.action === action && u.status === "started"), 6000, `${action} started`);
  return client.actions.slice(from).find((u) => u.action === action && u.status === "started")!;
}

async function lifeWhere(client: ProfileClient, predicate: (life: LifePayload) => boolean, what: string): Promise<LifePayload> {
  await waitFor(() => client.lives.some(predicate), 6000, what);
  return [...client.lives].reverse().find(predicate)!;
}

async function hire(client: ProfileClient): Promise<void> {
  const from = client.actions.length;
  expect((await act(client, "ask_work")).status).toBe("queued");
  expect((await ended(client, "ask_work", from)).status).toBe("completed");
  await lifeWhere(client, (life) => life.job?.jobId === "cafe", "hired");
}

/** Works one full shift and returns how it ended. */
async function workShift(client: ProfileClient): Promise<ActionUpdatePayload> {
  const from = client.actions.length;
  const reply = await act(client, "work");
  if (reply.status === "rejected") return reply;
  return ended(client, "work", from);
}

const count = async (server: TestServer, sql: string, params: unknown[]) => (await server.db.query<{ n: number }>(sql, params)).rows[0]!.n;
const wages = (server: TestServer, characterId: string) =>
  count(server, `SELECT count(*)::int AS n FROM wallet_transactions WHERE character_id = $1 AND category = 'wage'`, [characterId]);
const shifts = (server: TestServer, characterId: string) => count(server, `SELECT count(*)::int AS n FROM work_shifts WHERE character_id = $1`, [characterId]);

describe("a first job at the café", () => {
  const { context, track } = useWorkServer(2631);

  it("hires at the counter, works a shift at a staff spot, and pays the wage once", async () => {
    const marta = track(await joinWithNewCharacter(context.server.url, "Marta"));
    const watcher = track(await joinWithNewCharacter(context.server.url, "Watcher"));
    const start = await lifeWhere(marta, () => true, "first life");
    expect(start.job).toBeNull();
    await hire(marta);

    const from = marta.actions.length;
    const before = marta.lastLife()!;
    expect((await act(marta, "work")).status).toBe("queued");
    const begun = await started(marta, "work", from);
    expect(begun.durationMs).toBe(SHIFT_MS);
    // At a staff spot behind the counter, and everyone sees the activity.
    await waitFor(() => stateOf(watcher, marta.room.sessionId)?.activity === "working", 2000, "watcher sees working");
    const spot = [...watcher.room.state.seats.entries()].find(([, owner]) => owner === marta.room.sessionId)?.[0];
    expect(spot).toMatch(/^cafe-counter\/staff-/);
    expect(stateOf(watcher, marta.room.sessionId).z).toBeGreaterThan(10.4);

    expect((await ended(marta, "work", from)).status).toBe("completed");
    const after = await lifeWhere(marta, (life) => (life.job?.shiftsToday ?? 0) === 1 && life.money.balanceCents > before.money.balanceCents, "paid");
    expect(after.money.balanceCents - before.money.balanceCents).toBe(600);
    expect(after.money.recent[0]).toMatchObject({ direction: "income", category: "wage", amountCents: 600, description: "Wage: Café assistant" });
    expect(after.skills.communication.xp).toBeGreaterThan(before.skills.communication.xp + 7); // +10 base, mood and traits apply
    expect(after.needs.energy).toBeLessThan(before.needs.energy);
    expect(after.mood.events.map((e) => e.id)).toContain("good_days_work");
    await waitFor(() => stateOf(watcher, marta.room.sessionId)?.activity === "idle", 2000, "back to idle");
    expect(spot && seatOwner(watcher, spot)).toBeUndefined();

    const id = characterIdOf(marta);
    expect(await wages(context.server, id)).toBe(1);
    expect(await shifts(context.server, id)).toBe(1);
  });

  it("pays nothing for a shift that is cancelled, walked away from, or ended by leaving", async () => {
    const ivo = track(await joinWithNewCharacter(context.server.url, "Ivo"));
    await hire(ivo);
    const id = characterIdOf(ivo);
    const balance = () => ivo.lastLife()!.money.balanceCents;
    const startBalance = balance();

    let from = ivo.actions.length;
    await act(ivo, "work");
    await started(ivo, "work", from);
    ivo.room.send(ClientMessage.CancelAction);
    expect(await ended(ivo, "work", from)).toMatchObject({ status: "cancelled", reason: "cancelled" });

    from = ivo.actions.length;
    await act(ivo, "work");
    await started(ivo, "work", from);
    ivo.room.send(ClientMessage.MoveTo, { x: 4, z: 13 });
    expect(await ended(ivo, "work", from)).toMatchObject({ status: "cancelled", reason: "interrupted" });

    await sleep(SHIFT_MS + 300);
    expect(balance()).toBe(startBalance);
    expect(await wages(context.server, id)).toBe(0);

    // Leaving mid-shift: back in, nothing was paid and the job is still there.
    from = ivo.actions.length;
    await act(ivo, "work");
    await started(ivo, "work", from);
    await ivo.room.leave(true);
    await sleep(SHIFT_MS + 400);
    const back = track(await connectAndPlay(context.server.url, ivo.guestToken));
    const life = await lifeWhere(back, () => true, "life after return");
    expect(life.job).toEqual({ jobId: "cafe", shiftsToday: 0 });
    expect(life.money.balanceCents).toBe(startBalance);
    expect(await wages(context.server, id)).toBe(0);
    expect(await shifts(context.server, id)).toBe(0);
  });

  it("pays nothing for a shift cut short by a network drop", async () => {
    const nora = track(await joinWithNewCharacter(context.server.url, "Nora"));
    await hire(nora);
    const id = characterIdOf(nora);
    const from = nora.actions.length;
    await act(nora, "work");
    await started(nora, "work", from);
    nora.room.reconnection.minUptime = 0;
    const reconnected = new Promise<void>((resolve) => nora.room.onReconnect(() => resolve()));
    nora.room.connection.close(4010, "simulated network drop");
    await reconnected;
    await sleep(SHIFT_MS + 300);
    expect(await wages(context.server, id)).toBe(0);
    expect(stateOf(nora, nora.room.sessionId).activity).toBe("idle");
    // The job itself survives the drop, and the next full shift is paid.
    expect(nora.lastLife()!.job).toEqual({ jobId: "cafe", shiftsToday: 0 });
    expect((await workShift(nora)).status).toBe("completed");
    expect(await wages(context.server, id)).toBe(1);
  });

  it("pays the barista wage from communication level 2, decided when the shift starts", async () => {
    const [assistant, barista] = JOBS.cafe.grades;
    const ada = track(await joinWithNewCharacter(context.server.url, "Ada"));
    await hire(ada);
    const id = characterIdOf(ada);
    await ada.room.leave(true);
    await sleep(300);
    await context.server.db.query(
      `INSERT INTO character_skills (character_id, skill, xp) VALUES ($1, 'communication', $2)
       ON CONFLICT (character_id, skill) DO UPDATE SET xp = EXCLUDED.xp`,
      [id, xpForLevel(barista!.requires!.level)],
    );
    const back = track(await connectAndPlay(context.server.url, ada.guestToken));
    await lifeWhere(back, (life) => life.skills.communication.level >= 2, "communication level 2");
    expect((await workShift(back)).status).toBe("completed");
    const wage = (await lifeWhere(back, (life) => life.money.recent.some((t) => t.category === "wage"), "wage")).money.recent.find((t) => t.category === "wage")!;
    expect(wage).toMatchObject({ description: "Wage: Barista", amountCents: barista!.wageCents });
    expect(barista!.wageCents).toBeGreaterThan(assistant!.wageCents);
    const stored = await context.server.db.query<{ grade: string; wage_cents: number }>(`SELECT grade, wage_cents FROM work_shifts WHERE character_id = $1`, [id]);
    expect(stored.rows).toEqual([{ grade: "barista", wage_cents: barista!.wageCents }]);
  });

  it("allows four completed shifts per game day and refuses the fifth", async () => {
    const bea = track(await joinWithNewCharacter(context.server.url, "Bea"));
    await hire(bea);
    for (let i = 1; i <= 4; i++) {
      expect((await workShift(bea)).status, `shift ${i}`).toBe("completed");
      // Rest between shifts would be needed in play; here energy simply stays high enough.
    }
    await lifeWhere(bea, (life) => life.job?.shiftsToday === 4, "four shifts");
    expect(await workShift(bea)).toMatchObject({ status: "rejected", reason: "shift_limit" });
    expect(await wages(context.server, characterIdOf(bea))).toBe(4);
    expect(bea.lastLife()!.money.recent.filter((t) => t.category === "wage")).toHaveLength(4);
  });

  it("refuses to hire someone who already works there, and refuses shifts to someone who doesn't", async () => {
    const luca = track(await joinWithNewCharacter(context.server.url, "Luca"));
    expect(await workShift(luca)).toMatchObject({ status: "rejected", reason: "not_employed" });
    await hire(luca);
    expect(await act(luca, "ask_work")).toMatchObject({ status: "rejected", reason: "already_employed" });
  });

  it("refuses to start a shift when too tired", async () => {
    const tia = track(await joinWithNewCharacter(context.server.url, "Tia"));
    await hire(tia);
    const id = characterIdOf(tia);
    await tia.room.leave(true);
    await sleep(300);
    await context.server.db.query(`UPDATE character_needs SET energy = 5, updated_at = now() WHERE character_id = $1`, [id]);
    const back = track(await connectAndPlay(context.server.url, tia.guestToken));
    await lifeWhere(back, (life) => life.needs.energy < 10, "tired");
    expect(await workShift(back)).toMatchObject({ status: "rejected", reason: "too_tired" });
  });

  it("quits: a shift in progress ends unpaid, the job is gone, and asking again hires again", async () => {
    const eli = track(await joinWithNewCharacter(context.server.url, "Eli"));
    await hire(eli);
    const id = characterIdOf(eli);
    const from = eli.actions.length;
    await act(eli, "work");
    await started(eli, "work", from);
    eli.room.send(ClientMessage.QuitJob);
    expect(await ended(eli, "work", from)).toMatchObject({ status: "cancelled" });
    await lifeWhere(eli, (life) => life.job === null, "job gone");
    expect(await count(context.server, `SELECT count(*)::int AS n FROM character_employment WHERE character_id = $1`, [id])).toBe(0);
    await sleep(SHIFT_MS);
    expect(await wages(context.server, id)).toBe(0);
    expect(await workShift(eli)).toMatchObject({ status: "rejected", reason: "not_employed" });
    await hire(eli);
    // A second quit message with no job changes nothing.
    eli.room.send(ClientMessage.QuitJob);
    await lifeWhere(eli, (life) => life.job === null, "quit again");
    eli.room.send(ClientMessage.QuitJob);
    await sleep(300);
    expect(eli.lastLife()!.job).toBeNull();
  });

  it("never shows a job or pay to anyone else", async () => {
    const owner = track(await joinWithNewCharacter(context.server.url, "Owner"));
    const other = track(await joinWithNewCharacter(context.server.url, "Other"));
    const seenByOther: unknown[] = [];
    other.room.onMessage("*", (type, payload) => seenByOther.push({ type, payload }));
    await hire(owner);
    expect((await workShift(owner)).status).toBe("completed");
    await sleep(300);
    const text = JSON.stringify(seenByOther);
    expect(text).not.toContain("Wage");
    expect(text).not.toContain("cafe\"");
    // Every life message the other player received describes the other player only.
    expect(other.lives.every((life) => life.job === null)).toBe(true);
    // The replicated player has no job, grade or pay fields.
    const replicated = JSON.stringify(stateOf(other, owner.room.sessionId).toJSON());
    expect(replicated).not.toMatch(/job|wage|grade|shift/i);
  });

  it("pays the daily allowance at the halved rate", async () => {
    expect(ECONOMY_CONFIG.dailyAllowanceCents).toBe(750);
  });
});

describe("two employees and customers at the counter", () => {
  const { context, track } = useWorkServer(2632, { actionDurationsMs: { work: 4_000 } });

  it("lets two employees work on the two staff spots, tells a third it's busy, and still serves customers", async () => {
    const [a, b, c, customer] = [
      track(await joinWithNewCharacter(context.server.url, "Staff A")),
      track(await joinWithNewCharacter(context.server.url, "Staff B")),
      track(await joinWithNewCharacter(context.server.url, "Staff C")),
      track(await joinWithNewCharacter(context.server.url, "Customer")),
    ];
    for (const worker of [a, b, c]) await hire(worker);
    const fromA = a.actions.length;
    const fromB = b.actions.length;
    // Both ask at the same moment: each gets its own spot.
    const [replyA, replyB] = await Promise.all([act(a, "work"), act(b, "work")]);
    expect([replyA.status, replyB.status]).toEqual(["queued", "queued"]);
    await Promise.all([started(a, "work", fromA), started(b, "work", fromB)]);
    expect(seatOwner(customer, "cafe-counter/staff-a")).toBeDefined();
    expect(seatOwner(customer, "cafe-counter/staff-b")).toBeDefined();
    expect(new Set([seatOwner(customer, "cafe-counter/staff-a"), seatOwner(customer, "cafe-counter/staff-b")])).toEqual(new Set([a.room.sessionId, b.room.sessionId]));
    expect(await act(c, "work")).toMatchObject({ status: "rejected", reason: "busy" });

    const fromCustomer = customer.actions.length;
    expect((await act(customer, "buy", { itemId: "espresso", requestId: "req_work_test_1" })).status).toBe("queued");
    expect((await ended(customer, "buy", fromCustomer)).status).toBe("completed");
    expect((await ended(a, "work", fromA)).status).toBe("completed");
    expect((await ended(b, "work", fromB)).status).toBe("completed");
  });
});

describe("the café at night", () => {
  const { context, track } = useWorkServer(2633, { clockOffsetMinutes: clockAt(3) });

  it("hires at any hour but refuses shifts while closed", async () => {
    const owl = track(await joinWithNewCharacter(context.server.url, "Owl"));
    await hire(owl);
    expect(await workShift(owl)).toMatchObject({ status: "rejected", reason: "closed" });
    expect(await wages(context.server, characterIdOf(owl))).toBe(0);
  });
});

describe("work across a server restart", () => {
  let db: Database;
  beforeAll(async () => {
    db = await migratedTestDatabase();
  });
  afterAll(async () => {
    await db.close();
  });

  it("keeps the job, today's shifts and the wage after the server restarts", async () => {
    const first = await startTestServer(2634, FAST, db);
    const sam = await joinWithNewCharacter(first.url, "Sam");
    await hire(sam);
    expect((await workShift(sam)).status).toBe("completed");
    await lifeWhere(sam, (life) => life.job?.shiftsToday === 1, "one shift");
    await sam.room.leave(true);
    await first.stop();

    // A new server process on the same database (its own port, as the old one may still be closing).
    const second = await startTestServer(2635, FAST, db);
    try {
      const back = await connectAndPlay(second.url, sam.guestToken);
      const life = await lifeWhere(back, () => true, "life after restart");
      expect(life.job).toEqual({ jobId: "cafe", shiftsToday: 1 });
      expect(life.money.recent.some((t) => t.category === "wage" && t.amountCents === 600)).toBe(true);
      await back.room.leave(true);
    } finally {
      await second.stop();
    }
  });
});
