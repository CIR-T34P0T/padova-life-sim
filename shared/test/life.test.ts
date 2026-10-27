import { describe, expect, it } from "vitest";
import {
  ACTION_EFFECTS,
  CAFE_MENU,
  ECONOMY_CONFIG,
  NEEDS_CONFIG,
  NEED_IDS,
  TIME_CONFIG,
  addMoodEvent,
  applyNeedChanges,
  canAfford,
  computeMood,
  effectPortion,
  findMenuItem,
  formatEuros,
  gameDayOf,
  gameMinuteAt,
  greetingEffect,
  isTooTired,
  isValidRequestId,
  levelForXp,
  moodLevelOf,
  needContribution,
  needRates,
  offlineCatchUp,
  parseTimeScale,
  parseTraits,
  readClock,
  realMsToGameHours,
  sanitizeNeeds,
  sanitizeSkills,
  sanitizeStoredTraits,
  skillGain,
  skillProgress,
  stepNeeds,
  timedEffectFor,
  xpForLevel,
  type Needs,
} from "../src/index.ts";

const all = (value: number): Needs => ({ hunger: value, energy: value, hygiene: value, social: value, fun: value, comfort: value });
const idle = { activity: "idle", moving: false, traits: [] as const };

describe("world clock", () => {
  it("starts at 08:00 on Day 1 and runs 10 game minutes per real minute by default", () => {
    expect(gameMinuteAt(TIME_CONFIG.anchorRealMs)).toBe(480);
    expect(readClock(480).label).toBe("Day 1 · 08:00");
    // 6 real minutes = 1 game hour; 2 h 24 min real = 1 game day.
    expect(gameMinuteAt(TIME_CONFIG.anchorRealMs + 6 * 60_000)).toBe(540);
    expect(gameMinuteAt(TIME_CONFIG.anchorRealMs + 144 * 60_000) - 480).toBe(1440);
    expect(realMsToGameHours(6 * 60_000)).toBeCloseTo(1);
  });

  it("formats days and times, and depends only on real time and scale", () => {
    expect(readClock(1440 + 14 * 60 + 5.9).label).toBe("Day 2 · 14:05");
    expect(gameDayOf(1439)).toBe(1);
    expect(gameDayOf(1440)).toBe(2);
    const t = TIME_CONFIG.anchorRealMs + 123_456_789;
    expect(gameMinuteAt(t, 60)).toBe(gameMinuteAt(t, 60));
    expect(gameMinuteAt(t, 60) - 480).toBeCloseTo((gameMinuteAt(t, 10) - 480) * 6);
  });

  it("accepts only sensible configured scales", () => {
    expect(parseTimeScale(undefined)).toBe(10);
    expect(parseTimeScale("60")).toBe(60);
    for (const bad of ["0", "-5", "abc", "100000"]) expect(() => parseTimeScale(bad)).toThrow(/GAME_TIME_SCALE/);
  });
});

describe("needs", () => {
  it("fall at the documented rates per game hour and stay within 0–100", () => {
    const after = stepNeeds(all(50), 1, idle);
    expect(after).toEqual({ hunger: 44, energy: 46, hygiene: 47, social: 46, fun: 45, comfort: 47 });
    expect(stepNeeds(all(3), 2, idle).hunger).toBe(0);
    expect(stepNeeds(all(50), 0, idle)).toEqual(all(50));
  });

  it("are not punishing: nothing empties in under 90 real minutes of ordinary play", () => {
    const gameHoursPerRealMinute = TIME_CONFIG.defaultScale / 60;
    const rates = needRates({ activity: "idle", moving: true, traits: ["sociable", "ambitious"] });
    for (const need of NEED_IDS) {
      const realMinutesToEmpty = 100 / -rates[need] / gameHoursPerRealMinute;
      expect(realMinutesToEmpty, need).toBeGreaterThanOrEqual(90);
    }
  });

  it("drain energy faster while walking and restore it while sitting", () => {
    expect(needRates({ ...idle, moving: true }).energy).toBe(NEEDS_CONFIG.walkingEnergyPerGameHour);
    const sitting = needRates({ ...idle, activity: "sitting" });
    expect(sitting.energy).toBeGreaterThan(0);
    expect(sitting.fun).toBeGreaterThan(NEEDS_CONFIG.perGameHour.fun);
    expect(stepNeeds(all(50), 1, { ...idle, activity: "sitting" }).energy).toBe(70);
  });

  it("apply trait effects to falling rates and to gains", () => {
    expect(needRates({ ...idle, traits: ["organised"] }).hygiene).toBeCloseTo(-3 * 0.8);
    expect(needRates({ ...idle, traits: ["sociable"] }).social).toBeCloseTo(-4 * 1.25);
    expect(needRates({ ...idle, traits: ["ambitious"] }).fun).toBeCloseTo(-5 * 1.15);
    expect(applyNeedChanges(all(50), { social: 10 }, ["sociable"]).social).toBe(65);
    expect(applyNeedChanges(all(50), { fun: 10 }, ["creative"], "sketch").fun).toBe(65);
    expect(applyNeedChanges(all(50), { fun: 10 }, ["creative"]).fun).toBe(60); // only sketching is boosted
    expect(applyNeedChanges(all(50), { energy: -10 }, ["sociable"]).energy).toBe(40); // losses are never scaled
    expect(applyNeedChanges(all(95), { hunger: 45 }, []).hunger).toBe(100);
  });

  it("catch up offline gently: capped, half rate, floored, and energy recovers", () => {
    const start: Needs = { hunger: 80, energy: 20, hygiene: 36, social: 30, fun: 70, comfort: 60 };
    const day = offlineCatchUp(start, 24, []);
    const cap = NEEDS_CONFIG.offline.capGameHours;
    expect(day).toEqual(offlineCatchUp(start, cap, [])); // anything beyond the cap counts as the cap
    expect(day.hunger).toBe(Math.max(35, 80 - 6 * 0.5 * cap)); // 56
    expect(day.hygiene).toBe(35); // floored
    expect(day.social).toBe(30); // already below the floor: untouched, never lowered further
    expect(day.energy).toBe(NEEDS_CONFIG.offline.energyCap); // rested
    expect(offlineCatchUp(start, -5, [])).toEqual(start);
    expect(offlineCatchUp({ ...start, energy: 95 }, 4, []).energy).toBe(95); // above the cap: unchanged
  });

  it("treat energy below 10 as too tired to concentrate", () => {
    expect(isTooTired({ ...all(50), energy: 9.9 })).toBe(true);
    expect(isTooTired({ ...all(50), energy: 10 })).toBe(false);
  });

  it("replace missing or corrupt stored values with the starting values", () => {
    expect(sanitizeNeeds({ hunger: 120, energy: -4, hygiene: "x", social: Number.NaN })).toEqual({
      hunger: 100,
      energy: 0,
      hygiene: NEEDS_CONFIG.initial.hygiene,
      social: NEEDS_CONFIG.initial.social,
      fun: NEEDS_CONFIG.initial.fun,
      comfort: NEEDS_CONFIG.initial.comfort,
    });
  });
});

describe("mood", () => {
  it("comes from needs: low needs hurt twice as much as high needs help", () => {
    expect(needContribution(0)).toBe(-16);
    expect(needContribution(50)).toBe(0);
    expect(needContribution(100)).toBe(8);
    expect(computeMood(all(50), [], 0)).toEqual({ score: 0, level: "okay", reasons: [] });
    expect(computeMood(all(100), [], 0).level).toBe("great");
    expect(computeMood(all(0), [], 0).level).toBe("miserable");
  });

  it("includes recent events, explains itself, and lets events expire", () => {
    let events = addMoodEvent([], "good_meal", 600);
    events = addMoodEvent(events, "learned_something", 600);
    const mood = computeMood({ ...all(50), hunger: 10 }, events, 610);
    expect(mood.score).toBeCloseTo(-12.8 + 10 + 8, 5);
    expect(mood.reasons.map((r) => r.label)).toEqual(["Hungry", "Good meal", "Learned something"]);
    expect(computeMood(all(50), events, 600 + 180).reasons.map((r) => r.label)).toEqual([]); // both expired by then
  });

  it("refreshes a repeated event instead of stacking it, and caps the event total", () => {
    let events = addMoodEvent([], "good_meal", 0);
    events = addMoodEvent(events, "good_meal", 100);
    expect(events).toEqual([{ id: "good_meal", startedAt: 100, expiresAt: 280 }]);
    const many = (["good_meal", "friendly_hello", "learned_something", "creative_flow", "caffeine_boost", "freshened_up"] as const).reduce(
      (list, id) => addMoodEvent(list, id, 0),
      [] as ReturnType<typeof addMoodEvent>,
    );
    expect(computeMood(all(50), many, 1).score).toBe(40);
  });

  it("maps scores to levels at the documented thresholds", () => {
    expect([-40, -39.9, -15, -14.9, 14.9, 15, 39.9, 40].map(moodLevelOf)).toEqual([
      "miserable",
      "low",
      "low",
      "okay",
      "okay",
      "good",
      "good",
      "great",
    ]);
  });
});

describe("skills", () => {
  it("level up at 100, 300, 600 … 5500 XP and stop at level 10", () => {
    expect([1, 2, 3, 10].map(xpForLevel)).toEqual([100, 300, 600, 5500]);
    expect([0, 99.9, 100, 299, 300, 5500, 99_999].map(levelForXp)).toEqual([0, 0, 1, 1, 2, 10, 10]);
    expect(skillProgress(200)).toEqual({ xp: 200, level: 1, nextLevelXp: 300, progress: 0.5 });
    expect(skillProgress(6000)).toMatchObject({ level: 10, nextLevelXp: null, progress: 1 });
  });

  it("scale gains by traits and mood, deterministically", () => {
    expect(skillGain(20, "academic", [], "okay")).toBe(20);
    expect(skillGain(20, "academic", ["organised"], "great")).toBeCloseTo(30);
    expect(skillGain(20, "academic", ["organised", "ambitious"], "okay")).toBeCloseTo(26.4);
    expect(skillGain(20, "academic", [], "miserable")).toBe(10);
    expect(skillGain(15, "creativity", ["creative"], "good")).toBeCloseTo(20.625);
    expect(skillGain(-5, "academic", [], "great")).toBe(0);
  });

  it("clean stored XP", () => {
    expect(sanitizeSkills({ academic: 150, cooking: -3, juggling: 40, fitness: "x" })).toEqual({
      academic: 150,
      communication: 0,
      cooking: 0,
      fitness: 0,
      creativity: 0,
    });
  });
});

describe("traits", () => {
  it("accept at most two distinct known traits", () => {
    expect(parseTraits(undefined)).toEqual({ ok: true, value: [] });
    expect(parseTraits(["sociable", "ambitious"])).toEqual({ ok: true, value: ["sociable", "ambitious"] });
    expect(parseTraits(["sociable", "sociable"]).ok).toBe(false);
    expect(parseTraits(["sociable", "creative", "organised"]).ok).toBe(false);
    expect(parseTraits(["grumpy"]).ok).toBe(false);
    expect(sanitizeStoredTraits(["creative", "retired-trait", "creative", "organised", "sociable"])).toEqual(["creative", "organised"]);
  });
});

describe("money and the café", () => {
  it("prices everything in whole cents and formats euros", () => {
    for (const item of CAFE_MENU) expect(Number.isInteger(item.priceCents) && item.priceCents > 0, item.id).toBe(true);
    expect(formatEuros(450)).toBe("€4.50");
    expect(formatEuros(10_000)).toBe("€100.00");
    expect(formatEuros(-150)).toBe("−€1.50");
    expect(findMenuItem("panino")?.priceCents).toBe(450);
    expect(findMenuItem("caviar")).toBeNull();
  });

  it("never allows spending more than the balance", () => {
    expect(canAfford(450, 450)).toBe(true);
    expect(canAfford(449, 450)).toBe(false);
    expect(canAfford(500, -1)).toBe(false);
    expect(canAfford(4.5, 4)).toBe(false); // amounts are whole cents
  });

  it("lets the daily allowance cover at least half a day of food (money matters without being punishing)", () => {
    // Since M7 the allowance is halved and wages make up the rest (see work.test.ts).
    const hungerPerGameDay = -NEEDS_CONFIG.perGameHour.hunger * 24;
    const panino = findMenuItem("panino")!;
    const costPerDay = (hungerPerGameDay / panino.needs.hunger!) * panino.priceCents;
    expect(ECONOMY_CONFIG.dailyAllowanceCents).toBeGreaterThanOrEqual(costPerDay / 2);
  });

  it("accepts only safe request ids", () => {
    expect(isValidRequestId("a1b2c3d4-e5f6")).toBe(true);
    expect(isValidRequestId("short")).toBe(false);
    expect(isValidRequestId("has space 1234")).toBe(false);
  });
});

describe("action effects", () => {
  it("resolve timed actions and café items, and nothing else", () => {
    expect(timedEffectFor("study")).toMatchObject({ key: "study", activity: "studying", skills: { academic: 20 }, focus: true });
    expect(timedEffectFor("buy", "panino")).toMatchObject({ key: "consume", activity: "eating", needs: { hunger: 45 }, durationMs: 15_000 });
    expect(timedEffectFor("buy", "espresso")).toMatchObject({ activity: "drinking", moodEvent: "caffeine_boost" });
    expect(timedEffectFor("buy", "caviar")).toBeNull();
    expect(timedEffectFor("buy")).toBeNull();
    expect(timedEffectFor("sit")).toBeNull();
  });

  it("give a proportional share when stopped early", () => {
    expect(effectPortion(ACTION_EFFECTS.study, 0.5)).toEqual({ needs: { energy: -3, fun: -2 }, skills: { academic: 10 } });
    expect(effectPortion(ACTION_EFFECTS.study, 2)).toEqual(effectPortion(ACTION_EFFECTS.study, 1));
  });

  it("halve the greeter's social gain when grubby", () => {
    expect(greetingEffect("greeter", all(50)).needs.social).toBe(15);
    expect(greetingEffect("greeter", { ...all(50), hygiene: 10 }).needs.social).toBe(7.5);
    expect(greetingEffect("greeted", { ...all(50), hygiene: 10 })).toMatchObject({ needs: { social: 10 }, moodEvent: "someone_said_hello" });
  });
});
