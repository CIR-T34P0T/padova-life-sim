// Client ↔ server message contract and the validators the server applies to
// every incoming message. Clients send INTENTS ("walk to here", "walk this
// way"), never positions. The server decides where everyone is.

import { GAME_CONFIG } from "./config.ts";
import { ACTION_IDS, type ActionId, type CancelReason, type InteractionFailure, type TargetKind } from "./interactions.ts";
import type { CharacterProfile, ProfileFailure } from "./profile.ts";

export const ClientMessage = {
  /** Walk to a point using pathfinding. Payload: MoveToPayload. */
  MoveTo: "moveTo",
  /** Walk in a direction (keyboard / joystick). Payload: MoveDirectionPayload. */
  MoveDirection: "moveDir",
  /** Stop walking. No payload. */
  Stop: "stop",
  /** Request a contextual action on an object or player. Payload: InteractPayload. */
  Interact: "interact",
  /** Cancel the current action, if any. No payload. */
  CancelAction: "cancelAction",
  /** Create this session's character (first visit). Payload: NewCharacterInput. */
  CreateCharacter: "createCharacter",
  /** Change your own character's appearance. Payload: { appearance }. */
  UpdateAppearance: "updateAppearance",
} as const;

export const ServerMessage = {
  /** A movement intent was refused. Payload: RejectedPayload. */
  Rejected: "rejected",
  /** Progress of the receiving player's own action. Payload: ActionUpdatePayload. */
  ActionUpdate: "action",
  /** Someone greeted the receiving player. Payload: GreetedPayload. */
  Greeted: "greeted",
  /** Profile state for this session. Payload: ProfilePayload. */
  Profile: "profile",
  /** A new guest identity was created; the client stores the token. Payload: IdentityPayload. */
  Identity: "identity",
  /** A profile request was refused. Payload: ProfileErrorPayload. */
  ProfileError: "profileError",
} as const;

/** Close code used when the same account joins from another window or device. */
export const CLOSE_SIGNED_IN_ELSEWHERE = 4100;
/** Error code returned when a stored guest token is not recognised. */
export const ERROR_INVALID_GUEST_TOKEN = 4401;

export interface ProfilePayload {
  /** "needs_character": show the create form. "ready": the character is in the world. */
  status: "needs_character" | "ready";
  profile?: CharacterProfile;
  /** True when the stored profile came from a newer server version and cannot be edited here. */
  readOnly?: boolean;
  /** Human-readable notices, e.g. retired appearance options that were replaced. */
  notices?: string[];
}

export interface IdentityPayload {
  /** Secret that proves ownership of this guest account. Store it; it is shown only once. */
  guestToken: string;
}

export interface ProfileErrorPayload {
  action: "createCharacter" | "updateAppearance";
  reason: ProfileFailure;
  field?: string;
}

export interface JoinOptionsWithIdentity {
  /** Stored guest token, if this browser has one. Sent in the matchmaking request body, never in a URL. */
  guestToken?: string;
}

export interface InteractPayload {
  targetKind: TargetKind;
  targetId: string;
  action: ActionId;
}

/**
 * Lifecycle of one action, sent only to the player who requested it:
 * queued (walking to it) → started (doing it; `durationMs` > 0 for timed
 * actions) → completed. Or `rejected` (never started), `failed` (could not
 * finish) or `cancelled` (stopped early). The server decides every transition.
 */
export type ActionStatus = "queued" | "started" | "completed" | "rejected" | "failed" | "cancelled";

export interface ActionUpdatePayload {
  /** Server-assigned id; 0 when a request was rejected before getting one. */
  actionId: number;
  status: ActionStatus;
  action: ActionId;
  targetKind: TargetKind;
  targetId: string;
  /** Set for rejected / failed / cancelled. */
  reason?: InteractionFailure | CancelReason;
  /** Set for started timed actions. */
  durationMs?: number;
}

export interface GreetedPayload {
  fromId: string;
  fromName: string;
}

export interface MoveToPayload {
  x: number;
  z: number;
}

export interface MoveDirectionPayload {
  dx: number;
  dz: number;
}

export interface RejectedPayload {
  action: string;
  reason: string;
}

/** @deprecated Names come from the saved character profile since M4. */
export interface JoinOptions {
  name?: string;
}

export type Parsed<T> = { ok: true; value: T } | { ok: false; reason: string };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isFiniteNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

export function parseMoveTo(payload: unknown): Parsed<MoveToPayload> {
  if (!isRecord(payload) || !isFiniteNumber(payload.x) || !isFiniteNumber(payload.z)) {
    return { ok: false, reason: "invalid_payload" };
  }
  return { ok: true, value: { x: payload.x, z: payload.z } };
}

/** Accepts a direction and clamps its length to 1 (no speed hacks). */
export function parseMoveDirection(payload: unknown): Parsed<MoveDirectionPayload> {
  if (!isRecord(payload) || !isFiniteNumber(payload.dx) || !isFiniteNumber(payload.dz)) {
    return { ok: false, reason: "invalid_payload" };
  }
  const length = Math.hypot(payload.dx, payload.dz);
  if (length < 1e-3) return { ok: true, value: { dx: 0, dz: 0 } };
  const scale = length > 1 ? 1 / length : 1;
  return { ok: true, value: { dx: payload.dx * scale, dz: payload.dz * scale } };
}

const MAX_TARGET_ID_LENGTH = 64;

export function parseInteract(payload: unknown): Parsed<InteractPayload> {
  if (!isRecord(payload)) return { ok: false, reason: "invalid_payload" };
  const { targetKind, targetId, action } = payload;
  if (targetKind !== "object" && targetKind !== "player") return { ok: false, reason: "invalid_payload" };
  if (typeof targetId !== "string" || targetId.length === 0 || targetId.length > MAX_TARGET_ID_LENGTH) {
    return { ok: false, reason: "invalid_payload" };
  }
  if (typeof action !== "string" || !(ACTION_IDS as readonly string[]).includes(action)) {
    return { ok: false, reason: "invalid_payload" };
  }
  return { ok: true, value: { targetKind, targetId, action: action as ActionId } };
}

/**
 * Cleans a requested display name. Returns null when the name is unusable,
 * in which case the server assigns a guest name.
 */
export function sanitizeDisplayName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const cleaned = raw
    .normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f<>]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, GAME_CONFIG.nameMaxLength);
  return cleaned.length >= GAME_CONFIG.nameMinLength ? cleaned : null;
}
