// Everything beyond the walkable square (D-033): the six streets carry on
// between façades and end at a building, old-town roofs fill the ring around
// the square, and a few distant landmarks give the skyline Padua-like
// silhouettes (a brick bell tower, a long hall with a keel-shaped roof, a
// basilica with domes). All fictional, low in detail, softened by fog.
// Nothing here is reachable, so it is decoration (owner null).

import * as THREE from "three";
import type { WorldLayout } from "@padova/shared";
import { seeded } from "../avatar/geometry.ts";
import { WALL_INSET } from "./buildings.ts";
import { P } from "./palette.ts";
import { Frame, QuadBatch, archShape, blob, boxAt, cuboid, cylinder, gableRoof, hipRoof, litAtNight, rgb, shadeByHeight, type ColourInput, type Detail, type Sink } from "./kit.ts";

type Rect = readonly [x0: number, x1: number, z0: number, z1: number];

const PLASTERS: ColourInput[] = [P.plasterCream, P.plasterOchre, P.plasterPink, P.plasterApricot, P.plasterSage, P.plasterYellow, P.plasterRose, P.plasterRed];

/** Streets leading out of the square (beyond its edge), matching the openings in world.ts. */
function corridors(h: number): Rect[] {
  return [
    [-3, 4, -40, -h],
    [-5, 3, h, 40],
    [-40, -h, -18, -11],
    [-40, -h, 11, 18],
    [h, 40, -18, -12.3],
    [h, 40, 12.3, 18],
  ];
}

/** Areas around the square (and its streets) filled with city blocks. */
function regions(h: number, r: number): Rect[] {
  return [
    [-r, -3, -r, -h], [4, r, -r, -h], [-3, 4, -r, -40],
    [-r, -5, h, r], [3, r, h, r], [-5, 3, 40, r],
    [-r, -h, -h, -18], [-r, -40, -18, -11], [-r, -h, -11, 11], [-r, -40, 11, 18], [-r, -h, 18, h],
    [h, r, -h, -18], [40, r, -18, -12.3], [h, r, -12.3, 12.3], [40, r, 12.3, 18], [h, r, 18, h],
  ];
}

function split(a: number, b: number, target: number, rng: () => number): number[] {
  const count = Math.max(1, Math.round((b - a) / target));
  const cuts = [a];
  for (let k = 1; k < count; k++) cuts.push(a + ((b - a) * k) / count + (rng() - 0.5) * 1.2);
  cuts.push(b);
  return cuts;
}

export function buildBackdrop(sink: Sink, layout: WorldLayout, detail: Detail): void {
  const h = layout.halfSize;
  const reach = 50;
  const rng = seeded(2024);
  const streets = corridors(h);
  const pieces: THREE.BufferGeometry[] = [];
  const windows = new QuadBatch();
  let n = 0;
  for (const [x0, x1, z0, z1] of regions(h, reach)) {
    const xs = split(x0, x1, 9.5, rng);
    const zs = split(z0, z1, 9.5, rng);
    for (let i = 0; i + 1 < xs.length; i++) {
      for (let j = 0; j + 1 < zs.length; j++) {
        const block: Rect = [xs[i]!, xs[i + 1]!, zs[j]!, zs[j + 1]!];
        const height = 9.5 + rng() * 6.5;
        const colour = PLASTERS[n++ % PLASTERS.length]!;
        cityBlock(block, height, colour, streets, detail, pieces, windows, n);
      }
    }
  }
  if (!windows.empty) pieces.push(windows.geometry());
  landmarks(pieces, detail);
  sink.add("backdrop", null, pieces);
}

/** One block: plastered walls, a tiled roof, and windows on the faces that look onto a street. */
function cityBlock(block: Rect, height: number, colour: ColourInput, streets: readonly Rect[], detail: Detail, out: THREE.BufferGeometry[], q: QuadBatch, seed: number): void {
  const [x0, x1, z0, z1] = block;
  const i = WALL_INSET;
  out.push(shadeByHeight(cuboid(x0 + i, x1 - i, 0, height, z0 + i, z1 - i, colour), 0, 5, 0.85, 1.02));
  const tile = [P.roof, P.roofWarm, P.roofOld][seed % 3]!;
  out.push(...hipRoof(x0 + i, x1 - i, z0 + i, z1 - i, height, 1.6 + (seed % 3) * 0.3, 0.35, { tile, tileAlt: P.roofDark, ridge: P.roofLight }));
  out.push(cuboid(x0 + i - 0.05, x1 - i + 0.05, height - 0.2, height, z0 + i - 0.05, z1 - i + 0.05, P.stoneShade));
  // Faces that border a street get windows, shutters and a ground floor.
  const eps = 1e-6;
  const faces: { side: "north" | "south" | "east" | "west"; from: number; to: number }[] = [];
  for (const [sx0, sx1, sz0, sz1] of streets) {
    const overlapZ = [Math.max(z0, sz0), Math.min(z1, sz1)] as const;
    const overlapX = [Math.max(x0, sx0), Math.min(x1, sx1)] as const;
    if (Math.abs(x1 - sx0) < eps && overlapZ[1] - overlapZ[0] > 1) faces.push({ side: "east", from: overlapZ[0], to: overlapZ[1] });
    if (Math.abs(x0 - sx1) < eps && overlapZ[1] - overlapZ[0] > 1) faces.push({ side: "west", from: overlapZ[0], to: overlapZ[1] });
    if (Math.abs(z1 - sz0) < eps && overlapX[1] - overlapX[0] > 1) faces.push({ side: "south", from: overlapX[0], to: overlapX[1] });
    if (Math.abs(z0 - sz1) < eps && overlapX[1] - overlapX[0] > 1) faces.push({ side: "north", from: overlapX[0], to: overlapX[1] });
  }
  for (const face of faces) {
    // Frame on the face; u measured from the frame's own start (see Frame).
    let f: Frame;
    let u0: number;
    let u1: number;
    switch (face.side) {
      case "south":
        f = new Frame({ x: x0 + i, z: z1 - i }, "south");
        u0 = face.from - (x0 + i);
        u1 = face.to - (x0 + i);
        break;
      case "north":
        f = new Frame({ x: x1 - i, z: z0 + i }, "north");
        u0 = x1 - i - face.to;
        u1 = x1 - i - face.from;
        break;
      case "east":
        f = new Frame({ x: x1 - i, z: z1 - i }, "east");
        u0 = z1 - i - face.to;
        u1 = z1 - i - face.from;
        break;
      case "west":
        f = new Frame({ x: x0 + i, z: z0 + i }, "west");
        u0 = face.from - (z0 + i);
        u1 = face.to - (z0 + i);
        break;
    }
    const count = Math.max(1, Math.floor((u1 - u0) / 2.6));
    const centres = Array.from({ length: count }, (_, k) => u0 + ((u1 - u0) * (k + 0.5)) / count);
    const shutter = seed % 3 === 0 ? P.shutterDark : P.shutter;
    for (let floor = 0; floor < Math.floor((height - 4.2) / 3) + 1; floor++) {
      const v = 4.6 + floor * 3;
      for (const u of centres) {
        const at = f.point(u, v + 0.8, 0);
        q.frameBox(f, u - 0.45, u + 0.45, v, v + 1.6, 0, 0.02, P.glass, false, litAtNight(at.x, at.y, at.z, 0.35) ? 0.8 : 0);
        q.frameBox(f, u - 0.58, u + 0.58, v - 0.1, v, 0, 0.1, P.stone);
        if (detail === "high") {
          q.frameBox(f, u - 0.95, u - 0.5, v, v + 1.6, 0, 0.04, shutter);
          q.frameBox(f, u + 0.5, u + 0.95, v, v + 1.6, 0, 0.04, shutter);
        }
      }
    }
    // Ground floor: doors and shop windows, a little warmer.
    for (const [k, u] of centres.entries()) {
      if ((k + seed) % 3 === 0) q.frameBox(f, u - 0.65, u + 0.65, 0, 2.5, 0, 0.03, P.woodDark);
      else {
        q.frameBox(f, u - 0.8, u + 0.8, 0.5, 2.9, 0, 0.03, P.glassWarm, false, 0.45);
        q.frameBox(f, u - 0.95, u + 0.95, 2.9, 3.25, 0, 0.08, P.woodDark);
      }
    }
    q.frameBox(f, u0, u1, 3.7, 3.85, 0, 0.12, P.stone);
  }
}

// ── Landmarks on the skyline ────────────────────────────────────────────────

function landmarks(out: THREE.BufferGeometry[], detail: Detail): void {
  campanile(out, -44, -66, detail);
  keelHall(out, 32, -72, detail);
  basilica(out, 60, 74, detail);
  domedChurch(out, -76, 26, detail);
}

/** A tall brick bell tower with a belfry and a conical spire. */
function campanile(out: THREE.BufferGeometry[], x: number, z: number, detail: Detail): void {
  const s = 3.2;
  out.push(shadeByHeight(cuboid(x - s, x + s, 0, 34, z - s, z + s, P.brick), 0, 34, 0.85, 1.05));
  for (const [dx, dz] of [[-s, -s], [s, -s], [-s, s], [s, s]] as const) out.push(cuboid(x + dx - 0.35, x + dx + 0.35, 0, 34, z + dz - 0.35, z + dz + 0.35, P.brickDark));
  out.push(cuboid(x - s - 0.3, x + s + 0.3, 34, 34.5, z - s - 0.3, z + s + 0.3, P.stone));
  for (const side of ["north", "south", "east", "west"] as const) {
    const f = new Frame(
      side === "south" ? { x: x - s, z: z + s } : side === "north" ? { x: x + s, z: z - s } : side === "east" ? { x: x + s, z: z + s } : { x: x - s, z: z - s },
      side,
    );
    out.push(f.panel(archShape(s - 1.3, 35, 1.6, 37.2), 0.02, P.woodDark, 8), f.panel(archShape(s + 1.3, 35, 1.6, 37.2), 0.02, P.woodDark, 8));
  }
  out.push(cuboid(x - s, x + s, 34.5, 38.8, z - s, z + s, P.brick));
  out.push(cuboid(x - s - 0.3, x + s + 0.3, 38.8, 39.3, z - s - 0.3, z + s + 0.3, P.stone));
  out.push(cylinder(x, 39.3, z, s * 0.9, s * 0.9, 2, P.brick, 8));
  out.push(cylinder(x, 41.3, z, s * 0.95, 0.2, 10, P.roofDark, detail === "high" ? 12 : 8));
  out.push(blob(x, 51.6, z, 0.4, 0.4, 0.4, P.gold, { detail: 1, lumpiness: 0 }));
}

/** A long medieval hall raised on arcades, under a curved keel-shaped roof. */
function keelHall(out: THREE.BufferGeometry[], x: number, z: number, detail: Detail): void {
  const L = 38;
  const W = 15;
  const wallTop = 13;
  out.push(shadeByHeight(cuboid(x - L / 2, x + L / 2, 0, wallTop, z - W / 2, z + W / 2, P.plasterPink), 0, 13, 0.85, 1.02));
  const front = new Frame({ x: x - L / 2, z: z + W / 2 }, "south");
  const bays = 12;
  for (let k = 0; k < bays; k++) {
    const u = (L * (k + 0.5)) / bays;
    out.push(front.panel(archShape(u, 0.2, 2.2, 3.6), 0.03, P.woodDark, 8));
    out.push(front.panel(archShape(u, 6.5, 1.1, 8.3), 0.03, P.glass, 8));
  }
  out.push(front.box(0, L, 5.4, 5.8, 0, 0.3, P.stone));
  // Keel roof: a pointed, curved profile pulled along the hall.
  const profile = new THREE.Shape();
  const half = W / 2 + 0.6;
  profile.moveTo(-half, 0);
  profile.quadraticCurveTo(-half * 0.95, 8.5, 0, 11);
  profile.quadraticCurveTo(half * 0.95, 8.5, half, 0);
  profile.lineTo(-half, 0);
  const roof = new THREE.ExtrudeGeometry(profile, { depth: L + 1.2, bevelEnabled: false, curveSegments: detail === "high" ? 12 : 6 });
  roof.rotateY(Math.PI / 2);
  roof.translate(x - L / 2 - 0.6, wallTop, z);
  out.push(paintRoof(roof, "#7f9790", "#6c847d"));
}

function paintRoof(g: THREE.BufferGeometry, a: string, b: string): THREE.BufferGeometry {
  const ng = g.index ? g.toNonIndexed() : g;
  const position = ng.getAttribute("position");
  const colours = new Float32Array(position.count * 3);
  const ca = rgb(a);
  const cb = rgb(b);
  for (let t = 0; t < position.count; t += 3) {
    const y = (position.getY(t) + position.getY(t + 1) + position.getY(t + 2)) / 3;
    const c = Math.floor(y / 0.9) % 2 === 0 ? ca : cb;
    for (let k = 0; k < 3; k++) colours.set([c.r, c.g, c.b], (t + k) * 3);
  }
  ng.setAttribute("color", new THREE.Float32BufferAttribute(colours, 3));
  ng.computeVertexNormals();
  return ng;
}

function dome(out: THREE.BufferGeometry[], x: number, y: number, z: number, r: number, colour: ColourInput, detail: Detail): void {
  out.push(cylinder(x, y, z, r * 0.92, r * 0.92, r * 0.5, P.stoneShade, detail === "high" ? 18 : 10));
  const g = new THREE.SphereGeometry(r, detail === "high" ? 18 : 10, 8, 0, Math.PI * 2, 0, Math.PI / 2);
  g.translate(x, y + r * 0.5, z);
  out.push(shadeByHeight(paintAllColour(g, colour), y, y + r * 1.5, 0.85, 1.05));
  out.push(cylinder(x, y + r * 1.5, z, r * 0.16, r * 0.16, r * 0.35, P.stone, 8));
  out.push(cylinder(x, y + r * 1.85, z, r * 0.2, 0.02, r * 0.4, colour, 8));
}

function paintAllColour(g: THREE.BufferGeometry, colour: ColourInput): THREE.BufferGeometry {
  const c = rgb(colour);
  const count = g.getAttribute("position").count;
  const colours = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) colours.set([c.r, c.g, c.b], i * 3);
  g.setAttribute("color", new THREE.Float32BufferAttribute(colours, 3));
  return g;
}

/** A brick basilica with a row of grey domes and two slender towers. */
function basilica(out: THREE.BufferGeometry[], x: number, z: number, detail: Detail): void {
  out.push(shadeByHeight(cuboid(x - 16, x + 16, 0, 15, z - 8, z + 8, P.brick), 0, 15, 0.85, 1.02));
  out.push(...gableRoof(x - 16, x + 16, z - 8, z + 8, 15, 4, 0.4, "x", { tile: P.roof, tileAlt: P.roofDark, ridge: P.roofLight, wall: P.brick }));
  const lead = "#9aa3a6";
  for (const dx of [-11, -4.5, 4.5, 11]) dome(out, x + dx, 18, z, 4, lead, detail);
  dome(out, x, 19, z, 6, lead, detail);
  for (const dz of [-9.5, 9.5]) {
    out.push(cylinder(x - 17, 0, z + dz, 1.3, 1.1, 36, P.brickDark, 10));
    out.push(cylinder(x - 17, 36, z + dz, 1.6, 1.6, 1.4, P.stone, 10));
    out.push(cylinder(x - 17, 37.4, z + dz, 1.4, 0.1, 6, lead, 10));
  }
  out.push(boxAt(x - 16.2, 9, z, 0.4, 6, 5, P.stone));
}

/** A big domed church to the west. */
function domedChurch(out: THREE.BufferGeometry[], x: number, z: number, detail: Detail): void {
  out.push(shadeByHeight(cuboid(x - 12, x + 12, 0, 16, z - 12, z + 12, P.plasterCream), 0, 16, 0.85, 1.02));
  out.push(...hipRoof(x - 12, x + 12, z - 12, z + 12, 16, 2.4, 0.4, { tile: P.roof, tileAlt: P.roofDark, ridge: P.roofLight }));
  out.push(cylinder(x, 17, z, 7, 7, 4, P.stone, detail === "high" ? 24 : 12));
  dome(out, x, 21, z, 7.2, P.copper, detail);
}

// ── Sky ──────────────────────────────────────────────────────────────────────

/** A sky dome (unit radius, scaled when drawn) shaded from warm horizon to blue. */
export function skyGeometry(): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(1, 32, 16);
  g.setAttribute("color", new THREE.Float32BufferAttribute(new Float32Array(g.getAttribute("position").count * 3), 3));
  paintSky(g, P.skyTop, P.skyMid, P.skyHorizon);
  return g;
}

/** Recolours the sky dome: horizon below and up to the middle band, then towards the zenith (day and night, M7b). */
export function paintSky(g: THREE.BufferGeometry, topColour: ColourInput, midColour: ColourInput, horizonColour: ColourInput): void {
  const position = g.getAttribute("position");
  const colours = g.getAttribute("color") as THREE.BufferAttribute;
  const top = rgb(topColour);
  const mid = rgb(midColour);
  const horizon = rgb(horizonColour);
  const c = new THREE.Color();
  for (let i = 0; i < position.count; i++) {
    const y = position.getY(i);
    if (y < 0) c.copy(horizon);
    else if (y < 0.28) c.copy(horizon).lerp(mid, y / 0.28);
    else c.copy(mid).lerp(top, Math.min(1, (y - 0.28) / 0.5));
    colours.setXYZ(i, c.r, c.g, c.b);
  }
  colours.needsUpdate = true;
}

/**
 * The night sky (M7b): small stars scattered above the rooftops and a pale
 * moon at `moon` (a unit direction). Unit-sky coordinates, scaled with the sky.
 */
export function nightSkyGeometry(moon: { x: number; y: number; z: number }): THREE.BufferGeometry {
  const rng = seeded(311);
  const q = new QuadBatch();
  const centre = new THREE.Vector3();
  const right = new THREE.Vector3();
  const up = new THREE.Vector3();
  const corner = (k: number, size: number) => centre.clone().addScaledVector(right, (k === 0 || k === 3 ? -1 : 1) * size).addScaledVector(up, (k < 2 ? -1 : 1) * size);
  const square = (size: number, colour: ColourInput) => {
    // Facing the middle of the sky, so it is seen from inside the dome.
    right.crossVectors(centre, Math.abs(centre.y) > 0.95 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0)).normalize();
    up.crossVectors(right, centre).normalize();
    q.quad(corner(3, size), corner(2, size), corner(1, size), corner(0, size), colour);
  };
  for (let k = 0; k < 360; k++) {
    // Evenly over the sky above the skyline (y > 0.1).
    const y = 0.1 + rng() * 0.88;
    const a = rng() * Math.PI * 2;
    const r = Math.sqrt(1 - y * y);
    centre.set(Math.cos(a) * r, y, Math.sin(a) * r).multiplyScalar(0.97);
    square(0.0013 + rng() * 0.0019, rng() < 0.15 ? "#ffe8c4" : "#f2f4ff");
  }
  const g = q.geometry();
  // The moon: a pale disc with a slightly brighter middle.
  const moonDisc = new THREE.CircleGeometry(0.045, 20);
  const direction = new THREE.Vector3(moon.x, moon.y, moon.z).normalize();
  moonDisc.lookAt(direction.clone().negate());
  moonDisc.translate(direction.x * 0.95, direction.y * 0.95, direction.z * 0.95);
  const discColours = new Float32Array(moonDisc.getAttribute("position").count * 3);
  for (let i = 0; i < discColours.length / 3; i++) discColours.set(i === 0 ? [1, 0.98, 0.9] : [0.86, 0.88, 0.95], i * 3);
  moonDisc.setAttribute("color", new THREE.Float32BufferAttribute(discColours, 3));
  moonDisc.deleteAttribute("uv");
  const both = [g, moonDisc].map((piece) => {
    const plain = piece.index ? piece.toNonIndexed() : piece;
    for (const name of Object.keys(plain.attributes)) if (!["position", "normal", "color"].includes(name)) plain.deleteAttribute(name);
    return plain;
  });
  return mergeQuads(both);
}

/** Joins non-indexed geometries that share position, normal and colour attributes. */
function mergeQuads(pieces: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const out = new THREE.BufferGeometry();
  for (const name of ["position", "normal", "color"]) {
    const arrays = pieces.map((p) => p.getAttribute(name).array as Float32Array);
    const joined = new Float32Array(arrays.reduce((n, a) => n + a.length, 0));
    let offset = 0;
    for (const a of arrays) {
      joined.set(a, offset);
      offset += a.length;
    }
    out.setAttribute(name, new THREE.Float32BufferAttribute(joined, 3));
  }
  return out;
}

/** Soft clouds on a ring around the sky (unit-sky coordinates, scaled with it). */
export function cloudGeometry(): THREE.BufferGeometry[] {
  const rng = seeded(77);
  const pieces: THREE.BufferGeometry[] = [];
  for (let k = 0; k < 9; k++) {
    const a = (k / 9) * Math.PI * 2 + rng() * 0.5;
    const d = 0.86;
    const y = 0.3 + rng() * 0.18;
    for (let b = 0; b < 4; b++) {
      const s = 0.05 + rng() * 0.04;
      pieces.push(blob(Math.sin(a) * d + (rng() - 0.5) * 0.12, y + (rng() - 0.5) * 0.02, Math.cos(a) * d + (rng() - 0.5) * 0.12, s * 1.8, s * 0.55, s * 1.4, "#fbf6ec", { detail: 1, lumpiness: 0.2, shade: 0.86, seed: k * 5 + b }));
    }
  }
  return pieces;
}
