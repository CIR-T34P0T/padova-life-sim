// University rules (M8): the weekly timetable, whether a lecture or the exam
// can be started now, and the exam grade. Pure functions; the server decides
// with them and the client uses them only to label menus and the panel.
// Design: docs/GAME_DESIGN.md "University (M8)".

import { dayStartMinute, gameDayOf, weekdayOf } from "./clock.ts";
import { COURSES, COURSE_IDS, NEEDS_CONFIG, type CourseDefinition, type CourseId, type Needs } from "./config.ts";

export const isCourseId = (value: unknown): value is CourseId => typeof value === "string" && (COURSE_IDS as readonly string[]).includes(value);

export type CourseStatus = "enrolled" | "passed";

/** One exam result as its owner sees it. */
export interface ExamResultView {
  grade: number;
  passed: boolean;
  gameDay: number;
}

/** A character's course as the rules (and its owner's panel) see it. Private: sent only to the owner. */
export interface CourseState {
  courseId: CourseId;
  status: CourseStatus;
  /** Completed lectures since enrolling. */
  lecturesAttended: number;
  /** Completed study sessions (any desk or table) since enrolling. */
  studySessions: number;
  /** Key of the latest attended lecture and exam sitting (one of each per slot). */
  lastLectureKey: string | null;
  lastSittingKey: string | null;
  /** The latest exam result, passed or not. */
  lastResult: ExamResultView | null;
  /** The passing grade once the course is passed. */
  finalGrade: number | null;
}

/** One lecture in the timetable, in absolute game minutes. */
export interface LectureSlot {
  /** Stable id of this lecture: game day and start time, e.g. "d12-0900". */
  key: string;
  day: number;
  startsAt: number;
  endsAt: number;
  /** Late entry closes: the lecture can be joined from `startsAt` until this minute. */
  joinUntil: number;
}

/** One exam sitting, in absolute game minutes. */
export interface ExamSitting {
  /** Stable id of this sitting: its game day, e.g. "d13". */
  key: string;
  day: number;
  opensAt: number;
  closesAt: number;
}

/** Why a lecture or the exam can't be started now (shown as friendly text). */
export type CourseRefusal = "not_enrolled" | "course_passed" | "no_lecture_now" | "already_attended" | "no_exam_now" | "already_sat" | "too_tired";

const pad = (n: number) => String(n).padStart(2, "0");
/** Days searched ahead for the next lecture or sitting (a little over a week). */
const LOOKAHEAD_DAYS = 8;

function lectureOn(course: CourseDefinition, day: number, start: number): LectureSlot {
  const startsAt = dayStartMinute(day) + start;
  return {
    key: `d${day}-${pad(Math.floor(start / 60))}${pad(start % 60)}`,
    day,
    startsAt,
    endsAt: startsAt + course.lectureMinutes,
    joinUntil: startsAt + course.lateEntryMinutes,
  };
}

function sittingOn(course: CourseDefinition, day: number): ExamSitting {
  return { key: `d${day}`, day, opensAt: dayStartMinute(day) + course.examOpensAt, closesAt: dayStartMinute(day) + course.examClosesAt };
}

const hasLectures = (course: CourseDefinition, day: number) => course.lectureDays.includes(weekdayOf(dayStartMinute(day)));
const hasExam = (course: CourseDefinition, day: number) => course.examDays.includes(weekdayOf(dayStartMinute(day)));

/** The lectures of one game day (none at weekends). */
export function lecturesOn(courseId: CourseId, day: number): LectureSlot[] {
  const course = COURSES[courseId];
  return hasLectures(course, day) ? course.lectureStarts.map((start) => lectureOn(course, day, start)) : [];
}

/** The lecture that can be joined now (from its start until late entry closes), or null. */
export function joinableLecture(courseId: CourseId, gameMinute: number): LectureSlot | null {
  return lecturesOn(courseId, gameDayOf(gameMinute)).find((l) => gameMinute >= l.startsAt && gameMinute < l.joinUntil) ?? null;
}

/** The lecture taking place now (from its start until it ends), or null. */
export function lectureInProgress(courseId: CourseId, gameMinute: number): LectureSlot | null {
  return lecturesOn(courseId, gameDayOf(gameMinute)).find((l) => gameMinute >= l.startsAt && gameMinute < l.endsAt) ?? null;
}

/** The next lecture starting after `gameMinute`. */
export function nextLecture(courseId: CourseId, gameMinute: number): LectureSlot | null {
  const today = gameDayOf(gameMinute);
  for (let day = today; day <= today + LOOKAHEAD_DAYS; day++) {
    const next = lecturesOn(courseId, day).find((l) => l.startsAt > gameMinute);
    if (next) return next;
  }
  return null;
}

/** The exam sitting open now, or null. */
export function openExamSitting(courseId: CourseId, gameMinute: number): ExamSitting | null {
  const course = COURSES[courseId];
  const day = gameDayOf(gameMinute);
  if (!hasExam(course, day)) return null;
  const sitting = sittingOn(course, day);
  return gameMinute >= sitting.opensAt && gameMinute < sitting.closesAt ? sitting : null;
}

/** The next exam sitting that opens after `gameMinute`. */
export function nextExamSitting(courseId: CourseId, gameMinute: number): ExamSitting | null {
  const course = COURSES[courseId];
  const today = gameDayOf(gameMinute);
  for (let day = today; day <= today + LOOKAHEAD_DAYS; day++) {
    if (!hasExam(course, day)) continue;
    const sitting = sittingOn(course, day);
    if (sitting.opensAt > gameMinute) return sitting;
  }
  return null;
}

/** Why a lecture can't be joined now, or null when it can. The same rule runs on the server and in menus. */
export function lectureRefusal(course: CourseState | null, gameMinute: number, needs: Pick<Needs, "energy">): CourseRefusal | null {
  if (!course) return "not_enrolled";
  if (course.status === "passed") return "course_passed";
  const lecture = joinableLecture(course.courseId, gameMinute);
  if (!lecture) return "no_lecture_now";
  if (course.lastLectureKey === lecture.key) return "already_attended";
  if (needs.energy < NEEDS_CONFIG.tooTiredEnergy) return "too_tired";
  return null;
}

/** Why the exam can't be started now, or null when it can. One attempt per sitting. */
export function examRefusal(course: CourseState | null, gameMinute: number, needs: Pick<Needs, "energy">): CourseRefusal | null {
  if (!course) return "not_enrolled";
  if (course.status === "passed") return "course_passed";
  const sitting = openExamSitting(course.courseId, gameMinute);
  if (!sitting) return "no_exam_now";
  if (course.lastSittingKey === sitting.key) return "already_sat";
  if (needs.energy < NEEDS_CONFIG.tooTiredEnergy) return "too_tired";
  return null;
}

export interface ExamInputs {
  lecturesAttended: number;
  studySessions: number;
  academicLevel: number;
}

export interface ExamGrade {
  grade: number;
  passed: boolean;
  /** 0–1 before it becomes a grade. */
  score: number;
}

/**
 * The exam grade from attendance, study and academic level: each part counts
 * in full at its target and is weighted, and the score maps linearly from the
 * lowest to the highest grade. Deterministic, so players can see what helps.
 */
export function examGrade(courseId: CourseId, inputs: ExamInputs): ExamGrade {
  const g = COURSES[courseId].grading;
  const part = (value: number, full: number) => Math.min(1, Math.max(0, value) / full);
  const score =
    g.weights.attendance * part(inputs.lecturesAttended, g.lecturesForFull) +
    g.weights.study * part(inputs.studySessions, g.studyForFull) +
    g.weights.level * part(inputs.academicLevel, g.levelForFull);
  const grade = Math.round(g.lowestGrade + (g.highestGrade - g.lowestGrade) * score);
  return { grade, passed: grade >= g.passMark, score };
}

/** "27/30", or "30 cum laude" for the top grade. */
export function formatGrade(grade: number): string {
  return grade > 30 ? "30 cum laude" : `${grade}/30`;
}

/** Game minutes from `gameMinute` until `target` as real minutes at a time scale. */
export function realMinutesUntil(gameMinute: number, target: number, timeScale: number): number {
  return Math.max(0, (target - gameMinute) / timeScale);
}
