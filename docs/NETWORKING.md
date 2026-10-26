# Networking

## Model

One Colyseus room type, `plaza` (`server/src/PlazaRoom.ts`), max 16 players.
The server is authoritative over every replicated value.

| State | Owner | Replicated | Persistent |
| --- | --- | --- | --- |
| Player position, facing, moving flag | Server | Yes (all players in room) | Position and facing: yes (on leave, eviction, room close, 30 s autosave) |
| Display name | Server (from the saved profile) | Yes | Yes |
| Appearance config (M6) | Server (validated with `parseAppearanceConfig`) | Yes (public), as one `look` string: canonical JSON under 1 KB | Yes (`character_appearance.config`) |
| Character id, account id, age category, profile version, timestamps | Server | No; the owner receives them in `profile` | Yes |
| Guest token | Client (`localStorage`); server keeps only its hash | Never replicated; sent by the server once, in `identity` | Hash only |
| Activity (`idle`/`sitting`/`studying`/`sketching`/`greeting`/`ordering`/`eating`/`drinking`/`washing`), seat or standing spot, greeting target | Server | Yes | No |
| Seat and standing-spot occupancy and reservations (`state.seats`) | Server | Yes | No |
| World clock (`state.gameMinute`) | Server (derived from real time, D-021) | Yes | No (recomputed from the real clock) |
| Needs, mood and mood events, skills, traits | Server | **No**: only the owner receives them, in `life` (D-024) | Yes |
| Balance and transactions | Server (ledger, D-023) | **No**: only the owner, in `life` | Yes, written immediately |
| Pending action (phase, goal, timer, café item, request id), greeting cooldowns | Server | No | No |
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
| `interact` | `{ targetKind: "object" \| "player", targetId, action, itemId?, requestId? }` | Validates and runs the interaction lifecycle (see ARCHITECTURE "Interactions"). `itemId` (`[a-z0-9-]{1,32}`) names the café item for `buy`; the price always comes from the server's menu. `requestId` (`[A-Za-z0-9_-]{8,64}`) makes a purchase idempotent: the same id never charges or serves twice (a repeat is refused with `duplicate_request`); the server makes one if absent. Any other field (e.g. a price) is ignored. Malformed → `rejected`; refused → `action` with status `rejected`. Counts toward the 20/s intent limit. |
| `cancelAction` | none | Cancels the current action, if any. |
| `quitJob` | none | In the world only (ignored at the title screen). Ends the character's job (M7): a shift being walked to or worked is cancelled first and pays nothing, then the job row is deleted; shift history and wages stay. Ignored without a job. Counts toward the intent rate limit. Confirmed by the next `life` message (`job: null`). |
| `createCharacter` | `{ displayName, ageCategory, appearance, traits? }` | Only at the title screen (not while in the world: `in_world`). Validated (`parseNewCharacter`); player characters must be `adult`; `traits` = up to two distinct known trait ids. Unknown fields (e.g. a chosen id or owner) are ignored. Creates a guest account too if the session has none; otherwise adds a character to the session's account, up to `maxCharactersPerAccount` (`too_many_characters`). Enters the world with it. Answers `identity` (new accounts) and `profile` (`ready`), or `profileError`. |
| `enterWorld` | `{ characterId }` | Title screen only. `characterId` must be a UUID **of the session's own account** (checked in the database query; anything else is `character_not_found`). Claims the account (another window playing it is saved and closed with 4100), loads the character and places it in the world. Answers `profile` (`ready`). |
| `leaveWorld` | none | Saves the character, removes it from the world for everyone and answers a fresh `profile` (`lobby`). At the title screen it just answers the lobby again. |
| `deleteCharacter` | `{ characterId, confirmName }` | Title screen only. Permanently deletes one of the session's own characters and everything that belongs to it, if `confirmName` matches its name (ignoring case and extra spaces: `confirm_name_mismatch`) and nobody is playing it in any window (`character_in_use`). Answers the updated lobby. |
| `updateAppearance` | `{ appearance, characterId? }` | In the world: always the character being played (from the session; any id in the payload is ignored). At the title screen: `characterId` names one of the session's own characters that isn't being played (`character_in_use`). `appearance` is a complete appearance config (version 1): every option a catalogue id, every slider a number 0–1, or the request is refused naming the field (`hair.style`, `skin.tone`…). Changes the look only, never needs, money, skills or traits. Saved, then replicated as the new `look` (in the world) or answered with the updated lobby (title screen). In the world it counts toward the intent rate limit. |
| anything else | — | Ignored and logged at warn level. |

Server → client:

| Type | Payload | Meaning |
| --- | --- | --- |
| `rejected` | `{ action, reason }` | Movement or malformed `interact`. Reasons: `invalid_payload`, `target_out_of_bounds`, `target_blocked`, `unreachable`, `search_limit`, `rate_limited` |
| `action` | `{ actionId, status, action, targetKind, targetId, reason?, durationMs?, itemId? }` | Sent only to the actor. Status flow: `queued` → `started` → `completed`, or `rejected` (never started, `actionId` 0), `failed`, `cancelled`. Refusal reasons: `unknown_target`, `target_is_self`, `target_offline`, `action_not_available`, `no_free_seat`, `busy` (standing spot taken), `too_far`, `unreachable`, `blocked`, `target_left`, `target_moved`, `too_soon`, `rate_limited`, and since M5 `too_tired`, `unknown_item`, `insufficient_funds` (checked on request and again when paying). Failures while paying at the counter (status `failed`): `insufficient_funds`, `duplicate_request` (this request id was already charged; nothing is charged or served again), `purchase_failed` (the payment could not be stored; nothing charged). Work (M7), for `ask_work` and `work` at the café counter: refusals `already_employed`, `not_employed`, `closed` (outside opening hours), `shift_limit` (today's shifts done), `too_tired`, `busy` (both staff spots taken, or a hire or quit is still being written); failures `hire_failed` (the job could not be stored; nothing changed), `wage_failed` (the wage could not be stored; the shift does not count), and `shift_limit` or `not_employed` if the database disagrees when paying. A finished shift goes `started` → `completed` only after its wage is recorded. Cancel reasons: `cancelled`, `interrupted`, `replaced`, `disconnected`. |
| `greeted` | `{ fromId, fromName }` | Sent to the player being greeted. |
| `life` | `LifePayload`: `{ gameMinute, needs, mood: { score, level, reasons, events }, skills: { xp, level, progress } per skill, traits, money: { balanceCents, recent }, job: { jobId, shiftsToday } \| null }` | Sent to the owner only (D-024). `job` (M7) is the character's job and its completed shifts on the current game day; grade, wage and opening hours follow from the shared rules (`shared/src/life/work.ts`). Pay is never replicated: others see only the public activity `working`: on entering the world, at most every 500 ms while a visible value changed, and at once after a money change, a refusal that affects mood, or a completed action. Other players never receive it. |
| `profile` | `{ status: "lobby" \| "ready", characters?, maxCharacters?, profile?, readOnly?, notices? }` | Sent to the owner only. `lobby` (after joining, leaving the world, deleting, or a title-screen look change): `characters` = this account's characters, most recently played first, each `{ characterId, displayName, look, traits, createdAt, lastPlayedAt, readOnly, notices }` (no life data); empty for a new visitor. `ready` (after entering, creating, or an in-world look change): `profile` = the character in the world. `readOnly` = stored by a newer version, not editable here. `notices` = e.g. a retired option was replaced. |
| `identity` | `{ guestToken }` | Sent once, when a new guest account is created. The client stores it. |
| `profileError` | `{ action, reason, field? }` | `action`: `createCharacter`, `updateAppearance`, `enterWorld`, `deleteCharacter`, `listCharacters`. Reasons: `invalid_payload`, `invalid_name`, `age_category_not_allowed`, `invalid_appearance`, `invalid_traits`, `too_many_characters`, `character_not_found`, `character_in_use`, `confirm_name_mismatch`, `in_world`, `busy` (another profile request from this window is still running), `profile_newer_version`, `rate_limited`, `storage_error`. |

### Joining and identity

`joinOrCreate("plaza", { guestToken? })`. The token travels in the matchmaking
HTTP request body, never in a URL, and is checked in `onAuth` before the
player joins:
- No token → anonymous visitor: receives `profile {status: "lobby", characters: []}`,
  is not placed in the world, may send `createCharacter`.
- Valid token → the title screen (lobby): `profile {status: "lobby"}` lists the
  account's characters; nothing enters the world until `enterWorld` or
  `createCharacter` (D-031).
- Unknown or malformed token → join refused with error code **4401**
  (`ERROR_INVALID_GUEST_TOKEN`); the client discards it and offers a new character.

Close code **4100** (`CLOSE_SIGNED_IN_ELSEWHERE`): this account entered the
world from a newer session elsewhere; the older connection is closed after
saving (D-018). Opening the title screen in another window does not do this.

Sessions at the title screen still receive the shared room state (the other
players in the piazza); the client keeps it but builds no avatars until it
enters the world. Interest management will cut this traffic later.

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

- Join: `joinOrCreate("plaza", { guestToken? })` (see "Joining and identity").
  The display name comes from the saved character profile, never from join
  options. (The M2 walking skeleton joined with a typed name; that path and its
  leftover `JoinOptions` type were removed.)
- Deliberate leave (tab closed, navigation): consented leave, removed at once.
- Unexpected drop (network loss): `onDrop` marks the player `connected=false`
  (shown semi-transparent) and holds the character for 20 s. The SDK retries
  with exponential backoff and resumes the same session; `onReconnect` restores it.
- SDK limitation: automatic reconnection is refused if the room was joined
  less than 5 s ago (SDK default `minUptime`).

## Appearance replication (M6, D-028)

Each player's look is one replicated string, `PlayerState.look`: the
appearance config as canonical JSON (fixed key order, so equal looks are
equal strings), about 700–900 bytes. It is sent when the player appears and
again only when the owner saves a change; nothing about appearance is sent
per frame. Clients decode it with `decodeLook`, which never throws: an
unreadable or newer look is drawn as the default look rather than breaking
the client. On a change, the client compares the new look with the old one
and rebuilds only the affected body parts (`client/src/render/avatar/character.ts`).
Hidden choices (hair under a headscarf) are still replicated, so the look is
the same on every client when the covering comes off.

## Game time (D-021)

The server derives the game minute from its real clock and the time scale
(`GAME_TIME_SCALE`, default 10 game minutes per real minute) and replicates
it as `state.gameMinute`, which changes once per game minute (every 6 s by
default). Clients display it; they never advance time themselves. The
day/night light (M7b) is drawn from the same replicated minute, so it needs
no messages of its own and every player sees the same time of day.

`GAME_CLOCK_OFFSET_MINUTES` (whole game minutes, at most a week either way;
default 0) shifts the whole clock, for development and tests: for example to
try the café's opening hours (06:00–23:00) at any real time. The browser
tests use it to start at 09:00 game time (`playwright.config.ts`). It is
still one server clock that every player shares.

## Not yet implemented

- Interest management / proximity filtering (one small room makes it unnecessary so far).
- Multiple rooms or areas, room transfer between districts.
- Real authentication (only temporary guest accounts exist, D-017).
- A shared session registry for more than one server process.
- Client-side prediction and reconciliation for the local player.
- Chat, private messaging, blocking and reporting. Greetings are limited
  only by a 5 s cooldown per pair and the intent rate limit.
