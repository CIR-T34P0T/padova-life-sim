// The world clock (D-021). Game time is a pure function of real time, so the
// server needs no stored state and every room agrees. Clients never compute
// it themselves; they display the minute the server replicates.

import { TIME_CONFIG } from "./config.ts";

export const MINUTES_PER_DAY = 24 * 60;

/**
 * Game minutes (fractional) at a real moment. Minute 480 = 08:00 on Day 1.
 * `offsetMinutes` shifts the whole clock (GAME_CLOCK_OFFSET_MINUTES, for
 * development and tests); it is still a pure function of real time.
 */
export function gameMinuteAt(realMs: number, scale: number = TIME_CONFIG.defaultScale, offsetMinutes = 0): number {
  return TIME_CONFIG.anchorGameMinute + ((realMs - TIME_CONFIG.anchorRealMs) / 60_000) * scale + offsetMinutes;
}

/** Game hours that pass during `realMs` milliseconds of real time. */
export function realMsToGameHours(realMs: number, scale: number = TIME_CONFIG.defaultScale): number {
  return (realMs / 60_000) * scale / 60;
}

/** Day number (Day 1 is the first) of a game minute. */
export function gameDayOf(gameMinute: number): number {
  return Math.floor(gameMinute / MINUTES_PER_DAY) + 1;
}

export interface ClockReading {
  day: number;
  hours: number;
  minutes: number;
  /** "Day 3 · 14:05" */
  label: string;
}

export function readClock(gameMinute: number): ClockReading {
  const whole = Math.floor(gameMinute);
  const ofDay = ((whole % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  const hours = Math.floor(ofDay / 60);
  const minutes = ofDay % 60;
  const day = gameDayOf(whole);
  return { day, hours, minutes, label: `Day ${day} · ${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}` };
}

/** Validates a configured time scale (e.g. from GAME_TIME_SCALE). */
export function parseTimeScale(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === "") return TIME_CONFIG.defaultScale;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < TIME_CONFIG.minScale || value > TIME_CONFIG.maxScale) {
    throw new Error(`GAME_TIME_SCALE must be a number from ${TIME_CONFIG.minScale} to ${TIME_CONFIG.maxScale} (got "${raw}")`);
  }
  return value;
}

/** Validates a configured clock offset in game minutes (GAME_CLOCK_OFFSET_MINUTES); at most a week either way. */
export function parseClockOffset(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === "") return 0;
  const value = Number(raw);
  if (!Number.isInteger(value) || Math.abs(value) > 7 * MINUTES_PER_DAY) {
    throw new Error(`GAME_CLOCK_OFFSET_MINUTES must be a whole number from ${-7 * MINUTES_PER_DAY} to ${7 * MINUTES_PER_DAY} (got "${raw}")`);
  }
  return value;
}
