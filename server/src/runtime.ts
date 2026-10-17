import type { ActionId, MovingCharacter, TargetKind, Vec2 } from "@padova/shared";

/** The one action a player is currently walking to or performing. */
export interface PendingAction {
  id: number;
  action: ActionId;
  targetKind: TargetKind;
  targetId: string;
  /** Seat reserved for this action ("" for actions without a seat). */
  seatId: string;
  /** "approach": walking to the interaction point. "active": doing it. */
  phase: "approach" | "active";
  /** Interaction point the character is walking to. */
  goal: Vec2;
  /** Server time (ms) a timed active action finishes; 0 = untimed. */
  endsAt: number;
  /** Times a greeting re-planned because the other player moved. */
  replans: number;
}

/** Server-only data per player. Never sent to clients. */
export interface PlayerRuntime {
  character: MovingCharacter;
  intentWindowStart: number;
  intentsInWindow: number;
  pending: PendingAction | null;
  /** Last greeting time per target session id (cooldown). */
  lastGreetAt: Map<string, number>;
}
