// Contextual interaction rules: which actions a target offers, and whether a
// request is allowed. Pure functions with no networking or rendering. The
// server is the authority and calls these to validate; the client calls the
// same functions only to decide what to show in a menu.

import { isPositionWalkable, type Vec2 } from "./collision.ts";
import { GAME_CONFIG, INTERACTION_CONFIG } from "./config.ts";
import type { Interactable, Seat, WorldLayout } from "./world.ts";

export const ACTION_IDS = ["sit", "stand", "study", "greet"] as const;
export type ActionId = (typeof ACTION_IDS)[number];

export type TargetKind = "object" | "player";

/** What a character is doing, as replicated to everyone. */
export type Activity = "idle" | "sitting" | "studying" | "greeting";

export const ACTION_LABELS: Record<ActionId, string> = {
  sit: "Sit",
  stand: "Stand up",
  study: "Study",
  greet: "Greet",
};

/** Reasons an interaction can be refused or fail. Shown to players as friendly text. */
export type InteractionFailure =
  | "invalid_payload"
  | "rate_limited"
  | "unknown_target"
  | "target_is_self"
  | "target_offline"
  | "action_not_available"
  | "no_free_seat"
  | "too_far"
  | "unreachable"
  | "blocked"
  | "target_left"
  | "target_moved"
  | "too_soon";

/** Why an action ended before completing. */
export type CancelReason = "cancelled" | "interrupted" | "replaced" | "disconnected";

/** The actor as the rules need to see it. */
export interface ActorView {
  id: string;
  x: number;
  z: number;
  /** Seat currently occupied ("" when standing). */
  seatId: string;
  activity: Activity | string;
}

/** seatId → id of the player occupying or walking to it. */
export type SeatOccupancy = Pick<ReadonlyMap<string, string>, "get" | "has">;

export type Check = { ok: true } | { ok: false; reason: InteractionFailure };

const ok: Check = { ok: true };
const fail = (reason: InteractionFailure): Check => ({ ok: false, reason });

export function findInteractable(world: WorldLayout, id: string): Interactable | null {
  return world.interactables.find((item) => item.id === id) ?? null;
}

export function findSeat(world: WorldLayout, seatId: string): { interactable: Interactable; seat: Seat } | null {
  for (const interactable of world.interactables) {
    const seat = interactable.seats.find((s) => s.id === seatId);
    if (seat) return { interactable, seat };
  }
  return null;
}

/** Centre of the object, used for distance checks and for anchoring menus. */
export function interactableCentre(world: WorldLayout, interactable: Interactable): Vec2 {
  const box = world.obstacles.find((o) => o.id === interactable.id);
  if (!box) {
    const first = interactable.seats[0];
    return first ? { x: first.x, z: first.z } : { x: 0, z: 0 };
  }
  return { x: (box.minX + box.maxX) / 2, z: (box.minZ + box.maxZ) / 2 };
}

const isFreeFor = (seat: Seat, occupancy: SeatOccupancy, actorId: string) =>
  !occupancy.has(seat.id) || occupancy.get(seat.id) === actorId;

/** Actions an object offers this actor right now (menu contents). */
export function objectActions(interactable: Interactable, actor: ActorView, occupancy: SeatOccupancy): ActionId[] {
  const seatedHere = interactable.seats.some((seat) => seat.id === actor.seatId);
  const hasFreeSeat = interactable.seats.some((seat) => isFreeFor(seat, occupancy, actor.id));
  switch (interactable.kind) {
    case "bench":
      if (seatedHere) return ["stand"];
      return hasFreeSeat ? ["sit"] : [];
    case "desk":
      if (seatedHere) return actor.activity === "studying" ? ["stand"] : ["study", "stand"];
      return hasFreeSeat ? ["study", "sit"] : [];
  }
}

/** Actions another player offers. A player never offers actions to themselves. */
export function playerActions(actor: ActorView, target: { id: string; connected: boolean }): ActionId[] {
  if (target.id === actor.id || !target.connected) return [];
  return ["greet"];
}

const SEAT_ACTIONS: readonly ActionId[] = ["sit", "study"];
const OBJECT_ACTIONS: Record<Interactable["kind"], readonly ActionId[]> = {
  bench: ["sit", "stand"],
  desk: ["sit", "stand", "study"],
};

/** Server-side validation of an object interaction request. */
export function validateObjectAction(
  world: WorldLayout,
  interactable: Interactable,
  actor: ActorView,
  occupancy: SeatOccupancy,
  action: ActionId,
  maxDistance: number = INTERACTION_CONFIG.maxDistance,
): Check {
  if (!OBJECT_ACTIONS[interactable.kind].includes(action)) return fail("action_not_available");
  const centre = interactableCentre(world, interactable);
  if (Math.hypot(centre.x - actor.x, centre.z - actor.z) > maxDistance) return fail("too_far");
  if (objectActions(interactable, actor, occupancy).includes(action)) return ok;
  if (SEAT_ACTIONS.includes(action) && !interactable.seats.some((s) => isFreeFor(s, occupancy, actor.id))) {
    return fail("no_free_seat");
  }
  return fail("action_not_available");
}

/** Server-side validation of a player interaction request. */
export function validatePlayerAction(
  actor: ActorView,
  target: { id: string; x: number; z: number; connected: boolean } | null,
  action: ActionId,
  lastGreetAt: number | undefined,
  now: number,
  maxDistance: number = INTERACTION_CONFIG.maxDistance,
): Check {
  if (!target) return fail("unknown_target");
  if (target.id === actor.id) return fail("target_is_self");
  if (!target.connected) return fail("target_offline");
  if (action !== "greet") return fail("action_not_available");
  if (Math.hypot(target.x - actor.x, target.z - actor.z) > maxDistance) return fail("too_far");
  if (lastGreetAt !== undefined && now - lastGreetAt < INTERACTION_CONFIG.greetCooldownMs) return fail("too_soon");
  return ok;
}

/** The free seat closest to the actor (or the one they already hold). */
export function chooseSeat(interactable: Interactable, occupancy: SeatOccupancy, actor: ActorView): Seat | null {
  let best: Seat | null = null;
  let bestDistance = Infinity;
  for (const seat of interactable.seats) {
    if (!isFreeFor(seat, occupancy, actor.id)) continue;
    const distance = Math.hypot(seat.approach.x - actor.x, seat.approach.z - actor.z);
    if (distance < bestDistance) {
      best = seat;
      bestDistance = distance;
    }
  }
  return best;
}

/**
 * Where a greeter should stand: `standOff` metres from the other player, on
 * the side facing the greeter if possible, otherwise the nearest walkable
 * point around them. Null if no point around the target is walkable.
 */
export function greetApproachPoint(
  world: WorldLayout,
  actor: Vec2,
  target: Vec2,
  standOff: number = INTERACTION_CONFIG.greetStandOff,
  radius: number = GAME_CONFIG.playerRadius,
): Vec2 | null {
  const baseAngle = Math.atan2(actor.x - target.x, actor.z - target.z);
  for (let step = 0; step < 12; step++) {
    // 0, +30°, -30°, +60°, -60°, ...
    const offset = Math.ceil(step / 2) * (Math.PI / 6) * (step % 2 === 0 ? -1 : 1);
    const angle = baseAngle + offset;
    const point = { x: target.x + Math.sin(angle) * standOff, z: target.z + Math.cos(angle) * standOff };
    if (isPositionWalkable(world, point.x, point.z, radius)) return point;
  }
  return null;
}

/** Facing angle (radians, 0 = +Z) from one point towards another. */
export function facingTowards(from: Vec2, to: Vec2): number {
  return Math.atan2(to.x - from.x, to.z - from.z);
}
