// In-room life simulation (M5, work since M7). For every character in the
// world it advances needs with game time, applies the effects of running
// actions, tracks skills, mood events, money and the character's job, and
// sends the owner their own data (D-024). Every rule comes from
// shared/src/life; this class only applies them.

import { randomUUID } from "node:crypto";
import {
  ECONOMY_CONFIG,
  JOBS,
  JOB_IDS,
  SKILL_CONFIG,
  ServerMessage,
  SKILL_IDS,
  activeMoodEvents,
  addMoodEvent,
  applyNeedChanges,
  computeMood,
  effectPortion,
  findMenuItem,
  gameDayOf,
  gradeFor,
  greetingEffect,
  isTooTired,
  levelForXp,
  realMsToGameHours,
  shiftRefusal,
  shiftsOn,
  skillGain,
  skillProgress,
  stepNeeds,
  timedEffectFor,
  type ActionId,
  type ActiveMoodEvent,
  type InteractionFailure,
  type JobId,
  type LifePayload,
  type MoodEventId,
  type Needs,
  type ResolvedEffect,
  type SkillId,
  type SkillXp,
  type TraitId,
  type TransactionView,
  type WorkState,
} from "@padova/shared";
import { log } from "../log.ts";
import type { Owner } from "../profiles/profileRepository.ts";
import type { PendingAction, PlayerRuntime } from "../runtime.ts";
import type { PlazaState } from "../schema.ts";
import type { LifeSnapshot, MoneyChangeResult } from "./lifeRepository.ts";
import type { LifeService, LoadedLife } from "./LifeService.ts";

export interface GameClock {
  /** Current game minute (fractional). */
  minute(): number;
  /** Game minutes per real minute. */
  readonly scale: number;
}

interface CharacterLife {
  owner: Owner;
  traits: TraitId[];
  needs: Needs;
  skills: SkillXp;
  moodEvents: ActiveMoodEvent[];
  balanceCents: number;
  recent: TransactionView[];
  /** Position at the previous tick, for fitness from walking. */
  lastX: number;
  lastZ: number;
  /** Game day whose allowance was last requested. */
  allowanceDay: number;
  allowanceInFlight: boolean;
  /** Job and completed shifts today (M7). Changed only after the database confirms. */
  work: WorkState;
  /** A hire or quit is being written: no other job change or shift until it lands. */
  jobBusy: boolean;
  lastSentKey: string;
  lastSentAt: number;
}

export interface LifeDeps {
  state: PlazaState;
  runtimes: Map<string, PlayerRuntime>;
  service: LifeService;
  clock: GameClock;
  send: (sessionId: string, type: string, payload: unknown) => void;
  /** Asks the room to save this character soon (e.g. after a skill gain). */
  requestSave: (sessionId: string) => void;
  now: () => number;
}

/** Owner updates are sent at most this often, unless something important happened. */
const UPDATE_INTERVAL_MS = 500;
/** A position jump bigger than this in one tick (sitting down, standing up) is not walking. */
const MAX_WALK_STEP_M = 1;

export class LifeSystem {
  private readonly lives = new Map<string, CharacterLife>();

  constructor(private readonly deps: LifeDeps) {}

  has(sessionId: string): boolean {
    return this.lives.has(sessionId);
  }

  /** Starts simulating a character that has just been placed in the world. */
  attach(sessionId: string, owner: Owner, loaded: LoadedLife): void {
    const runtime = this.deps.runtimes.get(sessionId);
    this.lives.set(sessionId, {
      owner,
      traits: loaded.traits,
      needs: loaded.needs,
      skills: loaded.skills,
      moodEvents: loaded.moodEvents,
      balanceCents: loaded.balanceCents,
      recent: loaded.recent,
      lastX: runtime?.character.x ?? 0,
      lastZ: runtime?.character.z ?? 0,
      allowanceDay: 0,
      allowanceInFlight: false,
      work: { ...loaded.work },
      jobBusy: false,
      lastSentKey: "",
      lastSentAt: 0,
    });
    this.maybeGrantAllowance(sessionId);
    this.sendUpdate(sessionId, true);
  }

  /** Stops simulating a character (after its final save). */
  detach(sessionId: string): void {
    this.lives.delete(sessionId);
  }

  /** Data to save, or null if the character has no life loaded. */
  snapshot(sessionId: string): LifeSnapshot | null {
    const life = this.lives.get(sessionId);
    if (!life) return null;
    return {
      needs: { ...life.needs },
      skills: { ...life.skills },
      moodEvents: activeMoodEvents(life.moodEvents, this.deps.clock.minute()),
    };
  }

  // ── Simulation step ─────────────────────────────────────────────────────

  /** Called every server tick after movement, before interactions complete actions. */
  tick(deltaMs: number): void {
    const gameMinute = this.deps.clock.minute();
    const gameHours = realMsToGameHours(deltaMs, this.deps.clock.scale);
    for (const [sessionId, life] of this.lives) {
      const player = this.deps.state.players.get(sessionId);
      const runtime = this.deps.runtimes.get(sessionId);
      if (!player || !runtime) continue;

      life.needs = stepNeeds(life.needs, gameHours, { activity: player.activity, moving: player.moving, traits: life.traits });

      // Fitness from walking: distance actually travelled this tick.
      const step = Math.hypot(runtime.character.x - life.lastX, runtime.character.z - life.lastZ);
      life.lastX = runtime.character.x;
      life.lastZ = runtime.character.z;
      if (player.moving && step > 0 && step <= MAX_WALK_STEP_M) {
        this.addXp(life, "fitness", step * SKILL_CONFIG.fitnessXpPerMetre, gameMinute);
      }

      // Effects of the running timed action, in proportion to elapsed time.
      const pending = runtime.pending;
      if (pending?.phase === "active" && pending.effect && pending.endsAt > pending.startedAt) {
        const share = Math.min(deltaMs / (pending.endsAt - pending.startedAt), 1 - pending.appliedFraction);
        if (share > 0) this.applyEffectShare(life, pending, share, gameMinute);
      }

      life.moodEvents = activeMoodEvents(life.moodEvents, gameMinute);
      if (gameDayOf(gameMinute) !== life.allowanceDay) this.maybeGrantAllowance(sessionId);
      this.sendUpdate(sessionId, false);
    }
  }

  // ── Hooks used by the interaction system ────────────────────────────────

  /** Reason an action can't be started now, or null. */
  checkStart(sessionId: string, action: ActionId, itemId?: string): InteractionFailure | null {
    const life = this.lives.get(sessionId);
    if (life && (action === "ask_work" || action === "work") && life.jobBusy) return "busy";
    if (life && action === "ask_work" && life.work.jobId) return "already_employed";
    if (life && action === "work") return shiftRefusal(life.work, this.deps.clock.minute(), life.needs);
    const effect = timedEffectFor(action, itemId);
    if (!life || !effect) return null;
    if (effect.focus && isTooTired(life.needs)) return "too_tired";
    if (action === "buy" && itemId) {
      const item = findMenuItem(itemId);
      if (item && life.balanceCents < item.priceCents) {
        this.addMoodEvent(life, "couldnt_afford");
        this.sendUpdate(sessionId, true);
        return "insufficient_funds";
      }
    }
    return null;
  }

  /** The effect a timed action will have for this character (null if untimed). */
  effectFor(action: ActionId, itemId?: string): ResolvedEffect | null {
    return timedEffectFor(action, itemId);
  }

  /** Charges for a purchase when the character reaches the counter. */
  async purchase(sessionId: string, pending: PendingAction): Promise<"ok" | InteractionFailure> {
    const life = this.lives.get(sessionId);
    if (!life || !pending.itemId) return "purchase_failed";
    let result: MoneyChangeResult | { status: "unknown_item" };
    try {
      result = await this.deps.service.purchase(life.owner, pending.itemId, purchaseKey(pending), this.deps.clock.minute());
    } catch (error) {
      log.error("life", `purchase failed for ${sessionId}: ${(error as Error).message}`);
      return "purchase_failed";
    }
    switch (result.status) {
      case "applied":
        this.recordMoney(sessionId, result.balanceCents, result.transaction);
        return "ok";
      case "duplicate":
        // Already paid for (and served) under this request id: never serve twice.
        this.recordMoney(sessionId, result.balanceCents);
        return "duplicate_request";
      case "insufficient_funds":
        this.recordMoney(sessionId, result.balanceCents);
        if (life) this.addMoodEvent(life, "couldnt_afford");
        this.sendUpdate(sessionId, true);
        return "insufficient_funds";
      case "unknown_item":
        return "unknown_item";
      case "not_owner":
        return "purchase_failed";
    }
  }

  /** Refunds a paid order that could not be served (D-025). */
  refund(sessionId: string, pending: PendingAction): void {
    const life = this.lives.get(sessionId);
    if (!life || !pending.itemId) return;
    const owner = life.owner;
    void this.deps.service
      .refund(owner, pending.itemId, purchaseKey(pending), this.deps.clock.minute())
      .then((result) => {
        if (result.status === "applied") this.recordMoney(sessionId, result.balanceCents, result.transaction);
        log.info("life", `refund for ${sessionId} (${pending.itemId}): ${result.status}`);
      })
      .catch((error) => log.error("life", `refund failed for ${sessionId}: ${(error as Error).message}`));
  }

  /** A timed action finished: apply what is left of its effect, its completion skills and its mood event. */
  onCompleted(sessionId: string, pending: PendingAction): void {
    const life = this.lives.get(sessionId);
    if (!life || !pending.effect) return;
    const gameMinute = this.deps.clock.minute();
    const remaining = 1 - pending.appliedFraction;
    if (remaining > 0) this.applyEffectShare(life, pending, remaining, gameMinute);
    const onCompletion = pending.effect.skillsOnCompletion ?? {};
    for (const [skill, xp] of Object.entries(onCompletion) as [SkillId, number][]) this.addXp(life, skill, xp, gameMinute);
    if (pending.effect.moodEvent) this.addMoodEvent(life, pending.effect.moodEvent);
    this.sendUpdate(sessionId, true);
    if (Object.keys(pending.effect.skills).length > 0 || Object.keys(onCompletion).length > 0) this.deps.requestSave(sessionId);
  }

  // ── Work (M7) ───────────────────────────────────────────────────────────

  /** The character's job, or null. */
  jobOf(sessionId: string): JobId | null {
    return this.lives.get(sessionId)?.work.jobId ?? null;
  }

  /** Hires the character for the job done at the counter it walked to. */
  async hire(sessionId: string, pending: PendingAction): Promise<"ok" | InteractionFailure> {
    const life = this.lives.get(sessionId);
    const jobId = JOB_IDS.find((id) => JOBS[id].workplaceId === pending.targetId);
    if (!life || !jobId) return "hire_failed";
    if (life.work.jobId) return "already_employed";
    if (life.jobBusy) return "busy";
    life.jobBusy = true;
    try {
      const result = await this.deps.service.hire(life.owner, jobId, this.deps.clock.minute());
      if (result === "hired") {
        life.work = { ...life.work, jobId };
        log.info("life", `${sessionId} was hired (${jobId})`);
        this.sendUpdate(sessionId, true);
        return "ok";
      }
      return result === "already_employed" ? "already_employed" : "hire_failed";
    } catch (error) {
      log.error("life", `hire failed for ${sessionId}: ${(error as Error).message}`);
      return "hire_failed";
    } finally {
      life.jobBusy = false;
    }
  }

  /** At the staff spot: checks the shift may start now and fixes its grade and wage from today's skills. */
  startShift(sessionId: string, pending: PendingAction): InteractionFailure | null {
    const life = this.lives.get(sessionId);
    if (!life) return "wage_failed";
    if (life.jobBusy) return "busy";
    const gameMinute = this.deps.clock.minute();
    const refused = shiftRefusal(life.work, gameMinute, life.needs);
    if (refused) return refused;
    const jobId = life.work.jobId!;
    const job = JOBS[jobId];
    if (job.workplaceId !== pending.targetId) return "not_employed";
    const levels = Object.fromEntries(SKILL_IDS.map((skill) => [skill, levelForXp(life.skills[skill])]));
    const grade = gradeFor(job, levels);
    pending.shift = {
      id: randomUUID(),
      jobId,
      gradeId: grade.id,
      gradeLabel: grade.label,
      wageCents: grade.wageCents,
      gameDay: gameDayOf(gameMinute),
      startedGameMinute: gameMinute,
    };
    return null;
  }

  /** The shift's time is up: record it and pay the wage (once per shift, through the ledger). */
  async payShift(sessionId: string, pending: PendingAction): Promise<"ok" | InteractionFailure> {
    const life = this.lives.get(sessionId);
    const shift = pending.shift;
    if (!life || !shift) return "wage_failed";
    try {
      const result = await this.deps.service.payShift(life.owner, {
        shiftId: shift.id,
        jobId: shift.jobId,
        gradeId: shift.gradeId,
        gradeLabel: shift.gradeLabel,
        wageCents: shift.wageCents,
        gameDay: shift.gameDay,
        startedGameMinute: shift.startedGameMinute,
        endedGameMinute: Math.max(shift.startedGameMinute, this.deps.clock.minute()),
        maxShiftsPerDay: JOBS[shift.jobId].maxShiftsPerDay,
      });
      switch (result.status) {
        case "paid":
        case "duplicate":
          life.work = { ...life.work, shiftsDay: shift.gameDay, shiftsToday: result.shiftsToday };
          this.recordMoney(sessionId, result.balanceCents, result.transaction);
          log.info("life", `${sessionId} was paid ${result.transaction.amountCents} cents for shift ${shift.id}`);
          return "ok";
        case "shift_limit":
          life.work = { ...life.work, shiftsDay: shift.gameDay, shiftsToday: result.shiftsToday };
          this.sendUpdate(sessionId, true);
          return "shift_limit";
        case "not_employed":
          life.work = { ...life.work, jobId: null };
          this.sendUpdate(sessionId, true);
          return "not_employed";
        case "not_owner":
          return "wage_failed";
      }
    } catch (error) {
      log.error("life", `wage for ${sessionId} (shift ${shift.id}) failed: ${(error as Error).message}`);
      return "wage_failed";
    }
  }

  /** Quits the character's job (the room stops any shift first). The owner sees it in their next life update. */
  quitJob(sessionId: string): void {
    const life = this.lives.get(sessionId);
    if (!life || !life.work.jobId || life.jobBusy) return;
    life.jobBusy = true;
    this.deps.service
      .quit(life.owner)
      .then((result) => {
        if (result === "quit" || result === "not_employed") {
          life.work = { ...life.work, jobId: null };
          log.info("life", `${sessionId} quit their job`);
        }
      })
      .catch((error) => log.error("life", `quitting failed for ${sessionId}: ${(error as Error).message}`))
      .finally(() => {
        life.jobBusy = false;
        this.sendUpdate(sessionId, true);
      });
  }

  /** A greeting started: both players feel it. */
  onGreeting(greeterId: string, targetId: string): void {
    const gameMinute = this.deps.clock.minute();
    const greeter = this.lives.get(greeterId);
    if (greeter) {
      const effect = greetingEffect("greeter", greeter.needs);
      greeter.needs = applyNeedChanges(greeter.needs, effect.needs, greeter.traits);
      for (const [skill, xp] of Object.entries(effect.skills) as [SkillId, number][]) this.addXp(greeter, skill, xp, gameMinute);
      this.addMoodEvent(greeter, effect.moodEvent);
      this.sendUpdate(greeterId, true);
    }
    const target = this.lives.get(targetId);
    if (target) {
      const effect = greetingEffect("greeted", target.needs);
      target.needs = applyNeedChanges(target.needs, effect.needs, target.traits);
      this.addMoodEvent(target, effect.moodEvent);
      this.sendUpdate(targetId, true);
    }
  }

  // ── Internals ───────────────────────────────────────────────────────────

  private applyEffectShare(life: CharacterLife, pending: PendingAction, share: number, gameMinute: number): void {
    const effect = pending.effect!;
    const portion = effectPortion(effect, share);
    life.needs = applyNeedChanges(life.needs, portion.needs, life.traits, effect.key === "consume" ? undefined : effect.key);
    for (const [skill, xp] of Object.entries(portion.skills) as [SkillId, number][]) this.addXp(life, skill, xp, gameMinute);
    pending.appliedFraction = Math.min(1, pending.appliedFraction + share);
  }

  private addXp(life: CharacterLife, skill: SkillId, baseXp: number, gameMinute: number): void {
    const mood = computeMood(life.needs, life.moodEvents, gameMinute);
    life.skills[skill] += skillGain(baseXp, skill, life.traits, mood.level);
  }

  private addMoodEvent(life: CharacterLife, id: MoodEventId): void {
    life.moodEvents = addMoodEvent(life.moodEvents, id, this.deps.clock.minute());
  }

  private recordMoney(sessionId: string, balanceCents: number, transaction?: TransactionView): void {
    const life = this.lives.get(sessionId);
    if (!life) return;
    life.balanceCents = balanceCents;
    if (transaction && !life.recent.some((t) => t.id === transaction.id)) {
      life.recent = [transaction, ...life.recent].slice(0, ECONOMY_CONFIG.recentTransactions);
    }
    this.sendUpdate(sessionId, true);
  }

  private maybeGrantAllowance(sessionId: string): void {
    const life = this.lives.get(sessionId);
    if (!life || life.allowanceInFlight) return;
    const gameMinute = this.deps.clock.minute();
    const day = gameDayOf(gameMinute);
    if (day === life.allowanceDay) return;
    life.allowanceInFlight = true;
    this.deps.service
      .grantDailyAllowance(life.owner, gameMinute)
      .then((result) => {
        life.allowanceDay = day;
        if (result?.status === "applied") {
          this.recordMoney(sessionId, result.balanceCents, result.transaction);
          log.info("life", `daily allowance for ${sessionId} (day ${day})`);
        }
      })
      .catch((error) => log.error("life", `allowance failed for ${sessionId}: ${(error as Error).message}`))
      .finally(() => {
        life.allowanceInFlight = false;
      });
  }

  private sendUpdate(sessionId: string, force: boolean): void {
    const life = this.lives.get(sessionId);
    if (!life) return;
    const now = this.deps.now();
    if (!force && now - life.lastSentAt < UPDATE_INTERVAL_MS) return;
    const payload = this.payload(life);
    const key = JSON.stringify([
      Object.values(payload.needs).map(Math.round),
      Object.values(payload.skills).map((s) => Math.round(s.xp * 10)),
      payload.mood.level,
      payload.mood.reasons.length,
      payload.money.balanceCents,
      payload.job?.jobId ?? "",
      payload.job?.shiftsToday ?? 0,
      Math.floor(payload.gameMinute),
    ]);
    if (!force && key === life.lastSentKey) return;
    life.lastSentKey = key;
    life.lastSentAt = now;
    this.deps.send(sessionId, ServerMessage.Life, payload);
  }

  private payload(life: CharacterLife): LifePayload {
    const gameMinute = this.deps.clock.minute();
    const mood = computeMood(life.needs, life.moodEvents, gameMinute);
    const round1 = (value: number) => Math.round(value * 10) / 10;
    return {
      gameMinute: Math.floor(gameMinute),
      needs: Object.fromEntries(Object.entries(life.needs).map(([need, value]) => [need, round1(value)])) as Needs,
      mood: {
        ...mood,
        events: activeMoodEvents(life.moodEvents, gameMinute).map((event) => ({ id: event.id, expiresAt: Math.floor(event.expiresAt) })),
      },
      skills: Object.fromEntries(
        SKILL_IDS.map((skill) => {
          const progress = skillProgress(life.skills[skill]);
          return [skill, { xp: round1(progress.xp), level: progress.level, progress: Math.round(progress.progress * 1000) / 1000 }];
        }),
      ) as LifePayload["skills"],
      traits: [...life.traits],
      money: { balanceCents: life.balanceCents, recent: [...life.recent] },
      job: life.work.jobId ? { jobId: life.work.jobId, shiftsToday: shiftsOn(life.work, gameMinute) } : null,
    };
  }
}

/** Ledger key of a purchase: one charge per (character, request id). */
const purchaseKey = (pending: PendingAction) => `purchase:${pending.requestId}`;

/** Server-generated request id for purchases sent without one. */
export const newServerRequestId = () => `srv-${randomUUID()}`;
