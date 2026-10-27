// SQL for relationships, blocks, reports and the story log (M9).
// Like the other repositories, every call is scoped by owners the server
// resolved from authenticated sessions (account id + character id); nothing
// here accepts an account or character id from a client as proof.

import { randomUUID } from "node:crypto";
import {
  RELATIONSHIP_CONFIG,
  SAFETY_CONFIG,
  afterMoment,
  isSharedMomentKind,
  isStoryKind,
  pairOf,
  relationshipLevel,
  type RelationshipView,
  type ReportReason,
  type SharedMomentKind,
  type StoryDetails,
  type StoryEntry,
  type StoryKind,
} from "@padova/shared";
import type { Database, Queryable } from "../db/database.ts";
import type { Owner } from "../profiles/profileRepository.ts";

/** True when every owner's account owns its character (each pair checked on its own). */
async function ownsAll(db: Queryable, owners: readonly Owner[]): Promise<boolean> {
  const { rows } = await db.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM unnest($1::uuid[], $2::uuid[]) AS v(character_id, account_id)
       JOIN characters c ON c.id = v.character_id AND c.account_id = v.account_id`,
    [owners.map((o) => o.characterId), owners.map((o) => o.accountId)],
  );
  return Number(rows[0]?.n ?? 0) === owners.length;
}

// ── Relationships ─────────────────────────────────────────────────────────

export interface MomentInput {
  a: Owner;
  b: Owner;
  kind: SharedMomentKind;
  gameDay: number;
  gameMinute: number;
}

export type MomentResult =
  | { status: "counted" | "capped"; before: number; score: number; firstGameMinute: number }
  | { status: "not_owner" | "same_character" };

/**
 * Records one shared moment between two characters: the pair's row is locked,
 * the moment counts unless this kind already reached its daily cap for the
 * pair, and only the newest moments are kept.
 */
export async function recordMoment(db: Database, input: MomentInput): Promise<MomentResult> {
  if (input.a.characterId === input.b.characterId) return { status: "same_character" };
  return db.transaction(async (tx): Promise<MomentResult> => {
    if (!(await ownsAll(tx, [input.a, input.b]))) return { status: "not_owner" };
    const [low, high] = pairOf(input.a.characterId, input.b.characterId);
    await tx.query(
      `INSERT INTO relationships (character_low, character_high, score, first_game_minute, last_game_minute)
       VALUES ($1, $2, 0, $3, $3) ON CONFLICT (character_low, character_high) DO NOTHING`,
      [low, high, input.gameMinute],
    );
    const row = (
      await tx.query<{ score: number; first_game_minute: number }>(
        `SELECT score, first_game_minute FROM relationships WHERE character_low = $1 AND character_high = $2 FOR UPDATE`,
        [low, high],
      )
    ).rows[0]!;
    const before = Number(row.score);
    const today = Number(
      (
        await tx.query<{ n: number }>(
          `SELECT count(*)::int AS n FROM relationship_events WHERE character_low = $1 AND character_high = $2 AND kind = $3 AND game_day = $4`,
          [low, high, input.kind, input.gameDay],
        )
      ).rows[0]?.n ?? 0,
    );
    const next = afterMoment(before, input.kind, today);
    if (!next.counted) return { status: "capped", before, score: before, firstGameMinute: Number(row.first_game_minute) };
    await tx.query(
      `INSERT INTO relationship_events (id, character_low, character_high, kind, game_day, game_minute) VALUES ($1, $2, $3, $4, $5, $6)`,
      [randomUUID(), low, high, input.kind, input.gameDay, input.gameMinute],
    );
    await tx.query(
      `UPDATE relationships SET score = $3, last_game_minute = $4, updated_at = now() WHERE character_low = $1 AND character_high = $2`,
      [low, high, next.score, input.gameMinute],
    );
    await tx.query(
      `DELETE FROM relationship_events
        WHERE character_low = $1 AND character_high = $2
          AND id NOT IN (SELECT id FROM relationship_events WHERE character_low = $1 AND character_high = $2
                          ORDER BY game_minute DESC, created_at DESC LIMIT $3)`,
      [low, high, RELATIONSHIP_CONFIG.historyLength],
    );
    return { status: "counted", before, score: next.score, firstGameMinute: Number(row.first_game_minute) };
  });
}

/** The viewer's relationship with another character, or null without one ("not_owner" if the viewer isn't theirs). */
export async function loadRelationship(db: Queryable, viewer: Owner, otherCharacterId: string): Promise<RelationshipView | null | "not_owner"> {
  if (!(await ownsAll(db, [viewer]))) return "not_owner";
  if (viewer.characterId === otherCharacterId) return null;
  const [low, high] = pairOf(viewer.characterId, otherCharacterId);
  const row = (
    await db.query<{ score: number; first_game_minute: number }>(
      `SELECT score, first_game_minute FROM relationships WHERE character_low = $1 AND character_high = $2`,
      [low, high],
    )
  ).rows[0];
  if (!row) return null;
  const events = await db.query<{ kind: string; game_minute: number }>(
    `SELECT kind, game_minute FROM relationship_events WHERE character_low = $1 AND character_high = $2
      ORDER BY game_minute DESC, created_at DESC LIMIT $3`,
    [low, high, RELATIONSHIP_CONFIG.recentShown],
  );
  const score = Number(row.score);
  const level = relationshipLevel(score);
  return {
    score,
    level: level.id,
    label: level.label,
    sinceGameMinute: Number(row.first_game_minute),
    recent: events.rows.filter((e) => isSharedMomentKind(e.kind)).map((e) => ({ kind: e.kind as SharedMomentKind, gameMinute: Number(e.game_minute) })),
  };
}

// ── Blocks ────────────────────────────────────────────────────────────────

export interface BlockRow {
  id: string;
  blockedAccount: string;
  name: string;
  createdAt: Date;
}

/** An account's blocks, newest first. */
export async function listBlocks(db: Queryable, accountId: string): Promise<BlockRow[]> {
  const { rows } = await db.query<{ id: string; blocked_account: string; blocked_name: string; created_at: Date | string }>(
    `SELECT id, blocked_account, blocked_name, created_at FROM blocks WHERE blocker_account = $1 ORDER BY created_at DESC LIMIT $2`,
    [accountId, SAFETY_CONFIG.maxBlocks],
  );
  return rows.map((r) => ({ id: r.id, blockedAccount: r.blocked_account, name: r.blocked_name, createdAt: new Date(r.created_at) }));
}

/** Blocks another account (its character's name is kept for the list). */
export async function blockAccount(
  db: Database,
  blocker: Owner,
  blocked: Owner,
  blockedName: string,
): Promise<"blocked" | "already_blocked" | "limit_reached" | "not_owner" | "same_account"> {
  if (blocker.accountId === blocked.accountId) return "same_account";
  return db.transaction(async (tx) => {
    if (!(await ownsAll(tx, [blocker, blocked]))) return "not_owner";
    // One block change per blocking account at a time.
    await tx.query(`SELECT 1 FROM accounts WHERE id = $1 FOR UPDATE`, [blocker.accountId]);
    const existing = await tx.query(`SELECT 1 FROM blocks WHERE blocker_account = $1 AND blocked_account = $2`, [blocker.accountId, blocked.accountId]);
    if (existing.rows.length > 0) return "already_blocked";
    const count = Number((await tx.query<{ n: number }>(`SELECT count(*)::int AS n FROM blocks WHERE blocker_account = $1`, [blocker.accountId])).rows[0]?.n ?? 0);
    if (count >= SAFETY_CONFIG.maxBlocks) return "limit_reached";
    await tx.query(
      `INSERT INTO blocks (id, blocker_account, blocked_account, blocked_character_id, blocked_name) VALUES ($1, $2, $3, $4, $5)`,
      [randomUUID(), blocker.accountId, blocked.accountId, blocked.characterId, blockedName.slice(0, 40)],
    );
    return "blocked";
  });
}

/** Lifts one of an account's own blocks; returns the account that was blocked, or null if there was no such block of theirs. */
export async function unblock(db: Queryable, blockerAccount: string, blockId: string): Promise<{ blockedAccount: string } | null> {
  const { rows } = await db.query<{ blocked_account: string }>(
    `DELETE FROM blocks WHERE id = $1 AND blocker_account = $2 RETURNING blocked_account`,
    [blockId, blockerAccount],
  );
  return rows[0] ? { blockedAccount: rows[0].blocked_account } : null;
}

// ── Reports ───────────────────────────────────────────────────────────────

export interface ReportInput {
  reporter: Owner;
  reporterName: string;
  reported: Owner;
  reportedName: string;
  reason: ReportReason;
  note?: string;
  area: string;
  gameMinute: number;
}

/** Stores a report, within the per-hour limit and once per reported account per day. */
export async function insertReport(db: Database, input: ReportInput): Promise<"sent" | "already_reported" | "rate_limited" | "not_owner" | "same_account"> {
  if (input.reporter.accountId === input.reported.accountId) return "same_account";
  return db.transaction(async (tx) => {
    if (!(await ownsAll(tx, [input.reporter, input.reported]))) return "not_owner";
    // One report at a time per reporting account, so the limits can't be raced.
    await tx.query(`SELECT 1 FROM accounts WHERE id = $1 FOR UPDATE`, [input.reporter.accountId]);
    const lastHour = Number(
      (
        await tx.query<{ n: number }>(
          `SELECT count(*)::int AS n FROM reports WHERE reporter_account = $1 AND created_at > now() - make_interval(hours => 1)`,
          [input.reporter.accountId],
        )
      ).rows[0]?.n ?? 0,
    );
    if (lastHour >= SAFETY_CONFIG.reportsPerHour) return "rate_limited";
    const repeat = await tx.query(
      `SELECT 1 FROM reports WHERE reporter_account = $1 AND reported_account = $2 AND created_at > now() - make_interval(hours => $3::int)`,
      [input.reporter.accountId, input.reported.accountId, SAFETY_CONFIG.reportRepeatHours],
    );
    if (repeat.rows.length > 0) return "already_reported";
    await tx.query(
      `INSERT INTO reports (id, reporter_account, reporter_character_id, reporter_name, reported_account, reported_character_id, reported_name, reason, note, area, game_minute)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        randomUUID(),
        input.reporter.accountId,
        input.reporter.characterId,
        input.reporterName.slice(0, 40),
        input.reported.accountId,
        input.reported.characterId,
        input.reportedName.slice(0, 40),
        input.reason,
        input.note ?? null,
        input.area,
        input.gameMinute,
      ],
    );
    return "sent";
  });
}

/** Deletes reports older than the retention period (D-042); returns how many. */
export async function purgeReports(db: Queryable, retentionDays: number = SAFETY_CONFIG.reportRetentionDays): Promise<number> {
  const { rows } = await db.query(`DELETE FROM reports WHERE created_at < now() - make_interval(days => $1::int) RETURNING id`, [retentionDays]);
  return rows.length;
}

export interface ReportRow {
  id: string;
  createdAt: Date;
  reporterName: string;
  reportedName: string;
  reportedAccount: string;
  reason: string;
  note: string | null;
  area: string;
  gameMinute: number;
}

/** Recent reports, newest first, for the product owner's command (`npm run reports`). */
export async function listReports(db: Queryable, limit = 50): Promise<ReportRow[]> {
  const { rows } = await db.query<{
    id: string;
    created_at: Date | string;
    reporter_name: string;
    reported_name: string;
    reported_account: string;
    reason: string;
    note: string | null;
    area: string;
    game_minute: number;
  }>(
    `SELECT id, created_at, reporter_name, reported_name, reported_account, reason, note, area, game_minute
       FROM reports ORDER BY created_at DESC LIMIT $1`,
    [limit],
  );
  return rows.map((r) => ({
    id: r.id,
    createdAt: new Date(r.created_at),
    reporterName: r.reporter_name,
    reportedName: r.reported_name,
    reportedAccount: r.reported_account,
    reason: r.reason,
    note: r.note,
    area: r.area,
    gameMinute: Number(r.game_minute),
  }));
}

// ── Story log ─────────────────────────────────────────────────────────────

export interface StoryInput {
  /** Makes the write idempotent per character, e.g. "first_shift" or "exam:city-studies:d13". */
  key: string;
  kind: StoryKind;
  gameMinute: number;
  details: StoryDetails;
}

/** Adds an event to the owner's story; false when it was already there (same key) or not theirs. */
export async function addStoryEvent(db: Queryable, owner: Owner, event: StoryInput): Promise<boolean> {
  const { rows } = await db.query(
    `INSERT INTO story_events (id, character_id, event_key, kind, game_minute, details)
       SELECT $1, c.id, $4, $5, $6, $7::jsonb FROM characters c WHERE c.id = $2 AND c.account_id = $3
     ON CONFLICT (character_id, event_key) DO NOTHING
     RETURNING id`,
    [randomUUID(), owner.characterId, owner.accountId, event.key.slice(0, 80), event.kind, event.gameMinute, JSON.stringify(event.details)],
  );
  return rows.length > 0;
}

/** The owner's most recent story events, newest first, or null when not theirs. */
export async function recentStory(db: Queryable, owner: Owner, limit: number): Promise<StoryEntry[] | null> {
  if (!(await ownsAll(db, [owner]))) return null;
  const { rows } = await db.query<{ kind: string; game_minute: number; details: unknown }>(
    `SELECT kind, game_minute, details FROM story_events WHERE character_id = $1 ORDER BY game_minute DESC, created_at DESC LIMIT $2`,
    [owner.characterId, limit],
  );
  return rows
    .filter((r) => isStoryKind(r.kind))
    .map((r) => ({ kind: r.kind as StoryKind, gameMinute: Number(r.game_minute), details: toDetails(r.details) }));
}

/** Only the known detail fields, with their expected types (rows written by other versions may differ). */
function toDetails(raw: unknown): StoryDetails {
  const value = typeof raw === "string" ? (JSON.parse(raw) as unknown) : raw;
  if (typeof value !== "object" || value === null) return {};
  const record = value as Record<string, unknown>;
  const details: StoryDetails = {};
  if (typeof record.jobId === "string") details.jobId = record.jobId;
  if (typeof record.courseId === "string") details.courseId = record.courseId;
  if (typeof record.grade === "number") details.grade = record.grade;
  if (typeof record.name === "string") details.name = record.name;
  return details;
}
