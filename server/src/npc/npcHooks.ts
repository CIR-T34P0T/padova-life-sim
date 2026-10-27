// The interaction hooks with NPCs in mind (M11). Players' requests go to the
// life system unchanged. An NPC's actions run through the same interaction
// rules (validation, seats, walking, timers), but an NPC has no life data,
// money or records: it is never charged, paid, graded or saved. The barista
// works shifts at the staff spot like a hired player, unpaid; a greeting to
// an NPC gives the greeter the usual effect and lets the NPC answer.

import { isNpcSessionId, npcOfSession, type ActionId } from "@padova/shared";
import type { InteractionHooks } from "../InteractionSystem.ts";
import type { PendingAction } from "../runtime.ts";

export interface NpcGreetings {
  /** A player greeted an NPC. */
  onGreeted(npcId: string, greeterId: string): void;
}

export function withNpcs(life: InteractionHooks, npcs: NpcGreetings): InteractionHooks {
  const npc = isNpcSessionId;
  return {
    checkStart: (id, action: ActionId, itemId) => (npc(id) ? null : life.checkStart(id, action, itemId)),
    effectFor: (action, itemId) => life.effectFor(action, itemId),
    purchase: (id, pending) => (npc(id) ? Promise.resolve("purchase_failed") : life.purchase(id, pending)),
    refund: (id, pending) => {
      if (!npc(id)) life.refund(id, pending);
    },
    onCompleted: (id, pending: PendingAction) => {
      if (!npc(id)) life.onCompleted(id, pending);
    },
    onGreeting: (greeterId, targetId) => {
      if (npc(greeterId)) return; // NPCs don't start greetings
      life.onGreeting(greeterId, targetId);
      if (npc(targetId)) npcs.onGreeted(targetId, greeterId);
    },
    onChatted: (initiatorId, targetId) => {
      if (!npc(initiatorId) && !npc(targetId)) life.onChatted(initiatorId, targetId);
    },
    jobOf: (id) => (npc(id) ? (npcOfSession(id)?.job ?? null) : life.jobOf(id)),
    hire: (id, pending) => (npc(id) ? Promise.resolve("hire_failed") : life.hire(id, pending)),
    // An NPC's shift starts whenever its spot is free, and ends without a wage or a record.
    startShift: (id, pending) => (npc(id) ? null : life.startShift(id, pending)),
    payShift: (id, pending) => (npc(id) ? Promise.resolve("ok") : life.payShift(id, pending)),
    courseOf: (id) => (npc(id) ? null : life.courseOf(id)),
    enrol: (id, pending) => (npc(id) ? Promise.resolve("enrol_failed") : life.enrol(id, pending)),
    startCourseAction: (id, pending) => (npc(id) ? "not_enrolled" : life.startCourseAction(id, pending)),
    finishCourseAction: (id, pending) => (npc(id) ? Promise.resolve("record_failed") : life.finishCourseAction(id, pending)),
  };
}
