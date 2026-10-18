// Greybox layout of the first test area: a fictional piazza loosely inspired
// by Padua's market squares. Every block here is a PLACEHOLDER volume used for
// collision and navigation; it is not a model of a real building.
//
// Coordinates: metres, X to the east, Z to the south, Y up. Origin = piazza centre.

export type ObstacleKind = "building" | "arcade" | "fountain" | "stall" | "bench" | "planter" | "desk" | "counter";

export type InteractableKind = "bench" | "desk" | "cafe" | "fountain";

/**
 * One reservable interaction point on an object (D-026). Most are seats; a
 * point with `pose: "stand"` is a standing spot (café counter, fountain) that
 * is reserved only while walking there and acting, never left occupied.
 * The type keeps the name "Seat" to avoid churn across code and data.
 */
export interface Seat {
  /** Stable id, unique across the world, e.g. "bench-1/seat-a" or "cafe-counter/spot-a". */
  id: string;
  /** Where the character is placed while using it. */
  x: number;
  z: number;
  /** Facing while using it, radians around Y; 0 faces +Z. */
  rotation: number;
  /** Walkable point the character walks to first, and returns to when standing up. */
  approach: { x: number; z: number };
  /** "sit" (default) or "stand". */
  pose?: "sit" | "stand";
}

/** An object players can click to get contextual actions. */
export interface Interactable {
  /** Stable id used in network messages. Equal to the obstacle id it is drawn as. */
  id: string;
  kind: InteractableKind;
  /** Name shown in menus (placeholder wording). */
  label: string;
  seats: readonly Seat[];
}

export interface Obstacle {
  id: string;
  kind: ObstacleKind;
  /** Optional display label for greybox signage (placeholder). */
  label?: string;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  /** Visual height in metres (rendering only). */
  height: number;
}

export interface WorldLayout {
  /** The walkable area is the square [-halfSize, halfSize] on X and Z. */
  halfSize: number;
  obstacles: readonly Obstacle[];
  /** Clickable objects. Each one's `id` matches an obstacle's `id`. */
  interactables: readonly Interactable[];
  spawnPoints: readonly { x: number; z: number }[];
}

/** Gap between a character's edge and the furniture when it stands ready to sit. */
const APPROACH_CLEARANCE = 0.5;

/**
 * Seats along the south edge (+Z side) of a box-shaped object.
 * "away": the character sits facing +Z, back to the object (a bench).
 * "towards": the character sits facing the object, -Z (a desk).
 */
function seatsAlongSouthEdge(
  obstacle: Obstacle,
  count: number,
  facing: "away" | "towards",
  playerRadius = 0.35,
): Seat[] {
  const width = obstacle.maxX - obstacle.minX;
  const seats: Seat[] = [];
  for (let i = 0; i < count; i++) {
    const x = obstacle.minX + (width * (i + 0.5)) / count;
    seats.push({
      id: `${obstacle.id}/seat-${String.fromCharCode(97 + i)}`,
      x,
      z: obstacle.maxZ + (facing === "away" ? 0.05 : 0.3),
      rotation: facing === "away" ? 0 : Math.PI,
      approach: { x, z: obstacle.maxZ + playerRadius + APPROACH_CLEARANCE },
    });
  }
  return seats;
}

/** Standing spots along one long edge of an object, facing it. */
function standingSpotsAlongEdge(obstacle: Obstacle, count: number, edge: "north" | "south", playerRadius = 0.35): Seat[] {
  const width = obstacle.maxX - obstacle.minX;
  const gap = playerRadius + 0.3;
  const z = edge === "south" ? obstacle.maxZ + gap : obstacle.minZ - gap;
  const rotation = edge === "south" ? Math.PI : 0;
  return Array.from({ length: count }, (_, i) => {
    const x = obstacle.minX + (width * (i + 0.5)) / count;
    return { id: `${obstacle.id}/spot-${String.fromCharCode(97 + i)}`, x, z, rotation, approach: { x, z }, pose: "stand" as const };
  });
}

const box = (
  id: string,
  kind: ObstacleKind,
  cx: number,
  cz: number,
  width: number,
  depth: number,
  height: number,
  label?: string,
): Obstacle => ({
  id,
  kind,
  label,
  minX: cx - width / 2,
  maxX: cx + width / 2,
  minZ: cz - depth / 2,
  maxZ: cz + depth / 2,
  height,
});

const plazaObstacles: Obstacle[] = [
    // Perimeter buildings, with street openings on each side.
    box("north-west-block", "building", -13, -21, 20, 6, 14, "University hall (placeholder)"),
    box("north-east-block", "building", 13.5, -21, 19, 6, 12, "Library (placeholder)"),
    box("south-west-block", "building", -14, 21, 18, 6, 11, "Student housing (placeholder)"),
    box("south-east-block", "building", 13, 21, 20, 6, 12, "Café and shops (placeholder)"),
    box("west-block", "building", -21, 0, 6, 22, 13),
    box("east-block", "building", 21, -1, 6, 20, 12),
    // Arcade pillars along the east block (a nod to Padua's porticoes).
    box("arcade-1", "arcade", 17.2, -8, 0.6, 0.6, 4),
    box("arcade-2", "arcade", 17.2, -4, 0.6, 0.6, 4),
    box("arcade-3", "arcade", 17.2, 0, 0.6, 0.6, 4),
    box("arcade-4", "arcade", 17.2, 4, 0.6, 0.6, 4),
    box("arcade-5", "arcade", 17.2, 8, 0.6, 0.6, 4),
    // Centre of the piazza.
    box("fountain", "fountain", 0, -3, 4, 4, 1.2, "Fountain"),
    box("stall-1", "stall", -8, 7, 3, 2, 2.4, "Market stall"),
    box("stall-2", "stall", -3.5, 7, 3, 2, 2.4, "Market stall"),
    box("stall-3", "stall", 1, 7, 3, 2, 2.4, "Market stall"),
    box("bench-1", "bench", -6, -8, 2, 0.6, 0.5, "Bench"),
    box("bench-2", "bench", 6, -8, 2, 0.6, 0.5, "Bench"),
    box("planter-1", "planter", 9, 3, 1.5, 1.5, 0.9),
    box("planter-2", "planter", -11, -2, 1.5, 1.5, 0.9),
    // Study desks in front of the (placeholder) university hall.
    box("desk-1", "desk", -15, -14, 1.6, 0.8, 0.75, "Study desk"),
    box("desk-2", "desk", -10, -14, 1.6, 0.8, 0.75, "Study desk"),
    // Café counter in front of the (placeholder) café block, served from the piazza side.
    box("cafe-counter", "counter", 11, 15.6, 3, 0.8, 1.1, "Café counter"),
];

const obstacle = (id: string): Obstacle => {
  const found = plazaObstacles.find((o) => o.id === id);
  if (!found) throw new Error(`World layout has no obstacle "${id}"`);
  return found;
};

export const PLAZA_LAYOUT: WorldLayout = {
  halfSize: 24,
  obstacles: plazaObstacles,
  interactables: [
    { id: "bench-1", kind: "bench", label: "Bench", seats: seatsAlongSouthEdge(obstacle("bench-1"), 2, "away") },
    { id: "bench-2", kind: "bench", label: "Bench", seats: seatsAlongSouthEdge(obstacle("bench-2"), 2, "away") },
    { id: "desk-1", kind: "desk", label: "Study desk", seats: seatsAlongSouthEdge(obstacle("desk-1"), 1, "towards") },
    { id: "desk-2", kind: "desk", label: "Study desk", seats: seatsAlongSouthEdge(obstacle("desk-2"), 1, "towards") },
    { id: "cafe-counter", kind: "cafe", label: "Café counter", seats: standingSpotsAlongEdge(obstacle("cafe-counter"), 2, "north") },
    { id: "fountain", kind: "fountain", label: "Fountain", seats: standingSpotsAlongEdge(obstacle("fountain"), 2, "south") },
  ],
  spawnPoints: [
    { x: 0, z: 13 },
    { x: -2, z: 13 },
    { x: 2, z: 13 },
    { x: -4, z: 14 },
    { x: 4, z: 14 },
    { x: 0, z: 15 },
  ],
};
