// Hair and facial hair as real geometry (D-027): every style in the
// catalogue has its own shape, so choosing a style always changes the model.
// Built in head space from the deformed head (HeadShape), so hair follows
// the face and head shape and never sinks into it. Strand placement is
// seeded, so every client draws the same hair for the same look.
//
// Building blocks:
//   shell   a layer over the scalp (or beard area) with a thickness per
//           direction that tapers to nothing at the hairline
//   lock    a strand swept along a hanging path that clears the head, neck,
//           shoulders and torso (locs, braids, long hair locks, ponytails)
//   puffs   bumpy spheres (curls, buns, afro puffs)

import * as THREE from "three";
import { hairStyleInfo, mixHex, shadeHex, type AppearanceConfig, type Hairline, type HairVisibility } from "@padova/shared";
import {
  clamp,
  curve,
  ellipsoid,
  filterTriangles,
  lerp,
  paintWith,
  rgb,
  seeded,
  smoothNormals,
  smoothstep,
  standardise,
  sweep,
  waves,
} from "./geometry.ts";
import { beardWeight, type FaceLayout, type HeadShape } from "./head.ts";
import type { BodyMetrics } from "./metrics.ts";

export interface HairBuild {
  pieces: THREE.BufferGeometry[];
  /** Hair thickness (m) above the scalp in a direction; accessories sit on top of it. */
  thicknessAt: (d: THREE.Vector3) => number;
}

/** Elevation (radians) of the hairline for an azimuth |φ| (0 = forehead centre, π = nape). */
function hairlineElevation(hairline: Hairline, a: number): number {
  const points: [number, number][] =
    hairline === "straight"
      ? [[0, 0.58], [0.5, 0.58], [0.85, 0.46], [1.15, 0.08], [1.38, -0.16], [1.5, 0.22], [1.75, 0.24], [1.98, -0.2], [2.4, -0.62], [Math.PI, -0.72]]
      : hairline === "receding"
        ? [[0, 0.68], [0.42, 0.8], [0.85, 0.6], [1.15, 0.1], [1.38, -0.14], [1.5, 0.22], [1.75, 0.24], [1.98, -0.2], [2.4, -0.6], [Math.PI, -0.7]]
        : [[0, 0.6], [0.45, 0.56], [0.85, 0.42], [1.15, 0.08], [1.38, -0.18], [1.5, 0.22], [1.75, 0.24], [1.98, -0.2], [2.4, -0.62], [Math.PI, -0.72]];
  let e = curve(points, a);
  if (hairline === "peak") e -= 0.14 * Math.max(0, 1 - a / 0.2);
  return e;
}

/** Hair coverage of a scalp direction, 0 (skin) … 1 (hair), soft at the hairline. */
export function scalpWeight(d: THREE.Vector3Like, hairline: Hairline, lower = 0): number {
  const a = Math.abs(Math.atan2(d.x, d.z));
  const e = Math.asin(clamp(d.y, -1, 1));
  const edge = hairlineElevation(hairline, a) - lower;
  return smoothstep(edge - 0.05, edge + 0.05, e);
}

/** Approximate outward normal of the head surface at a point (ellipsoid normal). */
function headNormal(head: HeadShape, p: THREE.Vector3): THREE.Vector3 {
  return new THREE.Vector3(p.x / (head.hw * head.hw), p.y / (head.hh * head.hh), p.z / (head.hd * head.hd)).normalize();
}

interface ShellOptions {
  weight: (d: THREE.Vector3, p: THREE.Vector3) => number;
  thickness: (d: THREE.Vector3, w: number, p: THREE.Vector3) => number;
  colour: (d: THREE.Vector3, w: number, p: THREE.Vector3) => THREE.Color;
  segments?: [number, number];
}

/** A layer over part of the head. Tapers into the skin where the weight falls to zero. */
export function shell(head: HeadShape, options: ShellOptions): THREE.BufferGeometry {
  // Same tessellation as the head mesh, so the hairline meets the skin smoothly.
  const [ws, hs] = options.segments ?? [48, 36];
  const geometry = new THREE.SphereGeometry(1, ws, hs);
  const position = geometry.getAttribute("position") as THREE.BufferAttribute;
  const weights: number[] = [];
  const colours: THREE.Color[] = [];
  const p = new THREE.Vector3();
  for (let i = 0; i < position.count; i++) {
    const d = new THREE.Vector3().fromBufferAttribute(position, i).normalize();
    head.point(d, p);
    const w = options.weight(d, p);
    weights.push(w);
    const offset = w > 0 ? options.thickness(d, w, p) * w - 0.0025 * (1 - w) : -0.004;
    const n = headNormal(head, p);
    const q = p.clone().addScaledVector(n, offset);
    position.setXYZ(i, q.x, q.y, q.z);
    colours.push(options.colour(d, w, q));
  }
  standardise(geometry);
  filterTriangles(geometry, (i) => weights[i]! > 0.03);
  smoothNormals(geometry);
  paintWith(geometry, (_p, _n, i) => colours[i]!);
  return geometry;
}

/** Bumpy sphere, for curls, puffs and buns. */
function puff(centre: THREE.Vector3, radius: number, colour: THREE.Color, bumpiness: number, seed: number, detail = 1): THREE.BufferGeometry {
  const geometry = new THREE.IcosahedronGeometry(radius, detail);
  const position = geometry.getAttribute("position") as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  for (let i = 0; i < position.count; i++) {
    v.fromBufferAttribute(position, i);
    const n = v.clone().normalize();
    const bump = 1 + bumpiness * waves(n.x + seed, n.y - seed * 0.5, n.z + seed * 0.3, 7);
    v.copy(n).multiplyScalar(radius * bump).add(centre);
    position.setXYZ(i, v.x, v.y, v.z);
  }
  standardise(geometry);
  smoothNormals(geometry);
  return paintWith(geometry, (p) => (p.y < centre.y - radius * 0.3 ? colour.clone().multiplyScalar(0.82) : colour));
}

interface Clearance {
  head: HeadShape;
  metrics: BodyMetrics;
}

/** Horizontal half-extents of the body at a head-space height, for hanging hair. */
function bodyExtent(c: Clearance, y: number): { rx: number; rz: number; region: "head" | "neck" | "torso" } {
  const { head, metrics } = c;
  const figureY = metrics.headCentreY + y;
  if (y > -head.hh * 0.95) {
    const t = clamp(y / (y > 0 ? head.hh * 1.04 : head.hh), -1, 1);
    const k = Math.sqrt(Math.max(0.05, 1 - t * t));
    // Ears stick out a little at their height.
    const ear = y < head.hh * 0.15 && y > -head.hh * 0.4 ? head.hw * 0.12 : 0;
    return { rx: head.hw * k + ear, rz: head.hd * k, region: "head" };
  }
  const ramp = smoothstep(metrics.shoulderY + 0.05, metrics.shoulderY - 0.03, figureY);
  if (ramp < 0.02) return { rx: metrics.neckRadius + 0.012, rz: metrics.neckRadius + 0.012, region: "neck" };
  return {
    rx: lerp(metrics.neckRadius + 0.012, metrics.shoulderHalfWidth + 0.01, ramp),
    rz: lerp(metrics.neckRadius + 0.012, metrics.chestHalfDepth + metrics.bust + 0.015, ramp),
    region: ramp < 0.9 ? "neck" : "torso",
  };
}

interface LockOptions {
  /** Unit direction of the root on the scalp. */
  root: THREE.Vector3;
  /** Head-space y where the lock ends. */
  endY: number;
  radius: number;
  /** Radius at the tip, as a fraction of `radius`. */
  tip: number;
  /** >1 flattens the lock into a ribbon (long straight hair). */
  flatten?: number;
  /** Distance from the scalp at the root (sit on top of the shell). */
  lift: number;
  /** Sideways wave amplitude (m) and wavelength (m), for wavy or curly locks. */
  wave?: [number, number];
  /** Outward drift (m) at the end, to spread the hair. */
  spread?: number;
  /** Side of the shoulders the lock falls on when it reaches them. */
  side: "front" | "back";
  colour: (t: number, angle: number) => THREE.Color;
  radial?: number;
  points?: number;
}

/** A strand from the scalp down to `endY`, clear of the head, face and body. */
function lock(c: Clearance, o: LockOptions): { geometry: THREE.BufferGeometry; path: THREE.Vector3[] } {
  const { head } = c;
  const start = head.point(o.root).addScaledVector(headNormal(head, head.point(o.root)), o.lift);
  const count = o.points ?? 14;
  const path: THREE.Vector3[] = [start.clone()];
  // Locks rooted at the front fall beside the face, never over it.
  let fall = Math.atan2(start.x, start.z);
  if (Math.abs(fall) < 1.22) fall = (fall >= 0 ? 1 : -1) * lerp(1.22, 1.4, Math.abs(fall) / 1.22);
  const azimuth = new THREE.Vector2(Math.sin(fall), Math.cos(fall));
  const margin = o.lift + o.radius * 0.6;
  const steps = count - 1;
  let x = start.x;
  let z = start.z;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    // Fall faster at first along the head, then straight down.
    const y = lerp(start.y, o.endY, t);
    x += azimuth.x * (o.spread ?? 0) / steps;
    z += azimuth.y * (o.spread ?? 0) / steps;
    // Turn gradually towards the fall direction over the first part of the lock.
    {
      const r = Math.hypot(x, z);
      const angle = Math.atan2(x, z);
      let delta = fall - angle;
      while (delta > Math.PI) delta -= Math.PI * 2;
      while (delta < -Math.PI) delta += Math.PI * 2;
      const turned = angle + delta * Math.min(1, t * 2.5);
      x = Math.sin(turned) * r;
      z = Math.cos(turned) * r;
    }
    const extent = bodyExtent(c, y);
    if (extent.region === "head" || extent.region === "neck") {
      // Stay outside the ellipse (rx, rz) + margin, pushing out along the root's azimuth.
      const rx = extent.rx + margin;
      const rz = extent.rz + margin;
      const k = (x / rx) ** 2 + (z / rz) ** 2;
      if (k < 1) {
        const s = 1 / Math.sqrt(Math.max(k, 1e-6));
        const scale = k < 1e-6 ? 1 : s;
        x = k < 1e-6 ? azimuth.x * rx : x * scale;
        z = k < 1e-6 ? azimuth.y * rz : z * scale;
      }
      // Keep the face clear.
      const faceHalf = head.hw * 0.98 + margin;
      if (extent.region === "head" && z > 0 && y < head.hh * 0.55 && Math.abs(x) < faceHalf) x = (x >= 0 ? 1 : -1) * faceHalf;
    } else {
      // Over the shoulders: keep within the torso width, in front of or behind it.
      const maxX = extent.rx - 0.03;
      x = clamp(x, -maxX, maxX);
      const surface = extent.rz * Math.sqrt(Math.max(0, 1 - (x / (extent.rx + 0.02)) ** 2));
      if (o.side === "back") z = Math.min(z, -(surface + margin));
      else z = Math.max(z, surface + margin);
    }
    let wx = 0;
    let wz = 0;
    if (o.wave) {
      const phase = ((start.y - y) / o.wave[1]) * Math.PI * 2;
      const amp = o.wave[0] * smoothstep(0, 0.2, t);
      wx = -azimuth.y * Math.sin(phase) * amp;
      wz = azimuth.x * Math.sin(phase) * amp;
    }
    path.push(new THREE.Vector3(x + wx, y, z + wz));
  }
  // Smooth the corners where the path meets the shoulders.
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 1; i < path.length - 1; i++) path[i]!.lerp(path[i - 1]!.clone().add(path[i + 1]!).multiplyScalar(0.5), 0.5);
  }
  const outward = (i: number) => {
    const p = path[i]!;
    return new THREE.Vector3(p.x, 0, p.z).normalize();
  };
  const geometry = sweep(path, {
    radial: o.radial ?? 6,
    radius: (t) => o.radius * lerp(1, o.tip, smoothstep(0.55, 1, t)),
    flatten: o.flatten,
    up: o.flatten ? outward : undefined,
    colour: o.colour,
    capStart: true,
    capEnd: true,
  });
  return { geometry, path };
}

/** Points spread over a scalp region (golden-angle spiral), as unit directions. */
function scalpPoints(count: number, accept: (d: THREE.Vector3) => boolean, seed: number): THREE.Vector3[] {
  const out: THREE.Vector3[] = [];
  const random = seeded(seed);
  const golden = Math.PI * (3 - Math.sqrt(5));
  const total = count * 6;
  for (let i = 0; i < total && out.length < count; i++) {
    const y = 1 - (i / (total - 1)) * 2;
    const r = Math.sqrt(1 - y * y);
    const theta = golden * i + random() * 0.15;
    const d = new THREE.Vector3(Math.sin(theta) * r, y, Math.cos(theta) * r);
    if (accept(d)) out.push(d);
  }
  return out;
}

const dirFrom = (azimuth: number, elevation: number) =>
  new THREE.Vector3(Math.sin(azimuth) * Math.cos(elevation), Math.sin(elevation), Math.cos(azimuth) * Math.cos(elevation));

/**
 * Builds the visible hair for a look. `visibility` comes from the shared
 * layer rules (a headwrap hides it all, a cap keeps only what hangs below).
 */
export function buildHair(
  config: AppearanceConfig,
  head: HeadShape,
  layout: FaceLayout,
  metrics: BodyMetrics,
  hairHex: string,
  skin: string,
  visibility: HairVisibility,
): HairBuild {
  const style = config.hair.style;
  const info = hairStyleInfo(style);
  const pieces: THREE.BufferGeometry[] = [];
  const hairline = config.hair.hairline;
  const base = rgb(hairHex);
  const dark = rgb(shadeHex(hairHex, -0.07));
  const light = rgb(mixHex(hairHex, "#ffffff", 0.22));
  const skinColour = rgb(skin);
  const c: Clearance = { head, metrics };
  const random = seeded(style.length * 97 + 13);
  const top = visibility === "full";
  const long = visibility !== "hidden";
  let thicknessAt: (d: THREE.Vector3) => number = () => 0;

  if (!info || info.texture === "none" || visibility === "hidden") {
    return { pieces, thicknessAt };
  }

  const fringeEdge = layout.browY + head.hh * 0.05;
  /** Anime sheen: a lighter band across the crown on smooth styles. */
  const sheen = (d: THREE.Vector3, w: number, colour: THREE.Color) => {
    const e = Math.asin(d.y);
    const band = smoothstep(0.9, 0.98, e) * (1 - smoothstep(1.1, 1.18, e)) * smoothstep(-0.2, 0.6, d.z);
    return band > 0 ? colour.clone().lerp(light, band * 0.7 * w) : colour;
  };
  const scalpShell = (thickness: (d: THREE.Vector3) => number, opts: { fade?: boolean; bumpy?: number; glossy?: boolean; colour?: THREE.Color } = {}) => {
    const fadeAt = (d: THREE.Vector3) => (opts.fade ? smoothstep(0.55, 0.2, Math.asin(d.y)) * smoothstep(-0.1, 0.2, Math.abs(Math.atan2(d.x, d.z)) / Math.PI) : 0);
    const thick = (d: THREE.Vector3) => {
      const f = fadeAt(d);
      const bump = opts.bumpy ? opts.bumpy * (0.5 + 0.5 * waves(d.x, d.y, d.z, 9)) : 0;
      return lerp(thickness(d) + bump, 0.0022, f);
    };
    thicknessAt = thick;
    return shell(head, {
      weight: (d) => scalpWeight(d, hairline),
      thickness: (d) => thick(d),
      colour: (d, w) => {
        const f = fadeAt(d);
        let col = (opts.colour ?? base).clone();
        if (opts.glossy) col = sheen(d, w, col);
        if (f > 0) col = col.lerp(skinColour, f * 0.55);
        return col.lerp(skinColour, (1 - w) * 0.35);
      },
    });
  };
  const elevation = (d: THREE.Vector3) => Math.asin(clamp(d.y, -1, 1));
  const absAz = (d: THREE.Vector3) => Math.abs(Math.atan2(d.x, d.z));

  /** Locks forming a curtain of long hair (back and sides) plus front locks over the shoulders. */
  const curtain = (endY: number, opts: { radius: number; flatten: number; wave?: [number, number]; front: boolean; count: number; lift: number; curls?: boolean; colour?: (t: number) => THREE.Color }) => {
    const colourOf = opts.colour ?? ((t: number) => (t > 0.85 ? dark : base));
    const add = (built: { geometry: THREE.BufferGeometry; path: THREE.Vector3[] }) => {
      pieces.push(built.geometry);
      if (!opts.curls) return;
      // Ringlets along the lock.
      for (let k = 2; k < built.path.length; k += 1) {
        const p = built.path[k]!;
        const out = new THREE.Vector3(p.x, 0, p.z).normalize().multiplyScalar(0.006);
        pieces.push(puff(p.clone().add(out), opts.radius * 0.95 * (k % 2 === 0 ? 1 : 0.85), k % 3 === 0 ? dark : base, 0.25, k + random() * 5, 0));
      }
    };
    for (let i = 0; i < opts.count; i++) {
      const u = i / (opts.count - 1);
      const az = lerp(1.25, Math.PI * 2 - 1.25, u);
      const root = dirFrom(az + (random() - 0.5) * 0.08, lerp(0.75, 0.35, Math.abs(u - 0.5) * 2) + (random() - 0.5) * 0.1);
      add(
        lock(c, {
          root,
          endY: endY - Math.abs(u - 0.5) * 0.04 + (random() - 0.5) * 0.03,
          radius: opts.radius,
          tip: 0.25,
          flatten: opts.flatten,
          lift: opts.lift,
          wave: opts.wave,
          spread: 0.02,
          side: "back",
          colour: (t) => colourOf(t),
        }),
      );
    }
    if (opts.front) {
      for (const side of [-1, 1]) {
        for (const [az, el, len] of [[1.0, 0.55, 0.9], [1.28, 0.35, 0.8]] as const) {
          add(
            lock(c, {
              root: dirFrom(side * az, el),
              endY: lerp(-head.hh * 1.2, endY, len),
              radius: opts.radius * 0.9,
              tip: 0.25,
              flatten: opts.flatten,
              lift: opts.lift,
              wave: opts.wave,
              side: "front",
              colour: (t) => colourOf(t),
            }),
          );
        }
      }
    }
  };
  /** Fringe locks over the forehead, swept to one side. */
  const fringe = (count: number, sweepSide: number, length: number, width: number, lift: number) => {
    for (let i = 0; i < count; i++) {
      const u = count === 1 ? 0.5 : i / (count - 1);
      const az = lerp(-0.75, 0.75, u);
      const rootDir = dirFrom(az, 1.0);
      const rootPoint = head.point(rootDir);
      const path: THREE.Vector3[] = [];
      for (let k = 0; k <= 6; k++) {
        const t = k / 6;
        const x = lerp(rootPoint.x, rootPoint.x + sweepSide * head.hw * 0.25, t);
        const y = lerp(rootPoint.y, fringeEdge - (1 - Math.abs(u - 0.5) * 2) * head.hh * 0.06 * length + Math.abs(u - 0.5) * head.hh * 0.18, t);
        const s = head.front(clamp(x, -head.hw * 0.9, head.hw * 0.9), Math.min(y, head.hh * 0.95));
        path.push(s.position.addScaledVector(s.normal, lerp(lift, lift * 0.45, t)));
      }
      pieces.push(
        sweep(path, {
          radial: 6,
          radius: (t) => width * lerp(1, 0.2, smoothstep(0.4, 1, t)),
          flatten: 3,
          up: (k) => head.front(path[k]!.x, path[k]!.y).normal,
          colour: (t) => (t < 0.3 ? base.clone().lerp(light, 0.25) : base),
          capStart: true,
          capEnd: true,
        }),
      );
    }
  };

  const shoulderEnd = metrics.shoulderY - metrics.headCentreY - 0.06;
  const chestEnd = metrics.chestY - metrics.headCentreY - 0.04;
  const backEnd = metrics.waistY - metrics.headCentreY + 0.04;
  const chinEnd = -head.hh * 1.02;

  switch (style) {
    case "buzz":
      if (top) pieces.push(scalpShell(() => 0.0028, { colour: rgb(mixHex(hairHex, skin, 0.3)) }));
      break;

    case "fade-crop":
      if (top) {
        pieces.push(
          scalpShell((d) => lerp(0.01, 0.028, smoothstep(0.5, 1.1, elevation(d))) + 0.012 * smoothstep(0.3, 0.9, d.z) * smoothstep(0.75, 1.05, elevation(d)), {
            fade: true,
            bumpy: 0.007,
          }),
        );
      }
      break;

    case "curly-top-fade":
      if (top) {
        pieces.push(scalpShell((d) => lerp(0.006, 0.04, smoothstep(0.55, 1.1, elevation(d))), { fade: true, bumpy: 0.012 }));
        for (const d of scalpPoints(46, (d) => elevation(d) > 0.75 && scalpWeight(d, hairline) > 0.8, 21)) {
          const p = head.point(d);
          const n = headNormal(head, p);
          pieces.push(puff(p.addScaledVector(n, 0.036), 0.012 + random() * 0.005, random() > 0.5 ? base : dark, 0.25, random() * 10, 0));
        }
      }
      break;

    case "short-straight":
      if (top) {
        pieces.push(scalpShell((d) => lerp(0.012, 0.024, smoothstep(0.2, 1.0, elevation(d))), { glossy: true }));
        fringe(7, 1, 1, 0.0085, 0.012);
      }
      break;

    case "short-curls":
      if (top) {
        pieces.push(scalpShell(() => 0.026, { bumpy: 0.01 }));
        for (const d of scalpPoints(72, (d) => scalpWeight(d, hairline) > 0.7, 33)) {
          const p = head.point(d);
          const n = headNormal(head, p);
          pieces.push(puff(p.addScaledVector(n, 0.03), 0.011 + random() * 0.005, random() > 0.6 ? dark : base, 0.3, random() * 10, 0));
        }
      }
      break;

    case "twists":
      if (top) {
        pieces.push(scalpShell(() => 0.01, { colour: dark }));
        for (const d of scalpPoints(62, (d) => scalpWeight(d, hairline) > 0.75, 44)) {
          const p = head.point(d);
          const n = headNormal(head, p);
          const len = 0.05 + random() * 0.03;
          const droop = new THREE.Vector3(0, -1, 0);
          const path = [0, 0.25, 0.5, 0.75, 1].map((t) => p.clone().addScaledVector(n, 0.006 + len * t * (1 - 0.35 * t)).addScaledVector(droop, len * t * t * (n.y > 0.6 ? 0.5 : 1.1)));
          pieces.push(
            sweep(path, {
              radial: 6,
              radius: (t) => 0.0075 * lerp(1, 0.55, t),
              colour: (t) => (Math.floor(t * 7) % 2 === 0 ? base : dark),
              capEnd: true,
            }),
          );
        }
      }
      break;

    case "afro":
      if (top) {
        pieces.push(
          scalpShell(
            (d) => {
              const e = elevation(d);
              const back = smoothstep(0.3, -0.6, d.z);
              return 0.06 + 0.05 * smoothstep(-0.2, 0.9, e) + 0.025 * back - 0.02 * smoothstep(0.3, 0.9, d.z) * smoothstep(0.9, 0.4, e);
            },
            { bumpy: 0.014 },
          ),
        );
        for (const d of scalpPoints(70, (d) => scalpWeight(d, hairline) > 0.85 && d.z < 0.7, 55)) {
          const p = head.point(d);
          const n = headNormal(head, p);
          const e = elevation(d);
          const t = 0.06 + 0.05 * smoothstep(-0.2, 0.9, e) + 0.025 * smoothstep(0.3, -0.6, d.z);
          pieces.push(puff(p.addScaledVector(n, t + 0.004), 0.016 + random() * 0.006, random() > 0.5 ? base : dark, 0.2, random() * 10, 0));
        }
      }
      break;

    case "afro-puffs":
      if (top) {
        pieces.push(scalpShell(() => 0.008, { colour: base }));
        for (const side of [-1, 1]) {
          const d = dirFrom(side * 1.05, 0.72);
          const p = head.point(d);
          const n = headNormal(head, p);
          const r = 0.058 * (metrics.height / 1.72);
          pieces.push(puff(p.clone().addScaledVector(n, r * 0.9), r, base, 0.12, side * 3, 2));
          const tie = new THREE.TorusGeometry(r * 0.42, 0.006, 6, 18);
          tie.lookAt(n);
          tie.translate(p.x + n.x * 0.012, p.y + n.y * 0.012, p.z + n.z * 0.012);
          pieces.push(paintWith(standardise(tie), () => rgb("#2a2426")));
        }
      }
      break;

    case "wavy-bob":
      if (top) {
        pieces.push(scalpShell((d) => lerp(0.016, 0.026, smoothstep(0.2, 1.0, elevation(d))), { glossy: true }));
        fringe(4, -1, 0.8, 0.011, 0.016);
      }
      if (long) curtain(chinEnd, { radius: 0.017, flatten: 2.4, wave: [0.006, 0.07], front: false, count: 15, lift: 0.016 });
      break;

    case "cornrows":
      if (top) {
        pieces.push(scalpShell(() => 0.0035, { colour: dark }));
        const rows = 8;
        for (let r = 0; r < rows; r++) {
          // Each row runs front to back over the crown, offset sideways by `side`.
          const side = lerp(-0.78, 0.78, r / (rows - 1));
          const k = Math.sqrt(1 - side * side);
          const startBeta = hairlineElevation(hairline, Math.abs(side) * 1.1) + 0.1;
          const path: THREE.Vector3[] = [];
          for (let i = 0; i <= 18; i++) {
            const beta = lerp(startBeta, Math.PI + 0.72, i / 18);
            const d = new THREE.Vector3(side, Math.sin(beta) * k, Math.cos(beta) * k).normalize();
            const p = head.point(d);
            path.push(p.addScaledVector(headNormal(head, p), 0.0055));
          }
          pieces.push(
            sweep(path, {
              radial: 6,
              radius: () => 0.0058,
              colour: (t) => (Math.floor(t * 40) % 2 === 0 ? base : dark),
              capStart: true,
            }),
          );
          // Short braid ends at the nape.
          const end = path[path.length - 1]!;
          pieces.push(
            sweep([end, end.clone().add(new THREE.Vector3(0, -0.04, -0.01)), end.clone().add(new THREE.Vector3(0, -0.07, -0.012))], {
              radial: 5,
              radius: (t) => 0.005 * lerp(1, 0.6, t),
              colour: (t) => (Math.floor(t * 8) % 2 === 0 ? base : dark),
              capEnd: true,
            }),
          );
        }
      }
      break;

    case "locs":
      if (top) pieces.push(scalpShell(() => 0.01, { colour: dark }));
      if (long) {
        for (const d of scalpPoints(36, (d) => scalpWeight(d, hairline) > 0.7, 66)) {
          const front = absAz(d) < 1.15;
          pieces.push(
            lock(c, {
              root: d,
              endY: shoulderEnd - 0.03 - random() * 0.06,
              radius: 0.0115,
              tip: 0.75,
              lift: 0.012,
              spread: 0.015,
              side: front ? "front" : "back",
              colour: (t) => (Math.sin(t * 40 + random() * 6) > 0.6 ? dark : base),
              radial: 6,
              points: 12,
            }).geometry,
          );
        }
      }
      break;

    case "box-braids":
      if (top) pieces.push(scalpShell(() => 0.008, { colour: dark }));
      if (long) {
        for (const d of scalpPoints(58, (d) => scalpWeight(d, hairline) > 0.7, 77)) {
          const front = absAz(d) < 1.2 && d.y < 0.6;
          pieces.push(
            lock(c, {
              root: d,
              endY: (front ? chestEnd : backEnd) - random() * 0.05,
              radius: 0.0074,
              tip: 0.6,
              lift: 0.009,
              spread: 0.02,
              side: front ? "front" : "back",
              colour: (t) => (Math.floor(t * 60) % 2 === 0 ? base : dark),
              radial: 5,
              points: 14,
            }).geometry,
          );
        }
      }
      break;

    case "ponytail":
    case "top-bun": {
      if (top) pieces.push(scalpShell(() => 0.011, { glossy: true }));
      const bun = style === "top-bun";
      const tieDir = bun ? dirFrom(Math.PI, 1.3) : dirFrom(Math.PI, 0.55);
      const tiePoint = head.point(tieDir);
      const tieNormal = headNormal(head, tiePoint);
      if (top || (!bun && long)) {
        const tie = new THREE.TorusGeometry(0.017, 0.006, 6, 16);
        tie.lookAt(tieNormal);
        tie.translate(tiePoint.x + tieNormal.x * 0.014, tiePoint.y + tieNormal.y * 0.014, tiePoint.z + tieNormal.z * 0.014);
        pieces.push(paintWith(standardise(tie), () => rgb("#2a2426")));
      }
      if (bun && top) {
        pieces.push(puff(tiePoint.clone().addScaledVector(tieNormal, 0.05), 0.044, base, 0.08, 4, 2));
      } else if (!bun && long) {
        const start = tiePoint.clone().addScaledVector(tieNormal, 0.016);
        const path = [
          start,
          start.clone().add(new THREE.Vector3(0, 0.01, -0.05)),
          start.clone().add(new THREE.Vector3(0, -0.05, -0.085)),
          start.clone().add(new THREE.Vector3(0, -0.13, -0.09)),
          start.clone().add(new THREE.Vector3(0, -0.22, -0.075)),
          start.clone().add(new THREE.Vector3(0, -0.3, -0.06)),
        ];
        // Keep the tail clear of the back.
        for (const p of path) {
          const extent = bodyExtent(c, p.y);
          if (extent.region !== "head") p.z = Math.min(p.z, -(extent.rz + 0.03));
        }
        pieces.push(
          sweep(path, {
            radial: 8,
            radius: (t) => 0.024 * lerp(0.8, 1.15, smoothstep(0, 0.25, t)) * lerp(1, 0.2, smoothstep(0.5, 1, t)),
            flatten: 1.25,
            colour: (t) => (t > 0.8 ? dark : base),
            capStart: true,
            capEnd: true,
          }),
        );
      }
      break;
    }

    case "long-straight":
      if (top) {
        pieces.push(scalpShell((d) => lerp(0.012, 0.02, smoothstep(0.2, 1.0, elevation(d))), { glossy: true }));
        fringe(5, -1, 0.9, 0.01, 0.014);
      }
      if (long) curtain(backEnd, { radius: 0.019, flatten: 2.2, front: true, count: 15, lift: 0.014 });
      break;

    case "long-curly":
      if (top) {
        pieces.push(scalpShell(() => 0.032, { bumpy: 0.012 }));
        for (const d of scalpPoints(40, (d) => scalpWeight(d, hairline) > 0.8 && d.y > 0.2, 88)) {
          const p = head.point(d);
          const n = headNormal(head, p);
          pieces.push(puff(p.addScaledVector(n, 0.036), 0.013 + random() * 0.005, random() > 0.5 ? dark : base, 0.3, random() * 10, 0));
        }
      }
      if (long) curtain(chestEnd + 0.02, { radius: 0.017, flatten: 1.2, wave: [0.012, 0.055], front: true, count: 13, lift: 0.03, curls: true });
      break;

    default:
      break;
  }

  return { pieces, thicknessAt };
}

/** Moustaches and beards as geometry; stubble is drawn into the skin colour (head.ts). */
export function buildFacialHair(config: AppearanceConfig, head: HeadShape, hairHex: string): THREE.BufferGeometry[] {
  const style = config.hair.facial;
  if (style === "none" || style === "stubble") return [];
  const colour = rgb(shadeHex(hairHex, -0.04));
  const full = style === "full-beard";
  const thickness = style === "short-beard" ? 0.006 : full ? 0.016 : 0.0045;
  return [
    shell(head, {
      weight: (d, p) => beardWeight(d, p.y / head.hh, style),
      thickness: (d, _w, p) => {
        const yy = p.y / head.hh;
        const underChin = full ? 0.02 * smoothstep(-0.75, -1.05, yy) * smoothstep(-0.2, 0.4, d.z) : 0;
        const bump = full ? 0.004 * waves(d.x, d.y, d.z, 12) : 0;
        return thickness + underChin + bump;
      },
      colour: () => colour,
      segments: [48, 36],
    }),
  ];
}

export { ellipsoid };
