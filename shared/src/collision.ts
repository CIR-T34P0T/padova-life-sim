import type { Obstacle, WorldLayout } from "./world.ts";

export interface Vec2 {
  x: number;
  z: number;
}

/** True when a circle at (x, z) with radius r overlaps the obstacle's box. */
export function circleIntersectsBox(x: number, z: number, r: number, b: Obstacle): boolean {
  const nearestX = Math.max(b.minX, Math.min(x, b.maxX));
  const nearestZ = Math.max(b.minZ, Math.min(z, b.maxZ));
  const dx = x - nearestX;
  const dz = z - nearestZ;
  return dx * dx + dz * dz < r * r;
}

/** True when a character of radius r can stand at (x, z). */
export function isPositionWalkable(world: WorldLayout, x: number, z: number, r: number): boolean {
  if (!Number.isFinite(x) || !Number.isFinite(z)) return false;
  const limit = world.halfSize - r;
  if (x < -limit || x > limit || z < -limit || z > limit) return false;
  for (const obstacle of world.obstacles) {
    if (circleIntersectsBox(x, z, r, obstacle)) return false;
  }
  return true;
}

/**
 * Moves a character by (dx, dz) and slides along walls instead of stopping
 * dead. Movement is split into sub-steps no longer than half the radius so a
 * fast step can never tunnel through a thin obstacle.
 *
 * Precondition: (x, z) is walkable. The result is always walkable.
 */
export function moveWithCollision(
  world: WorldLayout,
  from: Vec2,
  dx: number,
  dz: number,
  r: number,
): Vec2 {
  const distance = Math.hypot(dx, dz);
  if (distance === 0 || !Number.isFinite(distance)) return { x: from.x, z: from.z };
  const steps = Math.max(1, Math.ceil(distance / (r * 0.5)));
  const stepX = dx / steps;
  const stepZ = dz / steps;
  let x = from.x;
  let z = from.z;
  for (let i = 0; i < steps; i++) {
    if (isPositionWalkable(world, x + stepX, z + stepZ, r)) {
      x += stepX;
      z += stepZ;
    } else if (stepX !== 0 && isPositionWalkable(world, x + stepX, z, r)) {
      x += stepX;
    } else if (stepZ !== 0 && isPositionWalkable(world, x, z + stepZ, r)) {
      z += stepZ;
    } else {
      break;
    }
  }
  return { x, z };
}

/** True when a character can travel in a straight line from a to b. */
export function isSegmentWalkable(world: WorldLayout, a: Vec2, b: Vec2, r: number): boolean {
  const distance = Math.hypot(b.x - a.x, b.z - a.z);
  const samples = Math.max(1, Math.ceil(distance / (r * 0.5)));
  for (let i = 1; i <= samples; i++) {
    const t = i / samples;
    if (!isPositionWalkable(world, a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t, r)) {
      return false;
    }
  }
  return true;
}
