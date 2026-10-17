// Authoritative contextual interactions (M3).
//
// Lifecycle of an action:
//   request → validate (target exists, action offered, distance, seat free,
//   route exists) → reserve seat → walk to the interaction point ("approach")
//   → on arrival re-check and execute ("active") → finish or keep state.
// The client is told about each step but never decides one: arrival, timers
// and completion are all measured here.

import {
  INTERACTION_CONFIG,
  NavGrid,
  ServerMessage,
  chooseSeat,
  facingTowards,
  findInteractable,
  findSeat,
  greetApproachPoint,
  parseInteract,
  validateObjectAction,
  validatePlayerAction,
  type ActionUpdatePayload,
  type ActorView,
  type CancelReason,
  type GreetedPayload,
  type InteractPayload,
  type InteractionFailure,
  type PathFailure,
  type RejectedPayload,
  type Vec2,
} from "@padova/shared";
import { log } from "./log.ts";
import type { PendingAction, PlayerRuntime } from "./runtime.ts";
import type { PlayerState, PlazaState } from "./schema.ts";
import type { RoomTuning } from "./tuning.ts";

export interface InteractionDeps {
  state: PlazaState;
  runtimes: Map<string, PlayerRuntime>;
  nav: NavGrid;
  tuning: RoomTuning;
  /** Sends a message to one connected client; silently skips absent clients. */
  send: (sessionId: string, type: string, payload: unknown) => void;
  now: () => number;
}

const PATH_FAILURE_TO_REASON: Record<PathFailure, InteractionFailure> = {
  target_out_of_bounds: "blocked",
  target_blocked: "blocked",
  unreachable: "unreachable",
  search_limit: "unreachable",
};

export class InteractionSystem {
  private nextActionId = 1;

  constructor(private readonly deps: InteractionDeps) {}

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
    const check = validateObjectAction(world, item, this.actorView(sessionId), this.deps.state.seats, request.action, maxInteractionDistance);
    if (!check.ok) return this.reject(sessionId, request, check.reason);

    this.cancel(sessionId, "replaced");
    const seatedHere = item.seats.some((seat) => seat.id === player.seatId);

    if (request.action === "stand") {
      const id = this.nextActionId++;
      this.standUp(sessionId);
      this.update(sessionId, { actionId: id, status: "completed", ...target(request) });
      return;
    }

    if (request.action === "study" && seatedHere) {
      // Already at the desk: start studying where you sit.
      const pending = this.newPending(request, player.seatId, { x: runtime.character.x, z: runtime.character.z });
      runtime.pending = pending;
      this.beginSeatedActivity(sessionId, pending);
      return;
    }

    // Sitting elsewhere? Stand up first, then walk over.
    if (player.seatId) this.standUp(sessionId);
    const seat = chooseSeat(item, this.deps.state.seats, this.actorView(sessionId));
    if (!seat) return this.reject(sessionId, request, "no_free_seat");
    const path = this.deps.nav.findPath(runtime.character, seat.approach);
    if (!path.ok) return this.reject(sessionId, request, PATH_FAILURE_TO_REASON[path.reason]);

    this.deps.state.seats.set(seat.id, sessionId);
    runtime.character.intent = { kind: "path", waypoints: path.waypoints };
    runtime.pending = this.newPending(request, seat.id, seat.approach);
    this.update(sessionId, { actionId: runtime.pending.id, status: "queued", ...target(request) });
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

  /** Called every server tick, after movement has been stepped. */
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
        if (distance <= INTERACTION_CONFIG.arrivalTolerance) this.sitDown(sessionId, pending);
        else this.fail(sessionId, "blocked");
        continue;
      }

      if (pending.phase === "active" && pending.endsAt > 0 && now >= pending.endsAt) {
        this.complete(sessionId, pending);
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

  private sitDown(sessionId: string, pending: PendingAction): void {
    const context = this.context(sessionId);
    const seated = findSeat(this.deps.tuning.world, pending.seatId);
    if (!context || !seated) return this.fail(sessionId, "blocked");
    const { player, runtime } = context;
    const { seat } = seated;
    runtime.character.x = seat.x;
    runtime.character.z = seat.z;
    runtime.character.rotation = seat.rotation;
    runtime.character.intent = { kind: "idle" };
    player.x = seat.x;
    player.z = seat.z;
    player.rotation = seat.rotation;
    player.seatId = seat.id;
    this.beginSeatedActivity(sessionId, pending);
  }

  /** At the seat: sitting completes at once; studying runs on a server timer. */
  private beginSeatedActivity(sessionId: string, pending: PendingAction): void {
    const context = this.context(sessionId);
    if (!context) return;
    const { player, runtime } = context;
    pending.phase = "active";
    if (pending.action === "study") {
      player.activity = "studying";
      pending.endsAt = this.deps.now() + this.deps.tuning.studyDurationMs;
      this.update(sessionId, {
        actionId: pending.id,
        status: "started",
        durationMs: this.deps.tuning.studyDurationMs,
        ...target(pending),
      });
      return;
    }
    player.activity = "sitting";
    this.update(sessionId, { actionId: pending.id, status: "started", ...target(pending) });
    this.update(sessionId, { actionId: pending.id, status: "completed", ...target(pending) });
    runtime.pending = null;
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
    runtime.character.intent = { kind: "idle" };
    runtime.character.rotation = facing;
    runtime.lastGreetAt.set(pending.targetId, now);
    player.rotation = facing;
    player.activity = "greeting";
    player.targetId = pending.targetId;
    pending.phase = "active";
    pending.endsAt = now + this.deps.tuning.greetDurationMs;
    this.update(sessionId, {
      actionId: pending.id,
      status: "started",
      durationMs: this.deps.tuning.greetDurationMs,
      ...target(pending),
    });
    const greeted: GreetedPayload = { fromId: sessionId, fromName: player.name };
    this.deps.send(pending.targetId, ServerMessage.Greeted, greeted);
  }

  private complete(sessionId: string, pending: PendingAction): void {
    const context = this.context(sessionId);
    if (!context) return;
    const { player, runtime } = context;
    if (pending.action === "study") player.activity = "sitting"; // stays at the desk
    if (pending.action === "greet") {
      player.activity = "idle";
      player.targetId = "";
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

  /** Stops the pending action, undoing anything it reserved, and tells the player. */
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
    } else if (pending.action === "study") {
      player.activity = "sitting";
    } else if (pending.action === "greet") {
      player.activity = "idle";
      player.targetId = "";
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

  private releaseSeatsOf(sessionId: string): void {
    const owned: string[] = [];
    this.deps.state.seats.forEach((owner, seatId) => {
      if (owner === sessionId) owned.push(seatId);
    });
    for (const seatId of owned) this.deps.state.seats.delete(seatId);
  }

  // ── Helpers ─────────────────────────────────────────────────────────────

  private newPending(request: Pick<InteractPayload, "action" | "targetKind" | "targetId">, seatId: string, goal: Vec2): PendingAction {
    return {
      id: this.nextActionId++,
      action: request.action,
      targetKind: request.targetKind,
      targetId: request.targetId,
      seatId,
      phase: "approach",
      goal,
      endsAt: 0,
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

const target = (source: Pick<InteractPayload, "action" | "targetKind" | "targetId">) => ({
  action: source.action,
  targetKind: source.targetKind,
  targetId: source.targetId,
});
