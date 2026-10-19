// Modular environment kit (D-033): small, reusable geometry builders for
// walls, openings, roofs, foliage and ground inlays. Everything is a
// vertex-coloured BufferGeometry in world space (metres), merged later into a
// few draw calls by district.ts. Pure geometry: no materials, no textures,
// no DOM, so the whole district can be built and checked in Node tests.

import * as THREE from "three";
import { paint, paintWith, place, rgb, standardise, waves, type ColourInput } from "../avatar/geometry.ts";
import type { Side } from "@padova/shared";

export type Detail = "high" | "low";
export type MaterialKey = "toon" | "water" | "sign";

/** One piece of the district: its geometry, who owns it, and where it is drawn. */
export interface Piece {
  geometry: THREE.BufferGeometry;
  /**
   * The obstacle (shared/src/world.ts) this solid piece belongs to, or null for
   * decoration that never blocks anyone: flat ground inlays, parts above head
   * height, and everything outside the walkable square.
   */
  owner: string | null;
  /** Draw batch: pieces with the same batch and material become one mesh. */
  batch: string;
  material: MaterialKey;
  /** For sign pieces: which atlas text they show (district.ts maps it to UVs). */
  sign?: string;
}

export class Sink {
  readonly pieces: Piece[] = [];

  add(batch: string, owner: string | null, geometry: THREE.BufferGeometry | THREE.BufferGeometry[], material: MaterialKey = "toon"): void {
    for (const g of Array.isArray(geometry) ? geometry : [geometry]) {
      if (g.getAttribute("position").count === 0) continue;
      this.pieces.push({ geometry: standardise(g), owner, batch, material });
    }
  }
}

export { paint, paintWith, rgb, type ColourInput };

// ── Basic solids (world space) ───────────────────────────────────────────────

/** An axis-aligned box from min to max corners. */
export function cuboid(minX: number, maxX: number, minY: number, maxY: number, minZ: number, maxZ: number, colour: ColourInput): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(Math.max(1e-3, maxX - minX), Math.max(1e-3, maxY - minY), Math.max(1e-3, maxZ - minZ));
  g.translate((minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2);
  return paint(standardise(g), colour);
}

/** A box by centre and size, optionally turned around Y. */
export function boxAt(cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, colour: ColourInput, rotationY = 0): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(sx, sy, sz);
  place(g, { x: cx, y: cy, z: cz }, rotationY ? new THREE.Euler(0, rotationY, 0) : null);
  return paint(standardise(g), colour);
}

/** A vertical cylinder (or cone) standing on y0. */
export function cylinder(cx: number, y0: number, cz: number, rBottom: number, rTop: number, height: number, colour: ColourInput, segments = 10): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(rTop, rBottom, height, segments, 1);
  g.translate(cx, y0 + height / 2, cz);
  return paint(standardise(g), colour);
}

/** A cylinder between two points (rods, rails, bicycle tubes). */
export function rod(a: THREE.Vector3Like, b: THREE.Vector3Like, radius: number, colour: ColourInput, segments = 6): THREE.BufferGeometry {
  const start = new THREE.Vector3(a.x, a.y, a.z);
  const end = new THREE.Vector3(b.x, b.y, b.z);
  const length = start.distanceTo(end);
  const g = new THREE.CylinderGeometry(radius, radius, Math.max(1e-3, length), segments, 1);
  const direction = end.clone().sub(start).normalize();
  const quaternion = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction);
  g.applyQuaternion(quaternion);
  const mid = start.add(end).multiplyScalar(0.5);
  g.translate(mid.x, mid.y, mid.z);
  return paint(standardise(g), colour);
}

/** A ring (torus) standing upright, facing along `normal` (wheels, wreaths). */
export function ring(centre: THREE.Vector3Like, radius: number, tube: number, normal: { x: number; z: number }, colour: ColourInput, segments = 14): THREE.BufferGeometry {
  const g = new THREE.TorusGeometry(radius, tube, 4, segments);
  g.rotateY(Math.atan2(normal.x, normal.z));
  g.translate(centre.x, centre.y, centre.z);
  return paint(standardise(g), colour);
}

/** A rounded, slightly lumpy blob (foliage, fruit piles, shrubs). Darker underneath. */
export function blob(
  cx: number,
  cy: number,
  cz: number,
  rx: number,
  ry: number,
  rz: number,
  colour: ColourInput,
  options: { detail?: number; lumpiness?: number; shade?: number; seed?: number } = {},
): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(1, options.detail ?? 1);
  const position = g.getAttribute("position");
  const v = new THREE.Vector3();
  const lump = options.lumpiness ?? 0.12;
  const seed = options.seed ?? 0;
  for (let i = 0; i < position.count; i++) {
    v.fromBufferAttribute(position, i);
    // Displacement depends only on the position, so shared corners stay joined.
    const n = waves(v.x * 1.7 + seed, v.y * 1.7, v.z * 1.7 - seed, 1.6);
    v.multiplyScalar(1 + n * lump);
    position.setXYZ(i, v.x * rx + cx, v.y * ry + cy, v.z * rz + cz);
  }
  g.computeVertexNormals();
  const base = rgb(colour);
  const dark = base.clone().multiplyScalar(options.shade ?? 0.72);
  return paintWith(standardise(g), (p) => {
    const t = THREE.MathUtils.clamp((p.y - (cy - ry)) / (2 * ry), 0, 1);
    return dark.clone().lerp(base, Math.sqrt(t));
  });
}

/** A horizontal polygon at height y, facing up (ground inlays, paving bands). */
export function flat(points: readonly (readonly [number, number])[], y: number, colour: ColourInput): THREE.BufferGeometry {
  const shape = new THREE.Shape(points.map(([x, z]) => new THREE.Vector2(x, -z)));
  const g = new THREE.ShapeGeometry(shape, 6);
  g.rotateX(-Math.PI / 2); // shape XY → ground XZ (the -z above keeps winding facing up)
  g.translate(0, y, 0);
  return paint(standardise(g), colour);
}

/** A flat axis-aligned rectangle on the ground. */
export function flatRect(minX: number, maxX: number, minZ: number, maxZ: number, y: number, colour: ColourInput): THREE.BufferGeometry {
  return flat([[minX, minZ], [maxX, minZ], [maxX, maxZ], [minX, maxZ]], y, colour);
}

/** A flat disc or annulus on the ground. */
export function flatRing(cx: number, cz: number, inner: number, outer: number, y: number, colour: ColourInput, segments = 40): THREE.BufferGeometry {
  const g = new THREE.RingGeometry(Math.max(inner, 1e-4), outer, segments, 1);
  g.rotateX(-Math.PI / 2);
  g.translate(cx, y, cz);
  return paint(standardise(g), colour);
}

/** A planar quad split into stripes from its bottom edge (a, b) to its top edge (d, c). */
export function stripedQuad(
  a: THREE.Vector3,
  b: THREE.Vector3,
  c: THREE.Vector3,
  d: THREE.Vector3,
  rows: number,
  colourAt: (row: number) => ColourInput,
): THREE.BufferGeometry {
  const positions: number[] = [];
  const colours: number[] = [];
  for (let i = 0; i < rows; i++) {
    const t0 = i / rows;
    const t1 = (i + 1) / rows;
    const p0 = a.clone().lerp(d, t0);
    const p1 = b.clone().lerp(c, t0);
    const p2 = b.clone().lerp(c, t1);
    const p3 = a.clone().lerp(d, t1);
    const colour = rgb(colourAt(i));
    for (const p of [p0, p1, p2, p0, p2, p3]) {
      positions.push(p.x, p.y, p.z);
      colours.push(colour.r, colour.g, colour.b);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute("color", new THREE.Float32BufferAttribute(colours, 3));
  g.computeVertexNormals();
  return standardise(g);
}

/**
 * Adds a back face to a thin surface (awnings, parasols, valances), so it can
 * be seen from below as well. Solid pieces don't need this: the world material
 * draws front faces only, so a camera that strays inside a building sees out.
 */
export function twoSided(geometry: THREE.BufferGeometry): THREE.BufferGeometry {
  const front = standardise(geometry).toNonIndexed();
  const back = front.clone();
  const position = back.getAttribute("position") as THREE.BufferAttribute;
  const normal = back.getAttribute("normal") as THREE.BufferAttribute;
  const colour = back.getAttribute("color") as THREE.BufferAttribute;
  const uv = back.getAttribute("uv") as THREE.BufferAttribute;
  for (let t = 0; t < position.count; t += 3) {
    for (const attribute of [position, normal, colour, uv]) {
      const size = attribute.itemSize;
      for (let c = 0; c < size; c++) {
        const first = attribute.array[(t + 1) * size + c]!;
        attribute.array[(t + 1) * size + c] = attribute.array[(t + 2) * size + c]!;
        attribute.array[(t + 2) * size + c] = first;
      }
    }
  }
  for (let i = 0; i < normal.count; i++) normal.setXYZ(i, -normal.getX(i), -normal.getY(i), -normal.getZ(i));
  const merged = new THREE.BufferGeometry();
  for (const name of ["position", "normal", "color", "uv"] as const) {
    const a = front.getAttribute(name) as THREE.BufferAttribute;
    const b = back.getAttribute(name) as THREE.BufferAttribute;
    const data = new Float32Array(a.array.length + b.array.length);
    data.set(a.array as Float32Array, 0);
    data.set(b.array as Float32Array, a.array.length);
    merged.setAttribute(name, new THREE.Float32BufferAttribute(data, a.itemSize));
  }
  return standardise(merged);
}

/** Gives a geometry a vertical colour gradient (multiplied into its colours). */
export function shadeByHeight(geometry: THREE.BufferGeometry, y0: number, y1: number, bottom: number, top: number): THREE.BufferGeometry {
  const colour = geometry.getAttribute("color") as THREE.BufferAttribute;
  const position = geometry.getAttribute("position");
  for (let i = 0; i < position.count; i++) {
    const t = THREE.MathUtils.clamp((position.getY(i) - y0) / (y1 - y0), 0, 1);
    const k = THREE.MathUtils.lerp(bottom, top, t);
    colour.setXYZ(i, colour.getX(i) * k, colour.getY(i) * k, colour.getZ(i) * k);
  }
  colour.needsUpdate = true;
  return geometry;
}

// ── Fast batches of flat quads ──────────────────────────────────────────────

/**
 * Collects many coloured quads and boxes straight into typed arrays, then
 * makes one geometry. Much faster than one three.js geometry per piece, for
 * things that come in thousands (cobbles, tiles, distant windows).
 */
export class QuadBatch {
  private readonly positions: number[] = [];
  private readonly normals: number[] = [];
  private readonly colours: number[] = [];
  private readonly a = new THREE.Vector3();
  private readonly b = new THREE.Vector3();

  /** A quad with corners in counter-clockwise order as seen from its front. */
  quad(p0: THREE.Vector3Like, p1: THREE.Vector3Like, p2: THREE.Vector3Like, p3: THREE.Vector3Like, colour: ColourInput): void {
    const c = rgb(colour);
    this.a.set(p1.x - p0.x, p1.y - p0.y, p1.z - p0.z);
    this.b.set(p3.x - p0.x, p3.y - p0.y, p3.z - p0.z);
    const n = this.a.cross(this.b).normalize();
    for (const p of [p0, p1, p2, p0, p2, p3]) {
      this.positions.push(p.x, p.y, p.z);
      this.normals.push(n.x, n.y, n.z);
      this.colours.push(c.r, c.g, c.b);
    }
  }

  /** A flat rectangle on the ground at height y, facing up. */
  groundRect(minX: number, maxX: number, minZ: number, maxZ: number, y: number, colour: ColourInput): void {
    this.quad({ x: minX, y, z: maxZ }, { x: maxX, y, z: maxZ }, { x: maxX, y, z: minZ }, { x: minX, y, z: minZ }, colour);
  }

  /** A box in a façade frame's local (u, v, w) space; `back` false skips the face against the wall. */
  frameBox(f: Frame, u0: number, u1: number, v0: number, v1: number, w0: number, w1: number, colour: ColourInput, back = false): void {
    const P = (u: number, v: number, w: number) => f.point(u, v, w);
    this.quad(P(u0, v0, w1), P(u1, v0, w1), P(u1, v1, w1), P(u0, v1, w1), colour); // front
    this.quad(P(u0, v1, w1), P(u1, v1, w1), P(u1, v1, w0), P(u0, v1, w0), colour); // top
    this.quad(P(u0, v0, w0), P(u1, v0, w0), P(u1, v0, w1), P(u0, v0, w1), colour); // bottom
    this.quad(P(u0, v0, w1), P(u0, v1, w1), P(u0, v1, w0), P(u0, v0, w0), colour); // left
    this.quad(P(u1, v0, w0), P(u1, v1, w0), P(u1, v1, w1), P(u1, v0, w1), colour); // right
    if (back) this.quad(P(u1, v0, w0), P(u0, v0, w0), P(u0, v1, w0), P(u1, v1, w0), colour);
  }

  get empty(): boolean {
    return this.positions.length === 0;
  }

  geometry(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(this.positions, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(this.normals, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(this.colours, 3));
    return standardise(g);
  }
}

// ── Roofs ────────────────────────────────────────────────────────────────────

const roofRow = (base: ColourInput, alt: ColourInput) => (row: number) => (row % 2 === 0 ? base : alt);

/**
 * A hipped roof of terracotta tiles over a rectangle, with eaves overhanging
 * by `overhang`. The ridge runs along the longer side.
 */
export function hipRoof(
  minX: number,
  maxX: number,
  minZ: number,
  maxZ: number,
  baseY: number,
  rise: number,
  overhang: number,
  colours: { tile: ColourInput; tileAlt: ColourInput; ridge: ColourInput },
): THREE.BufferGeometry[] {
  const x0 = minX - overhang;
  const x1 = maxX + overhang;
  const z0 = minZ - overhang;
  const z1 = maxZ + overhang;
  const alongX = x1 - x0 >= z1 - z0;
  const half = (alongX ? z1 - z0 : x1 - x0) / 2;
  const top = baseY + rise;
  const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  const rows = Math.max(3, Math.round(Math.hypot(rise, half) / 0.6));
  const row = roofRow(colours.tile, colours.tileAlt);
  const pieces: THREE.BufferGeometry[] = [];
  if (alongX) {
    const zm = (z0 + z1) / 2;
    const r0 = v(x0 + half, top, zm);
    const r1 = v(x1 - half, top, zm);
    pieces.push(stripedQuad(v(x0, baseY, z1), v(x1, baseY, z1), r1, r0, rows, row)); // south slope
    pieces.push(stripedQuad(v(x1, baseY, z0), v(x0, baseY, z0), r0, r1, rows, row)); // north slope
    pieces.push(stripedQuad(v(x0, baseY, z0), v(x0, baseY, z1), r0, r0, rows, row)); // west hip
    pieces.push(stripedQuad(v(x1, baseY, z1), v(x1, baseY, z0), r1, r1, rows, row)); // east hip
    pieces.push(cuboid(r0.x, r1.x, top - 0.06, top + 0.12, zm - 0.14, zm + 0.14, colours.ridge));
  } else {
    const xm = (x0 + x1) / 2;
    const r0 = v(xm, top, z0 + half);
    const r1 = v(xm, top, z1 - half);
    pieces.push(stripedQuad(v(x1, baseY, z1), v(x1, baseY, z0), r0, r1, rows, row)); // east slope
    pieces.push(stripedQuad(v(x0, baseY, z0), v(x0, baseY, z1), r1, r0, rows, row)); // west slope
    pieces.push(stripedQuad(v(x1, baseY, z0), v(x0, baseY, z0), r0, r0, rows, row)); // north hip
    pieces.push(stripedQuad(v(x0, baseY, z1), v(x1, baseY, z1), r1, r1, rows, row)); // south hip
    pieces.push(cuboid(xm - 0.14, xm + 0.14, top - 0.06, top + 0.12, r0.z, r1.z, colours.ridge));
  }
  return pieces;
}

/**
 * A gabled roof: two tiled slopes meeting along a ridge parallel to `ridgeAxis`,
 * with triangular gable walls in `wall` colour at the ends.
 */
export function gableRoof(
  minX: number,
  maxX: number,
  minZ: number,
  maxZ: number,
  baseY: number,
  rise: number,
  overhang: number,
  ridgeAxis: "x" | "z",
  colours: { tile: ColourInput; tileAlt: ColourInput; ridge: ColourInput; wall: ColourInput },
): THREE.BufferGeometry[] {
  const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  const row = roofRow(colours.tile, colours.tileAlt);
  const top = baseY + rise;
  const pieces: THREE.BufferGeometry[] = [];
  if (ridgeAxis === "x") {
    const zm = (minZ + maxZ) / 2;
    const x0 = minX - overhang * 0.5;
    const x1 = maxX + overhang * 0.5;
    const zs = maxZ + overhang;
    const zn = minZ - overhang;
    const ys = baseY - overhang * (rise / ((maxZ - minZ) / 2));
    const rows = Math.max(3, Math.round(Math.hypot(rise, (maxZ - minZ) / 2) / 0.6));
    pieces.push(stripedQuad(v(x0, ys, zs), v(x1, ys, zs), v(x1, top, zm), v(x0, top, zm), rows, row));
    pieces.push(stripedQuad(v(x1, ys, zn), v(x0, ys, zn), v(x0, top, zm), v(x1, top, zm), rows, row));
    pieces.push(gable(v(minX, baseY, minZ), v(minX, baseY, maxZ), v(minX, top, zm), colours.wall));
    pieces.push(gable(v(maxX, baseY, maxZ), v(maxX, baseY, minZ), v(maxX, top, zm), colours.wall));
    pieces.push(cuboid(x0, x1, top - 0.06, top + 0.12, zm - 0.13, zm + 0.13, colours.ridge));
  } else {
    const xm = (minX + maxX) / 2;
    const z0 = minZ - overhang * 0.5;
    const z1 = maxZ + overhang * 0.5;
    const xe = maxX + overhang;
    const xw = minX - overhang;
    const ye = baseY - overhang * (rise / ((maxX - minX) / 2));
    const rows = Math.max(3, Math.round(Math.hypot(rise, (maxX - minX) / 2) / 0.6));
    pieces.push(stripedQuad(v(xe, ye, z1), v(xe, ye, z0), v(xm, top, z0), v(xm, top, z1), rows, row));
    pieces.push(stripedQuad(v(xw, ye, z0), v(xw, ye, z1), v(xm, top, z1), v(xm, top, z0), rows, row));
    pieces.push(gable(v(maxX, baseY, minZ), v(minX, baseY, minZ), v(xm, top, minZ), colours.wall));
    pieces.push(gable(v(minX, baseY, maxZ), v(maxX, baseY, maxZ), v(xm, top, maxZ), colours.wall));
    pieces.push(cuboid(xm - 0.13, xm + 0.13, top - 0.06, top + 0.12, z0, z1, colours.ridge));
  }
  return pieces;
}

function gable(a: THREE.Vector3, b: THREE.Vector3, apex: THREE.Vector3, colour: ColourInput): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute([a.x, a.y, a.z, b.x, b.y, b.z, apex.x, apex.y, apex.z], 3));
  g.computeVertexNormals();
  return paint(standardise(g), colour);
}

// ── Façade frame: build in (u along the wall, v up, w out of the wall) ──────

const OUT: Record<Side, { x: number; z: number }> = {
  north: { x: 0, z: -1 },
  south: { x: 0, z: 1 },
  east: { x: 1, z: 0 },
  west: { x: -1, z: 0 },
};

/**
 * A local coordinate frame on a wall. `u` runs left to right as seen by
 * someone looking at the wall, `v` is up, `w` points out of the wall.
 * Right-handed, so faces built in local space keep their winding.
 */
export class Frame {
  readonly matrix = new THREE.Matrix4();
  readonly out: { x: number; z: number };
  readonly along: { x: number; z: number };

  constructor(readonly origin: { x: number; z: number }, side: Side) {
    this.out = OUT[side];
    this.along = { x: this.out.z, z: -this.out.x };
    this.matrix.set(
      this.along.x, 0, this.out.x, origin.x,
      0, 1, 0, 0,
      this.along.z, 0, this.out.z, origin.z,
      0, 0, 0, 1,
    );
  }

  /** Moves a geometry built in local (u, v, w) space onto the wall. */
  put(geometry: THREE.BufferGeometry): THREE.BufferGeometry {
    geometry.applyMatrix4(this.matrix);
    return geometry;
  }

  /** A box in local coordinates. */
  box(u0: number, u1: number, v0: number, v1: number, w0: number, w1: number, colour: ColourInput): THREE.BufferGeometry {
    return this.put(cuboid(u0, u1, v0, v1, w0, w1, colour));
  }

  /** A flat shape (in the u–v plane) at depth w, facing out of the wall. */
  panel(shape: THREE.Shape, w: number, colour: ColourInput, segments = 8): THREE.BufferGeometry {
    const g = new THREE.ShapeGeometry(shape, segments);
    g.translate(0, 0, w);
    return this.put(paint(standardise(g), colour));
  }

  /** A shape extruded out of the wall from w0 to w1. */
  extrude(shape: THREE.Shape, w0: number, w1: number, colour: ColourInput, segments = 8): THREE.BufferGeometry {
    const g = new THREE.ExtrudeGeometry(shape, { depth: w1 - w0, bevelEnabled: false, curveSegments: segments });
    g.translate(0, 0, w0);
    return this.put(paint(standardise(g), colour));
  }

  /** World position of a local point (for placing other things, e.g. signs). */
  point(u: number, v: number, w: number): THREE.Vector3 {
    return new THREE.Vector3(u, v, w).applyMatrix4(this.matrix);
  }
}

/** An opening with a round top: a rectangle of `width` up to `spring`, then a half circle. */
export function archShape(centreU: number, bottom: number, width: number, spring: number): THREE.Shape {
  const r = width / 2;
  const s = new THREE.Shape();
  s.moveTo(centreU - r, bottom);
  s.lineTo(centreU + r, bottom);
  s.lineTo(centreU + r, spring);
  s.absarc(centreU, spring, r, 0, Math.PI, false);
  s.lineTo(centreU - r, bottom);
  return s;
}

/** The stone surround of a round-topped opening: an upside-down U band of `band` width. */
export function archBandShape(centreU: number, bottom: number, width: number, spring: number, band: number): THREE.Shape {
  const ri = width / 2;
  const ro = ri + band;
  const s = new THREE.Shape();
  s.moveTo(centreU - ro, bottom);
  s.lineTo(centreU - ri, bottom);
  s.lineTo(centreU - ri, spring);
  s.absarc(centreU, spring, ri, Math.PI, 0, true);
  s.lineTo(centreU + ri, bottom);
  s.lineTo(centreU + ro, bottom);
  s.lineTo(centreU + ro, spring);
  s.absarc(centreU, spring, ro, 0, Math.PI, false);
  s.lineTo(centreU - ro, bottom);
  return s;
}

/** A rectangle shape in the u–v plane. */
export function rectShape(u0: number, u1: number, v0: number, v1: number): THREE.Shape {
  const s = new THREE.Shape();
  s.moveTo(u0, v0);
  s.lineTo(u1, v0);
  s.lineTo(u1, v1);
  s.lineTo(u0, v1);
  s.lineTo(u0, v0);
  return s;
}

/** A triangle shape (pediments). */
export function triangleShape(u0: number, u1: number, v0: number, apex: number): THREE.Shape {
  const s = new THREE.Shape();
  s.moveTo(u0, v0);
  s.lineTo(u1, v0);
  s.lineTo((u0 + u1) / 2, apex);
  s.lineTo(u0, v0);
  return s;
}
