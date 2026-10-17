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

export const ROOM_NAME = "plaza";
