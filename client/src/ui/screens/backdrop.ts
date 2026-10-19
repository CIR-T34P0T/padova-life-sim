// The title screen's key visual, drawn in code for this game: a deep blue
// sky scattered with gold eight-pointed stars (after the starry fresco
// ceilings Padua is famous for, not a copy of any painting) above an
// evening row of porticoes with lit arches, a bell tower, domes and a
// keel-shaped roof. Generic shapes only; no real building is reproduced.

import { starPath } from "./icons.ts";

function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Gold stars on a transparent background (the sky colour comes from CSS). */
export function starrySkySvg(count = 46, seed = 7): string {
  const rng = seeded(seed);
  const stars: string[] = [];
  for (let i = 0; i < count; i++) {
    const x = rng() * 1000;
    const y = Math.pow(rng(), 1.3) * 520;
    const r = 3 + rng() * rng() * 11;
    // Still on purpose: animating stars inside this full-screen, masked layer
    // repainted it every frame (measured: ~1.9 cores with software rendering
    // versus 0.1 still), which costs phones battery for no gameplay value.
    stars.push(`<path d="${starPath(x, y, r)}" opacity="${(0.55 + rng() * 0.45).toFixed(2)}"/>`);
  }
  return `<svg class="sky-stars" viewBox="0 0 1000 600" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false"><g fill="var(--gold)">${stars.join("")}</g></svg>`;
}

/** The skyline band, bottom-aligned; scales to the width and crops at the sides on narrow screens. */
export function porticoesSvg(): string {
  const far: string[] = [];
  // Rooftops behind.
  far.push(`<path d="M0 190 L70 176 L140 188 L170 168 L230 172 L230 150 L320 150 L330 176 L420 170 L480 184 L560 166 L600 172 L600 320 L0 320Z"/>`);
  // Bell tower with a pointed roof and belfry openings.
  far.push(`<rect x="236" y="54" width="50" height="270"/><path d="M230 58 L261 8 L292 58Z"/>`);
  // Keel-shaped roof over a long hall.
  far.push(`<path d="M600 320 V176 H612 Q735 92 858 176 H870 V320Z"/>`);
  // A cluster of domes with small lanterns.
  for (const [cx, r] of [[1010, 38], [1078, 52], [1146, 38]] as const) {
    const base = 186;
    far.push(`<rect x="${cx - r}" y="${base}" width="${r * 2}" height="${320 - base}"/>`);
    far.push(`<path d="M${cx - r} ${base} A${r} ${r * 1.05} 0 0 1 ${cx + r} ${base}Z"/>`);
    far.push(`<rect x="${cx - 5}" y="${base - r * 1.05 - 16}" width="10" height="18"/><path d="M${cx - 7} ${base - r * 1.05 - 14} L${cx} ${base - r * 1.05 - 32} L${cx + 7} ${base - r * 1.05 - 14}Z"/>`);
  }
  far.push(`<path d="M870 320 V182 L940 176 L960 190 L1200 190 L1260 172 L1330 180 L1440 170 V320Z"/>`);

  // Front: a long arcaded street with an uneven roofline.
  const front: string[] = [];
  const blocks = [
    [0, 160], [180, 146], [350, 166], [520, 140], [730, 158], [900, 148], [1080, 164], [1250, 144], [1440, 0],
  ] as const;
  let roof = "M0 320";
  for (let i = 0; i < blocks.length - 1; i++) {
    const [x, y] = blocks[i]!;
    const [nx] = blocks[i + 1]!;
    roof += ` L${x} ${y} L${nx} ${y}`;
  }
  roof += " L1440 320Z";
  front.push(`<path class="portico-front" d="${roof}"/>`);
  front.push(`<rect class="portico-cornice" x="0" y="226" width="1440" height="7"/>`);

  const arches: string[] = [];
  const windows: string[] = [];
  const rng = seeded(11);
  const archWidth = 58;
  const pillar = 18;
  for (let x = 6; x + archWidth < 1440; x += archWidth + pillar) {
    const r = archWidth / 2;
    arches.push(`<path d="M${x} 320 V${262} A${r} ${r} 0 0 1 ${x + archWidth} ${262} V320Z"/>`);
  }
  for (let x = 14; x < 1430; x += 38) {
    for (const y of [176, 198]) {
      if (rng() < 0.18) continue;
      const lit = rng() < 0.42;
      windows.push(`<rect x="${x}" y="${y}" width="12" height="16" rx="2" class="${lit ? "window-lit" : "window-dark"}"/>`);
    }
  }

  return `<svg class="porticoes" viewBox="0 0 1440 320" preserveAspectRatio="xMidYMax slice" aria-hidden="true" focusable="false">
  <defs>
    <linearGradient id="arch-glow" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ffd27e" stop-opacity="0.95"/>
      <stop offset="1" stop-color="#ff8a3d" stop-opacity="0.95"/>
    </linearGradient>
  </defs>
  <g class="portico-far">${far.join("")}</g>
  <g>${front.join("")}</g>
  <g fill="url(#arch-glow)">${arches.join("")}</g>
  <g>${windows.join("")}</g>
</svg>`;
}
