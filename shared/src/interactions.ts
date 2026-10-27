// Contextual interaction rules: which actions a target offers, and whether a
// request is allowed. Pure functions with no networking or rendering. The
// server is the authority and calls these to validate; the client calls the
// same functions only to decide what to show in a menu.

import { isPositionWalkable, type Vec2 } from "./collision.ts";
import { GAME_CONFIG, INTERACTION_CONFIG } from "./config.ts";
import { JOBS, type CourseId, type JobId, type RoomTypeId } from "./life/config.ts";
import type { CourseStatus } from "./life/university.ts";
import { findMenuItem } from "./life/economy.ts";
import { isRoomTypeId } from "./life/housing.ts";
import { HOME_LINK, type Interactable, type Seat, type WorldLayout } from "./world.ts";

export const ACTION_IDS = [
  "sit",
  "stand",
  "study",
  "greet",
  "sketch",
  "buy",
  "wash",
  "ask_work",
  "work",
  "enter",
  "enrol",
  "attend",
  "exam",
  "chat",
  "sleep",
  "rent",
  "move_out",
] as const;
export type ActionId = (typeof ACTION_IDS)[number];

export type TargetKind = "object" | "player";

/** What a character is doing, as replicated to everyone. */
export type Activity =
  | "idle"
  | "sitting"
  | "studying"
  | "sketching"
  | "greeting"
  | "ordering"
  | "eating"
  | "drinking"
  | "washing"
  | "working"
  | "attending"
  | "exam"
  | "chatting"
  | "sleeping";

export const ACTION_LABELS: Record<ActionId, string> = {
  sit: "Sit",
  stand: "Stand up",
  study: "Study",
  greet: "Greet",
  sketch: "Sketch",
  buy: "Buy",
  wash: "Wash up",
  ask_work: "Ask about work",
  work: "Work a shift",
  /** Doors (M7c); menus show the door's own wording ("Go in", "Go out to the square"). */
  enter: "Go through",
  // University (M8)
  enrol: "Enrol",
  attend: "Attend the lecture",
  exam: "Sit the exam",
  // Relationships (M9)
  chat: "Chat",
  // A place to live (M10). "rent" is "Change room…" once you have a home.
  sleep: "Sleep",
  rent: "Rent a room…",
  move_out: "Move out…",
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
  | "too_soon"
  | "busy"
  | "too_tired"
  | "unknown_item"
  | "insufficient_funds"
  | "purchase_failed"
  | "duplicate_request"
  // Work (M7)
  | "not_employed"
  | "already_employed"
  | "closed"
  | "shift_limit"
  | "hire_failed"
  | "wage_failed"
  // University (M8)
  | "not_enrolled"
  | "already_enrolled"
  | "course_passed"
  | "no_lecture_now"
  | "already_attended"
  | "no_exam_now"
  | "already_sat"
  | "enrol_failed"
  | "record_failed"
  // Relationships and safety (M9): one of the two players blocked the other (said neutrally)
  | "not_reachable"
  // A place to live (M10)
  | "no_home"
  | "same_room"
  | "rent_failed";

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
  /** The actor's job (private: the server passes its own record, a client only its own). */
  job?: JobId | null;
  /** The actor's course (private, like the job). */
  course?: { courseId: CourseId; status: CourseStatus } | null;
  /** The actor's home (private, like the job; M10). */
  home?: { roomType: RoomTypeId } | null;
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

/** Staff spots are only for working; every other action uses the other points. */
export function seatsFor(interactable: Interactable, action: ActionId): readonly Seat[] {
  const staff = action === "work";
  return interactable.seats.filter((seat) => (seat.use === "staff") === staff);
}

const hasFreeFor = (interactable: Interactable, action: ActionId, occupancy: SeatOccupancy, actorId: string) =>
  seatsFor(interactable, action).some((seat) => isFreeFor(seat, occupancy, actorId));

/** True when the actor's job is done at this object. */
const worksHere = (interactable: Interactable, actor: ActorView) =>
  Boolean(actor.job && JOBS[actor.job].workplaceId === interactable.id);

/** Actions an object offers this actor right now (menu contents). */
export function objectActions(interactable: Interactable, actor: ActorView, occupancy: SeatOccupancy): ActionId[] {
  const seatedHere = interactable.seats.some((seat) => seat.id === actor.seatId);
  const hasFreeSeat = hasFreeFor(interactable, "sit", occupancy, actor.id);
  switch (interactable.kind) {
    case "bench":
    case "seat":
      if (seatedHere) return actor.activity === "sketching" ? ["stand"] : ["sketch", "stand"];
      return hasFreeSeat ? ["sit", "sketch"] : [];
    case "bed":
      // Lying here means sleeping (you get up when it ends).
      if (seatedHere) return ["stand"];
      return hasFreeSeat ? ["sleep"] : [];
    case "desk": {
      // Lecture desks also offer the lecture and the exam to enrolled students (M8);
      // whether one is on now is the timetable's call (shown in menus, checked by the server).
      const course: ActionId[] = interactable.lecture && actor.course?.status === "enrolled" ? ["attend", "exam"] : [];
      if (seatedHere) return BUSY_AT_DESK.includes(actor.activity) ? ["stand"] : [...course, "study", "stand"];
      return hasFreeSeat ? [...course, "study", "sit"] : [];
    }
    case "cafe": {
      const actions: ActionId[] = hasFreeSeat ? ["buy"] : [];
      if (!actor.job && hasFreeSeat) actions.push("ask_work");
      if (worksHere(interactable, actor) && hasFreeFor(interactable, "work", occupancy, actor.id)) actions.push("work");
      return actions;
    }
    case "fountain":
      return hasFreeSeat ? ["wash"] : [];
    case "door":
      if (!hasFreeSeat || !interactable.door) return [];
      // The student housing (M10): your room, or renting one.
      if (interactable.door.to === HOME_LINK) return actor.home ? ["enter", "rent", "move_out"] : ["rent"];
      return ["enter"];
    case "noticeboard":
      // Offered even when enrolled: menus show it disabled with the course's status.
      return hasFreeSeat ? ["enrol"] : [];
  }
}

/** Activities during which a desk offers only "Stand up". */
const BUSY_AT_DESK: readonly string[] = ["studying", "attending", "exam"];

/** Actions another player offers. A player never offers actions to themselves. Blocks are the server's call. */
/** What a player can do to another character. An NPC (M11) can be greeted; chats are between players. */
export function playerActions(actor: ActorView, target: { id: string; connected: boolean; npc?: boolean }): ActionId[] {
  if (target.id === actor.id || !target.connected) return [];
  return target.npc ? ["greet"] : ["greet", "chat"];
}

/** Minimum time between the same player action towards the same player. */
const PLAYER_ACTION_COOLDOWN_MS: Partial<Record<ActionId, number>> = {
  greet: INTERACTION_CONFIG.greetCooldownMs,
  chat: INTERACTION_CONFIG.chatCooldownMs,
};

const SEAT_ACTIONS: readonly ActionId[] = ["sit", "study", "sketch", "attend", "exam", "sleep"];
const STANDING_SPOT_ACTIONS: readonly ActionId[] = ["buy", "wash", "ask_work", "work", "enter", "enrol", "rent", "move_out"];
const OBJECT_ACTIONS: Record<Interactable["kind"], readonly ActionId[]> = {
  bench: ["sit", "stand", "sketch"],
  seat: ["sit", "stand", "sketch"],
  bed: ["sleep", "stand"],
  desk: ["sit", "stand", "study", "attend", "exam"],
  cafe: ["buy", "ask_work", "work"],
  fountain: ["wash"],
  door: ["enter", "rent", "move_out"],
  noticeboard: ["enrol"],
};

/** Server-side validation of an object interaction request. */
export function validateObjectAction(
  world: WorldLayout,
  interactable: Interactable,
  actor: ActorView,
  occupancy: SeatOccupancy,
  action: ActionId,
  maxDistance: number = INTERACTION_CONFIG.maxDistance,
  itemId?: string,
): Check {
  if (!OBJECT_ACTIONS[interactable.kind].includes(action)) return fail("action_not_available");
  if (action === "buy" && (!itemId || !findMenuItem(itemId))) return fail("unknown_item");
  if (action === "ask_work" && actor.job) return fail("already_employed");
  if (action === "work" && !worksHere(interactable, actor)) return fail("not_employed");
  if (action === "enrol" && actor.course) return fail(actor.course.status === "passed" ? "course_passed" : "already_enrolled");
  if (action === "attend" || action === "exam") {
    if (!interactable.lecture) return fail("action_not_available");
    if (!actor.course) return fail("not_enrolled");
    if (actor.course.status === "passed") return fail("course_passed");
  }
  if (interactable.kind === "door") {
    const home = interactable.door?.to === HOME_LINK;
    if ((action === "rent" || action === "move_out") && !home) return fail("action_not_available");
    if (action === "rent" && !isRoomTypeId(itemId)) return fail("unknown_item");
    if (action === "rent" && actor.home?.roomType === itemId) return fail("same_room");
    if ((action === "move_out" || (action === "enter" && home)) && !actor.home) return fail("no_home");
  }
  const centre = interactableCentre(world, interactable);
  if (Math.hypot(centre.x - actor.x, centre.z - actor.z) > maxDistance) return fail("too_far");
  if (objectActions(interactable, actor, occupancy).includes(action)) return ok;
  const anyFree = hasFreeFor(interactable, action, occupancy, actor.id);
  if (SEAT_ACTIONS.includes(action) && !anyFree) return fail("no_free_seat");
  if (STANDING_SPOT_ACTIONS.includes(action) && !anyFree) return fail("busy");
  return fail("action_not_available");
}

/**
 * Server-side validation of a player interaction request. `lastAt` is when
 * this actor last did the same action towards the same player.
 */
export function validatePlayerAction(
  actor: ActorView,
  target: { id: string; x: number; z: number; connected: boolean; npc?: boolean } | null,
  action: ActionId,
  lastAt: number | undefined,
  now: number,
  maxDistance: number = INTERACTION_CONFIG.maxDistance,
): Check {
  if (!target) return fail("unknown_target");
  if (target.id === actor.id) return fail("target_is_self");
  if (!target.connected) return fail("target_offline");
  const cooldown = PLAYER_ACTION_COOLDOWN_MS[action];
  if (cooldown === undefined || !playerActions(actor, target).includes(action)) return fail("action_not_available");
  if (Math.hypot(target.x - actor.x, target.z - actor.z) > maxDistance) return fail("too_far");
  if (lastAt !== undefined && now - lastAt < cooldown) return fail("too_soon");
  return ok;
}

/** The free seat (or spot) for this action closest to the actor (or the one they already hold). */
export function chooseSeat(interactable: Interactable, occupancy: SeatOccupancy, actor: ActorView, action: ActionId = "sit"): Seat | null {
  let best: Seat | null = null;
  let bestDistance = Infinity;
  for (const seat of seatsFor(interactable, action)) {
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
