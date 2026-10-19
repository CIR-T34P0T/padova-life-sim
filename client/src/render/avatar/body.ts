// Body and clothing geometry (D-030): torso, arms and legs as tubes whose
// vertex colours paint skin and garments, with extra shells where a garment
// changes the silhouette (sleeves, skirts, jackets, hoods, wide trousers,
// shoes). Each moving part is built in its own space, so the rig can pose
// it, and is merged into one mesh per part by the avatar.
//
//   torso  figure space (origin on the ground, +Z forward)
//   arm    origin at the shoulder joint, hanging along -Y
//   thigh  origin at the hip joint, along -Y to the knee
//   shin   origin at the knee, along -Y to the ankle, plus the foot

import * as THREE from "three";
import { mixHex, shadeHex, type AppearanceConfig, type VisibleLayers } from "@padova/shared";
import { clamp, ellipsoid, lerp, paintWith, rgb, ringTube, smoothstep, standardise, sweep, type Ring } from "./geometry.ts";
import type { BodyMetrics } from "./metrics.ts";

/** A piece of geometry and how it is drawn. */
export interface Piece {
  geometry: THREE.BufferGeometry;
  /** "pattern" pieces use the garment's pattern texture instead of vertex colours. */
  material: "colour" | "pattern";
  /** Only shown standing or only seated (skirts and coats change shape when sitting). */
  pose: "always" | "standing" | "seated";
}

const always = (geometry: THREE.BufferGeometry, material: Piece["material"] = "colour"): Piece => ({ geometry, material, pose: "always" });

/** Resolved garment facts shared by every body part. */
export interface Outfit {
  skin: string;
  /** Colour of the top or of the full outfit. */
  top: string;
  bottom: string;
  outer: string | null;
  shoes: string;
  patterned: boolean;
  /** Which top is drawn: a full outfit counts as its own top. */
  topKind: "tee" | "tank" | "shirt" | "hoodie" | "sweater" | "dress" | "maxi-dress" | "jumpsuit";
  bottomKind: "jeans" | "trousers" | "shorts" | "skirt" | "long-skirt" | "dress" | "maxi-dress" | "jumpsuit";
  outerKind: "none" | "denim-jacket" | "blazer" | "cardigan" | "coat";
  sleeve: number;
  /** Rigid skirt hem height (figure y) while standing, or null. */
  skirtHem: number | null;
  /** How far walking legs may swing (long skirts shorten the stride). */
  stride: number;
}

export function resolveOutfit(config: AppearanceConfig, layers: VisibleLayers, skin: string, colourOf: (id: string) => string, metrics: BodyMetrics): Outfit {
  const o = config.outfit;
  const full = !layers.topAndBottom;
  const topKind = (full ? o.full : o.top) as Outfit["topKind"];
  const bottomKind = (full ? o.full : o.bottom) as Outfit["bottomKind"];
  const sleeves: Record<Outfit["topKind"], number> = {
    tank: 0,
    dress: 0,
    tee: 0.38,
    "maxi-dress": 0.3,
    jumpsuit: 0.32,
    shirt: 0.93,
    hoodie: 0.93,
    sweater: 0.93,
  };
  const hems: Partial<Record<Outfit["bottomKind"], number>> = {
    skirt: metrics.kneeY + 0.07,
    dress: metrics.kneeY + 0.03,
    "long-skirt": metrics.ankleY + 0.05,
    "maxi-dress": metrics.ankleY + 0.04,
  };
  const skirtHem = hems[bottomKind] ?? null;
  return {
    skin,
    top: colourOf(o.topColour),
    bottom: full ? colourOf(o.topColour) : colourOf(o.bottomColour),
    outer: o.outer === "none" ? null : colourOf(o.outerColour),
    shoes: colourOf(o.shoesColour),
    patterned: o.pattern !== "plain",
    topKind,
    bottomKind,
    outerKind: o.outer,
    sleeve: sleeves[topKind] ?? 0.4,
    skirtHem,
    stride: bottomKind === "long-skirt" || bottomKind === "maxi-dress" ? 0.55 : skirtHem !== null ? 0.8 : o.outer === "coat" ? 0.85 : 1,
  };
}

// ── Torso ───────────────────────────────────────────────────────────────────

interface TorsoProfile {
  rings: Ring[];
  /** Half-width and half-depth of the torso at a height (for shells and overlays). */
  at: (y: number) => { rx: number; rz: number; cz: number };
}

function torsoProfile(m: BodyMetrics): TorsoProfile {
  const crotch = m.hipY - 0.075;
  const keys: [number, number, number, number][] = [
    // y, rx, rz, cz (forward shift for bust/belly)
    [crotch, m.hipHalfWidth * 0.62, m.hipHalfDepth * 0.7, 0],
    [m.hipY - 0.04, m.hipHalfWidth * 0.93, m.hipHalfDepth * 0.95, 0],
    [m.hipY, m.hipHalfWidth, m.hipHalfDepth, 0],
    [lerp(m.hipY, m.waistY, 0.55), lerp(m.hipHalfWidth, m.waistHalfWidth, 0.7), lerp(m.hipHalfDepth, m.waistHalfDepth, 0.6) + m.belly * 0.6, m.belly * 0.5],
    [m.waistY, m.waistHalfWidth, m.waistHalfDepth + m.belly, m.belly * 0.6],
    [lerp(m.waistY, m.chestY, 0.5), lerp(m.waistHalfWidth, m.chestHalfWidth, 0.6), lerp(m.waistHalfDepth, m.chestHalfDepth, 0.6) + m.belly * 0.4, m.belly * 0.3 + m.bust * 0.3],
    [m.chestY, m.chestHalfWidth, m.chestHalfDepth + m.bust * 0.5, m.bust * 0.55],
    [lerp(m.chestY, m.shoulderY, 0.45), lerp(m.chestHalfWidth, m.shoulderHalfWidth, 0.75), m.chestHalfDepth * 0.95 + m.bust * 0.2, m.bust * 0.2],
    [m.shoulderY - 0.028, m.shoulderHalfWidth * 0.92, m.chestHalfDepth * 0.82, 0],
    [m.shoulderY - 0.005, m.shoulderHalfWidth * 0.72, m.chestHalfDepth * 0.62, 0],
    [m.shoulderY + 0.012, m.neckRadius * 1.9, m.neckRadius * 1.5, 0],
    [m.shoulderY + 0.022, m.neckRadius * 1.05, m.neckRadius * 1.0, 0],
  ];
  const at = (y: number) => {
    if (y <= keys[0]![0]) return { rx: keys[0]![1], rz: keys[0]![2], cz: keys[0]![3] };
    for (let i = 1; i < keys.length; i++) {
      const [y1, rx1, rz1, cz1] = keys[i]!;
      if (y <= y1) {
        const [y0, rx0, rz0, cz0] = keys[i - 1]!;
        const t = (y - y0) / (y1 - y0);
        const s = t * t * (3 - 2 * t);
        return { rx: lerp(rx0, rx1, s), rz: lerp(rz0, rz1, s), cz: lerp(cz0, cz1, s) };
      }
    }
    const last = keys[keys.length - 1]!;
    return { rx: last[1], rz: last[2], cz: last[3] };
  };
  return { rings: [], at };
}

/** Rings from y0 to y1 with extra rings at the given heights (duplicated for hard colour edges). */
function ringsBetween(profile: TorsoProfile, y0: number, y1: number, steps: number, edges: number[], grow = 0): Ring[] {
  const ys = new Set<number>();
  for (let i = 0; i <= steps; i++) ys.add(lerp(y0, y1, i / steps));
  const sorted = [...ys, ...edges.filter((e) => e > y0 && e < y1)].sort((a, b) => a - b);
  const rings: Ring[] = [];
  for (const y of sorted) {
    const { rx, rz, cz } = profile.at(y);
    const ring = { y, rx: rx + grow, rz: rz + grow, cz };
    rings.push(ring);
    if (edges.includes(y)) rings.push({ ...ring });
  }
  return rings;
}

/** Garment colour on the torso at a height and angle (0 = front). */
function torsoColour(m: BodyMetrics, outfit: Outfit, y: number, angle: number, x: number): THREE.Color {
  const skin = rgb(outfit.skin);
  const top = rgb(outfit.top);
  const bottom = rgb(outfit.bottom);
  const a = Math.abs(((angle + Math.PI) % (Math.PI * 2)) - Math.PI);
  const kind = outfit.topKind;
  // Necklines.
  if (kind === "tank" || kind === "dress") {
    const scoop = a < 1.15 ? m.chestY + 0.05 : a > 2.1 ? m.chestY + 0.08 : m.shoulderY - 0.03;
    const strap = Math.abs(x) > m.neckRadius * 1.25 && Math.abs(x) < m.neckRadius * 1.25 + (kind === "dress" ? 0.045 : 0.03);
    if (y > scoop && !strap) return skin;
  } else if (kind === "maxi-dress") {
    if (a < 0.9 && y > m.chestY + 0.07) return skin;
  } else if (kind === "shirt" || kind === "jumpsuit") {
    const vBottom = m.shoulderY - 0.075;
    if (a < 0.42 * clamp((y - vBottom) / 0.075, 0, 1) && y > vBottom) return skin;
  }
  const waistTop = m.hipY + 0.075;
  const fullOutfit = kind === "dress" || kind === "maxi-dress" || kind === "jumpsuit";
  if (fullOutfit) {
    if (kind === "jumpsuit" && y > m.hipY + 0.05 && y < m.hipY + 0.072) return rgb(shadeHex(outfit.top, -0.12));
    if (kind !== "jumpsuit" && Math.abs(y - m.waistY) < 0.007) return rgb(shadeHex(outfit.top, -0.06));
    return top;
  }
  const hem = kind === "hoodie" || kind === "sweater" ? m.hipY - 0.01 : m.hipY + 0.035;
  if (y >= hem) {
    if ((kind === "hoodie" || kind === "sweater") && y < hem + 0.025) return rgb(shadeHex(outfit.top, -0.07));
    return top;
  }
  if (y > waistTop - 0.02 && y <= waistTop && (outfit.bottomKind === "jeans" || outfit.bottomKind === "shorts")) return rgb("#3a2a20");
  return bottom;
}

export function buildTorso(m: BodyMetrics, outfit: Outfit): Piece[] {
  const profile = torsoProfile(m);
  const pieces: Piece[] = [];
  const crotch = m.hipY - 0.075;
  const top = m.shoulderY + 0.022;
  const hem = outfit.topKind === "hoodie" || outfit.topKind === "sweater" ? m.hipY - 0.01 : m.hipY + 0.035;
  const edges = [hem, m.hipY + 0.075, m.hipY + 0.055, hem + 0.025, m.hipY + 0.05, m.hipY + 0.072];
  // Neckline heights get hard colour edges too.
  if (outfit.topKind === "tank" || outfit.topKind === "dress") edges.push(m.chestY + 0.05, m.chestY + 0.08, m.shoulderY - 0.03);
  if (outfit.topKind === "maxi-dress") edges.push(m.chestY + 0.07);
  if (outfit.topKind === "dress" || outfit.topKind === "maxi-dress") edges.push(m.waistY - 0.007, m.waistY + 0.007);
  const rings = ringsBetween(profile, crotch, top, 26, edges);
  pieces.push(
    always(
      ringTube(rings, {
        segments: 40,
        capBottom: true,
        colour: (_r, angle, p) => torsoColour(m, outfit, p.y, angle, p.x),
      }),
    ),
  );
  // Neck, up into the head.
  const skin = rgb(outfit.skin);
  const neckShade = rgb(shadeHex(outfit.skin, -0.04));
  pieces.push(
    always(
      ringTube(
        [
          { y: m.shoulderY, rx: m.neckRadius * 1.08, rz: m.neckRadius * 1.02 },
          { y: m.chinY - 0.005, rx: m.neckRadius, rz: m.neckRadius * 0.95 },
          { y: m.chinY + 0.03, rx: m.neckRadius * 0.95, rz: m.neckRadius * 0.9, cz: -0.01 },
        ],
        { segments: 16, colour: (r) => (r === 1 ? neckShade : skin) },
      ),
    ),
  );

  // Pattern overlay on the top (or full outfit) body.
  if (outfit.patterned) {
    const patternTop = outfit.topKind === "tank" || outfit.topKind === "dress" ? m.chestY + 0.04 : outfit.topKind === "maxi-dress" ? m.chestY + 0.06 : m.shoulderY - 0.02;
    const patternBottom = outfit.topKind === "dress" || outfit.topKind === "maxi-dress" || outfit.topKind === "jumpsuit" ? m.hipY - 0.02 : hem + (outfit.topKind === "hoodie" || outfit.topKind === "sweater" ? 0.026 : 0.002);
    if (patternTop > patternBottom) {
      const overlay = ringsBetween(profile, patternBottom, patternTop, 14, [], 0.0018);
      pieces.push({ geometry: ringTube(overlay, { segments: 32 }), material: "pattern", pose: "always" });
    }
  }

  // Top details.
  const topShade = rgb(shadeHex(outfit.top, -0.08));
  if (outfit.topKind === "hoodie") {
    const hood: THREE.Vector3[] = [];
    for (let i = 0; i <= 12; i++) {
      const a = lerp(-2.0, 2.0, i / 12);
      const r = m.neckRadius * 1.9;
      hood.push(new THREE.Vector3(Math.sin(a + Math.PI) * r, m.shoulderY + 0.01 + 0.012 * Math.cos((a / 2) * Math.PI), Math.cos(a + Math.PI) * r * 1.15 - 0.005));
    }
    pieces.push(always(sweep(hood, { radial: 8, radius: (t) => 0.026 * (0.75 + 0.25 * Math.sin(t * Math.PI)), flatten: 1.3, colour: () => rgb(outfit.top), capStart: true, capEnd: true })));
    // Pocket and drawstrings.
    const pocketRings = ringsBetween(profile, m.hipY + 0.005, lerp(m.hipY, m.waistY, 0.85), 4, [], 0.004);
    pieces.push(always(ringTube(pocketRings, { segments: 6, arc: [-0.55, 0.55], colour: () => topShade })));
    for (const side of [-1, 1]) {
      const x = side * m.neckRadius * 0.7;
      const zTop = profile.at(m.shoulderY - 0.01).rz + 0.004;
      const zBottom = profile.at(m.chestY + 0.02).rz + profile.at(m.chestY + 0.02).cz + 0.008;
      pieces.push(always(sweep([new THREE.Vector3(x, m.shoulderY - 0.005, zTop), new THREE.Vector3(x * 1.1, m.chestY + 0.01, zBottom)], { radial: 4, radius: () => 0.0028, colour: () => rgb("#f2f0eb"), capEnd: true })));
    }
  } else if (outfit.topKind === "shirt") {
    // Placket, buttons and collar points.
    const placket = ringsBetween(profile, hem + 0.003, m.shoulderY - 0.075, 6, [], 0.0022);
    pieces.push(always(ringTube(placket, { segments: 2, arc: [-0.05, 0.05], colour: () => topShade })));
    for (let i = 0; i < 4; i++) {
      const y = lerp(m.shoulderY - 0.09, m.hipY + 0.06, i / 3);
      const r = profile.at(y);
      pieces.push(always(ellipsoid({ x: 0.0045, y: 0.0045, z: 0.002 }, { x: 0, y, z: r.cz + r.rz + 0.003 }, mixHex(outfit.top, "#ffffff", 0.5), { width: 8, height: 6 })));
    }
    for (const side of [-1, 1]) {
      const base = new THREE.Vector3(side * m.neckRadius * 1.05, m.shoulderY + 0.012, m.neckRadius * 0.85);
      const tip = new THREE.Vector3(side * m.neckRadius * 0.55, m.shoulderY - 0.035, profile.at(m.shoulderY - 0.035).rz + 0.006);
      pieces.push(always(sweep([base, base.clone().lerp(tip, 0.5).add(new THREE.Vector3(0, 0, 0.006)), tip], { radial: 4, radius: (t) => 0.013 * (1 - t * 0.7), flatten: 0.25, colour: () => rgb(outfit.top), capEnd: true })));
    }
  } else if (outfit.topKind === "sweater" || outfit.topKind === "tee") {
    const neckband = outfit.topKind === "sweater" ? 0.008 : 0.005;
    pieces.push(always(ringTube([
      { y: m.shoulderY + 0.006, rx: m.neckRadius * 1.5, rz: m.neckRadius * 1.3 },
      { y: m.shoulderY + 0.006 + neckband, rx: m.neckRadius * 1.25, rz: m.neckRadius * 1.15 },
    ], { segments: 18, colour: () => topShade })));
  }

  // Rigid skirt, dress skirt or coat tail while standing; leg-attached versions while seated (see legs).
  const waistTop = m.hipY + 0.075;
  if (outfit.skirtHem !== null) {
    const hemY = outfit.skirtHem;
    const long = outfit.bottomKind === "long-skirt" || outfit.bottomKind === "maxi-dress";
    const start = outfit.bottomKind === "dress" || outfit.bottomKind === "maxi-dress" ? m.waistY : waistTop;
    const flareX = long ? 1.55 : 1.42;
    const flareZ = long ? 2.0 : 1.75;
    const skirtRings: Ring[] = [];
    for (let i = 0; i <= 8; i++) {
      const t = i / 8;
      const y = lerp(start, hemY, t);
      const body = profile.at(Math.max(y, crotch));
      const fit = smoothstep(0, 0.35, t);
      skirtRings.push({
        y,
        rx: lerp(body.rx + 0.006, m.hipHalfWidth * flareX + 0.03, fit),
        rz: lerp(body.rz + 0.006, m.hipHalfDepth * flareZ + 0.05, fit),
        cz: lerp(body.cz, 0.01, t),
      });
    }
    const pleats = (_r: number, angle: number, y: number) => 0.004 * Math.sin(angle * 9) * smoothstep(start, hemY, y);
    const colour = outfit.bottomKind === "dress" || outfit.bottomKind === "maxi-dress" ? outfit.top : outfit.bottom;
    const patterned = outfit.patterned && (outfit.bottomKind === "dress" || outfit.bottomKind === "maxi-dress");
    const shade = rgb(shadeHex(colour, -0.05));
    pieces.push({
      geometry: ringTube(skirtRings, {
        segments: 36,
        displace: pleats,
        colour: (r, angle) => (r === 0 ? shade : Math.sin(angle * 9) < -0.6 ? shade : rgb(colour)),
      }),
      material: patterned ? "pattern" : "colour",
      pose: "standing",
    });
    pieces.push({ geometry: lapPanel(m, colour, Math.max(0.12, (start - hemY) - 0.12)), material: patterned ? "pattern" : "colour", pose: "seated" });
  }

  // Outerwear.
  if (outfit.outer && outfit.outerKind !== "none") pieces.push(...outerwear(m, outfit, profile));
  return pieces;
}

/** A panel over the lap for skirts and coats while seated (thighs point forward). */
function lapPanel(m: BodyMetrics, colour: string, length: number): THREE.BufferGeometry {
  const thighLength = m.hipY - m.kneeY;
  const depth = Math.min(thighLength + 0.03, length);
  const width = (m.legOffsetX + m.thighRadius) * 2 + 0.03;
  const geometry = new THREE.BoxGeometry(width, 0.02, depth, 1, 1, 1);
  geometry.translate(0, m.hipY + m.thighRadius * 0.75, depth / 2 - 0.02);
  return paint(geometry, colour);
}

const paint = (geometry: THREE.BufferGeometry, colour: string) => paintWith(standardise(geometry), () => rgb(colour));

function outerwear(m: BodyMetrics, outfit: Outfit, profile: TorsoProfile): Piece[] {
  const colour = outfit.outer!;
  const shade = rgb(shadeHex(colour, -0.08));
  const base = rgb(colour);
  const kind = outfit.outerKind;
  const pieces: Piece[] = [];
  const hem = kind === "denim-jacket" ? m.hipY + 0.05 : m.hipY - 0.07;
  const top = m.shoulderY + 0.002;
  // Front opening: narrow at the hem, a V at the chest for blazers and coats.
  const gap = (y: number) => {
    if (kind === "blazer" || kind === "coat") return lerp(0.16, 0.62, smoothstep(m.waistY, m.shoulderY - 0.02, y));
    if (kind === "cardigan") return lerp(0.2, 0.42, smoothstep(m.chestY, m.shoulderY, y));
    return lerp(0.14, 0.3, smoothstep(m.chestY, m.shoulderY, y));
  };
  const rings = ringsBetween(profile, hem, top, 16, [], 0.016);
  const lapel = kind === "blazer" || kind === "coat" ? 0.16 : kind === "cardigan" ? 0.07 : 0.05;
  pieces.push(
    always(
      ringTube(rings, {
        segments: 30,
        arcAt: (_r, y) => [gap(y), Math.PI * 2 - gap(y)],
        colour: (r, angle, p) => {
          if (r <= 1) return shade;
          const a = Math.min(angle, Math.PI * 2 - angle);
          return a < gap(p.y) + lapel ? shade : base;
        },
        // Lapels and front edges stand slightly proud of the fabric.
        displace: (_r, angle, y) => {
          const a = Math.min(angle, Math.PI * 2 - angle);
          return a < gap(y) + lapel ? 0.004 : 0;
        },
      }),
    ),
  );
  // Collar around the neck (not on cardigans).
  if (kind !== "cardigan") {
    const collar: THREE.Vector3[] = [];
    for (let i = 0; i <= 14; i++) {
      const a = lerp(0.5, Math.PI * 2 - 0.5, i / 14);
      const r = m.neckRadius * 1.55;
      collar.push(new THREE.Vector3(Math.sin(a) * r, m.shoulderY + 0.02 - 0.012 * Math.cos(a), Math.cos(a) * r * 1.05));
    }
    pieces.push(always(sweep(collar, { radial: 5, radius: () => 0.014, flatten: 0.45, colour: () => shade, capStart: true, capEnd: true })));
  }
  // Buttons.
  const buttons = kind === "cardigan" ? 4 : kind === "blazer" ? 1 : kind === "coat" ? 3 : 0;
  for (let i = 0; i < buttons; i++) {
    const y = buttons === 1 ? m.waistY : lerp(m.chestY, m.hipY, i / Math.max(1, buttons - 1));
    const r = profile.at(y);
    const a = gap(y) + 0.08;
    pieces.push(always(ellipsoid({ x: 0.005, y: 0.005, z: 0.0025 }, { x: Math.sin(a) * (r.rx + 0.018), y, z: r.cz + Math.cos(a) * (r.rz + 0.018) }, shadeHex(colour, -0.25), { width: 8, height: 6 })));
  }
  if (kind === "denim-jacket") {
    for (const side of [-1, 1]) {
      const y = m.chestY + 0.015;
      const r = profile.at(y);
      const a = 0.62;
      pieces.push(always(ellipsoid({ x: 0.03, y: 0.016, z: 0.004 }, { x: side * Math.sin(a) * (r.rx + 0.018), y, z: r.cz + Math.cos(a) * (r.rz + 0.018) }, shadeHex(colour, -0.1), { width: 8, height: 6 }, new THREE.Euler(0, side * a, 0))));
    }
  }
  // Coat tail below the hips: rigid while standing, on the thighs while seated.
  if (kind === "coat") {
    const tail: Ring[] = [];
    const tailEnd = m.kneeY - 0.02;
    for (let i = 0; i <= 6; i++) {
      const t = i / 6;
      const y = lerp(hem + 0.01, tailEnd, t);
      const body = profile.at(Math.max(y, m.hipY - 0.07));
      tail.push({ y, rx: lerp(body.rx + 0.016, m.hipHalfWidth * 1.4 + 0.03, t), rz: lerp(body.rz + 0.016, m.hipHalfDepth * 1.6 + 0.04, t), cz: body.cz * (1 - t) });
    }
    pieces.push({ geometry: ringTube(tail, { segments: 30, arc: [0.14, Math.PI * 2 - 0.14], colour: (r) => (r === 6 ? shade : base) }), material: "colour", pose: "standing" });
    pieces.push({ geometry: lapPanel(m, colour, m.hipY - m.kneeY), material: "colour", pose: "seated" });
  }
  return pieces;
}

// ── Arms ────────────────────────────────────────────────────────────────────

export function buildArm(m: BodyMetrics, outfit: Outfit, side: 1 | -1): Piece[] {
  const pieces: Piece[] = [];
  const L = m.armLength;
  const skin = rgb(outfit.skin);
  const sleeveColour = rgb(outfit.top);
  const cuffShade = rgb(shadeHex(outfit.top, -0.08));
  const sleeveEnd = outfit.sleeve;
  const radiusAt = (t: number) =>
    t < 0.12
      ? lerp(m.upperArmRadius * 1.08, m.upperArmRadius, t / 0.12)
      : t < 0.48
        ? lerp(m.upperArmRadius, m.forearmRadius * 1.02, (t - 0.12) / 0.36)
        : t < 0.72
          ? lerp(m.forearmRadius * 1.02, m.forearmRadius, (t - 0.48) / 0.24)
          : lerp(m.forearmRadius, m.wristRadius, (t - 0.72) / 0.28);
  const ts = [0, 0.06, 0.12, 0.2, 0.3, 0.4, 0.48, 0.56, 0.64, 0.72, 0.8, 0.88, 0.95, 1];
  const cuffed = outfit.topKind === "hoodie" || outfit.topKind === "sweater";
  const edges = sleeveEnd > 0 ? [sleeveEnd, ...(cuffed ? [sleeveEnd - 0.07] : [])] : [];
  const all = [...new Set([...ts, ...edges])].sort((a, b) => a - b);
  const rings: Ring[] = [];
  const ringT: number[] = [];
  for (const t of all) {
    const covered = sleeveEnd > 0 && t <= sleeveEnd;
    const loose = covered ? (sleeveEnd < 0.5 ? 0.009 + 0.004 * (t / sleeveEnd) : cuffed && t > sleeveEnd - 0.07 ? 0.003 : 0.006) : 0;
    const r = radiusAt(t);
    rings.push({ y: -t * L, rx: r + loose, rz: r * 0.95 + loose });
    ringT.push(t);
    if (edges.includes(t)) {
      const r2 = radiusAt(t);
      rings.push({ y: -t * L, rx: r2, rz: r2 * 0.95 });
      ringT.push(t + 1e-4);
    }
  }
  pieces.push(
    always(
      ringTube(rings, {
        segments: 14,
        capTop: true,
        colour: (r) => {
          const t = ringT[r]!;
          if (t > sleeveEnd || sleeveEnd === 0) return skin;
          if (cuffed && t > sleeveEnd - 0.07) return cuffShade;
          return sleeveColour;
        },
      }),
    ),
  );
  // Shoulder cap (sleeve colour unless sleeveless).
  pieces.push(always(ellipsoid({ x: m.upperArmRadius * 1.1, y: m.upperArmRadius * 0.85, z: m.upperArmRadius * 1.04 }, { x: 0, y: -0.012, z: 0 }, sleeveEnd > 0 ? outfit.top : outfit.skin, { width: 12, height: 8 })));
  if (outfit.patterned && sleeveEnd > 0) {
    const overlay: Ring[] = [];
    const patternEnd = cuffed ? sleeveEnd - 0.072 : sleeveEnd - 0.005;
    for (let i = 0; i <= 6; i++) {
      const t = lerp(0.02, patternEnd, i / 6);
      const loose = sleeveEnd < 0.5 ? 0.009 + 0.004 * (t / sleeveEnd) : 0.006;
      const r = radiusAt(t) + loose + 0.0015;
      overlay.push({ y: -t * L, rx: r, rz: r * 0.95 });
    }
    pieces.push({ geometry: ringTube(overlay, { segments: 14 }), material: "pattern", pose: "always" });
  }
  // Outerwear sleeve over everything.
  if (outfit.outer && outfit.outerKind !== "none") {
    const outer = rgb(outfit.outer);
    const outerShade = rgb(shadeHex(outfit.outer, -0.08));
    const sleeve: Ring[] = [];
    for (let i = 0; i <= 10; i++) {
      const t = lerp(0, 0.95, i / 10);
      const r = radiusAt(t) + 0.016 - 0.004 * t;
      sleeve.push({ y: -t * L, rx: r, rz: r * 0.95 });
    }
    pieces.push(always(ringTube(sleeve, { segments: 14, capTop: true, colour: (r) => (r >= 9 ? outerShade : outer) })));
    pieces.push(always(ellipsoid({ x: m.upperArmRadius * 1.2 + 0.014, y: m.upperArmRadius * 0.9 + 0.012, z: m.upperArmRadius * 1.1 + 0.014 }, { x: 0, y: -0.01, z: 0 }, outfit.outer, { width: 12, height: 8 })));
  }
  // Hand: a soft mitten with a thumb, facing the thigh.
  const handLength = 0.082 * (m.height / 1.72);
  const wrist = -L;
  pieces.push(always(ellipsoid({ x: m.wristRadius * 0.62, y: handLength * 0.5, z: m.wristRadius * 1.35 }, { x: 0, y: wrist - handLength * 0.42, z: 0.004 }, outfit.skin, { width: 12, height: 10 })));
  pieces.push(always(ellipsoid({ x: m.wristRadius * 0.38, y: handLength * 0.26, z: m.wristRadius * 0.4 }, { x: -side * m.wristRadius * 0.25, y: wrist - handLength * 0.3, z: m.wristRadius * 1.15 }, outfit.skin, { width: 8, height: 6 }, new THREE.Euler(0.4, 0, 0))));
  return pieces;
}

// ── Legs ────────────────────────────────────────────────────────────────────

interface LegCoverage {
  /** Fraction of the thigh covered from the top (0–1), and of the shin (0–1). */
  thigh: number;
  shin: number;
  colour: string;
  /** Extra radius for loose trousers, and the flare at the hem. */
  loose: number;
  flare: number;
}

function legCoverage(outfit: Outfit): LegCoverage {
  switch (outfit.bottomKind) {
    case "jeans":
      return { thigh: 1, shin: 1, colour: outfit.bottom, loose: 0.004, flare: 0.006 };
    case "trousers":
      return { thigh: 1, shin: 1, colour: outfit.bottom, loose: 0.012, flare: 0.034 };
    case "jumpsuit":
      return { thigh: 1, shin: 1, colour: outfit.top, loose: 0.01, flare: 0.022 };
    case "shorts":
      return { thigh: 0.55, shin: 0, colour: outfit.bottom, loose: 0.014, flare: 0.012 };
    default:
      return { thigh: 0, shin: 0, colour: outfit.skin, loose: 0, flare: 0 };
  }
}

export function buildThigh(m: BodyMetrics, outfit: Outfit): Piece[] {
  const length = m.hipY - m.kneeY;
  const cover = legCoverage(outfit);
  const skin = rgb(outfit.skin);
  const cloth = rgb(cover.colour);
  const ts = [0, 0.1, 0.25, 0.4, 0.55, 0.7, 0.85, 1];
  const edge = cover.thigh > 0 && cover.thigh < 1 ? cover.thigh : null;
  const all = [...new Set([...ts, ...(edge !== null ? [edge] : [])])].sort((a, b) => a - b);
  const rings: Ring[] = [];
  const ringT: number[] = [];
  for (const t of all) {
    const r = lerp(m.thighRadius, m.kneeRadius, t * t * 0.4 + t * 0.6);
    const covered = t <= cover.thigh;
    const loose = covered ? cover.loose + (edge !== null ? cover.flare * (t / edge) : 0) : 0;
    rings.push({ y: -t * length, rx: r + loose, rz: r * 0.96 + loose });
    ringT.push(t);
    if (edge !== null && t === edge) {
      rings.push({ y: -t * length, rx: r, rz: r * 0.96 });
      ringT.push(t + 1e-4);
    }
  }
  const pieces: Piece[] = [
    always(ringTube(rings, { segments: 16, capTop: true, colour: (r) => (ringT[r]! <= cover.thigh ? cloth : skin) })),
    always(ellipsoid({ x: m.kneeRadius * 1.02, y: m.kneeRadius * 1.0, z: m.kneeRadius * 1.02 }, { x: 0, y: -length, z: 0.004 }, cover.shin > 0 ? cover.colour : outfit.skin, { width: 12, height: 8 })),
  ];
  // Seated skirts and coats: a flared sleeve along the thigh (hidden while standing).
  const seatedColour = outfit.skirtHem !== null ? (outfit.bottomKind === "dress" || outfit.bottomKind === "maxi-dress" ? outfit.top : outfit.bottom) : outfit.outerKind === "coat" ? outfit.outer : null;
  if (seatedColour) {
    const reach = outfit.skirtHem !== null && (outfit.bottomKind === "skirt" || outfit.bottomKind === "dress") ? 0.8 : 1.05;
    const sleeve: Ring[] = [];
    for (let i = 0; i <= 5; i++) {
      const t = (i / 5) * reach;
      const r = lerp(m.thighRadius, m.kneeRadius, Math.min(1, t)) + 0.018 + 0.016 * t;
      sleeve.push({ y: -t * length, rx: r * 1.15, rz: r });
    }
    const patterned = outfit.patterned && (outfit.bottomKind === "dress" || outfit.bottomKind === "maxi-dress");
    pieces.push({ geometry: ringTube(sleeve, { segments: 16, colour: () => rgb(seatedColour) }), material: patterned ? "pattern" : "colour", pose: "seated" });
  }
  return pieces;
}

export function buildShin(m: BodyMetrics, outfit: Outfit, config: AppearanceConfig): Piece[] {
  const length = m.kneeY - m.ankleY;
  const cover = legCoverage(outfit);
  const skin = rgb(outfit.skin);
  const cloth = rgb(cover.colour);
  const pieces: Piece[] = [];
  const rings: Ring[] = [];
  const ts = [0, 0.12, 0.3, 0.5, 0.7, 0.88, 1];
  for (const t of ts) {
    const r = t < 0.3 ? lerp(m.kneeRadius, m.calfRadius, t / 0.3) : lerp(m.calfRadius, m.ankleRadius, (t - 0.3) / 0.7);
    rings.push({ y: -t * length, rx: r * 0.94, rz: r, cz: t < 0.6 ? -0.006 * Math.sin((t / 0.6) * Math.PI) : 0 });
  }
  pieces.push(always(ringTube(rings, { segments: 14, colour: () => (cover.shin > 0 ? cloth : skin) })));
  if (cover.shin > 0) {
    // Trouser leg: straight or wide, open at the hem, with a darker cuff.
    const hemShade = rgb(shadeHex(cover.colour, outfit.bottomKind === "jeans" ? 0.08 : -0.06));
    const leg: Ring[] = [];
    for (let i = 0; i <= 6; i++) {
      const t = i / 6;
      const r = lerp(m.kneeRadius + cover.loose, Math.max(m.ankleRadius + 0.012, m.kneeRadius * 0.8) + cover.flare, t);
      leg.push({ y: -t * (length + 0.012), rx: r, rz: r * 1.02 });
    }
    pieces.push(always(ringTube(leg, { segments: 16, colour: (r) => (r === 6 ? hemShade : cloth) })));
  }
  // Long skirts while seated: fabric draping from the knee to the ankle.
  if (outfit.skirtHem !== null && (outfit.bottomKind === "long-skirt" || outfit.bottomKind === "maxi-dress")) {
    const colour = outfit.bottomKind === "maxi-dress" ? outfit.top : outfit.bottom;
    const drape: Ring[] = [];
    for (let i = 0; i <= 5; i++) {
      const t = i / 5;
      const r = m.kneeRadius + 0.03 + 0.02 * t;
      drape.push({ y: -t * (length - 0.02), rx: r * 1.3, rz: r, cz: 0.01 });
    }
    pieces.push({ geometry: ringTube(drape, { segments: 16, colour: () => rgb(colour) }), material: outfit.patterned && outfit.bottomKind === "maxi-dress" ? "pattern" : "colour", pose: "seated" });
  }
  pieces.push(...shoes(m, outfit, config, -length));
  return pieces;
}

function shoes(m: BodyMetrics, outfit: Outfit, config: AppearanceConfig, ankle: number): Piece[] {
  const kind = config.outfit.shoes;
  const sole = ankle - m.ankleY;
  const len = m.footLength;
  const colour = outfit.shoes;
  const pieces: Piece[] = [];
  const footShape = (height: number, width: number, colourAt: (p: THREE.Vector3) => THREE.Color, toe = 1) => {
    const geometry = new THREE.SphereGeometry(1, 16, 10);
    geometry.scale(width, height, len * 0.52);
    const position = geometry.getAttribute("position") as THREE.BufferAttribute;
    const v = new THREE.Vector3();
    for (let i = 0; i < position.count; i++) {
      v.fromBufferAttribute(position, i);
      if (v.y < -height * 0.35) v.y = -height * 0.35; // flat sole
      if (v.z > 0) v.x *= lerp(1, toe, v.z / (len * 0.52)); // narrower toe
      position.setXYZ(i, v.x, v.y, v.z);
    }
    geometry.computeVertexNormals();
    geometry.translate(0, sole + height * 0.35, len * 0.3);
    return paintWith(standardise(geometry), (p) => colourAt(p));
  };
  const scale = m.height / 1.72;
  switch (kind) {
    case "trainers": {
      const white = rgb("#f4f2ee");
      const body = rgb(colour);
      const lace = rgb(mixHex(colour, "#ffffff", 0.6));
      pieces.push(always(footShape(0.05 * scale, 0.046 * scale, (p) => (p.y < sole + 0.016 ? white : p.y > sole + 0.05 * scale * 1.15 && p.z > len * 0.15 && p.z < len * 0.55 ? lace : body), 0.95)));
      break;
    }
    case "boots": {
      const body = rgb(colour);
      const soleColour = rgb("#2a1f1a");
      pieces.push(always(footShape(0.048 * scale, 0.043 * scale, (p) => (p.y < sole + 0.012 ? soleColour : body), 0.8)));
      pieces.push(always(ringTube([
        { y: ankle - 0.01, rx: m.ankleRadius + 0.014, rz: m.ankleRadius + 0.016 },
        { y: ankle + 0.07 * scale, rx: m.ankleRadius + 0.016, rz: m.ankleRadius + 0.018 },
        { y: ankle + 0.12 * scale, rx: m.calfRadius * 0.78 + 0.012, rz: m.calfRadius * 0.82 + 0.012 },
      ], { segments: 14, colour: (r) => (r === 2 ? rgb(shadeHex(colour, -0.1)) : body) })));
      break;
    }
    case "sandals": {
      pieces.push(always(footShape(0.036 * scale, 0.04 * scale, () => rgb(outfit.skin), 0.85)));
      const soleGeometry = new THREE.CylinderGeometry(1, 1, 0.012, 16);
      soleGeometry.scale(0.044 * scale, 1, len * 0.54);
      soleGeometry.translate(0, sole + 0.006, len * 0.3);
      pieces.push(always(paint(soleGeometry, shadeHex(colour, -0.08))));
      for (const z of [len * 0.12, len * 0.45]) {
        const strap = new THREE.TorusGeometry(0.036 * scale, 0.006, 5, 16, Math.PI);
        strap.scale(1, 0.9, 1);
        strap.rotateY(Math.PI / 2);
        strap.rotateX(0);
        strap.rotateY(Math.PI / 2);
        strap.translate(0, sole + 0.012, z);
        pieces.push(always(paint(strap, colour)));
      }
      break;
    }
    default: {
      const body = rgb(colour);
      const soleColour = rgb("#3a2a22");
      const band = rgb(shadeHex(colour, -0.12));
      pieces.push(always(footShape(0.04 * scale, 0.044 * scale, (p) => (p.y < sole + 0.01 ? soleColour : p.z > len * 0.28 && p.z < len * 0.36 ? band : body), 0.78)));
    }
  }
  return pieces;
}
