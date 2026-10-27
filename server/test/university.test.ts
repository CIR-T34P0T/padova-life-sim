// M8 university through the real room, database (in-memory PGlite) and
// WebSocket clients: enrolling at the square's notice board, attending a
// lecture in the lecture room (only in its slot, once), study counting for the
// course, the exam graded on the server once per sitting (fail, retake, pass),
// refusals outside the timetable, privacy and persistence. One server runs a
// fast clock for the time-based rules (late entry closing while walking,
// lectures in consecutive hours).

import type { Room } from "@colyseus/sdk";
import {
  ClientMessage,
  TIME_CONFIG,
  clockOffsetFor,
  gameMinuteAt,
  joinableLecture,
  type ActionUpdatePayload,
  type LifePayload,
} from "@padova/shared";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { TuningOverrides } from "../src/tuning.ts";
import { connectAndPlay, joinWithNewCharacter, sleep, startTestServer, waitFor, type ProfileClient, type TestServer } from "./helpers/gameClient.ts";

const ROOM = "hall/lecture-room";
const COURSE = "city-studies";
const MONDAY = 0;
const WEDNESDAY = 2;
const DURATIONS = { study: 600, sketch: 600, wash: 400, greet: 300, work: 1_200, attend: 1_000, exam: 1_200 };

/** A clock offset that makes the game time read `weekday` hh:mm now. */
const clockAt = (weekday: number, hours: number, minutes = 0, scale: number = TIME_CONFIG.defaultScale) => clockOffsetFor(Date.now(), weekday, hours, minutes, scale);

/** A server per describe; its tuning (the clock offset) is computed when it starts, not when the file loads. */
function useServer(port: number, makeTuning: () => TuningOverrides) {
  const context = { server: undefined as unknown as TestServer, tuning: {} as TuningOverrides };
  const rooms: Room[] = [];
  beforeAll(async () => {
    context.tuning = makeTuning();
    context.server = await startTestServer(port, { walkSpeed: 9, actionDurationsMs: DURATIONS, ...context.tuning });
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
  return { context, track };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const stateOf = (viewer: ProfileClient, sessionId: string): any => viewer.room.state.players?.get(sessionId);
const me = (client: ProfileClient) => stateOf(client, client.room.sessionId);
const characterIdOf = (client: ProfileClient) => client.profiles.find((p) => p.profile)!.profile!.characterId;
const latestLife = (client: ProfileClient) => client.lives.at(-1)!;

/** Sends an object interaction and waits for it to end; returns how it ended (or the refusal). */
async function act(client: ProfileClient, targetId: string, action: string): Promise<ActionUpdatePayload> {
  const from = client.actions.length;
  client.room.send(ClientMessage.Interact, { targetKind: "object", targetId, action });
  await waitFor(() => client.actions.length > from, 4000, `reply to ${action} ${targetId}`);
  if (client.actions[from]!.status === "rejected") return client.actions[from]!;
  const done = (u: ActionUpdatePayload) => u.action === action && ["completed", "failed", "cancelled"].includes(u.status);
  await waitFor(() => client.actions.slice(from).some(done), 15_000, `${action} ${targetId} ended`);
  return client.actions.slice(from).find(done)!;
}

async function lifeWhere(client: ProfileClient, predicate: (life: LifePayload) => boolean, what: string): Promise<LifePayload> {
  await waitFor(() => client.lives.some(predicate), 6000, what);
  return [...client.lives].reverse().find(predicate)!;
}

async function enrol(client: ProfileClient): Promise<void> {
  expect((await act(client, "noticeboard", "enrol")).status).toBe("completed");
  await lifeWhere(client, (l) => l.course?.status === "enrolled", "enrolled");
}

async function goIn(client: ProfileClient): Promise<void> {
  expect((await act(client, "hall-door", "enter")).status).toBe("completed");
  await waitFor(() => me(client)?.area === ROOM, 4000, "in the lecture room");
}

describe("university at lecture time (Monday 09:01)", () => {
  const { context, track } = useServer(2637, () => ({ clockOffsetMinutes: clockAt(MONDAY, 9, 1) }));

  it("enrols at the square's notice board once; the course is private and saved", async () => {
    const ada = track(await joinWithNewCharacter(context.server.url, "Ada"));
    const ben = track(await joinWithNewCharacter(context.server.url, "Ben"));
    expect(latestLife(ada).course).toBeNull();
    expect(latestLife(ada).timeScale).toBe(TIME_CONFIG.defaultScale);
    await enrol(ada);
    expect(latestLife(ada).course).toEqual({
      courseId: COURSE,
      status: "enrolled",
      lecturesAttended: 0,
      studySessions: 0,
      lastLectureKey: null,
      lastSittingKey: null,
      lastResult: null,
      finalGrade: null,
    });
    expect(await act(ada, "noticeboard", "enrol")).toMatchObject({ status: "rejected", reason: "already_enrolled" });
    // Nobody else hears about it: no course data in the shared state or in Ben's messages.
    expect(Object.keys(stateOf(ben, ada.room.sessionId).toJSON())).not.toContain("course");
    expect(ben.lives.every((l) => l.course === null)).toBe(true);
    const rows = await context.server.db.query<{ status: string }>(`SELECT status FROM enrolments WHERE character_id = $1`, [characterIdOf(ada)]);
    expect(rows.rows).toEqual([{ status: "enrolled" }]);
  });

  it("attends the lecture on now at a lecture desk once; it counts, teaches and cheers; study counts too; a reload keeps it all", async () => {
    const cleo = track(await joinWithNewCharacter(context.server.url, "Cleo"));
    // Not enrolled: the desk refuses the lecture.
    await goIn(cleo);
    expect(await act(cleo, "lecture-desk-1a", "attend")).toMatchObject({ status: "rejected", reason: "not_enrolled" });
    expect((await act(cleo, "lecture-room-door", "enter")).status).toBe("completed");
    await waitFor(() => me(cleo)?.area === "plaza", 4000, "back out");
    await enrol(cleo);
    await goIn(cleo);

    const before = latestLife(cleo);
    const attended = await act(cleo, "lecture-desk-1a", "attend");
    expect(attended.status).toBe("completed");
    expect(cleo.actions.some((u) => u.action === "attend" && u.status === "started" && u.durationMs === DURATIONS.attend)).toBe(true);
    const after = await lifeWhere(cleo, (l) => l.course?.lecturesAttended === 1, "lecture counted");
    const key = joinableLecture(COURSE, after.gameMinute)?.key ?? after.course!.lastLectureKey;
    expect(after.course!.lastLectureKey).toBe(key);
    expect(after.course!.lastLectureKey).toMatch(/^d\d+-0900$/);
    expect(after.skills.academic.xp).toBeGreaterThan(before.skills.academic.xp);
    expect(after.mood.events.map((e) => e.id)).toContain("interesting_lecture");
    await waitFor(() => me(cleo).activity === "sitting", 2000, "seated again after the lecture");

    // The same lecture never counts twice; the exam isn't on today.
    expect(await act(cleo, "lecture-desk-1a", "attend")).toMatchObject({ status: "rejected", reason: "already_attended" });
    expect(await act(cleo, "lecture-desk-1a", "exam")).toMatchObject({ status: "rejected", reason: "no_exam_now" });

    // Studying (here or at any desk) counts for the course while enrolled.
    expect((await act(cleo, "lecture-desk-1a", "study")).status).toBe("completed");
    await lifeWhere(cleo, (l) => l.course?.studySessions === 1, "study counted");

    const token = (cleo as ProfileClient & { guestToken: string }).guestToken;
    const id = characterIdOf(cleo);
    await cleo.room.leave(true);
    await sleep(400);
    const back = track(await connectAndPlay(context.server.url, token, id));
    await lifeWhere(back, (l) => l.course?.lecturesAttended === 1 && l.course.studySessions === 1 && l.course.lastLectureKey === key, "kept after reload");
    expect(me(back).area).toBe(ROOM);
  });

  it("a lecture left early does not count and can still be attended", async () => {
    const dino = track(await joinWithNewCharacter(context.server.url, "Dino"));
    await enrol(dino);
    await goIn(dino);
    const from = dino.actions.length;
    dino.room.send(ClientMessage.Interact, { targetKind: "object", targetId: "lecture-desk-2b", action: "attend" });
    await waitFor(() => dino.actions.slice(from).some((u) => u.action === "attend" && u.status === "started"), 6000, "lecture started");
    dino.room.send(ClientMessage.CancelAction, {});
    await waitFor(() => dino.actions.slice(from).some((u) => u.action === "attend" && u.status === "cancelled"), 3000, "lecture left");
    await sleep(DURATIONS.attend + 300);
    expect(latestLife(dino).course?.lecturesAttended).toBe(0);
    expect((await act(dino, "lecture-desk-2b", "attend")).status).toBe("completed");
    await lifeWhere(dino, (l) => l.course?.lecturesAttended === 1, "counted the second time");
  });
});

describe("university on an exam day (Wednesday 13:01: a sitting is open, no lecture)", () => {
  const { context, track } = useServer(2638, () => ({ clockOffsetMinutes: clockAt(WEDNESDAY, 13, 1) }));

  it("refuses a lecture outside its slot", async () => {
    const eva = track(await joinWithNewCharacter(context.server.url, "Eva"));
    await enrol(eva);
    await goIn(eva);
    expect(await act(eva, "lecture-desk-1b", "attend")).toMatchObject({ status: "rejected", reason: "no_lecture_now" });
  });

  it("an unprepared exam fails gently: a grade, a mood event, the course stays open, one attempt per sitting", async () => {
    const fede = track(await joinWithNewCharacter(context.server.url, "Fede"));
    await enrol(fede);
    await goIn(fede);
    expect((await act(fede, "lecture-desk-3a", "exam")).status).toBe("completed");
    const life = await lifeWhere(fede, (l) => l.course?.lastResult !== null && l.course?.lastResult !== undefined, "graded");
    expect(life.course).toMatchObject({ status: "enrolled", finalGrade: null, lastResult: { grade: 12, passed: false } });
    expect(life.course!.lastSittingKey).toMatch(/^d\d+$/);
    expect(life.mood.events.map((e) => e.id)).toContain("failed_exam");
    // The result goes into Fede's story log (M9).
    await waitFor(() => fede.received("story").some((m: { events: { kind: string }[] }) => m.events.some((e) => e.kind === "exam_failed")), 6000, "exam in the story");
    expect(fede.received("story").at(-1).events[0]).toMatchObject({ kind: "exam_failed", details: { courseId: COURSE, grade: 12 } });
    expect(await act(fede, "lecture-desk-3a", "exam")).toMatchObject({ status: "rejected", reason: "already_sat" });
    const rows = await context.server.db.query<{ grade: number; passed: boolean }>(`SELECT grade, passed FROM assessments WHERE character_id = $1`, [characterIdOf(fede)]);
    expect(rows.rows).toEqual([{ grade: 12, passed: false }]);
  });

  it("a prepared student passes: the grade comes from stored attendance and study, the course closes, and stays passed after a reload", async () => {
    const gaia = track(await joinWithNewCharacter(context.server.url, "Gaia"));
    await enrol(gaia);
    // Preparation done on earlier days (written straight into the database for the test).
    const id = characterIdOf(gaia);
    for (const key of ["d1-0900", "d1-1000", "d1-1100", "d1-1200", "d2-0900", "d2-1000", "d2-1100", "d2-1200"]) {
      await context.server.db.query(
        `INSERT INTO lecture_attendance (character_id, course, lecture_key, game_day, attended_game_minute) VALUES ($1, $2, $3, 1, 600)`,
        [id, COURSE, key],
      );
    }
    await context.server.db.query(`UPDATE enrolments SET study_sessions = 6 WHERE character_id = $1`, [id]);
    await goIn(gaia);
    expect((await act(gaia, "lecture-desk-1a", "exam")).status).toBe("completed");
    // 8 lectures and 6 sessions at academic level 0: 12 + 19 × 0.8 = 27.
    const life = await lifeWhere(gaia, (l) => l.course?.status === "passed", "passed");
    expect(life.course).toMatchObject({ status: "passed", finalGrade: 27, lecturesAttended: 8, studySessions: 6, lastResult: { grade: 27, passed: true } });
    expect(life.mood.events.map((e) => e.id)).toContain("passed_exam");
    // Passed: the desk no longer offers the course, and the notice board says so.
    expect(await act(gaia, "lecture-desk-1a", "exam")).toMatchObject({ status: "rejected", reason: "course_passed" });

    const token = (gaia as ProfileClient & { guestToken: string }).guestToken;
    await gaia.room.leave(true);
    await sleep(400);
    const back = track(await connectAndPlay(context.server.url, token, id));
    await lifeWhere(back, (l) => l.course?.status === "passed" && l.course.finalGrade === 27, "still passed after reload");
    expect((await act(back, "lecture-room-door", "enter")).status).toBe("completed");
    await waitFor(() => me(back)?.area === "plaza", 4000, "out");
    expect(await act(back, "noticeboard", "enrol")).toMatchObject({ status: "rejected", reason: "course_passed" });
  });
});

describe("university on a fast clock (1 real second = 10 game minutes)", () => {
  const SCALE = 600;
  // A slower walk (4 m/s) so the late-entry test can arrive after entry closes.
  const { context, track } = useServer(2639, () => ({ timeScale: SCALE, walkSpeed: 4, clockOffsetMinutes: clockAt(MONDAY, 8, 40, SCALE) }));
  const minuteNow = () => gameMinuteAt(Date.now(), SCALE, context.tuning.clockOffsetMinutes ?? 0);
  const minuteOfHour = () => ((minuteNow() % 60) + 60) % 60;
  const lectureHour = () => {
    const hour = Math.floor((((minuteNow() % 1440) + 1440) % 1440) / 60);
    return [9, 10, 11, 12, 14, 15, 16, 17].includes(hour);
  };
  /** Waits until the game clock is within [from, to) minutes past a lecture hour. */
  const waitForLectureMinute = (from: number, to: number) => waitFor(() => lectureHour() && minuteOfHour() >= from && minuteOfHour() < to, 20_000, `minute ${from}–${to} of a lecture hour`);

  it("refuses at the desk when late entry closed while the student walked over", async () => {
    const hugo = track(await joinWithNewCharacter(context.server.url, "Hugo"));
    await enrol(hugo);
    await goIn(hugo);
    // Accepted at :12 (late entry is open until :20), but the walk to the desk
    // takes about 1.6 real seconds (16 game minutes), so the student arrives after :20.
    await waitForLectureMinute(11, 13);
    const from = hugo.actions.length;
    hugo.room.send(ClientMessage.Interact, { targetKind: "object", targetId: "lecture-desk-1b", action: "attend" });
    await waitFor(() => hugo.actions.slice(from).some((u) => u.action === "attend" && ["failed", "started", "rejected"].includes(u.status)), 10_000, "attend answered at the desk");
    const outcome = hugo.actions.slice(from).find((u) => u.action === "attend" && u.status !== "queued")!;
    expect(outcome).toMatchObject({ status: "failed", reason: "no_lecture_now" });
    await waitFor(() => me(hugo).activity === "sitting", 2000, "seated at the desk");
    expect(latestLife(hugo).course?.lecturesAttended).toBe(0);
  });

  it("counts lectures in consecutive hours separately", async () => {
    const iris = track(await joinWithNewCharacter(context.server.url, "Iris"));
    await enrol(iris);
    await goIn(iris);
    // Seated first, so each lecture starts the moment it is requested.
    expect((await act(iris, "lecture-desk-2a", "sit")).status).toBe("completed");
    const keys: string[] = [];
    for (let k = 0; k < 2; k++) {
      await waitForLectureMinute(0, 6);
      expect((await act(iris, "lecture-desk-2a", "attend")).status).toBe("completed");
      const life = await lifeWhere(iris, (l) => l.course?.lecturesAttended === k + 1, `lecture ${k + 1} counted`);
      keys.push(life.course!.lastLectureKey!);
      // Past this lecture's late entry before waiting for the next one.
      await waitFor(() => minuteOfHour() >= 30, 20_000, "past late entry");
    }
    expect(new Set(keys).size).toBe(2);
  });
});
