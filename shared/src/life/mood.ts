// Mood is derived, never stored as a number: needs plus recent events, with
// the reasons listed so players can see why they feel the way they do.

import { MOOD_CONFIG, MOOD_EVENTS, NEED_IDS, type MoodEventId, type MoodLevel, type NeedId, type Needs } from "./config.ts";

export interface ActiveMoodEvent {
  id: MoodEventId;
  /** Game minutes. */
  startedAt: number;
  expiresAt: number;
}

export interface MoodReason {
  label: string;
  /** Contribution to the score, rounded to one decimal. */
  value: number;
}

export interface MoodState {
  score: number;
  level: MoodLevel;
  /** Strongest influences first. */
  reasons: MoodReason[];
}

const LOW_LABELS: Record<NeedId, string> = {
  hunger: "Hungry",
  energy: "Tired",
  hygiene: "Feeling grubby",
  social: "Lonely",
  fun: "Bored",
};

const HIGH_LABELS: Record<NeedId, string> = {
  hunger: "Well fed",
  energy: "Rested",
  hygiene: "Fresh",
  social: "Connected",
  fun: "Having fun",
};

/** Smallest contribution worth listing as a reason. */
const REASON_THRESHOLD = 3;

/** −16 at 0, 0 at 50, +8 at 100: low needs hurt more than high needs help. */
export function needContribution(value: number): number {
  return value >= 50
    ? ((value - 50) / 50) * MOOD_CONFIG.needAtFull
    : ((50 - value) / 50) * MOOD_CONFIG.needAtZero;
}

export function moodLevelOf(score: number): MoodLevel {
  for (const { level, atMost } of MOOD_CONFIG.levels) if (score <= atMost) return level;
  return "great";
}

export function activeMoodEvents(events: readonly ActiveMoodEvent[], gameMinute: number): ActiveMoodEvent[] {
  return events.filter((event) => event.expiresAt > gameMinute && event.id in MOOD_EVENTS);
}

/** Adds an event, or refreshes it if the same kind is already active (no stacking). */
export function addMoodEvent(events: readonly ActiveMoodEvent[], id: MoodEventId, gameMinute: number): ActiveMoodEvent[] {
  const event: ActiveMoodEvent = { id, startedAt: gameMinute, expiresAt: gameMinute + MOOD_EVENTS[id].durationGameMinutes };
  return [...activeMoodEvents(events, gameMinute).filter((existing) => existing.id !== id), event];
}

export function computeMood(needs: Needs, events: readonly ActiveMoodEvent[], gameMinute: number): MoodState {
  const reasons: MoodReason[] = [];
  let needScore = 0;
  for (const need of NEED_IDS) {
    const contribution = needContribution(needs[need]);
    needScore += contribution;
    if (Math.abs(contribution) >= REASON_THRESHOLD) {
      reasons.push({ label: contribution < 0 ? LOW_LABELS[need] : HIGH_LABELS[need], value: round1(contribution) });
    }
  }
  let eventScore = 0;
  for (const event of activeMoodEvents(events, gameMinute)) {
    const definition = MOOD_EVENTS[event.id];
    eventScore += definition.value;
    reasons.push({ label: definition.label, value: definition.value });
  }
  eventScore = Math.max(-MOOD_CONFIG.eventCap, Math.min(MOOD_CONFIG.eventCap, eventScore));
  const score = round1(Math.max(-100, Math.min(100, needScore + eventScore)));
  reasons.sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
  return { score, level: moodLevelOf(score), reasons };
}

export const moodSkillMultiplier = (level: MoodLevel): number => MOOD_CONFIG.skillMultiplier[level];

/** Keeps only well-formed events of known kinds (e.g. from storage). */
export function sanitizeMoodEvents(raw: readonly { id: unknown; startedAt: unknown; expiresAt: unknown }[]): ActiveMoodEvent[] {
  return raw
    .filter(
      (event): event is ActiveMoodEvent =>
        typeof event.id === "string" &&
        event.id in MOOD_EVENTS &&
        Number.isFinite(event.startedAt) &&
        Number.isFinite(event.expiresAt),
    )
    .map((event) => ({ id: event.id, startedAt: Number(event.startedAt), expiresAt: Number(event.expiresAt) }));
}

const round1 = (value: number) => Math.round(value * 10) / 10;
