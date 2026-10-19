// The ground of the square (D-033): grey trachyte paving drawn on a small
// canvas texture at runtime (no image files), with flat stone inlays on top:
// darker sidewalks along the buildings, cobbled streets, rings around the
// fountain and a tiled café terrace. Inlays are flat decoration (owner null):
// they never block anyone and are not tap targets.

import * as THREE from "three";
import type { WorldLayout } from "@padova/shared";
import { seeded } from "../avatar/geometry.ts";
import { P } from "./palette.ts";
import { QuadBatch, cuboid, flatRect, flatRing, rgb, type Detail, type Sink } from "./kit.ts";

/** Heights of the stacked inlays, far enough apart to never flicker. */
const LAYER = { band: 0.006, line: 0.012, top: 0.018 };

/** Metres of ground covered by one repeat of the paving texture. */
export const PAVING_TILE_METRES = 4;

export function buildGround(sink: Sink, layout: WorldLayout, detail: Detail): void {
  const h = layout.halfSize;
  const g: THREE.BufferGeometry[] = [];
  const band = 1.5;
  // Sidewalks in darker stone along the building fronts, with a pale kerb line.
  const sidewalks: [number, number, number, number][] = [
    [-h, -3, -18 - 0, -18 + band], // in front of the university hall
    [4, h, -18, -18 + band], // library
    [-18, -18 + band, -11, 11], // residences
    [-h, -5, 18 - band, 18], // student housing
    [3, h, 18 - band, 18], // shops
  ];
  for (const [x0, x1, z0, z1] of sidewalks) g.push(flatRect(x0, x1, z0, z1, LAYER.band, P.pavingDark));
  g.push(flatRect(-h, -3, -18 + band, -18 + band + 0.16, LAYER.line, P.kerb));
  g.push(flatRect(4, h, -18 + band, -18 + band + 0.16, LAYER.line, P.kerb));
  g.push(flatRect(-18 + band, -18 + band + 0.16, -11, 11, LAYER.line, P.kerb));
  g.push(flatRect(-h, -5, 18 - band - 0.16, 18 - band, LAYER.line, P.kerb));
  g.push(flatRect(3, h, 18 - band - 0.16, 18 - band, LAYER.line, P.kerb));
  // The porch floor of the university hall: polished stone.
  g.push(flatRect(-14.5, -11.5, -19.6, -18, LAYER.band, P.marble));
  // Cobbled streets leading out of the square.
  const streets: [number, number, number, number][] = [
    [-3, 4, -h, -18 + band],
    [-5, 3, 18 - band, h],
    [-h, -18 + band, -18, -11],
    [-h, -18 + band, 11, 18],
    [17.5, h, -18, -12.3],
    [17.5, h, 12.3, 18],
  ];
  const stones = new QuadBatch();
  for (const [x0, x1, z0, z1] of streets) g.push(...cobbles(x0, x1, z0, z1, detail, stones));
  // Rings and spokes of pale Istrian stone around the fountain.
  const fx = 0;
  const fz = -3;
  g.push(flatRing(fx, fz, 3.0, 3.25, LAYER.line, P.stone, detail === "high" ? 64 : 32));
  g.push(flatRing(fx, fz, 5.6, 5.95, LAYER.line, P.stone, detail === "high" ? 72 : 36));
  g.push(flatRing(fx, fz, 3.25, 5.6, LAYER.band, P.pavingLight, detail === "high" ? 64 : 32));
  const spokes = 16;
  for (let k = 0; k < spokes; k++) {
    const a = (k / spokes) * Math.PI * 2;
    const spoke = new THREE.PlaneGeometry(0.16, 2.35);
    spoke.rotateX(-Math.PI / 2);
    spoke.translate(0, LAYER.top, -4.43);
    spoke.rotateY(a);
    spoke.translate(fx, 0, fz);
    g.push(paintAll(spoke, k % 2 ? P.stoneShade : P.stone));
  }
  // A long pale band framing the market and the arrival area.
  for (const [x0, x1, z0, z1] of [[-11, 4.5, 5.2, 5.4], [-11, 4.5, 8.6, 8.8]] as const) g.push(flatRect(x0, x1, z0, z1, LAYER.line, P.stone));
  // Café terrace: warm terracotta tiles in a checker.
  checker(11.8, 16.5, 8.0, 14.8, 0.6, P.terracotta, P.plasterRose, LAYER.band, stones);
  if (!stones.empty) g.push(stones.geometry());
  g.push(flatRect(11.7, 16.6, 7.9, 8.0, LAYER.line, P.stone), flatRect(11.7, 16.6, 14.8, 14.9, LAYER.line, P.stone));
  // A few drain covers and a manhole.
  for (const [x, z] of [[-6, 12], [7, 4], [-12, -11], [2, -14]] as const) g.push(flatRing(x, z, 0, 0.32, LAYER.line, P.gutter, 14));
  sink.add("ground", null, g);
  // Ground outside the square (around it, never under it): streets and blocks beyond.
  const far = 110;
  sink.add("backdrop", null, [
    cuboid(-far, far, -0.3, 0, -far, -h, P.cobble),
    cuboid(-far, far, -0.3, 0, h, far, P.cobble),
    cuboid(-far, -h, -0.3, 0, -h, h, P.cobble),
    cuboid(h, far, -0.3, 0, -h, h, P.cobble),
  ]);
}

function paintAll(geometry: THREE.BufferGeometry, colour: string): THREE.BufferGeometry {
  const c = rgb(colour);
  const count = geometry.getAttribute("position").count;
  const colours = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) colours.set([c.r, c.g, c.b], i * 3);
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colours, 3));
  return geometry;
}

/** Rows of cobbles in slightly varied greys (the stones go into `stones`). */
function cobbles(x0: number, x1: number, z0: number, z1: number, detail: Detail, stones: QuadBatch): THREE.BufferGeometry[] {
  const pieces: THREE.BufferGeometry[] = [flatRect(x0, x1, z0, z1, LAYER.band, P.cobbleDark)];
  if (detail === "low") return pieces;
  const rng = seeded(Math.round((x0 + 50) * 13 + (z0 + 50) * 7));
  const size = 0.5;
  for (let z = z0 + 0.03; z < z1 - 0.03; z += size) {
    const offset = (Math.round((z - z0) / size) % 2) * size * 0.5;
    for (let x = x0 + 0.03 - offset; x < x1 - 0.03; x += size) {
      const a = Math.max(x0 + 0.03, x);
      const b = Math.min(x1 - 0.03, x + size - 0.06);
      const c = Math.min(z1 - 0.03, z + size - 0.06);
      if (b - a < 0.08 || c - z < 0.08) continue;
      stones.groundRect(a, b, z, c, LAYER.line, rgb(P.cobble).multiplyScalar(0.92 + rng() * 0.16));
    }
  }
  return pieces;
}

function checker(x0: number, x1: number, z0: number, z1: number, size: number, a: string, b: string, y: number, tiles: QuadBatch): void {
  let row = 0;
  for (let z = z0; z < z1 - 1e-6; z += size, row++) {
    let col = 0;
    for (let x = x0; x < x1 - 1e-6; x += size, col++) tiles.groundRect(x, Math.min(x1, x + size), z, Math.min(z1, z + size), y, (row + col) % 2 ? a : b);
  }
}

/**
 * Paving slabs drawn on a canvas: rows of rectangular trachyte stones with
 * thin joints and a little speckle. Seamless both ways. Browser only (null
 * in Node tests, where the ground is drawn in a flat colour).
 */
export function pavingTexture(pixels: number): THREE.CanvasTexture | null {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = pixels;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const rng = seeded(1789);
  const perMetre = pixels / PAVING_TILE_METRES;
  ctx.fillStyle = "#8f877b";
  ctx.fillRect(0, 0, pixels, pixels);
  const rows = 10;
  const rowH = pixels / rows;
  const base = rgb(P.paving);
  const joint = Math.max(1, Math.round(pixels / 400));
  for (let r = 0; r < rows; r++) {
    let x = -rng() * perMetre;
    while (x < pixels) {
      const w = (0.45 + rng() * 0.6) * perMetre;
      const tone = base.clone().multiplyScalar(0.9 + rng() * 0.16);
      tone.offsetHSL(0, (rng() - 0.5) * 0.03, 0);
      ctx.fillStyle = `#${tone.getHexString(THREE.SRGBColorSpace)}`;
      for (const shift of [0, pixels]) ctx.fillRect(x + joint - shift, r * rowH + joint, w - joint * 2, rowH - joint * 2);
      x += w;
    }
  }
  // Speckle, so slabs read as stone up close.
  for (let k = 0; k < pixels * 6; k++) {
    ctx.fillStyle = rng() < 0.5 ? "rgba(255,255,255,0.10)" : "rgba(60,50,40,0.10)";
    ctx.fillRect(rng() * pixels, rng() * pixels, 1.5, 1.5);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}
