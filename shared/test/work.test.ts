// Work rules (M7): grades, opening hours, daily limits, the shift effect, the
// café's staff spots and what the counter offers employees and customers.

import { describe, expect, it } from "vitest";
import {
  ACTION_EFFECTS,
  CAFE_MENU,
  ECONOMY_CONFIG,
  GAME_CONFIG,
  JOBS,
  MOOD_EVENTS,
  NEEDS_CONFIG,
  NavGrid,
  PLAZA_LAYOUT,
  chooseSeat,
  findInteractable,
  formatTimeOfDay,
  gameDayOf,
  gameMinuteAt,
  gradeFor,
  isJobId,
  isOpen,
  isPositionWalkable,
  minuteOfDay,
  nextGradeFor,
  objectActions,
  parseClockOffset,
  parseInteract,
  seatsFor,
  shiftRefusal,
  shiftsOn,
  timedEffectFor,
  validateObjectAction,
  xpForLevel,
  type ActorView,
  type WorkState,
} from "../src/index.ts";

const cafeJob = JOBS.cafe;
const counter = findInteractable(PLAZA_LAYOUT, "cafe-counter")!;
const day3 = 2 * 1440; // 00:00 on Day 3
const at = (hours: number, minutes = 0, day = day3) => day + hours * 60 + minutes;
const actor = (overrides: Partial<ActorView> = {}): ActorView => ({ id: "me", x: 9, z: 13, seatId: "", activity: "idle", ...overrides });
const none = new Map<string, string>();
const employed = (overrides: Partial<WorkState> = {}): WorkState => ({ jobId: "cafe", shiftsDay: gameDayOf(at(10)), shiftsToday: 0, ...overrides });

describe("job catalogue", () => {
  it("has a café job with two grades, wages in whole cents and the counter as workplace", () => {
    expect(cafeJob.workplaceId).toBe("cafe-counter");
    expect(cafeJob.grades.map((g) => [g.label, g.wageCents])).toEqual([
      ["Café assistant", 600],
      ["Barista", 800],
    ]);
    for (const grade of cafeJob.grades) expect(Number.isInteger(grade.wageCents) && grade.wageCents > 0, grade.id).toBe(true);
    expect(cafeJob.grades[0]!.requires).toBeUndefined();
    expect(isJobId("cafe")).toBe(true);
    expect(isJobId("astronaut")).toBe(false);
    expect(isJobId(7)).toBe(false);
  });

  it("decides the grade from communication level: barista from level 2", () => {
    expect(gradeFor(cafeJob, {}).id).toBe("assistant");
    expect(gradeFor(cafeJob, { communication: 1 }).id).toBe("assistant");
    expect(gradeFor(cafeJob, { communication: 2 }).id).toBe("barista");
    expect(gradeFor(cafeJob, { communication: 9, academic: 0 }).id).toBe("barista");
    // Other skills don't count.
    expect(gradeFor(cafeJob, { academic: 10, communication: 0 }).id).toBe("assistant");
    expect(nextGradeFor(cafeJob, { communication: 0 })?.id).toBe("barista");
    expect(nextGradeFor(cafeJob, { communication: 2 })).toBeNull();
    // Level 2 is 300 XP (the number quoted in the design).
    expect(xpForLevel(2)).toBe(300);
  });
});

describe("opening hours", () => {
  it("is open from 06:00 until 23:00 game time, every day", () => {
    expect(isOpen(cafeJob, at(5, 59))).toBe(false);
    expect(isOpen(cafeJob, at(6, 0))).toBe(true);
    expect(isOpen(cafeJob, at(14, 30))).toBe(true);
    expect(isOpen(cafeJob, at(22, 59))).toBe(true);
    expect(isOpen(cafeJob, at(23, 0))).toBe(false);
    expect(isOpen(cafeJob, at(2, 0, 0))).toBe(false); // Day 1, 02:00
    expect(isOpen(cafeJob, at(12, 0, 40 * 1440))).toBe(true);
  });

  it("formats times of day and wraps minutes into one day", () => {
    expect(formatTimeOfDay(cafeJob.opensAt)).toBe("06:00");
    expect(formatTimeOfDay(cafeJob.closesAt)).toBe("23:00");
    expect(formatTimeOfDay(1440 + 65)).toBe("01:05");
    expect(minuteOfDay(at(7, 30))).toBe(450);
    expect(minuteOfDay(-30)).toBe(1410);
  });
});

describe("starting a shift", () => {
  it("is allowed for an employee while open, under the daily limit and not too tired", () => {
    expect(shiftRefusal(employed(), at(10), { energy: 50 })).toBeNull();
  });

  it("is refused with the reason the player sees", () => {
    expect(shiftRefusal({ jobId: null, shiftsDay: 0, shiftsToday: 0 }, at(10), { energy: 50 })).toBe("not_employed");
    expect(shiftRefusal(employed(), at(3), { energy: 50 })).toBe("closed");
    expect(shiftRefusal(employed({ shiftsToday: 4 }), at(10), { energy: 50 })).toBe("shift_limit");
    expect(shiftRefusal(employed(), at(10), { energy: NEEDS_CONFIG.tooTiredEnergy - 0.1 })).toBe("too_tired");
    expect(shiftRefusal(employed(), at(10), { energy: NEEDS_CONFIG.tooTiredEnergy })).toBeNull();
  });

  it("counts shifts per game day: yesterday's shifts don't count today", () => {
    const yesterday = employed({ shiftsDay: gameDayOf(at(10)) - 1, shiftsToday: 4 });
    expect(shiftsOn(yesterday, at(10))).toBe(0);
    expect(shiftRefusal(yesterday, at(10), { energy: 50 })).toBeNull();
    expect(shiftsOn(employed({ shiftsToday: 3 }), at(10))).toBe(3);
    expect(cafeJob.maxShiftsPerDay).toBe(4);
  });
});

describe("the shift effect", () => {
  it("lasts 90 s, tires (energy −8, fun −4), trains communication on completion only and feels good", () => {
    const work = timedEffectFor("work")!;
    expect(work.durationMs).toBe(90_000);
    expect(work.activity).toBe("working");
    expect(work.needs).toEqual({ energy: -8, fun: -4 });
    expect(work.skills).toEqual({});
    expect(work.skillsOnCompletion).toEqual({ communication: 10 });
    expect(work.moodEvent).toBe("good_days_work");
    expect(work.focus).toBe(true);
    expect(MOOD_EVENTS.good_days_work).toEqual({ label: "Good day's work", value: 6, durationGameMinutes: 120 });
    // 90 real seconds are 15 game minutes at the default clock.
    expect((ACTION_EFFECTS.work.durationMs / 60_000) * 10).toBe(15);
  });

  it("keeps money worth earning: the halved allowance plus one shift buys a day of the cheapest food", () => {
    expect(ECONOMY_CONFIG.dailyAllowanceCents).toBe(750);
    const hungerPerGameDay = -NEEDS_CONFIG.perGameHour.hunger * 24;
    const cheapest = Math.min(...CAFE_MENU.filter((item) => item.needs.hunger).map((item) => item.priceCents / item.needs.hunger!));
    const foodPerDay = hungerPerGameDay * cheapest;
    expect(ECONOMY_CONFIG.dailyAllowanceCents).toBeLessThan(foodPerDay); // the allowance alone is not enough…
    expect(ECONOMY_CONFIG.dailyAllowanceCents + cafeJob.grades[0]!.wageCents).toBeGreaterThanOrEqual(foodPerDay); // …one shift makes up the rest
  });
});

describe("the café counter", () => {
  it("has two customer spots in front and two staff spots behind, all walkable and reachable", () => {
    const customer = seatsFor(counter, "buy");
    const staff = seatsFor(counter, "work");
    expect(customer.map((s) => s.id)).toEqual(["cafe-counter/spot-a", "cafe-counter/spot-b"]);
    expect(staff.map((s) => s.id)).toEqual(["cafe-counter/staff-a", "cafe-counter/staff-b"]);
    expect(seatsFor(counter, "ask_work")).toEqual(customer);
    const box = PLAZA_LAYOUT.obstacles.find((o) => o.id === "cafe-counter")!;
    const grid = new NavGrid(PLAZA_LAYOUT, GAME_CONFIG.navCellSize, GAME_CONFIG.playerRadius, GAME_CONFIG.maxPathExpansions);
    for (const spot of staff) {
      expect(spot.use).toBe("staff");
      expect(spot.pose).toBe("stand");
      expect(spot.z).toBeGreaterThan(box.maxZ); // behind the counter (south side)
      expect(spot.rotation).toBeCloseTo(Math.PI); // facing the counter and its customers
      expect(isPositionWalkable(PLAZA_LAYOUT, spot.x, spot.z, GAME_CONFIG.playerRadius), spot.id).toBe(true);
      expect(grid.findPath(PLAZA_LAYOUT.spawnPoints[0]!, spot.approach).ok, spot.id).toBe(true);
    }
    for (const spot of customer) expect(spot.use).toBeUndefined();
  });

  it("offers asking about work to anyone without a job, and a shift to its employees", () => {
    expect(objectActions(counter, actor(), none)).toEqual(["buy", "ask_work"]);
    expect(objectActions(counter, actor({ job: null }), none)).toEqual(["buy", "ask_work"]);
    expect(objectActions(counter, actor({ job: "cafe" }), none)).toEqual(["buy", "work"]);
  });

  it("keeps customers and staff in their own places", () => {
    const customersBusy = new Map([
      ["cafe-counter/spot-a", "p1"],
      ["cafe-counter/spot-b", "p2"],
    ]);
    // Both customer spots taken: an employee can still work, nobody can buy or ask.
    expect(objectActions(counter, actor({ job: "cafe" }), customersBusy)).toEqual(["work"]);
    expect(objectActions(counter, actor(), customersBusy)).toEqual([]);
    const staffBusy = new Map([
      ["cafe-counter/staff-a", "p1"],
      ["cafe-counter/staff-b", "p2"],
    ]);
    // Both staff spots taken: customers are unaffected; a third employee is told it's busy.
    expect(objectActions(counter, actor(), staffBusy)).toEqual(["buy", "ask_work"]);
    expect(objectActions(counter, actor({ job: "cafe" }), staffBusy)).toEqual(["buy"]);
    expect(validateObjectAction(PLAZA_LAYOUT, counter, actor({ job: "cafe" }), staffBusy, "work")).toEqual({ ok: false, reason: "busy" });
    // Choosing a spot never mixes them up.
    expect(chooseSeat(counter, none, actor(), "buy")?.id).toMatch(/\/spot-/);
    expect(chooseSeat(counter, none, actor({ job: "cafe" }), "work")?.id).toMatch(/\/staff-/);
    expect(chooseSeat(counter, staffBusy, actor({ job: "cafe" }), "work")).toBeNull();
    expect(chooseSeat(counter, customersBusy, actor(), "buy")).toBeNull();
  });

  it("validates work requests on the server", () => {
    const ok = { ok: true };
    expect(validateObjectAction(PLAZA_LAYOUT, counter, actor(), none, "ask_work")).toEqual(ok);
    expect(validateObjectAction(PLAZA_LAYOUT, counter, actor({ job: "cafe" }), none, "ask_work")).toEqual({ ok: false, reason: "already_employed" });
    expect(validateObjectAction(PLAZA_LAYOUT, counter, actor({ job: "cafe" }), none, "work")).toEqual(ok);
    expect(validateObjectAction(PLAZA_LAYOUT, counter, actor(), none, "work")).toEqual({ ok: false, reason: "not_employed" });
    const fountain = findInteractable(PLAZA_LAYOUT, "fountain")!;
    expect(validateObjectAction(PLAZA_LAYOUT, fountain, actor({ job: "cafe" }), none, "work")).toEqual({ ok: false, reason: "action_not_available" });
    expect(validateObjectAction(PLAZA_LAYOUT, counter, actor({ job: "cafe" }), none, "work", 1)).toEqual({ ok: false, reason: "too_far" });
  });

  it("accepts the new actions in interact messages", () => {
    expect(parseInteract({ targetKind: "object", targetId: "cafe-counter", action: "work" }).ok).toBe(true);
    expect(parseInteract({ targetKind: "object", targetId: "cafe-counter", action: "ask_work" }).ok).toBe(true);
    expect(parseInteract({ targetKind: "object", targetId: "cafe-counter", action: "quit" }).ok).toBe(false);
  });
});

describe("clock offset (development and tests)", () => {
  it("shifts the whole clock by whole game minutes", () => {
    const t = Date.UTC(2026, 9, 20, 12, 0, 0);
    expect(gameMinuteAt(t, 10, 120) - gameMinuteAt(t, 10)).toBe(120);
    expect(parseClockOffset(undefined)).toBe(0);
    expect(parseClockOffset("")).toBe(0);
    expect(parseClockOffset("-300")).toBe(-300);
    for (const bad of ["1.5", "abc", "20000"]) expect(() => parseClockOffset(bad)).toThrow(/GAME_CLOCK_OFFSET_MINUTES/);
  });
});
