// What actions do to a character. Timed actions have fixed totals per
// completed action; the server applies them gradually (by elapsed fraction),
// so stopping halfway gives half the effect.

import { ACTION_EFFECTS, GREETING_EFFECTS, type MoodEventId, type Needs, type SkillId, type TimedEffect } from "./config.ts";
import { findMenuItem } from "./economy.ts";
import { isGrubby } from "./needs.ts";

export type TimedEffectKey = keyof typeof ACTION_EFFECTS;

export interface ResolvedEffect extends TimedEffect {
  /** Which trait-specific gain rules apply (none for food). */
  key: TimedEffectKey | "consume";
  itemId?: string;
}

/** The timed effect of an action, or null for untimed actions (sit, stand, greet). */
export function timedEffectFor(action: string, itemId?: string): ResolvedEffect | null {
  if (action === "buy") {
    const item = itemId ? findMenuItem(itemId) : null;
    if (!item) return null;
    return {
      durationMs: item.consumeMs,
      activity: item.activity,
      needs: item.needs,
      skills: {},
      moodEvent: item.moodEvent,
      focus: false,
      key: "consume",
      itemId: item.id,
    };
  }
  if (action in ACTION_EFFECTS) {
    const key = action as TimedEffectKey;
    return { ...ACTION_EFFECTS[key], key };
  }
  return null;
}

export interface EffectPortion {
  needs: Partial<Needs>;
  skills: Partial<Record<SkillId, number>>;
}

/** The share of an effect earned over a fraction (0–1) of its duration. */
export function effectPortion(effect: Pick<TimedEffect, "needs" | "skills">, fraction: number): EffectPortion {
  const share = Math.min(1, Math.max(0, fraction));
  const needs: Partial<Needs> = {};
  const skills: Partial<Record<SkillId, number>> = {};
  for (const [need, total] of Object.entries(effect.needs) as [keyof Needs, number][]) needs[need] = total * share;
  for (const [skill, total] of Object.entries(effect.skills) as [SkillId, number][]) skills[skill] = total * share;
  return { needs, skills };
}

export interface GreetingEffect {
  needs: Partial<Needs>;
  skills: Partial<Record<SkillId, number>>;
  moodEvent: MoodEventId;
}

/** Effects of a greeting on the greeter or the greeted player. A grubby greeter gains half the social boost. */
export function greetingEffect(role: "greeter" | "greeted", actorNeeds: Needs): GreetingEffect {
  if (role === "greeted") {
    return { needs: { ...GREETING_EFFECTS.greeted.needs }, skills: {}, moodEvent: GREETING_EFFECTS.greeted.moodEvent };
  }
  const needs: Partial<Needs> = { ...GREETING_EFFECTS.greeter.needs };
  if (isGrubby(actorNeeds) && needs.social) needs.social /= 2;
  return { needs, skills: { ...GREETING_EFFECTS.greeter.skills }, moodEvent: GREETING_EFFECTS.greeter.moodEvent };
}
