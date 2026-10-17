// Character profile model (M4): what a saved character is, which appearance
// options exist, and how incoming or stored profile data is validated and
// upgraded. Pure functions; the server uses them before every write and after
// every read, the client uses the catalogue to draw its form.

import { sanitizeDisplayName } from "./protocol.ts";

/**
 * Version of the profile data shape. Bump it when the meaning or shape of
 * stored profile data changes, and add an upgrade step to PROFILE_UPGRADES.
 * (Database table changes are handled separately by SQL migrations.)
 */
export const PROFILE_VERSION = 1;

/** Life-stage categories. Only adults may romance; see GAME_DESIGN.md. */
export const AGE_CATEGORIES = ["child", "teen", "adult"] as const;
export type AgeCategory = (typeof AGE_CATEGORIES)[number];

export const isAdult = (category: AgeCategory): boolean => category === "adult";

/**
 * Player characters are university-age adults. Non-adult categories exist in
 * the data model for future NPCs and are refused for player characters.
 */
export const PLAYER_AGE_CATEGORIES: readonly AgeCategory[] = ["adult"];

export interface CatalogueOption {
  id: string;
  label: string;
  /** Display colour (CSS hex) for options that are colours. */
  colour?: string;
}

/**
 * Appearance options. Everything here is drawable by the current PLACEHOLDER
 * avatars (coloured primitives). When real models arrive (M6) the ids stay and
 * map to meshes and textures; retired ids are replaced on load (see
 * sanitizeStoredAppearance).
 */
export const APPEARANCE_CATALOGUE = {
  presets: [
    { id: "female", label: "Female" },
    { id: "male", label: "Male" },
  ],
  skinTones: [
    { id: "skin-1", label: "Porcelain", colour: "#f6e1d3" },
    { id: "skin-2", label: "Light", colour: "#efc9ae" },
    { id: "skin-3", label: "Warm beige", colour: "#dcab84" },
    { id: "skin-4", label: "Olive", colour: "#c39066" },
    { id: "skin-5", label: "Tan", colour: "#a8714a" },
    { id: "skin-6", label: "Brown", colour: "#8a5636" },
    { id: "skin-7", label: "Deep brown", colour: "#6b3f26" },
    { id: "skin-8", label: "Ebony", colour: "#4a2b1b" },
  ],
  hairStyles: [
    { id: "short", label: "Short" },
    { id: "long", label: "Long" },
    { id: "bun", label: "Bun" },
  ],
  hairColours: [
    { id: "black", label: "Black", colour: "#1d1a1c" },
    { id: "dark-brown", label: "Dark brown", colour: "#3b2a22" },
    { id: "chestnut", label: "Chestnut", colour: "#6e4128" },
    { id: "auburn", label: "Auburn", colour: "#8e3b25" },
    { id: "blonde", label: "Blonde", colour: "#d9b26a" },
    { id: "silver", label: "Silver", colour: "#c9c9d1" },
    { id: "rose", label: "Rose", colour: "#e98aa8" },
    { id: "teal", label: "Teal", colour: "#3fa3a0" },
  ],
  eyeColours: [
    { id: "brown", label: "Brown", colour: "#5a3a22" },
    { id: "hazel", label: "Hazel", colour: "#8a6a3a" },
    { id: "green", label: "Green", colour: "#3f7a4a" },
    { id: "blue", label: "Blue", colour: "#3c6fb0" },
    { id: "grey", label: "Grey", colour: "#7d8790" },
    { id: "violet", label: "Violet", colour: "#7a52a8" },
  ],
  outfits: [
    { id: "tee-terracotta", label: "Terracotta tee", colour: "#c4623f" },
    { id: "hoodie-navy", label: "Navy hoodie", colour: "#2f3e63" },
    { id: "shirt-cream", label: "Cream shirt", colour: "#efe4cf" },
    { id: "jacket-olive", label: "Olive jacket", colour: "#5f6b3a" },
    { id: "sweater-mustard", label: "Mustard sweater", colour: "#d4a12e" },
    { id: "dress-plum", label: "Plum dress", colour: "#7d3c63" },
  ],
} as const satisfies Record<string, readonly CatalogueOption[]>;

export interface Appearance {
  preset: string;
  skinTone: string;
  hairStyle: string;
  hairColour: string;
  eyeColour: string;
  outfit: string;
}

/** Which catalogue list each appearance field draws from. */
export const APPEARANCE_FIELDS: Record<keyof Appearance, keyof typeof APPEARANCE_CATALOGUE> = {
  preset: "presets",
  skinTone: "skinTones",
  hairStyle: "hairStyles",
  hairColour: "hairColours",
  eyeColour: "eyeColours",
  outfit: "outfits",
};

export const DEFAULT_APPEARANCE: Readonly<Appearance> = {
  preset: "female",
  skinTone: "skin-3",
  hairStyle: "long",
  hairColour: "dark-brown",
  eyeColour: "brown",
  outfit: "tee-terracotta",
};

/** A character profile as sent to its owner. Never includes credentials. */
export interface CharacterProfile {
  characterId: string;
  displayName: string;
  ageCategory: AgeCategory;
  appearance: Appearance;
  profileVersion: number;
  createdAt: string;
  updatedAt: string;
}

export interface NewCharacterInput {
  displayName: string;
  ageCategory: AgeCategory;
  appearance: Appearance;
}

export type ProfileFailure =
  | "invalid_payload"
  | "invalid_name"
  | "age_category_not_allowed"
  | "invalid_appearance"
  | "already_has_character"
  | "no_character"
  | "profile_newer_version"
  | "rate_limited"
  | "storage_error";

export type ProfileParsed<T> = { ok: true; value: T } | { ok: false; reason: ProfileFailure; field?: string };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export function isCatalogueId(field: keyof Appearance, value: unknown): value is string {
  if (typeof value !== "string") return false;
  const list: readonly CatalogueOption[] = APPEARANCE_CATALOGUE[APPEARANCE_FIELDS[field]];
  return list.some((option) => option.id === value);
}

export function catalogueOption(field: keyof Appearance, id: string): CatalogueOption | undefined {
  const list: readonly CatalogueOption[] = APPEARANCE_CATALOGUE[APPEARANCE_FIELDS[field]];
  return list.find((option) => option.id === id);
}

/** Strict check of an appearance sent by a client: every field present and known. */
export function parseAppearance(payload: unknown): ProfileParsed<Appearance> {
  if (!isRecord(payload)) return { ok: false, reason: "invalid_appearance" };
  const result: Partial<Appearance> = {};
  for (const field of Object.keys(APPEARANCE_FIELDS) as (keyof Appearance)[]) {
    const value = payload[field];
    if (!isCatalogueId(field, value)) return { ok: false, reason: "invalid_appearance", field };
    result[field] = value;
  }
  return { ok: true, value: result as Appearance };
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
  return { ok: true, value: { displayName, ageCategory: ageCategory as AgeCategory, appearance: appearance.value } };
}

/**
 * Makes stored appearance data safe to use: any missing or no-longer-offered
 * option is replaced by the default. `changed` tells the caller to save the
 * repaired version.
 */
export function sanitizeStoredAppearance(raw: Partial<Record<keyof Appearance, unknown>>): {
  appearance: Appearance;
  changed: boolean;
  replaced: (keyof Appearance)[];
} {
  const appearance = { ...DEFAULT_APPEARANCE };
  const replaced: (keyof Appearance)[] = [];
  for (const field of Object.keys(APPEARANCE_FIELDS) as (keyof Appearance)[]) {
    const value = raw[field];
    if (isCatalogueId(field, value)) appearance[field] = value;
    else replaced.push(field);
  }
  return { appearance, changed: replaced.length > 0, replaced };
}

/** Profile data as read from storage, before upgrading. */
export interface StoredProfileData {
  profileVersion: number;
  displayName: string;
  ageCategory: string;
  appearance: Partial<Record<keyof Appearance, unknown>>;
}

/** One upgrade step: turns data of version N into version N + 1. */
export type ProfileUpgrade = (data: StoredProfileData) => StoredProfileData;

/**
 * Upgrade steps keyed by the version they upgrade FROM. Empty today: version 1
 * is the first stored version. Example for a future change:
 *   1: (data) => ({ ...data, profileVersion: 2, appearance: { ...data.appearance, accessory: "none" } })
 */
export const PROFILE_UPGRADES: Readonly<Record<number, ProfileUpgrade>> = {};

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
