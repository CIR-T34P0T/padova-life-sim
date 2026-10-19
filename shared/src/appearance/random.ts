// Randomising appearances for the creator's "Randomise" buttons and for tests.
// Deterministic for a given seed, so a randomised look can be reproduced.
// Every option stays possible for every body frame; weights only make
// extreme slider values and some accessories less frequent.

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
  type Option,
} from "./catalogue.ts";
import { cloneAppearance, roundSlider, type AppearanceConfig, type AppearanceSection } from "./schema.ts";

/** Small, fast seeded random generator (mulberry32). Returns numbers in [0, 1). */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Rng = () => number;

const pick = <T extends Option>(rng: Rng, list: readonly T[]): T["id"] => list[Math.floor(rng() * list.length)]!.id;
/** Picks "none"-like first option with probability `pNone`, otherwise any other option. */
const pickOptional = <T extends Option>(rng: Rng, list: readonly T[], pNone: number): T["id"] =>
  rng() < pNone ? list[0]!.id : list[1 + Math.floor(rng() * (list.length - 1))]!.id;
/** Slider value centred on 0.5; extremes are possible but less likely. */
const slider = (rng: Rng) => roundSlider((rng() + rng() + rng()) / 3);
const uniform = (rng: Rng) => roundSlider(rng());

function randomBody(rng: Rng, config: AppearanceConfig): void {
  config.body = {
    frame: pick(rng, BODY_FRAMES),
    build: pick(rng, BUILDS),
    height: slider(rng),
    shoulders: slider(rng),
    torso: slider(rng),
    legs: slider(rng),
    arms: slider(rng),
  };
}

function randomSkin(rng: Rng, config: AppearanceConfig): void {
  config.skin = {
    tone: uniform(rng),
    undertone: pick(rng, UNDERTONES),
    freckles: pickOptional(rng, FRECKLES, 0.75),
    mark: pickOptional(rng, BEAUTY_MARKS, 0.75),
    blush: roundSlider(rng() * 0.6),
  };
}

function randomFace(rng: Rng, config: AppearanceConfig): void {
  config.face = {
    shape: pick(rng, FACE_SHAPES),
    cheekbones: slider(rng),
    jaw: slider(rng),
    chin: slider(rng),
    forehead: slider(rng),
    eyeShape: pick(rng, EYE_SHAPES),
    eyeSize: slider(rng),
    eyeSpacing: slider(rng),
    eyeColour: rng() < 0.9 ? pick(rng, EYE_COLOURS.filter((c) => c.kind === "natural")) : pick(rng, EYE_COLOURS),
    browShape: pick(rng, BROW_SHAPES),
    browHeight: slider(rng),
    noseShape: pick(rng, NOSE_SHAPES),
    noseWidth: slider(rng),
    noseLength: slider(rng),
    lipShape: pick(rng, LIP_SHAPES),
    lipFullness: slider(rng),
  };
}

function randomHair(rng: Rng, config: AppearanceConfig): void {
  const natural = HAIR_COLOURS.filter((c) => c.kind === "natural");
  config.hair = {
    style: pick(rng, HAIR_STYLES),
    colour: rng() < 0.85 ? pick(rng, natural) : pick(rng, HAIR_COLOURS),
    hairline: rng() < 0.6 ? "rounded" : pick(rng, HAIRLINES),
    // Facial hair is less frequent on feminine frames by default, never impossible.
    facial: pickOptional(rng, FACIAL_HAIR, config.body.frame === "masculine" ? 0.5 : 0.92),
  };
}

function randomOutfit(rng: Rng, config: AppearanceConfig): void {
  config.outfit = {
    top: pick(rng, TOPS),
    topColour: pick(rng, CLOTHING_COLOURS),
    pattern: pickOptional(rng, PATTERNS, 0.6),
    bottom: pick(rng, BOTTOMS),
    bottomColour: pick(rng, CLOTHING_COLOURS),
    full: pickOptional(rng, FULL_OUTFITS, 0.75),
    shoes: pick(rng, SHOES),
    shoesColour: pick(rng, CLOTHING_COLOURS),
    outer: pickOptional(rng, OUTERWEAR, 0.55),
    outerColour: pick(rng, CLOTHING_COLOURS),
    glasses: pickOptional(rng, GLASSES, 0.75),
    headwear: pickOptional(rng, HEADWEAR, 0.7),
    headwearColour: pick(rng, CLOTHING_COLOURS),
  };
}

const SECTION_RANDOMISERS: Record<AppearanceSection, (rng: Rng, config: AppearanceConfig) => void> = {
  body: randomBody,
  skin: randomSkin,
  face: randomFace,
  hair: randomHair,
  outfit: randomOutfit,
};

/** A random appearance. Same seed → same appearance. */
export function randomAppearance(seed: number): AppearanceConfig {
  const rng = seededRandom(seed);
  const config = cloneAppearance({
    v: 1,
    body: {} as AppearanceConfig["body"],
    skin: {} as AppearanceConfig["skin"],
    face: {} as AppearanceConfig["face"],
    hair: {} as AppearanceConfig["hair"],
    outfit: {} as AppearanceConfig["outfit"],
  });
  for (const section of ["body", "skin", "face", "hair", "outfit"] as const) SECTION_RANDOMISERS[section](rng, config);
  return config;
}

/** A copy of `config` with one section randomised and everything else unchanged. */
export function randomiseSection(config: AppearanceConfig, section: AppearanceSection, seed: number): AppearanceConfig {
  const next = cloneAppearance(config);
  SECTION_RANDOMISERS[section](seededRandom(seed), next);
  return next;
}
