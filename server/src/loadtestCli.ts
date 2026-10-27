// `npm run loadtest -- --bots 16 --seconds 60` (M12): connects bot players to
// a running game server the way the browser client does (a guest at the title
// screen, a new character, then walking, sitting on benches and greeting),
// measures what a player would feel (how long a walk takes to show up) and
// reads the server's /status for tick time, memory, CPU and database latency.
// At the end every bot goes back to the title screen and deletes its guest
// profile, so nothing is left behind in the database.
//
// For development and staging servers only. The server must allow this many
// new guests from one address: start it with GUEST_CREATIONS_PER_IP_PER_HOUR
// raised (see README → "Load test"). A room holds GAME_CONFIG.maxPlayersPerRoom
// players; more bots (or a browser already playing) open a second room.

import { Client, type Room } from "@colyseus/sdk";
import {
  ClientMessage,
  DEFAULT_APPEARANCE,
  GAME_CONFIG,
  PLAZA_LAYOUT,
  PROFILE_DELETE_WORD,
  ROOM_NAME,
  ServerMessage,
  isPositionWalkable,
  type ActionUpdatePayload,
  type ProfileErrorPayload,
  type ProfilePayload,
  type RejectedPayload,
} from "@padova/shared";

interface Options {
  server: string;
  bots: number;
  seconds: number;
}

function parseOptions(argv: string[]): Options {
  const options: Options = { server: `ws://localhost:${process.env.PORT ?? 2567}`, bots: GAME_CONFIG.maxPlayersPerRoom, seconds: 60 };
  for (let i = 0; i < argv.length; i += 2) {
    const [flag, value] = [argv[i], argv[i + 1]];
    if (flag === "--server" && value) options.server = value;
    else if (flag === "--bots" && Number.isInteger(Number(value)) && Number(value) >= 1 && Number(value) <= 64) options.bots = Number(value);
    else if (flag === "--seconds" && Number.isInteger(Number(value)) && Number(value) >= 10 && Number(value) <= 3600) options.seconds = Number(value);
    else {
      console.error("Usage: npm run loadtest -- [--bots 1-64] [--seconds 10-3600] [--server ws://localhost:2567]");
      process.exit(1);
    }
  }
  return options;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const pick = <T>(items: readonly T[]): T => items[Math.floor(Math.random() * items.length)]!;

async function until(predicate: () => boolean, timeoutMs: number): Promise<boolean> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) return false;
    await sleep(20);
  }
  return true;
}

/** The value below which `p` percent of the samples fall (nearest rank). */
function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))]!;
}

const count = (map: Map<string, number>, key: string) => map.set(key, (map.get(key) ?? 0) + 1);
const ms = (value: number) => (Number.isFinite(value) ? `${value.toFixed(value < 10 ? 1 : 0)} ms` : "n/a");
const list = (map: Map<string, number>) => [...map].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(", ") || "none";

interface StatusSample {
  at: number;
  players: number;
  rssMb: number;
  heapUsedMb: number;
  cpu: number;
  dbMs: number;
  dbKind: string;
  npcs: string;
  budgetMs: number;
  rooms: { players: number; npcs: number; tick: { avgMs: number; p95Ms: number; maxMs: number } }[];
}

const metrics = {
  joinMs: [] as number[],
  createMs: [] as number[],
  /** From sending a walk intent to the patch that shows the bot moving. */
  walkMs: [] as number[],
  walksUnseen: 0,
  sent: new Map<string, number>(),
  actionStatus: new Map<string, number>(),
  actionReasons: new Map<string, number>(),
  rejected: new Map<string, number>(),
  failures: [] as string[],
  status: [] as StatusSample[],
};

const BENCHES = PLAZA_LAYOUT.interactables.filter((i) => i.kind === "bench").map((i) => i.id);

function randomWalkablePoint(): { x: number; z: number } {
  const half = PLAZA_LAYOUT.halfSize - 2;
  for (;;) {
    const x = (Math.random() * 2 - 1) * half;
    const z = (Math.random() * 2 - 1) * half;
    if (isPositionWalkable(PLAZA_LAYOUT, x, z, GAME_CONFIG.playerRadius)) return { x, z };
  }
}

class Bot {
  room: Room | null = null;
  readonly profiles: ProfilePayload[] = [];
  readonly errors: ProfileErrorPayload[] = [];
  deleted = false;
  private walkSentAt: number | null = null;

  constructor(
    private readonly options: Options,
    readonly name: string,
  ) {}

  get self() {
    return this.room?.state.players?.get(this.room.sessionId);
  }

  async start(): Promise<boolean> {
    const joinStart = performance.now();
    try {
      this.room = await new Client(this.options.server).joinOrCreate(ROOM_NAME, {});
    } catch (error) {
      metrics.failures.push(`${this.name}: couldn't join (${(error as Error).message})`);
      return false;
    }
    metrics.joinMs.push(performance.now() - joinStart);
    const room = this.room;
    room.onMessage(ServerMessage.Profile, (payload: ProfilePayload) => this.profiles.push(payload));
    room.onMessage(ServerMessage.ProfileError, (payload: ProfileErrorPayload) => this.errors.push(payload));
    room.onMessage(ServerMessage.ProfileDeleted, () => (this.deleted = true));
    room.onMessage(ServerMessage.Rejected, (payload: RejectedPayload) => count(metrics.rejected, `${payload.action}: ${payload.reason}`));
    room.onMessage(ServerMessage.ActionUpdate, (payload: ActionUpdatePayload) => {
      count(metrics.actionStatus, payload.status);
      if (payload.reason && payload.status !== "completed") count(metrics.actionReasons, `${payload.action} ${payload.status}: ${payload.reason}`);
    });
    // Other messages (life, greetings, story…) arrive too; a bot has nothing to do with them.
    room.onMessage("*", () => undefined);
    room.onStateChange(() => this.checkWalk());
    if (!(await until(() => this.profiles.length > 0, 8000))) return this.fail("no lobby message");

    const createStart = performance.now();
    room.send(ClientMessage.CreateCharacter, { displayName: this.name, ageCategory: "adult", appearance: DEFAULT_APPEARANCE, traits: [] });
    if (!(await until(() => this.profiles.some((p) => p.status === "ready") || this.errors.length > 0, 10_000))) return this.fail("character not created in time");
    if (this.errors.length) return this.fail(`createCharacter refused: ${this.errors.map((e) => e.reason).join(", ")}`);
    metrics.createMs.push(performance.now() - createStart);
    return true;
  }

  private fail(reason: string): false {
    metrics.failures.push(`${this.name}: ${reason}`);
    return false;
  }

  private checkWalk(): void {
    if (this.walkSentAt !== null && this.self?.moving) {
      metrics.walkMs.push(performance.now() - this.walkSentAt);
      this.walkSentAt = null;
    }
  }

  private send(type: string, payload: unknown): void {
    count(metrics.sent, type === ClientMessage.MoveTo ? "walk" : String((payload as { action?: string }).action));
    this.room?.send(type, payload);
  }

  /** One thing a player might do: mostly walking, sometimes sitting on a bench or greeting another bot. */
  act(others: Bot[]): void {
    const room = this.room;
    const self = this.self;
    if (!room || !self) return;
    const roll = Math.random();
    const players = others.filter((b) => b !== this && b.room);
    if (roll < 0.6 || players.length === 0) {
      if (this.walkSentAt !== null) metrics.walksUnseen++;
      this.walkSentAt = self.moving ? null : performance.now(); // only time walks that start from standing still
      this.send(ClientMessage.MoveTo, randomWalkablePoint());
    } else if (roll < 0.85) {
      this.send(ClientMessage.Interact, { targetKind: "object", targetId: pick(BENCHES), action: "sit" });
    } else {
      const other = pick(players);
      if (other.room) this.send(ClientMessage.Interact, { targetKind: "player", targetId: other.room.sessionId, action: "greet" });
    }
  }

  /** Back to the title screen, then delete the guest profile and leave. */
  async finish(): Promise<void> {
    const room = this.room;
    if (!room) return;
    try {
      const before = this.profiles.length;
      room.send(ClientMessage.LeaveWorld);
      await until(() => this.profiles.slice(before).some((p) => p.status === "lobby"), 8000);
      room.send(ClientMessage.DeleteProfile, { confirm: PROFILE_DELETE_WORD });
      if (!(await until(() => this.deleted || this.errors.some((e) => e.action === "deleteProfile"), 8000))) this.fail("profile not deleted in time");
      else if (!this.deleted) this.fail(`profile not deleted: ${this.errors.filter((e) => e.action === "deleteProfile").map((e) => e.reason).join(", ")}`);
      await room.leave();
    } catch (error) {
      this.fail(`clean-up failed (${(error as Error).message})`);
    }
  }
}

async function sampleStatus(statusUrl: string): Promise<void> {
  try {
    const response = await fetch(statusUrl);
    const body = (await response.json()) as any;
    metrics.status.push({
      at: Date.now(),
      players: body.players,
      rssMb: body.memory.rssMb,
      heapUsedMb: body.memory.heapUsedMb,
      cpu: body.cpu.sinceLastStatus,
      dbMs: body.database.latencyMs,
      dbKind: body.database.kind,
      npcs: body.npcs,
      budgetMs: body.tickBudgetMs,
      rooms: body.rooms,
    });
  } catch (error) {
    metrics.failures.push(`status: ${(error as Error).message}`);
  }
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  const statusUrl = `${options.server.replace(/^ws/, "http").replace(/\/+$/, "")}/status`;
  console.log(`Load test: ${options.bots} bot player${options.bots === 1 ? "" : "s"} for ${options.seconds} s against ${options.server}`);
  await sampleStatus(statusUrl);
  if (metrics.status.length === 0) {
    console.error(`Couldn't read ${statusUrl}. Is the server running?`);
    process.exit(1);
  }

  // Join a few at a time, as players arriving would.
  const bots = Array.from({ length: options.bots }, (_, i) => new Bot(options, `Loadbot ${String(i + 1).padStart(2, "0")}`));
  const playing: Bot[] = [];
  for (let i = 0; i < bots.length; i += 4) {
    const batch = bots.slice(i, i + 4);
    const started = await Promise.all(batch.map((bot) => bot.start()));
    batch.forEach((bot, k) => started[k] && playing.push(bot));
  }
  console.log(`${playing.length}/${bots.length} bots playing; running for ${options.seconds} s…`);

  const deadline = Date.now() + options.seconds * 1000;
  await sampleStatus(statusUrl); // resets the CPU window to "while playing"
  const sampler = setInterval(() => void sampleStatus(statusUrl), 5000);
  await Promise.all(
    playing.map(async (bot) => {
      await sleep(Math.random() * 2000);
      while (Date.now() < deadline) {
        bot.act(playing);
        await sleep(2000 + Math.random() * 1500);
      }
    }),
  );
  clearInterval(sampler);
  await sampleStatus(statusUrl);

  await Promise.all(bots.map((bot) => bot.finish()));
  report(options, bots, playing);
  process.exit(metrics.failures.length > 0 ? 1 : 0);
}

function report(options: Options, bots: Bot[], playing: Bot[]): void {
  const during = metrics.status.slice(2); // samples taken while the bots were playing
  const first = metrics.status[0]!;
  const ticks = during.flatMap((s) => s.rooms.map((r) => r.tick));
  const worst = (key: "avgMs" | "p95Ms" | "maxMs") => Math.max(...ticks.map((t) => t[key]));
  const peakPlayers = Math.max(...during.map((s) => s.players));
  const rooms = Math.max(...during.map((s) => s.rooms.length));
  const budget = first.budgetMs;
  const deleted = bots.filter((b) => b.deleted).length;

  console.log("");
  console.log(`Server: database ${first.dbKind}, NPCs ${first.npcs}; peak ${peakPlayers} players in ${rooms} room${rooms === 1 ? "" : "s"}`);
  console.log(`Joined: ${playing.length}/${bots.length}   join p50 ${ms(percentile(metrics.joinMs, 50))}, p95 ${ms(percentile(metrics.joinMs, 95))}   new character p50 ${ms(percentile(metrics.createMs, 50))}, p95 ${ms(percentile(metrics.createMs, 95))}`);
  console.log(`Walk intent → movement seen (${metrics.walkMs.length} walks): p50 ${ms(percentile(metrics.walkMs, 50))}, p95 ${ms(percentile(metrics.walkMs, 95))}, max ${ms(Math.max(...metrics.walkMs))}${metrics.walksUnseen ? `; ${metrics.walksUnseen} not seen before the next request` : ""}`);
  console.log(`Requests sent: ${list(metrics.sent)}`);
  console.log(`Action updates: ${list(metrics.actionStatus)}`);
  console.log(`Not done (with reason): ${list(metrics.actionReasons)}`);
  console.log(`Messages rejected: ${list(metrics.rejected)}`);
  if (ticks.length) {
    const avg = worst("avgMs");
    console.log(`Server tick (rolling ${GAME_CONFIG.tickMs} ms ticks): worst average ${ms(avg)}, worst p95 ${ms(worst("p95Ms"))}, worst max ${ms(worst("maxMs"))}; budget ${budget} ms average → ${avg <= budget ? "within budget" : "OVER BUDGET"}`);
    console.log(`Memory: ${first.rssMb} MB before, peak ${Math.max(...during.map((s) => s.rssMb))} MB (heap peak ${Math.max(...during.map((s) => s.heapUsedMb))} MB)`);
    console.log(`CPU (share of one core): peak ${Math.max(...during.map((s) => s.cpu)).toFixed(2)}`);
    console.log(`Database round trip: p50 ${ms(percentile(during.map((s) => s.dbMs), 50))}, max ${ms(Math.max(...during.map((s) => s.dbMs)))}`);
  }
  console.log(`Clean-up: ${deleted}/${bots.filter((b) => b.room).length} guest profiles deleted`);
  if (metrics.failures.length) {
    console.log(`Problems (${metrics.failures.length}):`);
    for (const failure of metrics.failures.slice(0, 20)) console.log(`  - ${failure}`);
    if (metrics.failures.some((f) => f.includes("rate_limited"))) console.log("  The server limits new guests per address: start it with GUEST_CREATIONS_PER_IP_PER_HOUR=1000 for a load test.");
  }
}

void main();
