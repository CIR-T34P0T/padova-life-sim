// Personality traits: chosen at character creation (up to MAX_TRAITS).

import { MAX_TRAITS, TRAIT_IDS, type TraitId } from "./config.ts";

export const isTraitId = (value: unknown): value is TraitId =>
  typeof value === "string" && (TRAIT_IDS as readonly string[]).includes(value);

/** Strict check of traits sent by a client: an array of distinct, known ids, at most MAX_TRAITS. */
export function parseTraits(value: unknown): { ok: true; value: TraitId[] } | { ok: false } {
  if (value === undefined) return { ok: true, value: [] };
  if (!Array.isArray(value) || value.length > MAX_TRAITS) return { ok: false };
  if (!value.every(isTraitId)) return { ok: false };
  if (new Set(value).size !== value.length) return { ok: false };
  return { ok: true, value: [...value] };
}

/** Stored traits: unknown (retired) ids dropped, duplicates removed, at most MAX_TRAITS kept. */
export function sanitizeStoredTraits(values: readonly unknown[]): TraitId[] {
  return [...new Set(values.filter(isTraitId))].slice(0, MAX_TRAITS);
}
