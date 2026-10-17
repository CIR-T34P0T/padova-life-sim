// Grid-based A* pathfinding over the walkable area.
//
// This is deliberately simple: a uniform grid is enough for one compact
// piazza. When the world grows (interiors, multiple floors, districts) this
// module is the one to replace with a navmesh, keeping the same `findPath`
// contract. See docs/DECISIONS.md (D-005).

import { isPositionWalkable, isSegmentWalkable, type Vec2 } from "./collision.ts";
import type { WorldLayout } from "./world.ts";

export type PathFailure = "target_out_of_bounds" | "target_blocked" | "unreachable" | "search_limit";

export type PathResult =
  | { ok: true; waypoints: Vec2[] }
  | { ok: false; reason: PathFailure };

export class NavGrid {
  readonly cols: number;
  readonly rows: number;
  private readonly walkable: Uint8Array;

  constructor(
    readonly world: WorldLayout,
    readonly cellSize: number,
    readonly radius: number,
    readonly maxExpansions: number,
  ) {
    this.cols = Math.floor((world.halfSize * 2) / cellSize);
    this.rows = this.cols;
    this.walkable = new Uint8Array(this.cols * this.rows);
    for (let row = 0; row < this.rows; row++) {
      for (let col = 0; col < this.cols; col++) {
        const { x, z } = this.cellCentre(col, row);
        this.walkable[row * this.cols + col] = isPositionWalkable(world, x, z, radius) ? 1 : 0;
      }
    }
  }

  cellCentre(col: number, row: number): Vec2 {
    return {
      x: -this.world.halfSize + (col + 0.5) * this.cellSize,
      z: -this.world.halfSize + (row + 0.5) * this.cellSize,
    };
  }

  cellOf(p: Vec2): { col: number; row: number } {
    return {
      col: Math.floor((p.x + this.world.halfSize) / this.cellSize),
      row: Math.floor((p.z + this.world.halfSize) / this.cellSize),
    };
  }

  isCellWalkable(col: number, row: number): boolean {
    if (col < 0 || row < 0 || col >= this.cols || row >= this.rows) return false;
    return this.walkable[row * this.cols + col] === 1;
  }

  /**
   * Finds a path from `start` to `target`. Waypoints exclude the start and
   * end exactly at `target`. Assumes `start` is a valid standing position.
   */
  findPath(start: Vec2, target: Vec2): PathResult {
    const limit = this.world.halfSize;
    if (
      !Number.isFinite(target.x) ||
      !Number.isFinite(target.z) ||
      Math.abs(target.x) > limit ||
      Math.abs(target.z) > limit
    ) {
      return { ok: false, reason: "target_out_of_bounds" };
    }
    if (!isPositionWalkable(this.world, target.x, target.z, this.radius)) {
      return { ok: false, reason: "target_blocked" };
    }
    if (isSegmentWalkable(this.world, start, target, this.radius)) {
      return { ok: true, waypoints: [{ x: target.x, z: target.z }] };
    }

    const startCell = this.nearestWalkableCell(start);
    const goalCell = this.nearestWalkableCell(target);
    if (!startCell || !goalCell) return { ok: false, reason: "unreachable" };

    const cellPath = this.aStar(startCell, goalCell);
    if (cellPath === "limit") return { ok: false, reason: "search_limit" };
    if (!cellPath) return { ok: false, reason: "unreachable" };

    const points = cellPath.map((index) => this.cellCentre(index % this.cols, Math.floor(index / this.cols)));
    points.push({ x: target.x, z: target.z });
    return { ok: true, waypoints: this.smooth(start, points) };
  }

  private nearestWalkableCell(p: Vec2): number | null {
    const { col, row } = this.cellOf(p);
    for (let ring = 0; ring <= 2; ring++) {
      for (let dr = -ring; dr <= ring; dr++) {
        for (let dc = -ring; dc <= ring; dc++) {
          if (Math.max(Math.abs(dr), Math.abs(dc)) !== ring) continue;
          if (this.isCellWalkable(col + dc, row + dr)) return (row + dr) * this.cols + (col + dc);
        }
      }
    }
    return null;
  }

  private aStar(start: number, goal: number): number[] | null | "limit" {
    const total = this.cols * this.rows;
    const gScore = new Float64Array(total).fill(Infinity);
    const cameFrom = new Int32Array(total).fill(-1);
    const closed = new Uint8Array(total);
    const open = new MinHeap();
    const goalCol = goal % this.cols;
    const goalRow = Math.floor(goal / this.cols);
    const heuristic = (index: number) => {
      const dc = Math.abs((index % this.cols) - goalCol);
      const dr = Math.abs(Math.floor(index / this.cols) - goalRow);
      return Math.max(dc, dr) + (Math.SQRT2 - 1) * Math.min(dc, dr);
    };

    gScore[start] = 0;
    open.push(start, heuristic(start));
    let expansions = 0;

    while (open.size > 0) {
      const current = open.pop();
      if (current === goal) return this.reconstruct(cameFrom, current);
      if (closed[current]) continue;
      closed[current] = 1;
      if (++expansions > this.maxExpansions) return "limit";

      const col = current % this.cols;
      const row = Math.floor(current / this.cols);
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (dr === 0 && dc === 0) continue;
          const nc = col + dc;
          const nr = row + dr;
          if (!this.isCellWalkable(nc, nr)) continue;
          // No corner cutting: a diagonal step needs both orthogonal neighbours free.
          if (dr !== 0 && dc !== 0 && (!this.isCellWalkable(col + dc, row) || !this.isCellWalkable(col, row + dr))) {
            continue;
          }
          const next = nr * this.cols + nc;
          if (closed[next]) continue;
          const tentative = (gScore[current] ?? Infinity) + (dr !== 0 && dc !== 0 ? Math.SQRT2 : 1);
          if (tentative < (gScore[next] ?? Infinity)) {
            gScore[next] = tentative;
            cameFrom[next] = current;
            open.push(next, tentative + heuristic(next));
          }
        }
      }
    }
    return null;
  }

  private reconstruct(cameFrom: Int32Array, end: number): number[] {
    const path: number[] = [end];
    let current = end;
    while ((cameFrom[current] ?? -1) !== -1) {
      current = cameFrom[current] ?? -1;
      path.push(current);
    }
    path.reverse();
    path.shift(); // drop the start cell; the character is already there
    return path;
  }

  /** Removes waypoints that can be skipped with a straight, walkable line. */
  private smooth(start: Vec2, points: Vec2[]): Vec2[] {
    const result: Vec2[] = [];
    let anchor = start;
    let i = 0;
    while (i < points.length) {
      let furthest = i;
      for (let j = points.length - 1; j > i; j--) {
        const candidate = points[j];
        if (candidate && isSegmentWalkable(this.world, anchor, candidate, this.radius)) {
          furthest = j;
          break;
        }
      }
      const chosen = points[furthest];
      if (!chosen) break;
      result.push(chosen);
      anchor = chosen;
      i = furthest + 1;
    }
    return result;
  }
}

/** Small binary min-heap of (item, priority) pairs for A*. */
class MinHeap {
  private items: number[] = [];
  private priorities: number[] = [];

  get size(): number {
    return this.items.length;
  }

  push(item: number, priority: number): void {
    this.items.push(item);
    this.priorities.push(priority);
    let i = this.items.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if ((this.priorities[parent] ?? 0) <= priority) break;
      this.swap(i, parent);
      i = parent;
    }
  }

  pop(): number {
    const top = this.items[0] ?? -1;
    const lastItem = this.items.pop() ?? -1;
    const lastPriority = this.priorities.pop() ?? 0;
    if (this.items.length > 0) {
      this.items[0] = lastItem;
      this.priorities[0] = lastPriority;
      let i = 0;
      for (;;) {
        const left = i * 2 + 1;
        const right = left + 1;
        let smallest = i;
        if (left < this.items.length && (this.priorities[left] ?? 0) < (this.priorities[smallest] ?? 0)) smallest = left;
        if (right < this.items.length && (this.priorities[right] ?? 0) < (this.priorities[smallest] ?? 0)) smallest = right;
        if (smallest === i) break;
        this.swap(i, smallest);
        i = smallest;
      }
    }
    return top;
  }

  private swap(a: number, b: number): void {
    const item = this.items[a] ?? 0;
    this.items[a] = this.items[b] ?? 0;
    this.items[b] = item;
    const priority = this.priorities[a] ?? 0;
    this.priorities[a] = this.priorities[b] ?? 0;
    this.priorities[b] = priority;
  }
}
