// M9 relationships and safety through the real room, database (in-memory
// PGlite) and WebSocket clients: chatting (both sides' effects, the cooldown,
// walking away), relationships from greetings, chats, studying at the same
// table and the same lecture, becoming friends (both stories and moods), the
// player card, blocks (both directions, a chat in progress, unblocking),
// reports (stored, also blocking, once a day), the story log written by the
// life system, and privacy: nothing reaches a third player.

import type { Room } from "@colyseus/sdk";
import { ClientMessage, clockOffsetFor, pairOf, type ActionUpdatePayload, type LifePayload } from "@padova/shared";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { connectAndPlay, joinWithNewCharacter, sleep, startTestServer, waitFor, type ProfileClient, type TestServer } from "./helpers/gameClient.ts";

const CHAT_MS = 1_500;
const context = { server: undefined as unknown as TestServer };
const rooms: Room[] = [];
beforeAll(async () => {
  // Monday 09:01: the café is open and a lecture can be joined for the lecture-together test.
  context.server = await startTestServer(2640, {
    walkSpeed: 9,
    actionDurationsMs: { study: 700, sketch: 600, wash: 400, greet: 300, work: 700, attend: 900, exam: 900, chat: CHAT_MS },
    clockOffsetMinutes: clockOffsetFor(Date.now(), 0, 9, 1),
  });
});
afterEach(async () => {
  await Promise.all(rooms.splice(0).map((room) => Promise.race([room.leave(true).catch(() => undefined), sleep(500)])));
  await sleep(150);
});
afterAll(async () => {
  await context.server.stop();
});
const track = <T extends ProfileClient>(client: T): T => {
  rooms.push(client.room);
  return client;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const stateOf = (viewer: ProfileClient, sessionId: string): any => viewer.room.state.players?.get(sessionId);
const me = (client: ProfileClient) => stateOf(client, client.room.sessionId);
const idOf = (client: ProfileClient) => client.room.sessionId;
const characterIdOf = (client: ProfileClient) => client.profiles.find((p) => p.profile)!.profile!.characterId;

async function join(name: string) {
  const client = track(await joinWithNewCharacter(context.server.url, name));
  await waitFor(() => client.received("safety").length > 0, 4000, `${name}'s safety message`);
  return client;
}

/** Sends an interaction and waits for it to end; returns how it ended (or the refusal). */
async function act(client: ProfileClient, targetKind: "object" | "player", targetId: string, action: string, timeoutMs = 15_000): Promise<ActionUpdatePayload> {
  const from = client.actions.length;
  client.room.send(ClientMessage.Interact, { targetKind, targetId, action });
  await waitFor(() => client.actions.length > from, 4000, `reply to ${action} ${targetId}`);
  if (client.actions[from]!.status === "rejected") return client.actions[from]!;
  const done = (u: ActionUpdatePayload) => u.action === action && ["completed", "failed", "cancelled"].includes(u.status);
  await waitFor(() => client.actions.slice(from).some(done), timeoutMs, `${action} ${targetId} ended`);
  return client.actions.slice(from).find(done)!;
}

async function lifeWhere(client: ProfileClient, predicate: (life: LifePayload) => boolean, what: string): Promise<LifePayload> {
  await waitFor(() => client.lives.some(predicate), 6000, what);
  return [...client.lives].reverse().find(predicate)!;
}

/** Waits for the n-th message of a type and returns it. */
async function nth(client: ProfileClient, type: string, n: number, what = type) {
  await waitFor(() => client.received(type).length >= n, 6000, what);
  return client.received(type)[n - 1];
}

async function profile(viewer: ProfileClient, target: ProfileClient) {
  const before = viewer.received("profileView").length;
  viewer.room.send(ClientMessage.ViewProfile, { targetId: idOf(target) });
  return nth(viewer, "profileView", before + 1, "profile view");
}

describe("chatting and relationships", () => {
  it("a chat lifts both players, tells the other one, and starts a relationship only the two of them see", async () => {
    const ada = await join("Ada");
    const ben = await join("Ben");
    const cleo = await join("Cleo");
    const adaBefore = ada.lastLife()!;
    const benBefore = ben.lastLife()!;

    expect((await act(ada, "player", idOf(ben), "chat")).status).toBe("completed");
    expect(ada.actions.some((u) => u.action === "chat" && u.status === "started" && u.durationMs === CHAT_MS)).toBe(true);
    expect(ben.received("greeted").at(-1)).toEqual({ fromId: idOf(ada), fromName: "Ada", action: "chat" });
    const adaAfter = await lifeWhere(ada, (l) => l.mood.events.some((e) => e.id === "nice_chat"), "Ada's nice chat");
    expect(adaAfter.needs.social).toBeGreaterThan(adaBefore.needs.social);
    const benAfter = await lifeWhere(ben, (l) => l.mood.events.some((e) => e.id === "someone_chatted"), "Ben's chat");
    expect(benAfter.needs.social).toBeGreaterThan(benBefore.needs.social);

    const toAda = await nth(ada, "relationship", 1);
    const toBen = await nth(ben, "relationship", 1);
    expect(toAda).toEqual({ otherId: idOf(ben), otherName: "Ben", score: 5, level: "acquaintance", label: "Acquaintance", kind: "chat", levelUp: false });
    expect(toBen).toMatchObject({ otherId: idOf(ada), otherName: "Ada", score: 5, kind: "chat" });

    // A greeting adds a little more; both cards agree.
    expect((await act(ben, "player", idOf(ada), "greet")).status).toBe("completed");
    await nth(ada, "relationship", 2, "greeting counted");
    const card = await profile(ada, ben);
    expect(card).toMatchObject({ targetId: idOf(ben), blockedByYou: false, relationship: { score: 7, level: "acquaintance", label: "Acquaintance" } });
    expect(card.relationship.recent.map((m: { kind: string }) => m.kind)).toEqual(["greet", "chat"]);
    expect((await profile(ben, ada)).relationship).toEqual(card.relationship);

    // Cleo has no relationship with either, and never received theirs.
    expect((await profile(cleo, ada)).relationship).toBeNull();
    expect(cleo.received("relationship")).toEqual([]);
    expect(cleo.received("story").every((m: { events: unknown[] }) => m.events.length === 0)).toBe(true);
    expect(Object.keys(stateOf(cleo, idOf(ada)).toJSON())).not.toContain("relationship");
  });

  it("a second chat with the same player waits 30 s; a chat stops if the other walks away", async () => {
    const dino = await join("Dino");
    const eva = await join("Eva");
    expect((await act(dino, "player", idOf(eva), "chat")).status).toBe("completed");
    expect(await act(dino, "player", idOf(eva), "chat")).toMatchObject({ status: "rejected", reason: "too_soon" });

    const from = eva.actions.length;
    eva.room.send(ClientMessage.Interact, { targetKind: "player", targetId: idOf(dino), action: "chat" });
    await waitFor(() => eva.actions.slice(from).some((u) => u.action === "chat" && u.status === "started"), 6000, "Eva's chat started");
    dino.room.send(ClientMessage.MoveTo, { x: me(dino).x + 10, z: me(dino).z });
    await waitFor(() => eva.actions.slice(from).some((u) => u.action === "chat" && u.status === "failed"), 6000, "chat broken off");
    expect(eva.actions.slice(from).find((u) => u.status === "failed")).toMatchObject({ reason: "target_moved" });
  });

  it("studying at the same table counts as a shared moment for both", async () => {
    const fede = await join("Fede");
    const gaia = await join("Gaia");
    const fedeDone = act(fede, "object", "cafe-table-1", "study");
    await sleep(250);
    const gaiaDone = act(gaia, "object", "cafe-table-1", "study");
    expect((await fedeDone).status).toBe("completed");
    expect((await gaiaDone).status).toBe("completed");
    const moment = await nth(fede, "relationship", 1, "study together");
    expect(moment).toMatchObject({ otherId: idOf(gaia), kind: "study_together", score: 4 });
    // Counted once, by whoever finished first.
    await sleep(300);
    expect(gaia.received("relationship")).toHaveLength(1);
  });

  it("attending the same lecture counts as a shared moment", async () => {
    const hugo = await join("Hugo");
    const iris = await join("Iris");
    for (const student of [hugo, iris]) {
      expect((await act(student, "object", "noticeboard", "enrol")).status).toBe("completed");
      expect((await act(student, "object", "hall-door", "enter")).status).toBe("completed");
    }
    const hugoDone = act(hugo, "object", "lecture-desk-1a", "attend");
    await sleep(200);
    const irisDone = act(iris, "object", "lecture-desk-1a", "attend");
    expect((await hugoDone).status).toBe("completed");
    expect((await irisDone).status).toBe("completed");
    expect(await nth(hugo, "relationship", 1, "lecture together")).toMatchObject({ otherId: idOf(iris), kind: "lecture_together" });
  });

  it("reaching Friend tells both with a level-up, writes both stories and cheers both", async () => {
    const jana = await join("Jana");
    const karl = await join("Karl");
    const [low, high] = pairOf(characterIdOf(jana), characterIdOf(karl));
    await context.server.db.query(
      `INSERT INTO relationships (character_low, character_high, score, first_game_minute, last_game_minute) VALUES ($1, $2, 38, 600, 600)`,
      [low, high],
    );
    expect((await act(jana, "player", idOf(karl), "chat")).status).toBe("completed");
    expect(await nth(karl, "relationship", 1)).toMatchObject({ score: 43, level: "friend", label: "Friend", levelUp: true });
    for (const [self, other] of [
      [jana, "Karl"],
      [karl, "Jana"],
    ] as const) {
      await waitFor(() => self.received("story").some((m: { events: { kind: string }[] }) => m.events.some((e) => e.kind === "new_friend")), 6000, "new friend story");
      const story = self.received("story").at(-1);
      expect(story.events[0]).toMatchObject({ kind: "new_friend", details: { name: other } });
      await lifeWhere(self, (l) => l.mood.events.some((e) => e.id === "new_friend"), "new friend mood");
    }
  });
});

describe("blocks and reports", () => {
  it("a block stops greetings and chats both ways, ends a chat in progress, shows in the blocker's list, and can be lifted", async () => {
    const lia = await join("Lia");
    const max = await join("Max");
    // Max starts a chat with Lia; Lia blocks him in the middle of it.
    const from = max.actions.length;
    max.room.send(ClientMessage.Interact, { targetKind: "player", targetId: idOf(lia), action: "chat" });
    await waitFor(() => max.actions.slice(from).some((u) => u.action === "chat" && u.status === "started"), 6000, "chat started");
    lia.room.send(ClientMessage.Block, { targetId: idOf(max) });
    expect(await nth(lia, "socialResult", 1)).toEqual({ action: "block", status: "ok", name: "Max" });
    await waitFor(() => max.actions.slice(from).some((u) => u.action === "chat" && u.status === "cancelled"), 4000, "chat ended by the block");
    const safety = lia.received("safety").at(-1);
    expect(safety.blocked).toEqual([{ blockId: expect.any(String), name: "Max", blockedAt: expect.any(String) }]);
    expect(safety.blockedPlayers).toEqual([{ playerId: idOf(max), blockId: safety.blocked[0].blockId }]);
    // Max isn't told who blocked him: his own list is empty.
    expect(max.received("safety").at(-1)).toEqual({ blocked: [], blockedPlayers: [] });

    const greetingsBefore = lia.received("greeted").length;
    expect(await act(max, "player", idOf(lia), "greet")).toMatchObject({ status: "rejected", reason: "not_reachable" });
    expect(await act(max, "player", idOf(lia), "chat")).toMatchObject({ status: "rejected", reason: "not_reachable" });
    expect(await act(lia, "player", idOf(max), "greet")).toMatchObject({ status: "rejected", reason: "not_reachable" });
    expect(lia.received("greeted")).toHaveLength(greetingsBefore);
    expect((await profile(lia, max)).blockedByYou).toBe(true);

    // Max can't lift it with Lia's block id; Lia can.
    max.room.send(ClientMessage.Unblock, { blockId: safety.blocked[0].blockId });
    expect(await nth(max, "socialResult", 1)).toMatchObject({ action: "unblock", status: "not_found" });
    lia.room.send(ClientMessage.Unblock, { blockId: safety.blocked[0].blockId });
    expect(await nth(lia, "socialResult", 2)).toEqual({ action: "unblock", status: "ok", name: "Max" });
    await waitFor(() => lia.received("safety").at(-1).blocked.length === 0, 4000, "block lifted");
    expect((await act(max, "player", idOf(lia), "greet")).status).toBe("completed");
  });

  it("a block covers the account and is still there after the blocker comes back", async () => {
    const nora = await join("Nora");
    const omar = await join("Omar");
    nora.room.send(ClientMessage.Block, { targetId: idOf(omar) });
    await nth(nora, "socialResult", 1);
    const token = (nora as ProfileClient & { guestToken: string }).guestToken;
    const id = characterIdOf(nora);
    await nora.room.leave(true);
    await sleep(400);
    const back = track(await connectAndPlay(context.server.url, token, id));
    await waitFor(() => back.received("safety").some((s: { blockedPlayers: { playerId: string }[] }) => s.blockedPlayers.some((b) => b.playerId === idOf(omar))), 4000, "block reloaded");
    expect(await act(omar, "player", idOf(back), "greet")).toMatchObject({ status: "rejected", reason: "not_reachable" });
  });

  it("a report is stored with minimal context, also blocks, counts once a day, and ignores bad reasons", async () => {
    const pia = await join("Pia");
    const quinn = await join("Quinn");
    pia.room.send(ClientMessage.Report, { targetId: idOf(quinn), reason: "made_up" });
    pia.room.send(ClientMessage.Report, { targetId: idOf(quinn), reason: "harassment", note: "  followed me\\naround  " });
    expect(await nth(pia, "socialResult", 1)).toEqual({ action: "report", status: "ok", name: "Quinn" });
    const rows = await context.server.db.query<{ reporter_name: string; reported_name: string; reason: string; note: string; area: string }>(
      `SELECT reporter_name, reported_name, reason, note, area FROM reports WHERE reporter_character_id = $1`,
      [characterIdOf(pia)],
    );
    expect(rows.rows).toEqual([{ reporter_name: "Pia", reported_name: "Quinn", reason: "harassment", note: "followed me\\naround", area: "plaza" }]);
    await waitFor(() => pia.received("safety").at(-1).blockedPlayers.some((b: { playerId: string }) => b.playerId === idOf(quinn)), 4000, "reporting blocked");
    expect(await act(quinn, "player", idOf(pia), "greet")).toMatchObject({ status: "rejected", reason: "not_reachable" });
    pia.room.send(ClientMessage.Report, { targetId: idOf(quinn), reason: "other" });
    expect(await nth(pia, "socialResult", 2)).toMatchObject({ action: "report", status: "already_reported" });
    // Quinn learns nothing.
    expect(quinn.received("socialResult")).toEqual([]);
    expect(quinn.received("safety").at(-1)).toEqual({ blocked: [], blockedPlayers: [] });
  });

  it("players in another room can't be viewed, blocked or reported", async () => {
    const rosa = await join("Rosa");
    const sami = await join("Sami");
    expect((await act(sami, "object", "hall-door", "enter")).status).toBe("completed");
    await waitFor(() => me(sami)?.area === "hall/lecture-room", 4000, "Sami inside");
    rosa.room.send(ClientMessage.Block, { targetId: idOf(sami) });
    expect(await nth(rosa, "socialResult", 1)).toEqual({ action: "block", status: "not_found" });
    rosa.room.send(ClientMessage.ViewProfile, { targetId: idOf(sami) });
    await sleep(400);
    expect(rosa.received("profileView")).toEqual([]);
  });
});

describe("the story log", () => {
  it("records the job, the first shift and enrolling once each, only for the owner, and keeps them after a reload", async () => {
    const tea = await join("Tea");
    const ugo = await join("Ugo");
    expect((await act(tea, "object", "cafe-counter", "ask_work")).status).toBe("completed");
    expect((await act(tea, "object", "cafe-counter", "work")).status).toBe("completed");
    expect((await act(tea, "object", "cafe-counter", "work")).status).toBe("completed");
    expect((await act(tea, "object", "noticeboard", "enrol")).status).toBe("completed");
    await waitFor(() => tea.received("story").at(-1)?.events.length === 3, 6000, "three story events");
    expect(tea.received("story").at(-1).events.map((e: { kind: string }) => e.kind)).toEqual(["enrolled", "first_shift", "hired"]);
    expect(tea.received("story").at(-1).events[0].details).toEqual({ courseId: "city-studies" });
    expect(ugo.received("story").every((m: { events: unknown[] }) => m.events.length === 0)).toBe(true);

    const token = (tea as ProfileClient & { guestToken: string }).guestToken;
    const id = characterIdOf(tea);
    await tea.room.leave(true);
    await sleep(400);
    const back = track(await connectAndPlay(context.server.url, token, id));
    await waitFor(() => back.received("story").length > 0, 4000, "story after reload");
    expect(back.received("story").at(-1).events.map((e: { kind: string }) => e.kind)).toEqual(["enrolled", "first_shift", "hired"]);
  });
});
