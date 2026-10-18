// Database-backed life use-cases: load (with the offline catch-up), save
// together with the position, and money changes. Owners always come from the
// authenticated session, never from client data.

import {
  ECONOMY_CONFIG,
  activeMoodEvents,
  findMenuItem,
  gameDayOf,
  offlineCatchUp,
  realMsToGameHours,
  sanitizeMoodEvents,
  sanitizeNeeds,
  sanitizeSkills,
  sanitizeStoredTraits,
  type ActiveMoodEvent,
  type Needs,
  type SkillXp,
  type TraitId,
  type TransactionView,
} from "@padova/shared";
import type { Database } from "../db/database.ts";
import { saveState, type Owner, type SavedState } from "../profiles/profileRepository.ts";
import { applyMoneyChange, loadLife, saveLife, type LifeSnapshot, type MoneyChangeResult } from "./lifeRepository.ts";

/** A character's life as the room simulates it. */
export interface LoadedLife {
  traits: TraitId[];
  needs: Needs;
  skills: SkillXp;
  moodEvents: ActiveMoodEvent[];
  balanceCents: number;
  recent: TransactionView[];
  /** Game hours of offline time that were applied (after the cap is applied by the rules). */
  offlineGameHours: number;
}

export interface LifeServiceOptions {
  timeScale: number;
  dailyAllowanceCents: number;
  now?: () => number;
}

export class LifeService {
  private readonly now: () => number;

  constructor(
    readonly db: Database,
    private readonly options: LifeServiceOptions,
  ) {
    this.now = options.now ?? Date.now;
  }

  /** Loads life data and applies the capped offline catch-up (D-022). Null if not the owner's. */
  async load(owner: Owner, gameMinute: number): Promise<LoadedLife | null> {
    const stored = await loadLife(this.db, owner, ECONOMY_CONFIG.recentTransactions);
    if (!stored) return null;
    const traits = sanitizeStoredTraits(stored.traits);
    const savedNeeds = sanitizeNeeds(stored.needs);
    const offlineMs = stored.needsSavedAt ? Math.max(0, this.now() - stored.needsSavedAt.getTime()) : 0;
    const offlineGameHours = realMsToGameHours(offlineMs, this.options.timeScale);
    return {
      traits,
      needs: offlineCatchUp(savedNeeds, offlineGameHours, traits),
      skills: sanitizeSkills(stored.skills),
      moodEvents: activeMoodEvents(sanitizeMoodEvents(stored.moodEvents), gameMinute),
      balanceCents: stored.balanceCents,
      recent: stored.recent,
      offlineGameHours,
    };
  }

  /** Saves position and life data in one transaction. False if the owner does not match. */
  async saveAll(owner: Owner, position: SavedState, life: LifeSnapshot | null): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      const saved = await saveState(tx, owner, position);
      if (!saved) return false;
      if (life) await saveLife(tx, owner, life);
      return true;
    });
  }

  /** Charges for a café item. Prices come from the server catalogue only. */
  purchase(owner: Owner, itemId: string, requestKey: string, gameMinute: number): Promise<MoneyChangeResult | { status: "unknown_item" }> {
    const item = findMenuItem(itemId);
    if (!item) return Promise.resolve({ status: "unknown_item" });
    return applyMoneyChange(this.db, owner, {
      direction: "expense",
      category: "purchase",
      amountCents: item.priceCents,
      description: item.label,
      itemId: item.id,
      requestKey,
      gameMinute,
    });
  }

  /** Gives back the price of a purchase that could not be served. Idempotent per purchase. */
  refund(owner: Owner, itemId: string, purchaseKey: string, gameMinute: number): Promise<MoneyChangeResult | { status: "unknown_item" }> {
    const item = findMenuItem(itemId);
    if (!item) return Promise.resolve({ status: "unknown_item" });
    return applyMoneyChange(this.db, owner, {
      direction: "income",
      category: "refund",
      amountCents: item.priceCents,
      description: `Refund: ${item.label}`,
      itemId: item.id,
      requestKey: `refund:${purchaseKey}`,
      gameMinute,
    });
  }

  /** The daily allowance for the game day of `gameMinute`; at most once per day per character. Null when disabled (0). */
  async grantDailyAllowance(owner: Owner, gameMinute: number): Promise<MoneyChangeResult | null> {
    if (this.options.dailyAllowanceCents <= 0) return null;
    const day = gameDayOf(gameMinute);
    return applyMoneyChange(this.db, owner, {
      direction: "income",
      category: "allowance",
      amountCents: this.options.dailyAllowanceCents,
      description: "Daily allowance",
      requestKey: `allowance:day-${day}`,
      gameMinute,
    });
  }
}
