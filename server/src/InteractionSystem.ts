// Authoritative contextual interactions (M3, extended in M5).
//
// Lifecycle of an action:
//   request → validate (target exists, action offered, distance, seat or spot
//   free, character able, route exists) → reserve the seat/spot → walk to the
//   interaction point ("approach") → on arrival re-check and execute:
//     seat:        sit down, then sitting / studying / sketching
//     standing:    stand at the spot; café: pay ("paying") then eat or drink,
//                  or ask about work (hired once the database confirms),
//                  or (staff spot) work a shift; fountain: wash
//   → finish (timed actions end on a server timer) or keep state (sitting).
// A finished shift is paid ("paying") before it counts as completed; a shift
// that ends early is never paid.
// The client is told about each step but never decides one: arrival, timers,
// payments and completion are all measured here. Life effects (needs, skills,
// money) are applied through `hooks`, implemented by the LifeSystem.

import { randomUUID } from "node:crypto";
import {
  INTERACTION_CONFIG,
  NavGrid,
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
  type GreetedPayload,
  type InteractPayload,
  type InteractionFailure,
  type JobId,
  type PathFailure,
  type RejectedPayload,
  type ResolvedEffect,
  type Seat,
  type Vec2,
} from "@padova/shared";
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
  /** The character's job, or null (decides whether the counter offers "ask about work" or a shift). */
  jobOf(sessionId: string): JobId | null;
  /** Hires the character on arrival at the counter. */
  hire(sessionId: string, pending: PendingAction): Promise<"ok" | InteractionFailure>;
  /** At the staff spot: re-checks the shift can start and decides its grade and wage (sets `pending.shift`). */
  startShift(sessionId: string, pending: PendingAction): InteractionFailure | null;
  /** The shift's time is up: records it and pays the wage. */
  payShift(sessionId: string, pending: PendingAction): Promise<"ok" | InteractionFailure>;
}

const NO_HOOKS: InteractionHooks = {
  checkStart: () => null,
  effectFor: () => null,
  purchase: async () => "purchase_failed",
  refund: () => undefined,
  onCompleted: () => undefined,
  onGreeting: () => undefined,
  jobOf: () => null,
  hire: async () => "hire_failed",
  startShift: () => "not_employed",
  payShift: async () => "wage_failed",
};

export interface InteractionDeps {
  state: PlazaState;
  runtimes: Map<string, PlayerRuntime>;
  nav: NavGrid;
  tuning: RoomTuning;
  /** Sends a message to one connected client; silently skips absent clients. */
  send: (sessionId: string, type: string, payload: unknown) => void;
  now: () => number;
  hooks?: InteractionHooks;
}

const PATH_FAILURE_TO_REASON: Record<PathFailure, InteractionFailure> = {
  target_out_of_bounds: "blocked",
  target_blocked: "blocked",
  unreachable: "unreachable",
  search_limit: "unreachable",
};

/** Seated timed actions: begin at the seat, return to "sitting" afterwards. */
const SEATED_TIMED: readonly ActionId[] = ["study", "sketch"];
/** Actions done at a standing spot, which is free again as soon as they end. */
const STANDING: readonly ActionId[] = ["buy", "wash", "ask_work", "work"];

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
    const { world, maxInteractionDistance } = this.deps.tuning;
    const item = findInteractable(world, request.targetId);
    if (!item) return this.reject(sessionId, request, "unknown_target");
    const check = validateObjectAction(
      world,
      item,
      this.actorView(sessionId),
      this.deps.state.seats,
      request.action,
      maxInteractionDistance,
      request.itemId,
    );
    if (!check.ok) return this.reject(sessionId, request, check.reason);
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
    const seat = chooseSeat(item, this.deps.state.seats, this.actorView(sessionId), request.action);
    if (!seat) return this.reject(sessionId, request, seatIsStanding(item.seats[0]) ? "busy" : "no_free_seat");
    const path = this.deps.nav.findPath(runtime.character, seat.approach);
    if (!path.ok) return this.reject(sessionId, request, PATH_FAILURE_TO_REASON[path.reason]);

    this.deps.state.seats.set(seat.id, sessionId);
    runtime.character.intent = { kind: "path", waypoints: path.waypoints };
    runtime.pending = this.newPending(request, seat.id, seat.approach);
    this.update(sessionId, { actionId: runtime.pending.id, status: "queued", ...target(runtime.pending) });
  }

  private requestPlayerAction(sessionId: string, request: InteractPayload, { player, runtime }: Context): void {
    const targetPlayer = this.deps.state.players.get(request.targetId);
    const targetView = targetPlayer
      ? { id: request.targetId, x: targetPlayer.x, z: targetPlayer.z, connected: targetPlayer.connected }
      : null;
    const check = validatePlayerAction(
      this.actorView(sessionId),
      targetView,
      request.action,
      runtime.lastGreetAt.get(request.targetId),
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
    if (planned === "in_range") this.beginGreeting(sessionId, pending, targetPlayer);
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
        if (!targetPlayer) {
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
      } else if (pending.phase === "approach" && runtime.character.intent.kind === "idle") {
        // Path finished (or got stuck). Only act if we really are at the interaction point.
        const distance = Math.hypot(runtime.character.x - pending.goal.x, runtime.character.z - pending.goal.z);
        if (distance <= INTERACTION_CONFIG.arrivalTolerance) this.arrive(sessionId, pending);
        else this.fail(sessionId, "blocked");
        continue;
      }

      if (pending.phase === "active" && pending.endsAt > 0 && now >= pending.endsAt) {
        if (pending.action === "work") this.finishShift(sessionId, pending);
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
    const seated = player.seatId ? findSeat(this.deps.tuning.world, player.seatId) : null;
    return seated ? { ...seated.seat.approach } : { x: runtime.character.x, z: runtime.character.z };
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
    const found = findSeat(this.deps.tuning.world, pending.seatId);
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
    if (pending.action === "buy") return this.pay(sessionId, pending);
    if (pending.action === "ask_work") return this.hire(sessionId, pending);
    if (pending.action === "work") {
      // Opening hours, the daily limit and tiredness are checked again now that the shift really starts.
      const refused = this.hooks.startShift(sessionId, pending);
      if (refused) return this.fail(sessionId, refused);
    }
    this.beginTimed(sessionId, pending);
  }

  /** At the seat: sitting completes at once; studying and sketching run on server timers. */
  private beginAtSeat(sessionId: string, pending: PendingAction): void {
    const context = this.context(sessionId);
    if (!context) return;
    const { player, runtime } = context;
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
    if (pending.action === "study" || pending.action === "sketch" || pending.action === "wash" || pending.action === "work") {
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
    const spot = greetApproachPoint(this.deps.tuning.world, from, to);
    if (!spot) return "unreachable";
    const path = this.deps.nav.findPath(from, spot);
    if (!path.ok) return "unreachable";
    pending.goal = spot;
    runtime.character.intent = { kind: "path", waypoints: path.waypoints };
    log.debug("interact", `${sessionId} walking to greet ${pending.targetId}`);
    return "walking";
  }

  private arriveForGreeting(sessionId: string, runtime: PlayerRuntime, pending: PendingAction, targetPlayer: PlayerState): void {
    const distance = Math.hypot(targetPlayer.x - runtime.character.x, targetPlayer.z - runtime.character.z);
    if (distance <= INTERACTION_CONFIG.greetRange) return this.beginGreeting(sessionId, pending, targetPlayer);
    // They walked away while we approached: re-plan a few times, then give up.
    if (pending.replans >= INTERACTION_CONFIG.maxGreetReplans) return this.fail(sessionId, "target_moved");
    pending.replans++;
    const planned = this.planGreeting(sessionId, runtime, pending, targetPlayer);
    if (planned === "in_range") this.beginGreeting(sessionId, pending, targetPlayer);
    else if (planned === "unreachable") this.fail(sessionId, "target_moved");
  }

  private beginGreeting(sessionId: string, pending: PendingAction, targetPlayer: PlayerState): void {
    const context = this.context(sessionId);
    if (!context) return;
    const { player, runtime } = context;
    const now = this.deps.now();
    const facing = facingTowards(runtime.character, targetPlayer);
    const durationMs = this.deps.tuning.actionDurationsMs.greet;
    runtime.character.intent = { kind: "idle" };
    runtime.character.rotation = facing;
    runtime.lastGreetAt.set(pending.targetId, now);
    player.rotation = facing;
    player.activity = "greeting";
    player.targetId = pending.targetId;
    pending.phase = "active";
    pending.startedAt = now;
    pending.endsAt = now + durationMs;
    this.update(sessionId, { actionId: pending.id, status: "started", durationMs, ...target(pending) });
    const greeted: GreetedPayload = { fromId: sessionId, fromName: player.name };
    this.deps.send(pending.targetId, ServerMessage.Greeted, greeted);
    this.hooks.onGreeting(sessionId, pending.targetId);
  }

  private complete(sessionId: string, pending: PendingAction): void {
    const context = this.context(sessionId);
    if (!context) return;
    const { player, runtime } = context;
    this.hooks.onCompleted(sessionId, pending);
    if (SEATED_TIMED.includes(pending.action)) player.activity = "sitting"; // stays seated
    if (pending.action === "greet") {
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
      if (pending.seatId && player.seatId !== pending.seatId && this.deps.state.seats.get(pending.seatId) === sessionId) {
        this.deps.state.seats.delete(pending.seatId);
      }
    } else if (SEATED_TIMED.includes(pending.action)) {
      player.activity = "sitting";
    } else if (pending.action === "greet") {
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
    const seated = findSeat(this.deps.tuning.world, player.seatId);
    if (this.deps.state.seats.get(player.seatId) === sessionId) this.deps.state.seats.delete(player.seatId);
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
    if (pending.seatId && this.deps.state.seats.get(pending.seatId) === sessionId) this.deps.state.seats.delete(pending.seatId);
  }

  private releaseSeatsOf(sessionId: string): void {
    const owned: string[] = [];
    this.deps.state.seats.forEach((owner, seatId) => {
      if (owner === sessionId) owned.push(seatId);
    });
    for (const seatId of owned) this.deps.state.seats.delete(seatId);
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
const FALLBACK_ACTIVITY: Partial<Record<ActionId, string>> = { study: "studying", sketch: "sketching", wash: "washing", buy: "eating", work: "working" };
const activityFallback = (action: ActionId): string => FALLBACK_ACTIVITY[action] ?? "idle";

const target = (source: Pick<InteractPayload, "action" | "targetKind" | "targetId" | "itemId">) => ({
  action: source.action,
  targetKind: source.targetKind,
  targetId: source.targetId,
  ...(source.itemId ? { itemId: source.itemId } : {}),
});
