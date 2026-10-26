// Migrations and the profile repository against real PostgreSQL engines
// (PGlite always; a PostgreSQL server too when TEST_DATABASE_URL is set).

import { APPEARANCE_PRESETS, DEFAULT_APPEARANCE, PROFILE_VERSION, cloneAppearance, legacyAppearanceProjection, type NewCharacterInput } from "@padova/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "../src/db/database.ts";
import { redactUrl } from "../src/db/database.ts";
import { appliedVersions, loadMigrations, migrate, rollback, splitStatements } from "../src/db/migrate.ts";
import { hashGuestToken, isWellFormedGuestToken } from "../src/identity/guestIdentity.ts";
import {
  createCharacterForAccount,
  createGuestWithCharacter,
  deleteCharacter,
  findAccountIdByGuestToken,
  listCharactersByAccount,
  loadCharacterById,
  saveState,
  updateAppearance,
} from "../src/profiles/profileRepository.ts";
import { testBackends } from "./helpers/testDatabase.ts";

const input: NewCharacterInput = { displayName: "Giulia", ageCategory: "adult", appearance: cloneAppearance(DEFAULT_APPEARANCE), traits: [] };
const spawn = { area: "plaza", x: 0, z: 13, rotation: Math.PI };
const seed = { startingBalanceCents: 10_000, gameMinute: 480 };

const firstCharacter = async (db: Database, accountId: string) => (await listCharactersByAccount(db, accountId))[0] ?? null;

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
        const { accountId, guestToken, character } = await createGuestWithCharacter(db, input, PROFILE_VERSION, spawn, seed);
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
        const { accountId, guestToken } = await createGuestWithCharacter(db, input, PROFILE_VERSION, spawn, seed);
        expect(await findAccountIdByGuestToken(db, guestToken)).toBe(accountId);
        const tampered = guestToken.slice(0, -1) + (guestToken.endsWith("A") ? "B" : "A");
        expect(await findAccountIdByGuestToken(db, tampered)).toBeNull();
        expect(await findAccountIdByGuestToken(db, "not-a-token")).toBeNull();
        expect(await findAccountIdByGuestToken(db, accountId)).toBeNull(); // an account id is not proof of ownership
      });

      it("saves and loads appearance and position", async () => {
        const { accountId, character } = await createGuestWithCharacter(db, input, PROFILE_VERSION, spawn, seed);
        const owner = { accountId, characterId: character.characterId };
        const changed = APPEARANCE_PRESETS.find((p) => p.id === "locs-beard")!.appearance;
        const updated = await updateAppearance(db, owner, changed, PROFILE_VERSION);
        expect(updated?.appearance).toEqual(changed);
        expect(updated!.updatedAt.getTime()).toBeGreaterThanOrEqual(character.updatedAt.getTime());
        expect(await saveState(db, owner, { area: "plaza", x: -4.5, z: 2.25, rotation: 1 })).toBe(true);
        const loaded = await firstCharacter(db, accountId);
        expect(loaded?.appearance).toEqual(changed);
        // The M4 columns hold the closest old look, for rollback (migration 0003).
        const legacy = await db.query("SELECT preset, skin_tone, hair_style, hair_colour, eye_colour, outfit FROM character_appearance WHERE character_id = $1", [character.characterId]);
        const projection = legacyAppearanceProjection(changed);
        expect(legacy.rows[0]).toEqual({
          preset: projection.preset, skin_tone: projection.skinTone, hair_style: projection.hairStyle,
          hair_colour: projection.hairColour, eye_colour: projection.eyeColour, outfit: projection.outfit,
        });
        expect(legacy.rows[0]).toMatchObject({ preset: "male", skin_tone: "skin-8", hair_style: "long" });
        expect(loaded?.state).toMatchObject({ x: -4.5, z: 2.25 });
        expect(loaded?.state?.rotation).toBeCloseTo(1, 5);
      });

      it("refuses reads and writes by an account that does not own the character", async () => {
        const alice = await createGuestWithCharacter(db, input, PROFILE_VERSION, spawn, seed);
        const bruno = await createGuestWithCharacter(db, { ...input, displayName: "Bruno" }, PROFILE_VERSION, spawn, seed);
        const brunoAttack = { accountId: bruno.accountId, characterId: alice.character.characterId };
        expect(await updateAppearance(db, brunoAttack, APPEARANCE_PRESETS[3]!.appearance, PROFILE_VERSION)).toBeNull();
        expect(await saveState(db, brunoAttack, { area: "plaza", x: 20, z: 20, rotation: 0 })).toBe(false);
        expect(await loadCharacterById(db, brunoAttack)).toBeNull();
        const aliceNow = await firstCharacter(db, alice.accountId);
        expect(aliceNow?.appearance).toEqual(DEFAULT_APPEARANCE);
        expect(aliceNow?.state).toMatchObject({ x: 0, z: 13 });
      });

      it("allows several characters per account up to the limit, also when created at the same time", async () => {
        const { accountId } = await createGuestWithCharacter(db, input, PROFILE_VERSION, spawn, seed);
        const second = await createCharacterForAccount(db, accountId, { ...input, displayName: "Second" }, PROFILE_VERSION, spawn, seed, 3);
        expect(second).toMatchObject({ displayName: "Second", accountId });
        // Two windows creating the third and fourth at once: exactly one fits.
        const racing = await Promise.all([
          createCharacterForAccount(db, accountId, { ...input, displayName: "Third" }, PROFILE_VERSION, spawn, seed, 3),
          createCharacterForAccount(db, accountId, { ...input, displayName: "Fourth" }, PROFILE_VERSION, spawn, seed, 3),
        ]);
        expect(racing.filter((r) => r === "too_many_characters")).toHaveLength(1);
        const names = (await listCharactersByAccount(db, accountId)).map((c) => c.displayName);
        expect(names).toHaveLength(3);
        expect(names).toContain("Giulia");
        expect(await createCharacterForAccount(db, crypto.randomUUID(), input, PROFILE_VERSION, spawn, seed, 3)).toBe("no_account");
      });

      it("lists an account's characters most recently played first, and only its own", async () => {
        const { accountId, character } = await createGuestWithCharacter(db, input, PROFILE_VERSION, spawn, seed);
        const other = await createGuestWithCharacter(db, { ...input, displayName: "Other" }, PROFILE_VERSION, spawn, seed);
        const second = await createCharacterForAccount(db, accountId, { ...input, displayName: "Second" }, PROFILE_VERSION, spawn, seed, 3);
        if (typeof second === "string") throw new Error(second);
        await db.query("UPDATE character_state SET updated_at = now() - interval '1 hour' WHERE character_id = $1", [second.characterId]);
        expect((await listCharactersByAccount(db, accountId)).map((c) => c.displayName)).toEqual(["Giulia", "Second"]);
        await saveState(db, { accountId, characterId: second.characterId }, { area: "plaza", x: 1, z: 1, rotation: 0 });
        const list = await listCharactersByAccount(db, accountId);
        expect(list.map((c) => c.displayName)).toEqual(["Second", "Giulia"]);
        expect(list[0]!.lastPlayedAt!.getTime()).toBeGreaterThanOrEqual(list[1]!.lastPlayedAt!.getTime());
        expect(list.map((c) => c.characterId)).not.toContain(other.character.characterId);
        expect(character.lastPlayedAt).toBeInstanceOf(Date);
      });

      it("deletes a character with all its data, only for its owner", async () => {
        const alice = await createGuestWithCharacter(db, input, PROFILE_VERSION, spawn, seed);
        const bruno = await createGuestWithCharacter(db, { ...input, displayName: "Bruno" }, PROFILE_VERSION, spawn, seed);
        const kept = await createCharacterForAccount(db, alice.accountId, { ...input, displayName: "Kept" }, PROFILE_VERSION, spawn, seed, 3);
        if (typeof kept === "string") throw new Error(kept);
        const id = alice.character.characterId;
        expect(await deleteCharacter(db, { accountId: bruno.accountId, characterId: id })).toBe(false);
        expect(await loadCharacterById(db, { accountId: alice.accountId, characterId: id })).not.toBeNull();
        expect(await deleteCharacter(db, { accountId: alice.accountId, characterId: id })).toBe(true);
        expect(await deleteCharacter(db, { accountId: alice.accountId, characterId: id })).toBe(false);
        for (const table of ["character_appearance", "character_state", "character_needs", "character_wallets", "wallet_transactions", "character_traits", "character_skills", "character_employment", "work_shifts"]) {
          const left = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${table} WHERE character_id = $1`, [id]);
          expect(left.rows[0]!.n, table).toBe(0);
        }
        // The account, its token and its other character stay.
        expect((await listCharactersByAccount(db, alice.accountId)).map((c) => c.displayName)).toEqual(["Kept"]);
        expect(await findAccountIdByGuestToken(db, alice.guestToken)).toBe(alice.accountId);
      });

      it("rolls back migration 0004 only when no profile holds more than one character", async () => {
        const { accountId } = await createGuestWithCharacter(db, input, PROFILE_VERSION, spawn, seed);
        // 0005 (no jobs or wages yet) rolls back first, then 0004.
        expect(await rollback(db, 2)).toEqual([5, 4]);
        await expect(createCharacterForAccount(db, accountId, { ...input, displayName: "Blocked" }, PROFILE_VERSION, spawn, seed, 3)).rejects.toThrow();
        await migrate(db);
        const second = await createCharacterForAccount(db, accountId, { ...input, displayName: "Second" }, PROFILE_VERSION, spawn, seed, 3);
        expect(typeof second).toBe("object");
        expect(await rollback(db)).toEqual([5]);
        await expect(rollback(db)).rejects.toThrow();
        // Nothing changed: both characters are still there and 0004 is still applied.
        expect(await listCharactersByAccount(db, accountId)).toHaveLength(2);
        expect(await appliedVersions(db)).toContain(4);
      });

      it("enforces age category and version constraints in the database itself", async () => {
        const { accountId, character } = await createGuestWithCharacter(db, input, PROFILE_VERSION, spawn, seed);
        await expect(db.query("UPDATE characters SET age_category = 'toddler' WHERE id = $1", [character.characterId])).rejects.toThrow();
        await expect(db.query("UPDATE characters SET profile_version = 0 WHERE id = $1", [character.characterId])).rejects.toThrow();
        await expect(db.query("INSERT INTO accounts (id, kind) VALUES ($1, 'admin')", [crypto.randomUUID()])).rejects.toThrow();
        expect(accountId).toBeTruthy();
      });

      it("stores appearance as a JSON object and refuses oversized or non-object documents", async () => {
        const { character } = await createGuestWithCharacter(db, input, PROFILE_VERSION, spawn, seed);
        const id = character.characterId;
        const kind = await db.query<{ t: string }>("SELECT jsonb_typeof(config) AS t FROM character_appearance WHERE character_id = $1", [id]);
        expect(kind.rows[0]!.t).toBe("object");
        await expect(db.query(`UPDATE character_appearance SET config = '"a string"'::jsonb WHERE character_id = $1`, [id])).rejects.toThrow();
        const huge = JSON.stringify({ v: 1, junk: "x".repeat(5000) });
        await expect(db.query("UPDATE character_appearance SET config = $2::jsonb WHERE character_id = $1", [id, huge])).rejects.toThrow();
      });

      it("rolls back the appearance document to the M5 shape with the closest old look, and upgrades again", async () => {
        const { accountId, character } = await createGuestWithCharacter(db, { ...input, appearance: APPEARANCE_PRESETS[0]!.appearance }, PROFILE_VERSION, spawn, seed);
        expect(loadMigrations().at(-1)!.version).toBe(5); // rolls back 0005 and 0004 (no data change), then 0003
        expect(await rollback(db, 3)).toEqual([5, 4, 3]);
        const old = await db.query<{ profile_version: number; preset: string; skin_tone: string }>(
          "SELECT c.profile_version, a.preset, a.skin_tone FROM characters c JOIN character_appearance a ON a.character_id = c.id WHERE c.id = $1",
          [character.characterId],
        );
        expect(old.rows[0]).toEqual({ profile_version: 2, preset: "female", skin_tone: "skin-7" });
        await migrate(db);
        const reloaded = await firstCharacter(db, accountId);
        expect(reloaded?.profileVersion).toBe(2);
        expect(reloaded?.appearance).toMatchObject({ preset: "female", skinTone: "skin-7", hairStyle: "short" });
      });

      it("rolls back a failed creation completely", async () => {
        const before = (await db.query<{ n: number }>("SELECT count(*)::int AS n FROM accounts")).rows[0]!.n;
        // An over-long name violates the table constraint after the account row was inserted.
        await expect(createGuestWithCharacter(db, { ...input, displayName: "x".repeat(41) }, PROFILE_VERSION, spawn, seed)).rejects.toThrow();
        const after = (await db.query<{ n: number }>("SELECT count(*)::int AS n FROM accounts")).rows[0]!.n;
        expect(after).toBe(before);
      });
    });
  });
}

describe("database configuration", () => {
  it("uses real PostgreSQL only when DATABASE_URL is set, and resolves PGlite folders from the repo root", async () => {
    const { databaseConfigFromEnv, DEFAULT_PGLITE_DIR } = await import("../src/db/database.ts");
    expect(databaseConfigFromEnv({ DATABASE_URL: "postgresql://u:p@h/db" })).toEqual({ kind: "postgres", url: "postgresql://u:p@h/db" });
    expect(databaseConfigFromEnv({})).toEqual({ kind: "pglite", dataDir: DEFAULT_PGLITE_DIR });
    expect(databaseConfigFromEnv({ DATABASE_URL: "  " })).toEqual({ kind: "pglite", dataDir: DEFAULT_PGLITE_DIR });
    expect(databaseConfigFromEnv({ PGLITE_DATA_DIR: "memory://" })).toEqual({ kind: "pglite", dataDir: null });
    // ".data/pglite" relative = the default folder, wherever the command runs from.
    expect(databaseConfigFromEnv({ PGLITE_DATA_DIR: ".data/pglite" })).toEqual({ kind: "pglite", dataDir: DEFAULT_PGLITE_DIR });
  });
});
