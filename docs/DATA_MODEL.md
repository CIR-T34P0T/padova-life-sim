# Data model

Three layers: **persistent** (PostgreSQL, survives restarts), **replicated**
(Colyseus state, everyone in the room sees it while online) and
**server-only runtime** (in memory, never sent to clients).

## Persistent (PostgreSQL, since M4)

Schema: `server/migrations/0001_identity_and_profiles.sql` (identity and
profiles, M4), `0002_life_simulation.sql` (traits, needs, skills, mood
events and money, M5) and `0003_appearance_config.sql` (the appearance
document, M6). One table per concern, so later systems (inventory,
relationships, jobs) get their own tables instead of growing one JSON blob.

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
  config        jsonb    the appearance config (M6, D-028), see "Appearance config" below;
                         CHECK: a JSON object under 4 KB. NULL only for rows last saved by M4/M5.
  preset, skin_tone, hair_style, hair_colour, eye_colour, outfit   the M4 option ids. Since M6
                         they hold the closest old look (legacyAppearanceProjection), written
                         with every save, so rolling back migration 0003 keeps characters loadable.
  updated_at

character_state         where the character was when last saved
  character_id  uuid PK → characters (cascade delete)
  area          text   'plaza'
  pos_x, pos_z, rotation   real
  updated_at

schema_migrations       which migrations have run (managed by server/src/db/migrate.ts)
  version, name, applied_at
```

Life simulation (M5, `0002_life_simulation.sql`, SQL in
`server/src/life/lifeRepository.ts`):

```
character_traits        personality, chosen at creation (0–2 rows)
  character_id  uuid → characters (cascade delete)
  trait         text   id from TRAIT_IDS, validated in code
  PK (character_id, trait)

character_needs         one row per character
  character_id  uuid PK → characters (cascade delete)
  hunger, energy, hygiene, social, fun   real, CHECK 0–100 (100 = fully satisfied)
  updated_at    when they were last saved: the start of offline time (D-022)

character_skills        experience per skill; a missing row means 0 XP
  character_id  uuid → characters (cascade delete)
  skill         text   id from SKILL_IDS
  xp            double precision ≥ 0   levels are derived in code, never stored
  PK (character_id, skill)

character_mood_events   recent events that colour mood; one row per kind
  character_id  uuid → characters (cascade delete)
  event         text   id from MOOD_EVENTS
  started_at, expires_at   game minutes (D-021)
  PK (character_id, event)

character_wallets       the balance, one row per character
  character_id   uuid PK → characters (cascade delete)
  balance_cents  integer, CHECK ≥ 0   no debt (D-023)

wallet_transactions     append-only ledger; every money change is one row
  id                   uuid PK
  character_id         uuid → characters (cascade delete)
  direction            'income' | 'expense'
  category             'allowance' | 'purchase' | 'refund'
  amount_cents         integer > 0 (the sign comes from direction)
  balance_after_cents  integer ≥ 0
  item_id              café item for purchases and refunds, else null
  description          shown in the panel, e.g. "Panino", "Daily allowance"
  request_key          UNIQUE per character: makes the change idempotent
                       ("purchase:<request id>", "refund:purchase:<request id>",
                       "allowance:day-<n>", "starting-allowance")
  game_minute          when it happened, in game time
  created_at
  index (character_id, created_at DESC) for the recent-history query
```

**Money changes** (`applyMoneyChange`): one database transaction that locks
the wallet row (`SELECT … FOR UPDATE`, scoped to the owning account), checks
the request key, checks the balance, then updates the wallet and appends the
ledger row. Outcomes: `applied`, `duplicate` (same key: nothing changes, the
original result is reported), `insufficient_funds` (nothing changes) or
`not_owner`. Prices come from the server's catalogue (`CAFE_MENU`), never from
the client. Concurrent requests for the same wallet are serialised by the lock;
the CHECK constraints are a second line of defence.

**Migration 0002 for existing characters:** M4-era characters get starting
needs (80/80/80/70/70), a €100 wallet with a "Starting allowance" ledger row,
no traits and no skills. Its `down` section drops all six tables (destroys
life data; back up first).

**Migration 0003 (M6).** Adds `character_appearance.config`. Existing rows
keep `config` NULL and `profile_version` 2; the server upgrades each
character the first time it loads (profile version 2 → 3: the six flat
fields become an appearance config with the same body frame, the old skin
tone mapped onto the new continuous scale, hair style, hair and eye colour,
and the outfit split into top / outer / full outfit) and saves it. Its
`down` section sets version-3 characters back to version 2 and drops the
column; the M4 columns already hold the closest old look, so nothing is lost
that the M5 server could show.

**Appearance config** (`shared/src/appearance/schema.ts`, version
`APPEARANCE_SCHEMA_VERSION` = 1). One JSON object:

```
{ v: 1,
  body:   { frame, build, height, shoulders, torso, legs, arms },
  skin:   { tone, undertone, freckles, mark, blush },
  face:   { shape, cheekbones, jaw, chin, forehead, eyeShape, eyeSize, eyeSpacing, eyeColour,
            browShape, browHeight, noseShape, noseWidth, noseLength, lipShape, lipFullness },
  hair:   { style, colour, hairline, facial },
  outfit: { top, topColour, pattern, bottom, bottomColour, full, shoes, shoesColour,
            outer, outerColour, glasses, headwear, headwearColour } }
```

Option fields hold catalogue ids (`shared/src/appearance/catalogue.ts`);
slider fields are numbers 0–1 with two decimals (meanings in `schema.ts`).
Strict validation for anything a player sends (`parseAppearanceConfig`:
every field present and valid, or refused naming the field, e.g.
`hair.style`); lenient repair for stored or replicated data
(`sanitizeAppearance`: out-of-range sliders clamped, unknown ids replaced by
defaults and listed). There is **no ethnicity, race, nationality or heritage
field** (D-029), and no life-simulation rule reads appearance (guarded by a
test). Choices that are covered by others (hair under a headscarf, top and
bottom under a full outfit) stay saved; `visibleLayers` decides what is drawn.

**Profile versus table versions.** `profile_version` describes the *shape
and meaning* of profile data and is upgraded in code on load
(`shared/src/profile.ts`: `PROFILE_UPGRADES`, one step per version: 1 → 2
adds traits, 2 → 3 the appearance config). Table structure changes are SQL
migrations. Appearance option ids are validated against the catalogue in
code, so adding options needs neither; changing what a field means bumps
`APPEARANCE_SCHEMA_VERSION` with an upgrade step (docs/ASSET_PIPELINE.md).

**Ownership.** Every read and write of a character is scoped by the owning
account id, which the server takes from the authenticated session (a
verified guest token), never from client input
(`server/src/profiles/profileRepository.ts`). A mismatched owner finds nothing.

**Loading stored data safely** (`ProfileService.prepare`):
- Older profile version → upgraded step by step, then saved.
- Missing or retired appearance option → replaced by the default, saved, and
  the player is told which part (hair, outfit…) changed.
- Newer profile version (written by a newer server) or an unknown version →
  loaded **read-only** with safe defaults in memory; never overwritten.
- Saved position no longer walkable (e.g. the layout changed) → spawn point.

**What is saved when:** created atomically with the account on first visit
(account + credential + character + appearance + spawn position + traits +
starting needs + wallet + starting-allowance ledger row, in one transaction).
Appearance on every accepted change. **Money immediately**, in its own
transaction, whenever it changes. Position, needs, skills and mood events
together, in one transaction (`LifeService.saveAll`), when the player leaves,
is evicted by a newer session or the room closes; every 30 s for every
character in the world (`PROFILE_CONFIG.autosaveIntervalMs`; needs change all
the time); and right after a completed action that gave skill XP. A seated
character is saved at the spot it stands up to.

**Not persisted (yet):** activity, seats, pending actions (including a meal
being eaten: the price is already paid, the rest of the meal is lost if the
player disconnects mid-meal), greeting cooldowns, online status. Inventory,
relationships, jobs and housing do not exist yet; each will get its own tables.

## Replicated (`server/src/schema.ts`)

```
PlazaState
  players: Map<sessionId, PlayerState>
  seats:   Map<seatId, sessionId>   occupied or reserved seats and standing spots
  gameMinute: uint32                the world clock in game minutes (D-021);
                                    changes once per game minute

PlayerState
  name: string         the character's display name (from its profile)
  x, z: float32        metres, server-decided
  rotation: float32    radians around Y, 0 faces +Z
  moving: boolean
  connected: boolean   false during the reconnection window
  look: string         the appearance config as canonical JSON (encodeLook, < 1 KB;
                       public: everyone sees your look). One string, so a change arrives
                       as one patch and clients rebuild only the parts that changed.
  activity: string     "idle" | "sitting" | "studying" | "sketching" | "greeting"
                       | "ordering" | "eating" | "drinking" | "washing"
  seatId: string       seat or standing spot in use, else ""
  targetId: string     player being greeted while greeting, else ""
```

Character id, account id, age category, timestamps and the guest token are
**not** replicated. A player's own full profile is sent only to that player
(`profile` message).

**Private life data (M5, D-024).** Needs, mood, skills, traits, balance and
recent transactions are **not** in the shared state. Each player receives
only their own, as a `life` message (`LifePayload` in `shared/src/protocol.ts`):
at most every 500 ms while something visible changed, and immediately after
money changes or refusals. Other players see only the public activity
("eating", "studying"…).

## Server-only runtime

- `PlayerRuntime` (`server/src/runtime.ts`): movement intent, rate-limit
  counters, pending action (with its phase — approach, paying, active — the
  café item, request id and how much of its effect has been applied), last
  greeting time per target.
- `CharacterLife` (`server/src/life/LifeSystem.ts`): the in-memory needs,
  skills, mood events, balance and recent ledger rows of each character in
  the world, the allowance day, and when the last `life` message was sent.
- `Session` (`server/src/PlazaRoom.ts`): authenticated account id, owner
  (account + character), read-only flag, last saved position, pending removal.
- `SessionRegistry`: which session currently plays each account (D-018).

## Static content (`shared/src`)

- `world.ts`: world bounds, obstacle boxes, spawn points, interactables with
  seats (sitting) and standing spots (café counter, fountain; D-026).
- `appearance/`: the appearance catalogue (option ids, labels, colours, hair
  textures), the config schema with validation, look strings and look codes,
  skin-tone colour maths (OKLab), presets, the seeded randomiser and the
  visibility rules (M6).
- `profile.ts`: age categories, profile version and upgrade steps (version 2
  adds traits, version 3 the appearance config).
- `life/config.ts`: every M5 tuning value and catalogue — needs (initial
  values, rates, thresholds), offline rules, mood events, skills and XP
  curve, action effects, the café menu (`CAFE_MENU`, prices in cents),
  traits (`TRAITS`), starting balance and daily allowance.

## Rules to keep

- Every persistent value has a single server-side owner and is changed only by
  validated server actions.
- Separate tables per concern; no catch-all JSON column for game state. The
  appearance document is the one documented exception (D-028): purely
  cosmetic, versioned and validated as a whole.
- Currency changes are recorded as ledger transactions with an idempotency
  key, never as a client-set balance. The balance never goes below zero.
- Store the minimum personal data. Guest accounts hold no personal data beyond
  a chosen display name. Deletion and moderation workflows are still to be
  built (see TESTING.md known gaps).
- Migrations are numbered, run in a transaction each, and have a `down`
  section. Back up before destructive migrations.
