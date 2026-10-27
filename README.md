# Padova Life SIM

A browser-based 3D multiplayer life simulation set in a stylised Padua, Italy.
Inspired by the depth of life-simulation games; original code, art and design.

> Fan-made project. Not affiliated with, or endorsed by, the University of Padua.

## Current status: walking skeleton, interactions, saved characters, life simulation, characters, title screen, first district, first job, day and night, indoor rooms, university basics, relationships and safety, a place to live (M0–M10)

What exists today is an early, end-to-end slice: one district with two
indoor rooms, the first life-simulation loop, character creation, a first
job, one university course, friendships with blocking and reporting, and a
rented room of your own. It proves the
architecture; it is **not** the full game yet. Planned work and its order are
in `docs/ROADMAP.md`.

| Feature | Status |
| --- | --- |
| The first district: a fictional, Padua-inspired university square (university hall with a walk-in porch and clock tower, library, portico you can walk through, market, café, gardens, trees, lamps; streets and skyline beyond) | Locally functional, tested; **Stage-1 procedural art, not artist-made models** (D-033) |
| What you see matches what you bump into (art drawn inside the collision boxes, checked by a test) | Tested |
| Buildings and trees that hide your character fade out, and so do buildings right beside the camera (taps pass through faded buildings) | Locally functional, tested |
| Third-person camera (drag to orbit, wheel/pinch to zoom) | Locally functional |
| Click/tap-to-move with server pathfinding | Multiplayer functional, tested |
| Keyboard (WASD/arrows) and on-screen joystick movement | Multiplayer functional, tested |
| Server-authoritative movement and validation | Multiplayer functional, tested |
| Join / leave / brief-disconnect reconnection | Multiplayer functional, tested |
| Click/tap objects and players for contextual actions (desktop radial menu, mobile bottom sheet) | Multiplayer functional, tested |
| Bench: sit / sketch / stand · Study desk and café table: sit / study · Café counter: buy food, ask about work, work a shift · Fountain: wash up · University notice board: enrol · Lecture desk: attend the lecture, sit the exam · Other player: greet, chat, profile, block, report | Multiplayer functional, tested |
| Action progress, cancel, and explanations when refused | Multiplayer functional, tested |
| Saved character profile (name, adult age category, appearance, position) in PostgreSQL | Persistence verified (tested on embedded PGlite and PostgreSQL 16) |
| Temporary guest identity (one browser = one guest profile with up to 3 characters; no sign-in) | Multiplayer functional, tested; temporary by design (D-017, D-031) |
| Title screen: New life, Continue, Manage characters (play, edit look, delete), Settings, Credits; entering and leaving transitions; back to the title from the character panel | Multiplayer functional, persistence verified (tested on PGlite and PostgreSQL 16; desktop and phone emulation) |
| New life in three steps (name and personality → look → review and confirm) | Multiplayer functional, tested |
| Character creator with live 3D preview in six categories (Appearance, Face, Hair, Body, Clothing, Accessories): starting looks, continuous skin tone, 17 hair styles in every texture, face and body sliders, outfits, headwear, glasses; drag/touch to turn, wheel/pinch to zoom; randomise, reset, undo, compare, look codes | Locally functional, tested (desktop and phone emulation, portrait and landscape) |
| Editing a look later (in the world or from the title screen) with a review step; never changes needs, money or skills | Multiplayer functional, persistence verified |
| Device settings: graphics, camera speed, interface animation, controls reminder | Locally functional, tested |
| Procedural anime-inspired characters (every option is real geometry), walk / sit / wave poses | Multiplayer functional, persistence verified; **Stage-1 procedural art, not final artist-made models** (D-027) |
| Needs (hunger, energy, hygiene, social, fun, comfort), mood with reasons, five skills, personality traits | Multiplayer functional, persistence verified (tested on PGlite and PostgreSQL 16) |
| Money: balance, server-validated purchases, allowances and wages, transaction history, no debt | Multiplayer functional, persistence verified |
| First job at the café kiosk: ask about work, 90-second shifts behind the counter (two staff spots), wage paid once per completed shift, two grades by communication level, opening hours 06:00–23:00 game time, 4 shifts per game day, quit from the character panel | Multiplayer functional, persistence verified (tested on PGlite and PostgreSQL 16; desktop and phone emulation); numbers not yet play-tested |
| Shared world clock (10 game minutes per real minute) and capped offline progression | Multiplayer functional, tested |
| Indoor rooms: the university hall's lecture room and the library's reading room, through their doors; you see only the players in the same room; you come back inside after a reload | Multiplayer functional, persistence verified on PGlite (tested on desktop and phone emulation); **Stage-1 procedural art** (D-039) |
| University basics: one fictional course (enrol at the notice board beside the hall), lectures on the hour on weekdays in the lecture room (2 real minutes each, counted once), exam sittings on Wednesdays and Saturdays with a grade computed on the server from attendance, study and Academic level (18–30, 30 cum laude), fail and retake; the weekday in the clock chip; the University section of the character panel | Multiplayer functional, persistence verified (tested on PGlite and PostgreSQL 16; desktop and phone emulation); numbers not yet play-tested (D-040) |
| Relationships: a 10-second *Chat* action; friendships (Acquaintance to Close friend) grown from greetings, chats, studying at the same table and attending the same lecture, with daily caps; another player's card (portrait, activity, your relationship and recent moments; never their needs, money or skills); a private story log (job, first shift, enrolment, exams, new friends) | Multiplayer functional, persistence verified (tested on PGlite and PostgreSQL 16; desktop and phone emulation); numbers not yet play-tested (D-043) |
| Safety: block a player's account (both ways, they aren't told; unblock in the character panel); report with a reason and a note (also blocks; one a day per player, five an hour); reports deleted after 90 days and read by the owner with `npm run reports` | Multiplayer functional, persistence verified; warnings, mutes, bans and an admin page come with sign-in (M12, D-042) |
| Day and night: sun and moon, sky, haze, stars, lit windows, lanterns and pools of lamplight follow the shared game clock; every player sees the same time of day; characters stay easy to see at night | Multiplayer functional, tested (world lab at chosen times, the game at night on desktop and phone emulation); **Stage-1 procedural art** (D-037) |
| Character panel (your needs, mood, skills, work, university, home, money, story, blocked players, current action) and top-right weekday/time/money chip | Locally functional, tested (desktop and phone emulation) |
| A place to live: rent a private room in the student housing (box room, single room or studio; first week paid at once, then rent every Monday through the ledger; if it can't be paid, a notice, 12 game hours of grace, then a move to a cheaper room or out, never debt); others see you leave the square; sleep in your bed (energy, comfort); furnish fixed spots from a small catalogue (bought once per request, drawn at once, sit on your seats), storage, cosiness; change room or move out; you come back home after a reload | Multiplayer functional, persistence verified (PGlite and PostgreSQL 16); balance not play-tested |
| Cooking, showers and bills, shared flats, free furniture placement, inventory for other items, more jobs, more courses and graduation, NPCs | Not started (see docs/ROADMAP.md) |

"Tested" means covered by the automated tests in `docs/TESTING.md`. Mobile is
tested in Chromium mobile emulation only; a real phone has not been tested yet.
All automated runs so far were on Linux. The product owner has run the game
on Windows (a character joined the piazza after M5); a full report of the
play loop on Windows is still open.
Open items and the next task are listed in `docs/ROADMAP.md` ("Current state").

## Prerequisites

- Node.js 22 or newer (`node -v`)
- npm 10 or newer (comes with Node)
- Git (`git --version`). On Windows: `winget install --id Git.Git -e --source winget`, then open a new terminal.

No database server or Docker is needed for development: the game server
uses an embedded PostgreSQL (PGlite) and stores data in `.data/pglite`.
A real PostgreSQL server is optional (see "Your saved data").

## Getting started

The repository is private: <https://github.com/CIR-T34P0T/padova-life-sim>

```bash
git clone https://github.com/CIR-T34P0T/padova-life-sim.git
cd padova-life-sim
npm install
npm run dev
```

### Updating to the latest version

Stop the game (Ctrl+C), then in the project folder:

```bash
git pull
npm ci
```

`npm ci` installs exactly the versions in `package-lock.json` and never edits
it. (`npm install` can rewrite the lockfile, for example with a different npm
version, and the next `git pull` then stops with "Your local changes to
package-lock.json would be overwritten". Fix that with
`git restore package-lock.json`, then pull again.)

### Windows notes

- Use a normal (not Administrator) PowerShell or Command Prompt, and clone into
  your user folder (for example `cd $HOME\Documents`), not `C:\Windows\system32`.
- If PowerShell says "running scripts is disabled", use Command Prompt, or run
  `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` once.
- When Windows Firewall asks about Node.js, allow it on private networks
  (needed for phones on the same Wi-Fi).
- If `npm run dev` fails, start the two parts in separate terminals:
  `npm run dev -w server` and `npm run dev -w client`, and report the error
  (the combined script has not been tested on Windows yet).

Then open <http://localhost:5173>, create a character, and play. To see two
players, open a **private/InPrivate window** or another browser: tabs in the
same browser share one guest identity, so a second tab takes over the first
character instead of adding a player.

The client runs on port 5173 and the game server on port 2567.

### How to play

- **Walk:** click/tap the ground, or use WASD/arrow keys (desktop) or the joystick (touch).
- **Interact:** click/tap a bench, a study desk (in front of the university hall,
  north-west), the café kiosk or one of its tables (east of where you arrive),
  the fountain or another player, then pick an action from the menu.
- **Your character:** click/tap yourself → **Character**, or the time/money
  chip at the top right. The panel shows your needs, mood (and why), skills,
  money with recent purchases, and what you're doing.
- **Look after yourself:** buy an espresso, cornetto or panino at the café
  (hunger, energy), wash up at the fountain (hygiene), greet people (social),
  sketch on a bench (fun, creativity), study at a desk (academic skill; not
  when you're exhausted). Needs drop slowly over time and nothing bad happens
  quickly: low needs make your mood worse, which slows learning.
- **Money:** you start with €100 and get €7.50 each game day you play, plus
  wages from the café. You can't spend more than you have.
- **Work:** click/tap the café counter → **Ask about work** to get a job,
  then **Work a shift**: your character goes behind the counter and works
  for 90 seconds (you can cancel, but only a finished shift is paid: €6, or
  €8 once your communication skill reaches level 2). The café is open
  06:00–23:00 game time and takes up to 4 shifts a game day; you can't work
  when you're exhausted. Your job, wage and shifts today are in the
  character panel's **Work** section, with **Quit job**.
- **Stand up:** click/tap yourself while seated, or just walk away.
- **Cancel:** the Cancel button on the action bar, or Escape.
- **Camera:** drag to turn; mouse wheel or pinch to zoom.
- **Indoors:** tap the university hall's door (in its porch, north-west) or
  the library's door (north-east) → **Go in**. Inside you can study or sit
  at the desks; you only see the people in the same room. Tap the room's
  door → **Go out to the square**.
- **Time of day:** the clock chip shows game time (a game day lasts 2 h 24 min
  of real time). Dawn, day, dusk and night follow it for everyone: at night
  the lamps and many windows light up. It's only the look: nothing in the
  game depends on how dark it is.
- **Change your look:** click/tap yourself (while standing) → **Edit look**,
  or **Edit look** in the character panel. Drag or swipe the preview to turn
  it, scroll or pinch to zoom; *Hold for saved look* compares. **Review**
  shows what will change; **Save look** saves it.
- **Back to the title screen:** **Back to title** in the character panel
  saves your character and takes it out of the piazza.

### Title screen

- **New life:** name and personality → look (live 3D creator) → review →
  **Begin life in Padova**. Going back keeps your choices; nothing is saved
  until that last button.
- **Continue:** plays your most recently played character.
- **Manage characters:** up to 3 lives per browser, each with its own needs,
  money and skills. *Play*, *Edit look*, or *Delete* (type the name to
  confirm; it can't be undone).
- **Settings** (this device only): graphics (applies after a reload), camera
  turning speed, interface animation, controls reminder.

### Character lab and world lab (developer pages)

With `npm run dev` running, open <http://localhost:5173/lab.html> to see every
preset and option side by side with its triangle count and build time
(`?grid`, `?grid&view=face`, `?options=hair|outfit|skin|face|pose`,
`?random`).

<http://localhost:5173/world-lab.html> shows the district without a server:
drag to orbit, wheel to zoom, links for each viewpoint
(`?view=overview|game|hall|porch|library|portico|cafe|market|fountain|street|south|skyline`),
`?collision` to see every collision box, `?quality=low` for phone detail,
`?people` for a few characters for scale, `?area=hall/lecture-room` (or
`library/reading-room`) for a room, and `?area=home&room=box-room|single-room|studio&furnished=0..3`
for a rented room, empty or furnished. Neither page is linked from the game.

### Your saved data

- Your character (name, look, personality, last position, needs, skills,
  mood events, money and transactions, job, course, relationships, story,
  home and furniture) is saved on the **server**, in
  `.data/pglite` by default. It survives page reloads and server restarts.
  While you're away, needs change slowly for at most 8 game hours.
- Your **browser** keeps only a temporary guest key. Clearing the site's data,
  using another browser or device, or deleting `.data/` starts over. There is
  no sign-in, recovery or account deletion yet (docs/DECISIONS.md D-017);
  sign-in with Google and with email and password is planned for M12 (D-042).
- To reset the development database: stop the server and delete the `.data`
  folder.
- To use a real PostgreSQL server instead, set `DATABASE_URL`, for example
  `postgresql://user:password@localhost:5432/padova`. Migrations run when the
  server starts, or manually with `npm run db:migrate`.

### Playing from a phone on the same Wi-Fi

1. Run `npm run dev` on your computer.
2. Find your computer's local IP address (Windows: `ipconfig`, look for "IPv4 Address").
3. On the phone, open `http://<that-ip>:5173`.
4. If it can't connect, allow Node.js through the computer's firewall for private networks.

Landscape gives the best view; portrait works.

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Starts server and client together (Ctrl+C stops both) |
| `npm run typecheck` | Type-checks all three packages |
| `npm test` | Unit and server integration tests (Vitest) |
| `npm run check` | Typecheck + tests |
| `npm run test:e2e` | Browser tests with three simultaneous players (Playwright) |
| `npm run build` | Production build of the client into `client/dist` |
| `npm start` | Runs the game server without file watching |
| `npm run db:migrate` | Applies pending database migrations |
| `npm run db:status` | Lists applied and pending migrations |
| `npm run db:rollback` | Reverts the latest migration (`-- 2` for two). **Deletes the data in the tables it drops** |
| `npm run reports` | Lists recent player reports (newest first) and deletes those older than 90 days. With the embedded development database, stop the game first |
| `npm run clock -- wed 10:00` | Prints the `GAME_CLOCK_OFFSET_MINUTES` value (and the PowerShell line) that starts the game clock at that weekday and time, to try lectures or exams at any real time |

First-time Playwright setup: `npx playwright install chromium`.

## Configuration

| Variable | Where | Default | Purpose |
| --- | --- | --- | --- |
| `PORT` | server | `2567` | WebSocket server port |
| `LOG_LEVEL` | server | `info` | `debug`, `info`, `warn`, `error`, `silent` |
| `CLIENT_PORT` | client | `5173` | Vite dev server port |
| `VITE_SERVER_URL` | client | `ws://<page host>:2567` | Game server address |
| `DATABASE_URL` | server | unset | Real PostgreSQL connection URL. Unset = embedded PGlite. Keep it secret; it never reaches the browser |
| `PGLITE_DATA_DIR` | server | `.data/pglite` | Where embedded PGlite stores data; `memory://` = nothing saved |
| `DB_MIGRATE_ON_START` | server | `true` | Set `false` to apply migrations only with `npm run db:migrate` |
| `GUEST_CREATIONS_PER_IP_PER_HOUR` | server | `10` | New guest characters allowed per IP address per hour (abuse limit) |
| `GAME_TIME_SCALE` | server | `10` | Game minutes per real minute (1–1440). Changing it moves the world clock; for development and testing (D-021) |
| `GAME_CLOCK_OFFSET_MINUTES` | server | `0` | Shifts the world clock by whole game minutes (up to a week either way), e.g. to try the café's opening hours, the night, a lecture or an exam at any real time; `npm run clock -- wed 10:00` prints the value for a weekday and time; for development and testing (D-036) |
| `CHROMIUM_PATH` | e2e | Playwright's browser | Use an existing Chromium for tests |
| `TEST_DATABASE_URL` | tests | unset | Also run database tests on a real PostgreSQL (creates and drops throwaway databases) |
| `E2E_DATABASE_URL` | e2e | unset | Run the browser tests' server on a real PostgreSQL instead of in-memory |
| `E2E_CLOCK_OFFSET_MINUTES` | e2e | starts at 09:00 game time | Overrides the browser tests' clock offset (e.g. to try the closed café) |
| `E2E_QUALITY` | e2e | `low` | World detail for test browsers (`high` needs a real GPU to be quick; see TESTING.md) |
| `VITE_DEFAULT_QUALITY` | client build | unset | Replaces the phone/computer guess for the "Automatic" graphics setting (`low` or `high`); the browser tests use it, players don't need it |

See `.env.example`. The only secret is `DATABASE_URL`, when used.

## Repository layout

```
shared/   Game rules used by both sides: world layout, collision, pathfinding, message validation,
          life/ (clock, needs, mood, skills, traits, economy and all their tuning),
          appearance/ (character options, validation, skin colours, presets)
server/   Authoritative Colyseus game server; db/ (database + migrations runner),
          identity/ (guest tokens), profiles/ (character profiles),
          life/ (needs, skills, money, clock), migrations/ (SQL)
client/   Three.js browser client (rendering, input, networking); render/avatar/ builds
          the characters, render/world/ the district, ui/creator.ts is the character creator,
          lab.html the character lab, world-lab.html the world lab
e2e/      Playwright multi-browser tests
docs/     Design, architecture, roadmap, decisions, testing
```

## Documentation

- [Game design](docs/GAME_DESIGN.md)
- [Architecture](docs/ARCHITECTURE.md) and [decisions](docs/DECISIONS.md)
- [Networking](docs/NETWORKING.md) and [data model](docs/DATA_MODEL.md)
- [Roadmap](docs/ROADMAP.md)
- [Testing](docs/TESTING.md)
- [Asset pipeline](docs/ASSET_PIPELINE.md)
- [Engineering conventions for AI assistants](CLAUDE.md)
