# Networking

## Model

One Colyseus room type, `plaza` (`server/src/PlazaRoom.ts`), max 16 players.
The server is authoritative over every replicated value.

| State | Owner | Replicated | Persistent |
| --- | --- | --- | --- |
| Player position, facing, moving flag | Server | Yes (all players in room) | Position and facing: yes (on leave, eviction, room close, 30 s autosave) |
| Display name | Server (from the saved profile) | Yes | Yes |
| Appearance option ids | Server (validated against the catalogue) | Yes (public) | Yes |
| Character id, account id, age category, profile version, timestamps | Server | No; the owner receives them in `profile` | Yes |
| Guest token | Client (`localStorage`); server keeps only its hash | Never replicated; sent by the server once, in `identity` | Hash only |
| Activity (`idle`/`sitting`/`studying`/`greeting`), seat, greeting target | Server | Yes | No |
| Seat occupancy and reservations (`state.seats`) | Server | Yes | No |
| Pending action (phase, goal, timer), greeting cooldowns | Server | No | No |
| Selection, open menu, hover, progress-bar animation | Client | No | No |
| Connected flag (reconnection window) | Server | Yes | No |
| Current path / direction intent | Server | No | No |
| Rate-limit counters | Server | No | No |
| Camera angle, zoom, input state | Client | No | No |
| Interpolated render positions | Client | No | No |

Everything else in this table is not persistent. Database details: `DATA_MODEL.md`.

## Messages

Defined in `shared/src/protocol.ts`.

Client → server (intents only):

| Type | Payload | Server behaviour |
| --- | --- | --- |
| `moveTo` | `{ x, z }` | Validates numbers, bounds and walkability, pathfinds from the server-side position. Rejects with a reason if not possible. |
| `moveDir` | `{ dx, dz }` | Clamps length to ≤ 1 (no speed hacks). Zero vector = stop. |
| `stop` | none | Stops walking and interrupts the current action (does not stand up). |
| `interact` | `{ targetKind: "object" \| "player", targetId, action }` | Validates and runs the interaction lifecycle (see ARCHITECTURE "Interactions"). Malformed → `rejected`; refused → `action` with status `rejected`. Counts toward the 20/s intent limit. |
| `cancelAction` | none | Cancels the current action, if any. |
| `createCharacter` | `{ displayName, ageCategory, appearance }` | Only for a session without a character. Validated (`parseNewCharacter`); player characters must be `adult`. Unknown fields (e.g. a chosen id or owner) are ignored. Creates a guest account too if the session has none. Answers `identity` (new accounts) and `profile`, or `profileError`. |
| `updateAppearance` | `{ appearance }` | Only for your own character (from the session, never the payload). Every field must be a catalogue id. Saved, then replicated. Counts toward the intent rate limit. |
| anything else | — | Ignored and logged at warn level. |

Server → client:

| Type | Payload | Meaning |
| --- | --- | --- |
| `rejected` | `{ action, reason }` | Movement or malformed `interact`. Reasons: `invalid_payload`, `target_out_of_bounds`, `target_blocked`, `unreachable`, `search_limit`, `rate_limited` |
| `action` | `{ actionId, status, action, targetKind, targetId, reason?, durationMs? }` | Sent only to the actor. Status flow: `queued` → `started` → `completed`, or `rejected` (never started, `actionId` 0), `failed`, `cancelled`. Refusal reasons: `unknown_target`, `target_is_self`, `target_offline`, `action_not_available`, `no_free_seat`, `too_far`, `unreachable`, `blocked`, `target_left`, `target_moved`, `too_soon`, `rate_limited`. Cancel reasons: `cancelled`, `interrupted`, `replaced`, `disconnected`. |
| `greeted` | `{ fromId, fromName }` | Sent to the player being greeted. |
| `profile` | `{ status: "needs_character" \| "ready", profile?, readOnly?, notices? }` | Sent to the owner only: after joining, after creating, after an appearance change. `readOnly` = stored by a newer version, not editable here. `notices` = e.g. a retired option was replaced. |
| `identity` | `{ guestToken }` | Sent once, when a new guest account is created. The client stores it. |
| `profileError` | `{ action, reason, field? }` | Reasons: `invalid_payload`, `invalid_name`, `age_category_not_allowed`, `invalid_appearance`, `already_has_character`, `no_character`, `profile_newer_version`, `rate_limited`, `storage_error`. |

### Joining and identity

`joinOrCreate("plaza", { guestToken? })`. The token travels in the matchmaking
HTTP request body, never in a URL, and is checked in `onAuth` before the
player joins:
- No token → anonymous visitor: receives `profile {status: "needs_character"}`,
  is not placed in the world, may send `createCharacter`.
- Valid token → the saved character is loaded and placed in the world.
- Unknown or malformed token → join refused with error code **4401**
  (`ERROR_INVALID_GUEST_TOKEN`); the client discards it and offers a new character.

Close code **4100** (`CLOSE_SIGNED_IN_ELSEWHERE`): this account started a newer
session elsewhere; the older connection is closed after saving (D-018).

In production the server must be behind HTTPS/WSS, or the token can be read
on the network.

Direct messages are sent immediately, while state patches go out every 50 ms,
so a client can receive `completed` slightly before the state shows the
character seated. Clients must not assume the two arrive together.

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
- Real authentication (only temporary guest accounts exist, D-017).
- A shared session registry for more than one server process.
- Client-side prediction and reconciliation for the local player.
- Chat, private messaging, blocking and reporting. Greetings are limited
  only by a 5 s cooldown per pair and the intent rate limit.
