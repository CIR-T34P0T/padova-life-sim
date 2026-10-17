// Replicated room state. Only what other players need to see is synchronised;
// pathfinding waypoints, pending actions, rate-limit counters and other
// internals stay on the server (see PlayerRuntime).

import { schema, t, type SchemaType } from "@colyseus/schema";

export const PlayerState = schema(
  {
    name: t.string(),
    x: t.float32(),
    z: t.float32(),
    /** Facing angle in radians around Y; 0 faces +Z. */
    rotation: t.float32(),
    moving: t.boolean(),
    /** False while the player is dropped and inside the reconnection window. */
    connected: t.boolean(),
    /** Appearance option ids from the shared catalogue (see shared/src/profile.ts). */
    preset: t.string(),
    skinTone: t.string(),
    hairStyle: t.string(),
    hairColour: t.string(),
    eyeColour: t.string(),
    outfit: t.string(),
    /** "idle" | "sitting" | "studying" | "greeting" (shared Activity type). */
    activity: t.string(),
    /** Seat occupied while sitting or studying; "" when standing. */
    seatId: t.string(),
    /** Session id of the player being greeted while activity is "greeting"; otherwise "". */
    targetId: t.string(),
  },
  "PlayerState",
);
export type PlayerState = SchemaType<typeof PlayerState>;

export const PlazaState = schema(
  {
    players: t.map(PlayerState),
    /**
     * seatId → session id of the player sitting there OR walking to it. Lets
     * every client show only seats that are actually free.
     */
    seats: t.map("string"),
  },
  "PlazaState",
);
export type PlazaState = SchemaType<typeof PlazaState>;
