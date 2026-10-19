// Client ↔ server message contract and the validators the server applies to
// every incoming message. Clients send INTENTS ("walk to here", "walk this
// way"), never positions. The server decides where everyone is.

import { GAME_CONFIG } from "./config.ts";
import { ACTION_IDS, type ActionId, type CancelReason, type InteractionFailure, type TargetKind } from "./interactions.ts";
import type { MoodEventId, MoodLevel, NeedId, SkillId, TraitId } from "./life/config.ts";
import { isValidRequestId, type TransactionView } from "./life/economy.ts";
import type { MoodReason } from "./life/mood.ts";
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
  /** Create a new character and enter the world with it. Payload: NewCharacterInput. */
  CreateCharacter: "createCharacter",
  /**
   * Change a character's appearance. Payload: UpdateAppearancePayload. In the
   * world it always changes the character being played; at the title screen
   * (lobby) `characterId` picks one of this account's characters.
   */
  UpdateAppearance: "updateAppearance",
  /** Enter the world with one of this account's characters. Payload: EnterWorldPayload. */
  EnterWorld: "enterWorld",
  /** Leave the world and go back to the title screen (lobby). No payload. */
  LeaveWorld: "leaveWorld",
  /** Permanently delete one of this account's characters (lobby only). Payload: DeleteCharacterPayload. */
  DeleteCharacter: "deleteCharacter",
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
  /** The receiving player's own needs, mood, skills and money (D-024). Payload: LifePayload. */
  Life: "life",
} as const;

/** Close code used when the same account joins from another window or device. */
export const CLOSE_SIGNED_IN_ELSEWHERE = 4100;
/** Error code returned when a stored guest token is not recognised. */
export const ERROR_INVALID_GUEST_TOKEN = 4401;

/**
 * One of the account's characters as listed at the title screen (sent only
 * to the owner). Life data (needs, money…) is not included: it is sent with
 * `life` once the character is in the world.
 */
export interface CharacterSummary {
  characterId: string;
  displayName: string;
  /** Appearance as canonical JSON (encodeLook), already repaired. */
  look: string;
  traits: TraitId[];
  createdAt: string;
  /** When the character was last saved in the world; null if never. */
  lastPlayedAt: string | null;
  /** Saved by a newer server version: playable, but its look can't be changed here. */
  readOnly: boolean;
  /** Human-readable notices, e.g. retired appearance options that were replaced. */
  notices: string[];
}

export interface ProfilePayload {
  /**
   * "lobby": not in the world yet (title screen); `characters` lists this
   * account's characters (empty for a new visitor). "ready": the character
   * in `profile` is in the world.
   */
  status: "lobby" | "ready";
  /** Lobby only: most recently played first. */
  characters?: CharacterSummary[];
  /** Lobby only: how many characters one profile may hold. */
  maxCharacters?: number;
  profile?: CharacterProfile;
  /** True when the stored profile came from a newer server version and cannot be edited here. */
  readOnly?: boolean;
  /** Human-readable notices, e.g. retired appearance options that were replaced. */
  notices?: string[];
}

export interface EnterWorldPayload {
  characterId: string;
}

export interface DeleteCharacterPayload {
  characterId: string;
  /** The character's name as typed by the player, to prevent accidental deletion. */
  confirmName: string;
}

export interface UpdateAppearancePayload {
  appearance: unknown;
  /** Lobby only: which of this account's characters to change. Ignored in the world. */
  characterId?: string;
}

export interface IdentityPayload {
  /** Secret that proves ownership of this guest account. Store it; it is shown only once. */
  guestToken: string;
}

export interface ProfileErrorPayload {
  action: "createCharacter" | "updateAppearance" | "enterWorld" | "deleteCharacter" | "listCharacters";
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
  /** Menu item for "buy" (e.g. "panino"). The price comes from the server's catalogue. */
  itemId?: string;
  /**
   * Client-chosen id that makes a purchase safe to repeat: the server charges
   * once per (character, requestId). Optional; the server makes one if absent.
   */
  requestId?: string;
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
  /** Menu item, for "buy". */
  itemId?: string;
}

/** One skill as shown to its owner. */
export interface SkillView {
  xp: number;
  level: number;
  /** 0–1 through the current level (1 at max level). */
  progress: number;
}

/**
 * The owner's own life data (D-024). Sent when the player enters the world,
 * whenever a value visibly changes (throttled), and after actions.
 */
export interface LifePayload {
  /** Current game minute (same value as the replicated clock). */
  gameMinute: number;
  /** 0–100, one decimal. */
  needs: Record<NeedId, number>;
  mood: { score: number; level: MoodLevel; reasons: MoodReason[]; events: { id: MoodEventId; expiresAt: number }[] };
  skills: Record<SkillId, SkillView>;
  traits: TraitId[];
  money: { balanceCents: number; recent: TransactionView[] };
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

const ITEM_ID_PATTERN = /^[a-z0-9-]{1,32}$/;

export function parseInteract(payload: unknown): Parsed<InteractPayload> {
  if (!isRecord(payload)) return { ok: false, reason: "invalid_payload" };
  const { targetKind, targetId, action, itemId, requestId } = payload;
  if (targetKind !== "object" && targetKind !== "player") return { ok: false, reason: "invalid_payload" };
  if (typeof targetId !== "string" || targetId.length === 0 || targetId.length > MAX_TARGET_ID_LENGTH) {
    return { ok: false, reason: "invalid_payload" };
  }
  if (typeof action !== "string" || !(ACTION_IDS as readonly string[]).includes(action)) {
    return { ok: false, reason: "invalid_payload" };
  }
  if (itemId !== undefined && (typeof itemId !== "string" || !ITEM_ID_PATTERN.test(itemId))) {
    return { ok: false, reason: "invalid_payload" };
  }
  if (requestId !== undefined && !isValidRequestId(requestId)) return { ok: false, reason: "invalid_payload" };
  const value: InteractPayload = { targetKind, targetId, action: action as ActionId };
  if (itemId !== undefined) value.itemId = itemId;
  if (requestId !== undefined) value.requestId = requestId;
  return { ok: true, value };
}

/**
 * Cleans a requested display name. Returns null when the name is unusable,
 * in which case the server assigns a guest name.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A character id as sent by a client: a UUID string, or null. Ownership is checked separately. */
export function parseCharacterId(raw: unknown): string | null {
  return typeof raw === "string" && UUID.test(raw) ? raw.toLowerCase() : null;
}

export function parseEnterWorld(payload: unknown): EnterWorldPayload | null {
  if (typeof payload !== "object" || payload === null) return null;
  const characterId = parseCharacterId((payload as { characterId?: unknown }).characterId);
  return characterId ? { characterId } : null;
}

export function parseDeleteCharacter(payload: unknown): DeleteCharacterPayload | null {
  if (typeof payload !== "object" || payload === null) return null;
  const record = payload as { characterId?: unknown; confirmName?: unknown };
  const characterId = parseCharacterId(record.characterId);
  if (!characterId || typeof record.confirmName !== "string" || record.confirmName.length > 200) return null;
  return { characterId, confirmName: record.confirmName };
}

/**
 * True when the typed confirmation matches the character's name. Case and
 * surrounding spaces don't matter; everything else must match.
 */
export function confirmNameMatches(typed: string, displayName: string): boolean {
  const normalise = (value: string) => value.normalize("NFKC").replace(/\s+/g, " ").trim().toLocaleLowerCase();
  return normalise(typed) !== "" && normalise(typed) === normalise(displayName);
}

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
