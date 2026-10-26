// Areas (M7c, D-039): the square and the indoor rooms, all in one server room.
// Each area is a layout of its own; doors move a character between areas.
// The server keeps every character in exactly one area and sends each client
// only the players in its own area.

import { LECTURE_ROOM, READING_ROOM, type RoomFloor } from "./interiors.ts";
import { findInteractable } from "./interactions.ts";
import { PLAZA_LAYOUT, type DoorLink, type WorldLayout } from "./world.ts";

/** The square. Also where a character goes when its saved area no longer exists. */
export const PLAZA_AREA = "plaza";

export interface AreaDefinition {
  /** Stable id, stored with a character's position (`character_state.area`). */
  id: string;
  /** Shown to players, e.g. "Lecture room". */
  label: string;
  indoor: boolean;
  layout: WorldLayout;
  /** Indoor rooms: the floor inside the walls. */
  floor?: RoomFloor;
}

export const AREAS: Readonly<Record<string, AreaDefinition>> = {
  [PLAZA_AREA]: { id: PLAZA_AREA, label: "The square", indoor: false, layout: PLAZA_LAYOUT },
  "hall/lecture-room": { id: "hall/lecture-room", label: "Lecture room", indoor: true, ...LECTURE_ROOM },
  "library/reading-room": { id: "library/reading-room", label: "Reading room", indoor: true, ...READING_ROOM },
};

export const AREA_IDS = Object.keys(AREAS);

export function findArea(id: string): AreaDefinition | undefined {
  return Object.hasOwn(AREAS, id) ? AREAS[id] : undefined;
}

/**
 * Where a door delivers you: in front of the linked door in the other area,
 * facing away from it (into the room, or out into the square). Null if the
 * link points nowhere (a test checks that every link is valid).
 */
export function doorArrival(link: DoorLink, areas: Readonly<Record<string, AreaDefinition>> = AREAS): { area: string; x: number; z: number; rotation: number } | null {
  const target = areas[link.to];
  const door = target ? findInteractable(target.layout, link.door) : undefined;
  const spot = door?.seats[0];
  if (!target || !door || door.kind !== "door" || !spot) return null;
  return { area: target.id, x: spot.approach.x, z: spot.approach.z, rotation: spot.rotation + Math.PI };
}
