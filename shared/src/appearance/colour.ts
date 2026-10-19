// Colour maths for appearance: continuous skin tones with undertones, and
// colours derived from them (lips, blush, shading, freckles). Interpolation
// happens in OKLab, a perceptual colour space, so steps along the tone slider
// look even and never pass through grey or oversaturated in-between colours.
// Pure functions shared by the renderer and the creator UI.

import type { Undertone } from "./catalogue.ts";

export interface Oklab {
  L: number;
  a: number;
  b: number;
}

/**
 * Named points along the skin-tone slider (0 = very fair, 1 = deep brown).
 * The slider is continuous; these anchors define the curve and give the UI
 * its labels. Tuned to stay readable under the game's toon lighting.
 */
export const SKIN_TONE_STOPS = [
  { at: 0.0, label: "Very fair", colour: "#f8e3d6" },
  { at: 0.125, label: "Fair", colour: "#f1d0ba" },
  { at: 0.25, label: "Light", colour: "#e7bc9b" },
  { at: 0.375, label: "Medium", colour: "#d6a27c" },
  { at: 0.5, label: "Olive", colour: "#c09466" },
  { at: 0.625, label: "Tan", colour: "#ab754c" },
  { at: 0.75, label: "Brown", colour: "#8a5738" },
  { at: 0.875, label: "Dark brown", colour: "#673e28" },
  { at: 1.0, label: "Deep brown", colour: "#45291b" },
] as const;

/** Undertone shifts in OKLab (a: green→red, b: blue→yellow). */
const UNDERTONE_SHIFT: Record<Undertone, { a: number; b: number }> = {
  cool: { a: 0.012, b: -0.014 },
  neutral: { a: 0, b: 0 },
  warm: { a: 0.004, b: 0.016 },
};

export function hexToRgb(hex: string): [number, number, number] {
  const value = Number.parseInt(hex.replace("#", ""), 16);
  return [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255];
}

export function rgbToHex([r, g, b]: [number, number, number]): string {
  const to = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, "0");
  return `#${to(r)}${to(g)}${to(b)}`;
}

const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toSrgb = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

export function hexToOklab(hex: string): Oklab {
  const [r, g, b] = hexToRgb(hex).map(toLinear) as [number, number, number];
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return {
    L: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  };
}

export function oklabToHex({ L, a, b }: Oklab): string {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const r = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  const g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const bl = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;
  return rgbToHex([toSrgb(r), toSrgb(g), toSrgb(bl)]);
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Mixes two hex colours in OKLab (t = 0 → a, 1 → b). */
export function mixHex(a: string, b: string, t: number): string {
  const x = hexToOklab(a);
  const y = hexToOklab(b);
  return oklabToHex({ L: lerp(x.L, y.L, t), a: lerp(x.a, y.a, t), b: lerp(x.b, y.b, t) });
}

/** Lightens (positive) or darkens (negative) a colour by an OKLab lightness amount. */
export function shadeHex(hex: string, deltaL: number): string {
  const c = hexToOklab(hex);
  return oklabToHex({ ...c, L: Math.min(1, Math.max(0, c.L + deltaL)) });
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** The skin colour for a tone (0–1) and undertone. Same colour for every body part (D-030). */
export function skinColour(tone: number, undertone: Undertone): string {
  const t = clamp01(Number.isFinite(tone) ? tone : 0.5);
  let i = 0;
  while (i < SKIN_TONE_STOPS.length - 2 && t > SKIN_TONE_STOPS[i + 1]!.at) i++;
  const from = SKIN_TONE_STOPS[i]!;
  const to = SKIN_TONE_STOPS[i + 1]!;
  const local = (t - from.at) / (to.at - from.at);
  const x = hexToOklab(from.colour);
  const y = hexToOklab(to.colour);
  const shift = UNDERTONE_SHIFT[undertone] ?? UNDERTONE_SHIFT.neutral;
  return oklabToHex({ L: lerp(x.L, y.L, local), a: lerp(x.a, y.a, local) + shift.a, b: lerp(x.b, y.b, local) + shift.b });
}

/** Label of the nearest named tone, for the UI ("Olive", "Dark brown"…). */
export function skinToneLabel(tone: number): string {
  let best: (typeof SKIN_TONE_STOPS)[number] = SKIN_TONE_STOPS[0];
  for (const stop of SKIN_TONE_STOPS) if (Math.abs(stop.at - tone) < Math.abs(best.at - tone)) best = stop;
  return best.label;
}

/** Natural lip colour from the skin: a little rosier and darker than the skin itself. */
export function lipColour(skin: string): string {
  return shadeHex(mixHex(skin, "#b4505f", 0.32), -0.05);
}

/** Soft cheek blush. */
export function blushColour(skin: string): string {
  return mixHex(skin, "#e26a78", 0.55);
}

/** Line and shadow colour for nose shading, freckles and creases. */
export function skinShadeColour(skin: string, amount = 0.12): string {
  return shadeHex(skin, -amount);
}

/** Eyebrow colour: the hair colour, slightly deeper so brows read on light hair too. */
export function browColour(hair: string): string {
  return shadeHex(hair, -0.08);
}
