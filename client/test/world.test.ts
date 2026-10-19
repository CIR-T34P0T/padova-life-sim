// The district art agrees with the collision layout (D-033). Built in Node
// from the same code the game runs, then checked vertex by vertex:
// - nothing solid below head height is drawn outside the box it stands in
//   (no walking through visible things);
// - every collision box is visibly filled (no invisible walls);
// - decoration below head height is flat, inside a box, or outside the square;
// - every clickable object has its own highlightable mesh;
// - the geometry stays within its triangle budget at both detail levels.

import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { PLAZA_LAYOUT, type Obstacle } from "@padova/shared";
import { BUILDING_BATCH } from "../src/render/world/buildings.ts";
import { buildDistrict, fadeVolumes } from "../src/render/world/district.ts";
import { HEAD_HEIGHT } from "../src/render/world/props.ts";
import type { Detail, Piece } from "../src/render/world/kit.ts";

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
