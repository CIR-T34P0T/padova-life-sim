// Character profile model (M4): what a saved character is and how incoming
// or stored profile data is validated and upgraded. Pure functions; the
// server uses them before every write and after every read. The appearance
// itself (catalogue, config, validation) lives in ./appearance/ (M6).

import {
  parseAppearanceConfig,
  upgradeLegacyAppearance,
  type AppearanceConfig,
  type LegacyAppearance,
} from "./appearance/index.ts";
import type { TraitId } from "./life/config.ts";
import { parseTraits } from "./life/traits.ts";
import { sanitizeDisplayName } from "./protocol.ts";

/**
 * Version of the profile data shape. Bump it when the meaning or shape of
 * stored profile data changes, and add an upgrade step to PROFILE_UPGRADES.
 * (Database table changes are handled separately by SQL migrations.)
 */
export const PROFILE_VERSION = 3;

/** Life-stage categories. Only adults may romance; see GAME_DESIGN.md. */
export const AGE_CATEGORIES = ["child", "teen", "adult"] as const;
export type AgeCategory = (typeof AGE_CATEGORIES)[number];

export const isAdult = (category: AgeCategory): boolean => category === "adult";

/**
 * Player characters are university-age adults. Non-adult categories exist in
 * the data model for future NPCs and are refused for player characters.
 */
export const PLAYER_AGE_CATEGORIES: readonly AgeCategory[] = ["adult"];

/** A character profile as sent to its owner. Never includes credentials. */
export interface CharacterProfile {
  characterId: string;
  displayName: string;
  ageCategory: AgeCategory;
  appearance: AppearanceConfig;
  /** Personality traits chosen at creation (since profile version 2). */
  traits: TraitId[];
  profileVersion: number;
  createdAt: string;
  updatedAt: string;
}

export interface NewCharacterInput {
  displayName: string;
  ageCategory: AgeCategory;
  appearance: AppearanceConfig;
  /** Up to MAX_TRAITS distinct traits; optional (none if omitted). */
  traits: TraitId[];
}

export type ProfileFailure =
  | "invalid_payload"
  | "invalid_name"
  | "age_category_not_allowed"
  | "invalid_appearance"
  | "invalid_traits"
  | "already_has_character"
  | "no_character"
  | "profile_newer_version"
  | "rate_limited"
  | "storage_error";

export type ProfileParsed<T> = { ok: true; value: T } | { ok: false; reason: ProfileFailure; field?: string };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Strict check of an appearance sent by a client (see parseAppearanceConfig). */
export function parseAppearance(payload: unknown): ProfileParsed<AppearanceConfig> {
  const parsed = parseAppearanceConfig(payload);
  return parsed.ok ? parsed : { ok: false, reason: "invalid_appearance", field: parsed.field };
}

/** Validates a create-character request. Unknown extra fields are ignored. */
export function parseNewCharacter(payload: unknown): ProfileParsed<NewCharacterInput> {
  if (!isRecord(payload)) return { ok: false, reason: "invalid_payload" };
  const displayName = sanitizeDisplayName(payload.displayName);
  if (!displayName) return { ok: false, reason: "invalid_name", field: "displayName" };
  const ageCategory = payload.ageCategory;
  if (typeof ageCategory !== "string" || !(AGE_CATEGORIES as readonly string[]).includes(ageCategory)) {
    return { ok: false, reason: "invalid_payload", field: "ageCategory" };
  }
  if (!PLAYER_AGE_CATEGORIES.includes(ageCategory as AgeCategory)) {
    return { ok: false, reason: "age_category_not_allowed", field: "ageCategory" };
  }
  const appearance = parseAppearance(payload.appearance);
  if (!appearance.ok) return appearance;
  const traits = parseTraits(payload.traits);
  if (!traits.ok) return { ok: false, reason: "invalid_traits", field: "traits" };
  return {
    ok: true,
    value: { displayName, ageCategory: ageCategory as AgeCategory, appearance: appearance.value, traits: traits.value },
  };
}

/** Profile data as read from storage, before upgrading. */
export interface StoredProfileData {
  profileVersion: number;
  displayName: string;
  ageCategory: string;
  /**
   * Raw stored appearance: the flat M4 fields (LegacyAppearance) for
   * versions 1 and 2, an appearance config from version 3. Clean it with
   * sanitizeAppearance after upgrading.
   */
  appearance: unknown;
  /** Raw stored trait ids (since version 2); clean with sanitizeStoredTraits. */
  traits?: unknown[];
}

/** One upgrade step: turns data of version N into version N + 1. */
export type ProfileUpgrade = (data: StoredProfileData) => StoredProfileData;

/**
 * Upgrade steps keyed by the version they upgrade FROM.
 *   1 → 2 (M5): personality traits were added; older characters have none.
 *   2 → 3 (M6): the six flat appearance fields became an appearance config.
 */
export const PROFILE_UPGRADES: Readonly<Record<number, ProfileUpgrade>> = {
  1: (data) => ({ ...data, profileVersion: 2, traits: [] }),
  2: (data) => ({
    ...data,
    profileVersion: 3,
    appearance: upgradeLegacyAppearance(typeof data.appearance === "object" && data.appearance !== null ? (data.appearance as LegacyAppearance) : {}),
  }),
};

export type UpgradeResult =
  | { ok: true; data: StoredProfileData; upgraded: boolean }
  | { ok: false; reason: "newer_version" | "missing_upgrade" | "unsupported_version" };

/**
 * Brings stored profile data up to `targetVersion`, one step at a time.
 * Data from a NEWER version (written by a newer server) is refused rather
 * than guessed at, so it is never overwritten with a lossy copy.
 */
export function upgradeProfileData(
  data: StoredProfileData,
  upgrades: Readonly<Record<number, ProfileUpgrade>> = PROFILE_UPGRADES,
  targetVersion: number = PROFILE_VERSION,
): UpgradeResult {
  if (!Number.isInteger(data.profileVersion) || data.profileVersion < 1) return { ok: false, reason: "unsupported_version" };
  if (data.profileVersion > targetVersion) return { ok: false, reason: "newer_version" };
  let current = data;
  while (current.profileVersion < targetVersion) {
    const step = upgrades[current.profileVersion];
    if (!step) return { ok: false, reason: "missing_upgrade" };
    const next = step(current);
    if (next.profileVersion !== current.profileVersion + 1) return { ok: false, reason: "missing_upgrade" };
    current = next;
  }
  return { ok: true, data: current, upgraded: current.profileVersion !== data.profileVersion };
}
