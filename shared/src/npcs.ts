// Non-player characters (M11): a few locals who follow game-time schedules
// and use the world exactly like players (the server walks them, reserves
// their seats and runs their actions through the same interaction rules).
// Pure data and rules, deterministic: what an NPC wants to do depends only on
// the game time; which seat it takes depends on what is free. No AI service.
// Names, roles and lines are fictional; every NPC is an adult.

import { INTERACTION_CONFIG, NPC_CONFIG } from "./config.ts";
import { MINUTES_PER_DAY, weekdayOf } from "./life/clock.ts";
import type { JobId } from "./life/config.ts";
import type { Interactable, WorldLayout } from "./world.ts";
import type { ActionId, SeatOccupancy } from "./interactions.ts";

/** What an NPC does at a place: the same actions players use. */
export type NpcAction = Extract<ActionId, "sit" | "study" | "sketch" | "work">;

/** One designated place: an object in an area and the action done there. */
export interface NpcPlace {
  area: string;
  object: string;
  action: NpcAction;
}

/** A stretch of the day with a purpose (minutes of the day, `from` inclusive, `to` exclusive). */
export interface NpcBlock {
  from: number;
  to: number;
  /** What the NPC is up to, for tests and docs ("At a lecture"). */
  label: string;
  /** Where to do it, in order of preference (the order turns each hour, so NPCs spread out). */
  places: readonly NpcPlace[];
  /** What the NPC says when greeted during this block. */
  lines: readonly string[];
}

export interface NpcDefinition {
  /** Stable id; the NPC's session id is `npc-<id>`. */
  id: string;
  name: string;
  /** Shown with the name so players can tell NPCs from players. */
  role: string;
  /** An appearance preset id (shared/src/appearance/presets.ts). */
  look: string;
  /** A job the NPC does at its workplace, unpaid and unsaved (the barista). */
  job?: JobId;
  /** Where the NPC arrives on the square and leaves it: just inside a closed street. */
  entry: { x: number; z: number };
  /** Monday to Friday. */
  weekdays: readonly NpcBlock[];
  /** Saturday and Sunday. */
  weekend: readonly NpcBlock[];
}

export const NPC_SESSION_PREFIX = "npc-";
export const npcSessionId = (id: string): string => `${NPC_SESSION_PREFIX}${id}`;
export const isNpcSessionId = (sessionId: string): boolean => sessionId.startsWith(NPC_SESSION_PREFIX);

const at = (hours: number, minutes = 0) => hours * 60 + minutes;
const place = (area: string, object: string, action: NpcAction): NpcPlace => ({ area, object, action });
const block = (from: number, to: number, label: string, places: NpcPlace[], lines: string[]): NpcBlock => ({ from, to, label, places, lines });

const PLAZA = "plaza";
const LECTURE_ROOM = "hall/lecture-room";
const READING_ROOM = "library/reading-room";

// Places NPCs may use. They avoid the objects players need most often (and
// the ones the browser tests use): benches 1–2, the study desks, café table 1,
// the fountain and the front lecture desks.
const CAFE_BREAK = [place(PLAZA, "cafe-table-3", "sit"), place(PLAZA, "cafe-table-2", "sit")];
const LECTURE = [place(LECTURE_ROOM, "lecture-desk-3b", "study")];
const LIBRARY = [place(READING_ROOM, "reading-table-2", "study")];
const SQUARE_SKETCH = [place(PLAZA, "bench-3", "sketch"), place(PLAZA, "bench-4", "sketch"), place(PLAZA, "bench-5", "sketch")];
const SQUARE_SIT = [place(PLAZA, "bench-5", "sit"), place(PLAZA, "bench-4", "sit"), place(PLAZA, "bench-3", "sit")];

const LINES = {
  lecture: ["Ciao! The lecture's about to start.", "Did you do the reading? Me neither."],
  library: ["Ciao… it's quiet in here, we'd better whisper.", "Exams soon. Back to the books!"],
  lunch: ["Ciao! Lunch break at last.", "The panini here are the best on the square."],
  square: ["Ciao! Lovely day on the square.", "Ciao! I'm sketching the fountain. Not very well."],
};

/** The locals. Four to start: enough to make the square feel alive, cheap to simulate. */
export const NPCS: readonly NpcDefinition[] = [
  {
    id: "giulia",
    name: "Giulia",
    role: "Barista",
    look: "top-bun",
    job: "cafe",
    entry: { x: 22.4, z: 15 },
    weekdays: [
      block(at(6, 45), at(13), "Working at the café", [place(PLAZA, "cafe-counter", "work")], ["Ciao! The espresso's fresh.", "Busy morning at the kiosk!", "Try a cornetto, they're still warm."]),
      block(at(13), at(13, 30), "Lunch break", CAFE_BREAK, ["Ciao! Just a short break."]),
      block(at(13, 30), at(20, 30), "Working at the café", [place(PLAZA, "cafe-counter", "work")], ["Ciao! What can I get you?", "A long day, but the coffee keeps me going."]),
    ],
    weekend: [
      block(at(8), at(19), "Working at the café", [place(PLAZA, "cafe-counter", "work")], ["Ciao! Weekends are busy at the kiosk.", "Ciao! The espresso's fresh."]),
    ],
  },
  {
    id: "marco",
    name: "Marco",
    role: "Student",
    look: "twists-sweater",
    entry: { x: -1, z: 22.4 },
    weekdays: [
      block(at(8, 20), at(9), "Hanging out", SQUARE_SIT, LINES.square),
      block(at(9), at(12, 50), "At a lecture", LECTURE, LINES.lecture),
      block(at(12, 50), at(14), "Lunch", CAFE_BREAK, LINES.lunch),
      block(at(14), at(16, 50), "Studying in the library", LIBRARY, LINES.library),
      block(at(16, 50), at(19, 10), "Sketching on the square", SQUARE_SKETCH, LINES.square),
    ],
    weekend: [
      block(at(10, 30), at(13), "Sketching on the square", SQUARE_SKETCH, LINES.square),
      block(at(13), at(14), "Lunch", CAFE_BREAK, LINES.lunch),
      block(at(14), at(18, 30), "Hanging out", SQUARE_SIT, LINES.square),
    ],
  },
  {
    id: "sofia",
    name: "Sofia",
    role: "Student",
    look: "bob-glasses",
    entry: { x: -22.4, z: -14.5 },
    weekdays: [
      block(at(8, 40), at(9, 10), "Hanging out", SQUARE_SIT, LINES.square),
      block(at(9, 10), at(12), "At a lecture", LECTURE, LINES.lecture),
      block(at(12), at(13, 10), "Lunch", CAFE_BREAK, LINES.lunch),
      block(at(13, 10), at(17, 40), "Studying in the library", LIBRARY, LINES.library),
      block(at(17, 40), at(20), "Sketching on the square", SQUARE_SKETCH, LINES.square),
    ],
    weekend: [
      block(at(11), at(13, 30), "Hanging out", SQUARE_SIT, LINES.square),
      block(at(13, 30), at(17, 30), "Studying in the library", LIBRARY, LINES.library),
    ],
  },
  {
    id: "luca",
    name: "Luca",
    role: "Student",
    look: "locs-beard",
    entry: { x: 0.5, z: -22.4 },
    weekdays: [
      block(at(10), at(13), "Studying in the library", LIBRARY, LINES.library),
      block(at(13), at(14, 10), "Lunch", CAFE_BREAK, LINES.lunch),
      block(at(14, 10), at(17), "At a lecture", LECTURE, LINES.lecture),
      block(at(17), at(21), "Hanging out", SQUARE_SIT, LINES.square),
    ],
    weekend: [
      block(at(15), at(20), "Sketching on the square", SQUARE_SKETCH, LINES.square),
    ],
  },
];

export const findNpc = (id: string): NpcDefinition | undefined => NPCS.find((npc) => npc.id === id);

/** The NPC behind a session id, or undefined for players. */
export const npcOfSession = (sessionId: string): NpcDefinition | undefined =>
  isNpcSessionId(sessionId) ? findNpc(sessionId.slice(NPC_SESSION_PREFIX.length)) : undefined;

/** What the NPC should be doing at this game minute, or null when it is away (not on the square). */
export function npcBlockAt(npc: NpcDefinition, gameMinute: number): NpcBlock | null {
  const weekend = weekdayOf(gameMinute) >= 5;
  const minute = ((Math.floor(gameMinute) % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  return (weekend ? npc.weekend : npc.weekdays).find((b) => minute >= b.from && minute < b.to) ?? null;
}

const hash = (text: string): number => [...text].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);

/** The block's places in this NPC's order for this game hour: the same answer for the same hour, a different start each hour and NPC. */
export function npcPlacesInOrder(npc: NpcDefinition, block: NpcBlock, gameMinute: number): NpcPlace[] {
  const places = [...block.places];
  if (places.length < 2) return places;
  const turn = (hash(npc.id) + Math.floor(gameMinute / 60)) % places.length;
  return [...places.slice(turn), ...places.slice(0, turn)];
}

/** What the NPC says to this greeter today (deterministic). */
export function npcGreetingLine(block: NpcBlock, gameMinute: number, greeterId: string): string {
  const day = Math.floor(gameMinute / MINUTES_PER_DAY);
  return block.lines[(day + hash(greeterId)) % block.lines.length]!;
}

/** Free sitting places in an area (not standing spots, not staff spots). */
export function freeSeatsForPlayers(layout: WorldLayout, occupancy: SeatOccupancy): number {
  let free = 0;
  for (const item of layout.interactables) {
    for (const seat of item.seats) if (seat.pose !== "stand" && seat.use !== "staff" && !occupancy.has(seat.id)) free++;
  }
  return free;
}

/**
 * Whether an NPC may use this object now without crowding players out:
 * a seat only if `NPC_CONFIG.seatsKeptFree` seats stay free in the area
 * afterwards; a standing place (a door, the café counter) only if another
 * spot of the same kind stays free for a player.
 */
export function npcMayUse(layout: WorldLayout, occupancy: SeatOccupancy, item: Interactable, action: NpcAction | "enter"): boolean {
  if (action === "enter" || action === "work") {
    const spots = item.seats.filter((s) => s.pose === "stand" && (action === "work" ? s.use === "staff" : s.use !== "staff"));
    return spots.filter((s) => !occupancy.has(s.id)).length >= 2;
  }
  const free = item.seats.filter((s) => s.pose !== "stand" && s.use !== "staff" && !occupancy.has(s.id)).length;
  return free >= 1 && freeSeatsForPlayers(layout, occupancy) - 1 >= NPC_CONFIG.seatsKeptFree;
}

/** How close an NPC must be to its leaving point to leave the square. */
export const NPC_LEAVE_DISTANCE = INTERACTION_CONFIG.arrivalTolerance * 4;
