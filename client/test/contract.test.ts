// Client ↔ server state contract (integration audit, 2026-10-20). The client
// reads replicated players through its own `ReplicatedPlayer` interface
// (client/src/net/connection.ts), which the compiler cannot check against the
// server's Colyseus schema (server/src/schema.ts). This test keeps the two
// field lists identical, so a field added, renamed or removed on one side
// fails here instead of silently reading `undefined` in the game.

import { describe, expect, it } from "vitest";
import { PlayerState } from "../../server/src/schema.ts";
import type { ReplicatedPlayer } from "../src/net/connection.ts";

// `satisfies` makes the compiler insist on exactly the interface's keys.
const CLIENT_FIELDS = {
  name: true,
  x: true,
  z: true,
  rotation: true,
  moving: true,
  connected: true,
  look: true,
  activity: true,
  seatId: true,
  targetId: true,
  area: true,
} satisfies Record<keyof ReplicatedPlayer, true>;

/** Field names of a Colyseus schema class (its decorator metadata). */
function schemaFields(type: unknown): string[] {
  const metadata = (type as Record<symbol, Record<string, { name?: string }> | undefined>)[Symbol.metadata];
  return Object.values(metadata ?? {})
    .map((field) => field?.name)
    .filter((name): name is string => typeof name === "string");
}

describe("replicated player contract", () => {
  it("the client's ReplicatedPlayer has exactly the server's PlayerState fields", () => {
    const server = schemaFields(PlayerState).sort();
    expect(server.length).toBeGreaterThan(0);
    expect(server).toEqual(Object.keys(CLIENT_FIELDS).sort());
  });
});
