// Day and night (M7b, D-037): the light of the district as a pure function of
// the server's game minute (D-021), so every player sees the same time of day.
// No WebGL, no DOM: worldScene.ts applies the result, and client/test checks it
// in Node. Presentation only: no gameplay rule reads it (it lives in the
// client, which shared/ and server/ never import).
//
// The day is a table of key moments (KEYS); between two keys every colour and
// number is interpolated, so the light changes smoothly. The sun's direction
// follows its own path (east → south → west); at night a cool moonlight comes
// from the south-east. 16:00 reproduces the fixed afternoon of the world art
// pass (D-033), so the district looks the same at that hour as before.

/** Minute of the day (0–1439) when the sun rises and sets (no seasons). */
export const SUNRISE_MINUTE = 6 * 60 + 15;
export const SUNSET_MINUTE = 19 * 60 + 45;
/** Highest the sun climbs (degrees above the horizon) at midday. */
const SUN_MAX_ELEVATION = 62;
/**
 * The light never comes from lower than this (degrees): a sun on the horizon
 * would light nothing but stretch shadows across the whole square. Its colour
 * and strength still say "sunrise" or "sunset".
 */
const MIN_LIGHT_ELEVATION = 14;
/** Where the moonlight comes from: south-east, about 37° up. Also where the moon is drawn. */
export const MOON_DIRECTION = normalise({ x: 0.45, y: 0.6, z: 0.66 });

export type DayPhase = "night" | "dawn" | "day" | "dusk";

/** Everything the renderer needs to light the district at one moment. Colours are "#rrggbb". */
export interface Daylight {
  /** Minute of the day, 0–1439 (fractional). */
  minute: number;
  phase: DayPhase;
  /** Unit vector pointing towards the light: the sun by day, the moon by night (y > 0 always). */
  light: { x: number; y: number; z: number };
  lightColour: string;
  lightIntensity: number;
  /** Sky and ground colours of the soft ambient (hemisphere) light. */
  ambientSky: string;
  ambientGround: string;
  ambientIntensity: number;
  /** Sky dome: zenith, middle band and horizon. The page background uses the horizon. */
  skyTop: string;
  skyMid: string;
  skyHorizon: string;
  /** Distance haze colour and range (metres). */
  haze: string;
  hazeNear: number;
  hazeFar: number;
  /** Tint multiplied into the clouds. */
  clouds: string;
  /** 0–1: street lamps, lanterns, lit windows and the pools of lamplight. */
  lamps: number;
  /** 0–1: stars and the moon. */
  stars: number;
  /** 0–1: how much of the light is moonlight (the light direction blends from sun to moon). */
  moon: number;
  /**
   * A little self-light added to characters (fraction of their own colour) so
   * they stay as easy to see at night as by day.
   */
  characterLift: number;
}

type KeyValues = Omit<Daylight, "minute" | "phase" | "light">;

const NIGHT: KeyValues = {
  lightColour: "#b8c8ff",
  lightIntensity: 0.62,
  ambientSky: "#a3b4e6",
  ambientGround: "#34324a",
  ambientIntensity: 1.22,
  skyTop: "#0c1734",
  skyMid: "#1a2a52",
  skyHorizon: "#33406a",
  haze: "#2a3352",
  hazeNear: 45,
  hazeFar: 140,
  clouds: "#3a4466",
  lamps: 1,
  stars: 1,
  moon: 1,
  characterLift: 0.2,
};

const DAY: KeyValues = {
  lightColour: "#fff0d8",
  lightIntensity: 2.3,
  ambientSky: "#fff3e2",
  ambientGround: "#8a755f",
  ambientIntensity: 1.55,
  skyTop: "#7db4df",
  skyMid: "#b5d4ea",
  skyHorizon: "#f1e3c8",
  haze: "#e7dccb",
  hazeNear: 55,
  hazeFar: 150,
  clouds: "#ffffff",
  lamps: 0,
  stars: 0,
  moon: 0,
  characterLift: 0,
};

/** The fixed afternoon of the world art pass (D-033): sky and haze from the palette, the old sun and fill. */
const AFTERNOON: KeyValues = {
  ...DAY,
  lightColour: "#ffe6c2",
  lightIntensity: 2.35,
  ambientSky: "#fff1dc",
  ambientGround: "#8a755f",
  ambientIntensity: 1.55,
};

/** Key moments of the day: [minute of the day, values]. Sorted; the table wraps at midnight. */
export const KEYS: readonly (readonly [number, KeyValues])[] = [
  [0, NIGHT],
  [5 * 60, { ...NIGHT, skyHorizon: "#3a466e" }],
  // Blue hour before sunrise: the sky lightens, the lamps are still on.
  [5 * 60 + 45, { ...NIGHT, lightIntensity: 0.6, ambientSky: "#b4bde0", ambientGround: "#4a4552", ambientIntensity: 1.22, skyTop: "#2f4778", skyMid: "#6a7aa6", skyHorizon: "#d9a48a", haze: "#6f6f8c", clouds: "#8a8aa6", stars: 0.3, moon: 0.9, characterLift: 0.16 }],
  // Sunrise.
  [6 * 60 + 30, { ...DAY, lightColour: "#ffc08a", lightIntensity: 1.5, ambientSky: "#ffe2c4", ambientGround: "#75604f", ambientIntensity: 1.35, skyTop: "#6f97c9", skyMid: "#c4c3cf", skyHorizon: "#f6c08e", haze: "#e8cdb2", clouds: "#ffd9c4", lamps: 0.2, characterLift: 0.04 }],
  [7 * 60 + 30, DAY],
  [12 * 60, { ...DAY, lightColour: "#fff4e4", lightIntensity: 2.4 }],
  [16 * 60, AFTERNOON],
  // Golden hour.
  [18 * 60 + 30, { ...DAY, lightColour: "#ffc27e", lightIntensity: 1.9, ambientSky: "#ffe6c8", ambientGround: "#86705a", ambientIntensity: 1.45, skyTop: "#6f9fd2", skyMid: "#e2c9b0", skyHorizon: "#f7c48e", haze: "#ecd3b4", clouds: "#ffe2c8" }],
  // Sunset: the lamps come on.
  [19 * 60 + 30, { ...DAY, lightColour: "#ff9a64", lightIntensity: 1.0, ambientSky: "#f6c8b4", ambientGround: "#6d5868", ambientIntensity: 1.25, skyTop: "#4b6aa8", skyMid: "#c99aa4", skyHorizon: "#f09a72", haze: "#d9a891", clouds: "#f2b8a0", lamps: 0.6, moon: 0.1, characterLift: 0.12 }],
  // Blue hour after sunset.
  [20 * 60 + 30, { ...NIGHT, lightColour: "#b4c4ff", lightIntensity: 0.58, ambientSky: "#a6b6e6", ambientGround: "#3a3650", ambientIntensity: 1.2, skyTop: "#1c2c5c", skyMid: "#3c4a7e", skyHorizon: "#7e6f96", haze: "#4a4f74", clouds: "#5a5a80", stars: 0.6 }],
  [21 * 60 + 30, NIGHT],
];

const MINUTES_PER_DAY = 1440;

/** Minute of the day (0 ≤ m < 1440) of any game minute, fractional. */
export function minuteOfDay(gameMinute: number): number {
  return ((gameMinute % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
}

/** The light of the district at a game minute. Same minute, same light: on every client. */
export function daylightAt(gameMinute: number): Daylight {
  const minute = minuteOfDay(gameMinute);
  const values = interpolate(minute);
  const sun = sunDirection(minute);
  const blended = normalise({
    x: sun.x * (1 - values.moon) + MOON_DIRECTION.x * values.moon,
    y: sun.y * (1 - values.moon) + MOON_DIRECTION.y * values.moon,
    z: sun.z * (1 - values.moon) + MOON_DIRECTION.z * values.moon,
  });
  return { minute, phase: phaseOf(minute), light: blended, ...values };
}

/** Night until dawn begins, dawn until 07:30, day until 18:30, dusk until 21:30. */
export function phaseOf(minute: number): DayPhase {
  const m = minuteOfDay(minute);
  if (m >= 5 * 60 + 15 && m < 7 * 60 + 30) return "dawn";
  if (m >= 7 * 60 + 30 && m < 18 * 60 + 30) return "day";
  if (m >= 18 * 60 + 30 && m < 21 * 60 + 30) return "dusk";
  return "night";
}

/**
 * Unit vector towards the sun: rises in the east (+x), crosses the south (+z)
 * at midday and sets in the west (−x). Never lower than MIN_LIGHT_ELEVATION
 * (so before sunrise and after sunset it rests just above the horizon).
 */
export function sunDirection(minute: number): { x: number; y: number; z: number } {
  const p = clamp((minuteOfDay(minute) - SUNRISE_MINUTE) / (SUNSET_MINUTE - SUNRISE_MINUTE), 0, 1);
  const elevation = Math.max(MIN_LIGHT_ELEVATION, SUN_MAX_ELEVATION * Math.sin(Math.PI * p)) * (Math.PI / 180);
  const azimuth = Math.PI * p; // 0 = east, π/2 = south, π = west
  const horizontal = Math.cos(elevation);
  return { x: Math.cos(azimuth) * horizontal, y: Math.sin(elevation), z: Math.sin(azimuth) * horizontal };
}

/** True while the sun is above the horizon (between sunrise and sunset). */
export function sunIsUp(minute: number): boolean {
  const m = minuteOfDay(minute);
  return m > SUNRISE_MINUTE && m < SUNSET_MINUTE;
}

/** Relative brightness (0–1) of a "#rrggbb" colour, for checks. */
export function luminance(hex: string): number {
  const [r, g, b] = toRgb(hex);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function interpolate(minute: number): KeyValues {
  let index = KEYS.length - 1;
  for (let k = 0; k < KEYS.length; k++) if (KEYS[k]![0] <= minute) index = k;
  const [m0, a] = KEYS[index]!;
  const [m1raw, b] = KEYS[(index + 1) % KEYS.length]!;
  const m1 = m1raw <= m0 ? m1raw + MINUTES_PER_DAY : m1raw;
  const t = smooth((minute - m0) / (m1 - m0));
  const out = {} as Record<string, string | number>;
  for (const key of Object.keys(a) as (keyof KeyValues)[]) {
    const from = a[key];
    const to = b[key];
    out[key] = typeof from === "string" ? mixHex(from, to as string, t) : from + ((to as number) - from) * t;
  }
  return out as unknown as KeyValues;
}

/** Eases in and out of each key, so changes never start or stop abruptly. */
const smooth = (t: number) => {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
};

function mixHex(a: string, b: string, t: number): string {
  const ca = toRgb(a);
  const cb = toRgb(b);
  return `#${ca.map((v, i) => Math.round((v + (cb[i]! - v) * t) * 255).toString(16).padStart(2, "0")).join("")}`;
}

function toRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

function normalise(v: { x: number; y: number; z: number }) {
  const length = Math.hypot(v.x, v.y, v.z) || 1;
  return { x: v.x / length, y: v.y / length, z: v.z / length };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
