// Housing rules (M10): the weekly rent schedule, what happens when rent
// can't be paid (a notice and a grace period, then a move to a cheaper room
// or out; never debt, D-023 and Q9), and how cosy a home is. Pure functions;
// the server applies them, the client uses them to explain.

import { MINUTES_PER_DAY, gameDayOf } from "./clock.ts";
import {
  FURNITURE,
  FURNITURE_IDS,
  HOUSING_CONFIG,
  ROOM_TYPES,
  ROOM_TYPE_IDS,
  type FurnitureId,
  type RoomTypeId,
} from "./config.ts";

export const isRoomTypeId = (value: unknown): value is RoomTypeId => typeof value === "string" && (ROOM_TYPE_IDS as readonly string[]).includes(value);
export const isFurnitureId = (value: unknown): value is FurnitureId => typeof value === "string" && (FURNITURE_IDS as readonly string[]).includes(value);

/** Furniture you can buy (the room's own isn't for sale). */
export const forSale = (id: FurnitureId): boolean => FURNITURE[id].priceCents !== null;

/** Rent week of a game minute. Weeks run Monday 00:00 to Sunday 24:00; Day 1 is a Monday, so week 0 is Days 1–7. */
export function rentWeekOf(gameMinute: number): number {
  return Math.floor((gameDayOf(gameMinute) - 1) / 7);
}

/** First game minute (Monday 00:00) of a rent week. */
export function rentWeekStart(week: number): number {
  return week * 7 * MINUTES_PER_DAY;
}

/** A home's rent, as the rules need to see it. */
export interface RentState {
  rentCents: number;
  /** Last week paid. */
  paidWeek: number;
  /** Game minute this week's rent first couldn't be paid; null when up to date. */
  overdueSince: number | null;
}

/**
 * What to do about rent right now:
 * - "paid": this week is paid;
 * - "charge": due, and the money is there: charge it;
 * - "start_overdue": due, not enough money, first time: the notice (and a mood event);
 * - "overdue": still not enough money during the grace period (try again when money arrives);
 * - "move_cheaper": the grace period is over: move to a cheaper room the
 *   character can pay for, or out if there is none (cheaperRoomFor).
 * Weeks spent away aren't charged: only the current week is ever due.
 */
export type RentStep = "paid" | "charge" | "start_overdue" | "overdue" | "move_cheaper";

export function rentStep(rent: RentState, gameMinute: number, balanceCents: number): RentStep {
  if (rent.paidWeek >= rentWeekOf(gameMinute)) return "paid";
  if (balanceCents >= rent.rentCents) return "charge";
  if (rent.overdueSince === null) return "start_overdue";
  return gameMinute >= overdueDeadline(rent.overdueSince) ? "move_cheaper" : "overdue";
}

/** Game minute by which overdue rent must be paid. */
export const overdueDeadline = (overdueSince: number): number => overdueSince + HOUSING_CONFIG.graceGameMinutes;

/** Rooms from cheapest to dearest. */
export const ROOMS_BY_RENT: readonly RoomTypeId[] = [...ROOM_TYPE_IDS].sort((a, b) => ROOM_TYPES[a].rentCents - ROOM_TYPES[b].rentCents);

/**
 * Where a character who couldn't pay moves (Q9): the dearest room cheaper
 * than `current` whose first week they can pay now; null if there is none
 * (they move out, keeping their furniture in storage).
 */
export function cheaperRoomFor(current: RoomTypeId, balanceCents: number): RoomTypeId | null {
  const limit = ROOM_TYPES[current].rentCents;
  const options = ROOMS_BY_RENT.filter((id) => ROOM_TYPES[id].rentCents < limit && ROOM_TYPES[id].rentCents <= balanceCents);
  return options.at(-1) ?? null;
}

/** How cosy a home is: the sum of what its furniture adds (the room's own adds nothing). */
export function cosinessOf(items: readonly FurnitureId[]): number {
  return items.reduce((sum, id) => sum + FURNITURE[id].cosiness, 0);
}

export const isCosy = (cosiness: number): boolean => cosiness >= HOUSING_CONFIG.cosyAt;
