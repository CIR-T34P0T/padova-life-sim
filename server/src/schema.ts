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
    /**
     * The character's appearance config as canonical JSON (encodeLook in
     * shared/src/appearance/schema.ts, under 1 KB). One string, so a change
     * arrives in one patch and clients rebuild the avatar once (D-028).
     */
    look: t.string(),
    /** Public activity (shared Activity type): idle, sitting, studying, sketching, greeting, ordering, eating, drinking, washing. */
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
    /** The world clock (D-021): current game minute, kept by the server. Clients only display it. */
    gameMinute: t.uint32(),
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
