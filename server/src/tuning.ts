// Per-room tuning. Production uses the shared defaults; tests may override
// values (e.g. shorter durations, a custom world) through createGameServer().

import { GAME_CONFIG, INTERACTION_CONFIG, PLAZA_LAYOUT, PROFILE_CONFIG, type WorldLayout } from "@padova/shared";

export interface RoomTuning {
  world: WorldLayout;
  walkSpeed: number;
  maxInteractionDistance: number;
  studyDurationMs: number;
  greetDurationMs: number;
  guestCreationsPerIpPerHour: number;
  autosaveIntervalMs: number;
}

export const DEFAULT_TUNING: RoomTuning = {
  world: PLAZA_LAYOUT,
  walkSpeed: GAME_CONFIG.walkSpeed,
  maxInteractionDistance: INTERACTION_CONFIG.maxDistance,
  studyDurationMs: INTERACTION_CONFIG.studyDurationMs,
  greetDurationMs: INTERACTION_CONFIG.greetDurationMs,
  guestCreationsPerIpPerHour: PROFILE_CONFIG.guestCreationsPerIpPerHour,
  autosaveIntervalMs: PROFILE_CONFIG.autosaveIntervalMs,
};

export interface PlazaRoomOptions {
  tuning?: Partial<RoomTuning>;
  /** Key of this server's registered services (see services.ts). */
  servicesKey?: string;
}
