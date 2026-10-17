// Character movement simulation. The server runs this as the authority; the
// client never decides where a character is.

import { moveWithCollision, type Vec2 } from "./collision.ts";
import type { WorldLayout } from "./world.ts";

/** What a character is currently trying to do with its legs. */
export type MoveIntent =
  | { kind: "idle" }
  | { kind: "path"; waypoints: Vec2[] }
  | { kind: "direction"; dx: number; dz: number };

export interface MovingCharacter {
  x: number;
  z: number;
  /** Facing angle in radians around Y; 0 faces +Z. */
  rotation: number;
  intent: MoveIntent;
}

export interface StepResult {
  moved: boolean;
  /** True when a path finished or was abandoned this step. */
  arrived: boolean;
}

/**
 * Advances one character by `dtSeconds`. Mutates `character`.
 * Path-following abandons the path if the character is stuck (blocked by an
 * obstacle the path did not anticipate) so it never walks in place forever.
 */
export function stepCharacter(
  world: WorldLayout,
  character: MovingCharacter,
  dtSeconds: number,
  speed: number,
  radius: number,
): StepResult {
  const intent = character.intent;
  let budget = speed * dtSeconds;

  if (intent.kind === "direction") {
    const before = { x: character.x, z: character.z };
    const next = moveWithCollision(world, before, intent.dx * budget, intent.dz * budget, radius);
    return applyMove(character, before, next, false);
  }

  if (intent.kind === "path") {
    const before = { x: character.x, z: character.z };
    let position: Vec2 = { ...before };
    while (budget > 1e-6 && intent.waypoints.length > 0) {
      const target = intent.waypoints[0];
      if (!target) break;
      const dx = target.x - position.x;
      const dz = target.z - position.z;
      const distance = Math.hypot(dx, dz);
      const travel = Math.min(distance, budget);
      const next = distance > 0
        ? moveWithCollision(world, position, (dx / distance) * travel, (dz / distance) * travel, radius)
        : position;
      const advanced = Math.hypot(next.x - position.x, next.z - position.z);
      position = next;
      budget -= travel;
      if (Math.hypot(target.x - position.x, target.z - position.z) < 0.05) {
        intent.waypoints.shift();
      } else if (advanced < travel * 0.5) {
        break; // blocked short of the waypoint
      }
    }
    const stuck = Math.hypot(position.x - before.x, position.z - before.z) < 1e-4;
    const finished = intent.waypoints.length === 0;
    if (finished || stuck) character.intent = { kind: "idle" };
    return applyMove(character, before, position, finished || stuck);
  }

  return { moved: false, arrived: false };
}

function applyMove(character: MovingCharacter, before: Vec2, after: Vec2, arrived: boolean): StepResult {
  const dx = after.x - before.x;
  const dz = after.z - before.z;
  const moved = Math.hypot(dx, dz) > 1e-4;
  character.x = after.x;
  character.z = after.z;
  if (moved) character.rotation = Math.atan2(dx, dz);
  return { moved, arrived };
}
