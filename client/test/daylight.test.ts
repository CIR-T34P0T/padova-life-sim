// Day and night (M7b, D-037): the district's light as a pure function of the
// server's game minute. Checked minute by minute over a whole day.

import { describe, expect, it } from "vitest";
import {
  KEYS,
  MOON_DIRECTION,
  SUNRISE_MINUTE,
  SUNSET_MINUTE,
  daylightAt,
  luminance,
  minuteOfDay,
  phaseOf,
  sunDirection,
  sunIsUp,
  type Daylight,
} from "../src/render/world/daylight.ts";
import { P } from "../src/render/world/palette.ts";

const at = (h: number, m = 0) => h * 60 + m;
const everyMinute = Array.from({ length: 1440 }, (_, m) => m);
const channels = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
const COLOURS = ["lightColour", "ambientSky", "ambientGround", "skyTop", "skyMid", "skyHorizon", "haze", "clouds"] as const;
const NUMBERS = ["lightIntensity", "ambientIntensity", "hazeNear", "hazeFar", "lamps", "stars", "moon", "characterLift"] as const;

describe("the light follows the game clock", () => {
  it("depends only on the minute of the day: same minute, same light, on any day", () => {
    for (const m of [0, at(6, 20), at(12), at(19, 50), at(23, 59)]) {
      expect(daylightAt(m)).toEqual(daylightAt(m));
      expect(daylightAt(m + 1440 * 3)).toEqual(daylightAt(m));
      expect(daylightAt(m - 1440)).toEqual(daylightAt(m));
    }
    expect(minuteOfDay(-30)).toBe(1410);
    expect(minuteOfDay(1440 + 480.5)).toBe(480.5);
  });

  it("names the phases of the day", () => {
    expect(phaseOf(at(3))).toBe("night");
    expect(phaseOf(at(6, 10))).toBe("dawn");
    expect(phaseOf(at(12))).toBe("day");
    expect(phaseOf(at(19, 45))).toBe("dusk");
    expect(phaseOf(at(22))).toBe("night");
  });

  it("changes smoothly: no jumps from one game minute to the next, midnight included", () => {
    for (const m of everyMinute) {
      const a = daylightAt(m);
      const b = daylightAt(m + 1);
      for (const key of COLOURS) {
        const ca = channels(a[key]);
        const cb = channels(b[key]);
        for (let i = 0; i < 3; i++) expect(Math.abs(ca[i]! - cb[i]!), `${key} at minute ${m}`).toBeLessThan(0.04);
      }
      for (const key of NUMBERS) {
        const scale = key === "hazeNear" || key === "hazeFar" ? 30 : 1;
        expect(Math.abs(a[key] - b[key]) / scale, `${key} at minute ${m}`).toBeLessThan(0.05);
      }
      const turn = Math.acos(Math.min(1, a.light.x * b.light.x + a.light.y * b.light.y + a.light.z * b.light.z));
      // Under 4° per game minute (6 real seconds at the default clock): shadows creep, never jump.
      expect(turn, `light direction at minute ${m}`).toBeLessThan(0.07);
    }
  });

  it("keeps the key table sorted within one day", () => {
    for (let k = 1; k < KEYS.length; k++) expect(KEYS[k]![0]).toBeGreaterThan(KEYS[k - 1]![0]);
    expect(KEYS[0]![0]).toBe(0);
    expect(KEYS.at(-1)![0]).toBeLessThan(1440);
  });
});

describe("the sun and the moon", () => {
  it("rises in the east, crosses the south at midday and sets in the west", () => {
    expect(sunDirection(at(8)).x).toBeGreaterThan(0.5);
    const noon = sunDirection((SUNRISE_MINUTE + SUNSET_MINUTE) / 2);
    expect(Math.abs(noon.x)).toBeLessThan(0.01);
    expect(noon.z).toBeGreaterThan(0);
    expect(noon.y).toBeCloseTo(Math.sin((62 * Math.PI) / 180), 5);
    expect(sunDirection(at(18)).x).toBeLessThan(-0.5);
    expect(sunIsUp(at(6))).toBe(false);
    expect(sunIsUp(at(12))).toBe(true);
    expect(sunIsUp(at(20))).toBe(false);
  });

  it("always lights from above, never from below the horizon, as a unit vector", () => {
    for (const m of everyMinute) {
      const { light } = daylightAt(m);
      expect(Math.hypot(light.x, light.y, light.z)).toBeCloseTo(1, 6);
      expect(light.y, `minute ${m}`).toBeGreaterThanOrEqual(Math.sin((14 * Math.PI) / 180) - 1e-9);
    }
  });

  it("is moonlight at night, from where the moon is drawn", () => {
    const night = daylightAt(at(1));
    expect(night.moon).toBe(1);
    expect(night.light.x).toBeCloseTo(MOON_DIRECTION.x, 6);
    expect(night.light.y).toBeCloseTo(MOON_DIRECTION.y, 6);
    expect(night.light.z).toBeCloseTo(MOON_DIRECTION.z, 6);
    expect(daylightAt(at(12)).moon).toBe(0);
  });
});

describe("what the player sees", () => {
  it("reproduces the world art pass's afternoon at 16:00", () => {
    const d = daylightAt(at(16));
    expect(d).toMatchObject({
      lightColour: "#ffe6c2",
      lightIntensity: 2.35,
      ambientSky: "#fff1dc",
      ambientGround: "#8a755f",
      ambientIntensity: 1.55,
      skyTop: P.skyTop,
      skyMid: P.skyMid,
      skyHorizon: P.skyHorizon,
      haze: P.haze,
      hazeNear: 55,
      hazeFar: 150,
      lamps: 0,
      stars: 0,
    });
  });

  it("turns the lamps on whenever the sun is down, and off in full daylight", () => {
    for (const m of everyMinute) {
      const d = daylightAt(m);
      if (!sunIsUp(m)) expect(d.lamps, `minute ${m}`).toBeGreaterThan(0.3);
      if (m >= at(7, 30) && m <= at(18, 30)) expect(d.lamps, `minute ${m}`).toBe(0);
      if (m >= at(21, 30) || m <= at(5)) expect(d.lamps, `minute ${m}`).toBe(1);
    }
  });

  it("shows stars only at night and never by day", () => {
    expect(daylightAt(at(0)).stars).toBe(1);
    for (let m = at(6, 30); m <= at(19, 30); m++) expect(daylightAt(m).stars).toBe(0);
  });

  it("keeps the square readable at night: ambient light stays bright enough and characters get a lift", () => {
    const day = daylightAt(at(12));
    const ambient = (d: Daylight) => d.ambientIntensity * luminance(d.ambientSky);
    for (const m of everyMinute) {
      const d = daylightAt(m);
      // The soft fill never drops below 55 % of midday's, so shapes and faces keep their shading.
      expect(ambient(d) / ambient(day), `minute ${m}`).toBeGreaterThan(0.55);
      // In the dark, characters are lifted in proportion to how dark it is.
      if (d.lamps === 1) expect(d.characterLift).toBeGreaterThanOrEqual(0.15);
    }
    expect(day.characterLift).toBe(0);
  });

  it("darkens the sky at night and brightens it by day", () => {
    expect(luminance(daylightAt(at(0)).skyTop)).toBeLessThan(0.1);
    expect(luminance(daylightAt(at(12)).skyTop)).toBeGreaterThan(0.6);
    expect(luminance(daylightAt(at(0)).haze)).toBeLessThan(luminance(daylightAt(at(12)).haze));
  });
});
