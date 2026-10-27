// SQL for homes and furniture (M10). Like the other repositories, every read
// and write is scoped by the owning account id taken from the authenticated
// session, never from client input. Rent and furniture are paid through the
// ledger (applyMoneyChangeIn) in the same transaction as the change they pay
// for, so a home or a piece of furniture exists exactly when it was paid.
// Lock order everywhere: the home row first, then the wallet.

import { randomUUID } from "node:crypto";
import { ROOM_TYPES, cheaperRoomFor, isRoomTypeId, overdueDeadline, type RoomTypeId, type TransactionView } from "@padova/shared";
import type { Database, Queryable } from "../db/database.ts";
import { applyMoneyChangeIn, isUniqueViolation } from "../life/lifeRepository.ts";
import type { Owner } from "../profiles/profileRepository.ts";

export interface StoredHome {
  id: string;
  /** Raw stored id (validate with isRoomTypeId). */
  roomType: string;
  rentCents: number;
  paidWeek: number;
  overdueSince: number | null;
}

export interface StoredFurniture {
  id: string;
  /** Raw stored id (validate with isFurnitureId). */
  itemId: string;
  /** Null when in storage. */
  homeId: string | null;
  slot: string | null;
}

export interface StoredHousing {
  home: StoredHome | null;
  furniture: StoredFurniture[];
}

interface HomeRow {
  id: string;
  room_type: string;
  rent_cents: number;
  paid_week: number;
  overdue_since: number | null;
}

interface FurnitureRow {
  id: string;
  item_id: string;
  home_id: string | null;
  slot: string | null;
}

const HOME_COLUMNS = "h.id, h.room_type, h.rent_cents, h.paid_week, h.overdue_since";
const toHome = (row: HomeRow): StoredHome => ({
  id: row.id,
  roomType: row.room_type,
  rentCents: Number(row.rent_cents),
  paidWeek: Number(row.paid_week),
  overdueSince: row.overdue_since === null ? null : Number(row.overdue_since),
});
const toFurniture = (row: FurnitureRow): StoredFurniture => ({ id: row.id, itemId: row.item_id, homeId: row.home_id, slot: row.slot });

async function owns(db: Queryable, owner: Owner): Promise<boolean> {
  const { rows } = await db.query(`SELECT 1 FROM characters WHERE id = $1 AND account_id = $2`, [owner.characterId, owner.accountId]);
  return rows.length > 0;
}

/** The current home, locked for this transaction. */
async function lockedHome(tx: Queryable, owner: Owner): Promise<StoredHome | null> {
  const { rows } = await tx.query<HomeRow>(
    `SELECT ${HOME_COLUMNS} FROM homes h JOIN characters c ON c.id = h.character_id
      WHERE h.character_id = $1 AND c.account_id = $2 AND h.ended_at IS NULL FOR UPDATE OF h`,
    [owner.characterId, owner.accountId],
  );
  return rows[0] ? toHome(rows[0]) : null;
}

async function allFurniture(db: Queryable, characterId: string): Promise<StoredFurniture[]> {
  const { rows } = await db.query<FurnitureRow>(`SELECT id, item_id, home_id, slot FROM furniture WHERE character_id = $1 ORDER BY bought_at, id`, [characterId]);
  return rows.map(toFurniture);
}

/** Ends a tenancy; its furniture goes into storage. */
async function endHome(tx: Queryable, homeId: string, reason: "moved" | "moved_out" | "unpaid"): Promise<void> {
  await tx.query(`UPDATE homes SET ended_at = now(), end_reason = $2 WHERE id = $1 AND ended_at IS NULL`, [homeId, reason]);
  await tx.query(`UPDATE furniture SET home_id = NULL, slot = NULL WHERE home_id = $1`, [homeId]);
}

async function startHome(tx: Queryable, owner: Owner, roomType: RoomTypeId, week: number, gameMinute: number, leaseTransactionId: string): Promise<StoredHome> {
  const { rows } = await tx.query<HomeRow>(
    `INSERT INTO homes AS h (id, character_id, room_type, rent_cents, paid_week, lease_transaction_id, started_game_minute)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING ${HOME_COLUMNS}`,
    [randomUUID(), owner.characterId, roomType, ROOM_TYPES[roomType].rentCents, week, leaseTransactionId, gameMinute],
  );
  return toHome(rows[0]!);
}

/** The character's current home and all their furniture; null when `owner.accountId` does not own the character. */
export async function loadHousing(db: Queryable, owner: Owner): Promise<StoredHousing | null> {
  if (!(await owns(db, owner))) return null;
  const [home, furniture] = await Promise.all([
    db.query<HomeRow>(`SELECT ${HOME_COLUMNS} FROM homes h WHERE h.character_id = $1 AND h.ended_at IS NULL`, [owner.characterId]),
    allFurniture(db, owner.characterId),
  ]);
  return { home: home.rows[0] ? toHome(home.rows[0]) : null, furniture };
}

// ── Renting, changing room and moving out ─────────────────────────────────

export interface RentRequest {
  roomType: RoomTypeId;
  /** The current rent week: the first week is charged now. */
  week: number;
  gameMinute: number;
  /** Idempotency key of the first week's rent (from the player's request). */
  requestKey: string;
}

export type RentResult =
  | { status: "rented" | "duplicate"; home: StoredHome; furniture: StoredFurniture[]; transaction: TransactionView; balanceCents: number }
  | { status: "insufficient_funds"; balanceCents: number }
  | { status: "same_room" }
  | { status: "not_owner" };

/**
 * Rents a room, or moves to another one: the first week's rent is charged
 * now; a current home ends and its furniture goes into storage. Repeating
 * the same request returns the same home.
 */
export async function rentRoom(db: Database, owner: Owner, request: RentRequest): Promise<RentResult> {
  try {
    return await db.transaction(async (tx): Promise<RentResult> => {
      const current = await lockedHome(tx, owner);
      const change = {
        direction: "expense" as const,
        category: "rent" as const,
        amountCents: ROOM_TYPES[request.roomType].rentCents,
        description: `Rent: ${ROOM_TYPES[request.roomType].label}, first week`,
        itemId: request.roomType,
        requestKey: request.requestKey,
        gameMinute: request.gameMinute,
      };
      // The same request again (a retry): the home it already rented.
      const earlier = await tx.query<HomeRow>(
        `SELECT ${HOME_COLUMNS} FROM homes h JOIN wallet_transactions t ON t.id = h.lease_transaction_id
          WHERE t.character_id = $1 AND t.request_key = $2`,
        [owner.characterId, request.requestKey],
      );
      if (earlier.rows[0]) {
        const repeated = await applyMoneyChangeIn(tx, owner, change);
        if (repeated.status !== "duplicate") throw new Error(`home ${earlier.rows[0].id} exists but its first rent does not`);
        return { status: "duplicate", home: toHome(earlier.rows[0]), furniture: await allFurniture(tx, owner.characterId), transaction: repeated.transaction, balanceCents: repeated.balanceCents };
      }
      if (current?.roomType === request.roomType) return { status: "same_room" };
      const paid = await applyMoneyChangeIn(tx, owner, change);
      if (paid.status === "not_owner" || paid.status === "insufficient_funds") return paid;
      if (paid.status === "duplicate") {
        // The same request committed while this one waited for the wallet: its home.
        const raced = await tx.query<HomeRow>(`SELECT ${HOME_COLUMNS} FROM homes h WHERE h.lease_transaction_id = $1`, [paid.transaction.id]);
        if (!raced.rows[0]) throw new Error(`rent request ${request.requestKey} was paid but has no home`);
        return { status: "duplicate", home: toHome(raced.rows[0]), furniture: await allFurniture(tx, owner.characterId), transaction: paid.transaction, balanceCents: paid.balanceCents };
      }
      if (current) await endHome(tx, current.id, "moved");
      const home = await startHome(tx, owner, request.roomType, request.week, request.gameMinute, paid.transaction.id);
      return { status: "rented", home, furniture: await allFurniture(tx, owner.characterId), transaction: paid.transaction, balanceCents: paid.balanceCents };
    });
  } catch (error) {
    // The same request twice at once: the second sees the first's home.
    if (isUniqueViolation(error)) return rentRoom(db, owner, request);
    throw error;
  }
}

export type MoveOutResult = { status: "moved_out"; homeId: string; furniture: StoredFurniture[] } | { status: "no_home" };

/** Gives up the current home (by choice); furniture goes into storage. */
export async function moveOut(db: Database, owner: Owner): Promise<MoveOutResult> {
  return db.transaction(async (tx): Promise<MoveOutResult> => {
    const current = await lockedHome(tx, owner);
    if (!current) return { status: "no_home" };
    await endHome(tx, current.id, "moved_out");
    return { status: "moved_out", homeId: current.id, furniture: await allFurniture(tx, owner.characterId) };
  });
}

// ── Weekly rent ───────────────────────────────────────────────────────────

export type RentChargeResult =
  | { status: "paid"; week: number; transaction: TransactionView; balanceCents: number }
  | { status: "already_paid"; paidWeek: number }
  | { status: "insufficient_funds"; balanceCents: number }
  | { status: "no_home" };

/** Charges this week's rent for the current home (`homeId`), once per week: the ledger key is rent:<home>:w<week>. */
export async function chargeRent(db: Database, owner: Owner, homeId: string, week: number, gameMinute: number): Promise<RentChargeResult> {
  return db.transaction(async (tx): Promise<RentChargeResult> => {
    const home = await lockedHome(tx, owner);
    if (!home || home.id !== homeId) return { status: "no_home" };
    if (home.paidWeek >= week) return { status: "already_paid", paidWeek: home.paidWeek };
    const label = isRoomTypeId(home.roomType) ? ROOM_TYPES[home.roomType].label : "your room";
    const paid = await applyMoneyChangeIn(tx, owner, {
      direction: "expense",
      category: "rent",
      amountCents: home.rentCents,
      description: `Rent: ${label}`,
      itemId: home.roomType,
      requestKey: `rent:${home.id}:w${week}`,
      gameMinute,
    });
    if (paid.status === "not_owner") return { status: "no_home" };
    if (paid.status === "insufficient_funds") return paid;
    await tx.query(`UPDATE homes SET paid_week = $2, overdue_since = NULL WHERE id = $1`, [home.id, week]);
    return { status: "paid", week, transaction: paid.transaction, balanceCents: paid.balanceCents };
  });
}

/** Records that this week's rent couldn't be paid (the start of the grace period); returns when it started, or null without that home. */
export async function markOverdue(db: Queryable, owner: Owner, homeId: string, gameMinute: number): Promise<number | null> {
  const { rows } = await db.query<{ overdue_since: number }>(
    `UPDATE homes h SET overdue_since = COALESCE(h.overdue_since, $3)
       FROM characters c
      WHERE h.id = $1 AND h.character_id = c.id AND c.account_id = $2 AND h.ended_at IS NULL
      RETURNING h.overdue_since`,
    [homeId, owner.accountId, gameMinute],
  );
  return rows[0] ? Number(rows[0].overdue_since) : null;
}

export type MoveCheaperResult =
  | { status: "moved"; from: StoredHome; to: StoredHome | null; furniture: StoredFurniture[]; transaction: TransactionView | null; balanceCents: number }
  /** The grace period isn't over, the rent was paid meanwhile, or the money is there now (charge instead). */
  | { status: "not_needed" }
  | { status: "no_home" };

/**
 * The grace period is over and this week's rent still can't be paid (Q9):
 * the home ends and the character moves to the dearest cheaper room whose
 * first week they can pay now, or out. Never debt (D-023).
 */
export async function moveCheaper(db: Database, owner: Owner, homeId: string, week: number, gameMinute: number): Promise<MoveCheaperResult> {
  return db.transaction(async (tx): Promise<MoveCheaperResult> => {
    const home = await lockedHome(tx, owner);
    if (!home || home.id !== homeId) return { status: "no_home" };
    const wallet = await tx.query<{ balance_cents: number }>(`SELECT balance_cents FROM character_wallets WHERE character_id = $1 FOR UPDATE`, [owner.characterId]);
    if (!wallet.rows[0]) return { status: "no_home" };
    const balance = Number(wallet.rows[0].balance_cents);
    const due = home.paidWeek < week && home.overdueSince !== null && gameMinute >= overdueDeadline(home.overdueSince);
    if (!due || balance >= home.rentCents) return { status: "not_needed" };

    await endHome(tx, home.id, "unpaid");
    const target = isRoomTypeId(home.roomType) ? cheaperRoomFor(home.roomType, balance) : null;
    if (!target) return { status: "moved", from: home, to: null, furniture: await allFurniture(tx, owner.characterId), transaction: null, balanceCents: balance };
    const paid = await applyMoneyChangeIn(tx, owner, {
      direction: "expense",
      category: "rent",
      amountCents: ROOM_TYPES[target].rentCents,
      description: `Rent: ${ROOM_TYPES[target].label}, first week`,
      itemId: target,
      requestKey: `rent-move:${home.id}:w${week}`,
      gameMinute,
    });
    if (paid.status !== "applied" && paid.status !== "duplicate") throw new Error(`moving ${owner.characterId} to a cheaper room: rent not charged (${paid.status})`);
    const to = await startHome(tx, owner, target, week, gameMinute, paid.transaction.id);
    return { status: "moved", from: home, to, furniture: await allFurniture(tx, owner.characterId), transaction: paid.transaction, balanceCents: paid.balanceCents };
  });
}

// ── Furniture ─────────────────────────────────────────────────────────────

export interface FurniturePurchase {
  homeId: string;
  slot: string;
  itemId: string;
  label: string;
  priceCents: number;
  /** Idempotency key (from the player's request). */
  requestKey: string;
  gameMinute: number;
  maxFurniture: number;
}

export type FurniturePurchaseResult =
  | { status: "bought" | "duplicate"; piece: StoredFurniture; transaction: TransactionView; balanceCents: number }
  | { status: "insufficient_funds"; balanceCents: number }
  | { status: "not_home" | "slot_taken" | "storage_full" };

/** Buys a piece of furniture and places it in a spot of the current home; charged once per request key. */
export async function buyFurniture(db: Database, owner: Owner, purchase: FurniturePurchase): Promise<FurniturePurchaseResult> {
  try {
    return await db.transaction(async (tx): Promise<FurniturePurchaseResult> => {
      const home = await lockedHome(tx, owner);
      const earlier = await tx.query<FurnitureRow>(
        `SELECT f.id, f.item_id, f.home_id, f.slot FROM furniture f JOIN wallet_transactions t ON t.id = f.transaction_id
          WHERE t.character_id = $1 AND t.request_key = $2`,
        [owner.characterId, purchase.requestKey],
      );
      if (earlier.rows[0]) {
        const paid = await applyMoneyChangeIn(tx, owner, { direction: "expense", category: "purchase", amountCents: purchase.priceCents, description: purchase.label, itemId: purchase.itemId, requestKey: purchase.requestKey, gameMinute: purchase.gameMinute });
        if (paid.status !== "duplicate") throw new Error(`furniture ${earlier.rows[0].id} exists but its purchase does not`);
        return { status: "duplicate", piece: toFurniture(earlier.rows[0]), transaction: paid.transaction, balanceCents: paid.balanceCents };
      }
      if (!home || home.id !== purchase.homeId) return { status: "not_home" };
      const counts = await tx.query<{ owned: number; here: number }>(
        `SELECT count(*)::int AS owned, count(*) FILTER (WHERE home_id = $2 AND slot = $3)::int AS here FROM furniture WHERE character_id = $1`,
        [owner.characterId, home.id, purchase.slot],
      );
      if (Number(counts.rows[0]?.here ?? 0) > 0) return { status: "slot_taken" };
      if (Number(counts.rows[0]?.owned ?? 0) >= purchase.maxFurniture) return { status: "storage_full" };
      const paid = await applyMoneyChangeIn(tx, owner, {
        direction: "expense",
        category: "purchase",
        amountCents: purchase.priceCents,
        description: purchase.label,
        itemId: purchase.itemId,
        requestKey: purchase.requestKey,
        gameMinute: purchase.gameMinute,
      });
      if (paid.status === "not_owner") return { status: "not_home" };
      if (paid.status === "insufficient_funds") return paid;
      if (paid.status === "duplicate") {
        // The same purchase committed while this one waited for the wallet: its piece.
        const raced = await tx.query<FurnitureRow>(`SELECT id, item_id, home_id, slot FROM furniture WHERE transaction_id = $1`, [paid.transaction.id]);
        if (!raced.rows[0]) throw new Error(`purchase ${purchase.requestKey} was paid but has no furniture`);
        return { status: "duplicate", piece: toFurniture(raced.rows[0]), transaction: paid.transaction, balanceCents: paid.balanceCents };
      }
      const { rows } = await tx.query<FurnitureRow>(
        `INSERT INTO furniture (id, character_id, item_id, home_id, slot, transaction_id) VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, item_id, home_id, slot`,
        [randomUUID(), owner.characterId, purchase.itemId, home.id, purchase.slot, paid.transaction.id],
      );
      return { status: "bought", piece: toFurniture(rows[0]!), transaction: paid.transaction, balanceCents: paid.balanceCents };
    });
  } catch (error) {
    // The same purchase twice at once, or the spot filled meanwhile: look again.
    if (isUniqueViolation(error)) return buyFurniture(db, owner, purchase);
    throw error;
  }
}

/** Places a stored piece in a spot of the current home. */
export async function placeFurniture(db: Database, owner: Owner, homeId: string, furnitureId: string, slot: string): Promise<"placed" | "not_home" | "not_found" | "slot_taken"> {
  try {
    return await db.transaction(async (tx) => {
      const home = await lockedHome(tx, owner);
      if (!home || home.id !== homeId) return "not_home";
      const taken = await tx.query(`SELECT 1 FROM furniture WHERE home_id = $1 AND slot = $2`, [homeId, slot]);
      if (taken.rows.length > 0) return "slot_taken";
      const { rowCount } = await tx.query(`UPDATE furniture SET home_id = $3, slot = $4 WHERE id = $1 AND character_id = $2 AND home_id IS NULL`, [furnitureId, owner.characterId, homeId, slot]);
      return rowCount === 1 ? "placed" : "not_found";
    });
  } catch (error) {
    if (isUniqueViolation(error)) return "slot_taken";
    throw error;
  }
}

/** Puts a piece placed in the current home back into storage. */
export async function putAwayFurniture(db: Queryable, owner: Owner, homeId: string, furnitureId: string): Promise<"stored" | "not_found"> {
  const { rowCount } = await db.query(
    `UPDATE furniture f SET home_id = NULL, slot = NULL
       FROM characters c
      WHERE f.id = $1 AND f.home_id = $2 AND f.character_id = c.id AND c.id = $3 AND c.account_id = $4`,
    [furnitureId, homeId, owner.characterId, owner.accountId],
  );
  return rowCount === 1 ? "stored" : "not_found";
}
