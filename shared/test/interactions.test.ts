import { describe, expect, it } from "vitest";
import {
  GAME_CONFIG,
  INTERACTION_CONFIG,
  NavGrid,
  PLAZA_LAYOUT,
  chooseSeat,
  findInteractable,
  findSeat,
  greetApproachPoint,
  isPositionWalkable,
  objectActions,
  parseInteract,
  playerActions,
  validateObjectAction,
  validatePlayerAction,
  type ActorView,
  type Interactable,
  type WorldLayout,
} from "../src/index.ts";

const world = PLAZA_LAYOUT;
const r = GAME_CONFIG.playerRadius;
const bench = findInteractable(world, "bench-1")!;
const desk = findInteractable(world, "desk-1")!;
const actor = (overrides: Partial<ActorView> = {}): ActorView => ({
  id: "me",
  x: 0,
  z: 13,
  seatId: "",
  activity: "idle",
  ...overrides,
});
const none = new Map<string, string>();

describe("interactable metadata", () => {
  it("gives every interactable a matching obstacle and unique, stable seat ids", () => {
    const seatIds = new Set<string>();
    for (const item of world.interactables) {
      expect(world.obstacles.some((o) => o.id === item.id)).toBe(true);
      expect(item.seats.length).toBeGreaterThan(0);
      for (const seat of item.seats) {
        expect(seat.id.startsWith(`${item.id}/`)).toBe(true);
        expect(seatIds.has(seat.id)).toBe(false);
        seatIds.add(seat.id);
      }
    }
  });

  it("puts every approach point on walkable, reachable ground", () => {
    const grid = new NavGrid(world, GAME_CONFIG.navCellSize, r, GAME_CONFIG.maxPathExpansions);
    for (const item of world.interactables) {
      for (const seat of item.seats) {
        expect(isPositionWalkable(world, seat.approach.x, seat.approach.z, r), seat.id).toBe(true);
        expect(grid.findPath(world.spawnPoints[0]!, seat.approach).ok, seat.id).toBe(true);
      }
    }
  });

  it("finds seats by id", () => {
    expect(findSeat(world, "bench-1/seat-a")?.interactable.id).toBe("bench-1");
    expect(findSeat(world, "nope")).toBeNull();
  });
});

describe("menu contents", () => {
  it("offers sit and sketch on a free bench, and sketch/stand once seated there", () => {
    expect(objectActions(bench, actor(), none)).toEqual(["sit", "sketch"]);
    expect(objectActions(bench, actor({ seatId: "bench-1/seat-a", activity: "sitting" }), none)).toEqual(["sketch", "stand"]);
    expect(objectActions(bench, actor({ seatId: "bench-1/seat-a", activity: "sketching" }), none)).toEqual(["stand"]);
  });

  it("offers buying at a free café counter and washing at the fountain; busy when every spot is taken", () => {
    const cafe = findInteractable(world, "cafe-counter")!;
    const fountain = findInteractable(world, "fountain")!;
    expect(objectActions(cafe, actor(), none)).toEqual(["buy", "ask_work"]); // work options: work.test.ts
    expect(objectActions(fountain, actor(), none)).toEqual(["wash"]);
    expect(cafe.seats.every((spot) => spot.pose === "stand")).toBe(true);
    const full = new Map(cafe.seats.map((spot, i) => [spot.id, `p${i}`]));
    expect(objectActions(cafe, actor(), full)).toEqual([]);
    expect(validateObjectAction(world, cafe, actor(), full, "buy", undefined, "panino")).toEqual({ ok: false, reason: "busy" });
  });

  it("only accepts menu items the café sells", () => {
    const cafe = findInteractable(world, "cafe-counter")!;
    expect(validateObjectAction(world, cafe, actor(), none, "buy", undefined, "panino")).toEqual({ ok: true });
    expect(validateObjectAction(world, cafe, actor(), none, "buy", undefined, "caviar")).toEqual({ ok: false, reason: "unknown_item" });
    expect(validateObjectAction(world, cafe, actor(), none, "buy")).toEqual({ ok: false, reason: "unknown_item" });
    expect(validateObjectAction(world, cafe, actor(), none, "sit")).toEqual({ ok: false, reason: "action_not_available" });
  });

  it("offers nothing on a full bench", () => {
    const full = new Map([
      ["bench-1/seat-a", "p1"],
      ["bench-1/seat-b", "p2"],
    ]);
    expect(objectActions(bench, actor(), full)).toEqual([]);
  });

  it("offers study and sit at a desk, and stand while seated", () => {
    expect(objectActions(desk, actor(), none)).toEqual(["study", "sit"]);
    expect(objectActions(desk, actor({ seatId: "desk-1/seat-a", activity: "sitting" }), none)).toEqual(["study", "stand"]);
    expect(objectActions(desk, actor({ seatId: "desk-1/seat-a", activity: "studying" }), none)).toEqual(["stand"]);
  });

  it("never offers actions on yourself or on a disconnected player", () => {
    expect(playerActions(actor(), { id: "me", connected: true })).toEqual([]);
    expect(playerActions(actor(), { id: "other", connected: false })).toEqual([]);
    expect(playerActions(actor(), { id: "other", connected: true })).toEqual(["greet", "chat"]);
  });
});

describe("server validation rules", () => {
  it("accepts valid object actions and rejects ones the object does not offer", () => {
    expect(validateObjectAction(world, bench, actor(), none, "sit")).toEqual({ ok: true });
    expect(validateObjectAction(world, bench, actor(), none, "study")).toEqual({ ok: false, reason: "action_not_available" });
    expect(validateObjectAction(world, bench, actor(), none, "greet")).toEqual({ ok: false, reason: "action_not_available" });
    expect(validateObjectAction(world, bench, actor(), none, "stand")).toEqual({ ok: false, reason: "action_not_available" });
  });

  it("rejects a seat action when every seat is taken", () => {
    const taken = new Map([["desk-1/seat-a", "someone-else"]]);
    expect(validateObjectAction(world, desk, actor(), taken, "sit")).toEqual({ ok: false, reason: "no_free_seat" });
    // The seat you already hold is not "taken" for you.
    const mine = new Map([["desk-1/seat-a", "me"]]);
    expect(validateObjectAction(world, desk, actor(), mine, "sit")).toEqual({ ok: true });
  });

  it("rejects targets that are too far away", () => {
    // desk-1 is about 30 m from the spawn area.
    expect(validateObjectAction(world, desk, actor(), none, "study")).toEqual({ ok: true });
    expect(validateObjectAction(world, desk, actor(), none, "study", 20)).toEqual({ ok: false, reason: "too_far" });
  });

  it("validates greetings: self, offline, unknown, distance and cooldown", () => {
    const other = { id: "other", x: 2, z: 13, connected: true };
    const now = 100_000;
    expect(validatePlayerAction(actor(), other, "greet", undefined, now)).toEqual({ ok: true });
    expect(validatePlayerAction(actor(), null, "greet", undefined, now)).toEqual({ ok: false, reason: "unknown_target" });
    expect(validatePlayerAction(actor(), { ...other, id: "me" }, "greet", undefined, now)).toEqual({ ok: false, reason: "target_is_self" });
    expect(validatePlayerAction(actor(), { ...other, connected: false }, "greet", undefined, now)).toEqual({ ok: false, reason: "target_offline" });
    expect(validatePlayerAction(actor(), other, "sit", undefined, now)).toEqual({ ok: false, reason: "action_not_available" });
    expect(validatePlayerAction(actor(), { ...other, x: 40 }, "greet", undefined, now, 20)).toEqual({ ok: false, reason: "too_far" });
    expect(validatePlayerAction(actor(), other, "greet", now - 1000, now)).toEqual({ ok: false, reason: "too_soon" });
    expect(validatePlayerAction(actor(), other, "greet", now - INTERACTION_CONFIG.greetCooldownMs, now)).toEqual({ ok: true });
  });
});

describe("interaction points", () => {
  it("chooses the nearest free seat", () => {
    const left = actor({ x: -9, z: -6 });
    const right = actor({ x: -3, z: -6 });
    expect(chooseSeat(bench, none, left)?.id).toBe("bench-1/seat-a");
    expect(chooseSeat(bench, none, right)?.id).toBe("bench-1/seat-b");
    expect(chooseSeat(bench, new Map([["bench-1/seat-a", "x"]]), left)?.id).toBe("bench-1/seat-b");
  });

  it("finds a walkable greeting spot near another player, even next to a wall", () => {
    const open = greetApproachPoint(world, { x: 0, z: 13 }, { x: 4, z: 13 })!;
    expect(isPositionWalkable(world, open.x, open.z, r)).toBe(true);
    expect(Math.hypot(open.x - 4, open.z - 13)).toBeCloseTo(INTERACTION_CONFIG.greetStandOff);
    // Target hugging the fountain's south face: the direct spot is inside the fountain.
    const target = { x: 0, z: -0.6 };
    const spot = greetApproachPoint(world, { x: 0, z: -10 }, target)!;
    expect(spot).not.toBeNull();
    expect(isPositionWalkable(world, spot.x, spot.z, r)).toBe(true);
  });

  it("reports a walled-in object as unreachable", () => {
    // A tiny world where a bench sits inside a closed courtyard.
    const walls = [
      { id: "w-n", kind: "building" as const, minX: -6, maxX: 6, minZ: -6, maxZ: -5, height: 3 },
      { id: "w-s", kind: "building" as const, minX: -6, maxX: 6, minZ: 5, maxZ: 6, height: 3 },
      { id: "w-w", kind: "building" as const, minX: -6, maxX: -5, minZ: -6, maxZ: 6, height: 3 },
      { id: "w-e", kind: "building" as const, minX: 5, maxX: 6, minZ: -6, maxZ: 6, height: 3 },
      { id: "caged-bench", kind: "bench" as const, minX: -1, maxX: 1, minZ: -0.3, maxZ: 0.3, height: 0.5 },
    ];
    const caged: Interactable = {
      id: "caged-bench",
      kind: "bench",
      label: "Bench",
      seats: [{ id: "caged-bench/seat-a", x: 0, z: 0.35, rotation: 0, approach: { x: 0, z: 1.2 } }],
    };
    const tiny: WorldLayout = { halfSize: 12, obstacles: walls, interactables: [caged], spawnPoints: [{ x: 9, z: 9 }] };
    const grid = new NavGrid(tiny, GAME_CONFIG.navCellSize, r, GAME_CONFIG.maxPathExpansions);
    expect(validateObjectAction(tiny, caged, actor({ x: 9, z: 9 }), none, "sit")).toEqual({ ok: true });
    expect(grid.findPath({ x: 9, z: 9 }, caged.seats[0]!.approach)).toEqual({ ok: false, reason: "unreachable" });
  });
});

describe("interact message validation", () => {
  it("accepts well-formed requests and rejects everything else", () => {
    expect(parseInteract({ targetKind: "object", targetId: "bench-1", action: "sit" })).toEqual({
      ok: true,
      value: { targetKind: "object", targetId: "bench-1", action: "sit" },
    });
    expect(parseInteract({ targetKind: "object", targetId: "bench-1", action: "fly" }).ok).toBe(false);
    expect(parseInteract({ targetKind: "car", targetId: "bench-1", action: "sit" }).ok).toBe(false);
    expect(parseInteract({ targetKind: "object", targetId: "", action: "sit" }).ok).toBe(false);
    expect(parseInteract({ targetKind: "object", targetId: "x".repeat(65), action: "sit" }).ok).toBe(false);
    expect(parseInteract({ targetKind: "player", targetId: 7, action: "greet" }).ok).toBe(false);
    expect(parseInteract("greet").ok).toBe(false);
  });

  it("validates purchase item ids and request ids", () => {
    const buy = { targetKind: "object", targetId: "cafe-counter", action: "buy" };
    expect(parseInteract({ ...buy, itemId: "panino", requestId: "req_12345678" })).toEqual({
      ok: true,
      value: { ...buy, itemId: "panino", requestId: "req_12345678" },
    });
    expect(parseInteract({ ...buy, itemId: "Panino; DROP TABLE" }).ok).toBe(false);
    expect(parseInteract({ ...buy, itemId: 7 }).ok).toBe(false);
    expect(parseInteract({ ...buy, itemId: "panino", requestId: "short" }).ok).toBe(false);
    expect(parseInteract({ ...buy, itemId: "panino", requestId: "x".repeat(65) }).ok).toBe(false);
    // A price sent by the client is not part of the request at all.
    const parsed = parseInteract({ ...buy, itemId: "panino", priceCents: 1 });
    expect(parsed.ok && "priceCents" in parsed.value).toBe(false);
  });
});
