// M8 storage: migration 0006 (enrolments, lecture attendance, assessments),
// enrolling once, counting each lecture and study session, and grading an
// exam once per sitting from stored data, on PGlite and (with
// TEST_DATABASE_URL) PostgreSQL. Every call is scoped by the owning account.

import { DEFAULT_APPEARANCE, PROFILE_VERSION, cloneAppearance, examGrade, type NewCharacterInput } from "@padova/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "../src/db/database.ts";
import { appliedVersions, migrate, rollback } from "../src/db/migrate.ts";
import { enrolCharacter, loadCourses, recordExam, recordLecture, recordStudySession, type CompletedExam } from "../src/life/lifeRepository.ts";
import { createGuestWithCharacter, deleteCharacter, type Owner } from "../src/profiles/profileRepository.ts";
import { testBackends } from "./helpers/testDatabase.ts";

const input: NewCharacterInput = { displayName: "Giulia", ageCategory: "adult", appearance: cloneAppearance(DEFAULT_APPEARANCE), traits: [] };
const spawn = { area: "plaza", x: 0, z: 13, rotation: Math.PI };
const seed = { startingBalanceCents: 1_000, gameMinute: 480 };
const COURSE = "city-studies" as const;
const lecture = (day: number, hour: number) => ({ courseId: COURSE, lectureKey: `d${day}-${String(hour).padStart(2, "0")}00`, gameDay: day, endedGameMinute: (day - 1) * 1440 + hour * 60 + 20 });
const exam = (overrides: Partial<CompletedExam> = {}): CompletedExam => ({ courseId: COURSE, sittingKey: "d3", gameDay: 3, endedGameMinute: 2 * 1440 + 630, academicLevel: 0, ...overrides });
const count = async (db: Database, sql: string, params: unknown[] = []) => (await db.query<{ n: number }>(sql, params)).rows[0]!.n;

for (const backend of testBackends) {
  describe(`university data on ${backend.name}`, () => {
    let db: Database;
    let owner: Owner;
    let stranger: Owner;
    beforeEach(async () => {
      db = await backend.open();
      await migrate(db);
      const giulia = await createGuestWithCharacter(db, input, PROFILE_VERSION, spawn, seed);
      const other = await createGuestWithCharacter(db, { ...input, displayName: "Other" }, PROFILE_VERSION, spawn, seed);
      owner = { accountId: giulia.accountId, characterId: giulia.character.characterId };
      stranger = { accountId: other.accountId, characterId: giulia.character.characterId }; // someone else's account, Giulia's id
    });
    afterEach(async () => {
      await db.close();
    });

    it("rolls migration 0006 back and forward without enrolments, and refuses (changing nothing) once someone is enrolled", async () => {
      expect(await appliedVersions(db)).toContain(6);
      expect(await rollback(db, 2)).toEqual([7, 6]); // 0007 (relationships and safety, empty) first
      const tables = (await db.query<{ table_name: string }>(`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`)).rows.map((r) => r.table_name);
      for (const table of ["enrolments", "lecture_attendance", "assessments"]) expect(tables).not.toContain(table);
      expect(await migrate(db)).toEqual([6, 7]);
      expect(await enrolCharacter(db, owner, COURSE, 600)).toBe("enrolled");
      expect(await rollback(db)).toEqual([7]);
      await expect(rollback(db)).rejects.toThrow();
      expect(await appliedVersions(db)).toContain(6);
      expect(await loadCourses(db, owner)).toHaveLength(1);
    });

    it("enrols a character once and never another account's character", async () => {
      expect(await loadCourses(db, owner)).toEqual([]);
      expect(await loadCourses(db, stranger)).toBeNull();
      expect(await enrolCharacter(db, stranger, COURSE, 600)).toBe("not_owner");
      expect(await enrolCharacter(db, owner, COURSE, 600)).toBe("enrolled");
      expect(await enrolCharacter(db, owner, COURSE, 601)).toBe("already_enrolled");
      expect(await loadCourses(db, owner)).toEqual([
        { courseId: COURSE, status: "enrolled", studySessions: 0, lecturesAttended: 0, lastLectureKey: null, lastSittingKey: null, lastResult: null, finalGrade: null },
      ]);
    });

    it("counts each lecture once, and only for enrolled students", async () => {
      expect(await recordLecture(db, owner, lecture(1, 9))).toEqual({ status: "not_enrolled" });
      expect(await recordLecture(db, stranger, lecture(1, 9))).toEqual({ status: "not_owner" });
      await enrolCharacter(db, owner, COURSE, 500);
      expect(await recordLecture(db, owner, lecture(1, 9))).toEqual({ status: "recorded", lecturesAttended: 1 });
      expect(await recordLecture(db, owner, lecture(1, 9))).toEqual({ status: "duplicate", lecturesAttended: 1 });
      expect(await recordLecture(db, owner, lecture(1, 10))).toEqual({ status: "recorded", lecturesAttended: 2 });
      expect((await loadCourses(db, owner))![0]).toMatchObject({ lecturesAttended: 2, lastLectureKey: "d1-1000" });
      // The same lecture recorded twice at once still counts once.
      const [a, b] = await Promise.all([recordLecture(db, owner, lecture(2, 9)), recordLecture(db, owner, lecture(2, 9))]);
      expect([a.status, b.status].sort()).toEqual(["duplicate", "recorded"]);
      expect(await count(db, `SELECT count(*)::int AS n FROM lecture_attendance WHERE character_id = $1`, [owner.characterId])).toBe(3);
    });

    it("counts study sessions only while enrolled, for the owner only", async () => {
      expect(await recordStudySession(db, owner, COURSE)).toBeNull();
      await enrolCharacter(db, owner, COURSE, 500);
      expect(await recordStudySession(db, stranger, COURSE)).toBeNull();
      expect(await recordStudySession(db, owner, COURSE)).toBe(1);
      expect(await recordStudySession(db, owner, COURSE)).toBe(2);
      expect((await loadCourses(db, owner))![0]!.studySessions).toBe(2);
    });

    it("grades an unprepared exam as a fail, keeps the course open, and returns the same result if repeated", async () => {
      await enrolCharacter(db, owner, COURSE, 500);
      expect(await recordExam(db, stranger, exam())).toEqual({ status: "not_owner" });
      const first = await recordExam(db, owner, exam());
      expect(first).toEqual({ status: "graded", grade: 12, passed: false, lecturesAttended: 0, studySessions: 0, academicLevel: 0 });
      expect(await recordExam(db, owner, exam({ academicLevel: 9 }))).toEqual({ ...first, status: "duplicate" });
      expect((await loadCourses(db, owner))![0]).toMatchObject({ status: "enrolled", finalGrade: null, lastSittingKey: "d3", lastResult: { grade: 12, passed: false, gameDay: 3 } });
    });

    it("grades from the stored attendance and study count, and passing closes the course", async () => {
      await enrolCharacter(db, owner, COURSE, 500);
      for (const hour of [9, 10, 11, 12, 14, 15, 16, 17]) await recordLecture(db, owner, lecture(1, hour));
      for (let k = 0; k < 6; k++) await recordStudySession(db, owner, COURSE);
      const result = await recordExam(db, owner, exam({ academicLevel: 2 }));
      const expected = examGrade(COURSE, { lecturesAttended: 8, studySessions: 6, academicLevel: 2 });
      expect(result).toEqual({ status: "graded", grade: expected.grade, passed: true, lecturesAttended: 8, studySessions: 6, academicLevel: 2 });
      expect(expected.grade).toBe(29);
      expect((await loadCourses(db, owner))![0]).toMatchObject({ status: "passed", finalGrade: 29, lastResult: { grade: 29, passed: true, gameDay: 3 } });
      // After passing: no more lectures, study or exams count; enrolling again is refused.
      expect(await recordLecture(db, owner, lecture(4, 9))).toEqual({ status: "not_enrolled" });
      expect(await recordStudySession(db, owner, COURSE)).toBeNull();
      expect(await recordExam(db, owner, exam({ sittingKey: "d6", gameDay: 6 }))).toEqual({ status: "not_enrolled" });
      expect(await enrolCharacter(db, owner, COURSE, 9_000)).toBe("already_enrolled");
    });

    it("lets a failed student retake at a later sitting with the progress made since", async () => {
      await enrolCharacter(db, owner, COURSE, 500);
      expect(await recordExam(db, owner, exam())).toMatchObject({ passed: false });
      for (const hour of [9, 10, 11, 12]) await recordLecture(db, owner, lecture(4, hour));
      for (let k = 0; k < 2; k++) await recordStudySession(db, owner, COURSE);
      const retake = await recordExam(db, owner, exam({ sittingKey: "d6", gameDay: 6, endedGameMinute: 5 * 1440 + 630 }));
      expect(retake).toMatchObject({ status: "graded", grade: 18, passed: true, lecturesAttended: 4, studySessions: 2 });
      expect(await count(db, `SELECT count(*)::int AS n FROM assessments WHERE character_id = $1`, [owner.characterId])).toBe(2);
      expect((await loadCourses(db, owner))![0]).toMatchObject({ status: "passed", finalGrade: 18, lastSittingKey: "d6" });
    });

    it("refuses inconsistent rows in the database itself", async () => {
      await enrolCharacter(db, owner, COURSE, 500);
      // Passed without a grade, or a grade below the pass mark on a passed course.
      await expect(db.query(`UPDATE enrolments SET status = 'passed' WHERE character_id = $1`, [owner.characterId])).rejects.toThrow();
      await expect(db.query(`UPDATE enrolments SET status = 'passed', final_grade = 12, passed_game_minute = 1 WHERE character_id = $1`, [owner.characterId])).rejects.toThrow();
      // Attendance for a course the character is not enrolled in.
      await expect(
        db.query(`INSERT INTO lecture_attendance (character_id, course, lecture_key, game_day, attended_game_minute) VALUES ($1, 'other', 'd1-0900', 1, 560)`, [owner.characterId]),
      ).rejects.toThrow();
    });

    it("deletes a character's university rows with the character", async () => {
      await enrolCharacter(db, owner, COURSE, 500);
      await recordLecture(db, owner, lecture(1, 9));
      await recordExam(db, owner, exam());
      expect(await deleteCharacter(db, owner)).toBe(true);
      for (const table of ["enrolments", "lecture_attendance", "assessments"]) {
        expect(await count(db, `SELECT count(*)::int AS n FROM ${table} WHERE character_id = $1`, [owner.characterId]), table).toBe(0);
      }
    });
  });
}
