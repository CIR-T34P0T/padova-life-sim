// Layout of the first district: a fictional university square inspired by
// Padua's historic centre (a university palazzo, porticoes, a market, a café).
// Not a model of any real building or square (docs/DECISIONS.md D-033).
//
// This file is the single source of truth for what blocks movement. The
// server collides against these boxes; the client draws every solid thing
// inside them (client/src/render/world/), and a test checks that nothing
// solid is drawn outside them below head height and that every box is
// visibly filled (client/test/world.test.ts).
//
// Coordinates: metres, X to the east, Z to the south, Y up. Origin = piazza centre.

export type ObstacleKind =
  | "building"
  | "arcade"
  | "fountain"
  | "stall"
  | "bench"
  | "planter"
  | "desk"
  | "counter"
  | "tree"
  | "lamp"
  | "chair"
  | "table"
  | "garden"
  | "bike-rack"
  | "noticeboard"
  // Indoor rooms (M7c)
  | "door"
  | "wall"
  | "lectern"
  | "board"
  | "shelf";

export type InteractableKind = "bench" | "desk" | "cafe" | "fountain" | "door" | "noticeboard";

/**
 * Where a door leads (M7c): the area, and the door in that area you arrive at
 * (in front of it, facing away from it). Doors always come in linked pairs.
 */
export interface DoorLink {
  /** Area id (shared/src/areas.ts), e.g. "hall/lecture-room" or "plaza". */
  to: string;
  /** Id of the door interactable in that area. */
  door: string;
  /** The menu option, e.g. "Go in" or "Go out to the square". */
  actionLabel: string;
}

/** A side of a box, or a compass direction (north = -Z, east = +X). */
export type Side = "north" | "south" | "east" | "west";

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
  /**
   * Who uses it: "staff" spots (behind the café counter) are only for working
   * a shift and never for customers; untagged points are for everyone else.
   */
  use?: "staff";
}

/**
 * An object players can click to get contextual actions. Its interaction
 * metadata is explicit: `kind` decides the actions (shared/src/interactions.ts),
 * `seats` are the interaction points, `label` is the menu title.
 */
export interface Interactable {
  /** Stable id used in network messages. Equal to the obstacle id it is drawn as. */
  id: string;
  kind: InteractableKind;
  /** Name shown in menus. */
  label: string;
  seats: readonly Seat[];
  /** For doors: where it leads. */
  door?: DoorLink;
  /** For desks: lectures and exams are held here (M8). */
  lecture?: boolean;
}

export interface Obstacle {
  id: string;
  /** What it looks like (the renderer picks a model by kind). */
  kind: ObstacleKind;
  /** Name shown when a player taps it ("Library: you can't walk there."). */
  label?: string;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  /** Height of the solid part in metres (rendering and tap targets only; collision is 2D). */
  height: number;
  /**
   * The side people use or look from: a bench's seats, a chair's sitter (the
   * way they look), a building's main façade. Rendering only.
   */
  facing?: Side;
  /** Tapping this part selects that interactable (a chair belongs to its table). */
  partOf?: string;
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
const PLAYER_RADIUS = 0.35;

const OUTWARD: Record<Side, { x: number; z: number }> = {
  north: { x: 0, z: -1 },
  south: { x: 0, z: 1 },
  east: { x: 1, z: 0 },
  west: { x: -1, z: 0 },
};

/** Facing angle (radians, 0 = +Z) for a compass direction. */
export const sideRotation = (side: Side): number => Math.atan2(OUTWARD[side].x, OUTWARD[side].z);

/**
 * Seats along one edge of a box-shaped object.
 * "away": the character sits on the edge facing outwards, back to the object (a bench).
 * "towards": the character sits just off the edge facing the object (a desk or table).
 * `first` is the letter index of the first seat id (a, b, …), so two edges don't clash.
 */
export function seatsAlongEdge(obstacle: Obstacle, count: number, side: Side, facing: "away" | "towards", first = 0): Seat[] {
  const out = OUTWARD[side];
  const alongX = side === "north" || side === "south";
  const length = alongX ? obstacle.maxX - obstacle.minX : obstacle.maxZ - obstacle.minZ;
  const start = alongX ? obstacle.minX : obstacle.minZ;
  const edge = side === "south" ? obstacle.maxZ : side === "north" ? obstacle.minZ : side === "east" ? obstacle.maxX : obstacle.minX;
  const seatOffset = facing === "away" ? 0.05 : 0.3;
  const approachOffset = PLAYER_RADIUS + APPROACH_CLEARANCE;
  // atan2(-0, -1) is -π; keep π so facing north is always the same number.
  const rotation = facing === "away" ? sideRotation(side) : Math.atan2(out.x === 0 ? 0 : -out.x, -out.z);
  const seats: Seat[] = [];
  for (let i = 0; i < count; i++) {
    const along = start + (length * (i + 0.5)) / count;
    const at = (offset: number) =>
      alongX ? { x: along, z: edge + out.z * offset } : { x: edge + out.x * offset, z: along };
    const seat = at(seatOffset);
    seats.push({
      id: `${obstacle.id}/seat-${String.fromCharCode(97 + first + i)}`,
      x: seat.x,
      z: seat.z,
      rotation,
      approach: at(approachOffset),
    });
  }
  return seats;
}

/**
 * Standing spots along one long edge of an object, facing it. Ids are
 * `<object>/<prefix>-a`, `-b`…; staff spots use the prefix "staff".
 */
export function standingSpotsAlongEdge(obstacle: Obstacle, count: number, edge: "north" | "south", use?: "staff", playerRadius = PLAYER_RADIUS): Seat[] {
  const width = obstacle.maxX - obstacle.minX;
  const gap = playerRadius + 0.3;
  const z = edge === "south" ? obstacle.maxZ + gap : obstacle.minZ - gap;
  const rotation = edge === "south" ? Math.PI : 0;
  const prefix = use ?? "spot";
  return Array.from({ length: count }, (_, i) => {
    const x = obstacle.minX + (width * (i + 0.5)) / count;
    const spot: Seat = { id: `${obstacle.id}/${prefix}-${String.fromCharCode(97 + i)}`, x, z, rotation, approach: { x, z }, pose: "stand" };
    return use ? { ...spot, use } : spot;
  });
}

/**
 * A chair for each "towards" seat: a small box under the sitter, ending
 * before the approach point so the character can still walk up to it.
 */
export function chairsFor(owner: Obstacle, seats: readonly Seat[]): Obstacle[] {
  return seats.map((seat) => {
    const dx = seat.x - (owner.minX + owner.maxX) / 2;
    const dz = seat.z - (owner.minZ + owner.maxZ) / 2;
    // Which edge of the owner the seat is on (seats sit just off one edge).
    const side: Side =
      Math.abs(dz) - (owner.maxZ - owner.minZ) / 2 > Math.abs(dx) - (owner.maxX - owner.minX) / 2
        ? dz > 0 ? "south" : "north"
        : dx > 0 ? "east" : "west";
    const out = OUTWARD[side];
    const edge = side === "south" ? owner.maxZ : side === "north" ? owner.minZ : side === "east" ? owner.maxX : owner.minX;
    const near = edge + (out.x + out.z) * 0.1;
    const far = edge + (out.x + out.z) * 0.48;
    const half = 0.22;
    const letter = seat.id.slice(seat.id.lastIndexOf("-") + 1);
    const base = { id: `${owner.id}/chair-${letter}`, kind: "chair" as const, label: "Chair", height: 0.9, partOf: owner.id };
    // The sitter faces the table: the opposite of the edge's outward side.
    const facing: Side = side === "south" ? "north" : side === "north" ? "south" : side === "east" ? "west" : "east";
    return side === "north" || side === "south"
      ? { ...base, facing, minX: seat.x - half, maxX: seat.x + half, minZ: Math.min(near, far), maxZ: Math.max(near, far) }
      : { ...base, facing, minX: Math.min(near, far), maxX: Math.max(near, far), minZ: seat.z - half, maxZ: seat.z + half };
  });
}

export const box = (
  id: string,
  kind: ObstacleKind,
  cx: number,
  cz: number,
  width: number,
  depth: number,
  height: number,
  label?: string,
  facing?: Side,
): Obstacle => ({
  id,
  kind,
  label,
  minX: cx - width / 2,
  maxX: cx + width / 2,
  minZ: cz - depth / 2,
  maxZ: cz + depth / 2,
  height,
  ...(facing ? { facing } : {}),
});

export const bounds = (id: string, kind: ObstacleKind, minX: number, maxX: number, minZ: number, maxZ: number, height: number, label?: string, facing?: Side): Obstacle => ({
  id,
  kind,
  label,
  minX,
  maxX,
  minZ,
  maxZ,
  height,
  ...(facing ? { facing } : {}),
});

/**
 * A row of flower planters closing a street where the walkable area ends,
 * so the edge is something you can see and bump into, not an invisible wall.
 */
function streetClosure(name: string, side: Side, from: number, to: number, segments: number): Obstacle[] {
  const edge = 24;
  const depth = 0.9;
  const step = (to - from) / segments;
  return Array.from({ length: segments }, (_, i) => {
    const a = from + step * i;
    const b = a + step;
    const id = `${name}-planter-${i + 1}`;
    const facing: Side = side === "north" ? "south" : side === "south" ? "north" : side === "west" ? "east" : "west";
    switch (side) {
      case "north":
        return bounds(id, "planter", a, b, -edge, -edge + depth, 0.85, "Flower planter (the street beyond is not open yet)", facing);
      case "south":
        return bounds(id, "planter", a, b, edge - depth, edge, 0.85, "Flower planter (the street beyond is not open yet)", facing);
      case "west":
        return bounds(id, "planter", -edge, -edge + depth, a, b, 0.85, "Flower planter (the street beyond is not open yet)", facing);
      case "east":
        return bounds(id, "planter", edge - depth, edge, a, b, 0.85, "Flower planter (the street beyond is not open yet)", facing);
    }
  });
}

const HALL = "Palazzo degli Studi (university hall)";

const plazaObstacles: Obstacle[] = [
  // ── Buildings around the square, with a street opening on every side ──
  // University hall, split around its walk-in entrance porch (3 m wide, 1.6 m deep).
  bounds("north-west-block", "building", -24, -14.5, -24, -18, 14, HALL, "south"),
  bounds("north-west-block-porch", "building", -14.5, -11.5, -24, -19.6, 14, HALL, "south"),
  bounds("north-west-block-east", "building", -11.5, -3, -24, -18, 14, HALL, "south"),
  bounds("north-east-block", "building", 4, 24, -24, -18, 12, "Library", "south"),
  bounds("west-block", "building", -24, -18, -11, 11, 13, "Residences and bookshop", "east"),
  // Porticoed houses: the ground floor stands back behind the columns, so
  // the portico between x 17.5 and 19.5 is a covered walkway.
  bounds("east-block", "building", 19.5, 24, -12.3, 12.3, 12, "Portico houses", "west"),
  bounds("south-west-block", "building", -24, -5, 18, 24, 11, "Student housing", "north"),
  bounds("south-east-block", "building", 3, 24, 18, 24, 12, "Shops", "north"),
  // Portico columns carrying the east houses' upper floors (a nod to Padua's porticoes).
  box("arcade-0", "arcade", 17.2, -12, 0.6, 0.6, 4.2, "Portico column"),
  box("arcade-1", "arcade", 17.2, -8, 0.6, 0.6, 4.2, "Portico column"),
  box("arcade-2", "arcade", 17.2, -4, 0.6, 0.6, 4.2, "Portico column"),
  box("arcade-3", "arcade", 17.2, 0, 0.6, 0.6, 4.2, "Portico column"),
  box("arcade-4", "arcade", 17.2, 4, 0.6, 0.6, 4.2, "Portico column"),
  box("arcade-5", "arcade", 17.2, 8, 0.6, 0.6, 4.2, "Portico column"),
  box("arcade-6", "arcade", 17.2, 12, 0.6, 0.6, 4.2, "Portico column"),
  // ── Street ends (the walkable area stops here) ──
  ...streetClosure("north-street", "north", -3, 4, 3),
  ...streetClosure("south-street", "south", -5, 3, 3),
  ...streetClosure("west-street-north", "west", -18, -11, 3),
  ...streetClosure("west-street-south", "west", 11, 18, 3),
  ...streetClosure("east-street-north", "east", -18, -12.3, 2),
  ...streetClosure("east-street-south", "east", 12.3, 18, 2),
  // ── Centre of the piazza ──
  box("fountain", "fountain", 0, -3, 4, 4, 2.6, "Fountain"),
  box("stall-1", "stall", -8, 7, 3, 2, 2.4, "Market stall"),
  box("stall-2", "stall", -3.5, 7, 3, 2, 2.4, "Market stall"),
  box("stall-3", "stall", 1, 7, 3, 2, 2.4, "Market stall"),
  box("bench-1", "bench", -6, -8, 2, 0.6, 0.85, "Bench", "south"),
  box("bench-2", "bench", 6, -8, 2, 0.6, 0.85, "Bench", "south"),
  box("planter-1", "planter", 9, 3, 1.5, 1.5, 0.9, "Lemon tree planter"),
  box("planter-2", "planter", -11, -2, 1.5, 1.5, 0.9, "Lemon tree planter"),
  // Gardens with a bench on their piazza side.
  bounds("garden-west", "garden", -17, -13, -8.5, -2.5, 0.6, "Garden bed"),
  bounds("garden-east", "garden", 11.5, 15.5, -8.5, -2.5, 0.6, "Garden bed"),
  bounds("bench-3", "bench", -13, -12.4, -6.5, -4.5, 0.85, "Bench", "east"),
  bounds("bench-4", "bench", 10.9, 11.5, -6.5, -4.5, 0.85, "Bench", "west"),
  bounds("bench-5", "bench", -17.6, -17, 4.5, 6.5, 0.85, "Bench", "east"),
  // Study desks in front of the university hall, either side of its entrance.
  box("desk-1", "desk", -15, -14, 1.6, 0.8, 0.8, "Study desk", "south"),
  box("desk-2", "desk", -10, -14, 1.6, 0.8, 0.8, "Study desk", "south"),
  // Outdoor café: a kiosk bar in the open piazza (the default camera looks
  // north, so anything against the south buildings is hidden behind them)
  // and tables east of it.
  box("cafe-counter", "counter", 9, 10, 3, 0.8, 2.7, "Café counter", "north"),
  box("cafe-table-1", "table", 13, 9.6, 0.9, 0.9, 0.75, "Café table"),
  box("cafe-table-2", "table", 13, 13.2, 0.9, 0.9, 0.75, "Café table"),
  box("cafe-table-3", "table", 15.4, 11.4, 0.9, 0.9, 0.75, "Café table"),
  // Plane trees in stone tree grates (only the trunk and grate block; the
  // canopy is above head height).
  box("tree-1", "tree", -16.5, 1.5, 0.8, 0.8, 3, "Plane tree"),
  box("tree-2", "tree", -16.5, 9.5, 0.8, 0.8, 3, "Plane tree"),
  box("tree-3", "tree", -5.5, -14.5, 0.8, 0.8, 3, "Plane tree"),
  box("tree-4", "tree", 6.5, -14.5, 0.8, 0.8, 3, "Plane tree"),
  box("tree-5", "tree", 12.5, 5.5, 0.8, 0.8, 3, "Plane tree"),
  box("tree-6", "tree", -16.5, 15.5, 0.8, 0.8, 3, "Plane tree"),
  box("tree-7", "tree", 9.5, 15.5, 0.8, 0.8, 3, "Plane tree"),
  // Street lamps.
  box("lamp-1", "lamp", -4.5, -7.5, 0.4, 0.4, 4.3, "Street lamp"),
  box("lamp-2", "lamp", 4.5, -7.5, 0.4, 0.4, 4.3, "Street lamp"),
  box("lamp-3", "lamp", -4.5, 1.5, 0.4, 0.4, 4.3, "Street lamp"),
  box("lamp-4", "lamp", 4.5, 1.5, 0.4, 0.4, 4.3, "Street lamp"),
  box("lamp-5", "lamp", -11, 10, 0.4, 0.4, 4.3, "Street lamp"),
  box("lamp-6", "lamp", 7, 16.5, 0.4, 0.4, 4.3, "Street lamp"),
  box("lamp-7", "lamp", 10.5, 13.5, 0.4, 0.4, 4.3, "Street lamp"),
  // Bicycles, and the university notice board.
  bounds("bike-rack", "bike-rack", -14.5, -11.5, 15.1, 16.9, 1.1, "Bicycle rack", "north"),
  bounds("noticeboard", "noticeboard", -21, -19.2, -17.75, -17.45, 2.1, "University notice board", "south"),
  // Doors into the indoor rooms (M7c): a portal standing just in front of each
  // building's entrance, so it can be tapped and highlighted on its own.
  bounds("hall-door", "door", -14.23, -11.77, -19.6, -19.35, 3.9, "University hall", "south"),
  bounds("library-door", "door", 12.87, 15.13, -18, -17.75, 3.8, "Library", "south"),
];

const obstacle = (id: string): Obstacle => {
  const found = plazaObstacles.find((o) => o.id === id);
  if (!found) throw new Error(`World layout has no obstacle "${id}"`);
  return found;
};

const desk1Seats = seatsAlongEdge(obstacle("desk-1"), 1, "south", "towards");
const desk2Seats = seatsAlongEdge(obstacle("desk-2"), 1, "south", "towards");
const tableSeats = (id: string) => [
  ...seatsAlongEdge(obstacle(id), 1, "north", "towards", 0),
  ...seatsAlongEdge(obstacle(id), 1, "south", "towards", 1),
];
const table1Seats = tableSeats("cafe-table-1");
const table2Seats = tableSeats("cafe-table-2");
const table3Seats = tableSeats("cafe-table-3");

plazaObstacles.push(
  ...chairsFor(obstacle("desk-1"), desk1Seats),
  ...chairsFor(obstacle("desk-2"), desk2Seats),
  ...chairsFor(obstacle("cafe-table-1"), table1Seats),
  ...chairsFor(obstacle("cafe-table-2"), table2Seats),
  ...chairsFor(obstacle("cafe-table-3"), table3Seats),
);

export const PLAZA_LAYOUT: WorldLayout = {
  halfSize: 24,
  obstacles: plazaObstacles,
  interactables: [
    { id: "bench-1", kind: "bench", label: "Bench", seats: seatsAlongEdge(obstacle("bench-1"), 2, "south", "away") },
    { id: "bench-2", kind: "bench", label: "Bench", seats: seatsAlongEdge(obstacle("bench-2"), 2, "south", "away") },
    { id: "bench-3", kind: "bench", label: "Bench", seats: seatsAlongEdge(obstacle("bench-3"), 2, "east", "away") },
    { id: "bench-4", kind: "bench", label: "Bench", seats: seatsAlongEdge(obstacle("bench-4"), 2, "west", "away") },
    { id: "bench-5", kind: "bench", label: "Bench", seats: seatsAlongEdge(obstacle("bench-5"), 2, "east", "away") },
    { id: "desk-1", kind: "desk", label: "Study desk", seats: desk1Seats },
    { id: "desk-2", kind: "desk", label: "Study desk", seats: desk2Seats },
    // Customers order on the north side; staff work behind the counter on the
    // south side, under the canopy's barista end (M7).
    {
      id: "cafe-counter",
      kind: "cafe",
      label: "Café counter",
      seats: [...standingSpotsAlongEdge(obstacle("cafe-counter"), 2, "north"), ...standingSpotsAlongEdge(obstacle("cafe-counter"), 2, "south", "staff")],
    },
    // Café tables use the desk rules (sit, or study over a coffee).
    { id: "cafe-table-1", kind: "desk", label: "Café table", seats: table1Seats },
    { id: "cafe-table-2", kind: "desk", label: "Café table", seats: table2Seats },
    { id: "cafe-table-3", kind: "desk", label: "Café table", seats: table3Seats },
    { id: "fountain", kind: "fountain", label: "Fountain", seats: standingSpotsAlongEdge(obstacle("fountain"), 2, "south") },
    {
      id: "hall-door",
      kind: "door",
      label: "University hall",
      seats: standingSpotsAlongEdge(obstacle("hall-door"), 2, "south"),
      door: { to: "hall/lecture-room", door: "lecture-room-door", actionLabel: "Go in" },
    },
    {
      id: "library-door",
      kind: "door",
      label: "Library",
      seats: standingSpotsAlongEdge(obstacle("library-door"), 2, "south"),
      door: { to: "library/reading-room", door: "reading-room-door", actionLabel: "Go in" },
    },
    // Enrolment in the university's course (M8); lectures and the exam are in the hall's lecture room.
    { id: "noticeboard", kind: "noticeboard", label: "University notice board", seats: standingSpotsAlongEdge(obstacle("noticeboard"), 1, "south") },
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
