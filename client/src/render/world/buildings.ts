// The six buildings around the square (D-033), built from the kit. Each
// solid part below head height lies inside its building's collision box
// (shared/src/world.ts); walls stand WALL_INSET inside the box so window
// frames and pilasters can stand proud of the plaster without leaving it.
// Upper floors, cornices, balconies, eaves and roofs may overhang: they are
// above everyone's head and are decoration (owner null).

import * as THREE from "three";
import type { Obstacle, Side, WorldLayout } from "@padova/shared";
import { P } from "./palette.ts";
import {
  Frame,
  archBandShape,
  archShape,
  blob,
  boxAt,
  cuboid,
  glowing,
  litAtNight,
  cylinder,
  gableRoof,
  hipRoof,
  rectShape,
  rod,
  shadeByHeight,
  stripedQuad,
  triangleShape,
  twoSided,
  type ColourInput,
  type Detail,
  type Sink,
} from "./kit.ts";

/** How far walls stand inside the collision box. */
export const WALL_INSET = 0.15;

interface Ctx {
  sink: Sink;
  detail: Detail;
  layout: WorldLayout;
}

const TILES = { tile: P.roof, tileAlt: P.roofDark, ridge: P.roofLight };

function ob(layout: WorldLayout, id: string): Obstacle {
  const found = layout.obstacles.find((o) => o.id === id);
  if (!found) throw new Error(`No obstacle ${id}`);
  return found;
}

/** A frame on one face of a box, `inset` inside it, with u running left→right as seen from outside. */
function faceFrame(box: { minX: number; maxX: number; minZ: number; maxZ: number }, side: Side, inset = WALL_INSET): { f: Frame; length: number } {
  switch (side) {
    case "south":
      return { f: new Frame({ x: box.minX + inset, z: box.maxZ - inset }, "south"), length: box.maxX - box.minX - 2 * inset };
    case "north":
      return { f: new Frame({ x: box.maxX - inset, z: box.minZ + inset }, "north"), length: box.maxX - box.minX - 2 * inset };
    case "east":
      return { f: new Frame({ x: box.maxX - inset, z: box.maxZ - inset }, "east"), length: box.maxZ - box.minZ - 2 * inset };
    case "west":
      return { f: new Frame({ x: box.minX + inset, z: box.minZ + inset }, "west"), length: box.maxZ - box.minZ - 2 * inset };
  }
}

/** A plastered wall volume with a gentle vertical gradient (darker at the foot). */
function wallVolume(minX: number, maxX: number, minY: number, maxY: number, minZ: number, maxZ: number, colour: ColourInput): THREE.BufferGeometry {
  return shadeByHeight(cuboid(minX, maxX, minY, maxY, minZ, maxZ, colour), 0, 6, 0.86, 1.02);
}

// ── Openings ─────────────────────────────────────────────────────────────────

interface WindowStyle {
  width: number;
  height: number;
  /** Round top instead of a flat lintel. */
  arched?: boolean;
  frame: ColourInput;
  glass?: ColourInput;
  shutters?: ColourInput | null;
  pediment?: "flat" | "triangle" | "arch" | null;
  balcony?: "stone" | "iron" | null;
  flowers?: boolean;
  /** Window frame depth out of the wall (keep ≤ 0.14 below head height). */
  depth?: number;
}

/** One window whose bottom sits at v0, centred on u. Appends pieces to `out`. */
function windowAt(f: Frame, u: number, v0: number, s: WindowStyle, detail: Detail, out: THREE.BufferGeometry[], seed = 0): void {
  const w = s.width;
  const h = s.height;
  const depth = s.depth ?? 0.08;
  const glass = s.glass ?? P.glass;
  const spring = v0 + h - w / 2;
  // Glass, set slightly into the frame. Some windows are lit at night (the same ones every night).
  const pane = f.panel(s.arched ? archShape(u, v0, w, spring) : rectShape(u - w / 2, u + w / 2, v0, v0 + h), 0.012, glass, 10);
  const centre = f.point(u, v0 + h / 2, 0);
  out.push(litAtNight(centre.x, centre.y, centre.z) ? glowing(pane, 0.85) : pane);
  if (detail === "high") {
    // Glazing bars.
    out.push(f.box(u - 0.025, u + 0.025, v0, s.arched ? spring : v0 + h, 0.012, 0.03, s.frame));
    out.push(f.box(u - w / 2, u + w / 2, v0 + h * 0.58 - 0.02, v0 + h * 0.58 + 0.02, 0.012, 0.03, s.frame));
  }
  // Surround.
  const band = 0.1;
  if (s.arched) {
    out.push(f.extrude(archBandShape(u, v0, w, spring, band), 0, depth, s.frame, 10));
  } else {
    out.push(f.box(u - w / 2 - band, u - w / 2, v0, v0 + h, 0, depth, s.frame));
    out.push(f.box(u + w / 2, u + w / 2 + band, v0, v0 + h, 0, depth, s.frame));
    out.push(f.box(u - w / 2 - band, u + w / 2 + band, v0 + h, v0 + h + band, 0, depth, s.frame));
  }
  // Sill.
  out.push(f.box(u - w / 2 - 0.14, u + w / 2 + 0.14, v0 - 0.09, v0, 0, Math.min(0.14, depth + 0.06), s.frame));
  // Pediment.
  const top = s.arched ? v0 + h + band : v0 + h + band;
  if (s.pediment === "flat") out.push(f.box(u - w / 2 - 0.2, u + w / 2 + 0.2, top, top + 0.12, 0, depth + 0.08, s.frame));
  if (s.pediment === "triangle" && detail === "high") out.push(f.extrude(triangleShape(u - w / 2 - 0.22, u + w / 2 + 0.22, top, top + 0.45), 0, depth + 0.06, s.frame));
  if (s.pediment === "triangle" && detail === "low") out.push(f.box(u - w / 2 - 0.2, u + w / 2 + 0.2, top, top + 0.14, 0, depth + 0.06, s.frame));
  if (s.pediment === "arch" && detail === "high") out.push(f.extrude(archBandShape(u, top - 0.02, w + 0.3, top + 0.02, 0.12), 0, depth + 0.06, s.frame, 8));
  // Shutters, folded open against the wall.
  if (s.shutters) {
    const sh = s.shutters;
    out.push(f.box(u - w / 2 - band - w * 0.5, u - w / 2 - band - 0.02, v0, v0 + (s.arched ? spring - v0 : h), 0.01, 0.05, sh));
    out.push(f.box(u + w / 2 + band + 0.02, u + w / 2 + band + w * 0.5, v0, v0 + (s.arched ? spring - v0 : h), 0.01, 0.05, sh));
    if (detail === "high") {
      for (const side of [-1, 1]) {
        const c = u + side * (w / 2 + band + w * 0.26);
        for (let k = 1; k < 4; k++) {
          const y = v0 + (h * k) / 4;
          out.push(f.box(c - w * 0.22, c + w * 0.22, y - 0.015, y + 0.015, 0.05, 0.06, P.shutterDark));
        }
      }
    }
  }
  // Balcony (always above head height on upper floors).
  if (s.balcony) {
    const bw = w + 0.7;
    out.push(f.box(u - bw / 2, u + bw / 2, v0 - 0.18, v0 - 0.02, 0, 0.75, P.stone));
    if (s.balcony === "stone") {
      out.push(f.box(u - bw / 2, u + bw / 2, v0 + 0.82, v0 + 0.92, 0.6, 0.75, P.stone));
      if (detail === "high") {
        for (let k = 0; k <= 6; k++) {
          const x = u - bw / 2 + 0.08 + ((bw - 0.16) * k) / 6;
          out.push(f.put(cylinder(0, 0, 0, 0.045, 0.035, 0.84, P.stone, 6).translate(x, v0 - 0.02, 0.68)));
        }
        out.push(f.box(u - bw / 2, u - bw / 2 + 0.1, v0 - 0.02, v0 + 0.82, 0.05, 0.75, P.stone));
        out.push(f.box(u + bw / 2 - 0.1, u + bw / 2, v0 - 0.02, v0 + 0.82, 0.05, 0.75, P.stone));
      } else {
        out.push(f.box(u - bw / 2, u + bw / 2, v0 - 0.02, v0 + 0.82, 0.62, 0.72, P.stoneShade));
      }
    } else {
      out.push(f.box(u - bw / 2, u + bw / 2, v0 + 0.86, v0 + 0.9, 0.66, 0.72, P.iron));
      if (detail === "high") {
        for (let k = 0; k <= 8; k++) {
          const x = u - bw / 2 + 0.05 + ((bw - 0.1) * k) / 8;
          out.push(f.box(x - 0.012, x + 0.012, v0 - 0.02, v0 + 0.86, 0.68, 0.7, P.iron));
        }
        for (const x of [u - bw / 2 + 0.03, u + bw / 2 - 0.03]) out.push(f.box(x - 0.015, x + 0.015, v0 - 0.02, v0 + 0.86, 0.05, 0.7, P.iron));
      } else {
        out.push(f.box(u - bw / 2, u + bw / 2, v0 + 0.2, v0 + 0.24, 0.66, 0.72, P.iron));
      }
    }
    if (s.flowers) potsOfFlowers(f, u - bw / 2 + 0.25, u + bw / 2 - 0.25, v0 - 0.02, 0.45, out, detail, seed);
  } else if (s.flowers) {
    out.push(f.box(u - w / 2 - 0.05, u + w / 2 + 0.05, v0 - 0.02, v0 + 0.22, 0.06, 0.34, P.terracotta));
    potsOfFlowers(f, u - w / 2 + 0.05, u + w / 2 - 0.05, v0 + 0.2, 0.22, out, detail, seed);
  }
}

function potsOfFlowers(f: Frame, u0: number, u1: number, v: number, w: number, out: THREE.BufferGeometry[], detail: Detail, seed: number): void {
  const count = detail === "high" ? Math.max(2, Math.round((u1 - u0) / 0.28)) : 2;
  for (let i = 0; i < count; i++) {
    const u = u0 + ((u1 - u0) * (i + 0.5)) / count;
    const leafy = f.point(u, v + 0.16, w);
    out.push(blob(leafy.x, leafy.y, leafy.z, 0.17, 0.15, 0.17, P.leaf[(i + seed) % 4]!, { detail: 0, lumpiness: 0.2, seed: i + seed }));
    if (detail === "high") {
      const bloom = f.point(u + 0.04, v + 0.27, w + 0.06);
      out.push(blob(bloom.x, bloom.y, bloom.z, 0.08, 0.06, 0.08, P.flowers[(i * 3 + seed) % P.flowers.length]!, { detail: 0, lumpiness: 0.1, shade: 0.9 }));
    }
  }
}

/** A panelled double door (flat or round-topped) with a stone surround. */
function doorAt(f: Frame, u: number, width: number, height: number, s: { arched?: boolean; wood: ColourInput; frame: ColourInput; fanlight?: boolean }, detail: Detail, out: THREE.BufferGeometry[]): void {
  const spring = height - width / 2;
  const leafTop = s.arched ? spring : height;
  out.push(f.box(u - width / 2, u + width / 2, 0, leafTop, 0.01, 0.06, s.wood));
  if (s.arched) out.push(f.panel(archShape(u, spring - 0.001, width, spring), 0.015, s.fanlight ? P.glass : s.wood, 10));
  if (detail === "high") {
    // Raised panels and the meeting stile.
    out.push(f.box(u - 0.025, u + 0.025, 0, leafTop, 0.06, 0.08, P.woodDark));
    for (const side of [-1, 1]) {
      const c = u + (side * width) / 4;
      for (const [a, b] of [[0.25, leafTop * 0.45], [leafTop * 0.52, leafTop - 0.2]] as const) {
        out.push(f.box(c - width / 4 + 0.12, c + width / 4 - 0.12, a, b, 0.06, 0.085, P.woodDark));
      }
    }
    // Door knobs.
    out.push(f.box(u - 0.12, u - 0.06, leafTop * 0.48, leafTop * 0.5, 0.06, 0.11, P.gold));
    out.push(f.box(u + 0.06, u + 0.12, leafTop * 0.48, leafTop * 0.5, 0.06, 0.11, P.gold));
  }
  if (s.arched) out.push(f.extrude(archBandShape(u, 0, width, spring, 0.18), 0, 0.12, s.frame, 12));
  else {
    out.push(f.box(u - width / 2 - 0.16, u - width / 2, 0, height, 0, 0.12, s.frame));
    out.push(f.box(u + width / 2, u + width / 2 + 0.16, 0, height, 0, 0.12, s.frame));
    out.push(f.box(u - width / 2 - 0.16, u + width / 2 + 0.16, height, height + 0.18, 0, 0.13, s.frame));
  }
  // Threshold step, flush with the wall's footprint.
  out.push(f.box(u - width / 2 - 0.1, u + width / 2 + 0.1, 0, 0.06, 0, 0.14, P.stoneShade));
}

/** A shop window and door under a fascia; awnings and signs are added by the caller. */
function shopfront(f: Frame, u0: number, u1: number, height: number, s: { frame: ColourInput; glass?: ColourInput }, detail: Detail, out: THREE.BufferGeometry[]): void {
  const glass = s.glass ?? P.glassWarm;
  const doorW = 1.1;
  const doorU = u1 - 0.35 - doorW / 2;
  // Display window (lit in the evening, like the glass door).
  out.push(glowing(f.box(u0 + 0.3, doorU - doorW / 2 - 0.25, 0.55, height - 0.35, 0.01, 0.03, glass), 0.45));
  out.push(f.box(u0 + 0.2, doorU - doorW / 2 - 0.15, 0, 0.55, 0, 0.1, s.frame));
  // Glass door.
  out.push(glowing(f.box(doorU - doorW / 2, doorU + doorW / 2, 0, height - 0.35, 0.01, 0.03, glass), 0.45));
  out.push(f.box(doorU - 0.02, doorU + 0.02, 0, height - 0.35, 0.03, 0.05, s.frame));
  // Frame and fascia.
  for (const u of [u0 + 0.2, doorU - doorW / 2 - 0.15, doorU + doorW / 2 + 0.05]) out.push(f.box(u, u + 0.1, 0, height - 0.35, 0, 0.1, s.frame));
  out.push(f.box(u0 + 0.2, u1 - 0.2, height - 0.35, height, 0, 0.12, s.frame));
  if (detail === "high") {
    // A few things on display (book spines, bottles) behind the glass.
    for (let i = 0; i < 6; i++) {
      const u = u0 + 0.5 + i * ((doorU - doorW / 2 - 0.45 - (u0 + 0.5)) / 6);
      out.push(f.box(u, u + 0.18, 0.6, 0.6 + 0.28 + (i % 3) * 0.06, 0.004, 0.011, P.flowers[i % P.flowers.length]!));
    }
  }
}

/** A striped fabric awning hung at `v` above head height, sticking out `reach`. */
function awning(f: Frame, u0: number, u1: number, v: number, reach: number, a: ColourInput, b: ColourInput, detail: Detail, out: THREE.BufferGeometry[]): void {
  const stripes = Math.max(4, Math.round((u1 - u0) / 0.35));
  const drop = 0.5;
  for (let i = 0; i < stripes; i++) {
    const s0 = u0 + ((u1 - u0) * i) / stripes;
    const s1 = u0 + ((u1 - u0) * (i + 1)) / stripes;
    const colour = i % 2 === 0 ? a : b;
    const p0 = f.point(s0, v, 0.02);
    const p1 = f.point(s1, v, 0.02);
    const p2 = f.point(s1, v - drop, reach);
    const p3 = f.point(s0, v - drop, reach);
    out.push(twoSided(stripedQuad(p3, p2, p1, p0, 1, () => colour)));
    // Valance.
    const q0 = f.point(s0, v - drop - 0.2, reach);
    const q1 = f.point(s1, v - drop - 0.2, reach);
    out.push(twoSided(stripedQuad(q0, q1, p2, p3, 1, () => colour)));
  }
  if (detail === "high") {
    // Iron arms.
    for (const u of [u0 + 0.1, u1 - 0.1]) out.push(rod(f.point(u, v - 0.9, 0.02), f.point(u, v - drop, reach - 0.05), 0.02, P.iron, 4));
  }
}

/** Horizontal stone band across a façade. */
const band = (f: Frame, length: number, v: number, height: number, depth: number, colour: ColourInput = P.stone) => f.box(-0.1, length + 0.1, v, v + height, 0, depth, colour);

/** Rusticated stone ground floor: courses of blocks with recessed joints. */
function rustication(f: Frame, u0: number, u1: number, v0: number, v1: number, out: THREE.BufferGeometry[], detail: Detail): void {
  const course = 0.46;
  const rows = Math.round((v1 - v0) / course);
  for (let i = 0; i < rows; i++) {
    const a = v0 + ((v1 - v0) * i) / rows;
    const b = v0 + ((v1 - v0) * (i + 1)) / rows - (detail === "high" ? 0.045 : 0);
    out.push(f.box(u0, u1, a, b, 0, 0.06, i % 2 === 0 ? P.stoneWarm : P.stone));
  }
}

/** A row of identical windows at regular centres. */
function windowRow(f: Frame, centres: readonly number[], v0: number, style: WindowStyle, detail: Detail, out: THREE.BufferGeometry[], seed = 0): void {
  centres.forEach((u, i) => windowAt(f, u, v0, { ...style, flowers: style.flowers && (i + seed) % 2 === 0 }, detail, out, seed + i));
}

const spread = (u0: number, u1: number, count: number): number[] => Array.from({ length: count }, (_, i) => u0 + ((u1 - u0) * (i + 0.5)) / count);

/** A simple back or end wall: a few windows on every floor. */
function plainSide(f: Frame, length: number, floors: readonly number[], style: WindowStyle, detail: Detail, out: THREE.BufferGeometry[]): void {
  const count = Math.max(2, Math.floor(length / 3.2));
  const centres = spread(0.4, length - 0.4, count);
  for (const v of floors) windowRow(f, centres, v, { ...style, flowers: false, balcony: null, pediment: detail === "high" ? style.pediment : null }, detail, out);
}

// ── University hall: Palazzo degli Studi ─────────────────────────────────────

function hall({ sink, detail, layout }: Ctx): void {
  const west = ob(layout, "north-west-block");
  const porch = ob(layout, "north-west-block-porch");
  const east = ob(layout, "north-west-block-east");
  const batch = "building:hall";
  const i = WALL_INSET;
  const eave = 13.2;
  const ground = 5;
  const nobile = 9.4;
  const zBack = west.minZ + i;
  const zFront = west.maxZ - i;
  const pW = porch.minX - i; // porch side walls stand inside the neighbouring blocks
  const pE = porch.maxX + i;
  const zPorch = porch.maxZ - i;

  // Solid volumes, each owned by the box it stands in.
  sink.add(batch, west.id, wallVolume(west.minX + i, pW, 0, eave, zBack, zFront, P.plasterCream));
  sink.add(batch, east.id, wallVolume(pE, east.maxX - i, 0, eave, zBack, zFront, P.plasterCream));
  sink.add(batch, porch.id, wallVolume(pW, pE, 0, ground, zBack, zPorch, P.stoneWarm));
  // The floors above the porch rest on its side walls (above everyone's head).
  sink.add(batch, null, wallVolume(pW, pE, ground, eave, zBack, zFront, P.plasterCream));

  const deco: THREE.BufferGeometry[] = [];
  const low: Record<string, THREE.BufferGeometry[]> = { [west.id]: [], [east.id]: [], [porch.id]: [] };
  const front = new Frame({ x: west.minX + i, z: zFront }, "south");
  const uOf = (x: number) => x - (west.minX + i);
  const length = east.maxX - i - (west.minX + i);
  const porchU0 = uOf(pW);
  const porchU1 = uOf(pE);
  const porchMid = (porchU0 + porchU1) / 2;

  // Rusticated ground floor on both sides of the porch, and inside it.
  rustication(front, 0, porchU0, 0, ground, low[west.id]!, detail);
  rustication(front, porchU1, length, 0, ground, low[east.id]!, detail);
  const porchLeft = new Frame({ x: pW, z: zFront }, "east"); // the porch's west wall, facing east
  rustication(porchLeft, 0, zFront - zPorch, 0, ground, low[west.id]!, detail);
  const porchRight = new Frame({ x: pE, z: zPorch }, "west");
  rustication(porchRight, 0, zFront - zPorch, 0, ground, low[east.id]!, detail);

  // Arched ground-floor windows (round-headed, Renaissance).
  const groundWindow: WindowStyle = { width: 1.25, height: 2.6, arched: true, frame: P.stone, depth: 0.12 };
  const westBays = spread(0.2, porchU0 - 0.3, 3);
  const eastBays = spread(porchU1 + 0.3, length - 0.2, 3);
  for (const u of westBays) windowAt(front, u, 1.2, groundWindow, detail, low[west.id]!);
  for (const u of eastBays) windowAt(front, u, 1.2, groundWindow, detail, low[east.id]!);
  // Iron grilles on the ground-floor windows.
  if (detail === "high") {
    for (const u of [...westBays, ...eastBays]) {
      const owner = u < porchU0 ? west.id : east.id;
      for (let k = -2; k <= 2; k++) low[owner]!.push(front.box(u + k * 0.22 - 0.012, u + k * 0.22 + 0.012, 1.2, 3.2, 0.1, 0.12, P.iron));
    }
  }

  // The porch: an arched opening in the façade, the portal at the back.
  const archSpring = 3.3;
  const archR = (porchU1 - porchU0) / 2 - 0.05;
  const spandrel = new THREE.Shape();
  spandrel.moveTo(porchU0, archSpring);
  spandrel.lineTo(porchMid - archR, archSpring);
  spandrel.absarc(porchMid, archSpring, archR, Math.PI, 0, true);
  spandrel.lineTo(porchU1, archSpring);
  spandrel.lineTo(porchU1, ground);
  spandrel.lineTo(porchU0, ground);
  spandrel.lineTo(porchU0, archSpring);
  deco.push(front.extrude(spandrel, -0.02, 0.1, P.stone, 14));
  if (detail === "high") {
    deco.push(front.extrude(archBandShape(porchMid, archSpring, archR * 2, archSpring, 0.22), 0.06, 0.16, P.stoneShade, 14));
    deco.push(front.box(porchMid - 0.2, porchMid + 0.2, archSpring + archR - 0.1, archSpring + archR + 0.42, 0.06, 0.2, P.stone)); // keystone
  }
  const back = new Frame({ x: pW, z: zPorch }, "south");
  // The portal itself is the "hall-door" obstacle in front of this wall (M7c, props.ts), so it can be tapped and highlighted.
  // Wall lanterns either side of the portal and one hanging in the porch (above head height).
  for (const u of [0.45, pE - pW - 0.45]) lantern(back.point(u, 2.75, 0.32), deco, detail, true);
  lantern(new THREE.Vector3((pW + pE) / 2, 3.8, (zPorch + zFront) / 2), deco, detail, false);

  // Piano nobile: tall windows with alternating pediments, a balcony over the porch.
  deco.push(band(front, length, ground, 0.22, 0.2));
  const nobileCentres = [...spread(0.4, porchU0 - 0.2, 3), ...spread(porchU1 + 0.2, length - 0.4, 3)];
  nobileCentres.forEach((u, k) =>
    windowAt(front, u, ground + 0.95, { width: 1.15, height: 2.5, frame: P.stone, shutters: P.shutter, pediment: k % 2 === 0 ? "triangle" : "arch", depth: 0.1 }, detail, deco, k),
  );
  windowAt(front, porchMid, ground + 0.6, { width: 1.5, height: 2.9, arched: true, frame: P.stone, balcony: "stone", flowers: true, depth: 0.1, pediment: "flat" }, detail, deco, 3);
  deco.push(band(front, length, nobile, 0.18, 0.18));
  // Top floor: smaller square windows.
  windowRow(front, spread(0.4, length - 0.4, 8), nobile + 0.85, { width: 0.95, height: 1.35, frame: P.stone, shutters: P.shutter, depth: 0.08 }, detail, deco);
  // Name in the frieze under the cornice.
  sinkSign(sink, batch, front, "hall", length / 2 - 4.2, length / 2 + 4.2, eave - 0.85, eave - 0.2, 0.06);
  // Cornice and roof.
  deco.push(front.box(-0.25, length + 0.25, eave - 0.12, eave + 0.22, -0.02, 0.5, P.stone));
  if (detail === "high") deco.push(front.box(-0.2, length + 0.2, eave - 0.32, eave - 0.12, 0, 0.32, P.stoneShade));
  deco.push(...hipRoof(west.minX + i, east.maxX - i, zBack, zFront, eave + 0.2, 2.6, 0.45, TILES));
  // Corner quoins.
  if (detail === "high") {
    for (const u of [0, length - 0.5]) {
      for (let k = 0; k < 14; k++) deco.push(front.box(u, u + (k % 2 ? 0.5 : 0.36), ground + 0.25 + k * 0.56, ground + 0.25 + k * 0.56 + 0.48, 0, 0.06, P.stone));
    }
  }
  // Banners either side of the balcony.
  for (const u of [porchU0 - 0.6, porchU1 + 0.6]) {
    const top = nobile - 0.2;
    deco.push(front.box(u - 0.45, u + 0.45, top - 2.8, top, 0.12, 0.16, P.lapis));
    deco.push(front.box(u - 0.45, u + 0.45, top - 2.95, top - 2.8, 0.12, 0.16, P.gold));
    deco.push(front.box(u - 0.06, u + 0.06, top - 2.6, top - 0.2, 0.16, 0.17, P.gold));
    deco.push(front.box(u - 0.55, u + 0.55, top - 0.06, top + 0.03, 0.08, 0.2, P.iron));
  }

  // Ends and back.
  const eastEnd = faceFrame({ minX: east.minX, maxX: east.maxX, minZ: east.minZ, maxZ: east.maxZ }, "east");
  rustication(eastEnd.f, 0, eastEnd.length, 0, ground, low[east.id]!, detail);
  plainSide(eastEnd.f, eastEnd.length, [1.4, ground + 0.95, nobile + 0.85], { width: 1, height: 1.9, frame: P.stone, shutters: P.shutter }, detail, deco);
  const backSide = faceFrame({ minX: west.minX, maxX: east.maxX, minZ: west.minZ, maxZ: west.maxZ }, "north");
  plainSide(backSide.f, backSide.length, [ground + 0.95, nobile + 0.85], { width: 1, height: 1.7, frame: P.stoneShade }, "low", deco);

  // Clock tower over the east wing, like the bell towers of the old university.
  const tx0 = -8.4;
  const tx1 = -4.8;
  const tz0 = -23.4;
  const tz1 = -19.8;
  const towerTop = 21;
  deco.push(shadeByHeight(cuboid(tx0, tx1, eave, towerTop, tz0, tz1, P.brick), eave, towerTop, 0.92, 1.04));
  if (detail === "high") {
    for (const [x, z] of [[tx0, tz0], [tx1, tz0], [tx0, tz1], [tx1, tz1]] as const) {
      for (let k = 0; k < 13; k++) {
        const y = eave + 0.2 + k * 0.58;
        deco.push(boxAt(x, y + 0.24, z, 0.42 + (k % 2) * 0.16, 0.48, 0.42 + ((k + 1) % 2) * 0.16, P.stone));
      }
    }
  }
  const towerFront = new Frame({ x: tx0, z: tz1 }, "south");
  sinkSign(sink, batch, towerFront, "clock", 0.5, 3.1, 16.2, 18.8, 0.04);
  deco.push(towerFront.extrude(archBandShape(1.8, 16.05, 2.75, 17.45, 0.16), 0.02, 0.1, P.stone, 16));
  // Belfry with arched openings on every side.
  deco.push(cuboid(tx0 - 0.15, tx1 + 0.15, towerTop, towerTop + 0.3, tz0 - 0.15, tz1 + 0.15, P.stone));
  const bt = towerTop + 0.3;
  for (const [x, z] of [[tx0, tz0], [tx1 - 0.45, tz0], [tx0, tz1 - 0.45], [tx1 - 0.45, tz1 - 0.45]] as const) deco.push(cuboid(x, x + 0.45, bt, bt + 2.4, z, z + 0.45, P.brick));
  deco.push(cuboid(tx0 + 0.3, tx1 - 0.3, bt, bt + 2.4, tz0 + 0.3, tz1 - 0.3, P.woodDark)); // dark inside with the bell
  deco.push(blob((tx0 + tx1) / 2, bt + 1.1, (tz0 + tz1) / 2, 0.55, 0.6, 0.55, P.gold, { detail: 1, lumpiness: 0, shade: 0.7 }));
  for (const side of ["north", "south", "east", "west"] as const) {
    const fr = faceFrame({ minX: tx0, maxX: tx1, minZ: tz0, maxZ: tz1 }, side, 0);
    const shape = new THREE.Shape();
    shape.moveTo(0.45, bt + 1.55);
    shape.absarc(fr.length / 2, bt + 1.55, fr.length / 2 - 0.45, Math.PI, 0, true);
    shape.lineTo(fr.length - 0.45, bt + 2.4);
    shape.lineTo(0.45, bt + 2.4);
    shape.lineTo(0.45, bt + 1.55);
    deco.push(fr.f.extrude(shape, -0.3, 0.02, P.brick, 10));
  }
  deco.push(cuboid(tx0 - 0.2, tx1 + 0.2, bt + 2.4, bt + 2.75, tz0 - 0.2, tz1 + 0.2, P.stone));
  deco.push(...hipRoof(tx0, tx1, tz0, tz1, bt + 2.75, 2.6, 0.2, { tile: P.copper, tileAlt: P.copperDark, ridge: P.copper }));
  deco.push(rod({ x: (tx0 + tx1) / 2, y: bt + 5.3, z: (tz0 + tz1) / 2 }, { x: (tx0 + tx1) / 2, y: bt + 6.3, z: (tz0 + tz1) / 2 }, 0.04, P.gold));
  deco.push(blob((tx0 + tx1) / 2, bt + 5.5, (tz0 + tz1) / 2, 0.18, 0.18, 0.18, P.gold, { detail: 1, lumpiness: 0 }));

  // Chimneys.
  if (detail === "high") for (const x of [-21, -16, -10]) deco.push(cuboid(x, x + 0.7, eave + 1.2, eave + 3.4, -22.6, -21.9, P.plasterRose), cuboid(x - 0.1, x + 0.8, eave + 3.4, eave + 3.6, -22.7, -21.8, P.roofDark));

  for (const [owner, pieces] of Object.entries(low)) sink.add(batch, owner, pieces);
  sink.add(batch, null, deco);
}

/** A lantern: on a wall bracket (`wall`) or hanging from a ceiling. */
function lantern(at: THREE.Vector3, out: THREE.BufferGeometry[], detail: Detail, wall: boolean): void {
  out.push(glowing(boxAt(at.x, at.y, at.z, 0.26, 0.36, 0.26, P.glassWarm), 1.3));
  out.push(boxAt(at.x, at.y + 0.22, at.z, 0.34, 0.08, 0.34, P.iron));
  out.push(cylinder(at.x, at.y + 0.26, at.z, 0.2, 0.02, 0.18, P.iron, 4));
  out.push(boxAt(at.x, at.y - 0.21, at.z, 0.3, 0.06, 0.3, P.iron));
  if (detail === "high") for (const [dx, dz] of [[-0.13, -0.13], [0.13, -0.13], [-0.13, 0.13], [0.13, 0.13]] as const) out.push(boxAt(at.x + dx, at.y, at.z + dz, 0.03, 0.36, 0.03, P.iron));
  if (wall) out.push(boxAt(at.x, at.y + 0.38, at.z - 0.22, 0.05, 0.05, 0.5, P.iron));
  else out.push(rod({ x: at.x, y: at.y + 0.35, z: at.z }, { x: at.x, y: at.y + 1.2, z: at.z }, 0.015, P.iron, 4));
}

/** A sign quad on a façade; its picture comes from the sign atlas (signs.ts). */
function sinkSign(sink: Sink, batch: string, f: Frame, sign: string, u0: number, u1: number, v0: number, v1: number, w: number): void {
  const g = new THREE.PlaneGeometry(u1 - u0, v1 - v0);
  g.translate((u0 + u1) / 2, (v0 + v1) / 2, w);
  f.put(g);
  const before = sink.pieces.length;
  sink.add(`${batch}:sign`, null, g, "sign");
  const piece = sink.pieces[before];
  if (piece) piece.sign = sign;
}

export { sinkSign, lantern, awning, windowAt, doorAt, shopfront, faceFrame, potsOfFlowers };

/** Centre of the hall's clock face (its hands are drawn separately and move with the game clock). */
export const CLOCK_FACE = { x: -8.4 + 1.8, y: 17.5, z: -19.8 + 0.06, radius: 1.3 };

// ── Library ──────────────────────────────────────────────────────────────────

function library({ sink, detail, layout }: Ctx): void {
  const lib = ob(layout, "north-east-block");
  const batch = "building:library";
  const i = WALL_INSET;
  const eave = 11.6;
  const ground = 5.4;
  sink.add(batch, lib.id, wallVolume(lib.minX + i, lib.maxX - i, 0, eave, lib.minZ + i, lib.maxZ - i, P.stoneWarm));
  const low: THREE.BufferGeometry[] = [];
  const deco: THREE.BufferGeometry[] = [];
  const { f, length } = faceFrame(lib, "south");
  // Plinth.
  low.push(f.box(0, length, 0, 0.6, 0, 0.1, P.trachyte));
  const bays = 7;
  const bayW = length / bays;
  const centres = Array.from({ length: bays }, (_, k) => bayW * (k + 0.5));
  const mid = Math.floor(bays / 2);
  // Giant pilasters between bays.
  for (let k = 0; k <= bays; k++) {
    // End pilasters stop at the corners (they must not stand outside the building).
    const u = Math.min(length - 0.28, Math.max(0.28, bayW * k));
    low.push(f.box(u - 0.28, u + 0.28, 0.6, 2.2, 0, 0.12, P.stone));
    deco.push(f.box(u - 0.28, u + 0.28, 2.2, eave - 1.2, 0, 0.12, P.stone));
    if (detail === "high") deco.push(f.box(u - 0.36, u + 0.36, eave - 1.45, eave - 1.2, 0, 0.18, P.stoneShade));
  }
  centres.forEach((u, k) => {
    if (k === mid) {
      // The entrance is the "library-door" obstacle in front of this bay (M7c, props.ts).
      windowAt(f, u, ground + 0.7, { width: 1.4, height: 2.6, frame: P.stone, balcony: "iron", depth: 0.1, pediment: "triangle" }, detail, deco);
    } else {
      windowAt(f, u, 0.95, { width: 1.35, height: 3.4, arched: true, frame: P.stone, glass: P.glassLight, depth: 0.1 }, detail, low);
      windowAt(f, u, ground + 0.7, { width: 1.2, height: 2.4, frame: P.stone, pediment: "flat", depth: 0.1 }, detail, deco);
    }
  });
  deco.push(band(f, length, ground, 0.2, 0.16));
  // Entablature with the name, and a pediment over the three middle bays.
  deco.push(f.box(-0.2, length + 0.2, eave - 1.2, eave, 0, 0.2, P.stone));
  deco.push(f.box(-0.3, length + 0.3, eave, eave + 0.3, -0.05, 0.45, P.stoneShade));
  sinkSign(sink, batch, f, "library", bayW * (mid - 1) + 0.3, bayW * (mid + 2) - 0.3, eave - 1.05, eave - 0.18, 0.21);
  deco.push(f.extrude(triangleShape(bayW * (mid - 1) - 0.3, bayW * (mid + 2) + 0.3, eave + 0.3, eave + 2.4), -0.05, 0.4, P.stone));
  if (detail === "high") deco.push(f.extrude(triangleShape(bayW * (mid - 1) + 0.25, bayW * (mid + 2) - 0.25, eave + 0.55, eave + 2.0), 0.4, 0.45, P.stoneShade));
  deco.push(...hipRoof(lib.minX + i, lib.maxX - i, lib.minZ + i, lib.maxZ - i, eave + 0.3, 1.8, 0.4, TILES));
  // Dome on a drum, over the reading room.
  const dx = (lib.minX + lib.maxX) / 2;
  const dz = (lib.minZ + lib.maxZ) / 2 - 0.4;
  deco.push(cylinder(dx, eave + 1.2, dz, 2.3, 2.3, 1.6, P.stone, detail === "high" ? 24 : 14));
  if (detail === "high") for (let k = 0; k < 12; k++) {
    const a = (k / 12) * Math.PI * 2;
    deco.push(boxAt(dx + Math.sin(a) * 2.3, eave + 2.0, dz + Math.cos(a) * 2.3, 0.4, 0.9, 0.06, P.glass, a));
  }
  const dome = new THREE.SphereGeometry(2.45, detail === "high" ? 24 : 14, 10, 0, Math.PI * 2, 0, Math.PI / 2);
  dome.translate(dx, eave + 2.8, dz);
  deco.push(stripedDome(dome, P.copper, P.copperDark));
  deco.push(cylinder(dx, eave + 5.15, dz, 0.4, 0.4, 0.6, P.stone, 10));
  deco.push(cylinder(dx, eave + 5.75, dz, 0.5, 0.05, 0.7, P.copper, 10));
  // Ends and back.
  const westEnd = faceFrame(lib, "west");
  plainSide(westEnd.f, westEnd.length, [1.4, ground + 0.7], { width: 1.1, height: 2.2, frame: P.stone, arched: true }, detail, low);
  const backSide = faceFrame(lib, "north");
  plainSide(backSide.f, backSide.length, [ground + 0.7], { width: 1.1, height: 2, frame: P.stoneShade }, "low", deco);
  sink.add(batch, lib.id, low);
  sink.add(batch, null, deco);
}

/** Copper dome with ribs: alternate colour per vertical segment (16 around). */
function stripedDome(g: THREE.BufferGeometry, a: ColourInput, b: ColourInput): THREE.BufferGeometry {
  g.computeBoundingBox();
  const centre = new THREE.Vector3();
  g.boundingBox!.getCenter(centre);
  const ng = g.toNonIndexed();
  const position = ng.getAttribute("position");
  const colours = new Float32Array(position.count * 3);
  const ca = new THREE.Color(a);
  const cb = new THREE.Color(b);
  for (let t = 0; t < position.count; t += 3) {
    const x = (position.getX(t) + position.getX(t + 1) + position.getX(t + 2)) / 3;
    const z = (position.getZ(t) + position.getZ(t + 1) + position.getZ(t + 2)) / 3;
    const segment = Math.floor(((Math.atan2(x - centre.x, z - centre.z) + Math.PI) / (Math.PI * 2)) * 16);
    const c = segment % 2 === 0 ? ca : cb;
    for (let k = 0; k < 3; k++) colours.set([c.r, c.g, c.b], (t + k) * 3);
  }
  ng.setAttribute("color", new THREE.Float32BufferAttribute(colours, 3));
  ng.computeVertexNormals();
  return ng;
}

// ── Residences on the west side: four narrow houses with shops ─────────────

interface HouseSpec {
  u0: number;
  u1: number;
  height: number;
  colour: ColourInput;
  shop?: { sign: string; awning: [ColourInput, ColourInput] } | null;
  door?: boolean;
  balconies?: boolean;
  shutters?: ColourInput;
  crossSign?: boolean;
}

/** A row of narrow houses along one face of a box (west residences, south housing, shops). */
function terrace(ctx: Ctx, box: Obstacle, side: Side, houses: readonly HouseSpec[], batch: string, groundH: number, floorH: number, roofAxis: "x" | "z"): void {
  const { sink, detail } = ctx;
  const i = WALL_INSET;
  const { f } = faceFrame(box, side);
  const low: THREE.BufferGeometry[] = [];
  const deco: THREE.BufferGeometry[] = [];
  houses.forEach((h, n) => {
    // Volume of this house: map its u range back to world space.
    const a = f.point(h.u0, 0, 0);
    const b = f.point(h.u1, 0, 0);
    const depthIn = side === "east" || side === "west" ? box.maxX - box.minX - 2 * i : box.maxZ - box.minZ - 2 * i;
    const inward = { x: -f.out.x * depthIn, z: -f.out.z * depthIn };
    const xs = [a.x, b.x, a.x + inward.x, b.x + inward.x];
    const zs = [a.z, b.z, a.z + inward.z, b.z + inward.z];
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minZ = Math.min(...zs);
    const maxZ = Math.max(...zs);
    sink.add(batch, box.id, wallVolume(minX, maxX, 0, groundH, minZ, maxZ, h.colour));
    deco.push(wallVolume(minX, maxX, groundH, h.height, minZ, maxZ, h.colour));
    const width = h.u1 - h.u0;
    // Ground floor.
    low.push(f.box(h.u0, h.u1, 0, 0.45, 0, 0.06, P.trachyte));
    if (h.shop) {
      shopfront(f, h.u0, h.u1, groundH - 0.5, { frame: P.woodDark }, detail, low);
      // Awning under the sign; its lowest edge stays above head height.
      sinkSign(sink, batch, f, h.shop.sign, h.u0 + 0.35, h.u1 - 0.35, groundH - 0.48, groundH - 0.06, 0.16);
      awning(f, h.u0 + 0.15, h.u1 - 0.15, groundH - 0.55, 1.05, h.shop.awning[0], h.shop.awning[1], detail, deco);
    } else if (h.door) {
      doorAt(f, h.u0 + width / 2, 1.3, 2.7, { wood: P.wood, frame: P.stone, arched: n % 2 === 0, fanlight: true }, detail, low);
      for (const u of [h.u0 + width * 0.18, h.u1 - width * 0.18]) if (width > 4.2) windowAt(f, u, 1.1, { width: 0.9, height: 1.5, frame: P.stone, depth: 0.08 }, detail, low);
    }
    if (h.crossSign) {
      const at = f.point(h.u1 - 0.5, groundH + 0.3, 0.45);
      deco.push(boxAt(at.x, at.y, at.z, 0.08, 0.08, 0.6, P.iron));
      const sign = f.point(h.u1 - 0.5, groundH + 0.3, 0.75);
      deco.push(boxAt(sign.x, sign.y, sign.z, 0.62, 0.2, 0.2, "#3db35a"), boxAt(sign.x, sign.y, sign.z, 0.2, 0.62, 0.2, "#3db35a"));
    }
    // Upper floors.
    const count = Math.max(1, Math.round(width / 2.6));
    const centres = spread(h.u0 + 0.2, h.u1 - 0.2, count);
    const floors = Math.max(1, Math.floor((h.height - groundH - 0.6) / floorH));
    for (let k = 0; k < floors; k++) {
      const v = groundH + 0.7 + k * floorH;
      windowRow(f, centres, v, {
        width: 0.95,
        height: Math.min(1.9, floorH - 0.9),
        frame: k === 0 ? P.stone : P.stoneShade,
        shutters: h.shutters ?? P.shutter,
        balcony: h.balconies && k === 0 ? "iron" : null,
        flowers: (k + n) % 2 === 0,
        pediment: k === 0 ? "flat" : null,
        depth: 0.08,
      }, detail, deco, n * 3 + k);
    }
    deco.push(f.box(h.u0, h.u1, groundH - 0.02, groundH + 0.14, 0, 0.14, P.stone));
    deco.push(f.box(h.u0 - 0.05, h.u1 + 0.05, h.height - 0.25, h.height, 0, 0.35, P.stoneShade));
    deco.push(...gableRoof(minX, maxX, minZ, maxZ, h.height, 1.9, 0.35, roofAxis, { ...TILES, wall: h.colour }));
    if (detail === "high" && n % 2 === 0) {
      const c = f.point(h.u0 + width * 0.7, 0, -1.2);
      deco.push(cuboid(c.x - 0.3, c.x + 0.3, h.height + 0.6, h.height + 2.6, c.z - 0.3, c.z + 0.3, h.colour), cuboid(c.x - 0.38, c.x + 0.38, h.height + 2.6, h.height + 2.78, c.z - 0.38, c.z + 0.38, P.roofDark));
    }
  });
  sink.add(batch, box.id, low);
  sink.add(batch, null, deco);
}

function residences(ctx: Ctx): void {
  const box = ob(ctx.layout, "west-block");
  const L = box.maxZ - box.minZ - 2 * WALL_INSET;
  const cut = [0, L * 0.25, L * 0.5, L * 0.75, L];
  terrace(ctx, box, "east", [
    { u0: cut[0]!, u1: cut[1]!, height: 13, colour: P.plasterRose, shop: { sign: "bookshop", awning: [P.shutter, P.cream] } },
    { u0: cut[1]!, u1: cut[2]!, height: 12, colour: P.plasterOchre, door: true, balconies: true },
    { u0: cut[2]!, u1: cut[3]!, height: 14, colour: P.plasterCream, shop: { sign: "pharmacy", awning: [P.olive, P.cream] }, crossSign: true },
    { u0: cut[3]!, u1: cut[4]!, height: 12.5, colour: P.plasterApricot, door: true, balconies: true, shutters: P.shutterDark },
  ], "building:residences", 4, 3, "x");
  // Back and ends face away from the square: plain walls with windows.
  const deco: THREE.BufferGeometry[] = [];
  const end = faceFrame(box, "south");
  plainSide(end.f, end.length, [4.7, 7.7], { width: 0.9, height: 1.6, frame: P.stone, shutters: P.shutter }, ctx.detail, deco);
  const end2 = faceFrame(box, "north");
  plainSide(end2.f, end2.length, [4.7, 7.7], { width: 0.9, height: 1.6, frame: P.stone, shutters: P.shutter }, ctx.detail, deco);
  ctx.sink.add("building:residences", null, deco);
}

// ── Portico houses on the east side ──────────────────────────────────────────

function porticoHouses({ sink, detail, layout }: Ctx): void {
  const house = ob(layout, "east-block");
  const columns = layout.obstacles.filter((o) => o.kind === "arcade").sort((a, b) => a.minZ - b.minZ);
  const batch = "building:portico";
  const i = WALL_INSET;
  const front = columns[0]!.minX; // outer face of the columns
  const spring = 2.9;
  const vault = 4.6;
  const z0 = house.minZ + i;
  const z1 = house.maxZ - i;
  // Ground floor behind the portico (owned by the house's box).
  sink.add(batch, house.id, wallVolume(house.minX + i, house.maxX - i, 0, vault, z0, z1, P.plasterCream));
  const low: THREE.BufferGeometry[] = [];
  const deco: THREE.BufferGeometry[] = [];
  // Shops along the back of the portico.
  const backWall = faceFrame(house, "west");
  const signs = ["osteria", "stationer", "bakery", "gelato"];
  const bayU = (z: number) => z - z0;
  for (let k = 0; k < columns.length - 1; k++) {
    const a = bayU((columns[k]!.minZ + columns[k]!.maxZ) / 2) + 0.35;
    const b = bayU((columns[k + 1]!.minZ + columns[k + 1]!.maxZ) / 2) - 0.35;
    if (k % 2 === 0) {
      shopfront(backWall.f, a, b, 3.4, { frame: P.woodDark }, detail, low);
      sinkSign(sink, batch, backWall.f, signs[(k / 2) % signs.length]!, a + 0.3, b - 0.3, 3.5, 3.95, 0.13);
    } else {
      doorAt(backWall.f, (a + b) / 2, 1.3, 2.9, { wood: P.shutterDark, frame: P.stone, arched: true, fanlight: true }, detail, low);
    }
  }
  // Floor of the portico: a lighter stone than the piazza (flat decoration).
  deco.push(cuboid(front, house.minX + i, 0.005, 0.015, z0, z1, P.marble));
  // Columns: base, shaft, capital (each owned by its column box).
  for (const c of columns) {
    const cx = (c.minX + c.maxX) / 2;
    const cz = (c.minZ + c.maxZ) / 2;
    const pieces = [
      cuboid(c.minX + 0.02, c.maxX - 0.02, 0, 0.32, c.minZ + 0.02, c.maxZ - 0.02, P.stoneShade),
      cylinder(cx, 0.32, cz, 0.22, 0.19, spring - 0.62, P.stone, detail === "high" ? 12 : 8),
      cuboid(c.minX + 0.04, c.maxX - 0.04, spring - 0.3, spring - 0.18, c.minZ + 0.04, c.maxZ - 0.04, P.stoneShade),
      cuboid(c.minX, c.maxX, spring - 0.18, spring, c.minZ, c.maxZ, P.stone),
    ];
    sink.add(batch, c.id, pieces);
  }
  // Arches between the columns, carrying the upper floors.
  const zA = columns[0]!.minZ;
  const zB = columns[columns.length - 1]!.maxZ;
  const outer = new Frame({ x: front, z: zA }, "west");
  // u runs from the north end (zA) southwards.
  const shape = new THREE.Shape();
  shape.moveTo(0, vault + 0.6);
  shape.lineTo(0, spring);
  for (let k = 0; k < columns.length - 1; k++) {
    const cA = (columns[k]!.minZ + columns[k]!.maxZ) / 2 - zA;
    const cB = (columns[k + 1]!.minZ + columns[k + 1]!.maxZ) / 2 - zA;
    const r = (cB - cA) / 2 - 0.3;
    shape.lineTo(cA + 0.3, spring);
    shape.absarc((cA + cB) / 2, spring, r, Math.PI, 0, true);
    shape.lineTo(cB, spring);
  }
  shape.lineTo(zB - zA, spring);
  shape.lineTo(zB - zA, vault + 0.6);
  shape.lineTo(0, vault + 0.6);
  // The arcade wall spans the columns' depth (0.6 m), so it reads as solid.
  const depth = columns[0]!.maxX - columns[0]!.minX;
  deco.push(outer.extrude(shape, -depth, 0, P.stone, 14));
  if (detail === "high") {
    for (let k = 0; k < columns.length - 1; k++) {
      const cA = (columns[k]!.minZ + columns[k]!.maxZ) / 2 - zA;
      const cB = (columns[k + 1]!.minZ + columns[k + 1]!.maxZ) / 2 - zA;
      const r = (cB - cA) / 2 - 0.3;
      deco.push(outer.extrude(archBandShape((cA + cB) / 2, spring, r * 2, spring, 0.16), 0, 0.06, P.stoneShade, 14));
      // A lantern hanging in every bay.
      lantern(new THREE.Vector3((front + house.minX) / 2 + 0.1, 3.55, zA + (cA + cB) / 2), deco, detail, false);
    }
  }
  // Ceiling of the portico.
  deco.push(cuboid(front, house.minX + i, vault - 0.02, vault + 0.6, zA, zB, P.plasterCream));
  // Upper floors in three house colours, resting on the arcade.
  const L = z1 - z0;
  const parts: [number, number, number, ColourInput][] = [
    [z0, z0 + L * 0.36, 12, P.plasterYellow],
    [z0 + L * 0.36, z0 + L * 0.68, 12.8, P.plasterPink],
    [z0 + L * 0.68, z1, 11.6, P.plasterSage],
  ];
  parts.forEach(([a, b, height, colour], n) => {
    deco.push(wallVolume(front, house.maxX - i, vault + 0.6, height, a, b, colour));
    const fr = new Frame({ x: front, z: a }, "west");
    const width = b - a;
    const centres = spread(0.3, width - 0.3, Math.max(2, Math.round(width / 2.2)));
    for (let k = 0; k < 2; k++) {
      windowRow(fr, centres, vault + 1.4 + k * 2.9, {
        width: 0.95,
        height: 1.8,
        frame: P.stone,
        shutters: P.shutter,
        balcony: k === 0 && n === 1 ? "iron" : null,
        flowers: true,
        pediment: k === 0 ? "flat" : null,
        depth: 0.08,
      }, detail, deco, n * 5 + k);
    }
    deco.push(fr.box(-0.05, width + 0.05, height - 0.25, height, 0, 0.35, P.stoneShade));
    deco.push(...gableRoof(front, house.maxX - i, a, b, height, 1.9, 0.35, "x", { ...TILES, wall: colour }));
  });
  sink.add(batch, house.id, low);
  sink.add(batch, null, deco);
}

// ── South side: student housing and shops ───────────────────────────────────

function southHousing(ctx: Ctx): void {
  const box = ob(ctx.layout, "south-west-block");
  const L = box.maxX - box.minX - 2 * WALL_INSET;
  terrace(ctx, box, "north", [
    { u0: 0, u1: L * 0.5, height: 11.4, colour: P.plasterYellow, door: true, balconies: true },
    { u0: L * 0.5, u1: L, height: 12.2, colour: P.plasterRed, shop: { sign: "residence", awning: [P.lapis, P.cream] }, balconies: true, shutters: P.shutterDark },
  ], "building:housing", 3.6, 2.9, "x");
  // The east end looks onto the south street.
  const deco: THREE.BufferGeometry[] = [];
  const end = faceFrame(box, "east");
  plainSide(end.f, end.length, [1.2, 4.3, 7.2], { width: 0.9, height: 1.6, frame: P.stone, shutters: P.shutter }, ctx.detail, deco);
  // Pieces reaching below head height belong to the building's box (checked by the world test).
  ctx.sink.add("building:housing", box.id, deco.filter((g) => lowest(g) < 2.2));
  ctx.sink.add("building:housing", null, deco.filter((g) => lowest(g) >= 2.2));
}

/** Lowest point of a geometry. */
function lowest(g: THREE.BufferGeometry): number {
  g.computeBoundingBox();
  return g.boundingBox!.min.y;
}

function southShops(ctx: Ctx): void {
  const box = ob(ctx.layout, "south-east-block");
  const L = box.maxX - box.minX - 2 * WALL_INSET;
  terrace(ctx, box, "north", [
    { u0: 0, u1: L * 0.34, height: 12, colour: P.plasterPink, shop: { sign: "gelato", awning: [P.terracotta, P.cream] } },
    { u0: L * 0.34, u1: L * 0.67, height: 13, colour: P.plasterSage, shop: { sign: "bakery", awning: [P.olive, P.cream] }, balconies: true },
    { u0: L * 0.67, u1: L, height: 11.5, colour: P.plasterCream, shop: { sign: "news", awning: [P.lapis, P.cream] } },
  ], "building:shops", 4, 3, "x");
  // The west end looks onto the south street.
  const pieces: THREE.BufferGeometry[] = [];
  const end = faceFrame(box, "west");
  plainSide(end.f, end.length, [1.2, 4.7, 7.7], { width: 0.9, height: 1.6, frame: P.stone, shutters: P.shutter }, ctx.detail, pieces);
  ctx.sink.add("building:shops", box.id, pieces.filter((g) => lowest(g) < 2.2));
  ctx.sink.add("building:shops", null, pieces.filter((g) => lowest(g) >= 2.2));
}

/** Builds every building around the square. */
export function buildBuildings(sink: Sink, layout: WorldLayout, detail: Detail): void {
  const ctx: Ctx = { sink, detail, layout };
  hall(ctx);
  library(ctx);
  residences(ctx);
  porticoHouses(ctx);
  southHousing(ctx);
  southShops(ctx);
}

/** Which draw batch (fade group) each building's collision box belongs to. */
export const BUILDING_BATCH: Record<string, string> = {
  "north-west-block": "building:hall",
  "north-west-block-porch": "building:hall",
  "north-west-block-east": "building:hall",
  "north-east-block": "building:library",
  "west-block": "building:residences",
  "east-block": "building:portico",
  "south-west-block": "building:housing",
  "south-east-block": "building:shops",
};
