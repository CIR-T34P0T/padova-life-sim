// Needs: how they fall over game time, how actions change them, and the
// offline catch-up (D-022). Pure functions; the server is the only caller
// that changes stored values.

import { ACTION_EFFECTS, NEED_IDS, NEEDS_CONFIG, TRAITS, type NeedId, type Needs, type TraitId } from "./config.ts";

export interface NeedContext {
  /** Public activity: "idle", "sitting", "studying", "eating", … */
  activity: string;
  moving: boolean;
  traits: readonly TraitId[];
  /**
   * Comfort per game hour of the seat being sat on (M10), when it has its
   * own (home furniture); otherwise NEEDS_CONFIG.sittingComfortPerGameHour.
   */
  seatComfort?: number;
}

export const clampNeed = (value: number): number => Math.min(100, Math.max(0, value));

/** How much faster or slower a need falls for these traits (applies to falling rates only). */
export function fallRateMultiplier(need: NeedId, traits: readonly TraitId[]): number {
  return traits.reduce((product, trait) => product * (TRAITS[trait].needFallRate?.[need] ?? 1), 1);
}

/** Multiplier for positive changes to a need, optionally from one specific action. */
export function gainMultiplier(need: NeedId, traits: readonly TraitId[], action?: keyof typeof ACTION_EFFECTS): number {
  return traits.reduce((product, trait) => {
    const definition = TRAITS[trait];
    const general = definition.needGain?.[need] ?? 1;
    const specific = action ? (definition.actionNeedGain?.[action]?.[need] ?? 1) : 1;
    return product * general * specific;
  }, 1);
}

/** Change per game hour of every need in this situation. */
export function needRates(context: NeedContext): Needs {
  const rates: Needs = { ...NEEDS_CONFIG.perGameHour };
  if (context.moving) rates.energy = NEEDS_CONFIG.walkingEnergyPerGameHour;
  if (context.activity === "sitting") {
    rates.energy = NEEDS_CONFIG.sittingEnergyPerGameHour;
    rates.fun = NEEDS_CONFIG.sittingFunPerGameHour;
    rates.comfort = context.seatComfort ?? NEEDS_CONFIG.sittingComfortPerGameHour;
  }
  for (const need of NEED_IDS) {
    if (rates[need] < 0) rates[need] *= fallRateMultiplier(need, context.traits);
  }
  return rates;
}

/** Needs after `gameHours` of normal life (online). */
export function stepNeeds(needs: Needs, gameHours: number, context: NeedContext): Needs {
  if (!(gameHours > 0)) return { ...needs };
  const rates = needRates(context);
  const next = { ...needs };
  for (const need of NEED_IDS) next[need] = clampNeed(needs[need] + rates[need] * gameHours);
  return next;
}

/**
 * Applies changes from an action. Positive changes are scaled by trait gain
 * multipliers; negative ones are applied as they are.
 */
export function applyNeedChanges(
  needs: Needs,
  changes: Partial<Needs>,
  traits: readonly TraitId[],
  action?: keyof typeof ACTION_EFFECTS,
): Needs {
  const next = { ...needs };
  for (const need of NEED_IDS) {
    const change = changes[need];
    if (!change) continue;
    const scaled = change > 0 ? change * gainMultiplier(need, traits, action) : change;
    next[need] = clampNeed(next[need] + scaled);
  }
  return next;
}

/** Offline catch-up (D-022): capped, half-rate, floored; offline counts as rest. */
export function offlineCatchUp(needs: Needs, elapsedGameHours: number, traits: readonly TraitId[]): Needs {
  const { capGameHours, decayFactor, floor, energyPerGameHour, energyCap } = NEEDS_CONFIG.offline;
  const hours = Math.min(Math.max(elapsedGameHours, 0), capGameHours);
  const next = { ...needs };
  if (hours === 0) return next;
  for (const need of NEED_IDS) {
    if (need === "energy") {
      if (needs.energy < energyCap) next.energy = Math.min(energyCap, needs.energy + energyPerGameHour * hours);
      continue;
    }
    if (needs[need] <= floor) continue;
    const rate = NEEDS_CONFIG.perGameHour[need] * fallRateMultiplier(need, traits) * decayFactor;
    next[need] = Math.max(floor, needs[need] + rate * hours);
  }
  return next;
}

export const isTooTired = (needs: Needs): boolean => needs.energy < NEEDS_CONFIG.tooTiredEnergy;
export const isGrubby = (needs: Needs): boolean => needs.hygiene < NEEDS_CONFIG.grubbyHygiene;

/** Parses stored or received need values; anything missing or invalid becomes the initial value. */
export function sanitizeNeeds(raw: Partial<Record<NeedId, unknown>> | null | undefined): Needs {
  const needs = { ...NEEDS_CONFIG.initial } as Needs;
  for (const need of NEED_IDS) {
    const value = raw?.[need];
    if (typeof value === "number" && Number.isFinite(value)) needs[need] = clampNeed(value);
  }
  return needs;
}
