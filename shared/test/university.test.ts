// University rules (M8): the weekly timetable on the game clock, when a
// lecture or the exam can be started, the grade, and what the notice board
// and the lecture desks offer.

import { describe, expect, it } from "vitest";
import {
  ACTION_EFFECTS,
  AREAS,
  COURSES,
  COURSE_IDS,
  MOOD_EVENTS,
  NEEDS_CONFIG,
  PLAZA_LAYOUT,
  TIME_CONFIG,
  WEEKDAY_SHORT,
  clockOffsetFor,
  examGrade,
  examRefusal,
  findInteractable,
  formatGrade,
  gameMinuteAt,
  isCourseId,
  joinableLecture,
  lectureInProgress,
  lectureRefusal,
  lecturesOn,
  minuteOfDay,
  nextExamSitting,
  nextLecture,
  objectActions,
  openExamSitting,
  realMinutesUntil,
  validateObjectAction,
  weekdayOf,
  type ActorView,
  type CourseState,
} from "../src/index.ts";

const COURSE = "city-studies" as const;
const def = COURSES[COURSE];
/** Absolute game minute of a game day at hh:mm. Day 1 is a Monday. */
const at = (day: number, hours: number, minutes = 0) => (day - 1) * 1440 + hours * 60 + minutes;
const MON = 1;
const TUE = 2;
const WED = 3;
const FRI = 5;
const SAT = 6;
const SUN = 7;
const rested = { energy: 80 };
const enrolled = (over: Partial<CourseState> = {}): CourseState => ({
  courseId: COURSE,
  status: "enrolled",
  lecturesAttended: 0,
  studySessions: 0,
  lastLectureKey: null,
  lastSittingKey: null,
  lastResult: null,
  finalGrade: null,
  ...over,
});

describe("the week on the game clock", () => {
  it("starts on a Monday and repeats every seven game days", () => {
    expect(weekdayOf(at(MON, 9))).toBe(0);
    expect(WEEKDAY_SHORT[weekdayOf(at(WED, 23, 59))]).toBe("Wed");
    expect(WEEKDAY_SHORT[weekdayOf(at(SUN, 0))]).toBe("Sun");
    expect(weekdayOf(at(8, 0))).toBe(0);
    expect(weekdayOf(at(260, 12))).toBe((260 - 1) % 7);
  });

  it("finds the clock offset that shows a weekday and time now, the nearest one (npm run clock, e2e)", () => {
    for (const realMs of [Date.UTC(2026, 9, 27, 0, 9), Date.UTC(2026, 11, 1, 13, 0), TIME_CONFIG.anchorRealMs]) {
      for (let weekday = 0; weekday < 7; weekday++) {
        for (const scale of [TIME_CONFIG.defaultScale, 600]) {
          const offset = clockOffsetFor(realMs, weekday, 9, 30, scale);
          const shown = gameMinuteAt(realMs, scale, offset);
          expect(weekdayOf(shown)).toBe(weekday);
          expect(Math.abs(minuteOfDay(shown) - (9 * 60 + 30))).toBeLessThanOrEqual(1);
          expect(Math.abs(offset)).toBeLessThan(4.5 * 1440);
          expect(Number.isInteger(offset)).toBe(true);
        }
      }
    }
  });
});

describe("the course catalogue", () => {
  it("has a fictional course held in an existing room with lecture desks", () => {
    expect(COURSE_IDS).toEqual(["city-studies"]);
    expect(isCourseId("city-studies")).toBe(true);
    expect(isCourseId("medicine")).toBe(false);
    expect(def.label).not.toMatch(/padova|padua|unipd/i);
    const room = AREAS[def.roomId];
    expect(room?.indoor).toBe(true);
    expect(room!.layout.interactables.filter((i) => i.lecture).length).toBeGreaterThanOrEqual(4);
    // Lecture desks exist only in that room.
    for (const [id, area] of Object.entries(AREAS)) {
      if (id !== def.roomId) expect(area.layout.interactables.some((i) => i.lecture), id).toBe(false);
    }
  });

  it("keeps lectures inside the day, apart, longer than late entry and long enough to attend", () => {
    const attendGameMinutes = (ACTION_EFFECTS.attend.durationMs / 60_000) * TIME_CONFIG.defaultScale;
    const starts = [...def.lectureStarts].sort((a, b) => a - b);
    for (const [k, start] of starts.entries()) {
      expect(start + def.lectureMinutes).toBeLessThanOrEqual(24 * 60);
      if (k > 0) expect(start).toBeGreaterThanOrEqual(starts[k - 1]! + def.lectureMinutes);
    }
    expect(def.lateEntryMinutes).toBeLessThan(def.lectureMinutes);
    // Someone joining at the last moment still finishes before the lecture ends.
    expect(def.lateEntryMinutes + attendGameMinutes).toBeLessThanOrEqual(def.lectureMinutes);
    const examGameMinutes = (ACTION_EFFECTS.exam.durationMs / 60_000) * TIME_CONFIG.defaultScale;
    expect(def.examClosesAt - def.examOpensAt).toBeGreaterThan(examGameMinutes);
    const w = def.grading.weights;
    expect(w.attendance + w.study + w.level).toBeCloseTo(1, 6);
  });

  it("gives the lecture and the exam mood events and academic progress", () => {
    expect(ACTION_EFFECTS.attend.moodEvent).toBe("interesting_lecture");
    expect(ACTION_EFFECTS.attend.skillsOnCompletion.academic).toBeGreaterThan(0);
    expect(ACTION_EFFECTS.exam.skillsOnCompletion.academic).toBeGreaterThan(0);
    expect(MOOD_EVENTS.passed_exam.value).toBeGreaterThan(0);
    expect(MOOD_EVENTS.failed_exam.value).toBeLessThan(0);
  });
});

describe("the timetable", () => {
  it("has eight lectures on weekdays, on the hour with a lunch break, and none at weekends", () => {
    const monday = lecturesOn(COURSE, MON);
    expect(monday.map((l) => l.key)).toEqual(["d1-0900", "d1-1000", "d1-1100", "d1-1200", "d1-1400", "d1-1500", "d1-1600", "d1-1700"]);
    expect(lecturesOn(COURSE, FRI)).toHaveLength(8);
    expect(lecturesOn(COURSE, SAT)).toEqual([]);
    expect(lecturesOn(COURSE, SUN)).toEqual([]);
  });

  it("lets a lecture be joined from its start until late entry closes, and shows it until it ends", () => {
    expect(joinableLecture(COURSE, at(MON, 8, 59))).toBeNull();
    expect(joinableLecture(COURSE, at(MON, 9))?.key).toBe("d1-0900");
    expect(joinableLecture(COURSE, at(MON, 9, 19) + 0.9)?.key).toBe("d1-0900");
    expect(joinableLecture(COURSE, at(MON, 9, 20))).toBeNull();
    expect(lectureInProgress(COURSE, at(MON, 9, 40))?.key).toBe("d1-0900");
    expect(lectureInProgress(COURSE, at(MON, 9, 50))).toBeNull();
    expect(joinableLecture(COURSE, at(MON, 13, 5))).toBeNull();
    expect(joinableLecture(COURSE, at(SAT, 10, 5))).toBeNull();
  });

  it("finds the next lecture, across the lunch break and the weekend", () => {
    expect(nextLecture(COURSE, at(MON, 8))?.key).toBe("d1-0900");
    expect(nextLecture(COURSE, at(MON, 9))?.key).toBe("d1-1000");
    expect(nextLecture(COURSE, at(MON, 12, 30))?.key).toBe("d1-1400");
    expect(nextLecture(COURSE, at(FRI, 17, 30))?.key).toBe("d8-0900");
    expect(nextLecture(COURSE, at(SAT, 12))?.startsAt).toBe(at(8, 9));
  });

  it("opens exam sittings on Wednesdays and Saturdays, 09:00 to 19:00", () => {
    expect(openExamSitting(COURSE, at(WED, 9))?.key).toBe("d3");
    expect(openExamSitting(COURSE, at(WED, 18, 59))?.key).toBe("d3");
    expect(openExamSitting(COURSE, at(WED, 19))).toBeNull();
    expect(openExamSitting(COURSE, at(WED, 8, 59))).toBeNull();
    expect(openExamSitting(COURSE, at(SAT, 12))?.key).toBe("d6");
    expect(openExamSitting(COURSE, at(MON, 12))).toBeNull();
    expect(nextExamSitting(COURSE, at(MON, 12))?.key).toBe("d3");
    expect(nextExamSitting(COURSE, at(WED, 10))?.key).toBe("d6");
    expect(nextExamSitting(COURSE, at(SAT, 10))?.key).toBe("d10");
  });

  it("converts waits into real minutes at the clock's speed", () => {
    expect(realMinutesUntil(at(MON, 8), at(MON, 9), 10)).toBe(6);
    expect(realMinutesUntil(at(MON, 10), at(MON, 9), 10)).toBe(0);
  });
});

describe("when a lecture or the exam can start", () => {
  it("refuses a lecture without an enrolment, after passing, outside late entry, twice, or when exhausted", () => {
    expect(lectureRefusal(null, at(MON, 9, 5), rested)).toBe("not_enrolled");
    expect(lectureRefusal(enrolled({ status: "passed", finalGrade: 25 }), at(MON, 9, 5), rested)).toBe("course_passed");
    expect(lectureRefusal(enrolled(), at(MON, 9, 25), rested)).toBe("no_lecture_now");
    expect(lectureRefusal(enrolled({ lastLectureKey: "d1-0900" }), at(MON, 9, 5), rested)).toBe("already_attended");
    expect(lectureRefusal(enrolled(), at(MON, 9, 5), { energy: NEEDS_CONFIG.tooTiredEnergy - 1 })).toBe("too_tired");
    expect(lectureRefusal(enrolled({ lastLectureKey: "d1-0900" }), at(MON, 10, 5), rested)).toBeNull();
  });

  it("allows one exam attempt per sitting", () => {
    expect(examRefusal(null, at(WED, 10), rested)).toBe("not_enrolled");
    expect(examRefusal(enrolled(), at(TUE, 10), rested)).toBe("no_exam_now");
    expect(examRefusal(enrolled({ lastSittingKey: "d3" }), at(WED, 10), rested)).toBe("already_sat");
    expect(examRefusal(enrolled({ lastSittingKey: "d3" }), at(SAT, 10), rested)).toBeNull();
    expect(examRefusal(enrolled({ status: "passed", finalGrade: 30 }), at(SAT, 10), rested)).toBe("course_passed");
    expect(examRefusal(enrolled(), at(WED, 10), { energy: 2 })).toBe("too_tired");
  });
});

describe("the exam grade", () => {
  const grade = (lecturesAttended: number, studySessions: number, academicLevel: number) => examGrade(COURSE, { lecturesAttended, studySessions, academicLevel });

  it("fails without preparation and gives 30 cum laude for full preparation", () => {
    expect(grade(0, 0, 0)).toMatchObject({ grade: 12, passed: false });
    expect(grade(8, 6, 4)).toMatchObject({ grade: 31, passed: true });
    expect(grade(20, 20, 10).grade).toBe(31);
  });

  it("weighs attendance, study and academic level", () => {
    // 0.45 attendance + 0.35 study = 0.8 → 12 + 19 × 0.8 = 27.2
    expect(grade(8, 6, 0).grade).toBe(27);
    // Half the lectures alone: 12 + 19 × 0.225 = 16.3, not enough
    expect(grade(4, 0, 0)).toMatchObject({ grade: 16, passed: false });
    // Half the lectures and a third of the study: 12 + 19 × 0.342 = 18.49, just the pass mark
    expect(grade(4, 2, 0)).toMatchObject({ grade: 18, passed: true });
  });

  it("never gets worse with more preparation", () => {
    let previous = 0;
    for (let n = 0; n <= 10; n++) {
      const next = grade(n, n, Math.floor(n / 2)).grade;
      expect(next).toBeGreaterThanOrEqual(previous);
      previous = next;
    }
    expect(grade(3, 3, 1).grade).toBeLessThanOrEqual(grade(4, 3, 1).grade);
  });

  it("shows grades on the Italian scale", () => {
    expect(formatGrade(27)).toBe("27/30");
    expect(formatGrade(31)).toBe("30 cum laude");
    expect(formatGrade(16)).toBe("16/30");
  });
});

describe("what the notice board and the desks offer", () => {
  const room = AREAS[def.roomId]!.layout;
  const lectureDesk = room.interactables.find((i) => i.lecture)!;
  const board = findInteractable(PLAZA_LAYOUT, "noticeboard")!;
  const plazaDesk = PLAZA_LAYOUT.interactables.find((i) => i.kind === "desk")!;
  const noSeats = new Map<string, string>();
  const actor = (course: ActorView["course"], x = 0, z = 0): ActorView => ({ id: "me", x, z, seatId: "", activity: "idle", course });
  const near = (item: typeof board, layout = PLAZA_LAYOUT) => {
    const spot = item.seats[0]!.approach;
    return { x: spot.x, z: spot.z, layout };
  };

  it("the square's notice board offers enrolment, refused once enrolled or passed", () => {
    expect(board.kind).toBe("noticeboard");
    expect(objectActions(board, actor(null), noSeats)).toEqual(["enrol"]);
    const { x, z } = near(board);
    expect(validateObjectAction(PLAZA_LAYOUT, board, actor(null, x, z), noSeats, "enrol")).toEqual({ ok: true });
    expect(validateObjectAction(PLAZA_LAYOUT, board, actor({ courseId: COURSE, status: "enrolled" }, x, z), noSeats, "enrol")).toEqual({ ok: false, reason: "already_enrolled" });
    expect(validateObjectAction(PLAZA_LAYOUT, board, actor({ courseId: COURSE, status: "passed" }, x, z), noSeats, "enrol")).toEqual({ ok: false, reason: "course_passed" });
  });

  it("lecture desks offer the lecture and the exam only to enrolled students; other desks never", () => {
    const student = { courseId: COURSE, status: "enrolled" as const };
    expect(objectActions(lectureDesk, actor(null), noSeats)).toEqual(["study", "sit"]);
    expect(objectActions(lectureDesk, actor(student), noSeats)).toEqual(["attend", "exam", "study", "sit"]);
    expect(objectActions(lectureDesk, actor({ courseId: COURSE, status: "passed" }), noSeats)).toEqual(["study", "sit"]);
    expect(objectActions(plazaDesk, actor(student), noSeats)).toEqual(["study", "sit"]);
    const { x, z } = near(lectureDesk, room);
    expect(validateObjectAction(room, lectureDesk, actor(null, x, z), noSeats, "attend")).toEqual({ ok: false, reason: "not_enrolled" });
    expect(validateObjectAction(room, lectureDesk, actor(student, x, z), noSeats, "exam")).toEqual({ ok: true });
    const p = near(plazaDesk);
    expect(validateObjectAction(PLAZA_LAYOUT, plazaDesk, actor(student, p.x, p.z), noSeats, "attend")).toEqual({ ok: false, reason: "action_not_available" });
  });

  it("a student seated in a lecture or the exam can only stand up", () => {
    const seat = lectureDesk.seats[0]!.id;
    const seated = (activity: string): ActorView => ({ id: "me", x: 0, z: 0, seatId: seat, activity, course: { courseId: COURSE, status: "enrolled" } });
    expect(objectActions(lectureDesk, seated("attending"), noSeats)).toEqual(["stand"]);
    expect(objectActions(lectureDesk, seated("exam"), noSeats)).toEqual(["stand"]);
    expect(objectActions(lectureDesk, seated("sitting"), noSeats)).toEqual(["attend", "exam", "study", "stand"]);
  });
});
