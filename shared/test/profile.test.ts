import { describe, expect, it } from "vitest";
import {
  DEFAULT_APPEARANCE,
  PROFILE_VERSION,
  cloneAppearance,
  isAdult,
  parseAppearance,
  parseNewCharacter,
  upgradeProfileData,
  type ProfileUpgrade,
  type StoredProfileData,
} from "../src/index.ts";

const valid = { displayName: "Giulia", ageCategory: "adult", appearance: cloneAppearance(DEFAULT_APPEARANCE) };

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

describe("parseAppearance (profile wrapper)", () => {
  it("names the invalid field with a dotted path", () => {
    const bad = cloneAppearance(DEFAULT_APPEARANCE) as unknown as { hair: Record<string, unknown> };
    bad.hair.colour = "neon-green";
    expect(parseAppearance(bad)).toEqual({ ok: false, reason: "invalid_appearance", field: "hair.colour" });
    expect(parseAppearance([])).toMatchObject({ ok: false, reason: "invalid_appearance" });
    expect(parseAppearance(DEFAULT_APPEARANCE)).toEqual({ ok: true, value: DEFAULT_APPEARANCE });
  });
});

describe("stored data upgrades", () => {
  const legacy = { preset: "male", skinTone: "skin-6", hairStyle: "bun", hairColour: "teal", eyeColour: "green", outfit: "hoodie-navy" };
  const stored = (version: number, appearance: unknown = version >= 3 ? cloneAppearance(DEFAULT_APPEARANCE) : { ...legacy }): StoredProfileData => ({
    profileVersion: version,
    displayName: "Giulia",
    ageCategory: "adult",
    appearance,
  });

  it("leaves current-version data unchanged", () => {
    expect(upgradeProfileData(stored(PROFILE_VERSION))).toEqual({ ok: true, data: stored(PROFILE_VERSION), upgraded: false });
  });

  it("upgrades a version 1 profile (before traits) to the current version with no traits", () => {
    const result = upgradeProfileData(stored(1));
    expect(result).toMatchObject({ ok: true, upgraded: true, data: { profileVersion: PROFILE_VERSION, traits: [] } });
  });

  it("upgrades a version 2 (M5) flat appearance to an appearance config that keeps the look", () => {
    const result = upgradeProfileData(stored(2));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.profileVersion).toBe(3);
    expect(parseAppearance(result.data.appearance).ok).toBe(true);
    expect(result.data.appearance).toMatchObject({
      body: { frame: "masculine" },
      skin: { tone: 0.72 },
      hair: { style: "top-bun", colour: "teal" },
      face: { eyeColour: "green" },
      outfit: { top: "hoodie", topColour: "navy", full: "none" },
    });
  });

  it("upgrades corrupt version 2 appearance data to a valid default-based config", () => {
    const result = upgradeProfileData(stored(2, { preset: 7, skinTone: "skin-99", hairStyle: null }));
    expect(result.ok && parseAppearance(result.data.appearance).ok).toBe(true);
    expect(upgradeProfileData(stored(2, null))).toMatchObject({ ok: true, data: { appearance: DEFAULT_APPEARANCE } });
  });

  it("runs upgrade steps one version at a time", () => {
    // Hypothetical: v2 adds an accessory, v3 renames a hair colour.
    type Flat = Record<string, unknown>;
    const upgrades: Record<number, ProfileUpgrade> = {
      1: (d) => ({ ...d, profileVersion: 2, appearance: { ...(d.appearance as Flat), accessory: "none" } }),
      2: (d) => {
        const a = d.appearance as Flat;
        return { ...d, profileVersion: 3, appearance: { ...a, hairColour: a.hairColour === "dark-brown" ? "chestnut" : a.hairColour } };
      },
    };
    const result = upgradeProfileData(stored(1, { hairColour: "dark-brown" }), upgrades, 3);
    expect(result).toMatchObject({ ok: true, upgraded: true, data: { profileVersion: 3, appearance: { accessory: "none", hairColour: "chestnut" } } });
  });

  it("refuses data from a newer version, a missing step, or an invalid version", () => {
    expect(upgradeProfileData(stored(PROFILE_VERSION + 1))).toEqual({ ok: false, reason: "newer_version" });
    expect(upgradeProfileData(stored(1), {}, 2)).toEqual({ ok: false, reason: "missing_upgrade" });
    expect(upgradeProfileData(stored(0))).toEqual({ ok: false, reason: "unsupported_version" });
    expect(upgradeProfileData({ ...stored(1), profileVersion: 1.5 })).toEqual({ ok: false, reason: "unsupported_version" });
  });
});
