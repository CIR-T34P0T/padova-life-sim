// Relationships and safety rules (M9): levels, gains with daily caps, the
// pair order, the chat action and its cooldown, the chat and mood data, and
// the parsers for profile, block, unblock and report messages.

import { describe, expect, it } from "vitest";
import {
  ACTION_EFFECTS,
  CHAT_EFFECTS,
  INTERACTION_CONFIG,
  MOOD_EVENTS,
  RELATIONSHIP_CONFIG,
  SAFETY_CONFIG,
  SHARED_MOMENT_KINDS,
  STORY_KINDS,
  afterMoment,
  isSharedMomentKind,
  isStoryKind,
  pairOf,
  parseReport,
  parseTarget,
  parseUnblock,
  playerActions,
  reachesLevel,
  relationshipLevel,
  validatePlayerAction,
  type ActorView,
} from "../src/index.ts";

describe("relationship levels", () => {
  it("go from Acquaintance to Close friend as the score rises", () => {
    expect(relationshipLevel(0)).toEqual({ id: "acquaintance", label: "Acquaintance" });
    expect(relationshipLevel(14).id).toBe("acquaintance");
    expect(relationshipLevel(15).id).toBe("friendly");
    expect(relationshipLevel(40)).toEqual({ id: "friend", label: "Friend" });
    expect(relationshipLevel(70).id).toBe("good_friend");
    expect(relationshipLevel(100)).toEqual({ id: "close_friend", label: "Close friend" });
  });

  it("are in rising order and start at 0", () => {
    const froms = RELATIONSHIP_CONFIG.levels.map((l) => l.from);
    expect(froms[0]).toBe(0);
    expect([...froms].sort((a, b) => a - b)).toEqual(froms);
    expect(froms.at(-1)!).toBeLessThanOrEqual(RELATIONSHIP_CONFIG.maxScore);
  });

  it("know when a rise reaches the friend level (once)", () => {
    expect(reachesLevel(38, 43, "friend")).toBe(true);
    expect(reachesLevel(40, 45, "friend")).toBe(false);
    expect(reachesLevel(30, 39, "friend")).toBe(false);
    expect(reachesLevel(10, 95, "friend")).toBe(true);
  });
});

describe("shared moments", () => {
  it("each kind adds its gain, up to the daily cap per pair, never above the maximum", () => {
    for (const kind of SHARED_MOMENT_KINDS) {
      const cap = RELATIONSHIP_CONFIG.dailyCaps[kind];
      expect(afterMoment(10, kind, 0)).toEqual({ score: 10 + RELATIONSHIP_CONFIG.gains[kind], counted: true });
      expect(afterMoment(10, kind, cap - 1).counted).toBe(true);
      expect(afterMoment(10, kind, cap)).toEqual({ score: 10, counted: false });
    }
    expect(afterMoment(99, "chat", 0)).toEqual({ score: 100, counted: true });
  });

  it("a full game day of every kind with one person (2.4 real hours together) reaches Friend, not Good friend", () => {
    const perDay = SHARED_MOMENT_KINDS.reduce((sum, kind) => sum + RELATIONSHIP_CONFIG.gains[kind] * RELATIONSHIP_CONFIG.dailyCaps[kind], 0);
    const from = (id: string) => RELATIONSHIP_CONFIG.levels.find((l) => l.id === id)!.from;
    expect(perDay).toBeGreaterThanOrEqual(from("friend"));
    expect(perDay).toBeLessThan(from("good_friend"));
  });

  it("orders a pair the same way whoever starts", () => {
    expect(pairOf("b", "a")).toEqual(["a", "b"]);
    expect(pairOf("a", "b")).toEqual(["a", "b"]);
  });

  it("recognises moment and story kinds", () => {
    expect(isSharedMomentKind("chat")).toBe(true);
    expect(isSharedMomentKind("fight")).toBe(false);
    expect(STORY_KINDS).toContain("new_friend");
    expect(isStoryKind("exam_passed")).toBe(true);
    expect(isStoryKind("toString")).toBe(false);
  });
});

describe("the chat action", () => {
  const actor: ActorView = { id: "me", x: 0, z: 0, seatId: "", activity: "idle" };
  const other = { id: "other", x: 2, z: 0, connected: true };
  const now = 1_000_000;

  it("is offered with greeting by another connected player", () => {
    expect(playerActions(actor, other)).toEqual(["greet", "chat"]);
  });

  it("has its own, longer cooldown per pair", () => {
    expect(validatePlayerAction(actor, other, "chat", undefined, now)).toEqual({ ok: true });
    expect(validatePlayerAction(actor, other, "chat", now - INTERACTION_CONFIG.greetCooldownMs, now)).toEqual({ ok: false, reason: "too_soon" });
    expect(validatePlayerAction(actor, other, "chat", now - INTERACTION_CONFIG.chatCooldownMs, now)).toEqual({ ok: true });
  });

  it("lifts social and fun for the starter and social for the partner, with mood events", () => {
    expect(ACTION_EFFECTS.chat.needs.social).toBeGreaterThan(0);
    expect(ACTION_EFFECTS.chat.activity).toBe("chatting");
    expect(ACTION_EFFECTS.chat.focus).toBe(false);
    expect(CHAT_EFFECTS.partner.needs.social).toBeGreaterThan(0);
    expect(MOOD_EVENTS[ACTION_EFFECTS.chat.moodEvent].value).toBeGreaterThan(0);
    expect(MOOD_EVENTS[CHAT_EFFECTS.partner.moodEvent].value).toBeGreaterThan(0);
    expect(MOOD_EVENTS.new_friend.value).toBeGreaterThan(0);
    // Two players can stay chatting a step apart without it breaking.
    expect(INTERACTION_CONFIG.chatRange).toBeGreaterThan(INTERACTION_CONFIG.greetRange);
  });
});

describe("profile, block, unblock and report messages", () => {
  const id = "5f0c6a3e-1b2c-4d5e-8f90-123456789abc";

  it("accept a session id as the target, nothing else", () => {
    expect(parseTarget({ targetId: "AbC123" })).toEqual({ targetId: "AbC123" });
    expect(parseTarget({ targetId: "" })).toBeNull();
    expect(parseTarget({ targetId: "x".repeat(65) })).toBeNull();
    expect(parseTarget({ targetId: 5 })).toBeNull();
    expect(parseTarget(null)).toBeNull();
  });

  it("unblock by block id (a UUID)", () => {
    expect(parseUnblock({ blockId: id.toUpperCase() })).toEqual({ blockId: id });
    expect(parseUnblock({ blockId: "not-a-uuid" })).toBeNull();
    expect(parseUnblock({})).toBeNull();
  });

  it("report with a known reason and an optional short note, cleaned", () => {
    for (const reason of SAFETY_CONFIG.reportReasons) expect(parseReport({ targetId: "p1", reason: reason.id })).toEqual({ targetId: "p1", reason: reason.id });
    expect(parseReport({ targetId: "p1", reason: "harassment", note: "  kept following me\nand spamming  " })).toEqual({
      targetId: "p1",
      reason: "harassment",
      note: "kept following me and spamming",
    });
    expect(parseReport({ targetId: "p1", reason: "harassment", note: "   " })).toEqual({ targetId: "p1", reason: "harassment" });
    expect(parseReport({ targetId: "p1", reason: "made_up" })).toBeNull();
    expect(parseReport({ targetId: "p1", reason: "other", note: "x".repeat(SAFETY_CONFIG.noteMaxLength + 1) })).toBeNull();
    expect(parseReport({ targetId: "p1", reason: "other", note: 42 })).toBeNull();
    expect(parseReport({ reason: "other" })).toBeNull();
  });

  it("keep reports for 90 days and limit how many can be sent", () => {
    expect(SAFETY_CONFIG.reportRetentionDays).toBe(90);
    expect(SAFETY_CONFIG.reportsPerHour).toBeGreaterThan(0);
    expect(SAFETY_CONFIG.reportRepeatHours).toBeGreaterThan(0);
  });
});
