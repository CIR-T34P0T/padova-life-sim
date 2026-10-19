// Low-level geometry helpers for the procedural characters (D-027, D-030).
// Every piece of a character is a BufferGeometry with the same attributes
// (position, normal, uv, color) and an index, so the pieces of one body part
// can be merged into a single mesh (one draw call) and coloured per vertex.
// Pure geometry: no materials, no scene objects.

import * as THREE from "three";
import { mergeGeometries, mergeVertices } from "three/addons/utils/BufferGeometryUtils.js";

export type Colour = THREE.Color;
export type ColourInput = THREE.Color | string;

/** Linear-space colour from a CSS hex string (three converts sRGB → linear). */
export const rgb = (value: ColourInput): THREE.Color => (typeof value === "string" ? new THREE.Color(value) : value);

const tmp = new THREE.Vector3();
const tmpNormal = new THREE.Vector3();

/** Adds any missing standard attribute (color white, uv zero) and an index. */
export function standardise(geometry: THREE.BufferGeometry): THREE.BufferGeometry {
  const count = geometry.getAttribute("position").count;
  if (!geometry.getAttribute("normal")) geometry.computeVertexNormals();
  if (!geometry.getAttribute("uv")) geometry.setAttribute("uv", new THREE.Float32BufferAttribute(new Float32Array(count * 2), 2));
  if (!geometry.getAttribute("color")) {
    geometry.setAttribute("color", new THREE.Float32BufferAttribute(new Float32Array(count * 3).fill(1), 3));
  }
  if (!geometry.index) {
    const index = new (count > 65535 ? Uint32Array : Uint16Array)(count);
    for (let i = 0; i < count; i++) index[i] = i;
    geometry.setIndex(new THREE.BufferAttribute(index, 1));
  }
  for (const name of Object.keys(geometry.attributes)) {
    if (!["position", "normal", "uv", "color"].includes(name)) geometry.deleteAttribute(name);
  }
  geometry.morphAttributes = {};
  geometry.clearGroups();
  return geometry;
}

/** Colours every vertex the same. */
export function paint(geometry: THREE.BufferGeometry, colour: ColourInput): THREE.BufferGeometry {
  const c = rgb(colour);
  return paintWith(geometry, () => c);
}

/** Colours each vertex from its position and normal (in the geometry's own space). */
export function paintWith(
  geometry: THREE.BufferGeometry,
  colourAt: (position: THREE.Vector3, normal: THREE.Vector3, index: number) => THREE.Color,
): THREE.BufferGeometry {
  standardise(geometry);
  const position = geometry.getAttribute("position");
  const normal = geometry.getAttribute("normal");
  const colour = geometry.getAttribute("color") as THREE.BufferAttribute;
  for (let i = 0; i < position.count; i++) {
    tmp.fromBufferAttribute(position, i);
    tmpNormal.fromBufferAttribute(normal, i);
    const c = colourAt(tmp, tmpNormal, i);
    colour.setXYZ(i, c.r, c.g, c.b);
  }
  colour.needsUpdate = true;
  return geometry;
}

/** Applies a transform (and fixes normals) in place. */
export function place(
  geometry: THREE.BufferGeometry,
  position: THREE.Vector3Like = { x: 0, y: 0, z: 0 },
  rotation: THREE.Euler | null = null,
  scale: THREE.Vector3Like | number = 1,
): THREE.BufferGeometry {
  const matrix = new THREE.Matrix4().compose(
    new THREE.Vector3(position.x, position.y, position.z),
    new THREE.Quaternion().setFromEuler(rotation ?? new THREE.Euler()),
    typeof scale === "number" ? new THREE.Vector3(scale, scale, scale) : new THREE.Vector3(scale.x, scale.y, scale.z),
  );
  geometry.applyMatrix4(matrix);
  return geometry;
}

/** Merges standardised pieces into one geometry. Empty list → empty geometry. */
export function merge(pieces: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const usable = pieces.filter((piece) => piece.getAttribute("position").count > 0).map(standardise);
  if (usable.length === 0) return standardise(new THREE.BufferGeometry().setAttribute("position", new THREE.Float32BufferAttribute([], 3)));
  // Mixed 16/32-bit indices are fine for mergeGeometries.
  const merged = mergeGeometries(usable, false);
  if (!merged) throw new Error("Avatar geometry merge failed (attribute mismatch)");
  for (const piece of usable) piece.dispose();
  return merged;
}

/** Smooth normals across duplicated seam vertices (sphere seams, poles). */
export function smoothNormals(geometry: THREE.BufferGeometry): THREE.BufferGeometry {
  const stripped = geometry.clone();
  stripped.deleteAttribute("normal");
  stripped.deleteAttribute("uv");
  stripped.deleteAttribute("color");
  const welded = mergeVertices(stripped, 1e-5);
  welded.computeVertexNormals();
  // Copy welded normals back to the original vertices by position.
  const lookup = new Map<string, number>();
  const wp = welded.getAttribute("position");
  for (let i = 0; i < wp.count; i++) lookup.set(key(wp.getX(i), wp.getY(i), wp.getZ(i)), i);
  const wn = welded.getAttribute("normal");
  const position = geometry.getAttribute("position");
  const normal = new Float32Array(position.count * 3);
  for (let i = 0; i < position.count; i++) {
    const j = lookup.get(key(position.getX(i), position.getY(i), position.getZ(i)));
    if (j === undefined) continue;
    normal[i * 3] = wn.getX(j);
    normal[i * 3 + 1] = wn.getY(j);
    normal[i * 3 + 2] = wn.getZ(j);
  }
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normal, 3));
  stripped.dispose();
  welded.dispose();
  return geometry;
}

const key = (x: number, y: number, z: number) => `${Math.round(x * 1e5)},${Math.round(y * 1e5)},${Math.round(z * 1e5)}`;

/** Removes triangles for which `keep` is false for all three vertices' indices. */
export function filterTriangles(geometry: THREE.BufferGeometry, keepVertex: (index: number) => boolean): THREE.BufferGeometry {
  const index = geometry.index;
  if (!index) return geometry;
  const kept: number[] = [];
  for (let i = 0; i < index.count; i += 3) {
    const a = index.getX(i);
    const b = index.getX(i + 1);
    const c = index.getX(i + 2);
    if (keepVertex(a) || keepVertex(b) || keepVertex(c)) kept.push(a, b, c);
  }
  geometry.setIndex(kept);
  return geometry;
}

// ── Tubes: torso, limbs, sleeves, skirts, hair curtains ─────────────────────

export interface Ring {
  y: number;
  /** Half-width (x) and half-depth (z) of the elliptical cross-section. */
  rx: number;
  rz: number;
  /** Centre offset of the cross-section. */
  cx?: number;
  cz?: number;
}

export interface TubeOptions {
  segments: number;
  /** Partial ring [start, end] in radians (0 = front/+Z, increasing towards +X). Open seam. */
  arc?: [number, number];
  /** Per-ring arc (overrides `arc`), e.g. a jacket opening that widens towards the chest. */
  arcAt?: (ring: number, y: number) => [number, number];
  capBottom?: boolean;
  capTop?: boolean;
  /** Pattern tile size in metres for UVs (default 0.1). */
  tile?: number;
  /** Colour per vertex: ring index, angle, position. */
  colour?: (ring: number, angle: number, position: THREE.Vector3) => THREE.Color;
  /** Extra radial displacement (metres) per vertex, e.g. for waves or folds. */
  displace?: (ring: number, angle: number, y: number) => number;
}

/**
 * A tube through a list of elliptical rings stacked along Y (bottom to top
 * or top to bottom). Angle 0 faces +Z. Normals are analytic (smooth), UVs
 * are in metres / tile so patterns keep the same scale on every garment.
 */
export function ringTube(rings: readonly Ring[], options: TubeOptions): THREE.BufferGeometry {
  const { segments } = options;
  const arc = options.arc ?? [0, Math.PI * 2];
  const closed = !options.arc && !options.arcAt;
  const columns = closed ? segments : segments + 1;
  const tile = options.tile ?? 0.1;
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const colours: number[] = [];
  const indices: number[] = [];
  const white = new THREE.Color(1, 1, 1);
  const p = new THREE.Vector3();

  const slope = (i: number) => {
    // dr/dy from the nearest rings with a different y (handles duplicate rings at hard colour edges).
    let lo = i;
    let hi = i;
    while (lo > 0 && rings[lo]!.y === rings[i]!.y) lo--;
    while (hi < rings.length - 1 && rings[hi]!.y === rings[i]!.y) hi++;
    const a = rings[lo]!;
    const b = rings[hi]!;
    if (a.y === b.y) return 0;
    return ((b.rx + b.rz) / 2 - (a.rx + a.rz) / 2) / (b.y - a.y);
  };

  let vLength = 0;
  for (let r = 0; r < rings.length; r++) {
    const ring = rings[r]!;
    if (r > 0) vLength += Math.abs(ring.y - rings[r - 1]!.y) + Math.abs((ring.rx - rings[r - 1]!.rx) * 0.5);
    const drdy = slope(r);
    const perimeter = Math.PI * (ring.rx + ring.rz);
    const [a0, a1] = options.arcAt?.(r, ring.y) ?? arc;
    for (let s = 0; s < columns; s++) {
      const t = s / segments;
      const angle = a0 + (a1 - a0) * t;
      const sin = Math.sin(angle);
      const cos = Math.cos(angle);
      const extra = options.displace?.(r, angle, ring.y) ?? 0;
      p.set((ring.cx ?? 0) + (ring.rx + extra) * sin, ring.y, (ring.cz ?? 0) + (ring.rz + extra) * cos);
      positions.push(p.x, p.y, p.z);
      const hx = sin * ring.rz;
      const hz = cos * ring.rx;
      const hl = Math.hypot(hx, hz) || 1;
      const n = new THREE.Vector3(hx / hl, -drdy, hz / hl).normalize();
      normals.push(n.x, n.y, n.z);
      uvs.push(((angle / (Math.PI * 2)) * perimeter) / tile, vLength / tile);
      const c = options.colour?.(r, angle, p) ?? white;
      colours.push(c.r, c.g, c.b);
    }
  }
  const ascending = rings.length > 1 && rings[rings.length - 1]!.y >= rings[0]!.y;
  for (let r = 0; r < rings.length - 1; r++) {
    for (let s = 0; s < segments; s++) {
      const a = r * columns + s;
      const b = r * columns + ((s + 1) % columns);
      const c = (r + 1) * columns + s;
      const d = (r + 1) * columns + ((s + 1) % columns);
      if (ascending) indices.push(a, b, d, a, d, c);
      else indices.push(a, d, b, a, c, d);
    }
  }
  const cap = (ringIndex: number, top: boolean) => {
    const ring = rings[ringIndex]!;
    const centre = positions.length / 3;
    const dir = (top ? 1 : -1) * (ascending ? 1 : -1);
    positions.push(ring.cx ?? 0, ring.y + dir * Math.min(ring.rx, ring.rz) * 0.35, ring.cz ?? 0);
    normals.push(0, dir, 0);
    uvs.push(0, 0);
    const c = options.colour?.(ringIndex, 0, new THREE.Vector3(ring.cx ?? 0, ring.y, ring.cz ?? 0)) ?? white;
    colours.push(c.r, c.g, c.b);
    for (let s = 0; s < segments; s++) {
      const a = ringIndex * columns + s;
      const b = ringIndex * columns + ((s + 1) % columns);
      if (top === ascending) indices.push(a, b, centre);
      else indices.push(b, a, centre);
    }
  };
  if (options.capBottom && closed) cap(0, false);
  if (options.capTop && closed) cap(rings.length - 1, true);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colours, 3));
  geometry.setIndex(indices);
  return geometry;
}

// ── Sweeps: hair strands, braids, straps, frames ───────────────────────────

export interface SweepOptions {
  radial: number;
  /** Radius along the path, t from 0 (start) to 1 (end). */
  radius: (t: number) => number;
  /** Cross-section flattening: width multiplier along the side direction (default 1 = round). */
  flatten?: number;
  /** Preferred "up" for the cross-section (e.g. the head surface normal), per path point. */
  up?: (i: number) => THREE.Vector3;
  colour?: (t: number, angle: number) => THREE.Color;
  capStart?: boolean;
  capEnd?: boolean;
  closed?: boolean;
}

/** A tube swept along a polyline, with smooth (parallel transport) frames. */
export function sweep(path: readonly THREE.Vector3[], options: SweepOptions): THREE.BufferGeometry {
  const n = path.length;
  const radial = options.radial;
  const positions: number[] = [];
  const normals: number[] = [];
  const colours: number[] = [];
  const indices: number[] = [];
  const white = new THREE.Color(1, 1, 1);
  const lengths = [0];
  for (let i = 1; i < n; i++) lengths.push(lengths[i - 1]! + path[i]!.distanceTo(path[i - 1]!));
  const total = lengths[n - 1] || 1;

  const tangents = path.map((point, i) => {
    const prev = path[Math.max(0, i - 1)]!;
    const next = path[Math.min(n - 1, i + 1)]!;
    if (options.closed) {
      const p = path[(i - 1 + n) % n]!;
      const q = path[(i + 1) % n]!;
      return q.clone().sub(p).normalize();
    }
    return next.clone().sub(prev).normalize();
  });
  // Initial normal: the requested up projected on the plane, or any perpendicular.
  let normal = (options.up?.(0) ?? new THREE.Vector3(0, 0, 1)).clone();
  normal.sub(tangents[0]!.clone().multiplyScalar(normal.dot(tangents[0]!)));
  if (normal.lengthSq() < 1e-8) normal = new THREE.Vector3(1, 0, 0).cross(tangents[0]!);
  if (normal.lengthSq() < 1e-8) normal = new THREE.Vector3(0, 1, 0).cross(tangents[0]!);
  normal.normalize();

  const flatten = options.flatten ?? 1;
  for (let i = 0; i < n; i++) {
    const tangent = tangents[i]!;
    if (i > 0) {
      if (options.up) {
        normal = options.up(i).clone();
        normal.sub(tangent.clone().multiplyScalar(normal.dot(tangent)));
        if (normal.lengthSq() < 1e-8) normal = new THREE.Vector3(0, 1, 0).cross(tangent);
        normal.normalize();
      } else {
        // Parallel transport.
        const axis = tangents[i - 1]!.clone().cross(tangent);
        const sinA = axis.length();
        if (sinA > 1e-6) {
          axis.divideScalar(sinA);
          const angle = Math.asin(Math.min(1, sinA)) * (tangents[i - 1]!.dot(tangent) < 0 ? -1 : 1);
          normal.applyAxisAngle(axis, angle);
        }
      }
    }
    const binormal = tangent.clone().cross(normal).normalize();
    const t = lengths[i]! / total;
    const r = options.radius(t);
    for (let s = 0; s < radial; s++) {
      const angle = (s / radial) * Math.PI * 2;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      const offset = normal.clone().multiplyScalar(cos * r).add(binormal.clone().multiplyScalar(sin * r * flatten));
      positions.push(path[i]!.x + offset.x, path[i]!.y + offset.y, path[i]!.z + offset.z);
      const nn = normal.clone().multiplyScalar(cos * flatten).add(binormal.clone().multiplyScalar(sin)).normalize();
      normals.push(nn.x, nn.y, nn.z);
      const c = options.colour?.(t, angle) ?? white;
      colours.push(c.r, c.g, c.b);
    }
  }
  const rows = options.closed ? n : n - 1;
  for (let i = 0; i < rows; i++) {
    const next = (i + 1) % n;
    for (let s = 0; s < radial; s++) {
      const a = i * radial + s;
      const b = i * radial + ((s + 1) % radial);
      const c = next * radial + s;
      const d = next * radial + ((s + 1) % radial);
      indices.push(a, c, d, a, d, b);
    }
  }
  const cap = (i: number, end: boolean) => {
    const centre = positions.length / 3;
    const tangent = tangents[i]!.clone().multiplyScalar(end ? 1 : -1);
    const tip = path[i]!.clone().add(tangent.clone().multiplyScalar(options.radius(end ? 1 : 0) * 0.6));
    positions.push(tip.x, tip.y, tip.z);
    normals.push(tangent.x, tangent.y, tangent.z);
    const c = options.colour?.(end ? 1 : 0, 0) ?? white;
    colours.push(c.r, c.g, c.b);
    for (let s = 0; s < radial; s++) {
      const a = i * radial + s;
      const b = i * radial + ((s + 1) % radial);
      if (end) indices.push(a, b, centre);
      else indices.push(b, a, centre);
    }
  };
  if (!options.closed && options.capStart) cap(0, false);
  if (!options.closed && options.capEnd) cap(n - 1, true);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colours, 3));
  geometry.setIndex(indices);
  return standardise(geometry);
}

/** A coloured ellipsoid (sphere scaled per axis). */
export function ellipsoid(
  radii: THREE.Vector3Like,
  centre: THREE.Vector3Like,
  colour: ColourInput,
  detail: { width: number; height: number } = { width: 12, height: 8 },
  rotation: THREE.Euler | null = null,
): THREE.BufferGeometry {
  const geometry = new THREE.SphereGeometry(1, detail.width, detail.height);
  place(geometry, { x: 0, y: 0, z: 0 }, null, radii);
  // Scaled sphere normals need recomputing to stay correct.
  smoothNormals(geometry);
  place(geometry, centre, rotation);
  return paint(standardise(geometry), colour);
}

// ── Small maths ─────────────────────────────────────────────────────────────

export const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const smoothstep = (edge0: number, edge1: number, x: number) => {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
};
/** Slider 0–1 mapped to [min, max] around the middle. */
export const fromSlider = (value: number, min: number, max: number) => lerp(min, max, clamp(value, 0, 1));

/** Piecewise-linear interpolation through sorted (x, y) control points. */
export function curve(points: readonly (readonly [number, number])[], x: number): number {
  if (x <= points[0]![0]) return points[0]![1];
  for (let i = 1; i < points.length; i++) {
    const [x1, y1] = points[i]!;
    if (x <= x1) {
      const [x0, y0] = points[i - 1]!;
      const t = (x - x0) / (x1 - x0);
      const s = t * t * (3 - 2 * t); // smooth between control points
      return y0 + (y1 - y0) * s;
    }
  }
  return points[points.length - 1]![1];
}

/** Deterministic pseudo-random numbers for strand placement, so every client draws the same hair. */
export function seeded(seed: number): () => number {
  let state = seed >>> 0 || 1;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Cheap smooth 3D noise (sum of sines), range about -1..1. Deterministic. */
export function waves(x: number, y: number, z: number, frequency: number): number {
  return (
    Math.sin(x * frequency * 1.7 + y * frequency * 0.9 + 1.3) * 0.4 +
    Math.sin(y * frequency * 2.3 - z * frequency * 1.1 + 0.7) * 0.35 +
    Math.sin(z * frequency * 2.9 + x * frequency * 1.3 + 2.1) * 0.25
  );
}
