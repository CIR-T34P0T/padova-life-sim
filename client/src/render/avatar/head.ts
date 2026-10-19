// The head: a sphere deformed by the face shape and face sliders, coloured
// with the skin tone (plus blush and stubble), and the face features drawn on
// its surface: eyes, brows, nose, lips, ears, freckles and beauty marks.
// Head space: origin at the head centre, +Z is the face, metres.
//
// Every slider is clamped to a range that keeps the face intact (no
// overlapping features, no inverted geometry): see the ranges below.

import * as THREE from "three";
import {
  blushColour,
  browColour,
  colourOf,
  lipColour,
  mixHex,
  shadeHex,
  skinShadeColour,
  type AppearanceConfig,
  type EyeShape,
  type FaceShape,
  type LipShape,
  type NoseShape,
} from "@padova/shared";
import {
  clamp,
  curve,
  ellipsoid,
  fromSlider,
  lerp,
  merge,
  paintWith,
  rgb,
  seeded,
  smoothNormals,
  smoothstep,
  standardise,
  sweep,
} from "./geometry.ts";
import type { BodyMetrics } from "./metrics.ts";

interface FaceShapeParams {
  cheek: number;
  jaw: number;
  chin: number;
  lower: number;
  forehead: number;
}

const FACE_SHAPES: Record<FaceShape, FaceShapeParams> = {
  oval: { cheek: 1.0, jaw: 0.86, chin: 0.44, lower: 1.0, forehead: 0.97 },
  round: { cheek: 1.05, jaw: 0.96, chin: 0.6, lower: 0.92, forehead: 1.0 },
  square: { cheek: 1.0, jaw: 1.02, chin: 0.66, lower: 0.97, forehead: 1.0 },
  heart: { cheek: 1.05, jaw: 0.8, chin: 0.36, lower: 1.0, forehead: 1.03 },
  long: { cheek: 0.95, jaw: 0.85, chin: 0.46, lower: 1.13, forehead: 0.95 },
  diamond: { cheek: 1.08, jaw: 0.8, chin: 0.4, lower: 1.02, forehead: 0.88 },
};

/** The deformed head surface, with helpers to place things on it. */
export class HeadShape {
  readonly hw: number;
  readonly hh: number;
  readonly hd: number;
  private readonly cheek: number;
  private readonly jaw: number;
  private readonly chin: number;
  private readonly lower: number;
  private readonly upper: number;
  private readonly forehead: number;

  constructor(face: AppearanceConfig["face"], metrics: BodyMetrics) {
    const shape = FACE_SHAPES[face.shape] ?? FACE_SHAPES.oval;
    this.hw = metrics.headHalfWidth;
    this.hh = metrics.headHeight * 0.5;
    this.hd = metrics.headHalfDepth;
    this.cheek = clamp(shape.cheek + (face.cheekbones - 0.5) * 0.14, 0.88, 1.15);
    this.jaw = clamp(shape.jaw + (face.jaw - 0.5) * 0.2, 0.7, 1.1);
    this.chin = clamp(shape.chin + (face.jaw - 0.5) * 0.12 + (0.5 - face.chin) * 0.1, 0.3, 0.75);
    this.lower = clamp(shape.lower * fromSlider(face.chin, 0.93, 1.07), 0.85, 1.22);
    this.upper = 1.04 * fromSlider(face.forehead, 0.95, 1.06);
    this.forehead = shape.forehead;
  }

  /** Width factor at unit height y (before the back-of-skull rounding). */
  private width(y: number): number {
    return curve(
      [
        [-1, this.chin * 0.8],
        [-0.88, this.chin],
        [-0.6, this.jaw],
        [-0.15, this.cheek],
        [0.35, this.forehead],
        [1, 1],
      ],
      y,
    );
  }

  /** Surface point (head space, metres) for a unit direction. */
  point(d: THREE.Vector3Like, out = new THREE.Vector3()): THREE.Vector3 {
    let w = this.width(d.y);
    const back = smoothstep(0.15, -0.45, d.z) * smoothstep(-0.8, -0.35, d.y);
    w = lerp(w, Math.max(w, 0.97), back);
    const y = d.y > 0 ? d.y * this.upper : d.y * this.lower;
    let z = d.z * (d.z > 0 ? 0.93 : 1.04);
    // A small chin and a softly flattened face front.
    z += 0.05 * smoothstep(-0.6, -0.92, d.y) * smoothstep(0.2, 0.6, d.z);
    return out.set(d.x * w * this.hw, y * this.hh, z * this.hd);
  }

  /** Surface point and normal on the face side for a head-space (x, y). */
  front(x: number, y: number): { position: THREE.Vector3; normal: THREE.Vector3 } {
    const d = this.solveFront(x, y);
    const position = this.point(d);
    const e = 1e-3;
    const pa = this.point(this.frontDir(d.x + e, d.y));
    const pb = this.point(this.frontDir(d.x - e, d.y));
    const pc = this.point(this.frontDir(d.x, d.y + e));
    const pd = this.point(this.frontDir(d.x, d.y - e));
    const normal = pa.sub(pb).cross(pc.sub(pd)).normalize();
    if (normal.z < 0) normal.negate();
    return { position, normal };
  }

  private frontDir(a: number, b: number): THREE.Vector3 {
    const s = a * a + b * b;
    if (s >= 0.999) {
      const k = Math.sqrt(0.999 / s);
      return new THREE.Vector3(a * k, b * k, Math.sqrt(0.001));
    }
    return new THREE.Vector3(a, b, Math.sqrt(1 - s));
  }

  private solveFront(x: number, y: number): THREE.Vector3 {
    let d = this.frontDir(clamp(x / this.hw, -0.95, 0.95), clamp(y / this.hh, -0.95, 0.95));
    const q = new THREE.Vector3();
    for (let i = 0; i < 10; i++) {
      this.point(d, q);
      d = this.frontDir(clamp(d.x + ((x - q.x) / this.hw) * 0.9, -0.99, 0.99), clamp(d.y + ((y - q.y) / this.hh) * 0.9, -0.99, 0.99));
    }
    return d;
  }

  /** The head mesh, built from a unit sphere. `dirs` receives each vertex's unit direction. */
  mesh(widthSegments: number, heightSegments: number): { geometry: THREE.BufferGeometry; dirs: THREE.Vector3[] } {
    const geometry = new THREE.SphereGeometry(1, widthSegments, heightSegments);
    const position = geometry.getAttribute("position") as THREE.BufferAttribute;
    const dirs: THREE.Vector3[] = [];
    const p = new THREE.Vector3();
    for (let i = 0; i < position.count; i++) {
      const d = new THREE.Vector3().fromBufferAttribute(position, i).normalize();
      dirs.push(d);
      this.point(d, p);
      position.setXYZ(i, p.x, p.y, p.z);
    }
    standardise(geometry);
    smoothNormals(geometry);
    return { geometry, dirs };
  }
}

// ── Decals: flat shapes laid on the face surface ────────────────────────────

type P2 = readonly [number, number];

/** A polygon (fan from its centre) laid on the face, lifted along the surface normal. */
function decalFan(
  head: HeadShape,
  centre: P2,
  outline: readonly P2[],
  colour: (x: number, y: number, rim: boolean) => THREE.Color,
  lift: number | ((x: number, y: number) => number),
): THREE.BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const colours: number[] = [];
  const add = ([x, y]: P2, rim: boolean) => {
    const { position, normal } = head.front(x, y);
    const l = typeof lift === "number" ? lift : lift(x, y);
    positions.push(position.x + normal.x * l, position.y + normal.y * l, position.z + normal.z * l);
    normals.push(normal.x, normal.y, normal.z);
    const c = colour(x, y, rim);
    colours.push(c.r, c.g, c.b);
  };
  add(centre, false);
  for (const point of outline) add(point, true);
  const indices: number[] = [];
  for (let i = 0; i < outline.length; i++) indices.push(0, 1 + i, 1 + ((i + 1) % outline.length));
  return finishDecal(positions, normals, colours, indices);
}

/** A strip along a 2D polyline on the face, with a thickness profile (perpendicular in 2D). */
function decalStrip(
  head: HeadShape,
  line: readonly P2[],
  thickness: (t: number) => number,
  colour: THREE.Color,
  lift: number,
  /** 0 = centred on the line, 1 = the line is the lower edge, -1 = upper edge. */
  anchor = 0,
): THREE.BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const colours: number[] = [];
  const indices: number[] = [];
  for (let i = 0; i < line.length; i++) {
    const [x, y] = line[i]!;
    const [px, py] = line[Math.max(0, i - 1)]!;
    const [nx, ny] = line[Math.min(line.length - 1, i + 1)]!;
    let tx = nx - px;
    let ty = ny - py;
    const tl = Math.hypot(tx, ty) || 1;
    tx /= tl;
    ty /= tl;
    // Perpendicular pointing "up" in 2D.
    let ox = -ty;
    let oy = tx;
    if (oy < 0) {
      ox = -ox;
      oy = -oy;
    }
    const t = i / (line.length - 1);
    const w = thickness(t);
    const below = (1 - anchor) / 2;
    const above = (1 + anchor) / 2;
    for (const [sx, sy] of [
      [x - ox * w * below, y - oy * w * below],
      [x + ox * w * above, y + oy * w * above],
    ] as const) {
      const { position, normal } = head.front(sx, sy);
      positions.push(position.x + normal.x * lift, position.y + normal.y * lift, position.z + normal.z * lift);
      normals.push(normal.x, normal.y, normal.z);
      colours.push(colour.r, colour.g, colour.b);
    }
    if (i > 0) {
      const a = (i - 1) * 2;
      indices.push(a, a + 2, a + 3, a, a + 3, a + 1);
    }
  }
  return finishDecal(positions, normals, colours, indices);
}

function finishDecal(positions: number[], normals: number[], colours: number[], indices: number[]): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colours, 3));
  geometry.setIndex(indices);
  return standardise(geometry);
}

const circle = (cx: number, cy: number, rx: number, ry: number, n: number): P2[] =>
  Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2;
    return [cx + Math.cos(a) * rx, cy + Math.sin(a) * ry] as const;
  });

// ── Eyes ────────────────────────────────────────────────────────────────────

interface EyeShapeParams {
  height: number;
  upperPower: number;
  lowerPower: number;
  tilt: number;
  crease: number;
  lid: number;
}

const EYE_SHAPES: Record<EyeShape, EyeShapeParams> = {
  round: { height: 0.82, upperPower: 0.55, lowerPower: 0.7, tilt: 0, crease: 1, lid: 0 },
  almond: { height: 0.6, upperPower: 0.62, lowerPower: 0.85, tilt: 0.06, crease: 1, lid: 0 },
  hooded: { height: 0.52, upperPower: 0.7, lowerPower: 0.85, tilt: 0.02, crease: 0, lid: 1 },
  monolid: { height: 0.5, upperPower: 0.38, lowerPower: 0.8, tilt: 0.08, crease: 0, lid: 0 },
  upturned: { height: 0.6, upperPower: 0.6, lowerPower: 0.85, tilt: 0.2, crease: 1, lid: 0 },
  downturned: { height: 0.6, upperPower: 0.6, lowerPower: 0.8, tilt: -0.16, crease: 1, lid: 0 },
};

export interface FaceLayout {
  eyeY: number;
  eyeX: number;
  eyeWidth: number;
  eyeHeight: number;
  noseTipY: number;
  mouthY: number;
  mouthWidth: number;
  browY: number;
}

export function faceLayout(head: HeadShape, face: AppearanceConfig["face"]): FaceLayout {
  const shape = EYE_SHAPES[face.eyeShape] ?? EYE_SHAPES.almond;
  const eyeWidth = head.hw * 0.37 * fromSlider(face.eyeSize, 0.86, 1.16);
  const eyeHeight = eyeWidth * shape.height;
  const eyeY = -head.hh * 0.1;
  const eyeX = head.hw * fromSlider(face.eyeSpacing, 0.34, 0.42);
  const noseTipY = -head.hh * fromSlider(face.noseLength, 0.34, 0.46);
  const mouthY = -head.hh * 0.64;
  return {
    eyeY,
    eyeX,
    eyeWidth,
    eyeHeight,
    noseTipY: Math.max(noseTipY, mouthY + head.hh * 0.14),
    mouthY,
    mouthWidth: head.hw * 0.42,
    browY: eyeY + eyeHeight * 0.5 + head.hh * fromSlider(face.browHeight, 0.1, 0.19),
  };
}

function eyePieces(head: HeadShape, layout: FaceLayout, face: AppearanceConfig["face"], skin: string, hair: string): THREE.BufferGeometry[] {
  const shape = EYE_SHAPES[face.eyeShape] ?? EYE_SHAPES.almond;
  const pieces: THREE.BufferGeometry[] = [];
  const w = layout.eyeWidth;
  const h = layout.eyeHeight;
  const iris = colourOf("eyeColours", face.eyeColour, "#5a3a22");
  const irisDark = rgb(shadeHex(iris, -0.16));
  const irisLight = rgb(shadeHex(iris, 0.1));
  const sclera = rgb("#f7f3ee");
  const lash = rgb(mixHex("#1b1416", hair, 0.15));
  const crease = rgb(skinShadeColour(skin, 0.1));
  const lid = rgb(skinShadeColour(skin, 0.05));
  const lowerLine = rgb(skinShadeColour(skin, 0.16));

  for (const side of [-1, 1]) {
    const cx = side * layout.eyeX;
    const cy = layout.eyeY;
    // s: outward from the nose (+ = outer corner); converted to head x by side.
    const upper = (s: number) => {
      const u = clamp(1 - ((2 * s) / w) ** 2, 0, 1);
      return h * 0.56 * u ** shape.upperPower + shape.tilt * s * 0.5;
    };
    const lower = (s: number) => {
      const u = clamp(1 - ((2 * s) / w) ** 2, 0, 1);
      return -h * 0.44 * u ** shape.lowerPower + shape.tilt * s * 0.5;
    };
    const toHead = (s: number, v: number): P2 => [cx + side * s, cy + v];
    const columns = 12;
    const sAt = (i: number) => -w / 2 + (w * i) / columns;
    const outline: P2[] = [];
    for (let i = 0; i <= columns; i++) outline.push(toHead(sAt(i), upper(sAt(i))));
    for (let i = columns - 1; i > 0; i--) outline.push(toHead(sAt(i), lower(sAt(i))));
    pieces.push(decalFan(head, toHead(0, 0), outline, () => sclera, 0.0006));

    // Iris and pupil: tall anime ellipses clipped by the lids.
    const clip = (s: number, v: number, margin: number): P2 => {
      const cs = clamp(s, -w / 2 + margin, w / 2 - margin);
      return toHead(cs, clamp(v, lower(cs) + margin * 0.3, upper(cs) - margin * 0.15));
    };
    const irisRx = w * 0.25;
    const irisRy = Math.max(h * 0.5, w * 0.27);
    const irisOutline = circle(0, -h * 0.02, irisRx, irisRy, 18).map(([s, v]) => clip(s, v, 0.0004));
    pieces.push(
      decalFan(
        head,
        toHead(0, -h * 0.05),
        irisOutline,
        (_x, y) => (y - cy > h * 0.12 ? irisDark : y - cy < -h * 0.18 ? irisLight : rgb(iris)),
        0.001,
      ),
    );
    const pupil = circle(0, -h * 0.01, irisRx * 0.42, irisRy * 0.5, 14).map(([s, v]) => clip(s, v, 0.0006));
    pieces.push(decalFan(head, toHead(0, -h * 0.01), pupil, () => rgb("#1a1214"), 0.0013));
    // Highlights: same screen side on both eyes, as if lit from one direction.
    const hx = cx + irisRx * 0.35;
    const hy = cy + h * 0.16;
    pieces.push(decalFan(head, [hx, hy], circle(hx, hy, w * 0.07, w * 0.07, 10), () => rgb("#ffffff"), 0.0017));
    const lx = cx - irisRx * 0.35;
    const ly = cy - h * 0.18;
    pieces.push(decalFan(head, [lx, ly], circle(lx, ly, w * 0.035, w * 0.035, 8), () => rgb("#ffffff"), 0.0017));

    // Upper lash line with a small flick at the outer corner.
    const lashLine: P2[] = [];
    for (let i = 0; i <= columns; i++) lashLine.push(toHead(sAt(i), upper(sAt(i)) - 0.0004));
    lashLine.push(toHead(w * 0.62, upper(w / 2) + h * 0.12));
    pieces.push(decalStrip(head, lashLine, (t) => 0.0011 + 0.0022 * Math.sin(Math.min(1, t * 1.15) * Math.PI * 0.85), lash, 0.0019, 1));
    // Lower lid hint on the outer half.
    const lowerHint: P2[] = [];
    for (let i = columns / 2; i <= columns; i++) lowerHint.push(toHead(sAt(i), lower(sAt(i)) - 0.0003));
    pieces.push(decalStrip(head, lowerHint, (t) => 0.0008 * Math.sin(t * Math.PI) + 0.0002, lowerLine, 0.0012, -1));
    if (shape.crease > 0) {
      const creaseLine: P2[] = [];
      for (let i = 2; i <= columns - 1; i++) creaseLine.push(toHead(sAt(i), upper(sAt(i)) + h * 0.32));
      pieces.push(decalStrip(head, creaseLine, (t) => 0.0007 * Math.sin(t * Math.PI), crease, 0.0009));
    }
    if (shape.lid > 0) {
      const lidLine: P2[] = [];
      for (let i = 0; i <= columns; i++) lidLine.push(toHead(sAt(i) * 1.04, upper(sAt(i)) + h * 0.05));
      pieces.push(decalStrip(head, lidLine, (t) => 0.0022 * Math.sin(t * Math.PI) + 0.0004, lid, 0.0016, 1));
    }
  }
  return pieces;
}

// ── Brows ───────────────────────────────────────────────────────────────────

function browPieces(head: HeadShape, layout: FaceLayout, face: AppearanceConfig["face"], hair: string): THREE.BufferGeometry[] {
  const colour = rgb(browColour(hair));
  const w = layout.eyeWidth;
  const thicknessScale = face.browShape === "thick" ? 1.7 : face.browShape === "thin" ? 0.55 : 1;
  const arch = (s: number) => {
    switch (face.browShape) {
      case "straight":
        return 0.0006 + s * 0.012;
      case "high-arch": {
        const u = (s - 0.22 * w) / (0.7 * w);
        return 0.0105 * Math.max(0, 1 - u * u) - 0.0015;
      }
      default: {
        const u = (s - 0.12 * w) / (0.75 * w);
        return 0.0062 * Math.max(0, 1 - u * u);
      }
    }
  };
  const pieces: THREE.BufferGeometry[] = [];
  for (const side of [-1, 1]) {
    const line: P2[] = [];
    for (let i = 0; i <= 10; i++) {
      const s = -0.62 * w + (1.22 * w * i) / 10;
      line.push([side * (layout.eyeX + s), layout.browY + arch(s)]);
    }
    pieces.push(decalStrip(head, line, (t) => (0.0043 - 0.0027 * t) * thicknessScale, colour, 0.0012));
  }
  return pieces;
}

// ── Nose ────────────────────────────────────────────────────────────────────

/**
 * Nose shapes: tip size, how far the tip stands out, the bridge ridge (thickness
 * and where it starts: 0 = between the eyes, 0.6 = only the lower part) and
 * the size of the nostril wings. Distinct enough to tell apart at a glance.
 */
const NOSE_SHAPES: Record<NoseShape, { tip: [number, number, number]; protrusion: number; bridge: number; bridgeStart: number; wings: number }> = {
  button: { tip: [0.0096, 0.008, 0.0078], protrusion: 0.7, bridge: 0.0016, bridgeStart: 0.6, wings: 0.8 },
  straight: { tip: [0.0074, 0.0076, 0.0086], protrusion: 1.15, bridge: 0.0037, bridgeStart: 0, wings: 0.75 },
  broad: { tip: [0.0128, 0.0078, 0.0082], protrusion: 0.9, bridge: 0.0034, bridgeStart: 0.3, wings: 1.5 },
  rounded: { tip: [0.012, 0.0108, 0.0104], protrusion: 1.0, bridge: 0.0026, bridgeStart: 0.35, wings: 1.1 },
  narrow: { tip: [0.0056, 0.0072, 0.0092], protrusion: 1.25, bridge: 0.0025, bridgeStart: 0, wings: 0.55 },
};

function nosePieces(head: HeadShape, layout: FaceLayout, face: AppearanceConfig["face"], skin: string): THREE.BufferGeometry[] {
  const shape = NOSE_SHAPES[face.noseShape] ?? NOSE_SHAPES.button;
  const widthScale = fromSlider(face.noseWidth, 0.82, 1.22);
  const scale = head.hh / 0.124;
  const base = rgb(skin);
  const under = rgb(skinShadeColour(skin, 0.09));
  const shadeUnder = (geometry: THREE.BufferGeometry) =>
    paintWith(geometry, (_p, n) => (n.y < -0.35 ? under : n.y < 0 ? base.clone().lerp(under, 0.4) : base));

  const tipSurface = head.front(0, layout.noseTipY);
  const [rx, ry, rz] = shape.tip;
  const tipOut = rz * scale * (0.3 + 0.5 * shape.protrusion);
  const tipCentre = tipSurface.position.clone().add(tipSurface.normal.clone().multiplyScalar(tipOut));
  const pieces: THREE.BufferGeometry[] = [];
  pieces.push(shadeUnder(ellipsoid({ x: rx * widthScale * scale, y: ry * scale, z: rz * scale }, tipCentre, skin, { width: 14, height: 10 })));

  // Bridge: a soft ridge down to the tip (plain skin colour, so it reads as a shape, not a line).
  const path: THREE.Vector3[] = [];
  const top = lerp(layout.eyeY + layout.eyeHeight * 0.1, layout.noseTipY, shape.bridgeStart);
  for (let i = 0; i <= 6; i++) {
    const t = i / 6;
    const y = lerp(top, layout.noseTipY + ry * scale * 0.35, t);
    const s = head.front(0, y);
    path.push(s.position.clone().add(s.normal.clone().multiplyScalar(lerp(0.0003, tipOut + rz * scale * 0.2, t * t))));
  }
  pieces.push(
    sweep(path, {
      radial: 8,
      radius: (t) => shape.bridge * scale * widthScale * lerp(0.55, 1, t),
      capStart: true,
      colour: () => base,
    }),
  );
  // Nostril wings.
  for (const side of [-1, 1]) {
    const wx = side * rx * widthScale * scale * 0.95;
    const s = head.front(wx, layout.noseTipY - ry * scale * 0.35);
    const centre = s.position.clone().add(s.normal.clone().multiplyScalar(0.0025 * scale));
    const r = 0.0042 * shape.wings * scale;
    pieces.push(shadeUnder(ellipsoid({ x: r * widthScale, y: r * 0.85, z: r * 0.9 }, centre, skin, { width: 10, height: 8 })));
  }
  return pieces;
}

// ── Lips ────────────────────────────────────────────────────────────────────

const LIP_SHAPES: Record<LipShape, { width: number; upper: number; lower: number; bow: number }> = {
  full: { width: 1.0, upper: 0.0052, lower: 0.0072, bow: 0.0012 },
  thin: { width: 0.96, upper: 0.0026, lower: 0.0036, bow: 0.0006 },
  heart: { width: 0.86, upper: 0.0048, lower: 0.0058, bow: 0.002 },
  wide: { width: 1.2, upper: 0.0042, lower: 0.0054, bow: 0.0008 },
};

function lipPieces(head: HeadShape, layout: FaceLayout, face: AppearanceConfig["face"], skin: string): THREE.BufferGeometry[] {
  const shape = LIP_SHAPES[face.lipShape] ?? LIP_SHAPES.full;
  const fullness = fromSlider(face.lipFullness, 0.72, 1.32);
  const scale = head.hh / 0.124;
  const w = layout.mouthWidth * shape.width;
  const lip = lipColour(skin);
  const upperColour = rgb(shadeHex(lip, -0.035));
  const lowerColour = rgb(lip);
  const lineColour = rgb(shadeHex(lip, -0.2));
  const y0 = layout.mouthY;
  const n = 12;
  const sAt = (i: number) => -w / 2 + (w * i) / n;
  const bump = (s: number) => clamp(1 - ((2 * s) / w) ** 2, 0, 1);
  const upperEdge = (s: number) => {
    const u = bump(s);
    const bow = shape.bow * scale * Math.exp(-((s / (w * 0.08)) ** 2));
    const peaks = face.lipShape === "heart" ? 0.0011 * scale * Math.exp(-(((Math.abs(s) - w * 0.16) / (w * 0.08)) ** 2)) : 0;
    return y0 + 0.0003 + shape.upper * fullness * scale * u ** 0.65 - bow + peaks;
  };
  const lowerEdge = (s: number) => y0 - 0.0003 - shape.lower * fullness * scale * bump(s) ** 0.55;
  const lift = (x: number) => 0.0009 + 0.0022 * fullness * bump(x);

  const upperOutline: P2[] = [];
  for (let i = 0; i <= n; i++) upperOutline.push([sAt(i), upperEdge(sAt(i))]);
  for (let i = n - 1; i > 0; i--) upperOutline.push([sAt(i), y0 + 0.0003]);
  const lowerOutline: P2[] = [];
  for (let i = 0; i <= n; i++) lowerOutline.push([sAt(i), y0 - 0.0003]);
  for (let i = n - 1; i > 0; i--) lowerOutline.push([sAt(i), lowerEdge(sAt(i))]);
  const pieces = [
    decalFan(head, [0, (y0 + upperEdge(0)) / 2], upperOutline, () => upperColour, (x) => lift(x)),
    decalFan(head, [0, (y0 + lowerEdge(0)) / 2], lowerOutline, () => lowerColour, (x) => lift(x) * 1.1),
  ];
  const line: P2[] = [];
  for (let i = 1; i < n; i++) line.push([sAt(i), y0]);
  pieces.push(decalStrip(head, line, (t) => 0.0007 + 0.0004 * Math.sin(t * Math.PI), lineColour, 0.0024 * fullness));
  return pieces;
}

// ── Skin details ────────────────────────────────────────────────────────────

function skinDetails(head: HeadShape, layout: FaceLayout, skinConfig: AppearanceConfig["skin"], skin: string): THREE.BufferGeometry[] {
  const pieces: THREE.BufferGeometry[] = [];
  const count = skinConfig.freckles === "many" ? 46 : skinConfig.freckles === "light" ? 20 : 0;
  if (count > 0) {
    const random = seeded(1234 + count);
    const colour = rgb(mixHex(skinShadeColour(skin, 0.13), "#8a4b2a", 0.25));
    for (let i = 0; i < count; i++) {
      const x = (random() * 2 - 1) * head.hw * 0.62;
      const spread = 1 - Math.abs(x) / (head.hw * 0.62);
      const y = layout.noseTipY + head.hh * (0.08 + random() * 0.2) + spread * head.hh * 0.05;
      if (Math.abs(x) < layout.eyeX + layout.eyeWidth * 0.5 && y > layout.eyeY - layout.eyeHeight * 0.75) continue;
      const r = 0.0009 + random() * 0.0007;
      pieces.push(decalFan(head, [x, y], circle(x, y, r, r, 6), () => colour, 0.0005));
    }
  }
  const markSpots: Record<string, P2> = {
    "cheek-left": [layout.eyeX * 1.05, layout.noseTipY - head.hh * 0.02],
    "cheek-right": [-layout.eyeX * 1.05, layout.noseTipY - head.hh * 0.02],
    lip: [layout.mouthWidth * 0.32, layout.mouthY + head.hh * 0.1],
    chin: [layout.mouthWidth * 0.18, layout.mouthY - head.hh * 0.2],
  };
  const spot = markSpots[skinConfig.mark];
  if (spot) {
    const colour = rgb(mixHex(skinShadeColour(skin, 0.3), "#2a1812", 0.5));
    pieces.push(decalFan(head, spot, circle(spot[0], spot[1], 0.0016, 0.0016, 8), () => colour, 0.0006));
  }
  return pieces;
}

/**
 * Weight (0–1) of the facial-hair region at a head vertex: jaw, chin and upper
 * lip, with a hole for the mouth. `d` is the vertex's unit direction (for
 * the azimuth), `yy` its height in half-head units (mouth ≈ -0.64, chin ≈ -1).
 */
export function beardWeight(d: THREE.Vector3Like, yy: number, style: string): number {
  const az = Math.atan2(d.x, d.z);
  const a = Math.abs(az);
  if (a > 1.8) return 0;
  // Upper edge: moustache under the nose → cheek line → sideburn by the ear.
  const top = curve(
    [
      [0, -0.48],
      [0.45, -0.5],
      [0.8, -0.44],
      [1.2, -0.26],
      [1.45, -0.06],
      [1.8, 0.04],
    ],
    a,
  );
  let w = smoothstep(top + 0.04, top - 0.04, yy);
  if (style === "moustache" || style === "goatee") {
    // Narrow at the ends, drooping a little at the corners of the mouth.
    const bottom = -0.585 - 0.05 * smoothstep(0.2, 0.45, a);
    const moustache = smoothstep(0.47, 0.3, a) * smoothstep(top + 0.02, top - 0.03, yy) * smoothstep(bottom - 0.02, bottom + 0.01, yy);
    const goatee = style === "goatee" ? smoothstep(0.36, 0.24, a) * smoothstep(-0.7, -0.78, yy) : 0;
    w = Math.max(moustache, goatee);
  }
  // Keep the lips clear.
  const inMouth = (az / 0.3) ** 2 + ((yy + 0.645) / 0.085) ** 2 < 1;
  return inMouth ? 0 : w;
}

export interface HeadBuild {
  head: HeadShape;
  layout: FaceLayout;
  pieces: THREE.BufferGeometry[];
}

/** Builds the head mesh (skin, blush, stubble) and all face features. */
export function buildHead(config: AppearanceConfig, metrics: BodyMetrics, skin: string, hairHex: string): HeadBuild {
  const head = new HeadShape(config.face, metrics);
  const layout = faceLayout(head, config.face);
  const { geometry, dirs } = head.mesh(48, 36);
  const skinColour = rgb(skin);
  const blush = rgb(blushColour(skin));
  const stubble = rgb(mixHex(skin, hairHex, 0.42));
  const stubbleOn = config.hair.facial !== "none";
  const blushCentres = [-1, 1].map((side) => new THREE.Vector3(side * 0.56, -0.3, 0.77).normalize());
  paintWith(geometry, (p, _n, i) => {
    const d = dirs[i]!;
    let c = skinColour.clone();
    if (config.skin.blush > 0.01) {
      let weight = 0;
      for (const centre of blushCentres) weight = Math.max(weight, 1 - d.angleTo(centre) / 0.4);
      if (weight > 0) c = c.lerp(blush, Math.min(1, weight * weight * (3 - 2 * weight) * config.skin.blush * 0.55));
    }
    if (stubbleOn) {
      const w = beardWeight(d, p.y / head.hh, config.hair.facial === "moustache" || config.hair.facial === "goatee" ? config.hair.facial : "stubble");
      if (w > 0) c = c.lerp(stubble, w * 0.55);
    }
    return c;
  });
  const pieces = [geometry];
  // Ears.
  for (const side of [-1, 1]) {
    const d = new THREE.Vector3(side, -0.12, -0.02).normalize();
    const p = head.point(d);
    const ear = ellipsoid(
      { x: head.hw * 0.13, y: head.hh * 0.27, z: head.hd * 0.2 },
      { x: p.x + side * head.hw * 0.04, y: p.y, z: p.z },
      skin,
      { width: 12, height: 10 },
      new THREE.Euler(0, side * 0.35, side * -0.08),
    );
    const inner = rgb(skinShadeColour(skin, 0.07));
    paintWith(ear, (q, n) => (n.x * side < 0.1 && q.z > p.z - head.hd * 0.05 ? inner : skinColour));
    pieces.push(ear);
  }
  pieces.push(...eyePieces(head, layout, config.face, skin, hairHex));
  pieces.push(...browPieces(head, layout, config.face, hairHex));
  pieces.push(...nosePieces(head, layout, config.face, skin));
  pieces.push(...lipPieces(head, layout, config.face, skin));
  pieces.push(...skinDetails(head, layout, config.skin, skin));
  return { head, layout, pieces };
}

export { merge };
