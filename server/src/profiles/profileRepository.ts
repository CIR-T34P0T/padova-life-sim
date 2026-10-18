// SQL for accounts and character profiles. Every read or write of a
// character is scoped by the owning account id, which the caller takes from
// the authenticated session, never from client input. A mismatched owner
// simply finds nothing, so one player cannot read or change another's profile.

import { randomUUID } from "node:crypto";
import type { Appearance, NewCharacterInput } from "@padova/shared";
import type { Database, Queryable } from "../db/database.ts";
import { generateGuestToken, hashGuestToken, isWellFormedGuestToken } from "../identity/guestIdentity.ts";
import { insertInitialLife } from "../life/lifeRepository.ts";

/** Starting life data written with a new character (M5). */
export interface LifeSeed {
  startingBalanceCents: number;
  gameMinute: number;
}

export interface SavedState {
  area: string;
  x: number;
  z: number;
  rotation: number;
}

export interface StoredCharacter {
  characterId: string;
  accountId: string;
  displayName: string;
  ageCategory: string;
  profileVersion: number;
  createdAt: Date;
  updatedAt: Date;
  /** Raw stored values; validate with sanitizeStoredAppearance before use. */
  appearance: Record<keyof Appearance, unknown>;
  /** Raw stored trait ids; clean with sanitizeStoredTraits. */
  traits: unknown[];
  state: SavedState | null;
}

export interface Owner {
  accountId: string;
  characterId: string;
}

interface CharacterRow {
  character_id: string;
  account_id: string;
  display_name: string;
  age_category: string;
  profile_version: number;
  created_at: Date;
  updated_at: Date;
  preset: unknown;
  skin_tone: unknown;
  hair_style: unknown;
  hair_colour: unknown;
  eye_colour: unknown;
  outfit: unknown;
  area: string | null;
  pos_x: number | null;
  pos_z: number | null;
  rotation: number | null;
  traits: unknown[] | null;
}

const SELECT_CHARACTER = `
  SELECT c.id AS character_id, c.account_id, c.display_name, c.age_category, c.profile_version,
         c.created_at, c.updated_at,
         a.preset, a.skin_tone, a.hair_style, a.hair_colour, a.eye_colour, a.outfit,
         s.area, s.pos_x, s.pos_z, s.rotation,
         (SELECT array_agg(t.trait ORDER BY t.trait) FROM character_traits t WHERE t.character_id = c.id) AS traits
    FROM characters c
    JOIN character_appearance a ON a.character_id = c.id
    LEFT JOIN character_state s ON s.character_id = c.id`;

function toStored(row: CharacterRow): StoredCharacter {
  return {
    characterId: row.character_id,
    accountId: row.account_id,
    displayName: row.display_name,
    ageCategory: row.age_category,
    profileVersion: Number(row.profile_version),
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
    appearance: {
      preset: row.preset,
      skinTone: row.skin_tone,
      hairStyle: row.hair_style,
      hairColour: row.hair_colour,
      eyeColour: row.eye_colour,
      outfit: row.outfit,
    },
    traits: Array.isArray(row.traits) ? row.traits : [],
    state:
      row.pos_x === null || row.pos_z === null
        ? null
        : { area: row.area ?? "plaza", x: Number(row.pos_x), z: Number(row.pos_z), rotation: Number(row.rotation ?? 0) },
  };
}

async function insertCharacter(
  tx: Queryable,
  accountId: string,
  input: NewCharacterInput,
  profileVersion: number,
  spawn: SavedState,
  seed: LifeSeed,
): Promise<string> {
  const characterId = randomUUID();
  const { appearance } = input;
  await tx.query(
    `INSERT INTO characters (id, account_id, display_name, age_category, profile_version) VALUES ($1, $2, $3, $4, $5)`,
    [characterId, accountId, input.displayName, input.ageCategory, profileVersion],
  );
  await tx.query(
    `INSERT INTO character_appearance (character_id, preset, skin_tone, hair_style, hair_colour, eye_colour, outfit)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [characterId, appearance.preset, appearance.skinTone, appearance.hairStyle, appearance.hairColour, appearance.eyeColour, appearance.outfit],
  );
  await tx.query(`INSERT INTO character_state (character_id, area, pos_x, pos_z, rotation) VALUES ($1, $2, $3, $4, $5)`, [
    characterId,
    spawn.area,
    spawn.x,
    spawn.z,
    spawn.rotation,
  ]);
  await insertInitialLife(tx, characterId, input.traits, seed.startingBalanceCents, seed.gameMinute);
  return characterId;
}

/** Creates a guest account, its credential and its first character in one transaction. */
export async function createGuestWithCharacter(
  db: Database,
  input: NewCharacterInput,
  profileVersion: number,
  spawn: SavedState,
  seed: LifeSeed,
): Promise<{ accountId: string; guestToken: string; character: StoredCharacter }> {
  const accountId = randomUUID();
  const guestToken = generateGuestToken();
  const characterId = await db.transaction(async (tx) => {
    await tx.query(`INSERT INTO accounts (id, kind) VALUES ($1, 'guest')`, [accountId]);
    await tx.query(`INSERT INTO guest_credentials (account_id, token_hash) VALUES ($1, $2)`, [accountId, hashGuestToken(guestToken)]);
    return insertCharacter(tx, accountId, input, profileVersion, spawn, seed);
  });
  const character = await loadCharacterById(db, { accountId, characterId });
  if (!character) throw new Error("Character vanished right after creation");
  return { accountId, guestToken, character };
}

/** Adds a character to an existing account. Null if the account already has one. */
export async function createCharacterForAccount(
  db: Database,
  accountId: string,
  input: NewCharacterInput,
  profileVersion: number,
  spawn: SavedState,
  seed: LifeSeed,
): Promise<StoredCharacter | null> {
  const existing = await loadCharacterByAccount(db, accountId);
  if (existing) return null;
  try {
    const characterId = await db.transaction((tx) => insertCharacter(tx, accountId, input, profileVersion, spawn, seed));
    return loadCharacterById(db, { accountId, characterId });
  } catch (error) {
    if (isUniqueViolation(error)) return null; // created concurrently by another session
    throw error;
  }
}

/** Resolves a guest token to its account id, or null. Updates last_seen_at. */
export async function findAccountIdByGuestToken(db: Database, token: string): Promise<string | null> {
  if (!isWellFormedGuestToken(token)) return null;
  const { rows } = await db.query<{ account_id: string }>(
    `UPDATE accounts SET last_seen_at = now()
      WHERE id = (SELECT account_id FROM guest_credentials WHERE token_hash = $1)
      RETURNING id AS account_id`,
    [hashGuestToken(token)],
  );
  return rows[0]?.account_id ?? null;
}

export async function loadCharacterByAccount(db: Queryable, accountId: string): Promise<StoredCharacter | null> {
  const { rows } = await db.query<CharacterRow>(`${SELECT_CHARACTER} WHERE c.account_id = $1 ORDER BY c.created_at LIMIT 1`, [accountId]);
  return rows[0] ? toStored(rows[0]) : null;
}

export async function loadCharacterById(db: Queryable, owner: Owner): Promise<StoredCharacter | null> {
  const { rows } = await db.query<CharacterRow>(`${SELECT_CHARACTER} WHERE c.id = $1 AND c.account_id = $2`, [owner.characterId, owner.accountId]);
  return rows[0] ? toStored(rows[0]) : null;
}

/**
 * Saves appearance (and the profile version it conforms to) for a character
 * owned by `owner.accountId`. Returns the updated character, or null when that
 * account does not own that character.
 */
export async function updateAppearance(
  db: Database,
  owner: Owner,
  appearance: Appearance,
  profileVersion: number,
): Promise<StoredCharacter | null> {
  const updated = await db.transaction(async (tx) => {
    const owned = await tx.query(
      `UPDATE characters SET profile_version = $3, updated_at = now() WHERE id = $1 AND account_id = $2 RETURNING id`,
      [owner.characterId, owner.accountId, profileVersion],
    );
    if (owned.rows.length === 0) return false;
    await tx.query(
      `UPDATE character_appearance
          SET preset = $2, skin_tone = $3, hair_style = $4, hair_colour = $5, eye_colour = $6, outfit = $7, updated_at = now()
        WHERE character_id = $1`,
      [owner.characterId, appearance.preset, appearance.skinTone, appearance.hairStyle, appearance.hairColour, appearance.eyeColour, appearance.outfit],
    );
    return true;
  });
  return updated ? loadCharacterById(db, owner) : null;
}

/** Saves where the character is. Returns false when the owner does not match. */
export async function saveState(db: Queryable, owner: Owner, state: SavedState): Promise<boolean> {
  const { rows } = await db.query(
    `INSERT INTO character_state (character_id, area, pos_x, pos_z, rotation, updated_at)
       SELECT c.id, $3, $4, $5, $6, now() FROM characters c WHERE c.id = $1 AND c.account_id = $2
     ON CONFLICT (character_id) DO UPDATE
       SET area = EXCLUDED.area, pos_x = EXCLUDED.pos_x, pos_z = EXCLUDED.pos_z,
           rotation = EXCLUDED.rotation, updated_at = now()
     RETURNING character_id`,
    [owner.characterId, owner.accountId, state.area, state.x, state.z, state.rotation],
  );
  return rows.length > 0;
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: string }).code === "23505";
}
