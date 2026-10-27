// A place to live (M10): every room type's home is a valid, closed,
// collision-first room whatever is placed in it; every catalogue item fits
// every spot of its category; placement is checked; the student housing's
// door offers renting, going home and moving out; rent follows the weekly
// schedule with a grace period, then a cheaper room or out (Q9); cosiness
// and comfort follow the furniture.

import { describe, expect, it } from "vitest";
import {
  FURNITURE,
  FURNITURE_IDS,
  GAME_CONFIG,
  HOME_DOOR_ID,
  HOME_LINK,
  HOME_TEMPLATES,
  HOUSING_CONFIG,
  HOUSING_DOOR_ID,
  INTERACTION_CONFIG,
  NEEDS_CONFIG,
  NavGrid,
  PLAZA_LAYOUT,
  ROOM_TYPES,
  ROOM_TYPE_IDS,
  cheaperRoomFor,
  cosinessOf,
  findInteractable,
  forSale,
  furnishedSlots,
  homeArea,
  homeAreaId,
  isCosy,
  isHomeArea,
  isPositionWalkable,
  needRates,
  objectActions,
  overdueDeadline,
  parseFurnish,
  parsePlace,
  parsePutAway,
  placementRefusal,
  rentStep,
  rentWeekOf,
  rentWeekStart,
  timedEffectFor,
  validateObjectAction,
  weekdayOf,
  type FurnitureId,
  type Placement,
  type RoomTypeId,
} from "../src/index.ts";

const r = GAME_CONFIG.playerRadius;
const eps = 1e-6;
const area = homeAreaId("0b7a3c52-5d0e-4c55-9a39-2f6a8e9d1c11");
const itemsOf = (category: string) => FURNITURE_IDS.filter((id) => FURNITURE[id].category === category && forSale(id));

/** The fullest home of a type: the dearest piece of its category in every spot. */
const fullest = (roomType: RoomTypeId): Placement[] =>
  HOME_TEMPLATES[roomType].slots.map((s) => ({ slot: s.id, itemId: itemsOf(s.category).sort((a, b) => FURNITURE[b].width * FURNITURE[b].depth - FURNITURE[a].width * FURNITURE[a].depth)[0]! }));

describe.each(ROOM_TYPE_IDS)("home: %s", (roomType) => {
  const template = HOME_TEMPLATES[roomType];
  const furnishings: [string, Placement[]][] = [
    ["empty (the room's own bed)", []],
    ["fully furnished", fullest(roomType)],
    ...itemsOf("seat").map((id): [string, Placement[]] => [`with a ${id}`, template.slots.filter((s) => s.category !== "decor").map((s) => ({ slot: s.id, itemId: s.category === "seat" ? id : "sprung-bed" }))]),
  ];

  it.each(furnishings)("is a closed room where everything can be reached: %s", (_label, placements) => {
    const { layout, floor } = homeArea(area, roomType, placements);
    const grid = new NavGrid(layout, GAME_CONFIG.navCellSize, r, GAME_CONFIG.maxPathExpansions);
    const spawn = layout.spawnPoints[0]!;
    expect(isPositionWalkable(layout, spawn.x, spawn.z, r)).toBe(true);
    // Inside the walls; no two solid boxes overlap.
    for (const o of layout.obstacles) {
      if (o.kind === "wall" || o.kind === "door") continue;
      expect(o.minX >= floor!.minX - eps && o.maxX <= floor!.maxX + eps && o.minZ >= floor!.minZ - eps && o.maxZ <= floor!.maxZ + eps, o.id).toBe(true);
    }
    const all = layout.obstacles;
    for (let i = 0; i < all.length; i++) {
      for (let j = i + 1; j < all.length; j++) {
        const [a, b] = [all[i]!, all[j]!];
        expect(a.minX < b.maxX - eps && b.minX < a.maxX - eps && a.minZ < b.maxZ - eps && b.minZ < a.maxZ - eps, `${a.id} × ${b.id}`).toBe(false);
      }
    }
    for (const [x, z] of [[floor!.minX - 0.6, 0], [floor!.maxX + 0.6, 0], [0, floor!.minZ - 0.6], [0, floor!.maxZ + 0.6]] as const) {
      expect(grid.findPath(spawn, { x, z }).ok, `${x}, ${z}`).toBe(false);
    }
    for (const item of layout.interactables) {
      expect(layout.obstacles.some((o) => o.id === item.id), item.id).toBe(true);
      for (const seat of item.seats) {
        expect(seat.id.startsWith(`${area}/`), seat.id).toBe(true);
        expect(isPositionWalkable(layout, seat.approach.x, seat.approach.z, r), seat.id).toBe(true);
        expect(grid.findPath(spawn, seat.approach).ok, seat.id).toBe(true);
      }
    }
    const ids = layout.obstacles.map((o) => o.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("fits every catalogue item of a spot's category inside that spot", () => {
    for (const s of template.slots) {
      for (const itemId of FURNITURE_IDS.filter((id) => FURNITURE[id].category === s.category)) {
        const piece = homeArea(area, roomType, [{ slot: s.id, itemId }]).layout.obstacles.find((o) => o.id === `home-${s.id}`)!;
        expect(piece.minX >= s.minX - eps && piece.maxX <= s.maxX + eps && piece.minZ >= s.minZ - eps && piece.maxZ <= s.maxZ + eps, `${itemId} in ${s.id}`).toBe(true);
        expect(piece.kind).toBe(FURNITURE[itemId].kind);
      }
    }
  });

  it("has a bed, a desk and a door; seats offer sit, the bed offers sleep, the door leads back to the housing", () => {
    const { layout } = homeArea(area, roomType, fullest(roomType));
    const actor = { id: "p1", x: 0, z: 0, seatId: "", activity: "idle" };
    const bed = findInteractable(layout, "home-bed")!;
    expect(bed).toMatchObject({ kind: "bed", furniture: fullest(roomType).find((p) => p.slot === "bed")!.itemId });
    expect(bed.seats[0]!.pose).toBe("lie");
    expect(objectActions(bed, actor, new Map())).toEqual(["sleep"]);
    expect(objectActions(bed, { ...actor, seatId: bed.seats[0]!.id, activity: "sleeping" }, new Map())).toEqual(["stand"]);
    expect(objectActions(findInteractable(layout, "home-desk")!, actor, new Map())).toEqual(["study", "sit"]);
    const seats = layout.interactables.filter((i) => i.kind === "seat");
    expect(seats).toHaveLength(template.slots.filter((s) => s.category === "seat").length);
    for (const seat of seats) {
      expect(objectActions(seat, actor, new Map())).toEqual(["sit", "sketch"]);
      expect(seat.seats[0]!.comfort).toBe(FURNITURE[seat.furniture as FurnitureId].seatComfort);
    }
    const door = findInteractable(layout, HOME_DOOR_ID)!;
    expect(door.door).toEqual({ to: "plaza", door: HOUSING_DOOR_ID, actionLabel: "Go out to the square" });
    expect(objectActions(door, actor, new Map())).toEqual(["enter"]);
  });

  it("shows the room's own bed until you place yours, and checks what goes where", () => {
    expect(furnishedSlots(roomType, []).find((s) => s.slot.id === "bed")).toMatchObject({ itemId: "room-bed", yours: false });
    expect(placementRefusal(roomType, [], "bed", "foam-bed")).toBeNull();
    expect(placementRefusal(roomType, [], "bed", "armchair")).toBe("wrong_slot");
    expect(placementRefusal(roomType, [], "seat-1", "armchair")).toBeNull();
    expect(placementRefusal(roomType, [{ slot: "seat-1", itemId: "beanbag" }], "seat-1", "armchair")).toBe("slot_taken");
    expect(placementRefusal(roomType, [], "attic", "armchair")).toBe("unknown_slot");
  });
});

describe("room types", () => {
  it("get bigger and dearer, with more spots", () => {
    const [box, single, studio] = ["box-room", "single-room", "studio"] as const;
    expect(ROOM_TYPES[box].rentCents).toBeLessThan(ROOM_TYPES[single].rentCents);
    expect(ROOM_TYPES[single].rentCents).toBeLessThan(ROOM_TYPES[studio].rentCents);
    expect(HOME_TEMPLATES[box].slots.length).toBeLessThan(HOME_TEMPLATES[single].slots.length);
    expect(HOME_TEMPLATES[single].slots.length).toBeLessThan(HOME_TEMPLATES[studio].slots.length);
    for (const id of ROOM_TYPE_IDS) expect(HOME_TEMPLATES[id].slots.filter((s) => s.category === "bed")).toHaveLength(1);
  });

  it("name home areas home/<id>, which never clash with a fixed area", () => {
    expect(isHomeArea(area)).toBe(true);
    expect(isHomeArea("plaza")).toBe(false);
    expect(isHomeArea("hall/lecture-room")).toBe(false);
  });
});

describe("the student housing's door on the square", () => {
  const door = findInteractable(PLAZA_LAYOUT, HOUSING_DOOR_ID)!;
  const actor = { id: "p1", x: door.seats[0]!.approach.x, z: door.seats[0]!.approach.z, seatId: "", activity: "idle" };
  const tenant = { ...actor, home: { roomType: "box-room" as const } };
  const free = new Map<string, string>();

  it("leads home, and can be reached from the square's spawn", () => {
    expect(door.door).toMatchObject({ to: HOME_LINK, door: HOME_DOOR_ID, actionLabel: "Go home" });
    const grid = new NavGrid(PLAZA_LAYOUT, GAME_CONFIG.navCellSize, r, GAME_CONFIG.maxPathExpansions);
    for (const seat of door.seats) expect(grid.findPath(PLAZA_LAYOUT.spawnPoints[0]!, seat.approach).ok, seat.id).toBe(true);
  });

  it("offers renting without a home; going home, changing room and moving out with one", () => {
    expect(objectActions(door, actor, free)).toEqual(["rent"]);
    expect(objectActions(door, tenant, free)).toEqual(["enter", "rent", "move_out"]);
    const check = (who: typeof actor, action: "rent" | "enter" | "move_out", itemId?: string) =>
      validateObjectAction(PLAZA_LAYOUT, door, who, free, action, INTERACTION_CONFIG.maxDistance, itemId);
    expect(check(actor, "rent", "single-room")).toEqual({ ok: true });
    expect(check(actor, "rent", "penthouse")).toEqual({ ok: false, reason: "unknown_item" });
    expect(check(actor, "rent")).toEqual({ ok: false, reason: "unknown_item" });
    expect(check(actor, "enter")).toEqual({ ok: false, reason: "no_home" });
    expect(check(actor, "move_out")).toEqual({ ok: false, reason: "no_home" });
    expect(check(tenant, "rent", "box-room")).toEqual({ ok: false, reason: "same_room" });
    expect(check(tenant, "rent", "studio")).toEqual({ ok: true });
    expect(check(tenant, "enter")).toEqual({ ok: true });
    expect(check(tenant, "move_out")).toEqual({ ok: true });
    // Renting and moving out happen only at the housing.
    const hall = findInteractable(PLAZA_LAYOUT, "hall-door")!;
    expect(validateObjectAction(PLAZA_LAYOUT, hall, tenant, free, "rent", 1000, "studio")).toEqual({ ok: false, reason: "action_not_available" });
  });
});

describe("rent", () => {
  const day = 24 * 60;
  it("runs in weeks from Monday 00:00 (Day 1 is a Monday)", () => {
    expect(rentWeekOf(0)).toBe(0);
    expect(rentWeekOf(7 * day - 1)).toBe(0);
    expect(rentWeekOf(7 * day)).toBe(1);
    expect(weekdayOf(rentWeekStart(3))).toBe(0);
    expect(rentWeekOf(rentWeekStart(3))).toBe(3);
  });

  it("is charged once a week when the money is there; otherwise a notice, a grace period, then a move", () => {
    const now = rentWeekStart(2) + 600;
    const rent = { rentCents: 4_500, paidWeek: 1, overdueSince: null };
    expect(rentStep({ ...rent, paidWeek: 2 }, now, 0)).toBe("paid");
    expect(rentStep(rent, now, 4_500)).toBe("charge");
    expect(rentStep(rent, now, 4_499)).toBe("start_overdue");
    const overdue = { ...rent, overdueSince: now };
    expect(rentStep(overdue, now + 60, 100)).toBe("overdue");
    expect(rentStep(overdue, now + 60, 5_000)).toBe("charge"); // money arrived in time
    expect(overdueDeadline(now)).toBe(now + HOUSING_CONFIG.graceGameMinutes);
    expect(rentStep(overdue, overdueDeadline(now), 100)).toBe("move_cheaper");
    // Weeks away aren't charged: only the current week is ever due.
    expect(rentStep({ ...rent, paidWeek: -5 }, now, 4_500)).toBe("charge");
  });

  it("moves to the dearest cheaper room the character can pay for, or out (never debt)", () => {
    expect(cheaperRoomFor("studio", 10_000)).toBe("single-room");
    expect(cheaperRoomFor("studio", 3_000)).toBe("box-room");
    expect(cheaperRoomFor("studio", 2_000)).toBeNull();
    expect(cheaperRoomFor("single-room", 9_000)).toBe("box-room");
    expect(cheaperRoomFor("box-room", 9_000)).toBeNull();
  });
});

describe("comfort, sleep and cosiness", () => {
  it("restores comfort while sitting, faster on better seats", () => {
    const sitting = { activity: "sitting", moving: false, traits: [] as const };
    expect(needRates({ activity: "idle", moving: false, traits: [] }).comfort).toBe(NEEDS_CONFIG.perGameHour.comfort);
    expect(needRates(sitting).comfort).toBe(NEEDS_CONFIG.sittingComfortPerGameHour);
    expect(needRates({ ...sitting, seatComfort: FURNITURE.armchair.seatComfort }).comfort).toBe(22);
    expect(FURNITURE["wooden-chair"].seatComfort!).toBeLessThan(FURNITURE.beanbag.seatComfort!);
    expect(FURNITURE.beanbag.seatComfort!).toBeLessThan(FURNITURE.armchair.seatComfort!);
  });

  it("sleeps better in a better bed", () => {
    expect(timedEffectFor("sleep")).toMatchObject({ activity: "sleeping", needs: { energy: 50, comfort: 15 }, moodEvent: "well_rested" });
    expect(timedEffectFor("sleep", "room-bed")!.needs).toEqual({ energy: 50, comfort: 15 });
    expect(timedEffectFor("sleep", "sprung-bed")!.needs).toEqual({ energy: 65, comfort: 25 });
    expect(timedEffectFor("sleep", "foam-bed")!.needs).toEqual({ energy: 80, comfort: 35 });
    expect(timedEffectFor("sleep", "armchair")!.needs).toEqual({ energy: 50, comfort: 15 });
  });

  it("counts cosiness from your furniture; the room's own adds none", () => {
    expect(cosinessOf(["room-bed"])).toBe(0);
    expect(cosinessOf(["potted-plant", "floor-lamp"])).toBe(2);
    expect(isCosy(cosinessOf(["potted-plant", "floor-lamp"]))).toBe(false);
    expect(isCosy(cosinessOf(["bookshelf", "armchair"]))).toBe(true);
    // Every catalogue item costs something and does something.
    for (const id of FURNITURE_IDS.filter(forSale)) {
      const item = FURNITURE[id];
      expect(item.priceCents!, id).toBeGreaterThan(0);
      expect(item.cosiness > 0 || item.seatComfort !== undefined || item.sleep !== undefined, id).toBe(true);
    }
  });
});

describe("housing messages", () => {
  const id = "0b7a3c52-5d0e-4c55-9a39-2f6a8e9d1c11";
  it("accept only well-formed requests", () => {
    expect(parseFurnish({ slot: "seat-1", itemId: "armchair", requestId: "req-12345678" })).toEqual({ slot: "seat-1", itemId: "armchair", requestId: "req-12345678" });
    expect(parseFurnish({ slot: "seat-1", itemId: "throne", requestId: "req-12345678" })).toBeNull();
    expect(parseFurnish({ slot: "seat-1", itemId: "armchair" })).toBeNull();
    expect(parseFurnish({ slot: "Seat 1", itemId: "armchair", requestId: "req-12345678" })).toBeNull();
    expect(parsePlace({ slot: "bed", furnitureId: id.toUpperCase() })).toEqual({ slot: "bed", furnitureId: id });
    expect(parsePlace({ slot: "bed", furnitureId: "x" })).toBeNull();
    expect(parsePutAway({ furnitureId: id })).toEqual({ furnitureId: id });
    expect(parsePutAway(null)).toBeNull();
  });
});
