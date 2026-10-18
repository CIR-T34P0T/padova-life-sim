// Skills: experience points → levels, and how much XP an action gives after
// traits and mood. No skill tree (by design for M5).

import { SKILL_CONFIG, SKILL_IDS, TRAITS, type MoodLevel, type SkillId, type TraitId } from "./config.ts";
import { moodSkillMultiplier } from "./mood.ts";

export type SkillXp = Record<SkillId, number>;

export interface SkillProgress {
  xp: number;
  level: number;
  /** XP needed for the next level (null at max level). */
  nextLevelXp: number | null;
  /** 0–1 progress through the current level (1 at max level). */
  progress: number;
}

/** Total XP needed to reach `level`. */
export function xpForLevel(level: number): number {
  return SKILL_CONFIG.levelFactor * level * (level + 1);
}

export function levelForXp(xp: number): number {
  let level = 0;
  while (level < SKILL_CONFIG.maxLevel && xp >= xpForLevel(level + 1)) level++;
  return level;
}

export function skillProgress(xp: number): SkillProgress {
  const safe = Math.max(0, xp);
  const level = levelForXp(safe);
  if (level >= SKILL_CONFIG.maxLevel) return { xp: safe, level, nextLevelXp: null, progress: 1 };
  const from = xpForLevel(level);
  const to = xpForLevel(level + 1);
  return { xp: safe, level, nextLevelXp: to, progress: (safe - from) / (to - from) };
}

export function skillXpMultiplier(skill: SkillId, traits: readonly TraitId[]): number {
  return traits.reduce((product, trait) => {
    const definition = TRAITS[trait];
    return product * (definition.skillXp?.[skill] ?? 1) * (definition.allSkillXp ?? 1);
  }, 1);
}

/** XP actually earned from `baseXp` with these traits in this mood. */
export function skillGain(baseXp: number, skill: SkillId, traits: readonly TraitId[], mood: MoodLevel): number {
  if (!(baseXp > 0)) return 0;
  return baseXp * skillXpMultiplier(skill, traits) * moodSkillMultiplier(mood);
}

export function emptySkills(): SkillXp {
  return Object.fromEntries(SKILL_IDS.map((skill) => [skill, 0])) as SkillXp;
}

/** Parses stored XP; unknown skills are dropped, missing ones start at 0. */
export function sanitizeSkills(raw: Partial<Record<string, unknown>> | null | undefined): SkillXp {
  const skills = emptySkills();
  for (const skill of SKILL_IDS) {
    const value = raw?.[skill];
    if (typeof value === "number" && Number.isFinite(value) && value > 0) skills[skill] = value;
  }
  return skills;
}
