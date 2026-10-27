// Relationships, blocks, reports and the story log in the room (M9).
// Shared moments come from the interaction system (a greeting, a chat,
// studying at the same table, the same lecture); blocks are checked before
// any player action; reports are stored for the product owner and also
// block. Everything here goes only to the players concerned: a relationship
// to its two players, blocks, reports and the story to their owner. Rules
// and numbers come from shared/; SQL lives in socialRepository.ts.

import {
  RELATIONSHIP_CONFIG,
  STORY_CONFIG,
  ServerMessage,
  gameDayOf,
  parseReport,
  parseTarget,
  parseUnblock,
  reachesLevel,
  relationshipLevel,
  type InteractionFailure,
  type MoodEventId,
  type ProfileViewPayload,
  type RelationshipPayload,
  type SafetyPayload,
  type SharedMomentKind,
  type SocialResultPayload,
  type StoryPayload,
} from "@padova/shared";
import type { Database } from "../db/database.ts";
import type { GameClock } from "../life/LifeSystem.ts";
import { log } from "../log.ts";
import type { Owner } from "../profiles/profileRepository.ts";
import type { PlayerRuntime } from "../runtime.ts";
import type { PlazaState } from "../schema.ts";
import {
  addStoryEvent,
  blockAccount,
  insertReport,
  listBlocks,
  loadRelationship,
  purgeReports,
  recentStory,
  recordMoment,
  unblock,
  type BlockRow,
  type StoryInput,
} from "./socialRepository.ts";

export interface SocialDeps {
  db: Database;
  state: PlazaState;
  runtimes: Map<string, PlayerRuntime>;
  /** The owner (account and character) playing in this session, or null. */
  ownerOf(sessionId: string): Owner | null;
  clock: GameClock;
  send(sessionId: string, type: string, payload: unknown): void;
  /** Stops greetings or chats between two players (after a block). */
  cancelBetween(a: string, b: string): void;
  /** Gives a character a mood event (e.g. a new friend). */
  moodEvent(sessionId: string, id: MoodEventId): void;
}

/** What the interaction system asks of the social system. */
export interface SocialHooks {
  /** Why one player can't target another (a block either way), or null. */
  refusal(actorId: string, targetId: string): InteractionFailure | null;
  /** A shared moment happened between two players. */
  shared(a: string, b: string, kind: SharedMomentKind): void;
}

export class SocialSystem implements SocialHooks {
  /** Blocks of the accounts in the world: blocker account → blocked account → block. */
  private readonly blocks = new Map<string, Map<string, BlockRow>>();
  private readonly lastSafetyKey = new Map<string, string>();

  constructor(private readonly deps: SocialDeps) {}

  // ── Joining and leaving ─────────────────────────────────────────────────

  /** A character entered the world: load its account's blocks and its story, and update everyone's menus. */
  async attach(sessionId: string): Promise<void> {
    const owner = this.deps.ownerOf(sessionId);
    if (!owner) return;
    try {
      await this.reloadBlocks(owner.accountId);
      await this.sendStory(sessionId, owner);
    } catch (error) {
      log.error("social", `loading social data for ${sessionId} failed: ${(error as Error).message}`);
    }
    this.refreshSafety();
  }

  /** A dropped player reconnected: messages sent meanwhile were lost, so send their blocks and story again. */
  async resync(sessionId: string): Promise<void> {
    const owner = this.deps.ownerOf(sessionId);
    if (!owner) return;
    this.lastSafetyKey.delete(sessionId);
    this.refreshSafety();
    try {
      await this.sendStory(sessionId, owner);
    } catch (error) {
      log.error("social", `story for ${sessionId} after reconnecting failed: ${(error as Error).message}`);
    }
  }

  /** A character left the world for good. */
  detach(sessionId: string): void {
    const owner = this.deps.ownerOf(sessionId);
    if (owner && !this.sessionsOf(owner.accountId).some((id) => id !== sessionId)) this.blocks.delete(owner.accountId);
    this.lastSafetyKey.delete(sessionId);
  }

  // ── Hooks for the interaction system ────────────────────────────────────

  refusal(actorId: string, targetId: string): InteractionFailure | null {
    const a = this.deps.ownerOf(actorId)?.accountId;
    const b = this.deps.ownerOf(targetId)?.accountId;
    if (!a || !b) return null;
    return this.isBlockedEitherWay(a, b) ? "not_reachable" : null;
  }

  shared(a: string, b: string, kind: SharedMomentKind): void {
    const ownerA = this.deps.ownerOf(a);
    const ownerB = this.deps.ownerOf(b);
    if (!ownerA || !ownerB || this.isBlockedEitherWay(ownerA.accountId, ownerB.accountId)) return;
    const gameMinute = this.deps.clock.minute();
    void recordMoment(this.deps.db, { a: ownerA, b: ownerB, kind, gameDay: gameDayOf(gameMinute), gameMinute })
      .then((result) => {
        if (result.status !== "counted") return;
        const level = relationshipLevel(result.score);
        const levelUp = level.id !== relationshipLevel(result.before).id;
        for (const [self, other] of [
          [a, b],
          [b, a],
        ] as const) {
          const payload: RelationshipPayload = {
            otherId: other,
            otherName: this.deps.state.players.get(other)?.name ?? "",
            score: result.score,
            level: level.id,
            label: level.label,
            kind,
            levelUp,
          };
          this.deps.send(self, ServerMessage.Relationship, payload);
        }
        if (reachesLevel(result.before, result.score, RELATIONSHIP_CONFIG.friendLevel)) {
          this.becameFriends(a, ownerA, b, ownerB, gameMinute);
        }
      })
      .catch((error) => log.error("social", `shared moment ${kind} between ${a} and ${b} failed: ${(error as Error).message}`));
  }

  // ── Client requests ─────────────────────────────────────────────────────

  /** Another player's card: your relationship with them and whether you blocked them. */
  async viewProfile(sessionId: string, payload: unknown): Promise<void> {
    const request = parseTarget(payload);
    const viewer = this.deps.ownerOf(sessionId);
    if (!request || !viewer) return;
    const other = this.reachable(sessionId, request.targetId);
    if (!other) return;
    try {
      const relationship = await loadRelationship(this.deps.db, viewer, other.characterId);
      if (relationship === "not_owner") return;
      const view: ProfileViewPayload = {
        targetId: request.targetId,
        relationship,
        blockedByYou: this.blocks.get(viewer.accountId)?.has(other.accountId) ?? false,
      };
      this.deps.send(sessionId, ServerMessage.ProfileView, view);
    } catch (error) {
      log.error("social", `profile view for ${sessionId} failed: ${(error as Error).message}`);
    }
  }

  async block(sessionId: string, payload: unknown): Promise<void> {
    const request = parseTarget(payload);
    const blocker = this.deps.ownerOf(sessionId);
    if (!request || !blocker) return;
    const target = this.reachable(sessionId, request.targetId);
    const name = this.deps.state.players.get(request.targetId)?.name ?? "";
    if (!target) return this.result(sessionId, { action: "block", status: "not_found" });
    const status = await this.blockOwner(sessionId, blocker, request.targetId, target, name);
    this.result(sessionId, { action: "block", status: status === "failed" ? "failed" : "ok", name });
  }

  async unblock(sessionId: string, payload: unknown): Promise<void> {
    const request = parseUnblock(payload);
    const owner = this.deps.ownerOf(sessionId);
    if (!request || !owner) return;
    try {
      const lifted = await unblock(this.deps.db, owner.accountId, request.blockId);
      const name = lifted ? this.blocks.get(owner.accountId)?.get(lifted.blockedAccount)?.name : undefined;
      await this.reloadBlocks(owner.accountId);
      this.refreshSafety();
      this.result(sessionId, { action: "unblock", status: lifted ? "ok" : "not_found", ...(name ? { name } : {}) });
    } catch (error) {
      log.error("social", `unblock for ${sessionId} failed: ${(error as Error).message}`);
      this.result(sessionId, { action: "unblock", status: "failed" });
    }
  }

  /** Stores a report for the product owner and blocks the reported player for the reporter (D-042). */
  async report(sessionId: string, payload: unknown): Promise<void> {
    const request = parseReport(payload);
    const reporter = this.deps.ownerOf(sessionId);
    if (!request || !reporter) return;
    const target = this.reachable(sessionId, request.targetId);
    const name = this.deps.state.players.get(request.targetId)?.name ?? "";
    if (!target) return this.result(sessionId, { action: "report", status: "not_found" });
    try {
      const stored = await insertReport(this.deps.db, {
        reporter,
        reporterName: this.deps.state.players.get(sessionId)?.name ?? "Unknown",
        reported: target,
        reportedName: name || "Unknown",
        reason: request.reason,
        ...(request.note ? { note: request.note } : {}),
        area: this.deps.runtimes.get(sessionId)?.area ?? "plaza",
        gameMinute: this.deps.clock.minute(),
      });
      if (stored === "sent" || stored === "already_reported") {
        log.info("social", `${sessionId} reported ${request.targetId} (${request.reason})${stored === "already_reported" ? ", already reported today" : ""}`);
        await this.blockOwner(sessionId, reporter, request.targetId, target, name);
        return this.result(sessionId, { action: "report", status: stored === "sent" ? "ok" : "already_reported", name });
      }
      this.result(sessionId, { action: "report", status: stored === "rate_limited" ? "rate_limited" : "failed", name });
    } catch (error) {
      log.error("social", `report from ${sessionId} failed: ${(error as Error).message}`);
      this.result(sessionId, { action: "report", status: "failed", name });
    }
  }

  // ── Story log ───────────────────────────────────────────────────────────

  /** Writes an event in the character's story (once per key) and sends the owner the new log. */
  addStory(sessionId: string, event: StoryInput): void {
    const owner = this.deps.ownerOf(sessionId);
    if (!owner) return;
    void addStoryEvent(this.deps.db, owner, event)
      .then(async (added) => {
        if (added && this.deps.ownerOf(sessionId)?.characterId === owner.characterId) await this.sendStory(sessionId, owner);
      })
      .catch((error) => log.error("social", `story event ${event.key} for ${sessionId} failed: ${(error as Error).message}`));
  }

  // ── Upkeep ──────────────────────────────────────────────────────────────

  /** Deletes reports past their retention period (D-042). */
  async purgeOldReports(): Promise<void> {
    try {
      const removed = await purgeReports(this.deps.db);
      if (removed > 0) log.info("social", `deleted ${removed} reports older than the retention period`);
    } catch (error) {
      log.error("social", `report clean-up failed: ${(error as Error).message}`);
    }
  }

  // ── Internals ───────────────────────────────────────────────────────────

  private becameFriends(a: string, ownerA: Owner, b: string, ownerB: Owner, gameMinute: number): void {
    for (const [self, otherOwner, other] of [
      [a, ownerB, b],
      [b, ownerA, a],
    ] as const) {
      this.deps.moodEvent(self, "new_friend");
      this.addStory(self, {
        key: `friend:${otherOwner.characterId}`,
        kind: "new_friend",
        gameMinute,
        details: { name: this.deps.state.players.get(other)?.name ?? "" },
      });
    }
  }

  /** Blocks the target's account for the blocker, updates menus and stops any greeting or chat between them. */
  private async blockOwner(sessionId: string, blocker: Owner, targetId: string, target: Owner, name: string): Promise<"ok" | "failed"> {
    try {
      const status = await blockAccount(this.deps.db, blocker, target, name || "Unknown");
      if (status !== "blocked" && status !== "already_blocked") return "failed";
      await this.reloadBlocks(blocker.accountId);
      this.deps.cancelBetween(sessionId, targetId);
      this.refreshSafety();
      if (status === "blocked") log.info("social", `${sessionId} blocked ${targetId}`);
      return "ok";
    } catch (error) {
      log.error("social", `block from ${sessionId} failed: ${(error as Error).message}`);
      return "failed";
    }
  }

  /** The target's owner if they are in the world, in the same area, and not the requester. */
  private reachable(sessionId: string, targetId: string): Owner | null {
    if (targetId === sessionId) return null;
    const area = this.deps.runtimes.get(sessionId)?.area;
    if (!area || this.deps.runtimes.get(targetId)?.area !== area) return null;
    return this.deps.ownerOf(targetId);
  }

  private isBlockedEitherWay(a: string, b: string): boolean {
    return Boolean(this.blocks.get(a)?.has(b) || this.blocks.get(b)?.has(a));
  }

  private async reloadBlocks(accountId: string): Promise<void> {
    const rows = await listBlocks(this.deps.db, accountId);
    this.blocks.set(accountId, new Map(rows.map((row) => [row.blockedAccount, row])));
  }

  private sessionsOf(accountId: string): string[] {
    return [...this.deps.runtimes.keys()].filter((id) => this.deps.ownerOf(id)?.accountId === accountId);
  }

  /** Sends each player in the world their blocks and which players in the world they blocked, when that changed. */
  private refreshSafety(): void {
    for (const sessionId of this.deps.runtimes.keys()) {
      const owner = this.deps.ownerOf(sessionId);
      if (!owner) continue;
      const mine = this.blocks.get(owner.accountId) ?? new Map<string, BlockRow>();
      const payload: SafetyPayload = {
        blocked: [...mine.values()].map((row) => ({ blockId: row.id, name: row.name, blockedAt: row.createdAt.toISOString() })),
        blockedPlayers: [...this.deps.runtimes.keys()].flatMap((other) => {
          const account = this.deps.ownerOf(other)?.accountId;
          const block = account !== undefined && other !== sessionId ? mine.get(account) : undefined;
          return block ? [{ playerId: other, blockId: block.id }] : [];
        }),
      };
      const key = JSON.stringify(payload);
      if (this.lastSafetyKey.get(sessionId) === key) continue;
      this.lastSafetyKey.set(sessionId, key);
      this.deps.send(sessionId, ServerMessage.Safety, payload);
    }
  }

  private async sendStory(sessionId: string, owner: Owner): Promise<void> {
    const events = await recentStory(this.deps.db, owner, STORY_CONFIG.recentShown);
    if (!events) return;
    const payload: StoryPayload = { events };
    this.deps.send(sessionId, ServerMessage.Story, payload);
  }

  private result(sessionId: string, payload: SocialResultPayload): void {
    this.deps.send(sessionId, ServerMessage.SocialResult, payload);
  }
}
