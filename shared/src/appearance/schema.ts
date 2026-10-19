// The appearance config (M6, D-028): a versioned description of how a
// character looks. Option fields hold catalogue ids; slider fields hold
// values from 0 to 1 (0.5 = middle), stored with two decimals.
//
// Validation has two modes:
//   parseAppearanceConfig  strict, for anything a player sends: every field must
//                          be present and valid, or the request is refused with
//                          the field's path ("hair.style").
//   sanitizeAppearance     lenient, for stored or replicated data: invalid or
//                          missing fields are replaced by defaults and listed.
//
// What the sliders mean for the renderer (so authored models can match):
//   body.height     0 → 1.56 m, 1 → 1.88 m
//   body.shoulders  shoulder width ×0.88 … ×1.12
//   body.torso      torso length ×0.92 … ×1.08
//   body.legs       leg length ×0.92 … ×1.08
//   body.arms       arm length ×0.92 … ×1.08
//   skin.tone       very fair → deep brown (see colour.ts SKIN_TONE_STOPS)
//   skin.blush      cheek blush strength 0 … 1
//   face.*          cheekbones, jaw width, chin length, forehead height,
//                   eye size, eye spacing, brow height, nose width,
//                   nose length, lip fullness: 0.5 = the face shape's default

import {
  BEAUTY_MARKS,
  BODY_FRAMES,
  BOTTOMS,
  BROW_SHAPES,
  BUILDS,
  CLOTHING_COLOURS,
  EYE_COLOURS,
  EYE_SHAPES,
  FACE_SHAPES,
  FACIAL_HAIR,
  FRECKLES,
  FULL_OUTFITS,
  GLASSES,
  HAIRLINES,
  HAIR_COLOURS,
  HAIR_STYLES,
  HEADWEAR,
  LIP_SHAPES,
  NOSE_SHAPES,
  OUTERWEAR,
  PATTERNS,
  SHOES,
  TOPS,
  UNDERTONES,
  type BeautyMark,
  type BodyFrame,
  type Bottom,
  type BrowShape,
  type Build,
  type ClothingColour,
  type EyeColour,
  type EyeShape,
  type FaceShape,
  type FacialHair,
  type Freckles,
  type FullOutfit,
  type Glasses,
  type HairColour,
  type HairStyle,
  type Hairline,
  type Headwear,
  type LipShape,
  type NoseShape,
  type Option,
  type Outerwear,
  type Pattern,
  type Shoes,
  type Top,
  type Undertone,
} from "./catalogue.ts";

/** Version of the appearance config shape. Bump with an upgrade step when fields change meaning. */
export const APPEARANCE_SCHEMA_VERSION = 1;

export interface AppearanceConfig {
  v: number;
  body: {
    frame: BodyFrame;
    build: Build;
    height: number;
    shoulders: number;
    torso: number;
    legs: number;
    arms: number;
  };
  skin: {
    tone: number;
    undertone: Undertone;
    freckles: Freckles;
    mark: BeautyMark;
    blush: number;
  };
  face: {
    shape: FaceShape;
    cheekbones: number;
    jaw: number;
    chin: number;
    forehead: number;
    eyeShape: EyeShape;
    eyeSize: number;
    eyeSpacing: number;
    eyeColour: EyeColour;
    browShape: BrowShape;
    browHeight: number;
    noseShape: NoseShape;
    noseWidth: number;
    noseLength: number;
    lipShape: LipShape;
    lipFullness: number;
  };
  hair: {
    style: HairStyle;
    colour: HairColour;
    hairline: Hairline;
    facial: FacialHair;
  };
  outfit: {
    top: Top;
    topColour: ClothingColour;
    pattern: Pattern;
    bottom: Bottom;
    bottomColour: ClothingColour;
    full: FullOutfit;
    shoes: Shoes;
    shoesColour: ClothingColour;
    outer: Outerwear;
    outerColour: ClothingColour;
    glasses: Glasses;
    headwear: Headwear;
    headwearColour: ClothingColour;
  };
}

export type AppearanceSection = Exclude<keyof AppearanceConfig, "v">;
export const APPEARANCE_SECTIONS: readonly AppearanceSection[] = ["body", "skin", "face", "hair", "outfit"];

type FieldSpec = { kind: "range" } | { kind: "enum"; options: readonly Option[] };
const range: FieldSpec = { kind: "range" };
const oneOf = (options: readonly Option[]): FieldSpec => ({ kind: "enum", options });

/** Every field of the config and what it may hold. The single source for validation. */
export const APPEARANCE_SPEC: { [S in AppearanceSection]: { [F in keyof AppearanceConfig[S]]: FieldSpec } } = {
  body: {
    frame: oneOf(BODY_FRAMES),
    build: oneOf(BUILDS),
    height: range,
    shoulders: range,
    torso: range,
    legs: range,
    arms: range,
  },
  skin: {
    tone: range,
    undertone: oneOf(UNDERTONES),
    freckles: oneOf(FRECKLES),
    mark: oneOf(BEAUTY_MARKS),
    blush: range,
  },
  face: {
    shape: oneOf(FACE_SHAPES),
    cheekbones: range,
    jaw: range,
    chin: range,
    forehead: range,
    eyeShape: oneOf(EYE_SHAPES),
    eyeSize: range,
    eyeSpacing: range,
    eyeColour: oneOf(EYE_COLOURS),
    browShape: oneOf(BROW_SHAPES),
    browHeight: range,
    noseShape: oneOf(NOSE_SHAPES),
    noseWidth: range,
    noseLength: range,
    lipShape: oneOf(LIP_SHAPES),
    lipFullness: range,
  },
  hair: {
    style: oneOf(HAIR_STYLES),
    colour: oneOf(HAIR_COLOURS),
    hairline: oneOf(HAIRLINES),
    facial: oneOf(FACIAL_HAIR),
  },
  outfit: {
    top: oneOf(TOPS),
    topColour: oneOf(CLOTHING_COLOURS),
    pattern: oneOf(PATTERNS),
    bottom: oneOf(BOTTOMS),
    bottomColour: oneOf(CLOTHING_COLOURS),
    full: oneOf(FULL_OUTFITS),
    shoes: oneOf(SHOES),
    shoesColour: oneOf(CLOTHING_COLOURS),
    outer: oneOf(OUTERWEAR),
    outerColour: oneOf(CLOTHING_COLOURS),
    glasses: oneOf(GLASSES),
    headwear: oneOf(HEADWEAR),
    headwearColour: oneOf(CLOTHING_COLOURS),
  },
};

export const DEFAULT_APPEARANCE: Readonly<AppearanceConfig> = Object.freeze({
  v: APPEARANCE_SCHEMA_VERSION,
  body: { frame: "feminine", build: "average", height: 0.45, shoulders: 0.5, torso: 0.5, legs: 0.5, arms: 0.5 },
  skin: { tone: 0.4, undertone: "neutral", freckles: "none", mark: "none", blush: 0.2 },
  face: {
    shape: "oval",
    cheekbones: 0.5,
    jaw: 0.5,
    chin: 0.5,
    forehead: 0.5,
    eyeShape: "almond",
    eyeSize: 0.5,
    eyeSpacing: 0.5,
    eyeColour: "brown",
    browShape: "soft-arch",
    browHeight: 0.5,
    noseShape: "button",
    noseWidth: 0.5,
    noseLength: 0.5,
    lipShape: "full",
    lipFullness: 0.5,
  },
  hair: { style: "long-straight", colour: "dark-brown", hairline: "rounded", facial: "none" },
  outfit: {
    top: "tee",
    topColour: "terracotta",
    pattern: "plain",
    bottom: "jeans",
    bottomColour: "denim",
    full: "none",
    shoes: "trainers",
    shoesColour: "white",
    outer: "none",
    outerColour: "denim",
    glasses: "none",
    headwear: "none",
    headwearColour: "mustard",
  },
}) as AppearanceConfig;

/** A deep copy that can be edited freely. */
export function cloneAppearance(config: AppearanceConfig): AppearanceConfig {
  return {
    v: config.v,
    body: { ...config.body },
    skin: { ...config.skin },
    face: { ...config.face },
    hair: { ...config.hair },
    outfit: { ...config.outfit },
  };
}

/** Slider values are stored with two decimals. */
export const roundSlider = (value: number) => Math.round(value * 100) / 100;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function fieldValid(spec: FieldSpec, value: unknown): boolean {
  if (spec.kind === "range") return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
  return typeof value === "string" && spec.options.some((option) => option.id === value);
}

export type AppearanceParsed = { ok: true; value: AppearanceConfig } | { ok: false; field: string };

/**
 * Strict check of an appearance sent by a player. The schema version must be
 * the current one, every section and field must be present and valid.
 * Unknown extra fields are ignored. Slider values are rounded to 2 decimals.
 */
export function parseAppearanceConfig(payload: unknown): AppearanceParsed {
  if (!isRecord(payload)) return { ok: false, field: "appearance" };
  if (payload.v !== APPEARANCE_SCHEMA_VERSION) return { ok: false, field: "v" };
  const result = cloneAppearance(DEFAULT_APPEARANCE) as unknown as Record<AppearanceSection, Record<string, unknown>>;
  for (const section of APPEARANCE_SECTIONS) {
    const raw = payload[section];
    if (!isRecord(raw)) return { ok: false, field: section };
    for (const [field, spec] of Object.entries(APPEARANCE_SPEC[section]) as [string, FieldSpec][]) {
      const value = raw[field];
      if (!fieldValid(spec, value)) return { ok: false, field: `${section}.${field}` };
      result[section][field] = spec.kind === "range" ? roundSlider(value as number) : value;
    }
  }
  return { ok: true, value: result as unknown as AppearanceConfig };
}

export interface SanitizedAppearance {
  appearance: AppearanceConfig;
  /** Paths of fields that were missing or invalid and got the default. */
  replaced: string[];
  /** True when the stored copy should be rewritten. */
  changed: boolean;
}

/**
 * Makes stored or replicated appearance data safe to use. Out-of-range
 * sliders are clamped; anything else invalid or missing gets the default.
 * Data with a newer schema version is sanitised the same way (best effort);
 * callers that must not overwrite newer data check the version first.
 */
export function sanitizeAppearance(raw: unknown): SanitizedAppearance {
  const appearance = cloneAppearance(DEFAULT_APPEARANCE) as unknown as Record<AppearanceSection, Record<string, unknown>>;
  const replaced: string[] = [];
  let changed = false;
  const input = isRecord(raw) ? raw : {};
  if (!isRecord(raw)) replaced.push("appearance");
  if (input.v !== APPEARANCE_SCHEMA_VERSION) changed = true;
  for (const section of APPEARANCE_SECTIONS) {
    const rawSection = isRecord(input[section]) ? (input[section] as Record<string, unknown>) : {};
    for (const [field, spec] of Object.entries(APPEARANCE_SPEC[section]) as [string, FieldSpec][]) {
      const value = rawSection[field];
      if (spec.kind === "range" && typeof value === "number" && Number.isFinite(value)) {
        const clamped = roundSlider(Math.min(1, Math.max(0, value)));
        if (clamped !== value) changed = true;
        appearance[section][field] = clamped;
      } else if (fieldValid(spec, value)) {
        appearance[section][field] = value;
      } else {
        replaced.push(`${section}.${field}`);
      }
    }
  }
  if (replaced.length > 0) changed = true;
  return { appearance: appearance as unknown as AppearanceConfig, replaced, changed };
}

/** True when two configs describe the same look. */
export function sameAppearance(a: AppearanceConfig, b: AppearanceConfig): boolean {
  return encodeLook(a) === encodeLook(b);
}

// ── Compact forms ───────────────────────────────────────────────────────────

/** Fixed key order, so equal configs encode to equal strings. */
function canonical(config: AppearanceConfig): AppearanceConfig {
  const out = { v: config.v } as AppearanceConfig;
  for (const section of APPEARANCE_SECTIONS) {
    const ordered: Record<string, unknown> = {};
    for (const field of Object.keys(APPEARANCE_SPEC[section])) ordered[field] = (config[section] as Record<string, unknown>)[field];
    (out as unknown as Record<string, unknown>)[section] = ordered;
  }
  return out;
}

/** The replicated form (`PlayerState.look`): canonical JSON, under 1 KB. */
export function encodeLook(config: AppearanceConfig): string {
  return JSON.stringify(canonical(config));
}

/** Reads a replicated look. Never throws: anything unreadable becomes the default look. */
export function decodeLook(look: string): SanitizedAppearance {
  try {
    return sanitizeAppearance(JSON.parse(look));
  } catch {
    return { appearance: cloneAppearance(DEFAULT_APPEARANCE), replaced: ["appearance"], changed: true };
  }
}

/** Maximum size of a replicated or stored look (bytes of JSON). */
export const MAX_LOOK_LENGTH = 2048;

const LOOK_CODE_PREFIX = "PLS1.";
const BASE64URL = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/** base64url of an ASCII string (look JSON is always ASCII). No DOM or Node APIs, so it runs everywhere. */
function asciiToBase64Url(text: string): string {
  let out = "";
  for (let i = 0; i < text.length; i += 3) {
    const a = text.charCodeAt(i);
    const b = i + 1 < text.length ? text.charCodeAt(i + 1) : 0;
    const c = i + 2 < text.length ? text.charCodeAt(i + 2) : 0;
    const triple = (a << 16) | (b << 8) | c;
    out += BASE64URL[(triple >> 18) & 63]! + BASE64URL[(triple >> 12) & 63]!;
    if (i + 1 < text.length) out += BASE64URL[(triple >> 6) & 63]!;
    if (i + 2 < text.length) out += BASE64URL[triple & 63]!;
  }
  return out;
}

function base64UrlToAscii(code: string): string | null {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const char of code) {
    const index = BASE64URL.indexOf(char);
    if (index < 0) return null;
    value = (value << 6) | index;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out += String.fromCharCode((value >> bits) & 255);
    }
  }
  return out;
}

/** A shareable text code for a look (copy it, paste it back later or into another character). */
export function toLookCode(config: AppearanceConfig): string {
  return LOOK_CODE_PREFIX + asciiToBase64Url(encodeLook(config));
}

/** Reads a look code strictly. Returns null for anything that isn't a valid, current look. */
export function fromLookCode(code: string): AppearanceConfig | null {
  const trimmed = code.trim();
  if (!trimmed.startsWith(LOOK_CODE_PREFIX) || trimmed.length > MAX_LOOK_LENGTH * 2) return null;
  const json = base64UrlToAscii(trimmed.slice(LOOK_CODE_PREFIX.length));
  if (json === null) return null;
  try {
    const parsed = parseAppearanceConfig(JSON.parse(json));
    return parsed.ok ? parsed.value : null;
  } catch {
    return null;
  }
}

// ── Upgrading M4/M5 appearances ─────────────────────────────────────────────

/** The flat appearance saved by profile versions 1 and 2 (M4, M5). */
export interface LegacyAppearance {
  preset?: unknown;
  skinTone?: unknown;
  hairStyle?: unknown;
  hairColour?: unknown;
  eyeColour?: unknown;
  outfit?: unknown;
}

const LEGACY_SKIN_TONES: Record<string, number> = {
  "skin-1": 0.04,
  "skin-2": 0.16,
  "skin-3": 0.3,
  "skin-4": 0.48,
  "skin-5": 0.6,
  "skin-6": 0.72,
  "skin-7": 0.86,
  "skin-8": 0.97,
};

const LEGACY_HAIR_STYLES: Record<string, HairStyle> = { short: "short-straight", long: "long-straight", bun: "top-bun" };

const LEGACY_OUTFITS: Record<string, Partial<AppearanceConfig["outfit"]>> = {
  "tee-terracotta": { top: "tee", topColour: "terracotta", full: "none" },
  "hoodie-navy": { top: "hoodie", topColour: "navy", full: "none" },
  "shirt-cream": { top: "shirt", topColour: "cream", full: "none" },
  "jacket-olive": { top: "tee", topColour: "cream", full: "none", outer: "denim-jacket", outerColour: "olive" },
  "sweater-mustard": { top: "sweater", topColour: "mustard", full: "none" },
  "dress-plum": { full: "dress", topColour: "plum" },
};

/**
 * Converts an M4/M5 appearance to the current config. Unknown legacy values
 * fall back to defaults; known ids keep their look as closely as possible.
 */
export function upgradeLegacyAppearance(legacy: LegacyAppearance): AppearanceConfig {
  const config = cloneAppearance(DEFAULT_APPEARANCE);
  if (legacy.preset === "male") config.body.frame = "masculine";
  if (legacy.preset === "female") config.body.frame = "feminine";
  if (typeof legacy.skinTone === "string" && legacy.skinTone in LEGACY_SKIN_TONES) {
    config.skin.tone = LEGACY_SKIN_TONES[legacy.skinTone]!;
    config.skin.undertone = legacy.skinTone === "skin-4" ? "warm" : "neutral";
  }
  if (typeof legacy.hairStyle === "string" && legacy.hairStyle in LEGACY_HAIR_STYLES) {
    config.hair.style = LEGACY_HAIR_STYLES[legacy.hairStyle]!;
  }
  if (fieldValid(APPEARANCE_SPEC.hair.colour, legacy.hairColour)) config.hair.colour = legacy.hairColour as HairColour;
  if (fieldValid(APPEARANCE_SPEC.face.eyeColour, legacy.eyeColour)) config.face.eyeColour = legacy.eyeColour as EyeColour;
  if (typeof legacy.outfit === "string" && legacy.outfit in LEGACY_OUTFITS) Object.assign(config.outfit, LEGACY_OUTFITS[legacy.outfit]);
  return config;
}

/**
 * The closest M4/M5 flat appearance for a config. The server keeps writing
 * it to the old columns so that rolling back migration 0003 leaves every
 * character loadable with a similar look (D-028). Lossy by design.
 */
export function legacyAppearanceProjection(config: AppearanceConfig): {
  preset: string;
  skinTone: string;
  hairStyle: string;
  hairColour: string;
  eyeColour: string;
  outfit: string;
} {
  const oldHairColours = ["black", "dark-brown", "chestnut", "auburn", "blonde", "silver", "rose", "teal"];
  const oldEyeColours = ["brown", "hazel", "green", "blue", "grey", "violet"];
  const longStyles = new Set(["long-straight", "long-curly", "ponytail", "box-braids", "locs", "wavy-bob"]);
  const { outfit } = config;
  return {
    preset: config.body.frame === "masculine" ? "male" : "female",
    skinTone: `skin-${Math.min(8, Math.max(1, Math.round(config.skin.tone * 7) + 1))}`,
    hairStyle: config.hair.style === "top-bun" ? "bun" : longStyles.has(config.hair.style) ? "long" : "short",
    hairColour: oldHairColours.includes(config.hair.colour) ? config.hair.colour : "dark-brown",
    eyeColour: oldEyeColours.includes(config.face.eyeColour) ? config.face.eyeColour : "brown",
    outfit:
      outfit.full === "dress" || outfit.full === "maxi-dress"
        ? "dress-plum"
        : outfit.outer !== "none"
          ? "jacket-olive"
          : outfit.top === "hoodie"
            ? "hoodie-navy"
            : outfit.top === "shirt"
              ? "shirt-cream"
              : outfit.top === "sweater"
                ? "sweater-mustard"
                : "tee-terracotta",
  };
}
