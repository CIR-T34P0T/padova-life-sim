// Words for the university (M8), shared by menus and the character panel:
// when the next lecture or exam sitting is, how long that is in real time,
// the timetable in one line, and what a lecture desk offers right now.
// Display only: every rule comes from shared/src/life/university.ts and the
// server decides.

import {
  ACTION_EFFECTS,
  COURSES,
  WEEKDAY_SHORT,
  examGrade,
  examRefusal,
  formatGrade,
  formatTimeOfDay,
  gameDayOf,
  joinableLecture,
  lectureRefusal,
  minuteOfDay,
  nextExamSitting,
  nextLecture,
  openExamSitting,
  realMinutesUntil,
  weekdayOf,
  type CourseId,
  type LifePayload,
} from "@padova/shared";

/** "14:00" today, "tomorrow 09:00", or "Wed 09:00". */
export function whenLabel(now: number, at: number): string {
  const time = formatTimeOfDay(minuteOfDay(at));
  const days = gameDayOf(at) - gameDayOf(now);
  if (days === 0) return time;
  if (days === 1) return `tomorrow ${time}`;
  return `${WEEKDAY_SHORT[weekdayOf(at)]} ${time}`;
}

/** How long until a game moment in real time ("in about 25 min", "in about 3 h"). */
export function realWait(now: number, at: number, timeScale: number): string {
  const minutes = realMinutesUntil(now, at, timeScale);
  if (minutes < 1) return "in under a minute";
  if (minutes < 90) return `in about ${Math.round(minutes)} min`;
  return `in about ${Math.round(minutes / 60)} h`;
}

const dayRange = (days: readonly number[]) => {
  const sorted = [...days].sort((a, b) => a - b);
  const contiguous = sorted.every((d, k) => k === 0 || d === sorted[k - 1]! + 1);
  if (contiguous && sorted.length > 2) return `${WEEKDAY_SHORT[sorted[0]!]}–${WEEKDAY_SHORT[sorted.at(-1)!]}`;
  return sorted.map((d) => WEEKDAY_SHORT[d]).join(" and ");
};

/** "Mon–Fri, on the hour 09:00–12:00 and 14:00–17:00". */
export function lectureTimetable(courseId: CourseId): string {
  const course = COURSES[courseId];
  const runs: number[][] = [];
  for (const start of [...course.lectureStarts].sort((a, b) => a - b)) {
    const run = runs.at(-1);
    if (run && start - run.at(-1)! === 60) run.push(start);
    else runs.push([start]);
  }
  const hours = runs.map((run) => (run.length > 1 ? `${formatTimeOfDay(run[0]!)}–${formatTimeOfDay(run.at(-1)!)}` : formatTimeOfDay(run[0]!))).join(" and ");
  return `${dayRange(course.lectureDays)}, on the hour ${hours}`;
}

/** "Wed and Sat, 09:00–19:00". */
export function examTimetable(courseId: CourseId): string {
  const course = COURSES[courseId];
  return `${dayRange(course.examDays)}, ${formatTimeOfDay(course.examOpensAt)}–${formatTimeOfDay(course.examClosesAt)}`;
}

/** The grade the exam would give with today's attendance, study and academic level. */
export function expectedGrade(life: LifePayload): number | null {
  if (!life.course) return null;
  return examGrade(life.course.courseId, {
    lecturesAttended: life.course.lecturesAttended,
    studySessions: life.course.studySessions,
    academicLevel: life.skills.academic.level,
  }).grade;
}

export interface CourseLine {
  text: string;
  /** True when the action can't start now (the menu greys it out). */
  disabled: boolean;
}

/** The lecture as a lecture desk's menu and the panel describe it now. */
export function lectureLine(life: LifePayload): CourseLine {
  const course = life.course;
  if (!course) return { text: "Enrol first", disabled: true };
  const now = life.gameMinute;
  const next = nextLecture(course.courseId, now);
  const nextText = next ? `${whenLabel(now, next.startsAt)} · ${realWait(now, next.startsAt, life.timeScale)}` : "";
  switch (lectureRefusal(course, now, life.needs)) {
    case "course_passed":
      return { text: "Course passed", disabled: true };
    case "no_lecture_now":
      return { text: `Next lecture ${nextText}`, disabled: true };
    case "already_attended":
      return { text: `Attended · next ${nextText}`, disabled: true };
    case "too_tired":
      return { text: "Too tired", disabled: true };
  }
  const lecture = joinableLecture(course.courseId, now)!;
  return { text: `${formatTimeOfDay(minuteOfDay(lecture.startsAt))} lecture · join until ${formatTimeOfDay(minuteOfDay(lecture.joinUntil))}`, disabled: false };
}

/** The exam as a lecture desk's menu and the panel describe it now. */
export function examLine(life: LifePayload): CourseLine {
  const course = life.course;
  if (!course) return { text: "Enrol first", disabled: true };
  const now = life.gameMinute;
  const next = nextExamSitting(course.courseId, now);
  const nextText = next ? `${whenLabel(now, next.opensAt)} · ${realWait(now, next.opensAt, life.timeScale)}` : "";
  switch (examRefusal(course, now, life.needs)) {
    case "course_passed":
      return { text: `Passed · ${formatGrade(course.finalGrade ?? 0)}`, disabled: true };
    case "no_exam_now":
      return { text: `Next sitting ${nextText}`, disabled: true };
    case "already_sat":
      return { text: `Taken today${course.lastResult ? `: ${formatGrade(course.lastResult.grade)}` : ""} · next sitting ${nextText}`, disabled: true };
    case "too_tired":
      return { text: "Too tired", disabled: true };
  }
  const sitting = openExamSitting(course.courseId, now)!;
  const minutes = Math.round(ACTION_EFFECTS.exam.durationMs / 60_000);
  return { text: `Expected ${formatGrade(expectedGrade(life) ?? 0)} · ${minutes} min · open until ${formatTimeOfDay(minuteOfDay(sitting.closesAt))}`, disabled: false };
}
