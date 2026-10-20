# Game design

Summary of the product owner's vision (full brief in the claude.ai Project).
This file records design intent. Sections say whether they describe what is
**implemented** (with the milestone that built it) or what is **proposed**
(designed, not built, and open to the product owner's changes). The README
holds the feature status table.

## Pitch

A persistent multiplayer life simulation centred on student and everyday life
in a stylised Padua. Players create a character, move to the city, study,
work, make friends and choose their own path. No single storyline.

**Guiding principle:** the world provides the possibilities; the players create the stories.

## Pillars

1. **Life simulation** — needs, moods, skills, routines, goals, possessions and history that shape choices.
2. **University life** — enrolment, timetables, lectures, studying, exams, grades, graduation. Fictionalised courses unless real data is deliberately used. No implied official affiliation.
3. **Work and money** — student jobs and careers, shifts, wages, rent and expenses. Money matters without being punishing.
4. **Relationships** — friendships, adult romance, rivalry, reputation and groups that grow from shared experiences, not just a meter. Privacy, blocking and reporting from the start of social features.
5. **Character customisation** — anime-inspired 3D male and female characters, wide range of skin tones, modular hair, clothing and accessories.
   *Since M4:* a saved profile with name and age category. Player characters
   are university-age adults (D-019); non-adult categories exist in the data
   model for future NPCs. *Since M6:* the character creator and procedural
   anime-inspired characters described in "Characters" below.
6. **Housing** — dorms, shared flats, roommates, furnishing with a controlled catalogue first.
7. **Emergent stories** — meaningful events are recorded and influence the future.

## Characters (M6)

Goal: every player can make a character that looks like them or like who
they want to be, from a wide range of skin tones, hair textures, faces and
bodies, without any option being tied to ethnicity.

**What can be chosen** (full list: `shared/src/appearance/catalogue.ts`):
- *Body:* feminine or masculine frame (proportions only), six builds (slim,
  average, athletic, curvy, broad, soft), sliders for height (156–188 cm),
  shoulders, torso, legs and arms.
- *Skin:* a continuous tone slider from very fair to deep brown with nine
  named points, cool / neutral / warm undertone, freckles, beauty marks, blush.
- *Face:* six face shapes, six eye shapes (round, almond, hooded, monolid,
  upturned, downturned), eight eye colours, five brow shapes, five noses,
  four lip shapes, and sliders for cheekbones, jaw, chin, forehead, eye size
  and spacing, brow height, nose width and length, lip fullness. Slider
  ranges are clamped so faces never break.
- *Hair:* 17 styles across straight, wavy, curly, coily and tightly coiled
  textures, including a rounded afro, afro puffs, twists, locs, box braids,
  cornrows, fades and crops, buzz cut, bob, ponytail, bun, long straight
  and long curls; four hairlines; facial hair (stubble, moustache, goatee,
  short and full beard) for every frame; 10 natural and 6 fantasy colours.
- *Outfit:* five tops, five bottoms, three full outfits, five patterns,
  four outerwear pieces, four kinds of shoes, glasses, and headwear
  (headband, hair clips, beanie, cap, headwrap, headscarf), with 18 colours.

**Rules.** Appearance never affects gameplay (needs, skills, money,
interactions); a test guards this. The game never infers, assigns or shows
ethnicity, and has no ethnicity field (D-029). Presets are optional starting
points named by their look ("Box braids & print dress"), mix every skin
tone, texture, frame and build, and are never required. Cultural pieces
(headwraps, headscarves, bold prints) are available to every character.
When one choice covers another (a headscarf over hair, a full outfit over a
top), the covered choice is kept and the creator says it is not visible,
so a menu never claims a change the character doesn't show.

**Look.** Stylised and warm: large expressive eyes, soft cel shading with
light shadows, simple shapes, original designs. Characters are built from
code for now ("Stage-1 procedural art", D-027); authored models can replace
them later without changing saved characters.

## Title screen and character creation

The game opens on a title screen (an original key visual: a starry blue
fresco-like sky over lit porticoes, D-032) with **New life**, **Continue**,
**Manage characters**, **Settings** and **Credits**.

- **Lives.** One guest profile (this browser) holds up to three characters,
  each with its own look, personality, needs, skills and money (D-031).
  Continue enters the most recently played one. Manage characters lists
  them with Play, Edit look and Delete (the name must be typed; deleting
  can't be undone) and offers New life while there is room.
- **New life** has three steps: (1) name and up to two personality traits
  (optional; personality affects needs and skills, appearance never does;
  every player character is an adult); (2) the look, in the live 3D
  creator; (3) review: the character turning slowly, name, traits and one
  plain line per category with a "Change" link, then **Begin life in
  Padova**. Going back a step keeps every choice. Nothing is saved until
  that last button.
- **The creator** groups the options as players think of them:
  *Appearance* (starting looks and skin), *Face*, *Hair*, *Body*,
  *Clothing* and *Accessories* (headwear and glasses). Drag or swipe to
  turn the character, scroll or pinch to zoom (or the Body / Upper / Face
  and +/− buttons); randomise everything or one category, reset a category,
  undo / redo, hold to compare with the starting (or saved) look. Starting
  looks are optional conveniences named by their look; every feature can be
  changed independently afterwards.
- **Entering the world** shows a short "Welcome to Padova" transition with
  the time of day while the piazza draws, then uncovers it.
- **Editing later**, in the world (click yourself or the character panel →
  Edit look) or from Manage characters: the same creator with a review step
  that lists what will change; Save look changes the appearance only, never
  needs, money, skills or relationships. Cancelling with unsaved changes
  asks before discarding them.
- **Back to title** (character panel) saves and takes the character out of
  the piazza.
- **Settings** (this device): graphics, camera turning speed, interface
  animation (follows the device's reduced-motion setting by default),
  controls reminder.

**Screen flow (implemented, M6b; `client/src/ui/flow.ts`).** Square brackets
are the requests sent to the server; nothing is sent before them.

```
Title ─┬─ New life ─► 1 Name & personality ─► 2 Look ─► 3 Review ─► [createCharacter] ─► Welcome ─► World
       │               (Back keeps choices)    ("Change" on the review jumps back to that category)
       ├─ Continue ───────────────────────────────────────────────► [enterWorld] ─► Welcome ─► World
       ├─ Manage characters ─┬─ Play ─────────────────────────────► [enterWorld] ─► Welcome ─► World
       │                     ├─ Edit look ─► Look ─► Review ─► [updateAppearance] ─► Manage ("Look saved")
       │                     ├─ Delete ─► type the name ─► [deleteCharacter] ─► Manage ("… was deleted")
       │                     └─ New life (only while a place is free; otherwise "All 3 lives are in use")
       ├─ Settings ─► Back
       └─ Credits ─► Back
World ── yourself or the panel ─► Edit look ─► Look ─► Review ─► [updateAppearance] ─► World
World ── panel ─► Back to title ─► [leaveWorld] ─► Title
```

- **Refusals go back to where they can be fixed:** a bad name returns to
  step 1; other creation or look errors appear in the creator; a character
  that can't be entered returns to the screen it was chosen from; a delete
  error appears in the confirmation dialog.
- **No answer within 15 s** shows "The server didn't answer. Please try
  again." instead of waiting forever.
- **Cancel** in the creator asks before discarding unsaved changes.
- **Another window takes over** (close code 4100): "Playing in another
  window" with *Play here instead*. **Connection lost** while playing: the
  character is already saved; the button returns to the title screen.
- The title screen is the lobby: joining lists the profile's characters and
  places nobody in the world (D-031).

## World

Start with one compact, dense district and expand by connected districts.
Real places are stylised; fictional places are clearly marked as such in data.

**The first district (world art pass, D-033, D-034)** is a fictional
university square inspired by Padua's historic centre, not a real location:

- North: the university hall ("Palazzo degli Studi", a fictional name), a
  Renaissance palazzo with a rusticated ground floor, banners, a clock tower
  that shows the game time, and a walk-in entrance porch between the two
  outdoor study desks; next to it, a neoclassical library with a dome.
- West: narrow houses with a bookshop and a pharmacy; benches under plane
  trees. East: porticoed houses: you can walk the covered walkway behind
  the columns, past an osteria, a stationer and a bakery.
- South: student housing and shops (gelateria, bakery, newsagent), where
  new characters arrive.
- Centre: the fountain inside stone rings, a market of three stalls (fruit
  and vegetables, flowers, books), two gardens with benches, lemon trees,
  street lamps, and the café kiosk with three tables.
- Six streets lead out; each is closed by planters where the walkable area
  ends ("not open yet") and continues as scenery to a building. Old-town
  roofs, a brick bell tower, a keel-roofed hall and domes form the skyline.

Everything you can use: benches (sit, sketch), study desks and café tables
(sit, study), the café counter (buy), the fountain (wash up). The porch,
gardens and portico are places to walk and meet; doors don't open yet.

## Interaction model and device requirements (Sims-inspired, original UI)

- The world is the main interface: click or tap a character, object or place
  to get a contextual menu of the actions valid right now.
- Choosing an action validates it on the server, walks the character to the
  interaction point, plays it, updates state and shows the result.
- Reference screenshots supplied by the owner: a radial menu around the
  target (desktop life-sim) and a card list with costs and durations
  (mobile life-sim). Our menus are original: terracotta pill options fanned
  above the target on desktop, a bottom sheet with large buttons on touch.

**What can be used today (implemented):** benches (sit, sketch, stand up),
study desks and café tables (sit, study), the café counter (buy, with
prices), the fountain (wash up), other players (greet). Clicking yourself
opens *Character* and *Edit look* (standing) or the seat's actions plus
*Character* (seated). Only valid actions are shown; the server re-checks
every one.

**Desktop and mobile requirements** (from the owner's brief, project context
§11–14). Both kinds of device are first-class; mobile is not a squeezed
desktop layout.

| Requirement | Desktop | Touch (phones, tablets) | Status |
| --- | --- | --- | --- |
| Select characters, objects and places by pointing at them | Left-click | Tap | Implemented (M3); tested on desktop and in phone emulation |
| Contextual menu near the target with only valid actions; closes or updates on a new selection | Radial fan (becomes a column for long labels) | Bottom sheet, docked right in landscape | Implemented (M3); tested |
| Menus scroll or page when many actions are available | — | — | **Not built:** at most three options exist today (the café); needed before objects with more actions |
| Walk by pointing at the ground, with pathfinding | Click | Tap | Implemented (M1) |
| Direct movement | WASD or arrow keys | Optional on-screen joystick | Implemented (M1). Key bindings are fixed; configurable bindings are **proposed** (a Settings option) |
| Camera control | Drag to orbit, wheel to zoom | One-finger drag, two-finger pinch | Implemented (M1) |
| Selecting never confused with turning the camera | ≤ 8 px and < 450 ms is a tap | Same; two fingers never tap | Implemented (ARCHITECTURE "Input") |
| The page never scrolls or zooms during play | — | `touch-action: none`, no page zoom | Implemented |
| Feedback: hover, selection highlight, action progress with Cancel, an explanation when refused | Hover highlight and pointer cursor | Selection highlight (no hover needed) | Implemented (M3) |
| Nothing needs hover, right-click or a keyboard | Every action has a click path | Every action has a tap path | Implemented; hover only previews (e.g. starting looks) |
| Large touch targets | — | Menu items ≥ 44 px; action-sheet buttons 56 px | Implemented; tested in emulation |
| Essential controls within thumb reach | — | Sheet and joystick at the bottom; status chips at the top | Implemented; not yet checked on a real phone |
| Portrait and landscape | — | Both; landscape preferred for the 3D view | Implemented for the title screens, creator and world; tested in emulation |
| Your own character: info panel and actions | Click yourself → Character | Tap yourself | Implemented for needs, mood, skills, money and current action (M5); inventory and relationships don't exist yet |
| Another character: public information and social actions | Click → menu | Tap → menu | **Partial:** name and activity tag, *Greet* only. A public info panel and more social actions are **proposed** (M9) |
| Private information stays private | — | — | Implemented (D-024): life data goes only to its owner |
| Drag or place objects | — | — | **Not built:** comes with housing (proposed M10) |
| Quality settings for slower devices | Settings → Graphics | *Automatic* picks Performance on touch | Implemented (M6b, M6c) |
| Accessibility: readable text, contrast, reduced motion | — | — | **Partial:** contrast-checked colours (D-032) and a reduced-motion setting; no screen-reader or colour-blindness review yet |
| Verified on real devices (Windows, Android, iPhone/iPad) | — | — | **Not yet:** automated tests use Chromium on Linux and phone emulation; manual checklist in TESTING.md |

## Time model (decided for M5, D-021 and D-022)

Written before the clock was implemented; the code must follow it.

- **One world clock for everyone, kept by the server.** Game time is
  calculated from real UTC time: `game minute = 480 + (real ms since
  2026-10-01T00:00Z) / 60 000 × scale`. Minute 480 is 08:00 on Day 1. The
  clock never pauses, fast-forwards or depends on who is online, and it
  survives server restarts without being stored.
- **Default scale: 10 game minutes per real minute.** One game hour = 6 real
  minutes; one game day = 2 h 24 min real. A typical session sees a good part
  of a day without days flashing by. The scale is server configuration
  (`GAME_TIME_SCALE`); changing it moves the clock, so it is for development
  and balancing, not for live worlds.
- **Clients never keep their own clock.** The server replicates the current
  game minute; the client only displays it.
- **Needs change in game time**, on the server's 20 Hz loop, from elapsed
  server time, so frame rate and client speed have no effect.
- **Action durations are real seconds** (study 20 s, sketch 15 s, wash 6 s,
  eating 5–15 s). They are about how long the player watches an action, not
  about the world clock. Their *effects* are fixed per completed action and
  applied gradually, so stopping halfway gives half the effect.
- **Sleep** is not in M5 (no beds yet). Energy comes back by resting on a
  bench, from coffee, and while offline.

### While a player is offline

- The world clock keeps running; the character is simply absent.
- When the character next enters the world, the time since its last save is
  applied once, **capped at 8 game hours** (48 real minutes at default scale):
  hunger, hygiene, social and fun fall at **half** their normal rate and
  **never below 35** because of offline time; energy **recovers** at the
  resting rate up to 90 (logging off counts as rest).
- Recent mood events expire by game time, offline included.
- Skills and money never change offline. Daily allowances are not paid for
  days spent offline (no back pay).

Result: a returning player is never in crisis because they were away, but the
world visibly moved on.

## Life simulation (M5)

All values are tuning in `shared/src/life/config.ts`; numbers below are the
defaults. Every rule is a pure function in `shared/src/life/` and the server
is the only authority.

### Needs (0–100)

100 = fully satisfied, 0 = completely unmet. New characters start at 80
(social and fun at 70).

| Need | 0 means | Change per game hour | Empty from full (real time) | Restored by |
| --- | --- | --- | --- | --- |
| Hunger | starving | −6 | ~1 h 40 min | café food |
| Energy | exhausted | −4 standing, −5 walking, +20 sitting | ~2 h 30 min | resting on a bench, espresso, being offline |
| Hygiene | grubby | −3 | ~3 h 20 min | washing up at the fountain (placeholder until homes have showers) |
| Social | lonely | −4 | ~2 h 30 min | greeting someone, being greeted |
| Fun | bored | −5 (−2 while sitting on a bench) | ~2 h | sketching, café treats, greetings |

**Consequences of low needs** (deliberately gentle; nothing kills, injures or
removes a character, and there is no "game over"):
- Every need feeds **mood**; low needs hurt mood twice as much as high needs help it.
- **Mood scales skill gains** (below).
- **Energy below 10:** studying and sketching can't be started ("too tired").
  Rest on a bench or have an espresso.
- **Hygiene below 20:** greetings give half the usual social gain.

### Mood

Mood is not a separate meter: it is calculated from needs plus recent events,
and the character panel shows the reasons.

- Each need contributes −16 (at 0) to +8 (at 100), zero at 50.
- Recent events add or subtract (one of each kind at a time; repeating it
  refreshes the timer): *Good meal* +10 (3 game h), *Caffeine boost* +5 (1 h),
  *Learned something* +8 (2 h), *Creative flow* +8 (2 h), *Freshened up* +5
  (1.5 h), *Friendly hello* +10 (2 h), *Someone said hello* +6 (1.5 h),
  *Couldn't afford it* −5 (1 h).
- Score −100…100 → **Miserable** (≤ −40), **Low** (≤ −15), **Okay**, **Good**
  (≥ 15), **Great** (≥ 40).
- Skill gain multiplier: Miserable ×0.5, Low ×0.75, Okay ×1, Good ×1.1, Great ×1.25.

### Skills

Academic ability, communication, cooking, fitness, creativity. Levels 0–10
from experience points: level *n* needs 50 × n × (n + 1) XP in total (100,
300, 600, 1000 … 5500). No skill tree.

| Skill | Improves by (M5) |
| --- | --- |
| Academic ability | studying at a desk: 20 XP per session |
| Communication | greeting someone: 5 XP |
| Creativity | sketching on a bench: 15 XP per session |
| Fitness | walking: 0.1 XP per metre |
| Cooking | nothing yet; kitchens come with housing |

Planned unlocks (not built) are in "Life simulation: proposed next steps"
below.

### Personality traits

Pick up to two when creating a character. Effects are fixed multipliers, so
outcomes stay deterministic and testable.

| Trait | Effect |
| --- | --- |
| Organised | academic XP +20%; hygiene falls 20% slower |
| Sociable | communication XP +25%; social gains +50%; social falls 25% faster |
| Creative | creativity XP +25%; fun from sketching +50% |
| Ambitious | all skill XP +10%; fun falls 15% faster |

### Money

- Euros, stored as whole cents. **The balance can never be negative**; there
  is no debt mechanic.
- Every change is a server-side transaction in a ledger (income or expense,
  amount, balance after, item, reason). Repeating a request never charges twice.
- Income: **€100 starting allowance**; **€15 daily allowance** once per game
  day while playing (no back pay). Jobs come in M7, when the daily allowance
  halves to €7.50 (D-035; see "Work (M7)").
- Expenses: café purchases. The café kiosk (in the open square, east of
  where players arrive; a kiosk with a canopy since the world art pass)
  sells **Espresso €1.50** (+15 energy, +5 fun), **Cornetto €1.80**
  (+20 hunger, +5 fun) and **Panino €4.50** (+45 hunger, +5 energy).
- Food is eaten straight away after paying; there is no inventory yet. If the
  order is abandoned while the payment is still being processed, it is refunded.

### First complete loop (M5 target)

Enter the world → open the character panel → walk to the café → buy a panino
(server transaction) → eat it (hunger rises) → study at a desk (academic
skill rises) → see the changes in the panel → reload and find needs, skills,
money and mood events as they were.

## Life simulation: proposed next steps (not built)

**Proposed, not implemented.** How the M5 systems are expected to grow, so
that milestones can be planned against one picture. Numbers will be tuning
values; items marked *approved* were decided by the product owner on
2026-10-20 (D-035; ROADMAP.md "Decisions for the product owner"). Principles
that stay: nothing kills or
injures a character, there is no game over, absence never creates a crisis
(D-022), and appearance never affects gameplay (D-029).

| System | Today (implemented) | Proposed next | Milestone (proposed) |
| --- | --- | --- | --- |
| Needs | Hunger, energy, hygiene, social, fun | **Comfort**, which the owner's brief lists (*approved*: added in M10 with furniture of different comfort, not now while every seat is a bench or chair); **sleep** in a bed as the main energy source; showers at home for hygiene (the fountain stays a quick wash) | M10 |
| Mood | Score from needs plus recent events, with reasons | New events from new systems (shift done, exam passed or failed, new friend, rent paid); mood visible on the character (poses first; faces need expressions the procedural model lacks) | M7–M10 |
| Skills | Five skills, levels 0–10, nothing unlocked | Communication raises café pay or unlocks the second job grade (M7); academic level improves exam results (M8); cooking unlocks home recipes (M10); fitness unlocks running (needs a movement design: speed, energy cost, server limits) | M7, M8, M10 |
| Personality | Four traits, chosen at creation, fixed | Keep four until a new trait has a distinct, testable effect; traits stay fixed after creation | — |
| Money in | €100 start, €15 per game day played | **Wages** from shifts, paid per completed shift through the ledger (M7; design in "Work (M7)"). The daily allowance halves to €7.50 per game day when jobs arrive (*approved*) | M7 |
| Money out | Café food and drinks | Rent and bills with housing, charged on a game-week schedule from the ledger; furniture and groceries into an inventory. With no debt (D-023), rent that can't be paid gives a notice and a mood event, then a move to a cheaper room (*approved*) | M10 |
| Money between players | None | Not planned: gifts or trades would need anti-exploit design (duplication, laundering through alt characters) before they exist | — |

## Work (M7) — planned, not built yet

**Planned, not implemented.** M7 is the next milestone (order approved,
D-035). This is its design, written against the current code; the numbers
are first tuning values for `shared/src/life/config.ts`, to be play-tested.

**The job.** One workplace to start: the café kiosk. Two grades, decided by
the server from the character's communication level when a shift starts (a
pure rule in `shared/src/life/`):

| Grade | Requirement | Wage per completed shift |
| --- | --- | --- |
| Café assistant | None | €6.00 |
| Barista | Communication level 2 (300 XP) | €8.00 |

**Getting the job.** The café counter's menu offers *Ask about work* (with
the wage shown) to anyone who doesn't work there; choosing it walks you to
the counter and hires you at once. *Quit job* is a button in the character
panel. There is one job per character for now.

**Working a shift.** For employees, the counter offers *Work a shift* (with
wage and length shown) while the café is open, a staff spot is free and
today's limit isn't reached.
- The character walks to one of two **staff spots behind the counter** (the
  south side; customers keep the two spots in front). Spots get a use tag so
  customers and staff never take each other's places.
- A shift is a server-timed action like studying: **90 real seconds**
  (15 game minutes), activity `working` (others see "working" and a serving
  pose), with progress and Cancel.
- Effects while working, in proportion to time: energy −8 and fun −4 per
  full shift. On completion: +10 communication XP (with the usual trait and
  mood multipliers) and a new mood event, *Good day's work* (+6 for 2 game
  hours).
- **Pay on completion only:** €6 or €8 through `applyMoneyChange`, category
  `wage`, idempotency key `wage:<shift id>`. A cancelled, interrupted or
  dropped shift pays nothing; the short length keeps that fair.
- **Limits:** the café is open 06:00–23:00 game time; at most 4 completed
  shifts per game day; not while too tired (energy below 10, the same rule
  as studying).
- **The daily allowance halves** to €7.50 per game day (approved, D-035);
  balances already earned are untouched.

**What the player sees.** The character panel gains a *Work* section: job and
grade, wage, shifts today (n of 4), whether the café is open or when it
opens, and *Quit job*; wages appear in the transaction list. Refusals are
explained ("The café is closed until 06:00", "That's enough shifts for
today", "Too tired to work").

**How it fits the code.**
- Rules (`shared/src/life/`): job catalogue, grade from communication level,
  opening hours from the game minute, shifts left today, the `work` effect in
  `ACTION_EFFECTS`; unit-tested.
- Interactions: new action ids `ask_work` (untimed, runs on arrival) and
  `work` (timed) for the `cafe` kind; seats gain an optional use tag
  (`customer` or `staff`) that `chooseSeat` and validation respect; new
  refusal reasons `closed`, `shift_limit`, `not_employed`, `already_employed`.
- Server: `LifeSystem` hooks check the limits (`checkStart`), apply the
  effect, and on completion record the shift and pay the wage; SQL in
  `lifeRepository.ts`, owner-scoped like the rest.
- Data (migration 0005): `character_employment` and `work_shifts` (DATA_MODEL
  "Proposed"), and the ledger's `category` CHECK gains `wage`; the `down`
  step refuses to run while wage rows exist, like 0004.
- Messages: `life` gains a `job` section (private to the owner); a new
  `quitJob` message (no payload). Nothing about pay is replicated.
- Client: menu options with details, the panel section, the working pose,
  refusal texts.

**Tests planned:** unit (grades, opening hours, limits, effect, wage);
database (migration 0005 up, down and up on PGlite and PostgreSQL; a wage
paid once per key; shifts counted per game day; owner scoping); integration
(hire → shift → wage exactly once; cancel and drop pay nothing; the daily
limit; closed hours; two employees on the two staff spots and a third
refused; customers can still buy while staff work; others never see pay);
browser (desktop: ask about work, work a shift, see the wage, reload keeps
job and wage; phone: menu and panel layout).

**Defaults chosen, open to change:** wages, shift length, opening hours and
the daily limit are tuning values; unpaid partial shifts are a design
choice the product owner can reverse (proportional pay instead).

## Open design questions

1. ~~**Time in a shared world.**~~ Decided above (D-021, D-022); sleep and
   schedules are designed with housing and university timetables.
2. ~~**First real district.**~~ For now a fictional composite of Padua's
   university and market squares (D-033). A district modelled on real
   streets (with verified references, e.g. the Portello area) is still
   possible when the world grows.
3. ~~**Character customisation depth vs art budget.**~~ No VRM spike was
   run: M6 chose procedural characters built from the appearance config
   (D-027), so depth is limited by renderer code, not an art budget. Whether
   to commission or license authored models is still open (ROADMAP
   decision Q6; requirements in ASSET_PIPELINE.md).
