// Creator categories (title screen milestone): every appearance field is in
// exactly one category, randomise / reset touch only their own category,
// and the review summary describes the look in plain words.

import { describe, expect, it } from "vitest";
import {
  APPEARANCE_PRESETS,
  CATEGORY_FIELDS,
  CREATOR_CATEGORIES,
  DEFAULT_APPEARANCE,
  allFieldPaths,
  categoryOfField,
  changedCategories,
  cloneAppearance,
  confirmNameMatches,
  describeLook,
  getAppearanceField,
  heightCm,
  parseAppearanceConfig,
  parseCharacterId,
  parseDeleteCharacter,
  parseEnterWorld,
  randomiseCategory,
  resetCategory,
} from "../src/index.ts";

const preset = (id: string) => APPEARANCE_PRESETS.find((p) => p.id === id)!.appearance;

describe("creator categories", () => {
  it("put every appearance field in exactly one category", () => {
    const all = allFieldPaths();
    const grouped = CREATOR_CATEGORIES.flatMap((category) => [...CATEGORY_FIELDS[category]]);
    expect([...grouped].sort()).toEqual([...all].sort());
    expect(new Set(grouped).size).toBe(grouped.length);
    for (const path of all) expect(categoryOfField(path), path).not.toBeNull();
    expect(categoryOfField("skin.tone")).toBe("appearance");
    expect(categoryOfField("outfit.glasses")).toBe("accessories");
    expect(categoryOfField("outfit.top")).toBe("clothing");
    expect(categoryOfField("nope.field")).toBeNull();
  });

  it("randomise one category without touching the others, deterministically and validly", () => {
    const start = preset("box-braids");
    for (const category of CREATOR_CATEGORIES) {
      let changedSomething = false;
      for (let seed = 1; seed <= 12; seed++) {
        const next = randomiseCategory(start, category, seed);
        expect(parseAppearanceConfig(next).ok, `${category} seed ${seed}`).toBe(true);
        expect(randomiseCategory(start, category, seed)).toEqual(next);
        for (const other of CREATOR_CATEGORIES.filter((c) => c !== category)) {
          for (const path of CATEGORY_FIELDS[other]) expect(getAppearanceField(next, path), `${category} changed ${path}`).toEqual(getAppearanceField(start, path));
        }
        if (changedCategories(start, next).includes(category)) changedSomething = true;
      }
      expect(changedSomething, category).toBe(true);
    }
  });

  it("reset one category back to the base look only", () => {
    const base = preset("locs-beard");
    const edited = cloneAppearance(base);
    edited.hair.style = "afro";
    edited.outfit.glasses = "round";
    edited.outfit.top = "hoodie";
    const reset = resetCategory(edited, "accessories", base);
    expect(reset.outfit.glasses).toBe(base.outfit.glasses);
    expect(reset.hair.style).toBe("afro");
    expect(reset.outfit.top).toBe("hoodie");
    expect(changedCategories(base, reset)).toEqual(["hair", "clothing"]);
    expect(changedCategories(base, base)).toEqual([]);
  });

  it("describe a look in plain words, saying when the hair is covered", () => {
    const lines = describeLook(preset("box-braids"));
    expect(lines.map((l) => l.category)).toEqual([...CREATOR_CATEGORIES]);
    expect(lines.find((l) => l.category === "hair")!.text).toMatch(/^Hair: Box braids, /);
    const covered = cloneAppearance(DEFAULT_APPEARANCE);
    covered.outfit.headwear = "headscarf";
    expect(describeLook(covered).find((l) => l.category === "hair")!.text).toContain("covered by the headscarf");
    expect(describeLook(covered).find((l) => l.category === "accessories")!.text).toMatch(/^Accessories: Headscarf in /);
    for (const p of APPEARANCE_PRESETS) {
      for (const line of describeLook(p.appearance)) expect(line.text, p.id).not.toMatch(/undefined|\[object/);
    }
    expect(heightCm(0)).toBe(156);
    expect(heightCm(1)).toBe(188);
  });
});

describe("title screen request validation", () => {
  const id = "3f2b8c1e-9a4d-4e7b-8c2a-1d5e6f7a8b9c";

  it("accepts only UUID character ids", () => {
    expect(parseCharacterId(id)).toBe(id);
    expect(parseCharacterId(id.toUpperCase())).toBe(id);
    for (const bad of ["", "../x", 42, null, undefined, `${id} `, "3f2b8c1e9a4d4e7b8c2a1d5e6f7a8b9c"]) expect(parseCharacterId(bad)).toBeNull();
    expect(parseEnterWorld({ characterId: id, accountId: "someone" })).toEqual({ characterId: id });
    expect(parseEnterWorld({})).toBeNull();
    expect(parseEnterWorld("x")).toBeNull();
  });

  it("needs a typed name to delete, compared without case or extra spaces", () => {
    expect(parseDeleteCharacter({ characterId: id, confirmName: "Giulia" })).toEqual({ characterId: id, confirmName: "Giulia" });
    expect(parseDeleteCharacter({ characterId: id })).toBeNull();
    expect(parseDeleteCharacter({ characterId: id, confirmName: "x".repeat(201) })).toBeNull();
    expect(confirmNameMatches("  giulia  ", "Giulia")).toBe(true);
    expect(confirmNameMatches("Anna  Maria", "Anna Maria")).toBe(true);
    expect(confirmNameMatches("Giuli", "Giulia")).toBe(false);
    expect(confirmNameMatches("", "Giulia")).toBe(false);
    expect(confirmNameMatches("   ", " ")).toBe(false);
  });
});
