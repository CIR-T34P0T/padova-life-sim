// Per-room tuning. Production uses the shared defaults (plus GAME_TIME_SCALE,
// GAME_CLOCK_OFFSET_MINUTES and GUEST_CREATIONS_PER_IP_PER_HOUR from the environment); tests override
// values (shorter durations, faster clocks, a custom world) through createGameServer().

import {
  ACTION_EFFECTS,
  ECONOMY_CONFIG,
  GAME_CONFIG,
  GREETING_EFFECTS,
  INTERACTION_CONFIG,
  PLAZA_LAYOUT,
  PROFILE_CONFIG,
  TIME_CONFIG,
  type WorldLayout,
} from "@padova/shared";

export interface ActionDurations {
  study: number;
  sketch: number;
  wash: number;
  greet: number;
  /** One work shift (M7). */
  work: number;
  /** Attending one lecture, and sitting the exam (M8). */
  attend: number;
  exam: number;
  /** A chat with another player (M9). */
  chat: number;
}

export interface RoomTuning {
  world: WorldLayout;
  walkSpeed: number;
  maxInteractionDistance: number;
  /** Real milliseconds per timed action. */
  actionDurationsMs: ActionDurations;
  /** Multiplies how long eating and drinking take (1 = menu durations). */
  consumeDurationFactor: number;
  guestCreationsPerIpPerHour: number;
  /** Characters one guest profile may hold (D-031). */
  maxCharactersPerAccount: number;
  autosaveIntervalMs: number;
  /** Game minutes per real minute (D-021). */
  timeScale: number;
  /** Shifts the game clock by whole game minutes (GAME_CLOCK_OFFSET_MINUTES; development and tests). */
  clockOffsetMinutes: number;
  startingBalanceCents: number;
  dailyAllowanceCents: number;
}

export const DEFAULT_TUNING: RoomTuning = {
  world: PLAZA_LAYOUT,
  walkSpeed: GAME_CONFIG.walkSpeed,
  maxInteractionDistance: INTERACTION_CONFIG.maxDistance,
  actionDurationsMs: {
    study: ACTION_EFFECTS.study.durationMs,
    sketch: ACTION_EFFECTS.sketch.durationMs,
    wash: ACTION_EFFECTS.wash.durationMs,
    greet: GREETING_EFFECTS.durationMs,
    work: ACTION_EFFECTS.work.durationMs,
    attend: ACTION_EFFECTS.attend.durationMs,
    exam: ACTION_EFFECTS.exam.durationMs,
    chat: ACTION_EFFECTS.chat.durationMs,
  },
  consumeDurationFactor: 1,
  guestCreationsPerIpPerHour: PROFILE_CONFIG.guestCreationsPerIpPerHour,
  maxCharactersPerAccount: PROFILE_CONFIG.maxCharactersPerAccount,
  autosaveIntervalMs: PROFILE_CONFIG.autosaveIntervalMs,
  timeScale: TIME_CONFIG.defaultScale,
  clockOffsetMinutes: 0,
  startingBalanceCents: ECONOMY_CONFIG.startingBalanceCents,
  dailyAllowanceCents: ECONOMY_CONFIG.dailyAllowanceCents,
};

/** Overrides accepted from createGameServer (action durations may be given one by one). */
export type TuningOverrides = Omit<Partial<RoomTuning>, "actionDurationsMs"> & { actionDurationsMs?: Partial<ActionDurations> };

/** Merges overrides into the defaults (action durations merge field by field). */
export function resolveTuning(overrides: TuningOverrides | undefined): RoomTuning {
  return {
    ...DEFAULT_TUNING,
    ...overrides,
    actionDurationsMs: { ...DEFAULT_TUNING.actionDurationsMs, ...overrides?.actionDurationsMs },
  };
}

export interface PlazaRoomOptions {
  tuning?: TuningOverrides;
  /** Key of this server's registered services (see services.ts). */
  servicesKey?: string;
}
