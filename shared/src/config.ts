// Tuning values shared by client and server. Change gameplay numbers here,
// not inline in systems.

export const GAME_CONFIG = {
  /** Server simulation step in milliseconds (20 Hz). */
  tickMs: 50,
  /** How often the server sends state patches, in milliseconds. */
  patchMs: 50,
  /** Walking speed in metres per second. */
  walkSpeed: 3.2,
  /** Player collision radius in metres. */
  playerRadius: 0.35,
  /** Pathfinding grid cell size in metres. */
  navCellSize: 0.5,
  /** Upper bound on A* node expansions per request (protects the server). */
  maxPathExpansions: 20_000,
  /** Messages a client may send per second before it is disconnected. */
  maxMessagesPerSecond: 40,
  /** Movement intents per second that are processed; extras are ignored. */
  maxMoveIntentsPerSecond: 20,
  /** Seconds a dropped player keeps their character while reconnecting. */
  reconnectSeconds: 20,
  /** Players per plaza room for the walking skeleton. */
  maxPlayersPerRoom: 16,
  /** Display-name rules. */
  nameMinLength: 2,
  nameMaxLength: 20,
  /** Client renders remote players this far in the past to interpolate (ms). */
  interpolationDelayMs: 100,
} as const;

/** Tuning for contextual interactions (M3). */
export const INTERACTION_CONFIG = {
  /**
   * Straight-line distance (m) beyond which an interaction is refused as too
   * far. Raised from 35 to 60 in M5 so anything in the piazza (48 m across)
   * can be used from anywhere in it, e.g. café counter from the study desks.
   */
  maxDistance: 60,
  /** How close (m) a character must get to an interaction point before acting. */
  arrivalTolerance: 0.25,
  /** Centre-to-centre distance (m) within which a greeting can happen. */
  greetRange: 2.5,
  /** Distance (m) from the other player where the greeter stops. */
  greetStandOff: 1.3,
  /** How many times a greeter re-plans when the other player walks away. */
  maxGreetReplans: 3,
  /** Minimum time (ms) between greetings from the same player to the same player. */
  greetCooldownMs: 5000,
  /** Minimum time (ms) between chats started by the same player with the same player (M9). */
  chatCooldownMs: 30_000,
  /** A chat stops when the two players are further apart than this (m) (M9). */
  chatRange: 4,
  // Action durations and effects moved to shared/src/life/config.ts in M5.
} as const;

/**
 * Player safety (M9, D-042). Reports are read by the product owner; their
 * details are deleted after `reportRetentionDays` real days.
 */
export const SAFETY_CONFIG = {
  reportReasons: [
    { id: "harassment", label: "Harassment or bullying" },
    { id: "hate", label: "Hateful or discriminatory behaviour" },
    { id: "offensive_name", label: "Offensive name or look" },
    { id: "cheating", label: "Cheating or exploiting the game" },
    { id: "other", label: "Something else" },
  ],
  /** Longest optional note with a report (characters). */
  noteMaxLength: 300,
  /** Real days a report's details are kept. */
  reportRetentionDays: 90,
  /** Reports one account may send per real hour. */
  reportsPerHour: 5,
  /** One report per reporter and reported account within this many real hours. */
  reportRepeatHours: 24,
  /** Blocked accounts shown and kept per account. */
  maxBlocks: 200,
} as const;

export type ReportReason = (typeof SAFETY_CONFIG.reportReasons)[number]["id"];

/** Tuning for identity and persistence (M4). */
export const PROFILE_CONFIG = {
  /** New guest accounts allowed per IP address per hour (abuse protection). */
  guestCreationsPerIpPerHour: 10,
  /** How often moved characters' positions are saved while online (ms). */
  autosaveIntervalMs: 30_000,
  /**
   * Characters ("lives") one guest profile may hold (D-031). Set to 1 to go
   * back to one character per profile; existing extra characters stay saved.
   */
  maxCharactersPerAccount: 3,
} as const;

export const ROOM_NAME = "plaza";
