// M9 storage: migration 0007 (relationships, moments, blocks, reports, story
// log), shared moments with daily caps and a short history, blocks between
// accounts, reports with their limits and 90-day deletion, and the story log,
// on PGlite and (with TEST_DATABASE_URL) PostgreSQL. Every call is scoped by
// server-resolved owners.

import { DEFAULT_APPEARANCE, PROFILE_VERSION, RELATIONSHIP_CONFIG, SAFETY_CONFIG, cloneAppearance, type NewCharacterInput } from "@padova/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "../src/db/database.ts";
import { appliedVersions, migrate, rollback } from "../src/db/migrate.ts";
import { createGuestWithCharacter, deleteCharacter, type Owner } from "../src/profiles/profileRepository.ts";
import {
  addStoryEvent,
  blockAccount,
  insertReport,
  listBlocks,
  listReports,
  loadRelationship,
  purgeReports,
  recentStory,
  recordMoment,
  unblock,
  type ReportInput,
} from "../src/social/socialRepository.ts";
import { testBackends } from "./helpers/testDatabase.ts";

const input = (displayName: string): NewCharacterInput => ({ displayName, ageCategory: "adult", appearance: cloneAppearance(DEFAULT_APPEARANCE), traits: [] });
const spawn = { area: "plaza", x: 0, z: 13, rotation: Math.PI };
const seed = { startingBalanceCents: 1_000, gameMinute: 480 };
const count = async (db: Database, sql: string, params: unknown[] = []) => Number((await db.query<{ n: number }>(sql, params)).rows[0]!.n);
const minute = (day: number, hours = 10) => (day - 1) * 1440 + hours * 60;

async function newOwner(db: Database, name: string): Promise<Owner> {
  const created = await createGuestWithCharacter(db, input(name), PROFILE_VERSION, spawn, seed);
  return { accountId: created.accountId, characterId: created.character.characterId };
}

for (const backend of testBackends) {
  describe(`relationships and safety data on ${backend.name}`, () => {
    let db: Database;
    let ada: Owner;
    let ben: Owner;
    beforeEach(async () => {
      db = await backend.open();
      await migrate(db);
      ada = await newOwner(db, "Ada");
      ben = await newOwner(db, "Ben");
    });
    afterEach(async () => {
      await db.close();
    });

    const moment = (kind: "greet" | "chat" | "study_together" | "lecture_together", day = 3, a: Owner = ada, b: Owner = ben) =>
      recordMoment(db, { a, b, kind, gameDay: day, gameMinute: minute(day) });

    it("rolls migration 0007 back and forward when empty, and refuses (changing nothing) once there is social data", async () => {
      expect(await appliedVersions(db)).toContain(7);
      expect(await rollback(db, 2)).toEqual([8, 7]); // 0008 (homes, empty) first
      const tables = (await db.query<{ table_name: string }>(`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`)).rows.map((r) => r.table_name);
      for (const table of ["relationships", "relationship_events", "blocks", "reports", "story_events"]) expect(tables).not.toContain(table);
      expect(await migrate(db)).toEqual([7, 8]);
      await addStoryEvent(db, ada, { key: "first_shift", kind: "first_shift", gameMinute: 600, details: {} });
      expect(await rollback(db)).toEqual([8]);
      await expect(rollback(db)).rejects.toThrow();
      expect(await appliedVersions(db)).toContain(7);
      expect(await recentStory(db, ada, 10)).toHaveLength(1);
    });

    it("grows one relationship per pair from shared moments, whichever player starts", async () => {
      expect(await loadRelationship(db, ada, ben.characterId)).toBeNull();
      expect(await moment("chat")).toEqual({ status: "counted", before: 0, score: 5, firstGameMinute: minute(3) });
      expect(await moment("greet", 3, ben, ada)).toMatchObject({ status: "counted", before: 5, score: 7 });
      expect(await count(db, `SELECT count(*)::int AS n FROM relationships`)).toBe(1);
      const seenByAda = await loadRelationship(db, ada, ben.characterId);
      const seenByBen = await loadRelationship(db, ben, ada.characterId);
      expect(seenByAda).toEqual(seenByBen);
      expect(seenByAda).toMatchObject({ score: 7, level: "acquaintance", label: "Acquaintance", sinceGameMinute: minute(3) });
      expect(seenByAda !== null && seenByAda !== "not_owner" && seenByAda.recent.map((m) => m.kind)).toEqual(["greet", "chat"]);
    });

    it("counts each kind only up to its daily cap per pair; a new game day starts again", async () => {
      const cap = RELATIONSHIP_CONFIG.dailyCaps.chat;
      for (let k = 0; k < cap; k++) expect((await moment("chat")).status).toBe("counted");
      expect(await moment("chat")).toMatchObject({ status: "capped", score: cap * RELATIONSHIP_CONFIG.gains.chat });
      // Another kind still counts the same day, and chat counts again the next day.
      expect((await moment("study_together")).status).toBe("counted");
      expect((await moment("chat", 4)).status).toBe("counted");
    });

    it("keeps only the newest moments and never goes above 100", async () => {
      for (let day = 1; day <= 8; day++) for (let k = 0; k < RELATIONSHIP_CONFIG.dailyCaps.chat; k++) await moment("chat", day);
      expect(await count(db, `SELECT count(*)::int AS n FROM relationship_events`)).toBe(RELATIONSHIP_CONFIG.historyLength);
      for (let day = 9; day <= 12; day++) for (const kind of ["chat", "chat", "chat", "chat", "study_together", "study_together", "study_together"] as const) await moment(kind, day);
      const view = await loadRelationship(db, ada, ben.characterId);
      expect(view).toMatchObject({ score: 100, level: "close_friend" });
      expect(view !== null && view !== "not_owner" && view.recent.length).toBe(RELATIONSHIP_CONFIG.recentShown);
    });

    it("refuses moments for characters the owners don't own, or with oneself", async () => {
      expect(await recordMoment(db, { a: ada, b: { accountId: ada.accountId, characterId: ben.characterId }, kind: "chat", gameDay: 3, gameMinute: 600 })).toEqual({ status: "not_owner" });
      expect(await recordMoment(db, { a: ada, b: ada, kind: "chat", gameDay: 3, gameMinute: 600 })).toEqual({ status: "same_character" });
      expect(await loadRelationship(db, { accountId: ben.accountId, characterId: ada.characterId }, ben.characterId)).toBe("not_owner");
      expect(await count(db, `SELECT count(*)::int AS n FROM relationships`)).toBe(0);
    });

    it("blocks an account once, lists it with the character's name, and lets only the blocker lift it", async () => {
      expect(await blockAccount(db, ada, ben, "Ben")).toBe("blocked");
      expect(await blockAccount(db, ada, ben, "Ben")).toBe("already_blocked");
      expect(await blockAccount(db, ada, ada, "Ada")).toBe("same_account");
      // Ada's account with Ben's character as the blocker: refused, even though Ben's own pair is valid.
      expect(await blockAccount(db, { accountId: ada.accountId, characterId: ben.characterId }, ben, "Ben")).toBe("not_owner");
      const blocks = await listBlocks(db, ada.accountId);
      expect(blocks).toEqual([{ id: expect.any(String), blockedAccount: ben.accountId, name: "Ben", createdAt: expect.any(Date) }]);
      expect(await listBlocks(db, ben.accountId)).toEqual([]);
      // Ben can't lift Ada's block with its id.
      expect(await unblock(db, ben.accountId, blocks[0]!.id)).toBeNull();
      expect(await unblock(db, ada.accountId, blocks[0]!.id)).toEqual({ blockedAccount: ben.accountId });
      expect(await listBlocks(db, ada.accountId)).toEqual([]);
    });

    it("stores a report once a day per reported account, within the hourly limit", async () => {
      const report = (reported: Owner, over: Partial<ReportInput> = {}) =>
        insertReport(db, { reporter: ada, reporterName: "Ada", reported, reportedName: "Ben", reason: "harassment", area: "plaza", gameMinute: 600, ...over });
      expect(await report(ben, { note: "kept following me" })).toBe("sent");
      expect(await report(ben, { reason: "other" })).toBe("already_reported");
      expect(await report(ada)).toBe("same_account");
      const others = [];
      for (let k = 0; k < SAFETY_CONFIG.reportsPerHour; k++) others.push(await newOwner(db, `Other ${k}`));
      for (let k = 0; k < SAFETY_CONFIG.reportsPerHour - 1; k++) expect(await report(others[k]!)).toBe("sent");
      expect(await report(others.at(-1)!)).toBe("rate_limited");
      const listed = await listReports(db);
      expect(listed).toHaveLength(SAFETY_CONFIG.reportsPerHour);
      expect(listed.at(-1)).toMatchObject({ reporterName: "Ada", reportedName: "Ben", reportedAccount: ben.accountId, reason: "harassment", note: "kept following me", area: "plaza" });
      // The database itself refuses unknown reasons and long notes.
      await expect(db.query(`UPDATE reports SET reason = 'spam'`)).rejects.toThrow();
      await expect(db.query(`UPDATE reports SET note = $1`, ["x".repeat(301)])).rejects.toThrow();
    });

    it("deletes reports older than 90 days and keeps younger ones", async () => {
      const report = (reported: Owner) => insertReport(db, { reporter: ada, reporterName: "Ada", reported, reportedName: "X", reason: "other", area: "plaza", gameMinute: 600 });
      const carla = await newOwner(db, "Carla");
      await report(ben);
      await report(carla);
      await db.query(`UPDATE reports SET created_at = now() - make_interval(days => 91) WHERE reported_account = $1`, [ben.accountId]);
      await db.query(`UPDATE reports SET created_at = now() - make_interval(days => 89) WHERE reported_account = $1`, [carla.accountId]);
      expect(await purgeReports(db)).toBe(1);
      expect((await listReports(db)).map((r) => r.reportedAccount)).toEqual([carla.accountId]);
      expect(await purgeReports(db)).toBe(0);
    });

    it("writes each story event once, newest first, only for its owner, and deletes it with the character", async () => {
      expect(await addStoryEvent(db, ada, { key: "hired:cafe:600", kind: "hired", gameMinute: 600, details: { jobId: "cafe" } })).toBe(true);
      expect(await addStoryEvent(db, ada, { key: "first_shift", kind: "first_shift", gameMinute: 700, details: { jobId: "cafe" } })).toBe(true);
      expect(await addStoryEvent(db, ada, { key: "first_shift", kind: "first_shift", gameMinute: 900, details: { jobId: "cafe" } })).toBe(false);
      expect(await addStoryEvent(db, { accountId: ben.accountId, characterId: ada.characterId }, { key: "x", kind: "enrolled", gameMinute: 1, details: {} })).toBe(false);
      expect(await recentStory(db, ada, 10)).toEqual([
        { kind: "first_shift", gameMinute: 700, details: { jobId: "cafe" } },
        { kind: "hired", gameMinute: 600, details: { jobId: "cafe" } },
      ]);
      expect(await recentStory(db, ada, 1)).toHaveLength(1);
      expect(await recentStory(db, { accountId: ben.accountId, characterId: ada.characterId }, 10)).toBeNull();
      expect(await recentStory(db, ben, 10)).toEqual([]);
      await expect(db.query(`INSERT INTO story_events (id, character_id, event_key, kind, game_minute) VALUES (gen_random_uuid(), $1, 'k', 'became_president', 1)`, [ada.characterId])).rejects.toThrow();
      expect(await deleteCharacter(db, ada)).toBe(true);
      expect(await count(db, `SELECT count(*)::int AS n FROM story_events WHERE character_id = $1`, [ada.characterId])).toBe(0);
    });

    it("deletes a character's relationships with it, and keeps the other side's block of the account", async () => {
      await moment("chat");
      await blockAccount(db, ben, ada, "Ada");
      expect(await deleteCharacter(db, ada)).toBe(true);
      expect(await count(db, `SELECT count(*)::int AS n FROM relationships`)).toBe(0);
      expect(await count(db, `SELECT count(*)::int AS n FROM relationship_events`)).toBe(0);
      // The block is on the account; only the name snapshot's character link is cleared.
      expect(await listBlocks(db, ben.accountId)).toMatchObject([{ blockedAccount: ada.accountId, name: "Ada" }]);
    });
  });
}
