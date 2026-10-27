// University wording (M8): the timetable in one line, when the next lecture
// or sitting is (game time and real time), and what a lecture desk's menu
// says in each state. Display only; the rules are tested in shared/.

import { NEEDS_CONFIG, TIME_CONFIG, type CourseState, type LifePayload } from "@padova/shared";
import { describe, expect, it } from "vitest";
import { examLine, examTimetable, expectedGrade, lectureLine, lectureTimetable, realWait, whenLabel } from "../src/ui/university.ts";

const at = (day: number, hours: number, minutes = 0) => (day - 1) * 1440 + hours * 60 + minutes;
const MON = 1;
const WED = 3;
const FRI = 5;

const course = (over: Partial<CourseState> = {}): CourseState => ({
  courseId: "city-studies",
  status: "enrolled",
  lecturesAttended: 0,
  studySessions: 0,
  lastLectureKey: null,
  lastSittingKey: null,
  lastResult: null,
  finalGrade: null,
  ...over,
});

function life(gameMinute: number, c: CourseState | null, academicLevel = 0, energy = 80): LifePayload {
  const skill = (level: number) => ({ xp: 0, level, progress: 0 });
  return {
    gameMinute,
    needs: { ...NEEDS_CONFIG.initial, energy },
    mood: { score: 0, level: "okay", reasons: [], events: [] },
    skills: { academic: skill(academicLevel), communication: skill(0), cooking: skill(0), fitness: skill(0), creativity: skill(0) },
    traits: [],
    money: { balanceCents: 0, recent: [] },
    job: null,
    course: c,
    timeScale: TIME_CONFIG.defaultScale,
  };
}

describe("timetable wording", () => {
  it("says the lecture timetable and the exam sittings in one line each", () => {
    expect(lectureTimetable("city-studies")).toBe("Mon–Fri, on the hour 09:00–12:00 and 14:00–17:00");
    expect(examTimetable("city-studies")).toBe("Wed and Sat, 09:00–19:00");
  });

  it("names a moment as today's time, tomorrow, or a weekday", () => {
    expect(whenLabel(at(MON, 8), at(MON, 9))).toBe("09:00");
    expect(whenLabel(at(MON, 20), at(2, 9))).toBe("tomorrow 09:00");
    expect(whenLabel(at(MON, 20), at(WED, 9))).toBe("Wed 09:00");
  });

  it("turns game minutes into real waits at the server's time scale", () => {
    expect(realWait(at(MON, 8), at(MON, 9), 10)).toBe("in about 6 min");
    expect(realWait(at(MON, 8, 59), at(MON, 9), 10)).toBe("in under a minute");
    expect(realWait(at(MON, 9), at(WED, 9), 10)).toBe("in about 5 h");
  });
});

describe("what a lecture desk says", () => {
  it("offers the lecture on now with its late entry, or greys it out with the next one", () => {
    expect(lectureLine(life(at(MON, 9, 5), course()))).toEqual({ text: "09:00 lecture · join until 09:20", disabled: false });
    expect(lectureLine(life(at(MON, 12, 40), course()))).toEqual({ text: "Next lecture 14:00 · in about 8 min", disabled: true });
    expect(lectureLine(life(at(MON, 9, 5), course({ lastLectureKey: "d1-0900" })))).toEqual({ text: "Attended · next 10:00 · in about 6 min", disabled: true });
    expect(lectureLine(life(at(FRI, 18), course())).text).toBe("Next lecture Mon 09:00 · in about 6 h");
    expect(lectureLine(life(at(MON, 9, 5), course(), 0, 2))).toEqual({ text: "Too tired", disabled: true });
  });

  it("offers the exam with the grade it would give now, or the next sitting, or the result of today's", () => {
    expect(examLine(life(at(WED, 10), course({ lecturesAttended: 8, studySessions: 6 })))).toEqual({ text: "Expected 27/30 · 3 min · open until 19:00", disabled: false });
    expect(examLine(life(at(MON, 10), course()))).toEqual({ text: "Next sitting Wed 09:00 · in about 5 h", disabled: true });
    expect(examLine(life(at(WED, 11), course({ lastSittingKey: "d3", lastResult: { grade: 16, passed: false, gameDay: 3 } })))).toEqual({
      text: "Taken today: 16/30 · next sitting Sat 09:00 · in about 7 h",
      disabled: true,
    });
    expect(examLine(life(at(WED, 11), course({ status: "passed", finalGrade: 31 })))).toEqual({ text: "Passed · 30 cum laude", disabled: true });
  });

  it("computes the expected grade from attendance, study and the academic level", () => {
    expect(expectedGrade(life(at(MON, 9), null))).toBeNull();
    expect(expectedGrade(life(at(MON, 9), course()))).toBe(12);
    expect(expectedGrade(life(at(MON, 9), course({ lecturesAttended: 8, studySessions: 6 }), 4))).toBe(31);
  });
});
