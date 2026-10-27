// M10 a place to live. Two parts:
//  1. Rent over the weeks, with the housing system on a game clock the test
//     moves by hand (and the real repository on PGlite): weekly rent, the
//     notice and grace period, money arriving in time, the move to a cheaper
//     room (furniture into storage, the tenant moved with them) and moving out
//     when nothing is affordable. Never debt.
//  2. Through the real room and WebSocket clients: renting at the student
//     housing's door, the home private to its tenant (others see you leave
//     the square), sleeping in the bed, furnishing, putting away, persistence
//     across a reload (back at home), going out and moving out.

import type { Room } from "@colyseus/sdk";
import {
  ClientMessage,
  DEFAULT_APPEARANCE,
  HOUSING_CONFIG,
  PROFILE_VERSION,
  cloneAppearance,
  PLAZA_AREA,
  PLAZA_LAYOUT,
  type ActionUpdatePayload,
  type FurnishResultPayload,
  type HousingPayload,
  type MoodEventId,
} from "@padova/shared";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AreaWorlds } from "../src/areas.ts";
import type { Database } from "../src/db/database.ts";
import { HousingSystem } from "../src/housing/HousingSystem.ts";
import { applyMoneyChange } from "../src/life/lifeRepository.ts";
import { createGuestWithCharacter, type Owner } from "../src/profiles/profileRepository.ts";
import type { PendingAction, PlayerRuntime } from "../src/runtime.ts";
import type { StoryInput } from "../src/social/socialRepository.ts";
import { connectAndPlay, joinWithNewCharacter, sleep, startTestServer, waitFor, type ProfileClient, type TestServer } from "./helpers/gameClient.ts";
import { migratedTestDatabase } from "./helpers/testDatabase.ts";

const minute = (day: number, hours = 10) => (day - 1) * 1440 + hours * 60;

describe("rent over the weeks (housing system on a hand-moved clock)", () => {
  const S = "session-ada";
  let db: Database;
  let owner: Owner;
  let gameMinute: number;
  let balance: number;
  let sent: { type: string; payload: any }[];
  let mood: MoodEventId[];
  let stories: StoryInput[];
  let runtimes: Map<string, PlayerRuntime>;
  let areas: AreaWorlds;
  let system: HousingSystem;

  beforeEach(async () => {
    db = await migratedTestDatabase();
    const created = await createGuestWithCharacter(
      db,
      { displayName: "Ada", ageCategory: "adult", appearance: cloneAppearance(DEFAULT_APPEARANCE), traits: [] },
      PROFILE_VERSION,
      { area: PLAZA_AREA, x: 0, z: 13, rotation: 0 },
      { startingBalanceCents: 10_000, gameMinute: minute(1) },
    );
    owner = { accountId: created.accountId, characterId: created.character.characterId };
    gameMinute = minute(1);
    balance = 10_000;
    sent = [];
    mood = [];
    stories = [];
    areas = new AreaWorlds(PLAZA_LAYOUT);
    runtimes = new Map([[S, { area: PLAZA_AREA, character: { x: 0, z: 13, rotation: 0, intent: { kind: "idle" } }, intentWindowStart: 0, intentsInWindow: 0, pending: null, lastSocialAt: new Map() }]]);
    system = new HousingSystem({
      db,
      areas,
      runtimes,
      ownerOf: () => owner,
      clock: { scale: 10, minute: () => gameMinute },
      send: (_id, type, payload) => sent.push({ type, payload }),
      life: {
        balanceOf: () => balance,
        recordMoney: (_id, cents) => {
          balance = cents;
        },
        addMood: (_id, id) => mood.push(id),
      },
      story: (_id, event) => stories.push(event),
      interrupt: () => undefined,
      relocate: (id, spot) => {
        const runtime = runtimes.get(id)!;
        runtime.area = spot.area;
        runtime.character.x = spot.x;
        runtime.character.z = spot.z;
      },
      now: () => Date.now(),
    });
    system.attach(S, owner, { home: null, storage: [] });
  });
  afterEach(async () => {
    system.detach(S);
    await db.close();
  });

  const housing = (): HousingPayload[] => sent.filter((m) => m.type === "housing").map((m) => m.payload);
  const lastHousing = () => housing().at(-1)!;
  const notices = () => housing().flatMap((h) => (h.notice ? [h.notice] : []));
  const rent = (roomType: string, requestId: string) => system.rent(S, { itemId: roomType, requestId } as PendingAction);
  /** Sets the money (the ledger and the room's copy agree, as in the real room). */
  const setBalance = async (cents: number) => {
    await db.query(`UPDATE character_wallets SET balance_cents = $2 WHERE character_id = $1`, [owner.characterId, cents]);
    balance = cents;
  };
  /** One tick at `at`, then waits for its database write (if any) to land. */
  const tickAt = async (at: number, until?: () => boolean) => {
    gameMinute = at;
    system.tick();
    if (until) await waitFor(until, 4000, "rent processed");
    else await sleep(150);
  };

  it("starts without a home; renting charges the first week, makes the home an area, and tells only its tenant", async () => {
    expect(lastHousing()).toEqual({ home: null, storage: [] });
    expect(await rent("studio", "r1")).toBe("ok");
    const home = lastHousing().home!;
    expect(home).toMatchObject({ roomType: "studio", rentCents: 8_000, paidWeek: 0, overdue: null, placements: [], cosiness: 0 });
    expect(areas.has(home.areaId)).toBe(true);
    expect(balance).toBe(2_000);
    expect(mood).toEqual(["new_home"]);
    expect(stories).toEqual([expect.objectContaining({ kind: "moved_in", details: { roomType: "studio" } })]);
    // Repeating the same request changes nothing.
    expect(await rent("studio", "r1")).toBe("ok");
    expect(balance).toBe(2_000);
    expect(mood).toEqual(["new_home"]);
    expect(await rent("studio", "r2")).toBe("same_room");
  });

  it("charges the rent once each Monday when the money is there", async () => {
    await rent("box-room", "r1");
    await tickAt(minute(7, 23));
    expect(notices()).toEqual([]);
    await tickAt(minute(8, 0) + 1, () => notices().length > 0);
    expect(notices()).toEqual([{ kind: "rent_paid", rentCents: 2_500 }]);
    expect(balance).toBe(5_000);
    expect(lastHousing().home!.paidWeek).toBe(1);
    await tickAt(minute(9));
    await tickAt(minute(14, 23));
    expect(notices()).toHaveLength(1);
    expect(balance).toBe(5_000);
  });

  it("rent that can't be paid gives a notice and a worry, and is paid as soon as the money arrives in the grace period", async () => {
    await rent("single-room", "r1");
    await setBalance(1_000);
    await tickAt(minute(8, 2), () => notices().length > 0);
    expect(notices()[0]).toEqual({ kind: "rent_overdue", rentCents: 4_500, deadlineGameMinute: minute(8, 2) + HOUSING_CONFIG.graceGameMinutes });
    expect(mood).toContain("rent_worry");
    expect(lastHousing().home!.overdue).toEqual({ sinceGameMinute: minute(8, 2), deadlineGameMinute: minute(8, 2) + HOUSING_CONFIG.graceGameMinutes });
    await tickAt(minute(8, 6));
    expect(notices()).toHaveLength(1);
    await setBalance(6_000);
    await tickAt(minute(8, 7), () => notices().length > 1);
    expect(notices()[1]).toEqual({ kind: "rent_paid", rentCents: 4_500 });
    expect(lastHousing().home).toMatchObject({ roomType: "single-room", paidWeek: 1, overdue: null });
    expect(balance).toBe(1_500);
  });

  it("after the grace period: a move to a cheaper room with the tenant and their furniture; later out, never into debt", async () => {
    await rent("studio", "r1");
    runtimes.get(S)!.area = lastHousing().home!.areaId;
    await system.furnish(S, { slot: "decor-1", itemId: "potted-plant", requestId: "plant-0001" });
    expect(sent.find((m) => m.type === "furnishResult")!.payload).toEqual({ action: "furnish", status: "ok", itemId: "potted-plant" });
    expect(lastHousing().home!.placements).toEqual([expect.objectContaining({ itemId: "potted-plant", slot: "decor-1" })]);
    expect(balance).toBe(800);
    await applyMoneyChange(db, owner, { direction: "income", category: "allowance", amountCents: 2_000, description: "test", requestKey: "gift", gameMinute: minute(5) });
    balance = 2_800;
    const studioArea = lastHousing().home!.areaId;

    await tickAt(minute(8, 1), () => notices().length > 0);
    expect(notices().at(-1)!.kind).toBe("rent_overdue");
    await tickAt(minute(8, 1) + HOUSING_CONFIG.graceGameMinutes, () => notices().length > 1);
    expect(notices().at(-1)).toEqual({ kind: "moved_cheaper", fromRoomType: "studio", roomType: "box-room", rentCents: 2_500 });
    const box = lastHousing();
    expect(box.home).toMatchObject({ roomType: "box-room", paidWeek: 1, overdue: null, placements: [] });
    expect(box.storage).toEqual([expect.objectContaining({ itemId: "potted-plant" })]);
    expect(balance).toBe(300);
    expect(mood).toContain("had_to_move");
    expect(stories.at(-1)).toMatchObject({ kind: "rent_trouble", details: { fromRoomType: "studio", roomType: "box-room" } });
    // The tenant was at home: now in the new home; the studio is gone.
    expect(runtimes.get(S)!.area).toBe(box.home!.areaId);
    expect(areas.has(studioArea)).toBe(false);

    await tickAt(minute(15, 1), () => notices().length > 2);
    expect(notices().at(-1)!.kind).toBe("rent_overdue");
    await tickAt(minute(15, 1) + HOUSING_CONFIG.graceGameMinutes, () => notices().length > 3);
    expect(notices().at(-1)).toEqual({ kind: "moved_out_unpaid", fromRoomType: "box-room" });
    expect(lastHousing().home).toBeNull();
    expect(lastHousing().storage).toHaveLength(1);
    expect(runtimes.get(S)!.area).toBe(PLAZA_AREA);
    expect(balance).toBe(300);
    const { rows } = await db.query<{ b: number }>(`SELECT balance_cents AS b FROM character_wallets WHERE character_id = $1`, [owner.characterId]);
    expect(Number(rows[0]!.b)).toBe(300);
  });

  it("refuses furnishing away from home, in the wrong spot, or with something not for sale", async () => {
    await rent("box-room", "r1");
    const results = () => sent.filter((m) => m.type === "furnishResult").map((m) => (m.payload as FurnishResultPayload).status);
    await system.furnish(S, { slot: "seat-1", itemId: "beanbag", requestId: "beanbag-01" });
    runtimes.get(S)!.area = lastHousing().home!.areaId;
    await system.furnish(S, { slot: "bed", itemId: "beanbag", requestId: "beanbag-02" });
    await system.furnish(S, { slot: "bed", itemId: "room-bed", requestId: "beanbag-03" });
    await system.furnish(S, { slot: "nowhere", itemId: "beanbag", requestId: "beanbag-04" });
    await system.furnish(S, { slot: "seat-1", itemId: "beanbag", price: 1 });
    expect(results()).toEqual(["not_home", "wrong_slot", "not_for_sale", "unknown_slot", "failed"]);
    expect(balance).toBe(7_500);
  });
});

// ── Through the real room ────────────────────────────────────────────────────

const DURATIONS = { study: 600, sketch: 600, wash: 400, greet: 300, work: 1_200, attend: 1_000, exam: 1_200, chat: 800, sleep: 1_500 };

describe("a place to live, in the room", () => {
  let server: TestServer;
  const rooms: Room[] = [];
  beforeAll(async () => {
    server = await startTestServer(2641, { walkSpeed: 9, actionDurationsMs: DURATIONS });
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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const me = (client: ProfileClient): any => client.room.state.players?.get(client.room.sessionId);
  const housingOf = (client: ProfileClient): HousingPayload | undefined => client.received("housing").at(-1);

  async function act(client: ProfileClient, targetId: string, action: string, extra: Record<string, string> = {}): Promise<ActionUpdatePayload> {
    const from = client.actions.length;
    client.room.send(ClientMessage.Interact, { targetKind: "object", targetId, action, ...extra });
    await waitFor(() => client.actions.length > from, 4000, `reply to ${action} ${targetId}`);
    if (client.actions[from]!.status === "rejected") return client.actions[from]!;
    const done = (u: ActionUpdatePayload) => u.action === action && ["completed", "failed", "cancelled"].includes(u.status);
    await waitFor(() => client.actions.slice(from).some(done), 15_000, `${action} ${targetId} ended`);
    return client.actions.slice(from).find(done)!;
  }

  async function furnishResult(client: ProfileClient, type: string, payload: unknown): Promise<FurnishResultPayload> {
    const from = client.received("furnishResult").length;
    client.room.send(type, payload);
    await waitFor(() => client.received("furnishResult").length > from, 4000, `${type} result`);
    return client.received("furnishResult").at(-1);
  }

  it("rent, live in and furnish a room, privately; it is all still there after a reload; then go out and move out", async () => {
    const ada = track(await joinWithNewCharacter(server.url, "Ada"));
    const ben = track(await joinWithNewCharacter(server.url, "Ben"));
    await waitFor(() => housingOf(ada) !== undefined && housingOf(ben) !== undefined, 4000, "housing sent");
    expect(housingOf(ada)).toEqual({ home: null, storage: [] });
    await waitFor(() => ben.room.state.players.get(ada.room.sessionId) !== undefined, 4000, "Ben sees Ada");

    // Without a home, the housing's door only offers renting.
    expect(await act(ada, "housing-door", "enter")).toMatchObject({ status: "rejected", reason: "no_home" });
    expect(await act(ada, "housing-door", "rent", { itemId: "palace" })).toMatchObject({ status: "rejected", reason: "unknown_item" });

    // Renting: charged through the ledger, and straight into the new room, out of everyone else's sight.
    expect((await act(ada, "housing-door", "rent", { itemId: "single-room", requestId: "lease-ada-1" })).status).toBe("completed");
    await waitFor(() => housingOf(ada)?.home?.roomType === "single-room", 4000, "home sent");
    const home = housingOf(ada)!.home!;
    expect(home.areaId).toMatch(/^home\//);
    await waitFor(() => me(ada)?.area === home.areaId, 4000, "Ada at home");
    await waitFor(() => ben.room.state.players.get(ada.room.sessionId) === undefined, 4000, "Ada left Ben's view");
    await waitFor(() => ada.lastLife()?.money.recent.some((t) => t.category === "rent") === true, 4000, "rent charged");
    const lease = ada.lastLife()!.money.recent.find((t) => t.category === "rent")!;
    expect(lease).toMatchObject({ direction: "expense", amountCents: 4_500 });
    expect(ben.received("housing").every((h: HousingPayload) => h.home === null)).toBe(true);

    // Sleep in the room's bed: energy and comfort go up; the bed is private (not in the shared seat map).
    const energyBefore = ada.lastLife()!.needs.energy;
    expect((await act(ada, "home-bed", "sleep")).status).toBe("completed");
    await waitFor(() => ada.lastLife()!.needs.energy > energyBefore + 10, 4000, "rested");
    expect(ada.lastLife()!.mood.events.map((e) => e.id)).toContain("well_rested");
    await waitFor(() => me(ada).activity === "idle" && me(ada).seatId === "", 4000, "up after sleeping");
    expect([...ben.room.state.seats.keys()].some((id: string) => id.startsWith("home/"))).toBe(false);

    // Furnish a seat: charged once per request id, validated on the server.
    const bought = await furnishResult(ada, ClientMessage.Furnish, { slot: "seat-1", itemId: "beanbag", requestId: "beanbag-ada-1" });
    expect(bought).toEqual({ action: "furnish", status: "ok", itemId: "beanbag" });
    await waitFor(() => housingOf(ada)!.home!.placements.length === 1, 4000, "placed");
    expect((await furnishResult(ada, ClientMessage.Furnish, { slot: "seat-1", itemId: "beanbag", requestId: "beanbag-ada-1" })).status).toBe("duplicate");
    expect((await furnishResult(ada, ClientMessage.Furnish, { slot: "decor-1", itemId: "armchair", requestId: "armchair-1" })).status).toBe("wrong_slot");
    await waitFor(() => ada.lastLife()?.money.balanceCents === lease.balanceAfterCents - 3_500, 4000, "beanbag paid once");
    expect(ada.lastLife()!.money.recent.filter((t) => t.category === "purchase")).toHaveLength(1);
    // Furnishing someone else's home isn't possible: Ben has none, and is on the square.
    expect((await furnishResult(ben, ClientMessage.Furnish, { slot: "seat-1", itemId: "beanbag", requestId: "beanbag-ben-1" })).status).toBe("not_home");

    // Sit on it (a seat of its own, with its own comfort), then put it away and place it again.
    expect((await act(ada, "home-seat-1", "sit")).status).toBe("completed");
    await waitFor(() => me(ada).activity === "sitting", 4000, "sitting on the beanbag");
    const piece = housingOf(ada)!.home!.placements[0]!;
    expect((await furnishResult(ada, ClientMessage.PutAway, { furnitureId: piece.furnitureId })).status).toBe("ok");
    await waitFor(() => me(ada).activity === "idle", 4000, "up from the beanbag once it is put away");
    expect(housingOf(ada)).toMatchObject({ home: { placements: [] }, storage: [{ furnitureId: piece.furnitureId, itemId: "beanbag" }] });
    expect((await furnishResult(ada, ClientMessage.Place, { slot: "seat-1", furnitureId: piece.furnitureId })).status).toBe("ok");
    expect(housingOf(ada)).toMatchObject({ home: { placements: [{ slot: "seat-1", itemId: "beanbag" }] }, storage: [] });

    // Reload: back at home, with the same room and furniture.
    const token = ada.guestToken;
    await ada.room.leave(true);
    const again = track(await connectAndPlay(server.url, token));
    await waitFor(() => housingOf(again)?.home !== undefined && housingOf(again)?.home !== null, 4000, "home after reload");
    expect(housingOf(again)!.home).toMatchObject({ areaId: home.areaId, roomType: "single-room", placements: [{ slot: "seat-1", itemId: "beanbag" }] });
    expect(me(again).area).toBe(home.areaId);

    // Out to the square (Ben sees Ada again), and move out: the furniture is kept in storage.
    expect((await act(again, "home-door", "enter")).status).toBe("completed");
    await waitFor(() => me(again).area === PLAZA_AREA, 4000, "on the square");
    await waitFor(() => ben.room.state.players.get(again.room.sessionId) !== undefined, 4000, "Ben sees Ada again");
    expect((await act(again, "housing-door", "move_out")).status).toBe("completed");
    await waitFor(() => housingOf(again)?.home === null, 4000, "moved out");
    expect(housingOf(again)!.storage).toEqual([expect.objectContaining({ itemId: "beanbag" })]);
    expect(await act(again, "housing-door", "enter")).toMatchObject({ status: "rejected", reason: "no_home" });
  });
});
