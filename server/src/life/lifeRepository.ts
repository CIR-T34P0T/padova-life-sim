// SQL for life-simulation data: traits, needs, skills, mood events, money,
// work (M7) and university (M8).
// Like profileRepository.ts, every read and write is scoped by the owning
// account id taken from the authenticated session, never from client input.

import { randomUUID } from "node:crypto";
import {
  NEEDS_CONFIG,
  examGrade,
  type ActiveMoodEvent,
  type CourseId,
  type JobId,
  type Needs,
  type SkillXp,
  type TraitId,
  type TransactionCategory,
  type TransactionDirection,
  type TransactionView,
} from "@padova/shared";
import type { Database, Queryable } from "../db/database.ts";
import type { Owner } from "../profiles/profileRepository.ts";

export interface StoredLife {
  /** Raw stored ids; clean with sanitizeStoredTraits. */
  traits: unknown[];
  /** Raw stored values; clean with sanitizeNeeds. Null if the row is missing. */
  needs: Partial<Record<keyof Needs, unknown>> | null;
  needsSavedAt: Date | null;
  skills: Record<string, unknown>;
  moodEvents: { id: unknown; startedAt: unknown; expiresAt: unknown }[];
  balanceCents: number;
  recent: TransactionView[];
}

/** Everything about a character's life that is saved together with its position. */
export interface LifeSnapshot {
  needs: Needs;
  skills: SkillXp;
  moodEvents: readonly ActiveMoodEvent[];
}

export interface MoneyChange {
  direction: TransactionDirection;
  category: TransactionCategory;
  amountCents: number;
  description: string;
  itemId?: string | null;
  /** Idempotency key: the same key is applied at most once per character. */
  requestKey: string;
  gameMinute: number;
}

export type MoneyChangeResult =
  | { status: "applied" | "duplicate"; transaction: TransactionView; balanceCents: number }
  | { status: "insufficient_funds"; balanceCents: number }
  | { status: "not_owner" };

export interface TransactionRow {
  id: string;
  direction: TransactionDirection;
  category: TransactionCategory;
  amount_cents: number;
  balance_after_cents: number;
  description: string;
  item_id: string | null;
  game_minute: number;
  created_at: Date;
}

export const toView = (row: TransactionRow): TransactionView => ({
  id: row.id,
  direction: row.direction,
  category: row.category,
  amountCents: Number(row.amount_cents),
  balanceAfterCents: Number(row.balance_after_cents),
  description: row.description,
  itemId: row.item_id,
  gameMinute: Number(row.game_minute),
  createdAt: new Date(row.created_at).toISOString(),
});

export const TRANSACTION_COLUMNS = "id, direction, category, amount_cents, balance_after_cents, description, item_id, game_minute, created_at";

/** Writes a new character's starting life data. Runs inside the character-creation transaction. */
export async function insertInitialLife(
  tx: Queryable,
  characterId: string,
  traits: readonly TraitId[],
  startingBalanceCents: number,
  gameMinute: number,
): Promise<void> {
  const n = NEEDS_CONFIG.initial;
  await tx.query(
    `INSERT INTO character_needs (character_id, hunger, energy, hygiene, social, fun, comfort) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [characterId, n.hunger, n.energy, n.hygiene, n.social, n.fun, n.comfort],
  );
  for (const trait of traits) {
    await tx.query(`INSERT INTO character_traits (character_id, trait) VALUES ($1, $2)`, [characterId, trait]);
  }
  await tx.query(`INSERT INTO character_wallets (character_id, balance_cents) VALUES ($1, $2)`, [characterId, startingBalanceCents]);
  if (startingBalanceCents > 0) {
    await tx.query(
      `INSERT INTO wallet_transactions
         (id, character_id, direction, category, amount_cents, balance_after_cents, description, request_key, game_minute)
       VALUES ($1, $2, 'income', 'allowance', $3, $3, 'Starting allowance', 'starting-allowance', $4)`,
      [randomUUID(), characterId, startingBalanceCents, gameMinute],
    );
  }
}

async function owns(db: Queryable, owner: Owner): Promise<boolean> {
  const { rows } = await db.query(`SELECT 1 FROM characters WHERE id = $1 AND account_id = $2`, [owner.characterId, owner.accountId]);
  return rows.length > 0;
}

/** Loads a character's life data, or null when `owner.accountId` does not own it. */
export async function loadLife(db: Queryable, owner: Owner, recentLimit: number): Promise<StoredLife | null> {
  if (!(await owns(db, owner))) return null;
  const id = owner.characterId;
  const [traits, needs, skills, mood, wallet, recent] = await Promise.all([
    db.query<{ trait: string }>(`SELECT trait FROM character_traits WHERE character_id = $1 ORDER BY trait`, [id]),
    db.query<Record<keyof Needs, number> & { updated_at: Date }>(
      `SELECT hunger, energy, hygiene, social, fun, comfort, updated_at FROM character_needs WHERE character_id = $1`,
      [id],
    ),
    db.query<{ skill: string; xp: number }>(`SELECT skill, xp FROM character_skills WHERE character_id = $1`, [id]),
    db.query<{ event: string; started_at: number; expires_at: number }>(
      `SELECT event, started_at, expires_at FROM character_mood_events WHERE character_id = $1`,
      [id],
    ),
    db.query<{ balance_cents: number }>(`SELECT balance_cents FROM character_wallets WHERE character_id = $1`, [id]),
    db.query<TransactionRow>(
      `SELECT ${TRANSACTION_COLUMNS} FROM wallet_transactions WHERE character_id = $1 ORDER BY created_at DESC, id LIMIT $2`,
      [id, recentLimit],
    ),
  ]);
  const needsRow = needs.rows[0];
  return {
    traits: traits.rows.map((row) => row.trait),
    needs: needsRow
      ? { hunger: needsRow.hunger, energy: needsRow.energy, hygiene: needsRow.hygiene, social: needsRow.social, fun: needsRow.fun, comfort: needsRow.comfort }
      : null,
    needsSavedAt: needsRow ? new Date(needsRow.updated_at) : null,
    skills: Object.fromEntries(skills.rows.map((row) => [row.skill, Number(row.xp)])),
    moodEvents: mood.rows.map((row) => ({ id: row.event, startedAt: Number(row.started_at), expiresAt: Number(row.expires_at) })),
    balanceCents: Number(wallet.rows[0]?.balance_cents ?? 0),
    recent: recent.rows.map(toView),
  };
}

/**
 * Saves needs, skills and mood events. Run inside a transaction (with the
 * position save). Returns false, writing nothing, if the owner does not match.
 */
export async function saveLife(tx: Queryable, owner: Owner, life: LifeSnapshot): Promise<boolean> {
  const { needs } = life;
  const { rows } = await tx.query(
    `INSERT INTO character_needs (character_id, hunger, energy, hygiene, social, fun, comfort, updated_at)
       SELECT c.id, $3, $4, $5, $6, $7, $8, now() FROM characters c WHERE c.id = $1 AND c.account_id = $2
     ON CONFLICT (character_id) DO UPDATE
       SET hunger = EXCLUDED.hunger, energy = EXCLUDED.energy, hygiene = EXCLUDED.hygiene,
           social = EXCLUDED.social, fun = EXCLUDED.fun, comfort = EXCLUDED.comfort, updated_at = now()
     RETURNING character_id`,
    [owner.characterId, owner.accountId, needs.hunger, needs.energy, needs.hygiene, needs.social, needs.fun, needs.comfort],
  );
  if (rows.length === 0) return false;
  for (const [skill, xp] of Object.entries(life.skills)) {
    if (!(xp > 0)) continue;
    await tx.query(
      `INSERT INTO character_skills (character_id, skill, xp, updated_at) VALUES ($1, $2, $3, now())
       ON CONFLICT (character_id, skill) DO UPDATE SET xp = EXCLUDED.xp, updated_at = now()`,
      [owner.characterId, skill, xp],
    );
  }
  await tx.query(`DELETE FROM character_mood_events WHERE character_id = $1`, [owner.characterId]);
  for (const event of life.moodEvents) {
    await tx.query(
      `INSERT INTO character_mood_events (character_id, event, started_at, expires_at) VALUES ($1, $2, $3, $4)`,
      [owner.characterId, event.id, event.startedAt, event.expiresAt],
    );
  }
  return true;
}

/**
 * Applies one money change atomically (D-023): locks the wallet row, returns
 * the earlier result if this request key was already applied, refuses
 * anything that would make the balance negative, then writes the ledger row
 * and the new balance together.
 */
export async function applyMoneyChange(db: Database, owner: Owner, change: MoneyChange): Promise<MoneyChangeResult> {
  try {
    return await db.transaction((tx) => applyMoneyChangeIn(tx, owner, change));
  } catch (error) {
    // Two identical requests racing past the lock (should not happen, but the
    // unique key is the final guard): report the one that was stored.
    if (isUniqueViolation(error)) return applyMoneyChange(db, owner, change);
    throw error;
  }
}

/**
 * The body of applyMoneyChange, for use inside a larger transaction that must
 * succeed or fail together with the money change (a wage and its shift, rent
 * and its home, a piece of furniture and its purchase).
 */
export async function applyMoneyChangeIn(tx: Queryable, owner: Owner, change: MoneyChange): Promise<MoneyChangeResult> {
  if (!Number.isInteger(change.amountCents) || change.amountCents <= 0) {
    throw new Error(`Money changes must be a positive whole number of cents (got ${change.amountCents})`);
  }
  const wallet = await tx.query<{ balance_cents: number }>(
    `SELECT w.balance_cents FROM character_wallets w JOIN characters c ON c.id = w.character_id
      WHERE w.character_id = $1 AND c.account_id = $2 FOR UPDATE OF w`,
    [owner.characterId, owner.accountId],
  );
  const row = wallet.rows[0];
  if (!row) return { status: "not_owner" } as const;
  const balance = Number(row.balance_cents);

  const earlier = await tx.query<TransactionRow>(
    `SELECT ${TRANSACTION_COLUMNS} FROM wallet_transactions WHERE character_id = $1 AND request_key = $2`,
    [owner.characterId, change.requestKey],
  );
  if (earlier.rows[0]) return { status: "duplicate", transaction: toView(earlier.rows[0]), balanceCents: balance } as const;

  const next = change.direction === "income" ? balance + change.amountCents : balance - change.amountCents;
  if (next < 0) return { status: "insufficient_funds", balanceCents: balance } as const;

  await tx.query(`UPDATE character_wallets SET balance_cents = $2, updated_at = now() WHERE character_id = $1`, [owner.characterId, next]);
  const inserted = await tx.query<TransactionRow>(
    `INSERT INTO wallet_transactions
       (id, character_id, direction, category, amount_cents, balance_after_cents, item_id, description, request_key, game_minute)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING ${TRANSACTION_COLUMNS}`,
    [
      randomUUID(),
      owner.characterId,
      change.direction,
      change.category,
      change.amountCents,
      next,
      change.itemId ?? null,
      change.description,
      change.requestKey,
      change.gameMinute,
    ],
  );
  return { status: "applied", transaction: toView(inserted.rows[0]!), balanceCents: next } as const;
}

export const isUniqueViolation = (error: unknown) => (error as { code?: string }).code === "23505";

// ── Work (M7) ─────────────────────────────────────────────────────────────

export interface StoredWork {
  /** Raw stored job id (validate with isJobId), or null without a job. */
  jobId: string | null;
  /** Completed shifts on the requested game day. */
  shiftsToday: number;
}

/** A character's job and its shifts on `gameDay`, or null when `owner.accountId` does not own it. */
export async function loadWork(db: Queryable, owner: Owner, gameDay: number): Promise<StoredWork | null> {
  if (!(await owns(db, owner))) return null;
  const [job, shifts] = await Promise.all([
    db.query<{ job: string }>(`SELECT job FROM character_employment WHERE character_id = $1`, [owner.characterId]),
    db.query<{ n: number }>(`SELECT count(*)::int AS n FROM work_shifts WHERE character_id = $1 AND game_day = $2`, [owner.characterId, gameDay]),
  ]);
  return { jobId: job.rows[0]?.job ?? null, shiftsToday: Number(shifts.rows[0]?.n ?? 0) };
}

/** Gives the character a job. One job per character: refused while it has one. */
export async function hireCharacter(db: Queryable, owner: Owner, jobId: JobId, gameMinute: number): Promise<"hired" | "already_employed" | "not_owner"> {
  const { rows } = await db.query(
    `INSERT INTO character_employment (character_id, job, hired_game_minute)
       SELECT c.id, $3, $4 FROM characters c WHERE c.id = $1 AND c.account_id = $2
     ON CONFLICT (character_id) DO NOTHING
     RETURNING character_id`,
    [owner.characterId, owner.accountId, jobId, gameMinute],
  );
  if (rows.length > 0) return "hired";
  return (await owns(db, owner)) ? "already_employed" : "not_owner";
}

/** Ends the character's job. Its shift history and wages stay. */
export async function quitJob(db: Queryable, owner: Owner): Promise<"quit" | "not_employed" | "not_owner"> {
  const { rows } = await db.query(
    `DELETE FROM character_employment e USING characters c
      WHERE e.character_id = c.id AND c.id = $1 AND c.account_id = $2
     RETURNING e.character_id`,
    [owner.characterId, owner.accountId],
  );
  if (rows.length > 0) return "quit";
  return (await owns(db, owner)) ? "not_employed" : "not_owner";
}

export interface CompletedShift {
  /** Server-chosen shift id (a UUID); the wage's ledger key is `wage:<id>`. */
  shiftId: string;
  jobId: JobId;
  gradeId: string;
  gradeLabel: string;
  wageCents: number;
  gameDay: number;
  startedGameMinute: number;
  endedGameMinute: number;
  /** The job's daily limit, enforced again here. */
  maxShiftsPerDay: number;
}

export type ShiftResult =
  | { status: "paid" | "duplicate"; transaction: TransactionView; balanceCents: number; shiftsToday: number }
  | { status: "shift_limit"; shiftsToday: number }
  | { status: "not_employed" }
  | { status: "not_owner" };

/**
 * Records a completed shift and pays its wage in one transaction: either both
 * are written or neither. Safe to repeat: a shift already recorded returns
 * "duplicate" with its original payment. Refuses a shift when the character
 * no longer has that job or the day's limit is already reached.
 */
export async function recordShift(db: Database, owner: Owner, shift: CompletedShift): Promise<ShiftResult> {
  try {
    return await db.transaction(async (tx): Promise<ShiftResult> => {
      // Lock the wallet first: shifts of one character are recorded one at a time.
      const wallet = await tx.query(
        `SELECT 1 FROM character_wallets w JOIN characters c ON c.id = w.character_id
          WHERE w.character_id = $1 AND c.account_id = $2 FOR UPDATE OF w`,
        [owner.characterId, owner.accountId],
      );
      if (wallet.rows.length === 0) return { status: "not_owner" };
      const countToday = async () =>
        Number(
          (await tx.query<{ n: number }>(`SELECT count(*)::int AS n FROM work_shifts WHERE character_id = $1 AND game_day = $2`, [owner.characterId, shift.gameDay]))
            .rows[0]?.n ?? 0,
        );

      const earlier = await tx.query<TransactionRow>(
        `SELECT ${TRANSACTION_COLUMNS.split(", ").map((column) => `t.${column}`).join(", ")}
           FROM work_shifts s JOIN wallet_transactions t ON t.id = s.transaction_id
          WHERE s.id = $1 AND s.character_id = $2`,
        [shift.shiftId, owner.characterId],
      );
      if (earlier.rows[0]) {
        const balance = await tx.query<{ balance_cents: number }>(`SELECT balance_cents FROM character_wallets WHERE character_id = $1`, [owner.characterId]);
        return { status: "duplicate", transaction: toView(earlier.rows[0]), balanceCents: Number(balance.rows[0]!.balance_cents), shiftsToday: await countToday() };
      }

      const job = await tx.query<{ job: string }>(`SELECT job FROM character_employment WHERE character_id = $1`, [owner.characterId]);
      if (job.rows[0]?.job !== shift.jobId) return { status: "not_employed" };
      const before = await countToday();
      if (before >= shift.maxShiftsPerDay) return { status: "shift_limit", shiftsToday: before };

      const paid = await applyMoneyChangeIn(tx, owner, {
        direction: "income",
        category: "wage",
        amountCents: shift.wageCents,
        description: `Wage: ${shift.gradeLabel}`,
        requestKey: `wage:${shift.shiftId}`,
        gameMinute: shift.endedGameMinute,
      });
      if (paid.status !== "applied") throw new Error(`wage for shift ${shift.shiftId} was not applied (${paid.status})`);
      await tx.query(
        `INSERT INTO work_shifts (id, character_id, job, grade, game_day, started_game_minute, ended_game_minute, wage_cents, transaction_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [shift.shiftId, owner.characterId, shift.jobId, shift.gradeId, shift.gameDay, shift.startedGameMinute, shift.endedGameMinute, shift.wageCents, paid.transaction.id],
      );
      return { status: "paid", transaction: paid.transaction, balanceCents: paid.balanceCents, shiftsToday: before + 1 };
    });
  } catch (error) {
    // The same shift recorded twice at once: the second sees the first's result.
    if (isUniqueViolation(error)) return recordShift(db, owner, shift);
    throw error;
  }
}

// ── University (M8) ───────────────────────────────────────────────────────

export interface StoredCourse {
  /** Raw stored course id (validate with isCourseId). */
  courseId: string;
  status: "enrolled" | "passed";
  studySessions: number;
  lecturesAttended: number;
  lastLectureKey: string | null;
  lastSittingKey: string | null;
  lastResult: { grade: number; passed: boolean; gameDay: number } | null;
  finalGrade: number | null;
}

/** A character's courses with attendance and the latest result, or null when `owner.accountId` does not own it. */
export async function loadCourses(db: Queryable, owner: Owner): Promise<StoredCourse[] | null> {
  if (!(await owns(db, owner))) return null;
  const { rows } = await db.query<{
    course: string;
    status: "enrolled" | "passed";
    study_sessions: number;
    final_grade: number | null;
    lectures: number;
    last_lecture: string | null;
    last_sitting: string | null;
    last_grade: number | null;
    last_passed: boolean | null;
    last_day: number | null;
  }>(
    `SELECT e.course, e.status, e.study_sessions, e.final_grade,
            (SELECT count(*)::int FROM lecture_attendance l WHERE l.character_id = e.character_id AND l.course = e.course) AS lectures,
            (SELECT l.lecture_key FROM lecture_attendance l WHERE l.character_id = e.character_id AND l.course = e.course
              ORDER BY l.attended_game_minute DESC LIMIT 1) AS last_lecture,
            a.sitting_key AS last_sitting, a.grade AS last_grade, a.passed AS last_passed, a.game_day AS last_day
       FROM enrolments e
       LEFT JOIN LATERAL (
         SELECT sitting_key, grade, passed, game_day FROM assessments x
          WHERE x.character_id = e.character_id AND x.course = e.course
          ORDER BY x.sat_game_minute DESC LIMIT 1
       ) a ON true
      WHERE e.character_id = $1
      ORDER BY e.enrolled_game_minute`,
    [owner.characterId],
  );
  return rows.map((r) => ({
    courseId: r.course,
    status: r.status,
    studySessions: Number(r.study_sessions),
    lecturesAttended: Number(r.lectures),
    lastLectureKey: r.last_lecture,
    lastSittingKey: r.last_sitting,
    lastResult: r.last_grade === null ? null : { grade: Number(r.last_grade), passed: Boolean(r.last_passed), gameDay: Number(r.last_day) },
    finalGrade: r.final_grade === null ? null : Number(r.final_grade),
  }));
}

/** Enrols the character in a course. Refused when it is already enrolled in (or has passed) that course. */
export async function enrolCharacter(db: Queryable, owner: Owner, courseId: CourseId, gameMinute: number): Promise<"enrolled" | "already_enrolled" | "not_owner"> {
  const { rows } = await db.query(
    `INSERT INTO enrolments (character_id, course, status, enrolled_game_minute)
       SELECT c.id, $3, 'enrolled', $4 FROM characters c WHERE c.id = $1 AND c.account_id = $2
     ON CONFLICT (character_id, course) DO NOTHING
     RETURNING character_id`,
    [owner.characterId, owner.accountId, courseId, gameMinute],
  );
  if (rows.length > 0) return "enrolled";
  return (await owns(db, owner)) ? "already_enrolled" : "not_owner";
}

export interface CompletedLecture {
  courseId: CourseId;
  /** The lecture's key from the timetable (e.g. "d12-0900"): one record per lecture. */
  lectureKey: string;
  gameDay: number;
  endedGameMinute: number;
}

export type LectureResult = { status: "recorded" | "duplicate"; lecturesAttended: number } | { status: "not_enrolled" } | { status: "not_owner" };

/**
 * Records a completed lecture once. Refused unless the character is enrolled
 * (not yet passed). Safe to repeat: a lecture already recorded is "duplicate".
 * The enrolment row is locked, so one character's records never race.
 */
export async function recordLecture(db: Database, owner: Owner, lecture: CompletedLecture): Promise<LectureResult> {
  return db.transaction(async (tx): Promise<LectureResult> => {
    const enrolment = await lockedEnrolment(tx, owner, lecture.courseId);
    if (enrolment === "not_owner" || enrolment === "not_enrolled") return { status: enrolment };
    const already = await tx.query(
      `SELECT 1 FROM lecture_attendance WHERE character_id = $1 AND course = $2 AND lecture_key = $3`,
      [owner.characterId, lecture.courseId, lecture.lectureKey],
    );
    if (already.rows.length > 0) return { status: "duplicate", lecturesAttended: await countLectures(tx, owner, lecture.courseId) };
    if (enrolment.status !== "enrolled") return { status: "not_enrolled" };
    await tx.query(
      `INSERT INTO lecture_attendance (character_id, course, lecture_key, game_day, attended_game_minute) VALUES ($1, $2, $3, $4, $5)`,
      [owner.characterId, lecture.courseId, lecture.lectureKey, lecture.gameDay, lecture.endedGameMinute],
    );
    return { status: "recorded", lecturesAttended: await countLectures(tx, owner, lecture.courseId) };
  });
}

/** Counts one completed study session towards the character's course; the new count, or null when not enrolled. */
export async function recordStudySession(db: Queryable, owner: Owner, courseId: CourseId): Promise<number | null> {
  const { rows } = await db.query<{ study_sessions: number }>(
    `UPDATE enrolments e SET study_sessions = e.study_sessions + 1
       FROM characters c
      WHERE e.character_id = c.id AND c.id = $1 AND c.account_id = $2 AND e.course = $3 AND e.status = 'enrolled'
      RETURNING e.study_sessions`,
    [owner.characterId, owner.accountId, courseId],
  );
  return rows[0] ? Number(rows[0].study_sessions) : null;
}

export interface CompletedExam {
  courseId: CourseId;
  /** The sitting's key from the timetable (e.g. "d13"): one exam per sitting. */
  sittingKey: string;
  gameDay: number;
  endedGameMinute: number;
  /** The character's academic level when the exam ended (kept in memory by the server). */
  academicLevel: number;
}

export interface GradedExam {
  grade: number;
  passed: boolean;
  lecturesAttended: number;
  studySessions: number;
  academicLevel: number;
}

export type ExamResult = ({ status: "graded" | "duplicate" } & GradedExam) | { status: "not_enrolled" } | { status: "not_owner" };

/**
 * Grades a completed exam in one transaction from the stored attendance and
 * study count (examGrade in shared/src/life/university.ts), records it, and
 * marks the course passed with a passing grade. Safe to repeat: a sitting
 * already graded returns "duplicate" with its original result.
 */
export async function recordExam(db: Database, owner: Owner, exam: CompletedExam): Promise<ExamResult> {
  return db.transaction(async (tx): Promise<ExamResult> => {
    const enrolment = await lockedEnrolment(tx, owner, exam.courseId);
    if (enrolment === "not_owner" || enrolment === "not_enrolled") return { status: enrolment };
    const earlier = await tx.query<{ grade: number; passed: boolean; lectures_attended: number; study_sessions: number; academic_level: number }>(
      `SELECT grade, passed, lectures_attended, study_sessions, academic_level FROM assessments
        WHERE character_id = $1 AND course = $2 AND sitting_key = $3`,
      [owner.characterId, exam.courseId, exam.sittingKey],
    );
    const e = earlier.rows[0];
    if (e) {
      return { status: "duplicate", grade: Number(e.grade), passed: e.passed, lecturesAttended: Number(e.lectures_attended), studySessions: Number(e.study_sessions), academicLevel: Number(e.academic_level) };
    }
    if (enrolment.status !== "enrolled") return { status: "not_enrolled" };
    const lecturesAttended = await countLectures(tx, owner, exam.courseId);
    const inputs = { lecturesAttended, studySessions: enrolment.studySessions, academicLevel: Math.max(0, Math.floor(exam.academicLevel)) };
    const result = examGrade(exam.courseId, inputs);
    await tx.query(
      `INSERT INTO assessments (character_id, course, sitting_key, kind, grade, passed, lectures_attended, study_sessions, academic_level, game_day, sat_game_minute)
       VALUES ($1, $2, $3, 'exam', $4, $5, $6, $7, $8, $9, $10)`,
      [owner.characterId, exam.courseId, exam.sittingKey, result.grade, result.passed, inputs.lecturesAttended, inputs.studySessions, inputs.academicLevel, exam.gameDay, exam.endedGameMinute],
    );
    if (result.passed) {
      await tx.query(
        `UPDATE enrolments SET status = 'passed', final_grade = $3, passed_game_minute = $4 WHERE character_id = $1 AND course = $2`,
        [owner.characterId, exam.courseId, result.grade, exam.endedGameMinute],
      );
    }
    return { status: "graded", grade: result.grade, passed: result.passed, ...inputs };
  });
}

/** The character's enrolment row, locked for this transaction (one university change at a time per character). */
async function lockedEnrolment(tx: Queryable, owner: Owner, courseId: CourseId): Promise<{ status: "enrolled" | "passed"; studySessions: number } | "not_enrolled" | "not_owner"> {
  const { rows } = await tx.query<{ status: "enrolled" | "passed"; study_sessions: number }>(
    `SELECT e.status, e.study_sessions FROM enrolments e JOIN characters c ON c.id = e.character_id
      WHERE e.character_id = $1 AND c.account_id = $2 AND e.course = $3 FOR UPDATE OF e`,
    [owner.characterId, owner.accountId, courseId],
  );
  if (rows[0]) return { status: rows[0].status, studySessions: Number(rows[0].study_sessions) };
  return (await owns(tx, owner)) ? "not_enrolled" : "not_owner";
}

async function countLectures(tx: Queryable, owner: Owner, courseId: CourseId): Promise<number> {
  const { rows } = await tx.query<{ n: number }>(`SELECT count(*)::int AS n FROM lecture_attendance WHERE character_id = $1 AND course = $2`, [owner.characterId, courseId]);
  return Number(rows[0]?.n ?? 0);
}
