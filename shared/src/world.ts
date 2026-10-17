// Greybox layout of the first test area: a fictional piazza loosely inspired
// by Padua's market squares. Every block here is a PLACEHOLDER volume used for
// collision and navigation; it is not a model of a real building.
//
// Coordinates: metres, X to the east, Z to the south, Y up. Origin = piazza centre.

export type ObstacleKind = "building" | "arcade" | "fountain" | "stall" | "bench" | "planter";

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
  spawnPoints: readonly { x: number; z: number }[];
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

export const PLAZA_LAYOUT: WorldLayout = {
  halfSize: 24,
  obstacles: [
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
