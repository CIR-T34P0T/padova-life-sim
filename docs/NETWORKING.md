# Networking

## Model

One Colyseus room type, `plaza` (`server/src/PlazaRoom.ts`), max 16 players.
The server is authoritative over every replicated value.

| State | Owner | Replicated | Persistent |
| --- | --- | --- | --- |
| Player position, facing, moving flag | Server | Yes (all players in room) | No |
| Display name, placeholder colour | Server (name sanitised from join option) | Yes | No |
| Connected flag (reconnection window) | Server | Yes | No |
| Current path / direction intent | Server | No | No |
| Rate-limit counters | Server | No | No |
| Camera angle, zoom, input state | Client | No | No |
| Interpolated render positions | Client | No | No |

Nothing is persistent yet (M4).

## Messages

Defined in `shared/src/protocol.ts`.

Client → server (intents only):

| Type | Payload | Server behaviour |
| --- | --- | --- |
| `moveTo` | `{ x, z }` | Validates numbers, bounds and walkability, pathfinds from the server-side position. Rejects with a reason if not possible. |
| `moveDir` | `{ dx, dz }` | Clamps length to ≤ 1 (no speed hacks). Zero vector = stop. |
| `stop` | none | Stops walking. |
| anything else | — | Ignored and logged at warn level. |

Server → client:

| Type | Payload | Meaning |
| --- | --- | --- |
| `rejected` | `{ action, reason }` | Reasons: `invalid_payload`, `target_out_of_bounds`, `target_blocked`, `unreachable`, `search_limit`, `rate_limited` |

State is synchronised automatically via `PlazaState` (`server/src/schema.ts`).

## Rates and limits (`shared/src/config.ts`)

- Simulation: 20 Hz (`tickMs` 50). State patches: every 50 ms.
- Movement intents: max 20/s per player; extras are ignored (one `rate_limited` reply per window).
- Any messages: max 40/s per client, beyond which Colyseus disconnects the client.
- Client sends direction updates at most every 80 ms, only when they change.

## Smoothing

Clients buffer timestamped snapshots per player and render 100 ms in the past,
interpolating between the two surrounding snapshots (`client/src/net/interpolation.ts`).
The local player is rendered the same way (no prediction yet, see D-006).

## Join, leave, reconnection

- Join: `joinOrCreate("plaza", { name })`. Unusable names become `Guest N`.
- Deliberate leave (tab closed, navigation): consented leave, removed at once.
- Unexpected drop (network loss): `onDrop` marks the player `connected=false`
  (shown semi-transparent) and holds the character for 20 s. The SDK retries
  with exponential backoff and resumes the same session; `onReconnect` restores it.
- SDK limitation: automatic reconnection is refused if the room was joined
  less than 5 s ago (SDK default `minUptime`).

## Not yet implemented

- Interest management / proximity filtering (one small room makes it unnecessary so far).
- Multiple rooms or areas, room transfer between districts.
- Authentication; player identity across sessions.
- Client-side prediction and reconciliation for the local player.
- Chat, private messaging, blocking and reporting.
