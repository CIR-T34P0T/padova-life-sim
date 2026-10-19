// M5 storage: the life-simulation migration, saving and loading life data,
// and money transactions, on PGlite and (with TEST_DATABASE_URL) PostgreSQL.

import { randomUUID } from "node:crypto";
import { DEFAULT_APPEARANCE, NEEDS_CONFIG, cloneAppearance, PROFILE_VERSION, type NewCharacterInput } from "@padova/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "../src/db/database.ts";
import { loadMigrations, migrate, rollback } from "../src/db/migrate.ts";
import { applyMoneyChange, loadLife, saveLife, type MoneyChange } from "../src/life/lifeRepository.ts";
import { createGuestWithCharacter, loadCharacterByAccount } from "../src/profiles/profileRepository.ts";
import { testBackends } from "./helpers/testDatabase.ts";

const input: NewCharacterInput = {
  displayName: "Giulia",
  ageCategory: "adult",
  appearance: cloneAppearance(DEFAULT_APPEARANCE),
  traits: ["organised", "sociable"],
};
const spawn = { area: "plaza", x: 0, z: 13, rotation: Math.PI };
const seed = { startingBalanceCents: 1_000, gameMinute: 500 };

const panino = (requestKey: string): MoneyChange => ({
  direction: "expense",
  category: "purchase",
  amountCents: 450,
  description: "Panino",
  itemId: "panino",
  requestKey,
  gameMinute: 600,
});

const count = async (db: Database, sql: string, params: unknown[] = []) =>
  (await db.query<{ n: number }>(sql, params)).rows[0]!.n;

for (const backend of testBackends) {
  describe(`life data on ${backend.name}`, () => {
    let db: Database;
    beforeEach(async () => {
      db = await backend.open();
    });
    afterEach(async () => {
      await db.close();
    });

    it("gives characters created before M5 starting needs, a wallet and a starting allowance", async () => {
      await migrate(db, loadMigrations().slice(0, 1));
      const accountId = randomUUID();
      const characterId = randomUUID();
      await db.query(`INSERT INTO accounts (id, kind) VALUES ($1, 'guest')`, [accountId]);
      await db.query(
        `INSERT INTO characters (id, account_id, display_name, age_category, profile_version) VALUES ($1, $2, 'Old Timer', 'adult', 1)`,
        [characterId, accountId],
      );
      await db.query(
        `INSERT INTO character_appearance (character_id, preset, skin_tone, hair_style, hair_colour, eye_colour, outfit)
         VALUES ($1, 'male', 'skin-3', 'short', 'black', 'brown', 'shirt-cream')`,
        [characterId],
      );

      expect(await migrate(db)).toEqual([2, 3]);
      const life = await loadLife(db, { accountId, characterId }, 5);
      expect(life?.needs).toEqual(NEEDS_CONFIG.initial);
      expect(life?.traits).toEqual([]);
      expect(life?.balanceCents).toBe(10_000);
      expect(life?.recent).toMatchObject([{ direction: "income", category: "allowance", amountCents: 10_000, balanceAfterCents: 10_000 }]);
      // The profile itself is untouched; it is upgraded in code on its next load.
      expect((await loadCharacterByAccount(db, accountId))?.profileVersion).toBe(1);
    });

    it("rolls back the life migration without touching profiles", async () => {
      await migrate(db);
      const { accountId } = await createGuestWithCharacter(db, input, PROFILE_VERSION, spawn, seed);
      expect(await rollback(db, 2)).toEqual([3, 2]);
      const tables = (await db.query<{ table_name: string }>(
        `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`,
      )).rows.map((r) => r.table_name);
      expect(tables).not.toContain("character_needs");
      expect(tables).not.toContain("wallet_transactions");
      expect(tables).toContain("characters");
      expect(await count(db, `SELECT count(*)::int AS n FROM characters WHERE account_id = $1`, [accountId])).toBe(1);
    });

    describe("with schema", () => {
      beforeEach(async () => {
        await migrate(db);
      });

      it("creates a character with traits, starting needs, wallet and ledger entry in one go", async () => {
        const { accountId, character } = await createGuestWithCharacter(db, input, PROFILE_VERSION, spawn, seed);
        expect(character.traits).toEqual(["organised", "sociable"]);
        const life = await loadLife(db, { accountId, characterId: character.characterId }, 5);
        expect(life).toMatchObject({ traits: ["organised", "sociable"], needs: NEEDS_CONFIG.initial, balanceCents: 1_000 });
        expect(life?.recent).toHaveLength(1);
        expect(life?.recent[0]).toMatchObject({ description: "Starting allowance", gameMinute: 500 });
      });

      it("saves and loads needs, skills and mood events, only for the owner", async () => {
        const alice = await createGuestWithCharacter(db, input, PROFILE_VERSION, spawn, seed);
        const bruno = await createGuestWithCharacter(db, { ...input, displayName: "Bruno" }, PROFILE_VERSION, spawn, seed);
        const owner = { accountId: alice.accountId, characterId: alice.character.characterId };
        const snapshot = {
          needs: { hunger: 12.5, energy: 99, hygiene: 0, social: 100, fun: 42.25 },
          skills: { academic: 123.5, communication: 0, cooking: 0, fitness: 7, creativity: 0 },
          moodEvents: [{ id: "good_meal" as const, startedAt: 600, expiresAt: 780 }],
        };
        expect(await db.transaction((tx) => saveLife(tx, owner, snapshot))).toBe(true);
        const life = await loadLife(db, owner, 5);
        expect(life?.needs).toEqual(snapshot.needs);
        expect(life?.skills).toEqual({ academic: 123.5, fitness: 7 });
        expect(life?.moodEvents).toEqual([{ id: "good_meal", startedAt: 600, expiresAt: 780 }]);

        const attack = { accountId: bruno.accountId, characterId: alice.character.characterId };
        expect(await db.transaction((tx) => saveLife(tx, attack, { ...snapshot, needs: { ...snapshot.needs, hunger: 100 } }))).toBe(false);
        expect(await loadLife(db, attack, 5)).toBeNull();
        expect((await loadLife(db, owner, 5))?.needs?.hunger).toBe(12.5);
      });

      it("refuses need values outside 0–100 and negative XP in the database itself", async () => {
        const { character } = await createGuestWithCharacter(db, input, PROFILE_VERSION, spawn, seed);
        await expect(db.query(`UPDATE character_needs SET hunger = 101 WHERE character_id = $1`, [character.characterId])).rejects.toThrow();
        await expect(
          db.query(`INSERT INTO character_skills (character_id, skill, xp) VALUES ($1, 'academic', -1)`, [character.characterId]),
        ).rejects.toThrow();
      });

      it("charges a purchase once, records it, and returns the same result for a repeated request", async () => {
        const { accountId, character } = await createGuestWithCharacter(db, input, PROFILE_VERSION, spawn, seed);
        const owner = { accountId, characterId: character.characterId };
        const first = await applyMoneyChange(db, owner, panino("purchase:abc12345"));
        expect(first).toMatchObject({ status: "applied", balanceCents: 550, transaction: { amountCents: 450, balanceAfterCents: 550, itemId: "panino" } });
        const again = await applyMoneyChange(db, owner, panino("purchase:abc12345"));
        expect(again).toMatchObject({ status: "duplicate", balanceCents: 550 });
        expect(again.status === "duplicate" && first.status === "applied" && again.transaction.id === first.transaction.id).toBe(true);
        expect(await count(db, `SELECT count(*)::int AS n FROM wallet_transactions WHERE character_id = $1`, [owner.characterId])).toBe(2);
      });

      it("refuses a purchase the balance can't cover and writes nothing", async () => {
        const { accountId, character } = await createGuestWithCharacter(db, input, PROFILE_VERSION, { ...spawn }, { ...seed, startingBalanceCents: 400 });
        const owner = { accountId, characterId: character.characterId };
        expect(await applyMoneyChange(db, owner, panino("purchase:poor0001"))).toEqual({ status: "insufficient_funds", balanceCents: 400 });
        expect((await loadLife(db, owner, 5))?.balanceCents).toBe(400);
        expect(await count(db, `SELECT count(*)::int AS n FROM wallet_transactions WHERE character_id = $1`, [owner.characterId])).toBe(1);
      });

      it("never lets the balance go negative, even by a direct update", async () => {
        const { character } = await createGuestWithCharacter(db, input, PROFILE_VERSION, spawn, seed);
        await expect(db.query(`UPDATE character_wallets SET balance_cents = -1 WHERE character_id = $1`, [character.characterId])).rejects.toThrow();
        await expect(applyMoneyChange(db, { accountId: "x", characterId: "y" }, { ...panino("bad"), amountCents: -450 })).rejects.toThrow(/positive/);
        await expect(applyMoneyChange(db, { accountId: "x", characterId: "y" }, { ...panino("bad"), amountCents: 4.5 })).rejects.toThrow(/whole/);
      });

      it("refuses to move another account's money", async () => {
        const alice = await createGuestWithCharacter(db, input, PROFILE_VERSION, spawn, seed);
        const bruno = await createGuestWithCharacter(db, { ...input, displayName: "Bruno" }, PROFILE_VERSION, spawn, seed);
        const attack = { accountId: bruno.accountId, characterId: alice.character.characterId };
        expect(await applyMoneyChange(db, attack, panino("purchase:steal123"))).toEqual({ status: "not_owner" });
        expect((await loadLife(db, { accountId: alice.accountId, characterId: alice.character.characterId }, 5))?.balanceCents).toBe(1_000);
      });

      it("lets only one of two simultaneous purchases through when the money covers one", async () => {
        const { accountId, character } = await createGuestWithCharacter(db, input, PROFILE_VERSION, spawn, { ...seed, startingBalanceCents: 500 });
        const owner = { accountId, characterId: character.characterId };
        const results = await Promise.all([applyMoneyChange(db, owner, panino("purchase:race0001")), applyMoneyChange(db, owner, panino("purchase:race0002"))]);
        expect(results.map((r) => r.status).sort()).toEqual(["applied", "insufficient_funds"]);
        expect((await loadLife(db, owner, 5))?.balanceCents).toBe(50);
      });

      it("records income such as refunds and allowances, once per key", async () => {
        const { accountId, character } = await createGuestWithCharacter(db, input, PROFILE_VERSION, spawn, seed);
        const owner = { accountId, characterId: character.characterId };
        const allowance: MoneyChange = {
          direction: "income",
          category: "allowance",
          amountCents: 1_500,
          description: "Daily allowance",
          requestKey: "allowance:day-7",
          gameMinute: 7 * 1440,
        };
        expect(await applyMoneyChange(db, owner, allowance)).toMatchObject({ status: "applied", balanceCents: 2_500 });
        expect(await applyMoneyChange(db, owner, allowance)).toMatchObject({ status: "duplicate", balanceCents: 2_500 });
        const life = await loadLife(db, owner, 5);
        expect(life?.recent[0]).toMatchObject({ direction: "income", description: "Daily allowance" });
      });
    });
  });
}
