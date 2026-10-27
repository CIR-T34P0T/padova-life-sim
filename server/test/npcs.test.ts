// Non-player characters (M11) through the real room, database (in-memory
// PGlite) and WebSocket clients, at fast time scales: the barista arrives
// from her street and works unpaid shifts at a staff spot; students follow
// their timetable through doors into the lecture room and the library; no
// two characters ever share a seat; a greeted NPC answers (and can't be
// chatted with); an NPC whose day is over walks off; nothing about NPCs is
// saved; the tick stays within its budget. Plus the hooks that keep NPCs
// unpaid and unsaved.

import type { Room } from "@colyseus/sdk";
import { matchMaker } from "@colyseus/core";
import { ClientMessage, NPC_CONFIG, PLAZA_AREA, clockOffsetFor, isNpcSessionId, npcSessionId, type ActionUpdatePayload } from "@padova/shared";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { InteractionHooks } from "../src/InteractionSystem.ts";
import { withNpcs } from "../src/npc/npcHooks.ts";
import type { PlazaRoom } from "../src/PlazaRoom.ts";
import type { PendingAction } from "../src/runtime.ts";
import type { TuningOverrides } from "../src/tuning.ts";
import { joinWithNewCharacter, sleep, startTestServer, waitFor, type ProfileClient, type TestServer } from "./helpers/gameClient.ts";

const MONDAY = 0;
const GIULIA = npcSessionId("giulia");
const MARCO = npcSessionId("marco");
const SOFIA = npcSessionId("sofia");
const DURATIONS = { study: 800, sketch: 800, wash: 400, greet: 300, work: 1_200, attend: 1_000, exam: 1_200, chat: 800, sleep: 1_500 };

function useServer(port: number, makeTuning: () => TuningOverrides) {
  const context = { server: undefined as unknown as TestServer };
  const rooms: Room[] = [];
  beforeAll(async () => {
    context.server = await startTestServer(port, { npcs: true, walkSpeed: 9, actionDurationsMs: DURATIONS, ...makeTuning() });
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

/** The room itself (same process), to see NPCs in every area and the tick time. */
const roomOf = (client: ProfileClient) => matchMaker.getLocalRoomById(client.room.roomId) as unknown as PlazaRoom & { state: any };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const npcState = (room: PlazaRoom & { state: any }, id: string): any => room.state.players.get(id);

/** Every seated character's seat, each seat held by one character only (checked on the server's own state). */
function seatsAreSingle(room: PlazaRoom & { state: any }): boolean {
  const seen = new Map<string, number>();
  room.state.players.forEach((p: { seatId: string }) => {
    if (p.seatId) seen.set(p.seatId, (seen.get(p.seatId) ?? 0) + 1);
  });
  return [...seen.values()].every((n) => n === 1);
}

describe("the barista (Monday 06:35, 1 game minute per real second)", () => {
  const { context, track } = useServer(2643, () => ({ timeScale: 60, clockOffsetMinutes: clockOffsetFor(Date.now(), MONDAY, 6, 35, 60) }));

  it("arrives from her street, works unpaid shifts at a staff spot, is shown with her role, and is never saved", async () => {
    const ada = track(await joinWithNewCharacter(context.server.url, "Ada"));
    const room = roomOf(ada);
    expect(npcState(room, GIULIA)).toBeUndefined(); // before 06:45
    await waitFor(() => npcState(room, GIULIA) !== undefined, 20_000, "Giulia arrives");
    // Players in the square see her, with her role.
    await waitFor(() => ada.room.state.players.get(GIULIA) !== undefined, 4_000, "Ada sees Giulia");
    expect(ada.room.state.players.get(GIULIA)).toMatchObject({ name: "Giulia", role: "Barista", area: PLAZA_AREA, connected: true });
    expect(ada.room.state.players.get(ada.room.sessionId).role).toBe("");
    await waitFor(() => npcState(room, GIULIA)?.activity === "working", 15_000, "Giulia working");
    expect(npcState(room, GIULIA).seatId).toBe("");
    const spot = [...room.state.seats.entries()].find(([, holder]: [string, string]) => holder === GIULIA)?.[0];
    expect(spot).toMatch(/^cafe-counter\/staff-/);
    // After a shift she starts the next one.
    await waitFor(() => npcState(room, GIULIA)?.activity !== "working", 6_000, "a shift ends");
    await waitFor(() => npcState(room, GIULIA)?.activity === "working", 8_000, "the next shift");
    // Nothing about her is in the database: no character, no wage.
    const characters = await context.server.db.query<{ n: number }>(`SELECT count(*)::int AS n FROM characters`);
    expect(characters.rows[0]!.n).toBe(1);
    const wages = await context.server.db.query<{ n: number }>(`SELECT count(*)::int AS n FROM wallet_transactions WHERE category = 'wage'`);
    expect(wages.rows[0]!.n).toBe(0);
  });

  it("answers a greeting with a line (the greeter gets the usual greeting effect) and can't be chatted with", async () => {
    const ben = track(await joinWithNewCharacter(context.server.url, "Ben"));
    await waitFor(() => ben.room.state.players.get(GIULIA) !== undefined, 8_000, "Ben sees Giulia");
    const socialBefore = ben.lastLife()!.needs.social;
    ben.room.send(ClientMessage.Interact, { targetKind: "player", targetId: GIULIA, action: "greet" });
    await waitFor(() => ben.received("greeted").some((g) => g.fromId === GIULIA), 10_000, "Giulia answers");
    const reply = ben.received("greeted").find((g) => g.fromId === GIULIA);
    expect(reply).toMatchObject({ fromName: "Giulia", action: "greet" });
    expect(typeof reply.line).toBe("string");
    await waitFor(() => ben.lastLife()!.needs.social > socialBefore, 4_000, "Ben's social need rises");
    const from = ben.actions.length;
    ben.room.send(ClientMessage.Interact, { targetKind: "player", targetId: GIULIA, action: "chat" });
    await waitFor(() => ben.actions.length > from, 4_000, "chat answered");
    expect(ben.actions[from]).toMatchObject({ status: "rejected", reason: "action_not_available" } satisfies Partial<ActionUpdatePayload>);
  });
});

describe("students at lecture time (Monday 08:50, 10 game minutes per real second)", () => {
  const { context, track } = useServer(2644, () => ({ timeScale: 600, clockOffsetMinutes: clockOffsetFor(Date.now(), MONDAY, 8, 50, 600) }));

  it("walk through the hall's door to the lecture room and study at their desk; never two on one seat; players elsewhere don't see them", async () => {
    const ada = track(await joinWithNewCharacter(context.server.url, "Ada"));
    const room = roomOf(ada);
    let shared = false;
    const watch = setInterval(() => {
      if (!seatsAreSingle(room)) shared = true;
    }, 50);
    try {
      await waitFor(() => npcState(room, MARCO)?.area === "hall/lecture-room" && npcState(room, MARCO)?.seatId?.startsWith("lecture-desk-3b/"), 20_000, "Marco at his lecture desk");
      await waitFor(() => npcState(room, MARCO)?.activity === "studying", 6_000, "Marco studying");
      await waitFor(() => npcState(room, SOFIA)?.area === "hall/lecture-room" && npcState(room, SOFIA)?.seatId?.startsWith("lecture-desk-3b/"), 20_000, "Sofia at the same desk");
      expect(npcState(room, MARCO).seatId).not.toBe(npcState(room, SOFIA).seatId);
      // Ada is on the square: she doesn't receive the students in the lecture room.
      expect(ada.room.state.players.get(MARCO)).toBeUndefined();
      expect(shared).toBe(false);
    } finally {
      clearInterval(watch);
    }
  });
});

describe("students after lunch (Monday 13:58, 10 game minutes per real second)", () => {
  const { context, track } = useServer(2645, () => ({ timeScale: 600, clockOffsetMinutes: clockOffsetFor(Date.now(), MONDAY, 13, 58, 600) }));

  it("go to the library's reading room at 14:00 and study at their table", async () => {
    const ada = track(await joinWithNewCharacter(context.server.url, "Ada"));
    const room = roomOf(ada);
    await waitFor(() => npcState(room, MARCO)?.area === "library/reading-room" && npcState(room, MARCO)?.seatId?.startsWith("reading-table-2/"), 25_000, "Marco in the library");
    await waitFor(() => npcState(room, MARCO)?.activity === "studying", 6_000, "Marco studying");
    expect(seatsAreSingle(room)).toBe(true);
  });
});

describe("the end of the day (Monday 20:20, 1 game minute per real second)", () => {
  const { context, track } = useServer(2646, () => ({ timeScale: 60, clockOffsetMinutes: clockOffsetFor(Date.now(), MONDAY, 20, 20, 60) }));

  it("the barista stops at 20:30, walks back to her street and leaves the square", async () => {
    const ada = track(await joinWithNewCharacter(context.server.url, "Ada"));
    const room = roomOf(ada);
    await waitFor(() => npcState(room, GIULIA) !== undefined, 8_000, "Giulia present");
    await waitFor(() => npcState(room, GIULIA)?.activity === "working", 15_000, "Giulia working");
    await waitFor(() => npcState(room, GIULIA) === undefined, 40_000, "Giulia has left");
    await waitFor(() => ada.room.state.players.get(GIULIA) === undefined, 4_000, "gone for Ada too");
    expect([...room.state.seats.values()]).not.toContain(GIULIA);
  });
});

describe("the tick budget (Monday 09:00, 10 game minutes per real second, every NPC active)", () => {
  const { context, track } = useServer(2647, () => ({ timeScale: 600, clockOffsetMinutes: clockOffsetFor(Date.now(), MONDAY, 10, 0, 600) }));

  it(`averages under ${NPC_CONFIG.tickBudgetMs} ms a tick with the NPCs walking, studying and working`, async () => {
    const ada = track(await joinWithNewCharacter(context.server.url, "Ada"));
    track(await joinWithNewCharacter(context.server.url, "Ben"));
    const room = roomOf(ada);
    await waitFor(() => [...room.state.players.keys()].filter((id: string) => isNpcSessionId(id)).length >= 4, 10_000, "every NPC present");
    await sleep(6_000);
    const t = room.tickSummary();
    console.log(`[npcs] tick over ${t.ticks} ticks: ${t.avgMs.toFixed(3)} ms average, ${t.p95Ms.toFixed(3)} ms p95, ${t.maxMs.toFixed(2)} ms max, ${room.state.players.size} characters`);
    expect(t.ticks).toBeGreaterThan(100);
    expect(t.avgMs).toBeLessThan(NPC_CONFIG.tickBudgetMs);
  });
});

describe("the hooks keep NPCs unpaid and unsaved", () => {
  const pending = { action: "work" } as PendingAction;
  const life = {
    checkStart: vi.fn(() => "too_tired" as const),
    effectFor: vi.fn(() => null),
    purchase: vi.fn(async () => "ok" as const),
    refund: vi.fn(),
    onCompleted: vi.fn(),
    onGreeting: vi.fn(),
    onChatted: vi.fn(),
    jobOf: vi.fn(() => null),
    hire: vi.fn(async () => "ok" as const),
    startShift: vi.fn(() => "not_employed" as const),
    payShift: vi.fn(async () => "ok" as const),
    courseOf: vi.fn(() => null),
    enrol: vi.fn(async () => "ok" as const),
    startCourseAction: vi.fn(() => null),
    finishCourseAction: vi.fn(async () => "ok" as const),
  } satisfies InteractionHooks;
  const greeted = vi.fn();
  const hooks = withNpcs(life, { onGreeted: greeted });

  it("never charge, pay, hire, enrol or record an NPC; the barista's job and shifts need no life data", async () => {
    expect(hooks.checkStart(GIULIA, "work")).toBeNull();
    expect(hooks.jobOf(GIULIA)).toBe("cafe");
    expect(hooks.jobOf(MARCO)).toBeNull();
    expect(hooks.startShift(GIULIA, pending)).toBeNull();
    expect(await hooks.payShift(GIULIA, pending)).toBe("ok");
    expect(await hooks.purchase(GIULIA, pending)).toBe("purchase_failed");
    expect(await hooks.hire(MARCO, pending)).toBe("hire_failed");
    expect(await hooks.enrol(MARCO, pending)).toBe("enrol_failed");
    hooks.onCompleted(GIULIA, pending);
    for (const fn of [life.checkStart, life.startShift, life.payShift, life.purchase, life.hire, life.enrol, life.onCompleted]) expect(fn).not.toHaveBeenCalled();
    // Players go to the life system as before.
    expect(hooks.checkStart("player-1", "work")).toBe("too_tired");
    expect(life.checkStart).toHaveBeenCalledWith("player-1", "work", undefined);
  });

  it("give the greeter of an NPC the usual effect and let the NPC answer; NPCs start no greetings", () => {
    hooks.onGreeting("player-1", GIULIA);
    expect(life.onGreeting).toHaveBeenCalledWith("player-1", GIULIA);
    expect(greeted).toHaveBeenCalledWith(GIULIA, "player-1");
    life.onGreeting.mockClear();
    hooks.onGreeting(GIULIA, "player-1");
    expect(life.onGreeting).not.toHaveBeenCalled();
  });
});
