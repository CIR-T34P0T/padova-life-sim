// Indoor rooms (M7c, D-039): every area is a valid collision-first layout,
// doors come in linked pairs that deliver you onto walkable ground, every
// seat can be reached from the door, and ids are unique across all areas
// (seats and objects share one id space in the server's state).

import { describe, expect, it } from "vitest";
import {
  AREAS,
  AREA_IDS,
  GAME_CONFIG,
  INTERACTION_CONFIG,
  NavGrid,
  PLAZA_AREA,
  doorArrival,
  findArea,
  findInteractable,
  isPositionWalkable,
  objectActions,
  validateObjectAction,
} from "../src/index.ts";

const r = GAME_CONFIG.playerRadius;
const eps = 1e-6;
const rooms = AREA_IDS.filter((id) => AREAS[id]!.indoor);
const doorsOf = (area: string) => AREAS[area]!.layout.interactables.filter((i) => i.kind === "door");

describe("areas", () => {
  it("has the square and the first two rooms: the hall's lecture room and the library's reading room", () => {
    expect(findArea(PLAZA_AREA)?.indoor).toBe(false);
    expect(rooms.sort()).toEqual(["hall/lecture-room", "library/reading-room"]);
    expect(findArea("nowhere")).toBeUndefined();
    expect(findArea("toString")).toBeUndefined();
    for (const id of AREA_IDS) expect(AREAS[id]!.id).toBe(id);
  });

  it("links every door to a door in another area that leads straight back", () => {
    let doors = 0;
    for (const area of AREA_IDS) {
      for (const door of doorsOf(area)) {
        doors++;
        expect(door.door, door.id).toBeDefined();
        expect(door.door!.to).not.toBe(area);
        const other = findInteractable(AREAS[door.door!.to]!.layout, door.door!.door);
        expect(other?.kind, `${area} ${door.id}`).toBe("door");
        expect(other!.door).toMatchObject({ to: area, door: door.id });
      }
    }
    expect(doors).toBe(4); // two pairs
    for (const room of rooms) expect(doorsOf(room)).toHaveLength(1);
  });

  it("delivers you in front of the linked door, on walkable ground, facing away from it", () => {
    for (const area of AREA_IDS) {
      for (const door of doorsOf(area)) {
        const arrival = doorArrival(door.door!)!;
        expect(arrival.area).toBe(door.door!.to);
        expect(isPositionWalkable(AREAS[arrival.area]!.layout, arrival.x, arrival.z, r), `${door.id} → ${arrival.area}`).toBe(true);
        const target = findInteractable(AREAS[arrival.area]!.layout, door.door!.door)!;
        // Turned half a circle from a spot that faces the door.
        expect(Math.abs(Math.cos(arrival.rotation - target.seats[0]!.rotation) + 1)).toBeLessThan(1e-9);
      }
    }
    expect(doorArrival({ to: "nowhere", door: "x", actionLabel: "" })).toBeNull();
    expect(doorArrival({ to: PLAZA_AREA, door: "bench-1", actionLabel: "" })).toBeNull();
  });

  it("uses ids for objects and seats that are unique across all areas", () => {
    const objects = AREA_IDS.flatMap((id) => AREAS[id]!.layout.obstacles.map((o) => o.id));
    const seats = AREA_IDS.flatMap((id) => AREAS[id]!.layout.interactables.flatMap((i) => i.seats.map((s) => s.id)));
    expect(new Set(objects).size).toBe(objects.length);
    expect(new Set(seats).size).toBe(seats.length);
  });
});

describe.each(rooms)("room %s", (id) => {
  const area = AREAS[id]!;
  const { layout, floor } = area;
  const grid = new NavGrid(layout, GAME_CONFIG.navCellSize, r, GAME_CONFIG.maxPathExpansions);
  const entry = doorArrival(doorsOf(id)[0]!.door!.to === PLAZA_AREA ? findInteractable(AREAS[PLAZA_AREA]!.layout, doorsOf(id)[0]!.door!.door)!.door! : doorsOf(id)[0]!.door!)!;

  it("has a floor inside its walls and every object on or around it", () => {
    expect(floor).toBeDefined();
    expect(entry.area).toBe(id);
    for (const o of layout.obstacles) {
      expect(o.minX, o.id).toBeGreaterThanOrEqual(-layout.halfSize);
      expect(o.maxX, o.id).toBeLessThanOrEqual(layout.halfSize);
      expect(o.minZ, o.id).toBeGreaterThanOrEqual(-layout.halfSize);
      expect(o.maxZ, o.id).toBeLessThanOrEqual(layout.halfSize);
      if (o.kind !== "wall" && o.kind !== "door") {
        expect(o.minX >= floor!.minX - eps && o.maxX <= floor!.maxX + eps && o.minZ >= floor!.minZ - eps && o.maxZ <= floor!.maxZ + eps, o.id).toBe(true);
      }
    }
  });

  it("never overlaps two solid boxes (they may only touch)", () => {
    const overlaps: string[] = [];
    const all = layout.obstacles;
    for (let i = 0; i < all.length; i++) {
      for (let j = i + 1; j < all.length; j++) {
        const [a, b] = [all[i]!, all[j]!];
        if (a.minX < b.maxX - eps && b.minX < a.maxX - eps && a.minZ < b.maxZ - eps && b.minZ < a.maxZ - eps) overlaps.push(`${a.id} × ${b.id}`);
      }
    }
    expect(overlaps).toEqual([]);
  });

  it("is closed: nothing walkable outside the walls", () => {
    for (const [x, z] of [[floor!.minX - 0.6, 0], [floor!.maxX + 0.6, 0], [0, floor!.minZ - 0.6], [0, floor!.maxZ + 0.6]] as const) {
      expect(grid.findPath({ x: entry.x, z: entry.z }, { x, z }).ok, `${x}, ${z}`).toBe(false);
    }
  });

  it("lets you reach every seat and the way out from where you arrive", () => {
    for (const item of layout.interactables) {
      expect(layout.obstacles.some((o) => o.id === item.id), item.id).toBe(true);
      for (const seat of item.seats) {
        expect(isPositionWalkable(layout, seat.approach.x, seat.approach.z, r), seat.id).toBe(true);
        expect(grid.findPath({ x: entry.x, z: entry.z }, seat.approach).ok, seat.id).toBe(true);
      }
    }
  });

  it("offers study and sit at its desks, and the way out at its door", () => {
    const actor = { id: "p1", x: entry.x, z: entry.z, seatId: "", activity: "idle" };
    const desks = layout.interactables.filter((i) => i.kind === "desk");
    expect(desks.length).toBeGreaterThanOrEqual(2);
    for (const desk of desks) expect(objectActions(desk, actor, new Map())).toEqual(["study", "sit"]);
    const door = doorsOf(id)[0]!;
    expect(objectActions(door, actor, new Map())).toEqual(["enter"]);
    expect(door.door).toMatchObject({ to: PLAZA_AREA, actionLabel: "Go out to the square" });
    expect(validateObjectAction(layout, door, actor, new Map(), "enter", INTERACTION_CONFIG.maxDistance)).toEqual({ ok: true });
    // Both spots taken: busy.
    const full = new Map(door.seats.map((s, k) => [s.id, `other-${k}`]));
    expect(validateObjectAction(layout, door, actor, full, "enter", INTERACTION_CONFIG.maxDistance)).toEqual({ ok: false, reason: "busy" });
  });
});

describe("doors on the square", () => {
  it("open the university hall and the library from the square, with the menu option 'Go in'", () => {
    const plaza = AREAS[PLAZA_AREA]!.layout;
    const grid = new NavGrid(plaza, GAME_CONFIG.navCellSize, r, GAME_CONFIG.maxPathExpansions);
    for (const [id, to] of [["hall-door", "hall/lecture-room"], ["library-door", "library/reading-room"]] as const) {
      const door = findInteractable(plaza, id)!;
      expect(door).toMatchObject({ kind: "door", door: { to, actionLabel: "Go in" } });
      for (const seat of door.seats) expect(grid.findPath(plaza.spawnPoints[0]!, seat.approach).ok, seat.id).toBe(true);
    }
  });
});
