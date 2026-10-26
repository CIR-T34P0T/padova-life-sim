// The district art agrees with the collision layout (D-033). Built in Node
// from the same code the game runs, then checked vertex by vertex:
// - nothing solid below head height is drawn outside the box it stands in
//   (no walking through visible things);
// - every collision box is visibly filled (no invisible walls);
// - decoration below head height is flat, inside a box, or outside the square;
// - every clickable object has its own highlightable mesh;
// - the geometry stays within its triangle budget at both detail levels;
// - every piece carries a night-glow strength, and lit windows, lanterns and
//   shop windows glow (M7b).

import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { PLAZA_LAYOUT, type Obstacle } from "@padova/shared";
import { BUILDING_BATCH } from "../src/render/world/buildings.ts";
import { buildDistrict, fadeVolumes } from "../src/render/world/district.ts";
import { HEAD_HEIGHT } from "../src/render/world/props.ts";
import { LIT_WINDOW_SHARE, litAtNight, type Detail, type Piece } from "../src/render/world/kit.ts";

const world = PLAZA_LAYOUT;
/** How far a solid detail may stand proud of its box (window sills, door frames). */
const TOLERANCE = 0.06;
/** Flat inlays sit at most this high. */
const FLAT = 0.03;

const byId = new Map(world.obstacles.map((o) => [o.id, o]));
/** A building split into several collision boxes (around a porch) is one building. */
const sameBuilding = (o: Obstacle) => world.obstacles.filter((other) => other.id === o.id || (BUILDING_BATCH[o.id] && BUILDING_BATCH[other.id] === BUILDING_BATCH[o.id]));
const inside = (o: Obstacle, x: number, z: number, margin: number) => x >= o.minX - margin && x <= o.maxX + margin && z >= o.minZ - margin && z <= o.maxZ + margin;
const outsideSquare = (x: number, z: number) => Math.abs(x) >= world.halfSize - 1e-3 || Math.abs(z) >= world.halfSize - 1e-3;

function vertices(piece: Piece): THREE.Vector3[] {
  const position = piece.geometry.getAttribute("position");
  const list: THREE.Vector3[] = [];
  for (let i = 0; i < position.count; i++) list.push(new THREE.Vector3().fromBufferAttribute(position, i));
  return list;
}

const builds = new Map<Detail, Piece[]>();
const build = (detail: Detail) => {
  let pieces = builds.get(detail);
  if (!pieces) {
    pieces = buildDistrict(world, detail).pieces;
    builds.set(detail, pieces);
  }
  return pieces;
};

describe.each(["high", "low"] as const)("district art (%s detail)", (detail) => {
  it("draws nothing solid below head height outside the box it stands in", () => {
    const problems = new Map<string, number>();
    for (const piece of build(detail)) {
      if (!piece.owner) continue;
      const box = byId.get(piece.owner);
      expect(box, `piece owned by unknown obstacle ${piece.owner}`).toBeTruthy();
      const boxes = sameBuilding(box!);
      for (const v of vertices(piece)) {
        if (v.y >= HEAD_HEIGHT) continue;
        if (!boxes.some((b) => inside(b, v.x, v.z, TOLERANCE))) problems.set(piece.owner, (problems.get(piece.owner) ?? 0) + 1);
      }
    }
    expect(Object.fromEntries(problems)).toEqual({});
  });

  it("keeps decoration below head height flat, inside a box, or outside the square", () => {
    const problems: string[] = [];
    for (const piece of build(detail)) {
      if (piece.owner) continue;
      for (const v of vertices(piece)) {
        if (v.y >= HEAD_HEIGHT || v.y <= FLAT) continue;
        if (outsideSquare(v.x, v.z)) continue;
        if (world.obstacles.some((o) => inside(o, v.x, v.z, TOLERANCE))) continue;
        problems.push(`${piece.batch} at (${v.x.toFixed(2)}, ${v.y.toFixed(2)}, ${v.z.toFixed(2)})`);
        break;
      }
    }
    expect(problems).toEqual([]);
  });

  it("fills every collision box with something visible (no invisible walls)", () => {
    const extents = new Map<string, THREE.Box3>();
    for (const piece of build(detail)) {
      if (!piece.owner) continue;
      const box = extents.get(piece.owner) ?? new THREE.Box3();
      for (const v of vertices(piece)) if (v.y < Math.max(HEAD_HEIGHT, 0.5)) box.expandByPoint(v);
      extents.set(piece.owner, box);
    }
    const thin: string[] = [];
    for (const o of world.obstacles) {
      const drawn = extents.get(o.id);
      if (!drawn || drawn.isEmpty()) {
        thin.push(`${o.id}: nothing drawn`);
        continue;
      }
      const coverX = (Math.min(drawn.max.x, o.maxX) - Math.max(drawn.min.x, o.minX)) / (o.maxX - o.minX);
      const coverZ = (Math.min(drawn.max.z, o.maxZ) - Math.max(drawn.min.z, o.minZ)) / (o.maxZ - o.minZ);
      // Round things (lamp bases, trunks) fill less of their square box.
      const needed = o.kind === "lamp" || o.kind === "table" ? 0.6 : 0.85;
      if (coverX < needed || coverZ < needed) thin.push(`${o.id}: covers ${(coverX * 100).toFixed(0)}% × ${(coverZ * 100).toFixed(0)}%`);
    }
    expect(thin).toEqual([]);
  });

  it("gives every clickable object (and its chairs) its own mesh, and fade volumes to every building", () => {
    const batches = new Set(build(detail).map((p) => p.batch));
    for (const item of world.interactables) expect(batches.has(`interactable:${item.id}`), item.id).toBe(true);
    for (const chair of world.obstacles.filter((o) => o.partOf)) {
      expect(build(detail).some((p) => p.owner === chair.id && p.batch === `interactable:${chair.partOf}`), chair.id).toBe(true);
    }
    const volumes = fadeVolumes(world, { pieces: build(detail) } as never);
    for (const group of ["building:hall", "building:library", "building:residences", "building:portico", "building:housing", "building:shops"]) {
      expect(volumes.get(group)?.length ?? 0, group).toBeGreaterThan(0);
    }
  });

  it("stays within its triangle budget", () => {
    let triangles = 0;
    for (const piece of build(detail)) triangles += (piece.geometry.index?.count ?? piece.geometry.getAttribute("position").count) / 3;
    const budget = detail === "high" ? 220_000 : 110_000;
    expect(triangles).toBeLessThan(budget);
    console.log(`[world] ${detail}: ${Math.round(triangles)} triangles in ${build(detail).length} pieces`);
  });
});

describe("night glow (M7b, D-037)", () => {
  /** Strongest glow of a piece (0 when it never glows). */
  const glowOf = (piece: Piece) => {
    const glow = piece.geometry.getAttribute("glow");
    let max = 0;
    for (let i = 0; i < glow.count; i++) max = Math.max(max, glow.getX(i));
    return max;
  };

  it.each(["high", "low"] as const)("gives every piece a glow strength per vertex, so batches merge (%s detail)", (detail) => {
    for (const piece of build(detail)) {
      const glow = piece.geometry.getAttribute("glow");
      expect(glow, piece.batch).toBeDefined();
      expect(glow.count, piece.batch).toBe(piece.geometry.getAttribute("position").count);
      expect(glowOf(piece)).toBeLessThanOrEqual(1.5);
    }
  });

  it.each(["high", "low"] as const)("lights windows, lanterns and shop windows at night (%s detail)", (detail) => {
    const pieces = build(detail);
    const strengths = pieces.map(glowOf);
    const lanterns = strengths.filter((g) => Math.abs(g - 1.3) < 1e-6).length;
    const windows = strengths.filter((g) => Math.abs(g - 0.85) < 1e-6).length;
    const shops = strengths.filter((g) => Math.abs(g - 0.45) < 1e-6).length;
    // Every street lamp has a lantern head, plus the hall's porch and the portico.
    expect(lanterns).toBeGreaterThanOrEqual(world.obstacles.filter((o) => o.kind === "lamp").length);
    expect(windows).toBeGreaterThan(40);
    expect(shops).toBeGreaterThan(4);
    // The far streets' windows glow too (they are batched into the backdrop).
    expect(pieces.some((p) => p.batch === "backdrop" && glowOf(p) > 0)).toBe(true);
    // Nothing on the ground or in a tree glows.
    for (const piece of pieces) if (piece.batch === "ground" || piece.batch.startsWith("canopy:")) expect(glowOf(piece), piece.batch).toBe(0);
  });

  it("chooses lit windows by position alone: the same windows every night, about the planned share", () => {
    expect(litAtNight(3.2, 7.1, -20.15)).toBe(litAtNight(3.2, 7.1, -20.15));
    let lit = 0;
    const samples = 4000;
    for (let k = 0; k < samples; k++) if (litAtNight((k % 50) * 1.3 - 30, 4 + (k % 7) * 3, Math.floor(k / 50) * 0.9 - 30)) lit++;
    expect(lit / samples).toBeGreaterThan(LIT_WINDOW_SHARE - 0.06);
    expect(lit / samples).toBeLessThan(LIT_WINDOW_SHARE + 0.06);
  });
});
