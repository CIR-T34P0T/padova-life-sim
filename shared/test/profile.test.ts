import { describe, expect, it } from "vitest";
import {
  APPEARANCE_CATALOGUE,
  DEFAULT_APPEARANCE,
  PROFILE_VERSION,
  isAdult,
  parseAppearance,
  parseNewCharacter,
  sanitizeStoredAppearance,
  upgradeProfileData,
  type ProfileUpgrade,
  type StoredProfileData,
} from "../src/index.ts";

const valid = { displayName: "Giulia", ageCategory: "adult", appearance: { ...DEFAULT_APPEARANCE } };

describe("appearance catalogue", () => {
  it("offers both female and male presets and a range of skin tones", () => {
    expect(APPEARANCE_CATALOGUE.presets.map((p) => p.id)).toEqual(["female", "male"]);
    expect(APPEARANCE_CATALOGUE.skinTones.length).toBeGreaterThanOrEqual(8);
  });

  it("has unique ids in every list and a valid default", () => {
    for (const list of Object.values(APPEARANCE_CATALOGUE)) {
      const ids = list.map((o) => o.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
    expect(parseAppearance(DEFAULT_APPEARANCE)).toEqual({ ok: true, value: DEFAULT_APPEARANCE });
  });
});

describe("age categories", () => {
  it("distinguishes adults from non-adults", () => {
    expect(isAdult("adult")).toBe(true);
    expect(isAdult("teen")).toBe(false);
    expect(isAdult("child")).toBe(false);
  });
});

describe("parseNewCharacter", () => {
  it("accepts a valid adult character and cleans the name", () => {
    expect(parseNewCharacter({ ...valid, displayName: "  Giulia  R. " })).toEqual({
      ok: true,
      value: { displayName: "Giulia R.", ageCategory: "adult", appearance: DEFAULT_APPEARANCE, traits: [] },
    });
  });

  it("accepts up to two distinct known traits and refuses anything else", () => {
    expect(parseNewCharacter({ ...valid, traits: ["organised", "creative"] })).toMatchObject({ ok: true, value: { traits: ["organised", "creative"] } });
    for (const traits of [["organised", "organised"], ["organised", "sociable", "creative"], ["lazy"], "organised", [3]]) {
      expect(parseNewCharacter({ ...valid, traits })).toMatchObject({ ok: false, reason: "invalid_traits" });
    }
  });

  it("ignores unexpected fields such as a client-chosen id or owner", () => {
    const parsed = parseNewCharacter({ ...valid, characterId: "stolen", accountId: "someone-else", isAdmin: true });
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(Object.keys(parsed.value).sort()).toEqual(["ageCategory", "appearance", "displayName", "traits"]);
  });

  it("refuses non-adult player characters", () => {
    expect(parseNewCharacter({ ...valid, ageCategory: "teen" })).toMatchObject({ ok: false, reason: "age_category_not_allowed" });
    expect(parseNewCharacter({ ...valid, ageCategory: "child" })).toMatchObject({ ok: false, reason: "age_category_not_allowed" });
  });

  it("rejects malformed input", () => {
    expect(parseNewCharacter(null)).toMatchObject({ ok: false, reason: "invalid_payload" });
    expect(parseNewCharacter("Giulia")).toMatchObject({ ok: false, reason: "invalid_payload" });
    expect(parseNewCharacter({ ...valid, displayName: "x" })).toMatchObject({ ok: false, reason: "invalid_name" });
    expect(parseNewCharacter({ ...valid, displayName: 42 })).toMatchObject({ ok: false, reason: "invalid_name" });
    expect(parseNewCharacter({ ...valid, ageCategory: "elder" })).toMatchObject({ ok: false, reason: "invalid_payload" });
    expect(parseNewCharacter({ ...valid, appearance: undefined })).toMatchObject({ ok: false, reason: "invalid_appearance" });
  });
});

describe("parseAppearance", () => {
  it("rejects unknown option ids and missing fields, naming the field", () => {
    expect(parseAppearance({ ...DEFAULT_APPEARANCE, hairColour: "neon-green" })).toEqual({ ok: false, reason: "invalid_appearance", field: "hairColour" });
    const { outfit: _drop, ...missing } = DEFAULT_APPEARANCE;
    expect(parseAppearance(missing)).toEqual({ ok: false, reason: "invalid_appearance", field: "outfit" });
    expect(parseAppearance({ ...DEFAULT_APPEARANCE, preset: ["female"] })).toMatchObject({ ok: false, field: "preset" });
    expect(parseAppearance([])).toMatchObject({ ok: false, reason: "invalid_appearance" });
  });
});

describe("stored data safety", () => {
  it("replaces retired or corrupt appearance options with defaults and reports it", () => {
    const result = sanitizeStoredAppearance({ ...DEFAULT_APPEARANCE, hairStyle: "mohawk-retired", eyeColour: null });
    expect(result.changed).toBe(true);
    expect(result.replaced.sort()).toEqual(["eyeColour", "hairStyle"]);
    expect(parseAppearance(result.appearance).ok).toBe(true);
    expect(sanitizeStoredAppearance({ ...DEFAULT_APPEARANCE, skinTone: "skin-7" })).toMatchObject({ changed: false });
  });

  const stored = (version: number): StoredProfileData => ({
    profileVersion: version,
    displayName: "Giulia",
    ageCategory: "adult",
    appearance: { ...DEFAULT_APPEARANCE },
  });

  it("leaves current-version data unchanged", () => {
    expect(upgradeProfileData(stored(PROFILE_VERSION))).toEqual({ ok: true, data: stored(PROFILE_VERSION), upgraded: false });
  });

  it("upgrades a version 1 profile (before traits) to the current version with no traits", () => {
    const result = upgradeProfileData(stored(1));
    expect(result).toMatchObject({ ok: true, upgraded: true, data: { profileVersion: PROFILE_VERSION, traits: [] } });
  });

  it("runs upgrade steps one version at a time", () => {
    // Hypothetical future: v2 adds an accessory, v3 renames a hair colour.
    const upgrades: Record<number, ProfileUpgrade> = {
      1: (d) => ({ ...d, profileVersion: 2, appearance: { ...d.appearance, accessory: "none" } }),
      2: (d) => ({ ...d, profileVersion: 3, appearance: { ...d.appearance, hairColour: d.appearance.hairColour === "dark-brown" ? "chestnut" : d.appearance.hairColour } }),
    };
    const result = upgradeProfileData(stored(1), upgrades, 3);
    expect(result).toMatchObject({ ok: true, upgraded: true, data: { profileVersion: 3, appearance: { accessory: "none", hairColour: "chestnut" } } });
  });

  it("refuses data from a newer version, a missing step, or an invalid version", () => {
    expect(upgradeProfileData(stored(PROFILE_VERSION + 1))).toEqual({ ok: false, reason: "newer_version" });
    expect(upgradeProfileData(stored(1), {}, 2)).toEqual({ ok: false, reason: "missing_upgrade" });
    expect(upgradeProfileData(stored(0))).toEqual({ ok: false, reason: "unsupported_version" });
    expect(upgradeProfileData({ ...stored(1), profileVersion: 1.5 })).toEqual({ ok: false, reason: "unsupported_version" });
  });
});
