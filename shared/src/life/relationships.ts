// Relationship and story rules (M9). Pure functions; the server decides with
// them and the client uses them only to label the player card and the panel.
// Design: docs/GAME_DESIGN.md "Relationships (M9)".

import {
  RELATIONSHIP_CONFIG,
  SHARED_MOMENT_KINDS,
  STORY_KINDS,
  type RelationshipLevelId,
  type SharedMomentKind,
  type StoryKind,
} from "./config.ts";

export const isSharedMomentKind = (value: unknown): value is SharedMomentKind =>
  typeof value === "string" && (SHARED_MOMENT_KINDS as readonly string[]).includes(value);

export const isStoryKind = (value: unknown): value is StoryKind => typeof value === "string" && (STORY_KINDS as readonly string[]).includes(value);

/** The level a score belongs to. */
export function relationshipLevel(score: number): { id: RelationshipLevelId; label: string } {
  let level: (typeof RELATIONSHIP_CONFIG.levels)[number] = RELATIONSHIP_CONFIG.levels[0];
  for (const candidate of RELATIONSHIP_CONFIG.levels) if (score >= candidate.from) level = candidate;
  return { id: level.id, label: level.label };
}

const levelIndex = (id: RelationshipLevelId) => RELATIONSHIP_CONFIG.levels.findIndex((l) => l.id === id);

/** True when going from `before` to `after` reaches `levelId` for the first time on this rise. */
export function reachesLevel(before: number, after: number, levelId: RelationshipLevelId): boolean {
  const target = levelIndex(levelId);
  return levelIndex(relationshipLevel(before).id) < target && levelIndex(relationshipLevel(after).id) >= target;
}

/**
 * The score after one shared moment, given how many moments of this kind
 * already counted for this pair today. Over the daily cap it doesn't count.
 */
export function afterMoment(score: number, kind: SharedMomentKind, countedToday: number): { score: number; counted: boolean } {
  if (countedToday >= RELATIONSHIP_CONFIG.dailyCaps[kind]) return { score, counted: false };
  return { score: Math.min(RELATIONSHIP_CONFIG.maxScore, score + RELATIONSHIP_CONFIG.gains[kind]), counted: true };
}

/** A pair of character ids in a fixed order, so each pair has one relationship. */
export function pairOf(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}

/** A relationship as one of its two players sees it. Private to the pair. */
export interface RelationshipView {
  score: number;
  level: RelationshipLevelId;
  label: string;
  /** Game minute of the first shared moment. */
  sinceGameMinute: number;
  /** Most recent shared moments, newest first. */
  recent: { kind: SharedMomentKind; gameMinute: number }[];
}

/** Small details stored with a story event (names are kept as they were at the time). */
export interface StoryDetails {
  jobId?: string;
  courseId?: string;
  grade?: number;
  /** The other character's name, for "became friends". */
  name?: string;
  /** Rooms (M10): the room moved into, and the one left. */
  roomType?: string;
  fromRoomType?: string;
}

/** One event of a character's private story log. */
export interface StoryEntry {
  kind: StoryKind;
  gameMinute: number;
  details: StoryDetails;
}
