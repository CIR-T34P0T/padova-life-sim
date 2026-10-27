// Indoor rooms (M7c, D-038, D-039). Each room is its own small layout in the
// same collision-first format as the square (D-033): walls are obstacles,
// furniture reuses the existing kinds, and a door links back outside.
// Rooms may be bigger inside than their building's shell (D-039).
// Coordinates: metres, X east, Z south, origin in the middle of the room.
// Not a model of any real university room.

import { bounds, box, chairsFor, seatsAlongEdge, standingSpotsAlongEdge, type Interactable, type Obstacle, type WorldLayout } from "./world.ts";

/** Inside of a room's walls: where its floor is drawn and tapping walks. */
export interface RoomFloor {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface Room {
  layout: WorldLayout;
  floor: RoomFloor;
}

const WALL = 0.3;
const WALL_HEIGHT = 3.4;
const DOOR_HALF_WIDTH = 1.2;

/**
 * Four walls around the floor, with a door in the middle of the south wall
 * (the side the camera looks from, so the room opens towards you).
 */
function shell(prefix: string, floor: RoomFloor, doorId: string, doorLabel: string): Obstacle[] {
  const { minX, maxX, minZ, maxZ } = floor;
  return [
    bounds(`${prefix}-wall-north`, "wall", minX - WALL, maxX + WALL, minZ - WALL, minZ, WALL_HEIGHT, "Wall", "south"),
    bounds(`${prefix}-wall-west`, "wall", minX - WALL, minX, minZ, maxZ, WALL_HEIGHT, "Wall", "east"),
    bounds(`${prefix}-wall-east`, "wall", maxX, maxX + WALL, minZ, maxZ, WALL_HEIGHT, "Wall", "west"),
    bounds(`${prefix}-wall-south-west`, "wall", minX - WALL, -DOOR_HALF_WIDTH, maxZ, maxZ + WALL, WALL_HEIGHT, "Wall", "north"),
    bounds(`${prefix}-wall-south-east`, "wall", DOOR_HALF_WIDTH, maxX + WALL, maxZ, maxZ + WALL, WALL_HEIGHT, "Wall", "north"),
    bounds(doorId, "door", -DOOR_HALF_WIDTH, DOOR_HALF_WIDTH, maxZ, maxZ + WALL, 2.9, doorLabel, "north"),
  ];
}

const find = (obstacles: readonly Obstacle[], id: string): Obstacle => {
  const found = obstacles.find((o) => o.id === id);
  if (!found) throw new Error(`Room layout has no obstacle "${id}"`);
  return found;
};

/** The way out: a door back to the square, arriving in front of the building's door. */
const outside = (obstacles: readonly Obstacle[], id: string, label: string, plazaDoor: string): Interactable => ({
  id,
  kind: "door",
  label,
  seats: standingSpotsAlongEdge(find(obstacles, id), 2, "north"),
  door: { to: "plaza", door: plazaDoor, actionLabel: "Go out to the square" },
});

// ── University hall: the lecture room ────────────────────────────────────────
// Rows of two-seat desks facing the board and the lectern; a wide middle
// aisle from the door. The desks offer the usual study and sit, and to
// enrolled students the course's lectures and exam (M8).

const LECTURE_FLOOR: RoomFloor = { minX: -7, maxX: 7, minZ: -5, maxZ: 5 };
const lectureObstacles: Obstacle[] = [
  ...shell("lecture", LECTURE_FLOOR, "lecture-room-door", "Lecture room door"),
  bounds("lecture-board", "board", -3, 3, -5, -4.9, 2.8, "Blackboard", "south"),
  box("lecture-lectern", "lectern", 0, -3.6, 1.0, 0.6, 1.15, "Lectern", "south"),
];
const LECTURE_ROWS = [-1.8, 0.4, 2.6];
const lectureDesks: Interactable[] = [];
for (const [row, z] of LECTURE_ROWS.entries()) {
  for (const [column, x] of [-3.6, 3.6].entries()) {
    const desk = box(`lecture-desk-${row + 1}${"ab"[column]}`, "desk", x, z, 3.0, 0.6, 0.78, "Lecture desk", "south");
    const seats = seatsAlongEdge(desk, 2, "south", "towards");
    lectureObstacles.push(desk, ...chairsFor(desk, seats));
    lectureDesks.push({ id: desk.id, kind: "desk", label: "Lecture desk", seats, lecture: true });
  }
}

export const LECTURE_ROOM: Room = {
  floor: LECTURE_FLOOR,
  layout: {
    halfSize: 8,
    obstacles: lectureObstacles,
    interactables: [...lectureDesks, outside(lectureObstacles, "lecture-room-door", "Way out", "hall-door")],
    spawnPoints: [{ x: 0, z: 3.9 }],
  },
};

// ── Library: the reading room ────────────────────────────────────────────────
// Shelves along three walls, two long reading tables with seats on both sides.

const READING_FLOOR: RoomFloor = { minX: -6, maxX: 6, minZ: -4.5, maxZ: 4.5 };
const readingObstacles: Obstacle[] = [
  ...shell("reading", READING_FLOOR, "reading-room-door", "Reading room door"),
  bounds("reading-shelves-north", "shelf", -5.5, 5.5, -4.5, -4, 2.4, "Bookshelves", "south"),
  bounds("reading-shelves-west", "shelf", -6, -5.5, -3.5, 3, 2.4, "Bookshelves", "east"),
  bounds("reading-shelves-east", "shelf", 5.5, 6, -3.5, 3, 2.4, "Bookshelves", "west"),
];
const readingTables: Interactable[] = [];
for (const [k, x] of [-2.4, 2.4].entries()) {
  const table = box(`reading-table-${k + 1}`, "desk", x, -0.6, 2.2, 1.0, 0.78, "Reading table", "south");
  const seats = [...seatsAlongEdge(table, 2, "north", "towards", 0), ...seatsAlongEdge(table, 2, "south", "towards", 2)];
  readingObstacles.push(table, ...chairsFor(table, seats));
  readingTables.push({ id: table.id, kind: "desk", label: "Reading table", seats });
}

export const READING_ROOM: Room = {
  floor: READING_FLOOR,
  layout: {
    halfSize: 7,
    obstacles: readingObstacles,
    interactables: [...readingTables, outside(readingObstacles, "reading-room-door", "Way out", "library-door")],
    spawnPoints: [{ x: 0, z: 3.4 }],
  },
};
