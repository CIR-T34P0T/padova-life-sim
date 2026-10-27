// Client ↔ server message contract and the validators the server applies to
// every incoming message. Clients send INTENTS ("walk to here", "walk this
// way"), never positions. The server decides where everyone is.

import { GAME_CONFIG, SAFETY_CONFIG, type ReportReason } from "./config.ts";
import { ACTION_IDS, type ActionId, type CancelReason, type InteractionFailure, type TargetKind } from "./interactions.ts";
import type { FurnitureId, JobId, MoodEventId, MoodLevel, NeedId, RoomTypeId, SkillId, TraitId } from "./life/config.ts";
import { isFurnitureId } from "./life/housing.ts";
import { isValidRequestId, type TransactionView } from "./life/economy.ts";
import type { MoodReason } from "./life/mood.ts";
import type { CourseState } from "./life/university.ts";
import type { RelationshipView, StoryEntry } from "./life/relationships.ts";
import type { RelationshipLevelId, SharedMomentKind } from "./life/config.ts";
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
  /** Deletes this browser's whole guest profile and everything in it (M12). Title screen only. Payload: DeleteProfilePayload. */
  DeleteProfile: "deleteProfile",
  /** Quit the character's job (in the world only; a shift in progress ends unpaid). No payload. */
  QuitJob: "quitJob",
  /** Ask for another player's card (M9): your relationship with them. Payload: TargetPayload. */
  ViewProfile: "viewProfile",
  /** Block another player's account (M9). Payload: TargetPayload. */
  Block: "block",
  /** Lift one of your blocks (M9). Payload: UnblockPayload. */
  Unblock: "unblock",
  /** Report another player (M9); also blocks them. Payload: ReportPayload. */
  Report: "report",
  /** Buy a piece of furniture and place it in a spot of your home (M10). Payload: FurnishPayload. */
  Furnish: "furnish",
  /** Place a piece of furniture from your storage in a spot of your home (M10). Payload: PlacePayload. */
  Place: "place",
  /** Put a placed piece of furniture back into storage (M10). Payload: PutAwayPayload. */
  PutAway: "putAway",
} as const;

export const ServerMessage = {
  /** Your guest profile was deleted (M12): forget the stored guest token. Payload: {}. */
  ProfileDeleted: "profileDeleted",
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
  /** Another player's card for the receiving player (M9). Payload: ProfileViewPayload. */
  ProfileView: "profileView",
  /** The receiving player's blocks (M9). Payload: SafetyPayload. */
  Safety: "safety",
  /** The receiving character's story log (M9). Payload: StoryPayload. */
  Story: "story",
  /** A relationship of the receiving character changed (M9). Payload: RelationshipPayload. */
  Relationship: "relationship",
  /** The answer to a block, unblock or report (M9). Payload: SocialResultPayload. */
  SocialResult: "socialResult",
  /** The receiving character's home, rent and furniture (M10). Payload: HousingPayload. */
  Housing: "housing",
  /** The answer to furnish, place or put away (M10). Payload: FurnishResultPayload. */
  FurnishResult: "furnishResult",
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
  action: "createCharacter" | "updateAppearance" | "enterWorld" | "deleteCharacter" | "listCharacters" | "deleteProfile";
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
  /** Menu item for "buy" (e.g. "panino"), or room type for "rent" (M10). Prices come from the server's catalogue. */
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
  /**
   * The character's job (M7), or null without one. `shiftsToday` counts
   * completed shifts on the current game day. Grade, wage and opening hours
   * follow from the shared rules (shared/src/life/work.ts).
   */
  job: { jobId: JobId; shiftsToday: number } | null;
  /** The character's course, attendance and results (M8), or null when not enrolled. */
  course: CourseState | null;
  /** Game minutes per real minute, for "in about N real minutes" hints (D-021). */
  timeScale: number;
}

export interface GreetedPayload {
  fromId: string;
  fromName: string;
  /** "greet" (a wave) or "chat" (a chat began, M9). Absent means "greet". */
  action?: "greet" | "chat";
  /** An NPC answering your greeting (M11): what it says. */
  line?: string;
}

/** A request about another player in the same area, by their session id. */
export interface TargetPayload {
  targetId: string;
}

export interface UnblockPayload {
  /** Id of one of your own blocks (from SafetyPayload); ownership is checked by account. */
  blockId: string;
}

export interface ReportPayload {
  targetId: string;
  reason: ReportReason;
  /** Optional, at most SAFETY_CONFIG.noteMaxLength characters. */
  note?: string;
}

export interface ProfileViewPayload {
  targetId: string;
  /** Your relationship with them, or null before any shared moment. */
  relationship: RelationshipView | null;
  /** True when you have blocked their account. */
  blockedByYou: boolean;
}

export interface BlockedView {
  blockId: string;
  /** The character's name when blocked; the block covers their whole account. */
  name: string;
  blockedAt: string;
}

export interface SafetyPayload {
  blocked: BlockedView[];
  /** Players in the world whose account you blocked, with the block's id (for menus and Unblock). */
  blockedPlayers: { playerId: string; blockId: string }[];
}

export interface StoryPayload {
  /** Newest first. */
  events: StoryEntry[];
}

export interface RelationshipPayload {
  /** The other player's session id, and their name. */
  otherId: string;
  otherName: string;
  score: number;
  level: RelationshipLevelId;
  label: string;
  /** The moment that changed it. */
  kind: SharedMomentKind;
  /** True when this moment raised the level. */
  levelUp: boolean;
}

export interface SocialResultPayload {
  action: "block" | "unblock" | "report";
  status: "ok" | "already_reported" | "rate_limited" | "not_found" | "failed";
  /** The other player's name, when known. */
  name?: string;
}

/** A piece of furniture the character owns (M10). */
export interface FurnitureView {
  furnitureId: string;
  itemId: FurnitureId;
}

export interface PlacedFurnitureView extends FurnitureView {
  /** The spot in the home (shared/src/homes.ts HOME_TEMPLATES). */
  slot: string;
}

/** The character's current home (M10), private to its tenant. */
export interface HomeView {
  /** The home's area ("home/<id>"); a client builds its room with homeArea(). */
  areaId: string;
  roomType: RoomTypeId;
  /** Weekly rent agreed when the room was rented. */
  rentCents: number;
  /** Last rent week paid (rentWeekOf). */
  paidWeek: number;
  /** This week's rent couldn't be paid yet: it is retried when money arrives, until the deadline. */
  overdue: { sinceGameMinute: number; deadlineGameMinute: number } | null;
  placements: PlacedFurnitureView[];
  cosiness: number;
}

/** Something about rent the player should be told (a toast), sent with the housing update it caused. */
export type HousingNotice =
  | { kind: "rent_paid"; rentCents: number }
  | { kind: "rent_overdue"; rentCents: number; deadlineGameMinute: number }
  | { kind: "moved_cheaper"; fromRoomType: RoomTypeId; roomType: RoomTypeId; rentCents: number }
  | { kind: "moved_out_unpaid"; fromRoomType: RoomTypeId };

export interface HousingPayload {
  home: HomeView | null;
  /** Furniture not placed in a home. */
  storage: FurnitureView[];
  notice?: HousingNotice;
}

export interface FurnishPayload {
  slot: string;
  itemId: FurnitureId;
  /** Makes the purchase safe to repeat: charged once per (character, requestId). */
  requestId: string;
}

export interface PlacePayload {
  slot: string;
  furnitureId: string;
}

export interface PutAwayPayload {
  furnitureId: string;
}

export type FurnishStatus =
  | "ok"
  | "duplicate"
  | "not_home"
  | "unknown_item"
  | "not_for_sale"
  | "unknown_slot"
  | "wrong_slot"
  | "slot_taken"
  | "insufficient_funds"
  | "storage_full"
  | "not_found"
  | "busy"
  | "failed";

export interface FurnishResultPayload {
  action: "furnish" | "place" | "putAway";
  status: FurnishStatus;
  itemId?: FurnitureId;
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

/** A request about another player: a session id like the ones in the replicated state. */
export function parseTarget(payload: unknown): TargetPayload | null {
  if (!isRecord(payload)) return null;
  const { targetId } = payload;
  if (typeof targetId !== "string" || targetId.length === 0 || targetId.length > MAX_TARGET_ID_LENGTH) return null;
  return { targetId };
}

export function parseUnblock(payload: unknown): UnblockPayload | null {
  if (!isRecord(payload)) return null;
  const blockId = parseCharacterId(payload.blockId);
  return blockId ? { blockId } : null;
}

const SLOT_PATTERN = /^[a-z0-9-]{1,32}$/;

export function parseFurnish(payload: unknown): FurnishPayload | null {
  if (!isRecord(payload)) return null;
  const { slot, itemId, requestId } = payload;
  if (typeof slot !== "string" || !SLOT_PATTERN.test(slot) || !isFurnitureId(itemId) || !isValidRequestId(requestId)) return null;
  return { slot, itemId, requestId };
}

export function parsePlace(payload: unknown): PlacePayload | null {
  if (!isRecord(payload)) return null;
  const { slot } = payload;
  const furnitureId = parseCharacterId(payload.furnitureId);
  if (typeof slot !== "string" || !SLOT_PATTERN.test(slot) || !furnitureId) return null;
  return { slot, furnitureId };
}

export function parsePutAway(payload: unknown): PutAwayPayload | null {
  if (!isRecord(payload)) return null;
  const furnitureId = parseCharacterId(payload.furnitureId);
  return furnitureId ? { furnitureId } : null;
}

const REPORT_REASONS: readonly string[] = SAFETY_CONFIG.reportReasons.map((r) => r.id);

/** A report: a known reason and an optional short note (control characters removed, trimmed). */
export function parseReport(payload: unknown): ReportPayload | null {
  const target = parseTarget(payload);
  if (!target || !isRecord(payload)) return null;
  const { reason, note } = payload;
  if (typeof reason !== "string" || !REPORT_REASONS.includes(reason)) return null;
  if (note !== undefined && typeof note !== "string") return null;
  // eslint-disable-next-line no-control-regex
  const cleaned = (note ?? "").replace(/[\u0000-\u001f\u007f]+/g, " ").trim();
  if (cleaned.length > SAFETY_CONFIG.noteMaxLength) return null;
  const value: ReportPayload = { targetId: target.targetId, reason: reason as ReportReason };
  if (cleaned) value.note = cleaned;
  return value;
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

/** The word typed to confirm deleting a whole profile (M12). */
export const PROFILE_DELETE_WORD = "delete";

export interface DeleteProfilePayload {
  /** What the player typed; must be PROFILE_DELETE_WORD (case and surrounding spaces don't matter). */
  confirm: string;
}

/** True when the typed confirmation is the deletion word. */
export const confirmsProfileDeletion = (typed: string): boolean => typed.trim().toLowerCase() === PROFILE_DELETE_WORD;

export function parseDeleteProfile(payload: unknown): DeleteProfilePayload | null {
  if (typeof payload !== "object" || payload === null) return null;
  const confirm = (payload as { confirm?: unknown }).confirm;
  return typeof confirm === "string" && confirm.length <= 40 ? { confirm } : null;
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
