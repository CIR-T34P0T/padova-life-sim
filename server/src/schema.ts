// Replicated room state. Only what other players need to see is synchronised;
// pathfinding waypoints, rate-limit counters and other internals stay on the
// server (see PlazaRoom).

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
    /** Placeholder body colour (0-359) until real character customisation exists. */
    hue: t.uint16(),
  },
  "PlayerState",
);
export type PlayerState = SchemaType<typeof PlayerState>;

export const PlazaState = schema(
  {
    players: t.map(PlayerState),
  },
  "PlazaState",
);
export type PlazaState = SchemaType<typeof PlazaState>;
