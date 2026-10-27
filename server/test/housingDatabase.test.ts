// M10 storage: migration 0008 (homes, furniture, comfort, the 'rent' ledger
// category and new story kinds), renting and changing room (the first week
// charged once per request), weekly rent once per home and week, the grace
// period and the move to a cheaper room or out (never debt), and furniture
// bought once per request, placed in one spot, put away and kept on moving.
// On PGlite and (with TEST_DATABASE_URL) PostgreSQL. Every call is scoped by
// server-resolved owners.

import { DEFAULT_APPEARANCE, HOUSING_CONFIG, PROFILE_VERSION, ROOM_TYPES, cloneAppearance, type NewCharacterInput } from "@padova/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "../src/db/database.ts";
import { appliedVersions, migrate, rollback } from "../src/db/migrate.ts";
import {
  buyFurniture,
  chargeRent,
  loadHousing,
  markOverdue,
  moveCheaper,
  moveOut,
  placeFurniture,
  putAwayFurniture,
  rentRoom,
  type FurniturePurchase,
} from "../src/housing/housingRepository.ts";
import { applyMoneyChange } from "../src/life/lifeRepository.ts";
import { createGuestWithCharacter, type Owner } from "../src/profiles/profileRepository.ts";
import { testBackends } from "./helpers/testDatabase.ts";

const input = (displayName: string): NewCharacterInput => ({ displayName, ageCategory: "adult", appearance: cloneAppearance(DEFAULT_APPEARANCE), traits: [] });
const spawn = { area: "plaza", x: 0, z: 13, rotation: Math.PI };
const seed = { startingBalanceCents: 10_000, gameMinute: 600 };
const count = async (db: Database, sql: string, params: unknown[] = []) => Number((await db.query<{ n: number }>(sql, params)).rows[0]!.n);
/** Game minute of a day (Day 1 is Monday of week 0). */
const minute = (day: number, hours = 10) => (day - 1) * 1440 + hours * 60;
const balanceOf = async (db: Database, owner: Owner) =>
  Number((await db.query<{ b: number }>(`SELECT balance_cents AS b FROM character_wallets WHERE character_id = $1`, [owner.characterId])).rows[0]!.b);

async function newOwner(db: Database, name: string): Promise<Owner> {
  const created = await createGuestWithCharacter(db, input(name), PROFILE_VERSION, spawn, seed);
  return { accountId: created.accountId, characterId: created.character.characterId };
}

for (const backend of testBackends) {
  describe(`homes and furniture on ${backend.name}`, () => {
    let db: Database;
    let ada: Owner;
    let ben: Owner;
    beforeEach(async () => {
      db = await backend.open();
      await migrate(db);
      ada = await newOwner(db, "Ada");
      ben = await newOwner(db, "Ben");
    });
    afterEach(async () => {
      await db.close();
    });

    const rent = (owner: Owner, roomType: "box-room" | "single-room" | "studio", key: string, day = 1) =>
      rentRoom(db, owner, { roomType, week: Math.floor((day - 1) / 7), gameMinute: minute(day), requestKey: `lease:${key}` });
    const purchase = (homeId: string, slot: string, itemId: string, key: string, priceCents = 1_200): FurniturePurchase => ({
      homeId,
      slot,
      itemId,
      label: itemId,
      priceCents,
      requestKey: `furniture:${key}`,
      gameMinute: minute(1),
      maxFurniture: HOUSING_CONFIG.maxFurniture,
    });

    it("rolls migration 0008 back and forward when empty, and refuses (changing nothing) once anyone has a home", async () => {
      expect(await appliedVersions(db)).toContain(8);
      expect(await rollback(db)).toEqual([8]);
      const tables = (await db.query<{ table_name: string }>(`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`)).rows.map((r) => r.table_name);
      expect(tables).not.toContain("homes");
      expect(tables).not.toContain("furniture");
      await migrate(db);
      const rented = await rent(ada, "box-room", "a");
      expect(rented.status).toBe("rented");
      await expect(rollback(db)).rejects.toThrow();
      expect(await appliedVersions(db)).toContain(8);
      expect(await count(db, `SELECT count(*)::int AS n FROM homes`)).toBe(1);
    });

    it("gives every character a comfort need, 70 to start", async () => {
      const { rows } = await db.query<{ comfort: number }>(`SELECT comfort FROM character_needs WHERE character_id = $1`, [ada.characterId]);
      expect(Number(rows[0]!.comfort)).toBe(70);
    });

    it("rents a room by charging its first week once per request; a repeat returns the same home", async () => {
      const first = await rent(ada, "single-room", "r1");
      expect(first.status).toBe("rented");
      if (first.status !== "rented") return;
      expect(first.balanceCents).toBe(10_000 - ROOM_TYPES["single-room"].rentCents);
      expect(first.home).toMatchObject({ roomType: "single-room", rentCents: 4_500, paidWeek: 0, overdueSince: null });
      expect(first.transaction).toMatchObject({ direction: "expense", category: "rent", amountCents: 4_500 });

      const again = await rent(ada, "single-room", "r1");
      expect(again.status).toBe("duplicate");
      if (again.status === "duplicate") expect(again.home.id).toBe(first.home.id);
      expect(await balanceOf(db, ada)).toBe(5_500);
      expect(await count(db, `SELECT count(*)::int AS n FROM wallet_transactions WHERE character_id = $1 AND category = 'rent'`, [ada.characterId])).toBe(1);
      expect((await loadHousing(db, ada))!.home!.id).toBe(first.home.id);
    });

    it("renting the same request twice at once makes one home and one payment", async () => {
      const results = await Promise.all([rent(ada, "box-room", "twice"), rent(ada, "box-room", "twice")]);
      expect(results.map((r) => r.status).sort()).toEqual(["duplicate", "rented"]);
      expect(await count(db, `SELECT count(*)::int AS n FROM homes WHERE character_id = $1`, [ada.characterId])).toBe(1);
      expect(await balanceOf(db, ada)).toBe(7_500);
    });

    it("refuses the room you already have and a room you can't afford, changing nothing", async () => {
      await rent(ada, "box-room", "a");
      expect((await rent(ada, "box-room", "b")).status).toBe("same_room");
      const poor = await rent(ada, "studio", "c");
      expect(poor).toEqual({ status: "insufficient_funds", balanceCents: 7_500 });
      expect((await loadHousing(db, ada))!.home!.roomType).toBe("box-room");
      expect(await count(db, `SELECT count(*)::int AS n FROM homes`)).toBe(1);
    });

    it("changing room ends the old tenancy, keeps its history, and puts its furniture into storage", async () => {
      const box = await rent(ada, "box-room", "a");
      if (box.status !== "rented") throw new Error(box.status);
      const plant = await buyFurniture(db, ada, purchase(box.home.id, "decor-1", "potted-plant", "p"));
      expect(plant.status).toBe("bought");
      const single = await rent(ada, "single-room", "b", 2);
      expect(single.status).toBe("rented");
      const { rows } = await db.query<{ room_type: string; end_reason: string | null }>(`SELECT room_type, end_reason FROM homes WHERE character_id = $1 ORDER BY started_at`, [ada.characterId]);
      expect(rows).toEqual([
        { room_type: "box-room", end_reason: "moved" },
        { room_type: "single-room", end_reason: null },
      ]);
      const housing = (await loadHousing(db, ada))!;
      expect(housing.home!.roomType).toBe("single-room");
      expect(housing.furniture).toEqual([expect.objectContaining({ itemId: "potted-plant", homeId: null, slot: null })]);
    });

    it("is scoped by the session's account: another account can't read, rent for, furnish or move out someone else's character", async () => {
      const home = await rent(ada, "box-room", "a");
      if (home.status !== "rented") throw new Error(home.status);
      const intruder: Owner = { accountId: ben.accountId, characterId: ada.characterId };
      expect(await loadHousing(db, intruder)).toBeNull();
      expect((await rent(intruder, "studio", "x")).status).toBe("not_owner");
      expect((await buyFurniture(db, intruder, purchase(home.home.id, "seat-1", "beanbag", "x", 3_500))).status).toBe("not_home");
      expect(await moveOut(db, intruder)).toEqual({ status: "no_home" });
      expect(await chargeRent(db, intruder, home.home.id, 1, minute(8))).toEqual({ status: "no_home" });
      expect(await markOverdue(db, intruder, home.home.id, minute(8))).toBeNull();
      expect((await loadHousing(db, ada))!.home!.id).toBe(home.home.id);
      expect(await balanceOf(db, ada)).toBe(7_500);
    });

    it("charges weekly rent once per home and week, and clears an overdue notice when paid", async () => {
      const home = await rent(ada, "box-room", "a");
      if (home.status !== "rented") throw new Error(home.status);
      expect(await chargeRent(db, ada, home.home.id, 0, minute(3))).toEqual({ status: "already_paid", paidWeek: 0 });
      expect(await markOverdue(db, ada, home.home.id, minute(8, 1))).toBe(minute(8, 1));
      // A second notice keeps the first start of the grace period.
      expect(await markOverdue(db, ada, home.home.id, minute(8, 5))).toBe(minute(8, 1));
      const paid = await chargeRent(db, ada, home.home.id, 1, minute(8, 6));
      expect(paid).toMatchObject({ status: "paid", week: 1, balanceCents: 5_000 });
      expect(await chargeRent(db, ada, home.home.id, 1, minute(9))).toEqual({ status: "already_paid", paidWeek: 1 });
      expect((await loadHousing(db, ada))!.home).toMatchObject({ paidWeek: 1, overdueSince: null });
      const keys = (await db.query<{ request_key: string }>(`SELECT request_key FROM wallet_transactions WHERE category = 'rent' ORDER BY created_at`)).rows.map((r) => r.request_key);
      expect(keys).toEqual(["lease:a", `rent:${home.home.id}:w1`]);
    });

    it("never charges rent into debt", async () => {
      const home = await rent(ada, "studio", "a");
      if (home.status !== "rented") throw new Error(home.status);
      expect(await chargeRent(db, ada, home.home.id, 1, minute(8))).toEqual({ status: "insufficient_funds", balanceCents: 2_000 });
      expect(await balanceOf(db, ada)).toBe(2_000);
    });

    it("after the grace period, moves to the dearest cheaper room the character can pay, with their furniture in storage", async () => {
      const studio = await rent(ada, "studio", "a");
      if (studio.status !== "rented") throw new Error(studio.status);
      await buyFurniture(db, ada, purchase(studio.home.id, "decor-1", "potted-plant", "p"));
      await applyMoneyChange(db, ada, { direction: "income", category: "allowance", amountCents: 4_000, description: "test", requestKey: "gift", gameMinute: minute(5) });
      // 4,800 now: not enough for the studio (8,000); enough for the single room (4,500).
      const since = (await markOverdue(db, ada, studio.home.id, minute(8, 1)))!;
      expect(await moveCheaper(db, ada, studio.home.id, 1, since + HOUSING_CONFIG.graceGameMinutes - 1)).toEqual({ status: "not_needed" });
      const moved = await moveCheaper(db, ada, studio.home.id, 1, since + HOUSING_CONFIG.graceGameMinutes);
      expect(moved.status).toBe("moved");
      if (moved.status !== "moved") return;
      expect(moved.to).toMatchObject({ roomType: "single-room", paidWeek: 1, overdueSince: null });
      expect(moved.balanceCents).toBe(300);
      expect(moved.furniture).toEqual([expect.objectContaining({ itemId: "potted-plant", homeId: null })]);
      const ended = (await db.query<{ end_reason: string }>(`SELECT end_reason FROM homes WHERE id = $1`, [studio.home.id])).rows[0]!;
      expect(ended.end_reason).toBe("unpaid");
      // Repeating the move changes nothing (the studio is no longer current).
      expect(await moveCheaper(db, ada, studio.home.id, 1, since + HOUSING_CONFIG.graceGameMinutes + 5)).toEqual({ status: "no_home" });
      expect(await balanceOf(db, ada)).toBe(300);
    });

    it("moves out when no cheaper room is affordable, keeping the money and the furniture", async () => {
      const box = await rent(ada, "box-room", "a");
      if (box.status !== "rented") throw new Error(box.status);
      await db.query(`UPDATE character_wallets SET balance_cents = 1000 WHERE character_id = $1`, [ada.characterId]);
      const since = (await markOverdue(db, ada, box.home.id, minute(8)))!;
      const moved = await moveCheaper(db, ada, box.home.id, 1, since + HOUSING_CONFIG.graceGameMinutes);
      expect(moved).toMatchObject({ status: "moved", to: null, transaction: null, balanceCents: 1_000 });
      expect((await loadHousing(db, ada))!.home).toBeNull();
      expect(await balanceOf(db, ada)).toBe(1_000);
    });

    it("doesn't move anyone whose rent can be paid now, or was paid meanwhile", async () => {
      const box = await rent(ada, "box-room", "a");
      if (box.status !== "rented") throw new Error(box.status);
      const since = (await markOverdue(db, ada, box.home.id, minute(8)))!;
      expect(await moveCheaper(db, ada, box.home.id, 1, since + HOUSING_CONFIG.graceGameMinutes)).toEqual({ status: "not_needed" });
      await chargeRent(db, ada, box.home.id, 1, minute(8, 12));
      expect(await moveCheaper(db, ada, box.home.id, 1, since + HOUSING_CONFIG.graceGameMinutes)).toEqual({ status: "not_needed" });
    });

    it("buys furniture once per request into one free spot; refuses a taken spot and a full storage", async () => {
      const box = await rent(ada, "box-room", "a");
      if (box.status !== "rented") throw new Error(box.status);
      const bought = await buyFurniture(db, ada, purchase(box.home.id, "seat-1", "beanbag", "b", 3_500));
      expect(bought).toMatchObject({ status: "bought", piece: { itemId: "beanbag", homeId: box.home.id, slot: "seat-1" }, balanceCents: 4_000 });
      expect(await buyFurniture(db, ada, purchase(box.home.id, "seat-1", "beanbag", "b", 3_500))).toMatchObject({ status: "duplicate", balanceCents: 4_000 });
      expect(await buyFurniture(db, ada, purchase(box.home.id, "seat-1", "armchair", "c", 5_500))).toEqual({ status: "slot_taken" });
      expect(await buyFurniture(db, ada, { ...purchase(box.home.id, "decor-1", "potted-plant", "d"), maxFurniture: 1 })).toEqual({ status: "storage_full" });
      expect(await buyFurniture(db, ada, purchase("00000000-0000-4000-8000-000000000000", "decor-1", "potted-plant", "e"))).toEqual({ status: "not_home" });
      expect(await balanceOf(db, ada)).toBe(4_000);
      expect(await count(db, `SELECT count(*)::int AS n FROM furniture`)).toBe(1);
    });

    it("two purchases for the same spot at once: one is placed, the other refused and not charged", async () => {
      const box = await rent(ada, "box-room", "a");
      if (box.status !== "rented") throw new Error(box.status);
      const results = await Promise.all([
        buyFurniture(db, ada, purchase(box.home.id, "decor-1", "potted-plant", "x")),
        buyFurniture(db, ada, purchase(box.home.id, "decor-1", "floor-lamp", "y", 2_000)),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual(["bought", "slot_taken"]);
      expect([7_500 - 1_200, 7_500 - 2_000]).toContain(await balanceOf(db, ada));
      expect(await count(db, `SELECT count(*)::int AS n FROM wallet_transactions WHERE category = 'purchase'`)).toBe(1);
    });

    it("puts furniture away and places it again; only in your current home, one piece per spot", async () => {
      const box = await rent(ada, "box-room", "a");
      if (box.status !== "rented") throw new Error(box.status);
      const bought = await buyFurniture(db, ada, purchase(box.home.id, "seat-1", "beanbag", "b", 3_500));
      if (bought.status !== "bought") throw new Error(bought.status);
      const id = bought.piece.id;
      expect(await putAwayFurniture(db, ben, box.home.id, id)).toBe("not_found");
      expect(await putAwayFurniture(db, ada, box.home.id, id)).toBe("stored");
      expect(await putAwayFurniture(db, ada, box.home.id, id)).toBe("not_found");
      expect(await placeFurniture(db, ben, box.home.id, id, "seat-1")).toBe("not_home");
      expect(await placeFurniture(db, ada, box.home.id, id, "seat-1")).toBe("placed");
      expect(await placeFurniture(db, ada, box.home.id, id, "seat-1")).toBe("slot_taken");
      const moved = await moveOut(db, ada);
      expect(moved).toMatchObject({ status: "moved_out", furniture: [expect.objectContaining({ id, homeId: null })] });
      expect(await placeFurniture(db, ada, box.home.id, id, "seat-1")).toBe("not_home");
    });
  });
}
