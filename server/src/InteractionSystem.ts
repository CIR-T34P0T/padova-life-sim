// Authoritative contextual interactions (M3, extended in M5).
//
// Lifecycle of an action:
//   request → validate (target exists, action offered, distance, seat or spot
//   free, character able, route exists) → reserve the seat/spot → walk to the
//   interaction point ("approach") → on arrival re-check and execute:
//     seat:        sit down, then sitting / studying / sketching
//     seat:        sit down, then sitting / studying / sketching, or at a
//                  lecture desk attend a lecture or sit the exam (M8: the
//                  timetable is checked again on arrival)
//     standing:    stand at the spot; café: pay ("paying") then eat or drink,
//                  or ask about work (hired once the database confirms),
//                  or (staff spot) work a shift; fountain: wash; notice
//                  board: enrol (once the database confirms); door: go through
//                  (the student housing's door: to your own home, or rent a
//                  room or move out once the database confirms, M10)
//     bed:         lie down and sleep (M10); you get up when it ends
//   → finish (timed actions end on a server timer) or keep state (sitting).
// A finished shift is paid, and a finished lecture or exam recorded
// ("paying"), before it counts as completed; one that ends early never counts.
// Player actions (greet, chat since M9) walk to the other player first; a
// block either way refuses them (the social system's call). Shared moments
// (a greeting, a completed chat, studying at the same table or attending the
// same lecture) are passed to the social system for relationships.
// The client is told about each step but never decides one: arrival, timers,
// payments and completion are all measured here. Life effects (needs, skills,
// money) are applied through `hooks`, implemented by the LifeSystem.

import { randomUUID } from "node:crypto";
import {
  HOME_LINK,
  INTERACTION_CONFIG,
  ServerMessage,
  chooseSeat,
  facingTowards,
  findInteractable,
  findMenuItem,
  findSeat,
  greetApproachPoint,
  parseInteract,
  validateObjectAction,
  validatePlayerAction,
  type ActionId,
  type ActionUpdatePayload,
  type ActorView,
  type CancelReason,
  type CourseId,
  type CourseStatus,
  type GreetedPayload,
  type InteractPayload,
  type DoorLink,
  type InteractionFailure,
  type JobId,
  type PathFailure,
  type RejectedPayload,
  type ResolvedEffect,
  type Seat,
  type Vec2,
} from "@padova/shared";
import type { AreaWorld } from "./areas.ts";
import type { HousingHooks } from "./housing/HousingSystem.ts";
import type { SeatBook } from "./seats.ts";
import type { SocialHooks } from "./social/SocialSystem.ts";
import { log } from "./log.ts";
import type { PendingAction, PlayerRuntime } from "./runtime.ts";
import type { PlayerState, PlazaState } from "./schema.ts";
import type { RoomTuning } from "./tuning.ts";

/** Life-simulation callbacks (LifeSystem). All optional so the system works without them. */
export interface InteractionHooks {
  /** Why this character can't start the action now (e.g. too tired), or null. */
  checkStart(sessionId: string, action: ActionId, itemId?: string): InteractionFailure | null;
  /** The effect of a timed action, or null for untimed ones. */
  effectFor(action: ActionId, itemId?: string): ResolvedEffect | null;
  /** Charges for a purchase on arrival at the counter. */
  purchase(sessionId: string, pending: PendingAction): Promise<"ok" | InteractionFailure>;
  /** A paid order that can no longer be served. */
  refund(sessionId: string, pending: PendingAction): void;
  /** A timed action finished normally. */
  onCompleted(sessionId: string, pending: PendingAction): void;
  /** A greeting started. */
  onGreeting(greeterId: string, targetId: string): void;
  /** A chat finished: the other player's share of it (M9). */
  onChatted(initiatorId: string, targetId: string): void;
  /** The character's job, or null (decides whether the counter offers "ask about work" or a shift). */
  jobOf(sessionId: string): JobId | null;
  /** Hires the character on arrival at the counter. */
  hire(sessionId: string, pending: PendingAction): Promise<"ok" | InteractionFailure>;
  /** At the staff spot: re-checks the shift can start and decides its grade and wage (sets `pending.shift`). */
  startShift(sessionId: string, pending: PendingAction): InteractionFailure | null;
  /** The shift's time is up: records it and pays the wage. */
  payShift(sessionId: string, pending: PendingAction): Promise<"ok" | InteractionFailure>;
  /** The character's course and its status, or null (decides what lecture desks offer, M8). */
  courseOf(sessionId: string): { courseId: CourseId; status: CourseStatus } | null;
  /** Enrols the character on arrival at the notice board. */
  enrol(sessionId: string, pending: PendingAction): Promise<"ok" | InteractionFailure>;
  /** At the lecture desk: re-checks the timetable and fixes which lecture or sitting counts (sets `pending.course`). */
  startCourseAction(sessionId: string, pending: PendingAction): InteractionFailure | null;
  /** The lecture or exam's time is up: records the lecture, or grades the exam. */
  finishCourseAction(sessionId: string, pending: PendingAction): Promise<"ok" | InteractionFailure>;
}

const NO_HOOKS: InteractionHooks = {
  checkStart: () => null,
  effectFor: () => null,
  purchase: async () => "purchase_failed",
  refund: () => undefined,
  onCompleted: () => undefined,
  onGreeting: () => undefined,
  onChatted: () => undefined,
  jobOf: () => null,
  hire: async () => "hire_failed",
  startShift: () => "not_employed",
  payShift: async () => "wage_failed",
  courseOf: () => null,
  enrol: async () => "enrol_failed",
  startCourseAction: () => "not_enrolled",
  finishCourseAction: async () => "record_failed",
};

export interface InteractionDeps {
  state: PlazaState;
  /** Seat and spot reservations (shared ones replicated, home ones private, M10). */
  seats: SeatBook;
  runtimes: Map<string, PlayerRuntime>;
  /** The layout and navigation grid of the area this player is in (M7c). */
  area: (sessionId: string) => AreaWorld;
  /** Moves a player through a door into the linked area (M7c); false if it leads nowhere. */
  enterArea: (sessionId: string, link: DoorLink) => boolean;
  tuning: RoomTuning;
  /** Sends a message to one connected client; silently skips absent clients. */
  send: (sessionId: string, type: string, payload: unknown) => void;
  now: () => number;
  hooks?: InteractionHooks;
  /** Blocks and shared moments (M9). Optional so the system works without it. */
  social?: SocialHooks;
  /** Homes (M10). Optional so the system works without it. */
  housing?: HousingHooks;
}

const PATH_FAILURE_TO_REASON: Record<PathFailure, InteractionFailure> = {
  target_out_of_bounds: "blocked",
  target_blocked: "blocked",
  unreachable: "unreachable",
  search_limit: "unreachable",
};

/** Seated timed actions: begin at the seat, return to "sitting" afterwards (sleeping: get up, M10). */
const SEATED_TIMED: readonly ActionId[] = ["study", "sketch", "attend", "exam", "sleep"];
/** Actions done at a standing spot, which is free again as soon as they end. */
const STANDING: readonly ActionId[] = ["buy", "wash", "ask_work", "work", "enter", "enrol", "rent", "move_out"];
/** Timed actions whose result is recorded in the database before they count (M8). */
const COURSE_ACTIONS: readonly ActionId[] = ["attend", "exam"];

export class InteractionSystem {
  private nextActionId = 1;
  private readonly hooks: InteractionHooks;

  constructor(private readonly deps: InteractionDeps) {
    this.hooks = deps.hooks ?? NO_HOOKS;
  }

  // ── Requests ────────────────────────────────────────────────────────────

  request(sessionId: string, payload: unknown): void {
    const parsed = parseInteract(payload);
    if (!parsed.ok) {
      const rejected: RejectedPayload = { action: "interact", reason: parsed.reason };
      this.deps.send(sessionId, ServerMessage.Rejected, rejected);
      return;
    }
    const context = this.context(sessionId);
    if (!context) return;
    if (parsed.value.targetKind === "object") this.requestObjectAction(sessionId, parsed.value, context);
    else this.requestPlayerAction(sessionId, parsed.value, context);
  }

  private requestObjectAction(sessionId: string, request: InteractPayload, { player, runtime }: Context): void {
    const world = this.deps.area(sessionId).layout;
    const { maxInteractionDistance } = this.deps.tuning;
    const item = findInteractable(world, request.targetId);
    if (!item) return this.reject(sessionId, request, "unknown_target");
    const check = validateObjectAction(
      world,
      item,
      this.actorView(sessionId),
      this.deps.seats,
      request.action,
      maxInteractionDistance,
      request.itemId,
    );
    if (!check.ok) return this.reject(sessionId, request, check.reason);
    // What sleeping gives depends on the bed (M10): the server's own record of it, never the client's.
    if (request.action === "sleep") request.itemId = item.furniture;
    const unable = this.hooks.checkStart(sessionId, request.action, request.itemId);
    if (unable) return this.reject(sessionId, request, unable);

    this.cancel(sessionId, "replaced");
    const seatedHere = item.seats.some((seat) => seat.id === player.seatId);

    if (request.action === "stand") {
      const id = this.nextActionId++;
      this.standUp(sessionId);
      this.update(sessionId, { actionId: id, status: "completed", ...target(request) });
      return;
    }

    if (SEATED_TIMED.includes(request.action) && seatedHere) {
      // Already sitting here: start right away.
      const pending = this.newPending(request, player.seatId, { x: runtime.character.x, z: runtime.character.z });
      runtime.pending = pending;
      this.beginAtSeat(sessionId, pending);
      return;
    }

    // Sitting elsewhere? Stand up first, then walk over.
    if (player.seatId) this.standUp(sessionId);
    const seat = chooseSeat(item, this.deps.seats, this.actorView(sessionId), request.action);
    if (!seat) return this.reject(sessionId, request, seatIsStanding(item.seats[0]) ? "busy" : "no_free_seat");
    const path = this.deps.area(sessionId).nav.findPath(runtime.character, seat.approach);
    if (!path.ok) return this.reject(sessionId, request, PATH_FAILURE_TO_REASON[path.reason]);

    this.deps.seats.set(seat.id, sessionId);
    runtime.character.intent = { kind: "path", waypoints: path.waypoints };
    runtime.pending = this.newPending(request, seat.id, seat.approach);
    this.update(sessionId, { actionId: runtime.pending.id, status: "queued", ...target(runtime.pending) });
  }

  private requestPlayerAction(sessionId: string, request: InteractPayload, { player, runtime }: Context): void {
    // Only players in the same area exist for you (M7c).
    const sameArea = this.deps.runtimes.get(request.targetId)?.area === runtime.area;
    const targetPlayer = sameArea ? this.deps.state.players.get(request.targetId) : undefined;
    const targetView = targetPlayer
      ? { id: request.targetId, x: targetPlayer.x, z: targetPlayer.z, connected: targetPlayer.connected, npc: targetPlayer.role !== "" }
      : null;
    // A block either way comes first, so a blocked player always gets the same neutral answer (M9).
    const blocked = targetPlayer ? this.deps.social?.refusal(sessionId, request.targetId) : null;
    if (blocked) return this.reject(sessionId, request, blocked);
    const check = validatePlayerAction(
      this.actorView(sessionId),
      targetView,
      request.action,
      runtime.lastSocialAt.get(`${request.action}:${request.targetId}`),
      this.deps.now(),
      this.deps.tuning.maxInteractionDistance,
    );
    if (!check.ok || !targetPlayer) return this.reject(sessionId, request, check.ok ? "unknown_target" : check.reason);

    this.cancel(sessionId, "replaced");
    if (player.seatId) this.standUp(sessionId);
    const pending = this.newPending(request, "", { x: targetPlayer.x, z: targetPlayer.z });
    const planned = this.planGreeting(sessionId, runtime, pending, targetPlayer);
    if (planned === "unreachable") return this.reject(sessionId, request, "unreachable");
    runtime.pending = pending;
    if (planned === "in_range") this.beginWithPlayer(sessionId, pending, targetPlayer);
    else this.update(sessionId, { actionId: pending.id, status: "queued", ...target(request) });
  }

  // ── Simulation step ─────────────────────────────────────────────────────

  /** Called every server tick, after movement and life effects have been stepped. */
  tick(): void {
    const now = this.deps.now();
    for (const [sessionId, runtime] of this.deps.runtimes) {
      const pending = runtime.pending;
      if (!pending) continue;

      if (pending.targetKind === "player") {
        const targetPlayer = this.deps.state.players.get(pending.targetId);
        if (!targetPlayer || this.deps.runtimes.get(pending.targetId)?.area !== runtime.area) {
          this.fail(sessionId, "target_left");
          continue;
        }
        if (!targetPlayer.connected) {
          this.fail(sessionId, "target_offline");
          continue;
        }
        if (pending.phase === "approach" && runtime.character.intent.kind === "idle") {
          this.arriveForGreeting(sessionId, runtime, pending, targetPlayer);
          continue;
        }
        // A chat needs the two players to stay close (M9).
        if (pending.action === "chat" && pending.phase === "active" && Math.hypot(targetPlayer.x - runtime.character.x, targetPlayer.z - runtime.character.z) > INTERACTION_CONFIG.chatRange) {
          this.fail(sessionId, "target_moved");
          continue;
        }
      } else if (pending.phase === "approach" && runtime.character.intent.kind === "idle") {
        // Path finished (or got stuck). Only act if we really are at the interaction point.
        const distance = Math.hypot(runtime.character.x - pending.goal.x, runtime.character.z - pending.goal.z);
        if (distance <= INTERACTION_CONFIG.arrivalTolerance) this.arrive(sessionId, pending);
        else this.fail(sessionId, "blocked");
        continue;
      }

      if (pending.phase === "active" && pending.endsAt > 0 && now >= pending.endsAt) {
        if (pending.action === "work") this.finishShift(sessionId, pending);
        else if (COURSE_ACTIONS.includes(pending.action)) this.finishCourseAction(sessionId, pending);
        else this.complete(sessionId, pending);
      }
    }
  }

  // ── Interruptions ───────────────────────────────────────────────────────

  /** Player asked to cancel from the UI (or pressed Escape). */
  cancelRequest(sessionId: string): void {
    this.cancel(sessionId, "cancelled");
  }

  /**
   * The player gave a movement order. Any action is interrupted; a real move
   * (not a plain "stop") also makes a seated character stand up first.
   */
  onMovementIntent(sessionId: string, standsUp: boolean): void {
    this.cancel(sessionId, "interrupted");
    if (standsUp) this.standUp(sessionId);
  }

  /** Where the character will be standing when it next walks (seat approach point if seated). */
  standingPosition(sessionId: string): Vec2 | null {
    const runtime = this.deps.runtimes.get(sessionId);
    const player = this.deps.state.players.get(sessionId);
    if (!runtime || !player) return null;
    const seated = player.seatId ? findSeat(this.deps.area(sessionId).layout, player.seatId) : null;
    return seated ? { ...seated.seat.approach } : { x: runtime.character.x, z: runtime.character.z };
  }

  /** Stops any greeting or chat between two players, either way (after one blocks the other, M9). */
  cancelBetween(a: string, b: string): void {
    for (const [self, other] of [
      [a, b],
      [b, a],
    ] as const) {
      const pending = this.deps.runtimes.get(self)?.pending;
      if (pending?.targetKind === "player" && pending.targetId === other) this.cancel(self, "cancelled");
    }
  }

  /** Stops whatever the character is doing and stands them up (their room is about to change around them, M10). */
  interrupt(sessionId: string): void {
    this.cancel(sessionId, "interrupted");
    this.standUp(sessionId);
  }

  /** Stops a shift being walked to, worked or paid (quitting the job). Unpaid unless its wage was already being paid. */
  cancelWork(sessionId: string): void {
    if (this.deps.runtimes.get(sessionId)?.pending?.action === "work") this.cancel(sessionId, "cancelled");
  }

  /** Connection dropped: stop what they were doing but keep their seat while they may reconnect. */
  onDrop(sessionId: string): void {
    this.cancel(sessionId, "disconnected");
  }

  /** Player left for good: stop, free every seat they held. */
  onLeave(sessionId: string): void {
    this.cancel(sessionId, "disconnected");
    this.releaseSeatsOf(sessionId);
  }

  // ── Transitions ─────────────────────────────────────────────────────────

  /** Reached the interaction point: sit down, or stand at the spot. */
  private arrive(sessionId: string, pending: PendingAction): void {
    const context = this.context(sessionId);
    const found = findSeat(this.deps.area(sessionId).layout, pending.seatId);
    if (!context || !found) return this.fail(sessionId, "blocked");
    const { player, runtime } = context;
    const { seat } = found;
    runtime.character.x = seat.x;
    runtime.character.z = seat.z;
    runtime.character.rotation = seat.rotation;
    runtime.character.intent = { kind: "idle" };
    player.x = seat.x;
    player.z = seat.z;
    player.rotation = seat.rotation;
    if (!seatIsStanding(seat)) {
      player.seatId = seat.id;
      this.beginAtSeat(sessionId, pending);
      return;
    }
    if (pending.action === "enter") return this.goThrough(sessionId, pending);
    if (pending.action === "buy") return this.pay(sessionId, pending);
    if (pending.action === "ask_work") return this.hire(sessionId, pending);
    if (pending.action === "enrol") return this.enrol(sessionId, pending);
    if (pending.action === "rent") return this.rent(sessionId, pending);
    if (pending.action === "move_out") return this.moveOut(sessionId, pending);
    if (pending.action === "work") {
      // Opening hours, the daily limit and tiredness are checked again now that the shift really starts.
      const refused = this.hooks.startShift(sessionId, pending);
      if (refused) return this.fail(sessionId, refused);
    }
    this.beginTimed(sessionId, pending);
  }

  /**
   * At a door (M7c): the action completes, then the character is moved into
   * the linked area. The student housing's door leads to the character's own
   * home (M10).
   */
  private goThrough(sessionId: string, pending: PendingAction): void {
    const door = findInteractable(this.deps.area(sessionId).layout, pending.targetId)?.door;
    const link = door?.to === HOME_LINK ? this.deps.housing?.homeLink(sessionId) : door;
    if (!door) return this.fail(sessionId, "action_not_available");
    if (!link) return this.fail(sessionId, "no_home");
    this.complete(sessionId, pending);
    if (!this.deps.enterArea(sessionId, link)) log.error("interact", `door ${pending.targetId} leads nowhere (${link.to}/${link.door})`);
  }

  /** At the student housing's door (M10): rented once the database confirms, then straight in. */
  private rent(sessionId: string, pending: PendingAction): void {
    const housing = this.deps.housing;
    if (!this.context(sessionId) || !housing) return this.fail(sessionId, "rent_failed");
    pending.phase = "paying";
    void housing.rent(sessionId, pending).then((result) => {
      // Cancelled meanwhile: the room, if rented, shows in the character panel.
      if (this.deps.runtimes.get(sessionId)?.pending !== pending) return;
      if (result !== "ok") return this.fail(sessionId, result);
      this.complete(sessionId, pending);
      const link = housing.homeLink(sessionId);
      if (link && !this.deps.enterArea(sessionId, link)) log.error("interact", `new home of ${sessionId} can't be entered (${link.to})`);
    });
  }

  /** At the student housing's door (M10): moved out once the database confirms. */
  private moveOut(sessionId: string, pending: PendingAction): void {
    const housing = this.deps.housing;
    if (!this.context(sessionId) || !housing) return this.fail(sessionId, "rent_failed");
    pending.phase = "paying";
    void housing.moveOut(sessionId, pending).then((result) => {
      if (this.deps.runtimes.get(sessionId)?.pending !== pending) return;
      if (result === "ok") this.complete(sessionId, pending);
      else this.fail(sessionId, result);
    });
  }

  /** At the seat: sitting completes at once; studying and sketching run on server timers. */
  private beginAtSeat(sessionId: string, pending: PendingAction): void {
    const context = this.context(sessionId);
    if (!context) return;
    const { player, runtime } = context;
    if (COURSE_ACTIONS.includes(pending.action)) {
      // The lecture's late entry or the sitting may have closed while walking over.
      const refused = this.hooks.startCourseAction(sessionId, pending);
      if (refused) {
        player.activity = "sitting";
        return this.fail(sessionId, refused);
      }
    }
    if (SEATED_TIMED.includes(pending.action)) return this.beginTimed(sessionId, pending);
    pending.phase = "active";
    player.activity = "sitting";
    this.update(sessionId, { actionId: pending.id, status: "started", ...target(pending) });
    this.update(sessionId, { actionId: pending.id, status: "completed", ...target(pending) });
    runtime.pending = null;
  }

  /** At the café counter: pay first (database transaction), then eat or drink. */
  private pay(sessionId: string, pending: PendingAction): void {
    const context = this.context(sessionId);
    if (!context) return;
    pending.phase = "paying";
    context.player.activity = "ordering";
    void this.hooks.purchase(sessionId, pending).then((result) => {
      const still = this.deps.runtimes.get(sessionId)?.pending === pending;
      if (!still) {
        // Cancelled, replaced or gone while paying: give the money back (D-025).
        if (result === "ok") this.hooks.refund(sessionId, pending);
        return;
      }
      if (result === "ok") this.beginTimed(sessionId, pending);
      else this.fail(sessionId, result);
    });
  }

  /** At the counter: hired as soon as the database records it. */
  private hire(sessionId: string, pending: PendingAction): void {
    if (!this.context(sessionId)) return;
    pending.phase = "paying";
    void this.hooks.hire(sessionId, pending).then((result) => {
      // Cancelled meanwhile: nothing to undo (the job, if recorded, shows in the character panel).
      if (this.deps.runtimes.get(sessionId)?.pending !== pending) return;
      if (result === "ok") this.complete(sessionId, pending);
      else this.fail(sessionId, result);
    });
  }

  /** At the notice board: enrolled as soon as the database records it. */
  private enrol(sessionId: string, pending: PendingAction): void {
    if (!this.context(sessionId)) return;
    pending.phase = "paying";
    void this.hooks.enrol(sessionId, pending).then((result) => {
      // Cancelled meanwhile: nothing to undo (the enrolment, if recorded, shows in the character panel).
      if (this.deps.runtimes.get(sessionId)?.pending !== pending) return;
      if (result === "ok") this.complete(sessionId, pending);
      else this.fail(sessionId, result);
    });
  }

  /** The lecture or exam is over: it counts as completed only once it is recorded (graded, for the exam). */
  private finishCourseAction(sessionId: string, pending: PendingAction): void {
    pending.phase = "paying";
    void this.hooks.finishCourseAction(sessionId, pending).then((result) => {
      // Stopped while recording: the lecture or exam was fully done, so a recorded result stands.
      if (this.deps.runtimes.get(sessionId)?.pending !== pending) return;
      if (result === "ok") this.complete(sessionId, pending);
      else this.fail(sessionId, result);
    });
  }

  /** The shift's time is up: it counts as completed only once its wage is recorded. */
  private finishShift(sessionId: string, pending: PendingAction): void {
    pending.phase = "paying";
    void this.hooks.payShift(sessionId, pending).then((result) => {
      // Stopped while the wage was being paid: the shift was fully worked, so a recorded wage stands.
      if (this.deps.runtimes.get(sessionId)?.pending !== pending) return;
      if (result === "ok") this.complete(sessionId, pending);
      else this.fail(sessionId, result);
    });
  }

  /** Starts a timed action whose effects the life system applies as time passes. */
  private beginTimed(sessionId: string, pending: PendingAction): void {
    const context = this.context(sessionId);
    if (!context) return;
    const effect = this.hooks.effectFor(pending.action, pending.itemId);
    const durationMs = this.durationOf(pending, effect);
    const now = this.deps.now();
    pending.phase = "active";
    pending.effect = effect;
    pending.appliedFraction = 0;
    pending.startedAt = now;
    pending.endsAt = now + durationMs;
    context.player.activity = effect?.activity ?? activityFallback(pending.action);
    this.update(sessionId, { actionId: pending.id, status: "started", durationMs, ...target(pending) });
  }

  private durationOf(pending: PendingAction, effect: ResolvedEffect | null): number {
    const { actionDurationsMs, consumeDurationFactor } = this.deps.tuning;
    if (pending.action === "buy") {
      const item = pending.itemId ? findMenuItem(pending.itemId) : null;
      return Math.max(1, Math.round((item?.consumeMs ?? 5_000) * consumeDurationFactor));
    }
    if (
      pending.action === "study" ||
      pending.action === "sketch" ||
      pending.action === "wash" ||
      pending.action === "work" ||
      pending.action === "attend" ||
      pending.action === "exam" ||
      pending.action === "chat" ||
      pending.action === "sleep"
    ) {
      return actionDurationsMs[pending.action];
    }
    return effect?.durationMs ?? actionDurationsMs.greet;
  }

  /** Returns "in_range", "walking" (path set) or "unreachable". */
  private planGreeting(
    sessionId: string,
    runtime: PlayerRuntime,
    pending: PendingAction,
    targetPlayer: PlayerState,
  ): "in_range" | "walking" | "unreachable" {
    const from = { x: runtime.character.x, z: runtime.character.z };
    const to = { x: targetPlayer.x, z: targetPlayer.z };
    if (Math.hypot(to.x - from.x, to.z - from.z) <= INTERACTION_CONFIG.greetRange) return "in_range";
    const area = this.deps.area(sessionId);
    const spot = greetApproachPoint(area.layout, from, to);
    if (!spot) return "unreachable";
    const path = area.nav.findPath(from, spot);
    if (!path.ok) return "unreachable";
    pending.goal = spot;
    runtime.character.intent = { kind: "path", waypoints: path.waypoints };
    log.debug("interact", `${sessionId} walking to greet ${pending.targetId}`);
    return "walking";
  }

  private arriveForGreeting(sessionId: string, runtime: PlayerRuntime, pending: PendingAction, targetPlayer: PlayerState): void {
    const distance = Math.hypot(targetPlayer.x - runtime.character.x, targetPlayer.z - runtime.character.z);
    if (distance <= INTERACTION_CONFIG.greetRange) return this.beginWithPlayer(sessionId, pending, targetPlayer);
    // They walked away while we approached: re-plan a few times, then give up.
    if (pending.replans >= INTERACTION_CONFIG.maxGreetReplans) return this.fail(sessionId, "target_moved");
    pending.replans++;
    const planned = this.planGreeting(sessionId, runtime, pending, targetPlayer);
    if (planned === "in_range") this.beginWithPlayer(sessionId, pending, targetPlayer);
    else if (planned === "unreachable") this.fail(sessionId, "target_moved");
  }

  /**
   * In range of the other player: a greeting (instant effects) or a chat (a
   * timed effect, completed later). Either way the other player is told.
   */
  private beginWithPlayer(sessionId: string, pending: PendingAction, targetPlayer: PlayerState): void {
    const context = this.context(sessionId);
    if (!context) return;
    const { player, runtime } = context;
    const now = this.deps.now();
    const facing = facingTowards(runtime.character, targetPlayer);
    const chat = pending.action === "chat";
    const effect = chat ? this.hooks.effectFor("chat") : null;
    const durationMs = chat ? this.deps.tuning.actionDurationsMs.chat : this.deps.tuning.actionDurationsMs.greet;
    runtime.character.intent = { kind: "idle" };
    runtime.character.rotation = facing;
    runtime.lastSocialAt.set(`${pending.action}:${pending.targetId}`, now);
    player.rotation = facing;
    player.activity = chat ? (effect?.activity ?? "chatting") : "greeting";
    player.targetId = pending.targetId;
    pending.phase = "active";
    pending.effect = effect;
    pending.appliedFraction = 0;
    pending.startedAt = now;
    pending.endsAt = now + durationMs;
    this.update(sessionId, { actionId: pending.id, status: "started", durationMs, ...target(pending) });
    const greeted: GreetedPayload = { fromId: sessionId, fromName: player.name, action: chat ? "chat" : "greet" };
    this.deps.send(pending.targetId, ServerMessage.Greeted, greeted);
    if (!chat) {
      this.hooks.onGreeting(sessionId, pending.targetId);
      this.deps.social?.shared(sessionId, pending.targetId, "greet");
    }
  }

  private complete(sessionId: string, pending: PendingAction): void {
    const context = this.context(sessionId);
    if (!context) return;
    const { player, runtime } = context;
    this.hooks.onCompleted(sessionId, pending);
    if (pending.action === "chat") {
      this.hooks.onChatted(sessionId, pending.targetId);
      this.deps.social?.shared(sessionId, pending.targetId, "chat");
    }
    if (pending.action === "study" || pending.action === "attend") this.sharedWithCompanions(sessionId, pending);
    if (pending.action === "sleep") {
      // Awake: out of bed (M10).
      runtime.pending = null;
      this.standUp(sessionId);
      this.deps.housing?.onSlept(sessionId);
      this.update(sessionId, { actionId: pending.id, status: "completed", ...target(pending) });
      return;
    }
    if (SEATED_TIMED.includes(pending.action)) player.activity = "sitting"; // stays seated
    if (pending.action === "greet" || pending.action === "chat") {
      player.activity = "idle";
      player.targetId = "";
    }
    if (STANDING.includes(pending.action)) {
      player.activity = "idle";
      this.releaseStandingSpot(sessionId, pending);
    }
    runtime.pending = null;
    this.update(sessionId, { actionId: pending.id, status: "completed", ...target(pending) });
  }

  /**
   * Studying at the same table, or attending the same lecture, as someone
   * still doing it when this one finishes is a shared moment (M9). Counted
   * once, by whoever finishes first.
   */
  private sharedWithCompanions(sessionId: string, pending: PendingAction): void {
    if (!this.deps.social) return;
    const kind = pending.action === "study" ? "study_together" : "lecture_together";
    for (const [otherId, other] of this.deps.runtimes) {
      const theirs = other.pending;
      if (otherId === sessionId || !theirs || theirs.action !== pending.action || (theirs.phase !== "active" && theirs.phase !== "paying")) continue;
      const together = pending.action === "study" ? theirs.targetId === pending.targetId : theirs.course !== undefined && theirs.course.key === pending.course?.key;
      if (together && other.area === this.deps.runtimes.get(sessionId)?.area) this.deps.social.shared(sessionId, otherId, kind);
    }
  }

  private cancel(sessionId: string, reason: CancelReason): void {
    this.endEarly(sessionId, "cancelled", reason);
  }

  private fail(sessionId: string, reason: InteractionFailure): void {
    this.endEarly(sessionId, "failed", reason);
  }

  /**
   * Stops the pending action, undoing anything it reserved, and tells the
   * player. Effects already applied stay applied (partial effect). A payment
   * still in flight is refunded when it resolves (see pay()).
   */
  private endEarly(sessionId: string, status: "cancelled" | "failed", reason: CancelReason | InteractionFailure): void {
    const context = this.context(sessionId);
    const pending = context?.runtime.pending;
    if (!context || !pending) return;
    const { player, runtime } = context;
    runtime.pending = null;
    if (pending.phase === "approach") {
      runtime.character.intent = { kind: "idle" };
      if (pending.seatId && player.seatId !== pending.seatId && this.deps.seats.get(pending.seatId) === sessionId) {
        this.deps.seats.delete(pending.seatId);
      }
    } else if (pending.action === "sleep") {
      // Woken early: you keep what you slept, and get up (M10).
      this.standUp(sessionId);
    } else if (SEATED_TIMED.includes(pending.action)) {
      player.activity = "sitting";
    } else if (pending.action === "greet" || pending.action === "chat") {
      player.activity = "idle";
      player.targetId = "";
    } else if (STANDING.includes(pending.action)) {
      player.activity = "idle";
      this.releaseStandingSpot(sessionId, pending);
    }
    this.update(sessionId, { actionId: pending.id, status, reason, ...target(pending) });
  }

  private standUp(sessionId: string): void {
    const context = this.context(sessionId);
    if (!context || !context.player.seatId) return;
    const { player, runtime } = context;
    const seated = findSeat(this.deps.area(sessionId).layout, player.seatId);
    if (this.deps.seats.get(player.seatId) === sessionId) this.deps.seats.delete(player.seatId);
    player.seatId = "";
    player.activity = "idle";
    runtime.character.intent = { kind: "idle" };
    if (seated) {
      runtime.character.x = seated.seat.approach.x;
      runtime.character.z = seated.seat.approach.z;
      player.x = runtime.character.x;
      player.z = runtime.character.z;
    }
  }

  private releaseStandingSpot(sessionId: string, pending: PendingAction): void {
    if (pending.seatId && this.deps.seats.get(pending.seatId) === sessionId) this.deps.seats.delete(pending.seatId);
  }

  private releaseSeatsOf(sessionId: string): void {
    for (const seatId of this.deps.seats.heldBy(sessionId)) this.deps.seats.delete(seatId);
  }

  // ── Helpers ─────────────────────────────────────────────────────────────

  private newPending(request: InteractPayload, seatId: string, goal: Vec2): PendingAction {
    return {
      id: this.nextActionId++,
      action: request.action,
      targetKind: request.targetKind,
      targetId: request.targetId,
      itemId: request.itemId,
      requestId: request.requestId ?? `srv-${randomUUID()}`,
      seatId,
      phase: "approach",
      goal,
      endsAt: 0,
      startedAt: 0,
      effect: null,
      appliedFraction: 0,
      replans: 0,
    };
  }

  private context(sessionId: string): Context | null {
    const runtime = this.deps.runtimes.get(sessionId);
    const player = this.deps.state.players.get(sessionId);
    return runtime && player ? { runtime, player } : null;
  }

  private actorView(sessionId: string): ActorView {
    const context = this.context(sessionId);
    if (!context) return { id: sessionId, x: 0, z: 0, seatId: "", activity: "idle" };
    return {
      id: sessionId,
      x: context.runtime.character.x,
      z: context.runtime.character.z,
      seatId: context.player.seatId,
      activity: context.player.activity,
      job: this.hooks.jobOf(sessionId),
      course: this.hooks.courseOf(sessionId),
      home: this.deps.housing?.homeOf(sessionId) ?? null,
    };
  }

  private reject(sessionId: string, request: InteractPayload, reason: InteractionFailure): void {
    this.update(sessionId, { actionId: 0, status: "rejected", reason, ...target(request) });
  }

  private update(sessionId: string, payload: ActionUpdatePayload): void {
    this.deps.send(sessionId, ServerMessage.ActionUpdate, payload);
  }
}

interface Context {
  runtime: PlayerRuntime;
  player: PlayerState;
}

const seatIsStanding = (seat: Seat | undefined) => seat?.pose === "stand";

/** Public activity for timed actions when no life system supplies an effect. */
const FALLBACK_ACTIVITY: Partial<Record<ActionId, string>> = {
  study: "studying",
  sketch: "sketching",
  wash: "washing",
  buy: "eating",
  work: "working",
  attend: "attending",
  exam: "exam",
  chat: "chatting",
  sleep: "sleeping",
};
const activityFallback = (action: ActionId): string => FALLBACK_ACTIVITY[action] ?? "idle";

const target = (source: Pick<InteractPayload, "action" | "targetKind" | "targetId" | "itemId">) => ({
  action: source.action,
  targetKind: source.targetKind,
  targetId: source.targetId,
  ...(source.itemId ? { itemId: source.itemId } : {}),
});
