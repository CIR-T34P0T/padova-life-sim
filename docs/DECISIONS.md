# Decisions

Significant technical decisions, newest last. Changing one needs the product
owner's approval and a new entry explaining why; the old entry stays, marked
"Superseded by D-0xx". Questions put to the product owner are
listed in ROADMAP.md ("Decisions for the product owner"); their answers are
recorded here (D-035).

## D-001 — TypeScript across client, server and shared rules (2026-10-17, approved)

One language lets game rules be written once in `shared/` and executed by the
server (authority) and client (display, early feedback).

## D-002 — Three.js for rendering (2026-10-17, approved)

Chosen over Babylon.js mainly for the anime-character pipeline: `three-vrm` is
the reference loader for VRM avatars. Three.js is a renderer rather than a full
engine, so pathfinding, input and UI are our own modules. Target WebGL2 for
mobile reach; WebGPU later.

## D-003 — Colyseus 0.18 for authoritative multiplayer (2026-10-17, approved)

Provides rooms, schema-based delta state sync, matchmaking and reconnection.
We depend on `@colyseus/core` + `@colyseus/ws-transport` rather than the
all-in-one `colyseus` package to avoid unused auth/monitor/Redis modules.
MIT licence.

## D-004 — PostgreSQL for persistence (2026-10-17, approved; in use since M4)

Relational data (players, relationships, jobs, grades, transactions) fits a
relational database. Introduced at M4 with versioned migrations (D-015, D-016).

## D-005 — Grid A* pathfinding for the first area (2026-10-17)

A uniform 0.5 m grid over one 48 m piazza is ~9,200 cells, cheap to search and
fully testable. Recast/navmesh is deferred until interiors, stairs or larger
districts need it. `NavGrid.findPath` is the contract to keep when replacing it.

## D-006 — Movement intents, not positions (2026-10-17)

Clients send `moveTo` (target point) or `moveDir` (unit direction). The server
pathfinds, clamps speed and resolves collision. Forged positions are
impossible by construction. Trade-off: the local player sees its own movement
with ~100–150 ms delay (no client prediction yet). Prediction with
reconciliation is a planned improvement once interactions exist.

## D-007 — No React yet (2026-10-17, revised for M3)

The skeleton's UI was a join form and two status pills. M3's radial menu,
action sheet and progress pill were also built in plain DOM/TypeScript
(about 300 lines) without trouble, so React was still not added. Revisit when
data-heavy panels arrive (character info, inventory, relationships). If
added, React renders UI panels only, never the game loop.

## D-008 — Closing the tab leaves immediately; network drops get 20 s (2026-10-17)

`pagehide` sends a consented leave so a closed tab disappears for everyone at
once. Unexpected disconnects hold the character for 20 s while the SDK
reconnects automatically. Since M4 a reload or a later visit loads the same
saved character (D-017), at the position saved when the tab closed.

## D-009 — Source control on a private GitHub repo, trunk on `main` (2026-10-17)

Code lives at `CIR-T34P0T/padova-life-sim` (private). Small, tested changes go
straight to `main`; risky or multi-step features use a branch and are merged
once `npm run check` and the e2e suite pass. Check the working tree and pull
before changing anything.

## D-010 — Tooling versions (2026-10-17)

TypeScript 7 (native compiler), Vite 8, Vitest 5, Playwright 1.64, tsx 4,
Three.js r186, Colyseus 0.18. Vitest 4 could not be installed: npm 10 failed
while resolving its optional peer dependencies. Vitest 5 installs cleanly.
Upgrade majors deliberately and record the change here.

## D-011 — One action at a time; a new request replaces the current one (2026-10-17)

Each player has at most one pending action (walking to it or doing it). A new
valid request cancels the old one with reason `replaced`; an invalid request
leaves the current action untouched. A multi-step action queue (as in
life-sim games) can be added later on top of the same lifecycle.

## D-012 — Seats are reserved when an action is accepted, and replicated (2026-10-17)

The seat is claimed when the request is accepted, not on arrival, so two
players can never walk to the same seat. Reservations live in replicated
`state.seats` so every client's menu shows only free seats. Released on
cancel, failure, standing up, or leaving.

## D-013 — Menu presentation follows the pointer type (2026-10-17)

Fine pointer (mouse) → radial menu anchored to the target; coarse pointer
(touch) → bottom sheet. This is a presentation choice made in `ui/`;
gameplay code never checks the device. `?menu=radial|sheet` forces either.

## D-014 — Per-room tuning overrides for tests (2026-10-17)

`createGameServer(tuning)` passes overrides (walking speed, timers, distance
limit, world layout) to the room. Production passes none and uses the shared
config. This keeps integration tests fast and lets them use purpose-built
worlds (e.g. an unreachable bench) without test-only branches in game code.

## D-015 — PostgreSQL in production, embedded PGlite for development and tests (2026-10-17, M4)

Driver: `pg` (node-postgres, MIT) when `DATABASE_URL` is set. Without it the
server uses PGlite (`@electric-sql/pglite`, Apache-2.0): PostgreSQL compiled
to WebAssembly, running inside the server process and storing data in
`.data/pglite` (or in memory with `PGLITE_DATA_DIR=memory://`). Both run the
same SQL and migrations behind one small interface (`server/src/db/database.ts`).

Why: nobody has to install or run a database server to develop or test,
including on Windows, while production uses a real PostgreSQL as approved in
D-004. Trade-offs: PGlite is single-connection and in-process, fine for one
developer, not for production. Database tests run on both backends when
`TEST_DATABASE_URL` is set (verified against PostgreSQL 16.15). An ORM was not
added; queries are short, parameterised SQL in one repository module.

## D-016 — Own minimal migration runner (2026-10-17, M4)

Numbered SQL files in `server/migrations` (`0001_name.sql`) with
`-- migrate:up` and `-- migrate:down` sections, applied in order, each in its
own transaction together with its `schema_migrations` row, serialised with a
PostgreSQL advisory lock. Commands: `npm run db:migrate | db:rollback | db:status`;
the server also migrates on start unless `DB_MIGRATE_ON_START=false`.
About 110 lines with no extra dependency. Limitation: statements are split on
line-ending semicolons, so a migration needing semicolons inside a string or
function body must go in its own file. Revisit if migrations grow complex.

## D-017 — Temporary guest identity only (2026-10-17, M4)

There is no sign-in yet. On first visit the server creates a **guest account**
and gives the browser a random 256-bit secret ("guest token", prefix `plsg1_`),
shown once. The server stores only its SHA-256 hash. The browser keeps the token
in `localStorage` and sends it in the matchmaking request body (never a URL);
the server resolves it to an account in `onAuth` before the player joins. A
client-supplied account or character id is never accepted as proof of anything.

This is a stand-in, not an account system, and the UI says so. Limitations:
whoever holds the token controls the character; clearing site data or using
another device or browser starts over; no recovery; a script running on the
page (XSS) could read the token; no account deletion yet. New guest accounts
are limited per IP address per hour (default 10, `GUEST_CREATIONS_PER_IP_PER_HOUR`),
in memory per server process. A real sign-in method needs the product owner's
decision (auth model, D-004 scope) before it is built.

## D-018 — One live session per account: the newest wins (2026-10-17, M4)

Opening the game in a second tab, window or device with the same guest token
moves the character there. The older session's position is saved, the
character is removed, and that connection is closed with code 4100; its page
explains "Playing in another window" with a "Play here instead" button. A
session waiting in its reconnection window is also cancelled, so it cannot come
back as a duplicate. A new session waits for the old session's final save
before loading, so it never loads an older position. Single process only: a
shared registry (Colyseus presence/Redis) is needed before running several
server processes.

## D-019 — Player characters are adults (2026-10-17, M4)

The profile stores an age category (`child`, `teen`, `adult`) so the data
model distinguishes adults from non-adults (needed later for NPCs and for
rules such as romance being adult-only). Player-created characters must be
`adult`; the server refuses anything else (`age_category_not_allowed`), and
the create form states that all player characters are university-age adults.
Product owner can revisit; changing it is a rules change in
`shared/src/profile.ts` (`PLAYER_AGE_CATEGORIES`), not a migration.

## D-020 — One character per account, for now (2026-10-17, M4)

**Superseded by D-031** (2026-10-19): a guest profile now holds up to three
characters; migration 0004 replaced the unique index. Kept for history.

Enforced by a unique index on `characters.account_id`. Several characters per
account later means dropping that index and adding a character picker; the
tables already separate account and character.

## D-021 — One server-kept world clock derived from real time (2026-10-18, M5)

Game time = 08:00 on Day 1 at 2026-10-01T00:00Z, advancing at 10 game minutes
per real minute (`GAME_TIME_SCALE`, default 10; one game day = 2 h 24 min).
Calculated from the server's real clock, so it needs no storage, survives
restarts and is identical in every room. The server replicates the current
game minute; clients only display it. Needs change per game hour on the
server's fixed-rate loop. Action durations stay in real seconds (they are
about what the player watches), with fixed effects per completed action.
Trade-offs: changing the scale moves the clock (fine in development, needs a
migration plan in a live world); a shared clock means no pausing, so needs are
tuned gently. Product owner can change the scale and rates; they are configuration.

## D-022 — Offline progression is capped and protective (2026-10-18, M5)

On entering the world, time since the last save is applied once, capped at
8 game hours: hunger, hygiene, social and fun fall at half rate and not below
35; energy recovers at the resting rate up to 90. Skills and money never change
offline; no allowance back pay. Chosen so absence never creates a crisis,
while the world still visibly moves on.

## D-023 — Money is an append-only ledger in whole cents, no debt (2026-10-18, M5)

`character_wallets.balance_cents` (database CHECK ≥ 0) plus
`wallet_transactions` (income/expense, amount, balance after, category, item,
game minute, request key). Every change runs in one database transaction that
locks the wallet row, checks the balance, writes the ledger row and updates
the balance. `UNIQUE (character_id, request_key)` makes repeated requests
harmless: the same purchase, allowance or refund is never applied twice.
Prices come only from the server's catalogue. No debt mechanic exists.

## D-024 — Life data is private to its owner (2026-10-18, M5)

Needs, mood, skills, traits and money are sent only to the character's owner
(`life` message), never through the shared room state. Others still see the
public activity (sitting, studying, eating…). Keeps traffic low and avoids
exposing personal stats; showing selected stats to friends can come with
relationships.

## D-025 — Food is consumed on purchase; refunds cover abandoned payments (2026-10-18, M5)

There is no inventory yet, so buying at the café pays (database transaction
on arrival at the counter) and then eats or drinks at the counter, with
effects applied gradually. If the player cancels or leaves while the payment
is still being processed, a refund transaction is recorded. An inventory
(carry food, eat later) can replace this without changing the ledger.

## D-026 — Standing interaction points reuse the seat machinery (2026-10-18, M5)

The café counter and fountain have reservable *standing* points. They use the
existing seat reservation (`Seat.pose = "stand"`) rather than a second system:
reserved while walking and acting, released when the action ends, never left
"occupied" like a seat. The field is still called `seats` in code and data to
avoid churn; ARCHITECTURE.md explains the naming.

## D-027 — Characters are procedural geometry until authored assets exist (2026-10-18, M6)

The repository has no character models, rigs or textures, and none may be
downloaded or generated without a source and licence (ASSET_PIPELINE.md).
Options considered: (a) wait for a VRM/glTF asset pipeline, which blocks the
character creator on art production that doesn't exist; (b) build characters
from parametric geometry in code; (c) (b) now, with the saved appearance
config designed so authored models can replace the renderer later. Chosen:
**(c)**. Every catalogue option produces real, distinct geometry (hair shells
that follow the head, braids and locs as strands, face shape by deforming the
head mesh, body proportions by segment lengths and widths). Limits: no
skeleton rig (procedural limb animation), no facial expressions, prototype-
grade art. This changes no technology: Three.js, the data model and the
networking stay; `client/src/render/avatar/` replaces `avatars.ts`.

## D-028 — The appearance is a versioned, validated JSON document (2026-10-18, M6)

Appearance grew from 6 ids to about 40 values (styles, colours, sliders).
It is stored as one `jsonb` column (`character_appearance.config`) holding a
config with an explicit schema version (`APPEARANCE_SCHEMA_VERSION`), and
validated by `shared/src/appearance/schema.ts`: strictly when a player
changes it (unknown ids, wrong types or out-of-range values are refused,
naming the field), leniently when it is loaded (bad values are replaced by
defaults and the player is told). A document fits because the appearance is
one concern that is read and written as a whole; adding an option needs no
migration. Gameplay state stays in its own tables (D-023 and DATA_MODEL.md).
The M4 columns are kept and, on every save, filled with the closest old
look (`legacyAppearanceProjection`), so rolling back migration 0003 leaves
every character loadable by the M5 server with a similar look.
It is replicated to other players as one compact string field (`look`), which
changes only when the player edits their look.

## D-029 — No ethnicity data; presets are named by look (2026-10-18, M6)

The game never stores, infers or displays a character's ethnicity or
heritage, and appearance has no effect on any gameplay rule (needs, skills,
money, interactions). Starting presets are optional conveniences, named after
what they look like ("Rounded afro", "Box braids & print dress", "Freckles &
copper curls"), never
after a population, and every value in a preset can be changed independently:
skin tone, face, hair, body and clothing combine without restriction.
Cultural fashion pieces (headwrap, headscarf, patterned prints) are ordinary
wardrobe items available to every character. Labels can be revised by the
product owner as data.

## D-030 — Characters use toon shading and one merged mesh per body part (2026-10-18, M6)

Anime-inspired look: characters use `MeshToonMaterial` with a soft cel ramp
(a light shadow tone and a short smooth step to the lit tone; a hard
three-step ramp was tried first and left blotchy bands on rounded faces);
the world kept its standard materials until the world art pass, which moved
it onto the same toon ramp (D-033). To keep draw calls low on phones,
each body part that moves on its own (head, torso, each arm, each thigh,
each shin) is one merged mesh with colours stored per vertex; blush and
stubble are painted into the skin's vertex colours, so they need no extra
mesh. Only patterned garments (a shared canvas texture per pattern and
colour) and seated-only skirt pieces add meshes. All characters share the
same materials. Changing anything rebuilds only the body parts whose inputs
changed (per-part signatures in `character.ts`).

## D-031 — Up to three characters per guest profile, chosen at a title screen (2026-10-19, title screen milestone)

The product owner asked for a title screen with New life, Continue and
Character management. A guest profile (the one guest account in a browser,
D-017) may now hold up to `PROFILE_CONFIG.maxCharactersPerAccount` = 3
characters ("lives"); each has its own appearance, traits, position, needs,
skills, mood events, wallet and ledger. Migration 0004 drops the
one-per-account index that M4 left for exactly this; the limit is enforced
in code inside the creating transaction (the account row is locked, so two
windows can't both slip under it). Setting the value to 1 restores the old
behaviour for new characters without touching existing ones. Rolling 0004
back fails safely (and deletes nothing) while any profile holds more than
one character.

Joining the room now puts a session in the **lobby** (the title screen): it
receives a `lobby` profile payload listing its characters (name, look,
traits, last played; never life data) and nobody enters the world until the
player sends `enterWorld` (one of their character ids, checked against the
session's account) or creates a character. The "newest session wins" rule
(D-018) now applies when a session **enters the world**, not when it only
opens the title screen. `leaveWorld` saves the character, takes it out of
the piazza and returns the session to the lobby. `deleteCharacter` works
only at the title screen, needs the character's name typed (compared
without case or extra spaces) and is refused while that character is being
played in any window; deleting cascades to every per-character table and
leaves the account, its token and its other characters. A look can be
changed from the title screen for a character that isn't being played.

Considered: separate browser-side guest tokens per character (no server
change, but every life would be its own account, making a later real
sign-in harder); an HTTP endpoint for the character list (a second
transport alongside Colyseus). Both rejected for the lobby state, which
reuses the anonymous "create a character" state that already existed.

## D-032 — Title screen visual identity, bundled OFL fonts (2026-10-19, title screen milestone)

The menus (title, new life, creator, character list, settings, credits)
get their own original identity, drawn from Padova rather than from other
games: a Giotto-blue night sky with gold eight-pointed stars (after the
city's starry fresco ceilings, not a copy of any painting) over an
evening row of lit porticoes with a bell tower, domes and a keel roof
(generic shapes, drawn in code in `client/src/ui/screens/backdrop.ts`);
"ribbon" buttons skewed like anime game menus; Spritz orange for the one
main action on each screen; cool plaster white panels with night-blue
headers; gold for selection and focus. The in-world HUD keeps its layout
and takes the same colour tokens. Two fonts are bundled through npm
(Fontsource packages, OFL 1.1, Latin subset only, served from the game
itself, so no request goes to Google): Dela Gothic One for the logo and
screen titles, M PLUS Rounded 1c for everything else. Names in other
scripts fall back to system fonts per glyph.

Interface motion follows the device's reduced-motion setting unless the
player chooses otherwise in Settings. Settings are stored per browser
(`padova.settings.v1`) because they describe the device: graphics
(automatic / performance / quality, applied on reload because the 3D view
is created at page load), camera turning speed, interface animation and
the controls reminder. No setting is shown for something the game can't do
yet (there is no audio, so no volume).

## D-033 — The first district: a fictional Padua-inspired square, built in code from a modular kit (2026-10-19, world art pass)

The greybox piazza becomes the first finished district: a fictional
university square inspired by Padua's historic centre, not a model of any
real place. Its buildings are a Renaissance university palazzo with a
walk-in porch, banners and a clock tower ("Palazzo degli Studi", a generic
name); a neoclassical library with a pediment and a dome; a row of narrow
houses with a bookshop and a pharmacy; porticoed houses whose ground floor
stands back behind a row of columns; student housing; and shops. In the
middle: the fountain, a market of three stalls, benches, two gardens,
lemon trees, plane trees, street lamps, a café kiosk with tables, a bike
rack and a notice board. Every street out of the square carries on between
façades and ends at a building; old-town roofs fill the ring around the
square; four distant landmarks (a brick bell tower, a long hall with a
keel-shaped roof, a basilica with domes, a domed church) give the skyline
Padua-like silhouettes. All names on signs are fictional. This answers
GAME_DESIGN's open question 2 for now; a district modelled on real
streets (with verified references) remains possible later.

How it is built:

- **Collision first.** `shared/src/world.ts` stays the only source of what
  blocks movement. The art (`client/src/render/world/`) is drawn inside
  those boxes: walls stand 0.15 m inside their box, so window frames and
  door surrounds can stand proud without leaving it. Below head height
  (2.2 m) nothing solid is drawn outside its box; above it, balconies,
  awnings, eaves, parasols and tree canopies may overhang. Every obstacle
  also gets an invisible box for taps and menu anchors, so what players
  see, tap and bump into agree. A Node test builds the whole district and
  checks this vertex by vertex (`client/test/world.test.ts`), and also
  that every box is visibly filled (no invisible walls).
- **Procedural Stage-1 art, like the characters (D-027).** No models,
  textures or images were downloaded or licensed; everything is generated
  in code from a small kit (walls, windows, doors, arches, roofs, foliage,
  inlays) in one palette (`render/world/palette.ts`). Paving and signs are
  drawn once on small canvases at runtime. Not artist-made production
  assets; authored glTF assets can replace pieces later (ASSET_PIPELINE.md).
- **Cheap to draw.** Pieces are merged into a few meshes: one per building
  (plus its signs), four for the static props (one per quarter, so each
  can be culled), one per clickable object (so it can glow when selected),
  one per tree canopy (so it can fade). One shared toon material (the
  characters' ramp, D-030) with vertex colours; clickable and fadeable
  meshes get their own copy of it. Phones (the "low" quality profile) get
  a lighter build: no shadows, fewer window details, simpler cobbles and
  foliage.
- **Built after the title screen appears.** The district takes about
  0.3–0.7 s to build on this machine, so it is built just after the title
  screen is shown; entering the world waits for it.
- **What hides you fades.** A building (or tree canopy) between the camera
  and your character turns see-through, and so does a building the camera
  has strayed into. This replaces the "camera occlusion" gap in
  ARCHITECTURE.md and is what makes the walkable portico usable.
- **Interaction metadata stays explicit.** Each interactable has a stable
  id, a kind (which decides its actions), a menu label and its interaction
  points. New furniture reuses existing kinds rather than new rules: more
  benches are benches, café tables use the desk rules (sit, or study over a
  coffee). Chairs are separate collision boxes marked `partOf` their table,
  so tapping a chair selects the table.

Considered: downloading free low-poly model packs (licences vary, styles
would clash, and the brief forbids unlicensed assets); authoring glTF files
offline (needs an artist and a pipeline we don't have yet); a navmesh
instead of the grid (not needed: the layout is still boxes, D-005).

## D-034 — Layout changes in the world art pass (2026-10-19)

Kept as they were: every interactable object (benches 1–2, both study
desks, the café counter, the fountain) with its id, position and seats;
the market stalls; the planters; the spawn points; the 48 × 48 m walkable
square; the portico column positions (arcade-1 to arcade-5). Changed on
purpose:

- **University hall entrance:** the north-west block is split into three
  boxes around a walk-in porch 3 m wide and 1.6 m deep (ids
  `north-west-block`, `north-west-block-porch`, `north-west-block-east`).
- **Walkable portico:** the east block's ground floor moves back from
  x = 18 to x = 19.5 and the block now spans z −12.3 to 12.3, with two more
  columns (`arcade-0`, `arcade-6`); the 2 m walkway behind the columns is
  walkable end to end, under the upper floors.
- **No dead-end slivers:** the four corner blocks extend 1 m to the edge
  of the square (they stopped 1 m short, leaving useless strips).
- **Visible edges:** every street opening is closed by planters where the
  walkable area ends (ids `*-street-planter-n`), instead of an invisible
  line.
- **New solid props, each with collision and a stable id:** seven plane
  trees, seven street lamps, two gardens, three café tables with two
  chairs each, a chair at each study desk, three more benches, a bike rack
  and a notice board.
- **New interactables:** `bench-3`, `bench-4`, `bench-5` (benches) and
  `cafe-table-1` to `cafe-table-3` (desk rules, label "Café table").
- Obstacles gained two optional fields: `facing` (which side people use;
  rendering only) and `partOf` (tapping this part selects that
  interactable). Heights of a few obstacles grew to cover their new art
  (fountain 2.6 m, benches 0.85 m, café kiosk 2.7 m with its canopy);
  heights affect tap targets and menu anchors only, never collision.

A character saved in a spot that a new prop now covers is placed at a
spawn point when it next enters (the existing check in `PlazaRoom.spawn`).
A shared test now checks that no walkable pocket is cut off, the porch and
portico are reachable, every street is closed and no two boxes overlap
(`shared/test/world.test.ts`).

## D-035 — The product owner's answers for the next phase (2026-10-20)

Answers to the questions in ROADMAP.md "Decisions for the product owner",
given on 2026-10-20:

- **Q1 approved, milestone order:** M7 first job → M7b day and night (see
  Q12) → M8 university basics → M9 relationships and safety → M10 a place
  to live → M11 NPCs. M12 (sign-in, deployment) comes as soon as people
  outside the project should play, and before any public test.
- **Q2 approved, arrival view:** buildings fade while the camera is very
  close to them (within 3.5 m), not only when they hide your character, so
  the first view on a computer is no longer a wall; and a faded building
  lets taps through to what is visible behind it. Implemented in
  `client/src/render/worldScene.ts` (the arrival points stay where they were).
- **Q3, three lives per guest profile:** kept "for now" (D-031).
- **Q5 approved:** the real sign-in method is decided before M9 (blocking
  and reporting need lasting identities) and before any public test; options
  will be presented then.
- **Q6, authored character models:** the owner likes the idea and asked for
  a plainer explanation of the options when M8 starts. Until then the
  procedural characters stay (D-027).
- **Q7 approved:** a comfort need arrives in M10, with furniture of
  different comfort.
- **Q8 approved:** the daily allowance halves (€15 → €7.50 per game day)
  when jobs arrive in M7.
- **Q9 approved:** rent that can't be paid gives a notice and a mood event,
  then a move to a cheaper room; still no debt (D-023).
- **Q10 approved:** a written comparison of ways to build interiors comes
  before M10 (or before M8 if lectures move indoors).
- **Q11 approved:** later districts stay fictional composites until verified
  references for real streets are collected (D-033).
- **Q12 approved ("definitely"):** day and night lighting is built right
  after M7, as M7b.
- **Q4 not answered:** the time scale and offline cap stay as implemented
  (D-021, D-022) until play-tests suggest a change.
- **Q13 deferred:** who reviews reports and how long they are kept is raised
  again, explained more simply, before M9.

## D-036 — First job: implementation choices (2026-10-26)

M7 was built as designed in GAME_DESIGN.md "Work (M7)", with these choices
made while building it. Each is a default the product owner can change.

- **Unavailable shifts are shown, greyed out, with the reason** ("Opens at
  06:00", "4 of 4 shifts done today", "Too tired") instead of being hidden,
  like café items you can't afford. Hiding the option would leave players
  guessing why it vanished. D-032's rule (no option without a working
  effect) still holds: the option works whenever the reason clears, and
  the server refuses with the same reasons if asked anyway. When both
  staff spots are taken the option is not shown ("Someone else is using
  that" if requested).
- **Grade and wage are fixed when a shift starts.** Reaching communication
  level 2 during a shift pays the barista wage from the next shift.
- **The daily limit counts the game day the shift started**, so a shift
  started just before midnight counts for that day.
- **Hiring works at any hour;** only shifts need the café to be open. A
  shift started before 23:00 may finish after it.
- **A finished shift counts only once its wage is stored.** The wage and the
  shift record are written in one database transaction; if that fails the
  player is told (`wage_failed`) and the shift does not count.
- **`GAME_CLOCK_OFFSET_MINUTES`** (default 0) shifts the server clock by
  whole game minutes, for development and tests, so opening hours can be
  tried at any real time. The browser tests start at 09:00 game time with
  it. It is not a per-player clock: everyone in a server shares one clock
  (D-021).

## D-037 — Day and night: how it is drawn (2026-10-26)

M7b, approved in D-035 (Q12). Choices made while building it; each is a
default the product owner can change.

- **The light is a client-side, pure function of the server's game minute**
  (`client/src/render/world/daylight.ts`), not a shared rule: it is
  presentation only and no gameplay code may read it (a source test guards
  this). Everyone sees the same time of day because the minute comes from
  the server (D-021); no new messages or data.
- **Times (no seasons):** dawn 05:15, sunrise 06:15, full day 07:30–18:30,
  sunset 19:45, dusk until 21:30, night until dawn. The sun crosses from east
  through south to west and never lights from lower than 14°; at night one
  cool moonlight comes from the south-east. 16:00 keeps the world art pass's
  original afternoon exactly.
- **Night stays readable on purpose (a stylised night, not a dark one):** the
  ambient light keeps at least 55 % of midday's, and characters add a little
  of their own colour as light (up to 20 %) so they keep their contrast with
  the ground. Name tags, menus and highlights are not affected by light.
- **Night glow without lights:** windows, lanterns and shop windows glow
  through a shader uniform on the existing materials (a per-vertex glow
  strength), about 40 % of windows, chosen by position so they are the same
  every night; pools of lamplight are additive discs on the ground. No point
  lights, so phones do no extra lighting or shadow work. Cost at night: 2
  draw calls and about 1 400 triangles at either detail level; by day
  nothing changes.
- **Joining at night shows night at once:** the light is applied in the frame
  update before the first render after entering.

## D-038 — The product owner's answers before M8 (2026-10-26)

- **Q4, time scale and offline cap: keep the current clock** (10 game
  minutes per real minute, D-021; offline catch-up capped at 8 game hours,
  D-022). M8's timetables are set in game time on this clock.
- **Q10, lectures: in an indoor room.** And a direction for the whole game:
  **every building, now and later, has at least one indoor room**, including
  workplaces and homes. How interiors are built is compared in
  ARCHITECTURE.md "Proposed: indoor rooms"; the recommended approach and the
  milestone order wait for approval (ROADMAP Q14).

## D-039 — Indoor rooms: areas in the one server room (2026-10-26)

The product owner approved option C of the comparison (Q14) and decided
that each building gets its rooms when it has a use, one room per use.
Built in M7c (ARCHITECTURE.md "Indoor rooms"):

- **Areas, not rooms per server:** the square and each indoor room are
  areas inside the one Colyseus room; a door moves a character between
  them; each client receives only the players in its own area (`StateView`).
  Splitting areas or districts across server rooms later is a known step
  if player numbers need it.
- **Rooms may be bigger inside than their building's shell** (common in
  games); a room is a layout of its own, not modelled inside the façade.
- **First rooms:** the hall's lecture room (rows of two-seat desks, a
  lectern, a blackboard; lectures come with M8) and the library's reading
  room (shelves, two reading tables). Both reuse study and sit.
- **Doors on the square** are thin portals in front of the hall's porch and
  the library's entrance (the doors' art moved into them, so they can be
  tapped and highlighted); the menu says "Go in" and, inside, "Go out to the
  square". You arrive in front of the linked door, facing away from it.
- **Indoors, the walls and the door on the camera's side are cut away**
  (they fade while the camera is outside the room on their side); the door
  stays tappable. Rooms have a fixed warm indoor light; the time of day
  doesn't reach inside (no windows in rooms yet).
- **The room is saved:** you come back where you left; an area that no
  longer exists sends you to the square's spawn points.
- **At the title screen a client receives no players at all.**

## D-040 — University basics: implementation choices (2026-10-27)

M8 was built as planned in ROADMAP.md "M8 — University basics" and
described in GAME_DESIGN.md "University (M8)", on the kept clock (D-038)
and in the lecture room (D-039). Choices made while building it; each is a
default the product owner can change.

- **One fictional course, as data.** *Introduction to City Studies* lives
  in `COURSES` (`shared/src/life/config.ts`): where to enrol, its room, its
  timetable and its grading. No real course names; nothing implies a link
  with any real university.
- **Enrol outside, study inside.** Enrolment is at the square's existing
  *University notice board* beside the hall's door, so new players find it
  without knowing the room exists; lectures and the exam are at the lecture
  room's desks (tagged `lecture` in the layout).
- **Day 1 is a Monday.** The weekday is derived from the game day, not
  stored; the clock chip and the panel show it.
- **A timetable built for the real-time clock.** A game week lasts 16.8 real
  hours, so a lecture once a week would be missed by most players. Lectures
  run on the hour on weekdays (09:00–12:00 and 14:00–17:00, 50 minutes,
  joinable for the first 20), attending takes 2 real minutes, and exam
  sittings are on Wednesdays and Saturdays from 09:00 to 19:00 (one real
  hour each), the exam itself 3 real minutes.
- **Lectures and exams count only when completed and recorded**, like
  shifts: the timetable is checked when asked and again on reaching the
  desk; the record is idempotent by its timetable key (a lecture's game day
  and start, a sitting's game day). Leaving early never counts and can be
  retried while the lecture or sitting is open.
- **The grade is deterministic and computed on the server** inside the
  transaction that records the exam, from the stored attendance and study
  count and the academic level the server holds: 45 % attendance (full at 8
  lectures), 35 % study (full at 6 sessions), 20 % academic level (full at
  level 4), mapped to 12–31 on the Italian scale (31 shown as 30 cum laude,
  18 passes). Being deterministic lets the panel show what sitting now would
  give.
- **Failing is gentle:** one attempt per sitting, the grade and a mood event
  (*Failed an exam*, −8), the course stays open with all progress kept, and
  the exam can be retaken at the next sitting. No fees and no retake limit.
  Passing closes the course; there is no refusing a passing grade yet.
- **Study counts for the course while enrolled,** at any desk or table,
  written straight away like attendance.
- **Private, like money.** Enrolment, attendance, study count and grades go
  only to their owner in `life`; others see only the activity (`attending`,
  `exam`). `life` also carries the server's `timeScale`, so menus can give
  waits in real time ("in about 25 min").
- **Browser tests start on a Wednesday at 09:00** (the nearest one), so a
  lecture and an exam sitting are both available whenever the suite runs.
- **Not built in M8:** withdrawing from a course, several courses or years,
  graduation, assignments, a lecturer character (NPCs are M11).

## D-041 — The product owner's answer on character models (2026-10-27)

- **Q6, authored character models: option A, keep the procedural
  characters for now.** After the plain explanation in the M8 report (A:
  keep the code-built characters and improve them bit by bit; B: license a
  ready-made character kit; C: commission an original set; glTF or VRM only
  for B or C), the owner chose **A**. The characters stay as built in code
  (D-027), with improvements made in small steps alongside the milestones;
  no art is bought or commissioned and no new format or library is added.
- **Asked again before the first public test (M12).** The authored-avatar
  loading design in ASSET_PIPELINE.md stays **Proposed** and unbuilt until
  then.
