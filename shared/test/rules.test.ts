import { describe, expect, it } from "vitest";
import {
  GAME_CONFIG,
  NavGrid,
  PLAZA_LAYOUT,
  isPositionWalkable,
  isSegmentWalkable,
  moveWithCollision,
  parseMoveDirection,
  parseMoveTo,
  sanitizeDisplayName,
  stepCharacter,
  type MovingCharacter,
} from "../src/index.ts";

const world = PLAZA_LAYOUT;
const r = GAME_CONFIG.playerRadius;
const grid = new NavGrid(world, GAME_CONFIG.navCellSize, r, GAME_CONFIG.maxPathExpansions);
const fountain = world.obstacles.find((o) => o.id === "fountain")!;

describe("world layout", () => {
  it("has every spawn point on walkable ground", () => {
    for (const spawn of world.spawnPoints) {
      expect(isPositionWalkable(world, spawn.x, spawn.z, r)).toBe(true);
    }
  });

  it("treats obstacle interiors and the outside of the map as blocked", () => {
    expect(isPositionWalkable(world, 0, -3, r)).toBe(false); // fountain centre
    expect(isPositionWalkable(world, 0, 30, r)).toBe(false); // outside
    expect(isPositionWalkable(world, Number.NaN, 0, r)).toBe(false);
  });
});

describe("collision", () => {
  it("never moves a character into an obstacle", () => {
    // Walk straight at the fountain from the south.
    let p = { x: 0, z: 3 };
    for (let i = 0; i < 50; i++) p = moveWithCollision(world, p, 0, -0.3, r);
    expect(isPositionWalkable(world, p.x, p.z, r)).toBe(true);
    expect(p.z).toBeGreaterThanOrEqual(fountain.maxZ + r - 1e-6);
  });

  it("slides along a wall when moving diagonally into it", () => {
    const start = { x: 0, z: fountain.maxZ + r + 0.01 };
    const end = moveWithCollision(world, start, 0.4, -0.4, r);
    expect(end.x).toBeGreaterThan(start.x); // kept moving sideways
    expect(isPositionWalkable(world, end.x, end.z, r)).toBe(true);
  });

  it("cannot tunnel through a thin obstacle with one huge step", () => {
    const pillar = world.obstacles.find((o) => o.id === "arcade-3")!;
    const start = { x: pillar.minX - 1, z: (pillar.minZ + pillar.maxZ) / 2 };
    const end = moveWithCollision(world, start, 2, 0, r);
    expect(end.x).toBeLessThan(pillar.minX);
  });
});

describe("pathfinding", () => {
  it("finds a walkable route around the fountain", () => {
    const start = { x: 0, z: 2 };
    const target = { x: 0, z: -8 };
    expect(isSegmentWalkable(world, start, target, r)).toBe(false);
    const result = grid.findPath(start, target);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const last = result.waypoints.at(-1)!;
    expect(last).toEqual(target);
    let previous = start;
    for (const waypoint of result.waypoints) {
      expect(isSegmentWalkable(world, previous, waypoint, r)).toBe(true);
      previous = waypoint;
    }
  });

  it("rejects targets inside obstacles or outside the map", () => {
    expect(grid.findPath({ x: 0, z: 13 }, { x: 0, z: -3 })).toEqual({ ok: false, reason: "target_blocked" });
    expect(grid.findPath({ x: 0, z: 13 }, { x: 99, z: 0 })).toEqual({ ok: false, reason: "target_out_of_bounds" });
  });

  it("uses a single straight waypoint when the way is clear", () => {
    const result = grid.findPath({ x: 0, z: 13 }, { x: 3, z: 14 });
    expect(result).toEqual({ ok: true, waypoints: [{ x: 3, z: 14 }] });
  });
});

describe("character movement", () => {
  const makeCharacter = (): MovingCharacter => ({ x: 0, z: 2, rotation: 0, intent: { kind: "idle" } });

  it("follows a path to its target at walking speed and then idles", () => {
    const character = makeCharacter();
    const path = grid.findPath(character, { x: 0, z: -8 });
    if (!path.ok) throw new Error(path.reason);
    character.intent = { kind: "path", waypoints: path.waypoints };
    const dt = GAME_CONFIG.tickMs / 1000;
    let ticks = 0;
    const isWalking = (c: MovingCharacter) => c.intent.kind !== "idle";
    while (isWalking(character) && ticks < 400) {
      const before = { x: character.x, z: character.z };
      stepCharacter(world, character, dt, GAME_CONFIG.walkSpeed, r);
      const stepLength = Math.hypot(character.x - before.x, character.z - before.z);
      expect(stepLength).toBeLessThanOrEqual(GAME_CONFIG.walkSpeed * dt + 1e-6);
      expect(isPositionWalkable(world, character.x, character.z, r)).toBe(true);
      ticks++;
    }
    expect(character.intent.kind).toBe("idle");
    expect(Math.hypot(character.x - 0, character.z + 8)).toBeLessThan(0.05);
  });

  it("moves in a direction and stops at walls", () => {
    const character = makeCharacter();
    character.intent = { kind: "direction", dx: 0, dz: -1 };
    for (let i = 0; i < 100; i++) stepCharacter(world, character, 0.05, GAME_CONFIG.walkSpeed, r);
    expect(isPositionWalkable(world, character.x, character.z, r)).toBe(true);
    expect(character.z).toBeGreaterThan(fountain.maxZ);
  });
});

describe("message validation", () => {
  it("rejects malformed moveTo payloads", () => {
    expect(parseMoveTo({ x: 1, z: 2 })).toEqual({ ok: true, value: { x: 1, z: 2 } });
    expect(parseMoveTo({ x: "1", z: 2 }).ok).toBe(false);
    expect(parseMoveTo({ x: Infinity, z: 2 }).ok).toBe(false);
    expect(parseMoveTo(null).ok).toBe(false);
  });

  it("clamps oversized directions so clients cannot speed up", () => {
    const parsed = parseMoveDirection({ dx: 30, dz: 40 });
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(Math.hypot(parsed.value.dx, parsed.value.dz)).toBeCloseTo(1);
  });

  it("cleans display names", () => {
    expect(sanitizeDisplayName("  Giulia   R. ")).toBe("Giulia R.");
    expect(sanitizeDisplayName("<script>")).toBe("script");
    expect(sanitizeDisplayName("a")).toBeNull();
    expect(sanitizeDisplayName(42)).toBeNull();
    expect(sanitizeDisplayName("x".repeat(50))).toHaveLength(GAME_CONFIG.nameMaxLength);
  });
});
