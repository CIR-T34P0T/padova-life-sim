// Street furniture and plants (D-033): one builder per obstacle kind. Every
// builder draws inside its obstacle's box (shared/src/world.ts) below head
// height; parasols, awnings, lanterns and tree canopies may spread wider
// above 2.2 m. Interactable objects (and the chairs that belong to them) get
// their own draw batch so they can be highlighted; tree canopies get their
// own batch so they can fade when they hide your character.

import * as THREE from "three";
import type { Obstacle, Side, WorldLayout } from "@padova/shared";
import { seeded, waves } from "../avatar/geometry.ts";
import { faceFrame, lantern, sinkSign } from "./buildings.ts";
import { P } from "./palette.ts";
import { Frame, blob, boxAt, cuboid, cylinder, flatRect, paint, paintWith, rgb, ring, rod, stripedQuad, twoSided, type ColourInput, type Detail, type Sink } from "./kit.ts";

interface PropCtx {
  sink: Sink;
  detail: Detail;
  layout: WorldLayout;
  interactables: ReadonlySet<string>;
}

/** Height below which nothing may stand outside its obstacle (the test checks this). */
export const HEAD_HEIGHT = 2.2;

const centre = (o: Obstacle) => ({ x: (o.minX + o.maxX) / 2, z: (o.minZ + o.maxZ) / 2 });
const hash = (id: string) => [...id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);

/** Batch for an obstacle: interactables (and their parts) are highlightable on their own. */
function batchFor(o: Obstacle, ctx: PropCtx): string {
  const owner = o.partOf ?? o.id;
  if (ctx.interactables.has(owner)) return `interactable:${owner}`;
  // Static props in four quarters, so each quarter can be culled off screen.
  const c = centre(o);
  return `props:${c.z < 0 ? "n" : "s"}${c.x < 0 ? "w" : "e"}`;
}

/** Local frame on the obstacle's facing edge: u along it, w out (0 = edge, negative = inside). */
function frameOf(o: Obstacle, side: Side): { f: Frame; length: number; depth: number } {
  const { f, length } = faceFrame(o, side, 0);
  const depth = side === "north" || side === "south" ? o.maxZ - o.minZ : o.maxX - o.minX;
  return { f, length, depth };
}

// ── Seating ──────────────────────────────────────────────────────────────────

function bench(o: Obstacle, ctx: PropCtx): void {
  const { f, length, depth } = frameOf(o, o.facing ?? "south");
  const g: THREE.BufferGeometry[] = [];
  const iron = P.ironGreen;
  // Cast-iron end frames.
  for (const u of [0.1, length - 0.16]) {
    g.push(f.box(u, u + 0.06, 0, 0.44, -0.16, -0.08, iron)); // front leg
    g.push(f.box(u, u + 0.06, 0, 0.84, -depth + 0.04, -depth + 0.12, iron)); // back leg, up to the backrest
    g.push(f.box(u, u + 0.06, 0.6, 0.65, -depth + 0.04, -0.06, iron)); // armrest
    g.push(f.box(u, u + 0.06, 0.38, 0.42, -depth + 0.06, -0.1, iron)); // seat rail
  }
  // Seat and back slats.
  const slats = ctx.detail === "high" ? 4 : 2;
  for (let k = 0; k < slats; k++) {
    const w0 = -depth + 0.1 + ((depth - 0.12) * k) / slats;
    g.push(f.box(0.04, length - 0.04, 0.42, 0.47, w0, w0 + (depth - 0.12) / slats - 0.02, k % 2 ? P.woodLight : P.oak));
  }
  for (const [v0, v1] of [[0.52, 0.64], [0.7, 0.82]] as const) g.push(f.box(0.04, length - 0.04, v0, v1, -depth + 0.02, -depth + 0.07, P.oak));
  ctx.sink.add(batchFor(o, ctx), o.id, g);
}

function chair(o: Obstacle, ctx: PropCtx): void {
  // The sitter looks towards `facing`; the backrest is behind them.
  const { f, length, depth } = frameOf(o, o.facing ?? "north");
  const g: THREE.BufferGeometry[] = [];
  const cafe = (o.partOf ?? "").startsWith("cafe");
  const seatColour = cafe ? [P.terracotta, P.olive, P.lapisLight][hash(o.id) % 3]! : P.oak;
  const frame = cafe ? P.iron : P.wood;
  const leg = 0.035;
  for (const u of [0.04, length - 0.04 - leg]) {
    for (const w of [-0.04 - leg, -depth + 0.04]) g.push(f.box(u, u + leg, 0, 0.44, w, w + leg, frame));
  }
  g.push(f.box(0.02, length - 0.02, 0.42, 0.47, -depth + 0.02, -0.02, seatColour));
  // Backrest at the back edge.
  for (const u of [0.04, length - 0.04 - leg]) g.push(f.box(u, u + leg, 0.47, 0.88, -depth + 0.02, -depth + 0.02 + leg, frame));
  g.push(f.box(0.04, length - 0.04, 0.66, 0.86, -depth + 0.01, -depth + 0.05, cafe ? seatColour : P.oak));
  ctx.sink.add(batchFor(o, ctx), o.id, g);
}

function studyDesk(o: Obstacle, ctx: PropCtx): void {
  const { f, length, depth } = frameOf(o, o.facing ?? "south");
  const g: THREE.BufferGeometry[] = [];
  g.push(f.box(0.02, length - 0.02, 0.72, 0.78, -depth + 0.02, -0.02, P.oak));
  for (const u of [0.06, length - 0.1]) {
    for (const w of [-0.1, -depth + 0.06]) g.push(f.box(u, u + 0.04, 0, 0.72, w, w + 0.04, P.iron));
  }
  g.push(f.box(0.06, length - 0.06, 0.12, 0.16, -depth + 0.08, -depth + 0.12, P.iron)); // foot rail
  // Books, a laptop and a desk lamp.
  const books: ColourInput[] = [P.terracotta, P.lapisLight, P.olive, P.gold];
  books.forEach((c, k) => g.push(f.box(0.12, 0.42, 0.78 + k * 0.045, 0.82 + k * 0.045, -depth + 0.12, -depth + 0.36, c)));
  if (ctx.detail === "high") {
    g.push(f.box(length / 2 - 0.2, length / 2 + 0.2, 0.78, 0.8, -0.42, -0.14, P.trachyteDark));
    const screen = new THREE.BoxGeometry(0.4, 0.26, 0.015);
    screen.rotateX(-0.25);
    screen.translate(0, 0.13, 0);
    g.push(f.put(paint(screen.translate(length / 2, 0.8, -0.42), P.glass)));
    g.push(f.box(length - 0.3, length - 0.18, 0.78, 0.8, -depth + 0.14, -depth + 0.26, P.iron));
    g.push(f.put(rod({ x: length - 0.24, y: 0.8, z: -depth + 0.2 }, { x: length - 0.3, y: 1.18, z: -depth + 0.32 }, 0.012, P.iron, 4)));
    g.push(f.put(cylinder(length - 0.3, 1.08, -depth + 0.34, 0.08, 0.03, 0.12, P.gold, 8)));
  }
  ctx.sink.add(batchFor(o, ctx), o.id, g);
}

function cafeTable(o: Obstacle, ctx: PropCtx): void {
  const c = centre(o);
  const r = Math.min(o.maxX - o.minX, o.maxZ - o.minZ) / 2 - 0.03;
  const seg = ctx.detail === "high" ? 18 : 10;
  const solid = [
    cylinder(c.x, 0, c.z, 0.26, 0.22, 0.04, P.iron, seg),
    cylinder(c.x, 0.04, c.z, 0.045, 0.035, 0.68, P.iron, 6),
    cylinder(c.x, 0.72, c.z, r, r, 0.04, P.marble, seg),
  ];
  if (ctx.detail === "high") {
    // Two coffee cups on saucers.
    for (const side of [-1, 1]) {
      const z = c.z + side * 0.18;
      solid.push(cylinder(c.x + side * 0.08, 0.76, z, 0.07, 0.07, 0.01, P.cream, 10), cylinder(c.x + side * 0.08, 0.77, z, 0.035, 0.04, 0.05, P.cream, 8));
    }
  }
  const batch = batchFor(o, ctx);
  ctx.sink.add(batch, o.id, solid);
  // Parasol: the pole stands in the table, the canopy is above head height.
  const parasol = [rod({ x: c.x, y: 0.76, z: c.z }, { x: c.x, y: 2.85, z: c.z }, 0.025, P.woodLight, 6), ...parasolCanopy(c.x, 2.35, c.z, 1.25, 0.42, P.cream, P.terracotta, 8)];
  ctx.sink.add(batch, null, parasol);
}

/** An eight-panel striped parasol canopy whose rim sits at `rimY`. */
function parasolCanopy(x: number, rimY: number, z: number, radius: number, rise: number, a: ColourInput, b: ColourInput, panels: number): THREE.BufferGeometry[] {
  const pieces: THREE.BufferGeometry[] = [];
  const apex = new THREE.Vector3(x, rimY + rise, z);
  for (let k = 0; k < panels; k++) {
    const a0 = (k / panels) * Math.PI * 2;
    const a1 = ((k + 1) / panels) * Math.PI * 2;
    const p0 = new THREE.Vector3(x + Math.sin(a0) * radius, rimY, z + Math.cos(a0) * radius);
    const p1 = new THREE.Vector3(x + Math.sin(a1) * radius, rimY, z + Math.cos(a1) * radius);
    pieces.push(twoSided(stripedQuad(p0, p1, apex, apex, 1, () => (k % 2 === 0 ? a : b))));
    // Short valance hanging from the rim.
    const q0 = p0.clone().setY(rimY - 0.12);
    const q1 = p1.clone().setY(rimY - 0.12);
    pieces.push(twoSided(stripedQuad(q0, q1, p1, p0, 1, () => (k % 2 === 0 ? b : a))));
  }
  return pieces;
}

// ── Café kiosk ───────────────────────────────────────────────────────────────

function counter(o: Obstacle, ctx: PropCtx): void {
  const { f, length, depth } = frameOf(o, o.facing ?? "north");
  const g: THREE.BufferGeometry[] = [];
  const deco: THREE.BufferGeometry[] = [];
  // Counter body with panels, marble top.
  g.push(f.box(0.05, length - 0.05, 0, 1.0, -depth + 0.15, -0.06, P.woodDark));
  g.push(f.box(0.02, length - 0.02, 1.0, 1.07, -depth + 0.02, -0.01, P.marble));
  g.push(f.box(0.05, length - 0.05, 0, 0.1, -depth + 0.15, -0.04, P.trachyteDark));
  for (let k = 0; k < 4; k++) {
    const u = 0.2 + k * ((length - 0.4) / 4);
    g.push(f.box(u + 0.05, u + (length - 0.4) / 4 - 0.05, 0.2, 0.85, -0.06, -0.03, P.wood));
  }
  // Espresso machine, cups and a pastry case.
  g.push(f.box(0.45, 1.15, 1.07, 1.5, -depth + 0.2, -depth + 0.55, P.chrome));
  g.push(f.box(0.5, 1.1, 1.38, 1.46, -depth + 0.55, -depth + 0.58, P.terracotta));
  g.push(f.box(1.55, 2.55, 1.07, 1.4, -0.45, -0.08, P.glassLight));
  if (ctx.detail === "high") {
    for (let k = 0; k < 6; k++) {
      const p = f.point(1.7 + k * 0.15, 1.13, -0.27 + (k % 2) * 0.1);
      g.push(blob(p.x, p.y, p.z, 0.06, 0.035, 0.05, P.orange, { detail: 0, lumpiness: 0.1, shade: 0.8 }));
    }
    for (let k = 0; k < 5; k++) g.push(f.put(cylinder(0.3 + k * 0.12, 1.07, -depth + 0.7, 0.035, 0.04, 0.06, P.cream, 8)));
    // Bottles on a back shelf.
    g.push(f.box(0.2, length - 0.2, 0.55, 0.58, -depth + 0.02, -depth + 0.14, P.wood));
    for (let k = 0; k < 9; k++) g.push(f.put(cylinder(0.3 + k * 0.27, 0.58, -depth + 0.08, 0.035, 0.03, 0.26, [P.olive, P.burgundy, P.gold][k % 3]!, 6)));
  }
  // Canopy on four slim posts (posts inside the box, canopy above head height).
  for (const u of [0.05, length - 0.09]) {
    for (const w of [-0.05, -depth + 0.01]) g.push(f.box(u, u + 0.04, 0, 2.45, w - 0.04, w, P.iron));
  }
  const p = (u: number, v: number, w: number) => f.point(u, v, w);
  const stripes = 9;
  for (let k = 0; k < stripes; k++) {
    const u0 = -0.3 + ((length + 0.6) * k) / stripes;
    const u1 = -0.3 + ((length + 0.6) * (k + 1)) / stripes;
    const colour = k % 2 === 0 ? P.shutter : P.cream;
    // Roof slopes down from the barista side to the customers' side.
    deco.push(twoSided(stripedQuad(p(u0, 2.5, 0.55), p(u1, 2.5, 0.55), p(u1, 2.82, -depth - 0.55), p(u0, 2.82, -depth - 0.55), 1, () => colour)));
  }
  deco.push(twoSided(stripedQuad(p(-0.3, 2.28, 0.55), p(length + 0.3, 2.28, 0.55), p(length + 0.3, 2.5, 0.55), p(-0.3, 2.5, 0.55), 1, () => P.shutter)));
  sinkSign(ctx.sink, batchFor(o, ctx), f, "cafe", 0.1, length - 0.1, 2.29, 2.49, 0.56);
  ctx.sink.add(batchFor(o, ctx), o.id, g);
  ctx.sink.add(batchFor(o, ctx), null, deco);
}

// ── Market stalls ────────────────────────────────────────────────────────────

const STALL_THEMES: Record<string, { awning: [ColourInput, ColourInput]; goods: "produce" | "flowers" | "books" }> = {
  "stall-1": { awning: [P.terracotta, P.cream], goods: "produce" },
  "stall-2": { awning: [P.olive, P.cream], goods: "flowers" },
  "stall-3": { awning: [P.lapis, P.cream], goods: "books" },
};

function stall(o: Obstacle, ctx: PropCtx): void {
  const theme = STALL_THEMES[o.id] ?? STALL_THEMES["stall-1"]!;
  const { f, length, depth } = frameOf(o, "south");
  const g: THREE.BufferGeometry[] = [];
  const deco: THREE.BufferGeometry[] = [];
  const rng = seeded(hash(o.id));
  // Trestle table along the front, a cloth skirt, crates behind.
  g.push(f.box(0.1, length - 0.1, 0.78, 0.84, -0.95, -0.05, P.woodLight));
  g.push(f.box(0.1, length - 0.1, 0.12, 0.78, -0.08, -0.05, theme.awning[0]));
  for (const u of [0.15, length - 0.2]) g.push(f.box(u, u + 0.05, 0, 0.78, -0.9, -0.15, P.wood));
  for (let k = 0; k < 3; k++) {
    const u = 0.25 + k * ((length - 0.5) / 3);
    g.push(f.box(u, u + 0.7, 0, 0.32, -depth + 0.15, -depth + 0.65, P.woodLight));
    g.push(f.box(u + 0.08, u + 0.62, 0.32, 0.6, -depth + 0.2, -depth + 0.6, P.wood));
  }
  // Poles.
  for (const u of [0.06, length - 0.12]) {
    for (const w of [-0.06, -depth + 0.06]) g.push(f.box(u, u + 0.06, 0, 2.62, w - 0.06, w, P.iron));
  }
  // Goods on the table.
  const crates = 4;
  for (let k = 0; k < crates; k++) {
    const u0 = 0.2 + k * ((length - 0.4) / crates);
    const u1 = u0 + (length - 0.4) / crates - 0.06;
    if (theme.goods === "books") {
      const books = ctx.detail === "high" ? 7 : 3;
      for (let b = 0; b < books; b++) {
        const bu = u0 + ((u1 - u0) * b) / books;
        const colour = [P.terracotta, P.lapisLight, P.olive, P.gold, P.burgundy, P.cream][(b + k) % 6]!;
        g.push(f.box(bu, bu + (u1 - u0) / books - 0.01, 0.84, 0.84 + 0.1 + rng() * 0.06, -0.8, -0.2, colour));
      }
      continue;
    }
    g.push(f.box(u0, u1, 0.84, 1.0, -0.85, -0.15, P.woodLight));
    const fill = theme.goods === "produce" ? [P.tomato, P.lemon, P.aubergine, P.greens][k]! : P.leaf[k % 4]!;
    const lumps = ctx.detail === "high" ? 5 : 2;
    for (let b = 0; b < lumps; b++) {
      const at = f.point(u0 + ((u1 - u0) * (b + 0.5)) / lumps, 1.02, -0.5 + (rng() - 0.5) * 0.3);
      g.push(blob(at.x, at.y, at.z, (u1 - u0) / lumps / 1.6, 0.09, 0.2, fill, { detail: 1, lumpiness: 0.25, seed: b + k, shade: 0.75 }));
      if (theme.goods === "flowers") {
        const bloom = f.point(u0 + ((u1 - u0) * (b + 0.5)) / lumps, 1.14, -0.5);
        g.push(blob(bloom.x, bloom.y, bloom.z, 0.09, 0.06, 0.09, P.flowers[(b + k * 2) % P.flowers.length]!, { detail: 0, lumpiness: 0.1, shade: 0.9 }));
      }
    }
  }
  // Striped awning, sloping to the front; its lowest edge stays above head height.
  const p = (u: number, v: number, w: number) => f.point(u, v, w);
  const stripes = 8;
  for (let k = 0; k < stripes; k++) {
    const u0 = -0.15 + ((length + 0.3) * k) / stripes;
    const u1 = -0.15 + ((length + 0.3) * (k + 1)) / stripes;
    const colour = k % 2 === 0 ? theme.awning[0] : theme.awning[1];
    deco.push(twoSided(stripedQuad(p(u0, 2.45, 0.35), p(u1, 2.45, 0.35), p(u1, 2.85, -depth - 0.1), p(u0, 2.85, -depth - 0.1), 1, () => colour)));
    // Scalloped valance.
    const scallop = new THREE.BufferGeometry();
    const a = p(u0, 2.45, 0.35);
    const b = p(u1, 2.45, 0.35);
    const tip = p((u0 + u1) / 2, 2.25, 0.35);
    scallop.setAttribute("position", new THREE.Float32BufferAttribute([a.x, a.y, a.z, tip.x, tip.y, tip.z, b.x, b.y, b.z], 3));
    scallop.computeVertexNormals();
    deco.push(twoSided(paint(scallop, colour)));
  }
  ctx.sink.add(batchFor(o, ctx), o.id, g);
  ctx.sink.add(batchFor(o, ctx), null, deco);
}

// ── Fountain ─────────────────────────────────────────────────────────────────

/** A square with cut corners, as a list of points (for basins and inlays). */
function chamferedSquare(cx: number, cz: number, half: number, cut: number): [number, number][] {
  return [
    [cx - half + cut, cz - half], [cx + half - cut, cz - half], [cx + half, cz - half + cut], [cx + half, cz + half - cut],
    [cx + half - cut, cz + half], [cx - half + cut, cz + half], [cx - half, cz + half - cut], [cx - half, cz - half + cut],
  ];
}

function extrudeUp(outer: [number, number][], inner: [number, number][] | null, y0: number, height: number, colour: ColourInput): THREE.BufferGeometry {
  const shape = new THREE.Shape(outer.map(([x, z]) => new THREE.Vector2(x, -z)));
  if (inner) shape.holes.push(new THREE.Path(inner.map(([x, z]) => new THREE.Vector2(x, -z))));
  const g = new THREE.ExtrudeGeometry(shape, { depth: height, bevelEnabled: false });
  g.rotateX(-Math.PI / 2);
  g.translate(0, y0, 0);
  return paint(g, colour);
}

function fountain(o: Obstacle, ctx: PropCtx): void {
  const c = centre(o);
  const half = (o.maxX - o.minX) / 2;
  const seg = ctx.detail === "high" ? 20 : 12;
  const batch = batchFor(o, ctx);
  const g: THREE.BufferGeometry[] = [];
  g.push(extrudeUp(chamferedSquare(c.x, c.z, half - 0.02, 0.45), null, 0, 0.12, P.stoneShade));
  g.push(extrudeUp(chamferedSquare(c.x, c.z, half - 0.1, 0.42), chamferedSquare(c.x, c.z, half - 0.42, 0.32), 0.12, 0.43, P.stone));
  g.push(extrudeUp(chamferedSquare(c.x, c.z, half - 0.06, 0.44), chamferedSquare(c.x, c.z, half - 0.44, 0.31), 0.55, 0.08, P.marble));
  g.push(extrudeUp(chamferedSquare(c.x, c.z, half - 0.42, 0.32), null, 0.12, 0.2, P.trachyteDark)); // basin floor
  // Pedestal, bowl, upper shaft and finial.
  g.push(cylinder(c.x, 0.32, c.z, 0.5, 0.42, 1.08, P.stone, 8));
  g.push(cylinder(c.x, 1.4, c.z, 0.45, 1.0, 0.28, P.stone, seg));
  g.push(cylinder(c.x, 1.68, c.z, 0.16, 0.13, 0.5, P.stone, 10));
  g.push(cylinder(c.x, 2.18, c.z, 0.18, 0.42, 0.14, P.stone, seg));
  g.push(blob(c.x, 2.48, c.z, 0.16, 0.22, 0.16, P.stoneShade, { detail: 1, lumpiness: 0.05 }));
  for (let k = 0; k < 4; k++) {
    // Bronze spouts on the pedestal.
    const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
    g.push(rod({ x: c.x + Math.sin(a) * 0.4, y: 1.02, z: c.z + Math.cos(a) * 0.4 }, { x: c.x + Math.sin(a) * 0.64, y: 1.0, z: c.z + Math.cos(a) * 0.64 }, 0.045, "#8a6a3a", 6));
  }
  ctx.sink.add(batch, o.id, g);
  // Water: the pool, the bowl and four streams.
  const water: THREE.BufferGeometry[] = [
    extrudeUp(chamferedSquare(c.x, c.z, half - 0.43, 0.31), null, 0.32, 0.12, P.water),
    cylinder(c.x, 1.62, c.z, 0.93, 0.93, 0.04, P.water, seg),
    cylinder(c.x, 2.3, c.z, 0.36, 0.36, 0.03, P.water, 10),
  ];
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
    water.push(rod({ x: c.x + Math.sin(a) * 0.62, y: 1.0, z: c.z + Math.cos(a) * 0.62 }, { x: c.x + Math.sin(a) * 1.15, y: 0.44, z: c.z + Math.cos(a) * 1.15 }, 0.035, P.water, 6));
    water.push(rod({ x: c.x + Math.sin(a + Math.PI / 4) * 0.95, y: 1.64, z: c.z + Math.cos(a + Math.PI / 4) * 0.95 }, { x: c.x + Math.sin(a + Math.PI / 4) * 1.05, y: 0.44, z: c.z + Math.cos(a + Math.PI / 4) * 1.05 }, 0.025, P.water, 5));
  }
  ctx.sink.add(batch, o.id, water, "water");
}

// ── Planters, gardens, trees ────────────────────────────────────────────────

function planter(o: Obstacle, ctx: PropCtx): void {
  const batch = batchFor(o, ctx);
  const g: THREE.BufferGeometry[] = [];
  const street = o.id.includes("street");
  const rng = seeded(hash(o.id));
  if (street) {
    // Long stone trough with a clipped hedge and flowers: closes the street.
    g.push(cuboid(o.minX + 0.02, o.maxX - 0.02, 0, 0.62, o.minZ + 0.02, o.maxZ - 0.02, P.stone));
    g.push(cuboid(o.minX, o.maxX, 0.62, 0.68, o.minZ, o.maxZ, P.stoneShade));
    const long = o.maxX - o.minX > o.maxZ - o.minZ;
    const length = long ? o.maxX - o.minX : o.maxZ - o.minZ;
    const tufts = Math.max(2, Math.round(length / (ctx.detail === "high" ? 0.45 : 0.9)));
    const spacing = length / tufts;
    for (let k = 0; k < tufts; k++) {
      const t = (k + 0.5) / tufts;
      const x = long ? o.minX + (o.maxX - o.minX) * t : (o.minX + o.maxX) / 2;
      const z = long ? (o.minZ + o.maxZ) / 2 : o.minZ + (o.maxZ - o.minZ) * t;
      const across = (long ? o.maxZ - o.minZ : o.maxX - o.minX) / 2 - 0.08;
      // Tufts overlap a little but never reach past the trough's ends.
      const along = Math.min(0.3, spacing * 0.5 / 1.15);
      g.push(blob(x, 0.78, z, long ? along : across, 0.18, long ? across : along, P.hedge, { detail: 1, lumpiness: 0.15, seed: k }));
      if (ctx.detail === "high" && k % 2 === 0) g.push(blob(x + (rng() - 0.5) * 0.2, 0.93, z + (rng() - 0.5) * 0.2, 0.1, 0.07, 0.1, P.flowers[(k + hash(o.id)) % P.flowers.length]!, { detail: 0, lumpiness: 0.1, shade: 0.9 }));
    }
    ctx.sink.add(batch, o.id, g);
    return;
  }
  // Square terracotta pot with a little lemon tree.
  const c = centre(o);
  const half = (o.maxX - o.minX) / 2;
  g.push(cuboid(o.minX + 0.05, o.maxX - 0.05, 0, 0.74, o.minZ + 0.05, o.maxZ - 0.05, P.terracotta));
  g.push(cuboid(o.minX, o.maxX, 0.74, 0.86, o.minZ, o.maxZ, P.stone));
  g.push(cuboid(o.minX + 0.12, o.maxX - 0.12, 0.86, 0.88, o.minZ + 0.12, o.maxZ - 0.12, P.soil));
  g.push(cylinder(c.x, 0.86, c.z, 0.07, 0.05, 0.9, P.bark, 6));
  const r = Math.min(0.66, half - 0.1);
  g.push(blob(c.x, 2.0, c.z, r, r * 0.85, r, P.leaf[1], { detail: ctx.detail === "high" ? 2 : 1, lumpiness: 0.06, seed: hash(o.id) % 10 }));
  if (ctx.detail === "high") for (let k = 0; k < 9; k++) {
    const a = k * 2.4;
    const y = 1.75 + (k % 3) * 0.22;
    g.push(blob(c.x + Math.sin(a) * r * 0.92, y, c.z + Math.cos(a) * r * 0.92, 0.06, 0.07, 0.06, P.lemon, { detail: 0, lumpiness: 0, shade: 0.85 }));
  }
  ctx.sink.add(batch, o.id, g);
}

/** A plane tree's canopy: a cluster of lumpy blobs around (x, y, z). */
function canopy(x: number, y: number, z: number, spread: number, detail: Detail, seed: number): THREE.BufferGeometry[] {
  const rng = seeded(seed);
  const count = detail === "high" ? 8 : 4;
  const pieces: THREE.BufferGeometry[] = [blob(x, y, z, spread * 0.75, spread * 0.6, spread * 0.75, P.leaf[seed % 4]!, { detail: detail === "high" ? 2 : 1, lumpiness: 0.16, seed })];
  for (let k = 0; k < count; k++) {
    const a = (k / count) * Math.PI * 2 + rng() * 0.6;
    const d = spread * (0.45 + rng() * 0.3);
    const s = spread * (0.42 + rng() * 0.18);
    pieces.push(blob(x + Math.sin(a) * d, y + (rng() - 0.3) * spread * 0.45, z + Math.cos(a) * d, s, s * 0.82, s, P.leaf[(k + seed) % 4]!, { detail: 1, lumpiness: 0.18, seed: seed + k }));
  }
  return pieces;
}

/** A mottled plane-tree trunk (bark peels in pale patches) with a few branches. */
function trunk(x: number, z: number, height: number, radius: number, detail: Detail, seed: number): THREE.BufferGeometry[] {
  const t = new THREE.CylinderGeometry(radius * 0.75, radius, height, detail === "high" ? 10 : 6, detail === "high" ? 6 : 2);
  t.translate(x, height / 2, z);
  const bark = rgb(P.bark);
  const patch = rgb(P.barkPatch);
  const trunkGeometry = paintWith(t, (p) => (waves(p.x * 3 + seed, p.y * 2.2, p.z * 3, 1.4) > 0.15 ? patch : bark));
  const pieces = [trunkGeometry];
  const rng = seeded(seed + 3);
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI * 2 + rng();
    pieces.push(rod({ x, y: height - 0.5, z }, { x: x + Math.sin(a) * 1.1, y: height + 1.2, z: z + Math.cos(a) * 1.1 }, radius * 0.45, P.bark, 5));
  }
  return pieces;
}

function tree(o: Obstacle, ctx: PropCtx): void {
  const c = centre(o);
  const seed = hash(o.id) % 97;
  const g: THREE.BufferGeometry[] = [];
  // Stone tree grate.
  const t = 0.12;
  g.push(cuboid(o.minX + 0.02, o.maxX - 0.02, 0, 0.1, o.minZ + 0.02, o.minZ + t, P.stone));
  g.push(cuboid(o.minX + 0.02, o.maxX - 0.02, 0, 0.1, o.maxZ - t, o.maxZ - 0.02, P.stone));
  g.push(cuboid(o.minX + 0.02, o.minX + t, 0, 0.1, o.minZ + t, o.maxZ - t, P.stone));
  g.push(cuboid(o.maxX - t, o.maxX - 0.02, 0, 0.1, o.minZ + t, o.maxZ - t, P.stone));
  g.push(cuboid(o.minX + t, o.maxX - t, 0.02, 0.04, o.minZ + t, o.maxZ - t, P.iron));
  const trunkHeight = 3.4;
  // The branches start above head height; the trunk itself stays inside the grate.
  const [trunkPiece, ...branches] = trunk(c.x, c.z, trunkHeight, 0.24, ctx.detail, seed);
  g.push(trunkPiece!);
  ctx.sink.add(batchFor(o, ctx), o.id, g);
  ctx.sink.add(batchFor(o, ctx), null, branches);
  ctx.sink.add(`canopy:${o.id}`, null, canopy(c.x, trunkHeight + 2.0, c.z, 2.3, ctx.detail, seed));
}

function garden(o: Obstacle, ctx: PropCtx): void {
  const batch = batchFor(o, ctx);
  const g: THREE.BufferGeometry[] = [];
  const t = 0.42;
  const h = 0.58;
  const e = 0.03;
  // Clipped box hedge around a lawn.
  g.push(cuboid(o.minX + e, o.maxX - e, 0, h, o.minZ + e, o.minZ + t, P.hedge));
  g.push(cuboid(o.minX + e, o.maxX - e, 0, h, o.maxZ - t, o.maxZ - e, P.hedge));
  g.push(cuboid(o.minX + e, o.minX + t, 0, h, o.minZ + t, o.maxZ - t, P.hedge));
  g.push(cuboid(o.maxX - t, o.maxX - e, 0, h, o.minZ + t, o.maxZ - t, P.hedge));
  if (ctx.detail === "high") {
    // Hedge tops a shade lighter, so the box shape reads from above.
    g.push(cuboid(o.minX + e, o.maxX - e, h, h + 0.04, o.minZ + e, o.minZ + t, P.leaf[2]), cuboid(o.minX + e, o.maxX - e, h, h + 0.04, o.maxZ - t, o.maxZ - e, P.leaf[2]));
  }
  g.push(cuboid(o.minX + t, o.maxX - t, 0, 0.14, o.minZ + t, o.maxZ - t, P.lawn));
  const c = centre(o);
  const rng = seeded(hash(o.id));
  // Flower beds at the corners and a small tree in the middle.
  const flowers = ctx.detail === "high" ? 14 : 6;
  for (let k = 0; k < flowers; k++) {
    const x = o.minX + t + 0.25 + rng() * (o.maxX - o.minX - 2 * t - 0.5);
    const z = o.minZ + t + 0.25 + rng() * (o.maxZ - o.minZ - 2 * t - 0.5);
    if (Math.hypot(x - c.x, z - c.z) < 0.6) continue;
    g.push(blob(x, 0.24, z, 0.18, 0.12, 0.18, P.leaf[k % 4]!, { detail: 0, lumpiness: 0.2, seed: k }));
    g.push(blob(x, 0.33, z, 0.09, 0.06, 0.09, P.flowers[k % P.flowers.length]!, { detail: 0, lumpiness: 0.1, shade: 0.9 }));
  }
  const seed = hash(o.id) % 89;
  const [trunkPiece, ...branches] = trunk(c.x, c.z, 3.0, 0.2, ctx.detail, seed);
  g.push(trunkPiece!);
  ctx.sink.add(batch, o.id, g);
  ctx.sink.add(batch, null, branches);
  ctx.sink.add(`canopy:${o.id}`, null, canopy(c.x, 4.8, c.z, 2.0, ctx.detail, seed));
}

// ── Lamps, bicycles, notice board ───────────────────────────────────────────

function lamp(o: Obstacle, ctx: PropCtx): void {
  const c = centre(o);
  const g: THREE.BufferGeometry[] = [
    cylinder(c.x, 0, c.z, 0.19, 0.17, 0.12, P.ironGreen, 8),
    cylinder(c.x, 0.12, c.z, 0.15, 0.1, 0.5, P.ironGreen, 8),
    cylinder(c.x, 0.62, c.z, 0.075, 0.055, 3.02, P.ironGreen, 8),
  ];
  if (ctx.detail === "high") g.push(cylinder(c.x, 1.6, c.z, 0.09, 0.09, 0.12, P.gold, 8), cylinder(c.x, 3.4, c.z, 0.06, 0.12, 0.12, P.ironGreen, 8));
  ctx.sink.add(batchFor(o, ctx), o.id, g);
  const head: THREE.BufferGeometry[] = [];
  lantern(new THREE.Vector3(c.x, 3.84, c.z), head, ctx.detail, false);
  ctx.sink.add(batchFor(o, ctx), null, head.filter((_, k) => k !== head.length - 1)); // drop the hanging rod
}

function bikeRack(o: Obstacle, ctx: PropCtx): void {
  const { f, length, depth } = frameOf(o, o.facing ?? "north");
  const g: THREE.BufferGeometry[] = [];
  const bikes = 4;
  const colours: ColourInput[] = [P.terracotta, P.lapisLight, P.cream, P.olive];
  for (let k = 0; k < bikes; k++) {
    const u = (length * (k + 0.5)) / bikes;
    // Steel hoop in the middle of the rack.
    const hoopW = -depth / 2;
    g.push(f.put(rod({ x: u - 0.18, y: 0, z: hoopW - 0.25 }, { x: u - 0.18, y: 0.8, z: hoopW - 0.25 }, 0.025, P.chrome, 5)));
    g.push(f.put(rod({ x: u - 0.18, y: 0, z: hoopW + 0.25 }, { x: u - 0.18, y: 0.8, z: hoopW + 0.25 }, 0.025, P.chrome, 5)));
    g.push(f.put(rod({ x: u - 0.18, y: 0.8, z: hoopW - 0.25 }, { x: u - 0.18, y: 0.8, z: hoopW + 0.25 }, 0.025, P.chrome, 5)));
    // A bicycle parked across the rack, front wheel towards the facing side.
    const front = -0.42;
    const back = -depth + 0.42;
    const colour = colours[k % colours.length]!;
    for (const w of [front, back]) g.push(f.put(ring({ x: u, y: 0.36, z: w }, 0.33, 0.025, { x: 1, z: 0 }, P.iron, ctx.detail === "high" ? 16 : 10)));
    const pedal = { x: u, y: 0.36, z: (front + back) / 2 + 0.05 };
    const seat = { x: u, y: 0.88, z: back + 0.38 };
    const head = { x: u, y: 0.86, z: front - 0.05 };
    for (const [a, b] of [
      [{ x: u, y: 0.36, z: back }, pedal],
      [pedal, seat],
      [seat, { x: u, y: 0.36, z: back }],
      [pedal, head],
      [seat, { x: u, y: 0.78, z: front - 0.02 }],
      [head, { x: u, y: 0.36, z: front }],
    ] as const) g.push(f.put(rod(a, b, 0.022, colour, 4)));
    g.push(f.box(u - 0.07, u + 0.07, 0.9, 0.95, seat.z - 0.12, seat.z + 0.08, P.woodDark));
    g.push(f.put(rod({ x: u - 0.25, y: 0.98, z: head.z }, { x: u + 0.25, y: 0.98, z: head.z }, 0.018, P.iron, 4)));
  }
  ctx.sink.add(batchFor(o, ctx), o.id, g);
}

function noticeboard(o: Obstacle, ctx: PropCtx): void {
  const { f, length, depth } = frameOf(o, o.facing ?? "south");
  const g: THREE.BufferGeometry[] = [];
  const mid = -depth / 2;
  for (const u of [0.08, length - 0.16]) g.push(f.box(u, u + 0.08, 0, 2.0, mid - 0.04, mid + 0.04, P.woodDark));
  g.push(f.box(0.05, length - 0.05, 0.9, 1.95, mid - 0.03, mid + 0.03, P.shutterDark));
  g.push(f.box(0, length, 1.95, 2.05, -depth + 0.01, -0.01, P.woodDark));
  const posters: ColourInput[] = [P.cream, P.gold, P.plasterPink, P.cream, P.lapisLight, P.cream];
  posters.forEach((c, k) => {
    const u = 0.2 + (k % 3) * ((length - 0.4) / 3);
    const v = k < 3 ? 1.45 : 1.0;
    g.push(f.box(u + 0.05, u + (length - 0.4) / 3 - 0.08, v, v + 0.4, mid + 0.03, mid + 0.04, c));
  });
  ctx.sink.add(batchFor(o, ctx), o.id, g);
  sinkSign(ctx.sink, batchFor(o, ctx), f, "notices", 0.25, length - 0.25, 1.86, 1.95, mid + 0.045);
}

/** Builds every prop of the layout (everything except buildings and portico columns). */
export function buildProps(sink: Sink, layout: WorldLayout, detail: Detail): void {
  const ctx: PropCtx = { sink, detail, layout, interactables: new Set(layout.interactables.map((i) => i.id)) };
  for (const o of layout.obstacles) {
    switch (o.kind) {
      case "bench":
        bench(o, ctx);
        break;
      case "chair":
        chair(o, ctx);
        break;
      case "desk":
        studyDesk(o, ctx);
        break;
      case "table":
        cafeTable(o, ctx);
        break;
      case "counter":
        counter(o, ctx);
        break;
      case "stall":
        stall(o, ctx);
        break;
      case "fountain":
        fountain(o, ctx);
        break;
      case "planter":
        planter(o, ctx);
        break;
      case "tree":
        tree(o, ctx);
        break;
      case "garden":
        garden(o, ctx);
        break;
      case "lamp":
        lamp(o, ctx);
        break;
      case "bike-rack":
        bikeRack(o, ctx);
        break;
      case "noticeboard":
        noticeboard(o, ctx);
        break;
      case "building":
      case "arcade":
        break; // buildings.ts
    }
  }
}

export { chamferedSquare, flatRect };
