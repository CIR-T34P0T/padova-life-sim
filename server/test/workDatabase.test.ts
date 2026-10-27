// M7 storage: migration 0005 (jobs, shifts, the 'wage' ledger category),
// hiring and quitting, and paying a shift exactly once, on PGlite and (with
// TEST_DATABASE_URL) PostgreSQL. Every call is scoped by the owning account.

import { randomUUID } from "node:crypto";
import { DEFAULT_APPEARANCE, JOBS, PROFILE_VERSION, cloneAppearance, type NewCharacterInput } from "@padova/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "../src/db/database.ts";
import { appliedVersions, migrate, rollback } from "../src/db/migrate.ts";
import { applyMoneyChange, hireCharacter, loadLife, loadWork, quitJob, recordShift, type CompletedShift } from "../src/life/lifeRepository.ts";
import { createGuestWithCharacter, deleteCharacter, type Owner } from "../src/profiles/profileRepository.ts";
import { testBackends } from "./helpers/testDatabase.ts";

const input: NewCharacterInput = { displayName: "Marta", ageCategory: "adult", appearance: cloneAppearance(DEFAULT_APPEARANCE), traits: [] };
const spawn = { area: "plaza", x: 0, z: 13, rotation: Math.PI };
const seed = { startingBalanceCents: 1_000, gameMinute: 480 };
const DAY = 3;

const shift = (overrides: Partial<CompletedShift> = {}): CompletedShift => ({
  shiftId: randomUUID(),
  jobId: "cafe",
  gradeId: "assistant",
  gradeLabel: "Café assistant",
  wageCents: 600,
  gameDay: DAY,
  startedGameMinute: (DAY - 1) * 1440 + 600,
  endedGameMinute: (DAY - 1) * 1440 + 615,
  maxShiftsPerDay: JOBS.cafe.maxShiftsPerDay,
  ...overrides,
});

const count = async (db: Database, sql: string, params: unknown[] = []) => (await db.query<{ n: number }>(sql, params)).rows[0]!.n;

for (const backend of testBackends) {
  describe(`work data on ${backend.name}`, () => {
    let db: Database;
    let owner: Owner;
    let stranger: Owner;
    beforeEach(async () => {
      db = await backend.open();
      await migrate(db);
      const marta = await createGuestWithCharacter(db, input, PROFILE_VERSION, spawn, seed);
      const other = await createGuestWithCharacter(db, { ...input, displayName: "Other" }, PROFILE_VERSION, spawn, seed);
      owner = { accountId: marta.accountId, characterId: marta.character.characterId };
      stranger = { accountId: other.accountId, characterId: marta.character.characterId }; // someone else's account, Marta's id
    });
    afterEach(async () => {
      await db.close();
    });

    it("rolls migration 0005 back and forward when there are no jobs or wages, and the ledger accepts wages only while it is applied", async () => {
      expect(await appliedVersions(db)).toContain(5);
      expect(await rollback(db, 2)).toEqual([6, 5]); // 0006 (university, no enrolments) first
      const wage = { direction: "income" as const, category: "wage" as const, amountCents: 600, description: "Wage", requestKey: "wage:x", gameMinute: 600 };
      await expect(applyMoneyChange(db, owner, wage)).rejects.toThrow();
      const tables = (await db.query<{ table_name: string }>(`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`)).rows.map((r) => r.table_name);
      expect(tables).not.toContain("character_employment");
      expect(tables).not.toContain("work_shifts");
      expect(await migrate(db)).toEqual([5, 6]);
      expect(await applyMoneyChange(db, owner, wage)).toMatchObject({ status: "applied", balanceCents: 1_600 });
    });

    it("refuses to roll back, changing nothing, while a character has a job or was ever paid a wage", async () => {
      expect(await hireCharacter(db, owner, "cafe", 600)).toBe("hired");
      expect(await rollback(db)).toEqual([6]); // nothing in 0006's tables
      await expect(rollback(db)).rejects.toThrow();
      expect(await appliedVersions(db)).toContain(5);
      expect((await loadWork(db, owner, DAY))?.jobId).toBe("cafe");

      expect((await recordShift(db, owner, shift())).status).toBe("paid");
      expect(await quitJob(db, owner)).toBe("quit");
      await expect(rollback(db)).rejects.toThrow(); // the wage is still in the ledger
      expect(await appliedVersions(db)).toContain(5);
      expect(await count(db, `SELECT count(*)::int AS n FROM work_shifts WHERE character_id = $1`, [owner.characterId])).toBe(1);
    });

    it("hires a character once, lets it quit, and never touches another account's character", async () => {
      expect(await loadWork(db, owner, DAY)).toEqual({ jobId: null, shiftsToday: 0 });
      expect(await hireCharacter(db, stranger, "cafe", 600)).toBe("not_owner");
      expect(await hireCharacter(db, owner, "cafe", 600)).toBe("hired");
      expect(await hireCharacter(db, owner, "cafe", 601)).toBe("already_employed");
      expect(await loadWork(db, owner, DAY)).toEqual({ jobId: "cafe", shiftsToday: 0 });
      expect(await loadWork(db, stranger, DAY)).toBeNull();
      expect(await quitJob(db, stranger)).toBe("not_owner");
      expect((await loadWork(db, owner, DAY))?.jobId).toBe("cafe");
      expect(await quitJob(db, owner)).toBe("quit");
      expect(await quitJob(db, owner)).toBe("not_employed");
      expect((await loadWork(db, owner, DAY))?.jobId).toBeNull();
    });

    it("pays a completed shift once, as a wage in the ledger, however often it is recorded", async () => {
      await hireCharacter(db, owner, "cafe", 600);
      const done = shift();
      const first = await recordShift(db, owner, done);
      expect(first).toMatchObject({ status: "paid", balanceCents: 1_600, shiftsToday: 1 });
      if (first.status !== "paid") throw new Error("not paid");
      expect(first.transaction).toMatchObject({ direction: "income", category: "wage", amountCents: 600, description: "Wage: Café assistant" });
      const again = await recordShift(db, owner, done);
      expect(again).toMatchObject({ status: "duplicate", balanceCents: 1_600, shiftsToday: 1 });
      if (again.status !== "duplicate") throw new Error("not a duplicate");
      expect(again.transaction.id).toBe(first.transaction.id);
      expect(await count(db, `SELECT count(*)::int AS n FROM wallet_transactions WHERE character_id = $1 AND category = 'wage'`, [owner.characterId])).toBe(1);
      const life = await loadLife(db, owner, 5);
      expect(life?.balanceCents).toBe(1_600);
      expect(life?.recent[0]).toMatchObject({ category: "wage", description: "Wage: Café assistant" });
      const row = await db.query(`SELECT job, grade, game_day, wage_cents FROM work_shifts WHERE id = $1`, [done.shiftId]);
      expect(row.rows[0]).toEqual({ job: "cafe", grade: "assistant", game_day: DAY, wage_cents: 600 });
    });

    it("enforces the daily limit in the database, per game day", async () => {
      await hireCharacter(db, owner, "cafe", 600);
      for (let i = 0; i < 4; i++) expect((await recordShift(db, owner, shift())).status).toBe("paid");
      expect(await recordShift(db, owner, shift())).toEqual({ status: "shift_limit", shiftsToday: 4 });
      expect((await loadWork(db, owner, DAY))?.shiftsToday).toBe(4);
      expect((await loadWork(db, owner, DAY + 1))?.shiftsToday).toBe(0);
      expect(await recordShift(db, owner, shift({ gameDay: DAY + 1 }))).toMatchObject({ status: "paid", shiftsToday: 1 });
      expect((await loadLife(db, owner, 5))?.balanceCents).toBe(1_000 + 5 * 600);
    });

    it("pays nothing to a character without that job or to another account, and writes nothing", async () => {
      expect(await recordShift(db, owner, shift())).toEqual({ status: "not_employed" });
      await hireCharacter(db, owner, "cafe", 600);
      expect(await recordShift(db, stranger, shift())).toEqual({ status: "not_owner" });
      expect(await count(db, `SELECT count(*)::int AS n FROM work_shifts`)).toBe(0);
      expect(await count(db, `SELECT count(*)::int AS n FROM wallet_transactions WHERE category = 'wage'`)).toBe(0);
      expect((await loadLife(db, owner, 5))?.balanceCents).toBe(1_000);
    });

    it("pays a shift recorded twice at the same moment only once, and lets only one of two shifts past the last free place", async () => {
      await hireCharacter(db, owner, "cafe", 600);
      const done = shift();
      const twice = await Promise.all([recordShift(db, owner, done), recordShift(db, owner, done)]);
      expect(twice.map((r) => r.status).sort()).toEqual(["duplicate", "paid"]);
      for (let i = 0; i < 2; i++) await recordShift(db, owner, shift());
      const race = await Promise.all([recordShift(db, owner, shift()), recordShift(db, owner, shift())]);
      expect(race.map((r) => r.status).sort()).toEqual(["paid", "shift_limit"]);
      expect((await loadLife(db, owner, 5))?.balanceCents).toBe(1_000 + 4 * 600);
    });

    it("refuses wages and shift rows that break the rules in the database itself", async () => {
      await expect(db.query(`UPDATE wallet_transactions SET category = 'gift' WHERE character_id = $1`, [owner.characterId])).rejects.toThrow();
      await expect(
        db.query(
          `INSERT INTO work_shifts (id, character_id, job, grade, game_day, started_game_minute, ended_game_minute, wage_cents, transaction_id)
           SELECT $1, $2, 'cafe', 'assistant', 1, 10, 20, 0, id FROM wallet_transactions WHERE character_id = $2 LIMIT 1`,
          [randomUUID(), owner.characterId],
        ),
      ).rejects.toThrow();
    });

    it("deletes a character's job and shift history with the character", async () => {
      await hireCharacter(db, owner, "cafe", 600);
      await recordShift(db, owner, shift());
      expect(await deleteCharacter(db, owner)).toBe(true);
      for (const table of ["character_employment", "work_shifts", "wallet_transactions"]) {
        expect(await count(db, `SELECT count(*)::int AS n FROM ${table} WHERE character_id = $1`, [owner.characterId]), table).toBe(0);
      }
    });
  });
}
