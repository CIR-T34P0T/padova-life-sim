// Migrations and the profile repository against real PostgreSQL engines
// (PGlite always; a PostgreSQL server too when TEST_DATABASE_URL is set).

import { DEFAULT_APPEARANCE, PROFILE_VERSION, type NewCharacterInput } from "@padova/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "../src/db/database.ts";
import { redactUrl } from "../src/db/database.ts";
import { appliedVersions, loadMigrations, migrate, rollback, splitStatements } from "../src/db/migrate.ts";
import { hashGuestToken, isWellFormedGuestToken } from "../src/identity/guestIdentity.ts";
import {
  createCharacterForAccount,
  createGuestWithCharacter,
  findAccountIdByGuestToken,
  loadCharacterByAccount,
  loadCharacterById,
  saveState,
  updateAppearance,
} from "../src/profiles/profileRepository.ts";
import { testBackends } from "./helpers/testDatabase.ts";

const input: NewCharacterInput = { displayName: "Giulia", ageCategory: "adult", appearance: { ...DEFAULT_APPEARANCE } };
const spawn = { area: "plaza", x: 0, z: 13, rotation: Math.PI };

const tableNames = async (db: Database) =>
  (await db.query<{ table_name: string }>(
    `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name`,
  )).rows.map((r) => r.table_name);

describe("migration files", () => {
  it("are numbered without gaps and have up and down sections", () => {
    const migrations = loadMigrations();
    expect(migrations.map((m) => m.version)).toEqual(migrations.map((_, i) => i + 1));
    for (const m of migrations) {
      expect(m.up.length).toBeGreaterThan(0);
      expect(m.down.length).toBeGreaterThan(0);
    }
  });

  it("splits statements and drops comment lines", () => {
    expect(splitStatements("-- note\nCREATE TABLE a (x int);\n\nCREATE TABLE b (y int);")).toEqual(["CREATE TABLE a (x int)", "CREATE TABLE b (y int)"]);
  });

  it("never prints a password from a connection URL", () => {
    expect(redactUrl("postgres://padova:s3cret@db.example:5432/game")).toBe("postgres://padova:***@db.example:5432/game");
  });
});

for (const backend of testBackends) {
  describe(`database on ${backend.name}`, () => {
    let db: Database;
    beforeEach(async () => {
      db = await backend.open();
    });
    afterEach(async () => {
      await db.close();
    });

    it("migrates a fresh database to the latest version, idempotently", async () => {
      const latest = loadMigrations().at(-1)!.version;
      expect(await migrate(db)).toEqual(loadMigrations().map((m) => m.version));
      expect(await appliedVersions(db)).toEqual(loadMigrations().map((m) => m.version));
      expect(await migrate(db)).toEqual([]); // second run does nothing
      expect(await tableNames(db)).toEqual(
        expect.arrayContaining(["accounts", "guest_credentials", "characters", "character_appearance", "character_state", "schema_migrations"]),
      );
      expect(latest).toBeGreaterThanOrEqual(1);
    });

    it("rolls back the latest migration and re-applies it", async () => {
      await migrate(db);
      const latest = loadMigrations().at(-1)!.version;
      expect(await rollback(db)).toEqual([latest]);
      expect(await appliedVersions(db)).not.toContain(latest);
      if (latest === 1) expect(await tableNames(db)).toEqual(["schema_migrations"]);
      expect(await migrate(db)).toEqual([latest]);
    });

    describe("with schema", () => {
      beforeEach(async () => {
        await migrate(db);
      });

      it("creates a guest with a character atomically and never stores the token itself", async () => {
        const { accountId, guestToken, character } = await createGuestWithCharacter(db, input, PROFILE_VERSION, spawn);
        expect(isWellFormedGuestToken(guestToken)).toBe(true);
        expect(character).toMatchObject({ accountId, displayName: "Giulia", ageCategory: "adult", profileVersion: PROFILE_VERSION });
        expect(character.appearance).toEqual(DEFAULT_APPEARANCE);
        expect(character.state).toMatchObject({ area: "plaza", x: 0, z: 13 });
        const stored = await db.query<{ token_hash: string }>("SELECT token_hash FROM guest_credentials WHERE account_id = $1", [accountId]);
        expect(stored.rows[0]!.token_hash).toBe(hashGuestToken(guestToken));
        const dump = JSON.stringify((await db.query("SELECT * FROM guest_credentials")).rows);
        expect(dump).not.toContain(guestToken);
      });

      it("finds the account only with the exact token", async () => {
        const { accountId, guestToken } = await createGuestWithCharacter(db, input, PROFILE_VERSION, spawn);
        expect(await findAccountIdByGuestToken(db, guestToken)).toBe(accountId);
        const tampered = guestToken.slice(0, -1) + (guestToken.endsWith("A") ? "B" : "A");
        expect(await findAccountIdByGuestToken(db, tampered)).toBeNull();
        expect(await findAccountIdByGuestToken(db, "not-a-token")).toBeNull();
        expect(await findAccountIdByGuestToken(db, accountId)).toBeNull(); // an account id is not proof of ownership
      });

      it("saves and loads appearance and position", async () => {
        const { accountId, character } = await createGuestWithCharacter(db, input, PROFILE_VERSION, spawn);
        const owner = { accountId, characterId: character.characterId };
        const changed = { ...DEFAULT_APPEARANCE, hairColour: "teal", outfit: "hoodie-navy" };
        const updated = await updateAppearance(db, owner, changed, PROFILE_VERSION);
        expect(updated?.appearance).toEqual(changed);
        expect(updated!.updatedAt.getTime()).toBeGreaterThanOrEqual(character.updatedAt.getTime());
        expect(await saveState(db, owner, { area: "plaza", x: -4.5, z: 2.25, rotation: 1 })).toBe(true);
        const loaded = await loadCharacterByAccount(db, accountId);
        expect(loaded?.appearance).toEqual(changed);
        expect(loaded?.state).toMatchObject({ x: -4.5, z: 2.25 });
        expect(loaded?.state?.rotation).toBeCloseTo(1, 5);
      });

      it("refuses reads and writes by an account that does not own the character", async () => {
        const alice = await createGuestWithCharacter(db, input, PROFILE_VERSION, spawn);
        const bruno = await createGuestWithCharacter(db, { ...input, displayName: "Bruno" }, PROFILE_VERSION, spawn);
        const brunoAttack = { accountId: bruno.accountId, characterId: alice.character.characterId };
        expect(await updateAppearance(db, brunoAttack, { ...DEFAULT_APPEARANCE, hairColour: "rose" }, PROFILE_VERSION)).toBeNull();
        expect(await saveState(db, brunoAttack, { area: "plaza", x: 20, z: 20, rotation: 0 })).toBe(false);
        expect(await loadCharacterById(db, brunoAttack)).toBeNull();
        const aliceNow = await loadCharacterByAccount(db, alice.accountId);
        expect(aliceNow?.appearance.hairColour).toBe(DEFAULT_APPEARANCE.hairColour);
        expect(aliceNow?.state).toMatchObject({ x: 0, z: 13 });
      });

      it("allows one character per account", async () => {
        const { accountId } = await createGuestWithCharacter(db, input, PROFILE_VERSION, spawn);
        expect(await createCharacterForAccount(db, accountId, { ...input, displayName: "Second" }, PROFILE_VERSION, spawn)).toBeNull();
      });

      it("enforces age category and version constraints in the database itself", async () => {
        const { accountId, character } = await createGuestWithCharacter(db, input, PROFILE_VERSION, spawn);
        await expect(db.query("UPDATE characters SET age_category = 'toddler' WHERE id = $1", [character.characterId])).rejects.toThrow();
        await expect(db.query("UPDATE characters SET profile_version = 0 WHERE id = $1", [character.characterId])).rejects.toThrow();
        await expect(db.query("INSERT INTO accounts (id, kind) VALUES ($1, 'admin')", [crypto.randomUUID()])).rejects.toThrow();
        expect(accountId).toBeTruthy();
      });

      it("rolls back a failed creation completely", async () => {
        const before = (await db.query<{ n: number }>("SELECT count(*)::int AS n FROM accounts")).rows[0]!.n;
        // An over-long name violates the table constraint after the account row was inserted.
        await expect(createGuestWithCharacter(db, { ...input, displayName: "x".repeat(41) }, PROFILE_VERSION, spawn)).rejects.toThrow();
        const after = (await db.query<{ n: number }>("SELECT count(*)::int AS n FROM accounts")).rows[0]!.n;
        expect(after).toBe(before);
      });
    });
  });
}
