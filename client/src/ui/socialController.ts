// Relationships, blocks, reports and the story log on the client (M9): the
// player card, the block and report dialogs, the notes for relationship
// changes and safety results, and the private lists the menus and the
// character panel show. Every decision is the server's; this only asks and
// shows the answers.

import {
  SAFETY_CONFIG,
  type AppearanceConfig,
  type BlockedView,
  type ProfileViewPayload,
  type RelationshipLevelId,
  type RelationshipPayload,
  type ReportReason,
  type SafetyPayload,
  type SocialResultPayload,
  type StoryEntry,
  type StoryPayload,
} from "@padova/shared";
import type { GameConnection } from "../net/connection.ts";
import type { CharacterPanel } from "./characterPanel.ts";
import type { Hud } from "./hud.ts";
import { PlayerCard, type PlayerCardInfo } from "./playerCard.ts";
import { Dialog } from "./screens/dialog.ts";

export interface SocialDeps {
  connection: GameConnection;
  hud: Hud;
  characterPanel: CharacterPanel;
  /** Name, look and activity of a player in your area, or undefined. */
  player(id: string): { name: string; look: AppearanceConfig; activity: string; connected: boolean } | undefined;
  /** Close other sheets before the card opens (touch shows one sheet at a time). */
  closeOthers(): void;
  /** The blocked list changed: menus should be rebuilt. */
  onBlocksChanged(): void;
}

const NOW_LEVEL: Record<RelationshipLevelId, string> = {
  acquaintance: "acquaintances",
  friendly: "on friendly terms",
  friend: "friends",
  good_friend: "good friends",
  close_friend: "close friends",
};

export class SocialController {
  readonly card: PlayerCard;
  private blockedList: BlockedView[] = [];
  private blockedPlayers = new Map<string, string>();
  private storyEvents: StoryEntry[] = [];
  private dialog: Dialog | null = null;

  constructor(
    root: HTMLElement,
    private readonly deps: SocialDeps,
  ) {
    this.card = new PlayerCard(root, {
      onBlock: (id) => this.confirmBlock(id),
      onUnblock: (id) => this.unblockPlayer(id),
      onReport: (id) => this.openReport(id),
      onClose: () => undefined,
    });
  }

  /** True when you blocked this player's account. */
  isBlocked(playerId: string): boolean {
    return this.blockedPlayers.has(playerId);
  }

  get story(): readonly StoryEntry[] {
    return this.storyEvents;
  }

  get blocked(): readonly BlockedView[] {
    return this.blockedList;
  }

  /** Opens a player's card and asks the server for your relationship with them. */
  openCard(playerId: string): void {
    const info = this.info(playerId);
    if (!info) return;
    this.deps.closeOthers();
    this.card.open(playerId, info, this.isBlocked(playerId));
    this.deps.connection.viewProfile(playerId);
  }

  /** The player's name, look or activity changed: keep an open card truthful. */
  onPlayerChanged(playerId: string): void {
    if (this.card.targetId !== playerId) return;
    const info = this.info(playerId);
    if (info) this.card.setInfo(info);
  }

  /** The player left your area: their card closes. */
  onPlayerRemoved(playerId: string): void {
    if (this.card.targetId === playerId) this.card.close();
  }

  confirmBlock(playerId: string): void {
    const name = this.deps.player(playerId)?.name ?? "this player";
    this.dialog?.close();
    this.dialog = new Dialog({
      title: `Block ${name}?`,
      body: [
        "You won't be able to greet or chat with each other, and their greetings won't reach you. They aren't told.",
        "The block covers all of their characters. You can unblock them in your character panel.",
      ],
      confirmLabel: "Block",
      danger: true,
      onConfirm: (_value, dialog) => {
        this.deps.connection.block(playerId);
        dialog.close();
      },
    });
  }

  unblockPlayer(playerId: string): void {
    const blockId = this.blockedPlayers.get(playerId);
    if (blockId) this.deps.connection.unblock(blockId);
  }

  unblockById(blockId: string): void {
    this.deps.connection.unblock(blockId);
  }

  openReport(playerId: string): void {
    const name = this.deps.player(playerId)?.name ?? "this player";
    this.dialog?.close();
    this.dialog = new Dialog({
      title: `Report ${name}`,
      body: [
        "Reports are read by the game's team. Only the reason, your note, where you were and when are kept, for 90 days.",
        "Reporting also blocks them for you.",
      ],
      choices: { label: "What happened?", options: SAFETY_CONFIG.reportReasons },
      input: { label: "Anything to add? (optional)", placeholder: "A short note", maxLength: SAFETY_CONFIG.noteMaxLength },
      confirmLabel: "Send report",
      danger: true,
      onConfirm: (note, dialog, choice) => {
        if (!choice) return;
        this.deps.connection.report(playerId, choice as ReportReason, note);
        dialog.close();
      },
    });
  }

  // ── Server messages ─────────────────────────────────────────────────────

  onProfileView(payload: ProfileViewPayload): void {
    this.card.setProfile(payload);
  }

  onSafety(payload: SafetyPayload): void {
    this.blockedList = payload.blocked;
    this.blockedPlayers = new Map(payload.blockedPlayers.map((b) => [b.playerId, b.blockId]));
    this.deps.characterPanel.setBlocked(payload.blocked);
    if (this.card.targetId) this.card.setBlocked(this.isBlocked(this.card.targetId));
    this.deps.onBlocksChanged();
  }

  onStory(payload: StoryPayload): void {
    this.storyEvents = payload.events;
    this.deps.characterPanel.setStory(payload.events);
  }

  onRelationship(payload: RelationshipPayload): void {
    if (payload.levelUp && payload.otherName) this.deps.hud.toast(`You and ${payload.otherName} are now ${NOW_LEVEL[payload.level]}.`, 4500);
    // An open card about them shows the new score.
    if (this.card.targetId === payload.otherId) this.deps.connection.viewProfile(payload.otherId);
  }

  onSocialResult(payload: SocialResultPayload): void {
    const name = payload.name || "them";
    const text = (() => {
      switch (payload.status) {
        case "ok":
          if (payload.action === "block") return `You blocked ${name}. You can't greet or chat with each other now.`;
          if (payload.action === "unblock") return `You unblocked ${name}.`;
          return `Thank you: your report was sent, and ${name} is blocked for you.`;
        case "already_reported":
          return `You already reported ${name} today. They're blocked for you.`;
        case "rate_limited":
          return "You've sent several reports recently. Please try again later.";
        case "not_found":
          return payload.action === "unblock" ? "That block was already lifted." : "That player isn't here any more.";
        case "failed":
          return "That didn't work because of a server problem. Try again in a moment.";
      }
    })();
    this.deps.hud.toast(text, 4500);
  }

  /** Read-only snapshot for tests. */
  debugState() {
    return { card: this.card.debugState(), blocked: this.blockedList.map((b) => b.name), blockedPlayers: [...this.blockedPlayers.keys()], story: this.storyEvents.map((e) => e.kind) };
  }

  private info(playerId: string): PlayerCardInfo | undefined {
    return this.deps.player(playerId);
  }
}
