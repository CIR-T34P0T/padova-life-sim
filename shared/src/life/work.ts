// Work rules (M7): which grade a character works at, when the workplace is
// open, and whether a shift may start. Pure functions; the server decides
// with them and the client uses them only to label menus and the panel.
// Design: docs/GAME_DESIGN.md "Work (M7)".

import { MINUTES_PER_DAY, gameDayOf } from "./clock.ts";
import { JOBS, JOB_IDS, NEEDS_CONFIG, type JobDefinition, type JobGrade, type JobId, type Needs, type SkillId } from "./config.ts";

export const isJobId = (value: unknown): value is JobId => typeof value === "string" && (JOB_IDS as readonly string[]).includes(value);

/** A character's job as the rules see it. `shiftsDay` is the game day `shiftsToday` counts. */
export interface WorkState {
  jobId: JobId | null;
  shiftsDay: number;
  shiftsToday: number;
}

/** Why a shift can't start now (shown to the player as friendly text). */
export type ShiftRefusal = "not_employed" | "closed" | "shift_limit" | "too_tired";

/** Minute of the day, 0–1439, of a game minute. */
export function minuteOfDay(gameMinute: number): number {
  return ((Math.floor(gameMinute) % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
}

/** "06:00" for a minute of the day. */
export function formatTimeOfDay(minute: number): string {
  const m = ((Math.floor(minute) % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/** True while shifts can start (from opening until closing time). */
export function isOpen(job: JobDefinition, gameMinute: number): boolean {
  const minute = minuteOfDay(gameMinute);
  return minute >= job.opensAt && minute < job.closesAt;
}

/** The highest grade whose requirement these skill levels meet (the first grade has none). */
export function gradeFor(job: JobDefinition, levels: Partial<Record<SkillId, number>>): JobGrade {
  let best = job.grades[0]!;
  for (const grade of job.grades) {
    if (!grade.requires || (levels[grade.requires.skill] ?? 0) >= grade.requires.level) best = grade;
  }
  return best;
}

/** The next grade above the current one, or null at the top. */
export function nextGradeFor(job: JobDefinition, levels: Partial<Record<SkillId, number>>): JobGrade | null {
  const current = job.grades.indexOf(gradeFor(job, levels));
  return job.grades[current + 1] ?? null;
}

/** Completed shifts on the game day of `gameMinute` (a new day starts at zero). */
export function shiftsOn(work: Pick<WorkState, "shiftsDay" | "shiftsToday">, gameMinute: number): number {
  return work.shiftsDay === gameDayOf(gameMinute) ? work.shiftsToday : 0;
}

/** Why a shift can't start now, or null when it can. The same rule runs on the server and in menus. */
export function shiftRefusal(work: WorkState, gameMinute: number, needs: Pick<Needs, "energy">): ShiftRefusal | null {
  if (!work.jobId) return "not_employed";
  const job = JOBS[work.jobId];
  if (!isOpen(job, gameMinute)) return "closed";
  if (shiftsOn(work, gameMinute) >= job.maxShiftsPerDay) return "shift_limit";
  if (needs.energy < NEEDS_CONFIG.tooTiredEnergy) return "too_tired";
  return null;
}
