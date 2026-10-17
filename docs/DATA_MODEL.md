# Data model

Three layers: **persistent** (PostgreSQL, survives restarts), **replicated**
(Colyseus state, everyone in the room sees it while online) and
**server-only runtime** (in memory, never sent to clients).

## Persistent (PostgreSQL, since M4)

Schema: `server/migrations/0001_identity_and_profiles.sql`. One table per
concern, so later systems (inventory, skills, relationships) get their own
tables instead of growing one JSON blob.

```
accounts                one per player identity
  id            uuid PK
  kind          text     'guest' only, for now (D-017)
  created_at, last_seen_at

guest_credentials       proof of ownership for a guest account
  account_id    uuid PK → accounts (cascade delete)
  token_hash    text UNIQUE, 64 hex chars: SHA-256 of the browser's secret token.
                The token itself is never stored.
  created_at

characters              the character profile
  id               uuid PK          stable character id
  account_id       uuid → accounts  owner (cascade delete); UNIQUE: one character per account for now
  display_name     text             2–20 chars enforced in code; 1–40 checked by the database
  age_category     text             'child' | 'teen' | 'adult' (database CHECK); players: 'adult' only (D-019)
  profile_version  integer ≥ 1      version of the profile data shape (PROFILE_VERSION)
  created_at, updated_at

character_appearance    one row per character
  character_id  uuid PK → characters (cascade delete)
  preset, skin_tone, hair_style, hair_colour, eye_colour, outfit   option ids from the shared catalogue
  updated_at

character_state         where the character was when last saved
  character_id  uuid PK → characters (cascade delete)
  area          text   'plaza'
  pos_x, pos_z, rotation   real
  updated_at

schema_migrations       which migrations have run (managed by server/src/db/migrate.ts)
  version, name, applied_at
```

**Profile versus table versions.** `profile_version` describes the *shape
and meaning* of profile data and is upgraded in code on load
(`shared/src/profile.ts`: `PROFILE_UPGRADES`, one step per version). Table
structure changes are SQL migrations. Appearance option ids are validated
against the catalogue in code, so adding options needs neither.

**Ownership.** Every read and write of a character is scoped by the owning
account id, which the server takes from the authenticated session (a
verified guest token), never from client input
(`server/src/profiles/profileRepository.ts`). A mismatched owner finds nothing.

**Loading stored data safely** (`ProfileService.prepare`):
- Older profile version → upgraded step by step, then saved.
- Missing or retired appearance option → replaced by the default, saved, and
  the player is told which option changed.
- Newer profile version (written by a newer server) or an unknown version →
  loaded **read-only** with safe defaults in memory; never overwritten.
- Saved position no longer walkable (e.g. the layout changed) → spawn point.

**What is saved when:** created atomically with the account on first visit
(account + credential + character + appearance + spawn position in one
transaction). Appearance on every accepted change. Position when the player
leaves, is evicted by a newer session, or the room closes, and every 30 s for
players who moved (`PROFILE_CONFIG.autosaveIntervalMs`). A seated character is
saved at the spot it stands up to.

**Not persisted (yet):** activity, seats, pending actions, greeting cooldowns,
online status. Needs, skills, inventory, money, relationships and housing do
not exist yet; each will get its own tables.

## Replicated (`server/src/schema.ts`)

```
PlazaState
  players: Map<sessionId, PlayerState>
  seats:   Map<seatId, sessionId>   occupied or reserved seats

PlayerState
  name: string         the character's display name (from its profile)
  x, z: float32        metres, server-decided
  rotation: float32    radians around Y, 0 faces +Z
  moving: boolean
  connected: boolean   false during the reconnection window
  preset, skinTone, hairStyle, hairColour, eyeColour, outfit: string
                       appearance option ids (public: everyone sees your look)
  activity: string     "idle" | "sitting" | "studying" | "greeting"
  seatId: string       seat occupied while sitting/studying, else ""
  targetId: string     player being greeted while greeting, else ""
```

Character id, account id, age category, timestamps and the guest token are
**not** replicated. A player's own full profile is sent only to that player
(`profile` message).

## Server-only runtime

- `PlayerRuntime` (`server/src/runtime.ts`): movement intent, rate-limit
  counters, pending action, last greeting time per target.
- `Session` (`server/src/PlazaRoom.ts`): authenticated account id, owner
  (account + character), read-only flag, last saved position, pending removal.
- `SessionRegistry`: which session currently plays each account (D-018).

## Static content (`shared/src`)

- `world.ts`: world bounds, obstacle boxes, spawn points, interactables with seats.
- `profile.ts`: appearance catalogue (option ids, labels, display colours),
  defaults, age categories, profile version and upgrade steps.

## Rules to keep

- Every persistent value has a single server-side owner and is changed only by
  validated server actions.
- Separate tables per concern; no catch-all JSON column for game state.
- Currency changes will be recorded as transactions, never as a client-set balance.
- Store the minimum personal data. Guest accounts hold no personal data beyond
  a chosen display name. Deletion and moderation workflows are still to be
  built (see TESTING.md known gaps).
- Migrations are numbered, run in a transaction each, and have a `down`
  section. Back up before destructive migrations.
