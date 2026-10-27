// Homes (M10): a rented room in the student housing is an area of its own,
// one per tenancy, built from its room type's template and the furniture
// placed in it. Same collision-first format as every other room (D-033): the
// furniture is an obstacle inside its spot, the art is drawn inside it.
// Placement is controlled: each room has fixed spots (a bed, seats,
// decorations), each taking one category of furniture; nothing is placed
// freely. Coordinates: metres, X east, Z south, origin in the middle of the
// room; the door is in the south wall. Not a model of any real building.

import type { AreaDefinition } from "./areas.ts";
import { shell, type Room, type RoomFloor } from "./interiors.ts";
import { FURNITURE, ROOM_TYPES, type FurnitureCategory, type FurnitureId, type RoomTypeId } from "./life/config.ts";
import {
  HOUSING_DOOR_ID,
  PLAZA_LAYOUT,
  box,
  chairsFor,
  seatsAlongEdge,
  standingSpotsAlongEdge,
  type Interactable,
  type Obstacle,
  type Seat,
  type Side,
} from "./world.ts";

/** Home area ids are "home/<home id>": one per tenancy, private to its tenant. */
export const HOME_AREA_PREFIX = "home/";
/** Every home's door (back to the student housing's door on the square). */
export const HOME_DOOR_ID = "home-door";

export const homeAreaId = (homeId: string): string => `${HOME_AREA_PREFIX}${homeId}`;
export const isHomeArea = (areaId: string): boolean => areaId.startsWith(HOME_AREA_PREFIX);

/** A fixed spot in a room where one piece of furniture of one category can go. */
export interface HomeSlot {
  /** Stable within the room type, e.g. "bed", "seat-1", "decor-2". */
  id: string;
  label: string;
  category: FurnitureCategory;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  /** The side the furniture's front faces (where you sit down or get into bed). It stands against the opposite side. */
  facing: Side;
  /** The room's own furniture, there while nothing of yours is placed in the spot. */
  default?: FurnitureId;
}

export interface HomeTemplate {
  floor: RoomFloor;
  slots: readonly HomeSlot[];
  /** The room's own desk against the north wall (its chair on the south side). */
  desk: { cx: number; width: number };
  /** Where you stand after coming in. */
  spawn: { x: number; z: number };
}

const slot = (id: string, label: string, category: FurnitureCategory, minX: number, maxX: number, minZ: number, maxZ: number, facing: Side, def?: FurnitureId): HomeSlot => ({
  id,
  label,
  category,
  minX,
  maxX,
  minZ,
  maxZ,
  facing,
  ...(def ? { default: def } : {}),
});

/**
 * One template per room type (ROOM_TYPES). The bed is against the west wall,
 * the desk against the north wall, seats face into the room, decorations
 * stand against a wall; the middle stays free to walk from the door.
 */
export const HOME_TEMPLATES: Record<RoomTypeId, HomeTemplate> = {
  "box-room": {
    floor: { minX: -2.6, maxX: 2.6, minZ: -2.2, maxZ: 2.2 },
    slots: [
      slot("bed", "Bed", "bed", -2.6, -1.4, -2.2, 0, "east", "room-bed"),
      slot("seat-1", "Seat", "seat", 1.4, 2.6, 0.1, 1.3, "west"),
      slot("decor-1", "Decoration", "decor", -1.25, -0.35, -2.2, -1.7, "south"),
    ],
    desk: { cx: 1.3, width: 1.2 },
    spawn: { x: 0, z: 1.3 },
  },
  "single-room": {
    floor: { minX: -3.4, maxX: 3.4, minZ: -2.6, maxZ: 2.6 },
    slots: [
      slot("bed", "Bed", "bed", -3.4, -2.2, -2.6, -0.4, "east", "room-bed"),
      slot("seat-1", "Seat", "seat", 2.2, 3.4, 0.3, 1.5, "west"),
      slot("decor-1", "Decoration by the bed", "decor", -1.95, -1.05, -2.6, -2.1, "south"),
      slot("decor-2", "Decoration by the door", "decor", -3.4, -2.5, 1.5, 2.4, "east"),
    ],
    desk: { cx: 1.6, width: 1.4 },
    spawn: { x: 0, z: 1.7 },
  },
  studio: {
    floor: { minX: -4.2, maxX: 4.2, minZ: -3.0, maxZ: 3.0 },
    slots: [
      slot("bed", "Bed", "bed", -4.2, -3.0, -3.0, -0.8, "east", "room-bed"),
      slot("seat-1", "Seat by the window", "seat", 3.0, 4.2, -0.4, 0.8, "west"),
      slot("seat-2", "Seat by the door", "seat", -2.6, -1.4, 1.6, 2.8, "north"),
      slot("decor-1", "Decoration by the bed", "decor", -2.75, -1.85, -3.0, -2.5, "south"),
      slot("decor-2", "Decoration on the back wall", "decor", -0.45, 0.45, -3.0, -2.5, "south"),
      slot("decor-3", "Decoration in the corner", "decor", 3.3, 4.2, 2.1, 3.0, "west"),
    ],
    desk: { cx: 2.2, width: 1.4 },
    spawn: { x: 0, z: 2.1 },
  },
};

/** A piece of furniture in a spot, as the rules need to see it. */
export interface Placement {
  slot: string;
  itemId: FurnitureId;
}

export const findSlot = (roomType: RoomTypeId, slotId: string): HomeSlot | undefined => HOME_TEMPLATES[roomType].slots.find((s) => s.id === slotId);

/** What stands in each spot: your piece, or the room's own, or nothing. */
export function furnishedSlots(roomType: RoomTypeId, placements: readonly Placement[]): { slot: HomeSlot; itemId: FurnitureId | null; yours: boolean }[] {
  return HOME_TEMPLATES[roomType].slots.map((s) => {
    const placed = placements.find((p) => p.slot === s.id);
    if (placed) return { slot: s, itemId: placed.itemId, yours: true };
    return { slot: s, itemId: s.default ?? null, yours: false };
  });
}

export type PlacementRefusal = "unknown_slot" | "wrong_slot" | "slot_taken";

/** Why this item can't go in this spot now, or null (the server's check; the panel uses it too). */
export function placementRefusal(roomType: RoomTypeId, placements: readonly Placement[], slotId: string, itemId: FurnitureId): PlacementRefusal | null {
  const target = findSlot(roomType, slotId);
  if (!target) return "unknown_slot";
  if (FURNITURE[itemId].category !== target.category) return "wrong_slot";
  if (placements.some((p) => p.slot === slotId)) return "slot_taken";
  return null;
}

const OUT: Record<Side, { x: number; z: number }> = { north: { x: 0, z: -1 }, south: { x: 0, z: 1 }, east: { x: 1, z: 0 }, west: { x: -1, z: 0 } };

/** The furniture's box: centred across the spot's front, standing against its back. */
export function furnitureBox(target: HomeSlot, itemId: FurnitureId, id: string): Obstacle {
  const item = FURNITURE[itemId];
  const frontAlongX = target.facing === "north" || target.facing === "south";
  const sizeX = frontAlongX ? item.width : item.depth;
  const sizeZ = frontAlongX ? item.depth : item.width;
  const cx = (target.minX + target.maxX) / 2;
  const cz = (target.minZ + target.maxZ) / 2;
  let minX = cx - sizeX / 2;
  let minZ = cz - sizeZ / 2;
  if (target.facing === "east") minX = target.minX;
  if (target.facing === "west") minX = target.maxX - sizeX;
  if (target.facing === "south") minZ = target.minZ;
  if (target.facing === "north") minZ = target.maxZ - sizeZ;
  return { id, kind: item.kind, label: item.label, minX, maxX: minX + sizeX, minZ, maxZ: minZ + sizeZ, height: item.height, facing: target.facing };
}

/** Distance from the furniture's front to where you stand to use it. */
const APPROACH = 0.85;
/** A seat this deep is sat on at its front edge, like a chair or a bench; deeper ones further in. */
const SEAT_DEPTH = 0.5;

/** A bed's one spot: lying along its length, head at the north or west end; you get in from its front. */
function bedSpot(bed: Obstacle, facing: Side, id: string): Seat {
  const cx = (bed.minX + bed.maxX) / 2;
  const cz = (bed.minZ + bed.maxZ) / 2;
  const alongZ = facing === "east" || facing === "west";
  const length = alongZ ? bed.maxZ - bed.minZ : bed.maxX - bed.minX;
  const depth = alongZ ? bed.maxX - bed.minX : bed.maxZ - bed.minZ;
  const feet = length / 2 - 0.12;
  const out = OUT[facing];
  return {
    id,
    x: alongZ ? cx : cx + feet,
    z: alongZ ? cz + feet : cz,
    rotation: alongZ ? 0 : Math.PI / 2,
    approach: { x: cx + out.x * (depth / 2 + APPROACH), z: cz + out.z * (depth / 2 + APPROACH) },
    pose: "lie",
  };
}

/** Seat ids carry the area id, so two homes never share one (seat reservations are kept by id). */
const scoped = (areaId: string, seats: readonly Seat[]): Seat[] => seats.map((s) => ({ ...s, id: `${areaId}/${s.id}` }));

/**
 * A home's room: the walls and door, the room's own desk, and the furniture
 * in each spot (yours, or the room's own bed). Unknown spots are ignored.
 */
export function homeRoom(areaId: string, roomType: RoomTypeId, placements: readonly Placement[]): Room {
  const template = HOME_TEMPLATES[roomType];
  const { floor } = template;
  const obstacles: Obstacle[] = shell("home", floor, HOME_DOOR_ID, "Door");
  const interactables: Interactable[] = [];

  const desk = box("home-desk", "desk", template.desk.cx, floor.minZ + 0.3, template.desk.width, 0.6, 0.78, "Desk", "south");
  const deskSeats = scoped(areaId, seatsAlongEdge(desk, 1, "south", "towards"));
  obstacles.push(desk, ...chairsFor(desk, deskSeats));
  interactables.push({ id: desk.id, kind: "desk", label: "Desk", seats: deskSeats });

  for (const { slot: spot, itemId } of furnishedSlots(roomType, placements)) {
    if (!itemId) continue;
    const id = `home-${spot.id}`;
    const piece = furnitureBox(spot, itemId, id);
    obstacles.push(piece);
    const item = FURNITURE[itemId];
    if (item.category === "bed") {
      interactables.push({ id, kind: "bed", label: item.label, seats: [bedSpot(piece, spot.facing, `${areaId}/${id}/lie`)], furniture: itemId });
    } else if (item.category === "seat") {
      // Deep seats (beanbag, armchair): sit in them, not on their front edge.
      const inward = Math.max(0, item.depth - SEAT_DEPTH);
      const out = OUT[spot.facing];
      const seats = scoped(areaId, seatsAlongEdge(piece, 1, spot.facing, "away")).map((s) => ({ ...s, x: s.x - out.x * inward, z: s.z - out.z * inward, comfort: item.seatComfort }));
      interactables.push({ id, kind: "seat", label: item.label, seats, furniture: itemId });
    }
  }

  const door = obstacles.find((o) => o.id === HOME_DOOR_ID)!;
  interactables.push({
    id: HOME_DOOR_ID,
    kind: "door",
    label: "Door",
    seats: scoped(areaId, standingSpotsAlongEdge(door, 2, "north")),
    door: { to: "plaza", door: HOUSING_DOOR_ID, actionLabel: "Go out to the square" },
  });

  return {
    floor,
    layout: {
      halfSize: Math.ceil(Math.max(floor.maxX, floor.maxZ) + 1),
      obstacles,
      interactables,
      spawnPoints: [template.spawn],
    },
  };
}

/** A home as an area (shared/src/areas.ts): what the server simulates and the client draws. */
export function homeArea(areaId: string, roomType: RoomTypeId, placements: readonly Placement[]): AreaDefinition {
  return { id: areaId, label: `Your ${ROOM_TYPES[roomType].label.toLowerCase()}`, indoor: true, ...homeRoom(areaId, roomType, placements) };
}

/** The plaza's student housing door (a test checks it exists and leads home). */
export const housingDoor = (): Interactable | undefined => PLAZA_LAYOUT.interactables.find((i) => i.id === HOUSING_DOOR_ID);
