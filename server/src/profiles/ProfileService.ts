// Profile use-cases for the room: authenticate a guest token, load (with
// upgrade/repair), create, change appearance, save position. The room passes
// in the account id from the authenticated session; this service never
// accepts an owner from client data.

import {
  PROFILE_VERSION,
  sanitizeAppearance,
  sanitizeStoredTraits,
  upgradeProfileData,
  type AgeCategory,
  type AppearanceConfig,
  type CharacterProfile,
  type NewCharacterInput,
  type TraitId,
} from "@padova/shared";
import type { Database } from "../db/database.ts";
import { log } from "../log.ts";
import {
  createCharacterForAccount,
  createGuestWithCharacter,
  findAccountIdByGuestToken,
  loadCharacterByAccount,
  saveState,
  updateAppearance,
  type Owner,
  type SavedState,
  type LifeSeed,
  type StoredCharacter,
} from "./profileRepository.ts";

export interface LoadedCharacter {
  owner: Owner;
  profile: CharacterProfile;
  state: SavedState | null;
  /** True when the stored data is from a newer version: usable, but never overwritten here. */
  readOnly: boolean;
  notices: string[];
}

export interface ProfileServiceOptions {
  guestCreationsPerIpPerHour: number;
  now?: () => number;
}

export class ProfileService {
  private readonly creationsByIp = new Map<string, number[]>();
  private readonly now: () => number;

  constructor(
    readonly db: Database,
    private readonly options: ProfileServiceOptions,
  ) {
    this.now = options.now ?? Date.now;
  }

  /** Account id for a guest token; null if the token is unknown. */
  authenticate(guestToken: string): Promise<string | null> {
    return findAccountIdByGuestToken(this.db, guestToken);
  }

  async load(accountId: string): Promise<LoadedCharacter | null> {
    const stored = await loadCharacterByAccount(this.db, accountId);
    return stored ? this.prepare(stored) : null;
  }

  /** Simple sliding-window limit on new guest accounts per IP. */
  allowGuestCreation(ip: string | undefined): boolean {
    const key = ip ?? "unknown";
    const hourAgo = this.now() - 3_600_000;
    const recent = (this.creationsByIp.get(key) ?? []).filter((t) => t > hourAgo);
    if (recent.length >= this.options.guestCreationsPerIpPerHour) {
      this.creationsByIp.set(key, recent);
      return false;
    }
    recent.push(this.now());
    this.creationsByIp.set(key, recent);
    return true;
  }

  /**
   * Creates a character. With `accountId` null, a new guest account is created
   * too and its token returned (shown to the client once). Returns
   * "already_has_character" if the account already has one.
   */
  async create(
    input: NewCharacterInput,
    accountId: string | null,
    spawn: SavedState,
    seed: LifeSeed,
  ): Promise<{ accountId: string; guestToken: string | null; loaded: LoadedCharacter } | "already_has_character"> {
    if (accountId) {
      const stored = await createCharacterForAccount(this.db, accountId, input, PROFILE_VERSION, spawn, seed);
      if (!stored) return "already_has_character";
      return { accountId, guestToken: null, loaded: await this.prepare(stored) };
    }
    const created = await createGuestWithCharacter(this.db, input, PROFILE_VERSION, spawn, seed);
    return { accountId: created.accountId, guestToken: created.guestToken, loaded: await this.prepare(created.character) };
  }

  async updateAppearance(owner: Owner, appearance: AppearanceConfig): Promise<CharacterProfile | null> {
    const stored = await updateAppearance(this.db, owner, appearance, PROFILE_VERSION);
    return stored
      ? toProfile(stored, sanitizeAppearance(stored.appearance).appearance, stored.profileVersion, sanitizeStoredTraits(stored.traits))
      : null;
  }

  saveState(owner: Owner, state: SavedState): Promise<boolean> {
    return saveState(this.db, owner, state);
  }

  /** Upgrades and repairs stored data; persists the repaired version when allowed. */
  private async prepare(stored: StoredCharacter): Promise<LoadedCharacter> {
    const owner = { accountId: stored.accountId, characterId: stored.characterId };
    const notices: string[] = [];
    const upgrade = upgradeProfileData({
      profileVersion: stored.profileVersion,
      displayName: stored.displayName,
      ageCategory: stored.ageCategory,
      appearance: stored.appearance,
      traits: stored.traits,
    });

    if (!upgrade.ok) {
      // Never overwrite data this server does not understand. Use a safe copy in memory.
      log.warn("profiles", `character ${stored.characterId} has profile version ${stored.profileVersion}: ${upgrade.reason}; loading read-only`);
      notices.push("Your profile was saved by a newer version of the game, so it can't be edited here.");
      const safe = sanitizeAppearance(stored.appearance).appearance;
      return {
        owner,
        profile: toProfile(stored, safe, stored.profileVersion, sanitizeStoredTraits(stored.traits)),
        state: stored.state,
        readOnly: true,
        notices,
      };
    }

    const traits = sanitizeStoredTraits(upgrade.data.traits ?? []);

    const repaired = sanitizeAppearance(upgrade.data.appearance);
    if (repaired.replaced.length > 0) notices.push(appearanceNotice(repaired.replaced));
    if (upgrade.upgraded || repaired.changed) {
      const saved = await updateAppearance(this.db, owner, repaired.appearance, PROFILE_VERSION);
      if (saved) {
        log.info("profiles", `character ${stored.characterId} upgraded/repaired (fields: ${repaired.replaced.join(", ") || "none"})`);
        return { owner, profile: toProfile(saved, repaired.appearance, PROFILE_VERSION, traits), state: stored.state, readOnly: false, notices };
      }
    }
    return { owner, profile: toProfile(stored, repaired.appearance, PROFILE_VERSION, traits), state: stored.state, readOnly: false, notices };
  }
}

const SECTION_NAMES: Record<string, string> = { body: "body", skin: "skin", face: "face", hair: "hair", outfit: "outfit" };

/** One readable notice for the player, e.g. "Some hair and outfit options you chose are no longer available…". */
function appearanceNotice(replaced: string[]): string {
  if (replaced.includes("appearance")) return "Your saved appearance couldn't be read, so a default look was chosen. You can change it any time.";
  const sections = [...new Set(replaced.map((path) => SECTION_NAMES[path.split(".")[0] ?? ""] ?? "appearance"))];
  const list = sections.length > 1 ? `${sections.slice(0, -1).join(", ")} and ${sections.at(-1)}` : sections[0];
  return `Some ${list} options you chose are no longer available, so defaults were chosen. You can change them any time.`;
}

function toProfile(stored: StoredCharacter, appearance: AppearanceConfig, profileVersion: number, traits: TraitId[]): CharacterProfile {
  return {
    characterId: stored.characterId,
    displayName: stored.displayName,
    ageCategory: stored.ageCategory as AgeCategory,
    appearance,
    traits,
    profileVersion,
    createdAt: stored.createdAt.toISOString(),
    updatedAt: stored.updatedAt.toISOString(),
  };
}
