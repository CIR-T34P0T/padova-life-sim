// Rules for the district layout (D-033): stable ids, no overlapping solids,
// furniture that fits its interaction points, the walk-in porch and portico,
// visible street ends, and no walkable pocket cut off from the rest.

import { describe, expect, it } from "vitest";
import { GAME_CONFIG, PLAZA_LAYOUT, isPositionWalkable, isSegmentWalkable, NavGrid, findInteractable } from "../src/index.ts";

const world = PLAZA_LAYOUT;
const r = GAME_CONFIG.playerRadius;
const grid = new NavGrid(world, GAME_CONFIG.navCellSize, r, GAME_CONFIG.maxPathExpansions);
const reachable = (x: number, z: number) => grid.findPath(world.spawnPoints[0]!, { x, z }).ok;

describe("district layout", () => {
  it("gives every obstacle a unique id, a real size, a label and a place inside the square", () => {
    const ids = new Set<string>();
    for (const o of world.obstacles) {
      expect(ids.has(o.id), o.id).toBe(false);
      ids.add(o.id);
      expect(o.maxX - o.minX, o.id).toBeGreaterThan(0.1);
      expect(o.maxZ - o.minZ, o.id).toBeGreaterThan(0.1);
      expect(o.height, o.id).toBeGreaterThan(0.3);
      expect(o.label, o.id).toBeTruthy();
      for (const v of [o.minX, o.maxX, o.minZ, o.maxZ]) expect(Math.abs(v), o.id).toBeLessThanOrEqual(world.halfSize);
    }
  });

  it("never overlaps two solid boxes (they may only touch)", () => {
    const overlaps: string[] = [];
    const list = world.obstacles;
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i]!;
        const b = list[j]!;
        const eps = 1e-6;
        if (a.minX < b.maxX - eps && b.minX < a.maxX - eps && a.minZ < b.maxZ - eps && b.minZ < a.maxZ - eps) overlaps.push(`${a.id} × ${b.id}`);
      }
    }
    expect(overlaps).toEqual([]);
  });

  it("links every chair to an existing interactable and puts each sitter on a chair", () => {
    const chairs = world.obstacles.filter((o) => o.kind === "chair");
    expect(chairs.length).toBe(8); // two study desks, three café tables with two chairs each
    for (const chair of chairs) {
      expect(chair.partOf && findInteractable(world, chair.partOf), chair.id).toBeTruthy();
      const seat = findInteractable(world, chair.partOf!)!.seats.find((s) => chair.id.endsWith(s.id.slice(s.id.lastIndexOf("-"))))!;
      expect(seat, chair.id).toBeTruthy();
      expect(seat.x > chair.minX && seat.x < chair.maxX && seat.z > chair.minZ && seat.z < chair.maxZ, `${seat.id} sits on ${chair.id}`).toBe(true);
    }
  });

  it("leaves no walkable pocket cut off from where players arrive", () => {
    const start = grid.cellOf(world.spawnPoints[0]!);
    const seen = new Set<number>([start.row * grid.cols + start.col]);
    const queue = [...seen];
    while (queue.length > 0) {
      const cell = queue.pop()!;
      const col = cell % grid.cols;
      const row = Math.floor(cell / grid.cols);
      for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const next = (row + dr) * grid.cols + col + dc;
        if (grid.isCellWalkable(col + dc, row + dr) && !seen.has(next)) {
          seen.add(next);
          queue.push(next);
        }
      }
    }
    const pockets: string[] = [];
    for (let row = 0; row < grid.rows; row++) {
      for (let col = 0; col < grid.cols; col++) {
        if (grid.isCellWalkable(col, row) && !seen.has(row * grid.cols + col)) pockets.push(JSON.stringify(grid.cellCentre(col, row)));
      }
    }
    expect(pockets).toEqual([]);
  });

  it("has a walk-in entrance porch at the university hall", () => {
    const porch = world.obstacles.find((o) => o.id === "north-west-block-porch")!;
    const inside = { x: (porch.minX + porch.maxX) / 2, z: porch.maxZ + 0.6 };
    expect(inside.z).toBeLessThan(-18.5); // deeper than the façade line
    expect(isPositionWalkable(world, inside.x, inside.z, r)).toBe(true);
    expect(reachable(inside.x, inside.z)).toBe(true);
  });

  it("has a portico that can be walked end to end behind its columns", () => {
    expect(isSegmentWalkable(world, { x: 18.5, z: -11.8 }, { x: 18.5, z: 11.8 }, r)).toBe(true);
    expect(reachable(18.5, 0)).toBe(true);
    // Between two columns from the piazza into the portico.
    expect(isSegmentWalkable(world, { x: 15, z: -2 }, { x: 18.5, z: -2 }, r)).toBe(true);
  });

  it("closes every street with planters before the edge of the walkable area", () => {
    // Points in each street mouth: walkable just inside, blocked at the planters.
    const streets: [string, { x: number; z: number }, { x: number; z: number }][] = [
      ["north", { x: 0.5, z: -22.5 }, { x: 0.5, z: -23.5 }],
      ["south", { x: -1, z: 22.5 }, { x: -1, z: 23.5 }],
      ["west, north", { x: -22.5, z: -14.5 }, { x: -23.5, z: -14.5 }],
      ["west, south", { x: -22.5, z: 14.5 }, { x: -23.5, z: 14.5 }],
      ["east, north", { x: 22.5, z: -15 }, { x: 23.5, z: -15 }],
      ["east, south", { x: 22.5, z: 15 }, { x: 23.5, z: 15 }],
    ];
    for (const [name, open, closed] of streets) {
      expect(isPositionWalkable(world, open.x, open.z, r), `${name} street mouth`).toBe(true);
      expect(reachable(open.x, open.z), `${name} street reachable`).toBe(true);
      expect(isPositionWalkable(world, closed.x, closed.z, 0.05), `${name} street planters`).toBe(false);
    }
  });

  it("keeps the arrival area and the centre of the piazza open", () => {
    for (const spawn of world.spawnPoints) {
      for (const other of world.spawnPoints) expect(isSegmentWalkable(world, spawn, other, r)).toBe(true);
    }
    // A short walk (around the market stalls) from the arrival area to the fountain's south side.
    const path = grid.findPath({ x: 0, z: 13 }, { x: 0, z: 0 });
    expect(path.ok).toBe(true);
    if (!path.ok) return;
    let length = 0;
    let from = { x: 0, z: 13 };
    for (const point of path.waypoints) {
      length += Math.hypot(point.x - from.x, point.z - from.z);
      from = point;
    }
    expect(length).toBeLessThan(16);
  });
});
