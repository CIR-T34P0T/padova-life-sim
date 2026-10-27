// Non-player characters in the room (M11). Each NPC follows its schedule
// (shared/src/npcs.ts) and acts like a player with no client: it arrives on
// the square at a closed street, walks with the same movement rules, goes
// through doors, and asks the interaction system for the same actions
// players use (sit, study, sketch, the barista's shifts), which validates
// them, reserves seats and spots, walks the NPC there and runs the timers.
// Decisions are deterministic and cheap: each NPC reconsiders at most every
// NPC_CONFIG.thinkIntervalMs, and only asks for something new when what it
// is doing no longer fits its schedule. NPCs make room for players
// (npcMayUse), are never saved, and answer a greeting with a line.

import {
  NPCS,
  NPC_CONFIG,
  NPC_LEAVE_DISTANCE,
  PLAZA_AREA,
  ServerMessage,
  findInteractable,
  findSeat,
  npcBlockAt,
  npcGreetingLine,
  npcMayUse,
  npcPlacesInOrder,
  npcSessionId,
  type GreetedPayload,
  type Interactable,
  type NpcAction,
  type NpcDefinition,
  type NpcPlace,
  type Vec2,
  type WorldLayout,
} from "@padova/shared";
import type { AreaWorlds } from "../areas.ts";
import type { GameClock } from "../life/LifeSystem.ts";
import type { PlayerRuntime } from "../runtime.ts";
import type { PlazaState } from "../schema.ts";
import type { SeatBook } from "../seats.ts";
import type { NpcGreetings } from "./npcHooks.ts";

export interface NpcDeps {
  state: PlazaState;
  runtimes: Map<string, PlayerRuntime>;
  seats: SeatBook;
  areas: AreaWorlds;
  clock: GameClock;
  /** The interaction system's entry points NPCs use, like a player's client would. */
  interactions: {
    request(sessionId: string, payload: unknown): void;
    interrupt(sessionId: string): void;
  };
  /** Adds the NPC to the world, standing at `at` on the square. */
  spawn(sessionId: string, npc: NpcDefinition, at: { x: number; z: number; rotation: number }): void;
  /** Takes the NPC out of the world. */
  despawn(sessionId: string): void;
  /** Plans a walk to a point in the NPC's area (the same pathfinding as a player's tap); false if impossible. */
  walkTo(sessionId: string, point: Vec2): boolean;
  send(sessionId: string, type: string, payload: unknown): void;
  now: () => number;
}

interface NpcMind {
  npc: NpcDefinition;
  id: string;
  nextThinkAt: number;
  /** Request key (object:action) → no new request for it before this real time. */
  retryAt: Map<string, number>;
  waveUntil: number;
  replies: { to: string; at: number; line: string }[];
}

/** After repeating a timed action at the same place, wait at least this long before asking again (real ms). */
const REPEAT_MS = 1_000;

export class NpcSystem implements NpcGreetings {
  private readonly minds: NpcMind[];

  constructor(private readonly deps: NpcDeps) {
    const now = deps.now();
    // Staggered, so the NPCs don't all think on the same tick.
    this.minds = NPCS.map((npc, k) => ({
      npc,
      id: npcSessionId(npc.id),
      nextThinkAt: now + (k * NPC_CONFIG.thinkIntervalMs) / NPCS.length,
      retryAt: new Map(),
      waveUntil: 0,
      replies: [],
    }));
  }

  /** NPCs in the world now (for logs and tests). */
  get present(): number {
    return this.minds.filter((m) => this.deps.state.players.has(m.id)).length;
  }

  /** Called every server tick, after movement and interactions. */
  tick(): void {
    const now = this.deps.now();
    for (const mind of this.minds) {
      this.answer(mind, now);
      if (now < mind.nextThinkAt) continue;
      mind.nextThinkAt = now + NPC_CONFIG.thinkIntervalMs;
      if (now < mind.waveUntil) continue;
      this.think(mind, now);
    }
  }

  /** Takes every NPC out of the world (the room is closing). */
  removeAll(): void {
    for (const mind of this.minds) if (this.deps.state.players.has(mind.id)) this.deps.despawn(mind.id);
  }

  // ── Greetings ───────────────────────────────────────────────────────────

  onGreeted(npcId: string, greeterId: string): void {
    const mind = this.minds.find((m) => m.id === npcId);
    const player = this.deps.state.players.get(npcId);
    const runtime = this.deps.runtimes.get(npcId);
    const greeter = this.deps.state.players.get(greeterId);
    if (!mind || !player || !runtime || !greeter) return;
    const minute = this.deps.clock.minute();
    const block = npcBlockAt(mind.npc, minute);
    const now = this.deps.now();
    if (block) mind.replies.push({ to: greeterId, at: now + NPC_CONFIG.replyDelayMs, line: npcGreetingLine(block, minute, greeterId) });
    // Free to turn round (not walking, sitting or busy): wave back.
    if (!runtime.pending && !player.seatId && runtime.character.intent.kind === "idle") {
      const facing = Math.atan2(greeter.x - runtime.character.x, greeter.z - runtime.character.z);
      runtime.character.rotation = facing;
      player.rotation = facing;
      player.activity = "greeting";
      player.targetId = greeterId;
      mind.waveUntil = now + NPC_CONFIG.waveMs;
    }
  }

  private answer(mind: NpcMind, now: number): void {
    if (mind.replies.length > 0) {
      const due = mind.replies.filter((r) => r.at <= now);
      mind.replies = mind.replies.filter((r) => r.at > now);
      for (const reply of due) {
        const payload: GreetedPayload = { fromId: mind.id, fromName: mind.npc.name, action: "greet", line: reply.line };
        this.deps.send(reply.to, ServerMessage.Greeted, payload);
      }
    }
    if (mind.waveUntil > 0 && now >= mind.waveUntil) {
      mind.waveUntil = 0;
      const player = this.deps.state.players.get(mind.id);
      if (player?.activity === "greeting") {
        player.activity = "idle";
        player.targetId = "";
      }
    }
  }

  // ── Deciding ────────────────────────────────────────────────────────────

  private think(mind: NpcMind, now: number): void {
    const minute = this.deps.clock.minute();
    const block = npcBlockAt(mind.npc, minute);
    const present = this.deps.state.players.has(mind.id);
    if (!block) {
      if (present) this.leave(mind);
      return;
    }
    if (!present) {
      const { x, z } = mind.npc.entry;
      // Facing into the square.
      this.deps.spawn(mind.id, mind.npc, { x, z, rotation: Math.atan2(-x, -z) });
      return;
    }
    const runtime = this.deps.runtimes.get(mind.id)!;
    const player = this.deps.state.players.get(mind.id)!;
    const layout = this.deps.areas.of(runtime.area).layout;
    const places = npcPlacesInOrder(mind.npc, block, minute);
    const pending = runtime.pending;

    if (pending) {
      // Going through a door, or doing something the schedule wants: carry on.
      if (pending.action === "enter") return;
      if (pending.targetKind === "object" && places.some((p) => p.area === runtime.area && p.object === pending.targetId && p.action === pending.action)) return;
      this.deps.interactions.interrupt(mind.id); // an earlier block's activity
      return;
    }

    if (player.seatId) {
      const seatedAt = findSeat(layout, player.seatId)?.interactable.id;
      const here = places.find((p) => p.area === runtime.area && p.object === seatedAt);
      if (!here) return this.deps.interactions.interrupt(mind.id);
      // Sitting is the activity; study and sketch sessions are repeated while the block lasts.
      if (here.action !== "sit") this.ask(mind, here, now, REPEAT_MS);
      return;
    }

    const local = places.filter((p) => p.area === runtime.area);
    if (local.length === 0) return this.goTowards(mind, runtime, layout, places[0]!.area, now);
    for (const target of local) {
      const item = findInteractable(layout, target.object);
      if (!item || !this.mayAsk(mind, target, now)) continue;
      if (!npcMayUse(layout, this.deps.seats, item, target.action)) continue;
      this.ask(mind, target, now, NPC_CONFIG.retryMs);
      return;
    }
    // Nothing free that the schedule allows: wait where it is, and try again on the next thought.
  }

  /** The NPC's day is over: out of any room, then to its street, then gone. */
  private leave(mind: NpcMind): void {
    const runtime = this.deps.runtimes.get(mind.id)!;
    const player = this.deps.state.players.get(mind.id)!;
    if (runtime.pending?.action === "enter") return;
    if (runtime.pending || player.seatId) return this.deps.interactions.interrupt(mind.id);
    const layout = this.deps.areas.of(runtime.area).layout;
    if (runtime.area !== PLAZA_AREA) return this.goTowards(mind, runtime, layout, PLAZA_AREA, this.deps.now());
    const { entry } = mind.npc;
    if (runtime.character.intent.kind !== "idle") return;
    if (Math.hypot(runtime.character.x - entry.x, runtime.character.z - entry.z) <= NPC_LEAVE_DISTANCE) {
      this.deps.despawn(mind.id);
      mind.retryAt.clear();
      return;
    }
    this.deps.walkTo(mind.id, entry);
  }

  /** Through the door that leads towards `area` (out to the square first when in another room). */
  private goTowards(mind: NpcMind, runtime: PlayerRuntime, layout: WorldLayout, area: string, now: number): void {
    const door = doorTowards(layout, runtime.area, area);
    if (!door) return;
    const key = `${door.id}:enter`;
    if ((mind.retryAt.get(key) ?? 0) > now || !npcMayUse(layout, this.deps.seats, door, "enter")) return;
    mind.retryAt.set(key, now + NPC_CONFIG.retryMs);
    this.deps.interactions.request(mind.id, { targetKind: "object", targetId: door.id, action: "enter" });
  }

  private mayAsk(mind: NpcMind, target: NpcPlace, now: number): boolean {
    return (mind.retryAt.get(`${target.object}:${target.action}`) ?? 0) <= now;
  }

  private ask(mind: NpcMind, target: NpcPlace, now: number, wait: number): void {
    const key = `${target.object}:${target.action}`;
    if ((mind.retryAt.get(key) ?? 0) > now) return;
    mind.retryAt.set(key, now + wait);
    this.deps.interactions.request(mind.id, { targetKind: "object", targetId: target.object, action: target.action as NpcAction });
  }
}

/** The door in this area that leads to `area`, or out to the square when there is none. */
function doorTowards(layout: WorldLayout, from: string, area: string): Interactable | undefined {
  const doors = layout.interactables.filter((i) => i.kind === "door" && i.door);
  return doors.find((d) => d.door!.to === area) ?? (from !== PLAZA_AREA ? doors.find((d) => d.door!.to === PLAZA_AREA) : undefined);
}
