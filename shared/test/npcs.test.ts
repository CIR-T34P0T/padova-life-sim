// Non-player characters (M11): the roster and its schedules are valid data
// (adults, fictional, known looks, ordered blocks, places that exist and
// offer the action, entry points on open ground reachable from the square),
// decisions are deterministic, NPCs keep seats and spots free for players,
// and players can only greet them.

import { describe, expect, it } from "vitest";
import {
  AREAS,
  GAME_CONFIG,
  NPCS,
  NPC_CONFIG,
  NavGrid,
  PLAZA_LAYOUT,
  findInteractable,
  findPreset,
  freeSeatsForPlayers,
  isNpcSessionId,
  isPositionWalkable,
  npcBlockAt,
  npcGreetingLine,
  npcMayUse,
  npcOfSession,
  npcPlacesInOrder,
  npcSessionId,
  objectActions,
  playerActions,
  validatePlayerAction,
} from "../src/index.ts";

const MONDAY = 0;
const SATURDAY = 5;
const minute = (weekday: number, hours: number, minutes = 0, week = 0) => (week * 7 + weekday) * 1440 + hours * 60 + minutes;
const r = GAME_CONFIG.playerRadius;
/** Objects players (and the browser tests) rely on: NPCs leave them alone. */
const PLAYER_FIRST = ["bench-1", "bench-2", "desk-1", "desk-2", "cafe-table-1", "fountain", "noticeboard", "lecture-desk-1a", "lecture-desk-1b", "lecture-desk-2a", "lecture-desk-2b", "lecture-desk-3a", "reading-table-1"];

describe("the NPC roster", () => {
  it("has a few adults with fictional names, a role each, known looks and unique ids", () => {
    expect(NPCS.length).toBeGreaterThanOrEqual(3);
    expect(NPCS.length).toBeLessThanOrEqual(6);
    expect(new Set(NPCS.map((n) => n.id)).size).toBe(NPCS.length);
    for (const npc of NPCS) {
      expect(npc.role.length, npc.id).toBeGreaterThan(0);
      expect(findPreset(npc.look), `${npc.id} look`).toBeDefined();
      expect(npcOfSession(npcSessionId(npc.id))).toBe(npc);
    }
    expect(NPCS.filter((n) => n.job === "cafe").map((n) => n.role)).toEqual(["Barista"]);
  });

  it("names session ids so they can't be taken for players", () => {
    expect(isNpcSessionId(npcSessionId("giulia"))).toBe(true);
    expect(isNpcSessionId("AbC123xyz")).toBe(false);
    expect(npcOfSession("npc-nobody")).toBeUndefined();
  });

  it("has ordered, non-overlapping blocks within the day, each with places and lines", () => {
    for (const npc of NPCS) {
      for (const blocks of [npc.weekdays, npc.weekend]) {
        let end = 0;
        for (const b of blocks) {
          expect(b.from, `${npc.id} ${b.label}`).toBeGreaterThanOrEqual(end);
          expect(b.to).toBeGreaterThan(b.from);
          expect(b.to).toBeLessThanOrEqual(24 * 60);
          expect(b.places.length).toBeGreaterThan(0);
          expect(b.lines.length).toBeGreaterThan(0);
          end = b.to;
        }
        // One stretch per day: a gap would send the NPC off the square and straight back.
        for (let k = 1; k < blocks.length; k++) expect(blocks[k]!.from, `${npc.id}: gap before ${blocks[k]!.label}`).toBe(blocks[k - 1]!.to);
      }
    }
  });

  it("uses only places that exist and offer the action, and leaves the objects players need most alone", () => {
    for (const npc of NPCS) {
      for (const b of [...npc.weekdays, ...npc.weekend]) {
        for (const p of b.places) {
          const area = AREAS[p.area];
          expect(area, `${npc.id}: area ${p.area}`).toBeDefined();
          const item = findInteractable(area!.layout, p.object);
          expect(item, `${npc.id}: ${p.object} in ${p.area}`).toBeDefined();
          const seat = item!.seats[0]!;
          const actor = { id: "npc", x: seat.approach.x, z: seat.approach.z, seatId: "", activity: "idle", job: npc.job ?? null };
          expect(objectActions(item!, actor, new Map()), `${npc.id}: ${p.action} at ${p.object}`).toContain(p.action);
          expect(PLAYER_FIRST, `${npc.id} uses ${p.object}`).not.toContain(p.object);
        }
      }
    }
  });

  it("arrive and leave on open ground at the square's edge, reachable from the square", () => {
    const grid = new NavGrid(PLAZA_LAYOUT, GAME_CONFIG.navCellSize, r, GAME_CONFIG.maxPathExpansions);
    for (const npc of NPCS) {
      expect(isPositionWalkable(PLAZA_LAYOUT, npc.entry.x, npc.entry.z, r), npc.id).toBe(true);
      expect(Math.max(Math.abs(npc.entry.x), Math.abs(npc.entry.z)), npc.id).toBeGreaterThan(PLAZA_LAYOUT.halfSize - 3);
      expect(grid.findPath(PLAZA_LAYOUT.spawnPoints[0]!, npc.entry).ok, npc.id).toBe(true);
    }
  });
});

describe("NPC schedules", () => {
  const giulia = NPCS.find((n) => n.id === "giulia")!;
  const marco = NPCS.find((n) => n.id === "marco")!;

  it("follow the weekday and weekend timetables, and are away outside them", () => {
    expect(npcBlockAt(marco, minute(MONDAY, 8))).toBeNull();
    expect(npcBlockAt(marco, minute(MONDAY, 9, 30))?.label).toBe("At a lecture");
    expect(npcBlockAt(marco, minute(MONDAY, 14))?.label).toBe("Studying in the library");
    expect(npcBlockAt(marco, minute(MONDAY, 23))).toBeNull();
    expect(npcBlockAt(marco, minute(SATURDAY, 9, 30))).toBeNull();
    expect(npcBlockAt(marco, minute(SATURDAY, 11))?.label).toBe("Sketching on the square");
    expect(npcBlockAt(giulia, minute(MONDAY, 7))?.places[0]).toMatchObject({ object: "cafe-counter", action: "work" });
    expect(npcBlockAt(giulia, minute(MONDAY, 13, 10))?.label).toBe("Lunch break");
    // The same weekday in another week: the same plan.
    expect(npcBlockAt(marco, minute(MONDAY, 9, 30, 3))).toBe(npcBlockAt(marco, minute(MONDAY, 9, 30)));
  });

  it("choose places in a fixed order for the hour, turning each hour", () => {
    const b = npcBlockAt(marco, minute(MONDAY, 17))!;
    const first = npcPlacesInOrder(marco, b, minute(MONDAY, 17, 5));
    expect(npcPlacesInOrder(marco, b, minute(MONDAY, 17, 50))).toEqual(first);
    expect(npcPlacesInOrder(marco, b, minute(MONDAY, 18, 5))).not.toEqual(first);
    expect(new Set(first.map((p) => p.object))).toEqual(new Set(b.places.map((p) => p.object)));
  });

  it("answer a greeting with a line of the block, the same one all day for the same greeter", () => {
    const b = npcBlockAt(giulia, minute(MONDAY, 8))!;
    const line = npcGreetingLine(b, minute(MONDAY, 8), "player-1");
    expect(b.lines).toContain(line);
    expect(npcGreetingLine(b, minute(MONDAY, 11), "player-1")).toBe(line);
  });
});

describe("NPCs make room for players", () => {
  const plaza = PLAZA_LAYOUT;
  const room = AREAS["hall/lecture-room"]!.layout;
  const desk = findInteractable(room, "lecture-desk-3b")!;
  const counter = findInteractable(plaza, "cafe-counter")!;
  const door = findInteractable(plaza, "hall-door")!;
  /** Occupies every free seat of the area except `leave`. */
  const fill = (layout: typeof room, leave: number, skip: string[] = []) => {
    const occupancy = new Map<string, string>();
    const seats = layout.interactables.flatMap((i) => i.seats).filter((s) => s.pose !== "stand" && s.use !== "staff" && !skip.includes(s.id));
    for (const seat of seats.slice(0, Math.max(0, seats.length - leave))) occupancy.set(seat.id, "someone");
    return occupancy;
  };

  it("take a seat only if enough seats stay free in the area afterwards", () => {
    // The desk's own two seats stay free in both cases.
    const keep = desk.seats.map((s) => s.id);
    const roomy = fill(room, NPC_CONFIG.seatsKeptFree - 1, keep);
    expect(freeSeatsForPlayers(room, roomy)).toBe(NPC_CONFIG.seatsKeptFree + 1);
    expect(npcMayUse(room, roomy, desk, "study")).toBe(true);
    const tight = fill(room, NPC_CONFIG.seatsKeptFree - 2, keep);
    expect(freeSeatsForPlayers(room, tight)).toBe(NPC_CONFIG.seatsKeptFree);
    expect(npcMayUse(room, tight, desk, "study")).toBe(false);
  });

  it("start work at the counter only while both staff spots are free, and use a door only while both its spots are", () => {
    expect(npcMayUse(plaza, new Map(), counter, "work")).toBe(true);
    expect(npcMayUse(plaza, new Map([["cafe-counter/staff-a", "player"]]), counter, "work")).toBe(false);
    expect(npcMayUse(plaza, new Map(), door, "enter")).toBe(true);
    expect(npcMayUse(plaza, new Map([[door.seats[0]!.id, "player"]]), door, "enter")).toBe(false);
  });

  it("can be greeted, not chatted with", () => {
    const actor = { id: "p1", x: 0, z: 0, seatId: "", activity: "idle" };
    const npc = { id: npcSessionId("giulia"), x: 1, z: 0, connected: true, npc: true };
    expect(playerActions(actor, npc)).toEqual(["greet"]);
    expect(playerActions(actor, { ...npc, npc: false })).toEqual(["greet", "chat"]);
    expect(validatePlayerAction(actor, npc, "greet", undefined, 0).ok).toBe(true);
    expect(validatePlayerAction(actor, npc, "chat", undefined, 0)).toEqual({ ok: false, reason: "action_not_available" });
  });
});
