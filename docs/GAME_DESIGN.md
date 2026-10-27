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
prices; *Ask about work* without a job, *Work a shift* for employees, M7),
the fountain (wash up), other players (greet), the university hall's and
the library's doors (*Go in*, M7c) and, inside, the desks, tables and the
door out. Clicking yourself
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
| Menus scroll or page when many actions are available | — | — | **Not built:** at most four options exist today (the café: three items and one work option); needed before objects with more actions |
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
| Your own character: info panel and actions | Click yourself → Character | Tap yourself | Implemented for needs, mood, skills, money and current action (M5), work (M7), university (M8), story and blocks (M9) and home (M10); at home your own menu also offers *Furnish your room* |
| Another character: public information and social actions | Click → menu | Tap → menu | Implemented: *Greet*, *Chat*, *Profile* (the player card), *Block…*, *Report…* (M9). A non-player character (M11) has a gold name tag with its role, and its menu says "not a player" and offers *Greet* only |
| Private information stays private | — | — | Implemented (D-024): life data goes only to its owner |
| Place objects | Home panel: pick a piece for a spot | Same panel as a bottom sheet | **Controlled placement (M10):** each room has fixed spots (bed, seats, decorations); you choose what goes in each from a list. Free dragging and rotating are not built |
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
- **Day and night are visible (M7b, D-037)** and purely visual. Dawn from
  05:15, sunrise 06:15, full day 07:30–18:30, sunset 19:45, dusk until
  21:30, then night with stars, a moon, lit windows and pools of lamplight.
  Everyone in the world sees the same time of day, because the light is
  drawn from the server's game minute. Nothing in the game depends on the
  light: needs, money, actions and opening hours (the café's 06:00–23:00)
  come from the clock itself, never from how bright it is. Night is a mood,
  not a handicap: characters, name tags and menus stay as easy to see as by
  day.

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
| Hygiene | grubby | −3 | ~3 h 20 min | washing up at the fountain (homes have no showers yet) |
| Social | lonely | −4 | ~2 h 30 min | greeting someone, being greeted |
| Fun | bored | −5 (−2 while sitting on a bench) | ~2 h | sketching, café treats, greetings |
| Comfort (M10) | uncomfortable | −3 (+4 sitting on a bench or desk chair; +8 to +22 on a seat at home) | ~3 h 20 min | sitting, sleeping in a bed (+15 to +35 a full sleep); starts at 70 |

**Consequences of low needs** (deliberately gentle; nothing kills, injures or
removes a character, and there is no "game over"):
- Every need feeds **mood**; low needs hurt mood twice as much as high needs help it.
- **Mood scales skill gains** (below).
- **Energy below 10:** studying, sketching and café shifts can't be started
  ("too tired"). Rest on a bench or have an espresso.
- **Hygiene below 20:** greetings give half the usual social gain.

### Mood

Mood is not a separate meter: it is calculated from needs plus recent events,
and the character panel shows the reasons.

- Each need contributes −16 (at 0) to +8 (at 100), zero at 50.
- Recent events add or subtract (one of each kind at a time; repeating it
  refreshes the timer): *Good meal* +10 (3 game h), *Caffeine boost* +5 (1 h),
  *Learned something* +8 (2 h), *Creative flow* +8 (2 h), *Freshened up* +5
  (1.5 h), *Friendly hello* +10 (2 h), *Someone said hello* +6 (1.5 h),
  *Couldn't afford it* −5 (1 h), *Good day's work* +6 (2 h, after a completed
  shift, M7); the university's and relationships' events (M8, M9, below);
  *New home* +10 (6 h), *Cosy home* +6 (3 h), *Slept well* +6 (4 h),
  *Worried about rent* −6 (12 h), *Had to move out* −10 (8 h) (M10).
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
| Communication | greeting someone: 5 XP; a completed café shift: 10 XP (M7) |
| Creativity | sketching on a bench: 15 XP per session |
| Fitness | walking: 0.1 XP per metre |
| Cooking | nothing yet; kitchens come with housing |

**First unlock (M7):** communication level 2 makes café shifts pay the
barista wage (€8 instead of €6). Further unlocks (not built) are in "Life
simulation: proposed next steps" below.

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
- Income: **€100 starting allowance**; **€7.50 daily allowance** once per
  game day while playing (no back pay; €15 until jobs arrived in M7, halved
  as approved in D-035); **wages** of €6 or €8 per completed café shift (see
  "Work (M7)"). Balances earned before the change were not touched.
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
| Needs | Hunger, energy, hygiene, social, fun; comfort and sleep in a bed (M10) | Showers at home for hygiene (the fountain stays a quick wash) | Later |
| Mood | Score from needs plus recent events, with reasons; *Good day's work* after a shift (M7); *Interesting lecture*, *Passed an exam*, *Failed an exam* (M8); *Nice chat*, *Someone chatted with you*, *New friend* (M9) | New events from new systems (rent paid); mood visible on the character (poses first; faces need expressions the procedural model lacks) | M10 |
| Skills | Five skills, levels 0–10; communication level 2 unlocks the barista wage (M7); academic level counts in the exam grade (M8) | Cooking unlocks home recipes (M10); fitness unlocks running (needs a movement design: speed, energy cost, server limits) | M10 |
| Personality | Four traits, chosen at creation, fixed | Keep four until a new trait has a distinct, testable effect; traits stay fixed after creation | — |
| Money in | €100 start, €7.50 per game day played, wages per completed café shift (M7) | More jobs or grades as new places open (e.g. the university in M8) | Later |
| Money out | Café food and drinks; weekly rent and furniture (M10) | Bills and groceries; more furniture | Later |
| Money between players | None | Not planned: gifts or trades would need anti-exploit design (duplication, laundering through alt characters) before they exist | — |

## Work (M7)

**Implemented in M7** (multiplayer functional and persistence verified in
automated tests; see TESTING.md for results). Numbers are tuning values in
`shared/src/life/config.ts` (`JOBS`, `ACTION_EFFECTS.work`,
`ECONOMY_CONFIG`) and still need play-testing by the product owner.

**The job.** One workplace: the café kiosk. Two grades, decided by the
server from the character's communication level each time a shift starts
(`gradeFor` in `shared/src/life/work.ts`):

| Grade | Requirement | Wage per completed shift |
| --- | --- | --- |
| Café assistant | None | €6.00 |
| Barista | Communication level 2 (300 XP) | €8.00 |

**Getting the job.** Without a job, the café counter's menu offers *Ask
about work* with the wage shown ("€6.00 a shift"). Choosing it walks the
character to a customer spot at the counter and hires them as soon as the
database records it ("You got the job: Café assistant, €6.00 a shift").
Hiring works at any hour. One job per character; *Quit job* is a button in
the character panel's Work section, and asking again later hires again.

**Working a shift.** For employees the counter offers *Work a shift* with
wage and length ("€6.00 · 90 s").
- The character walks to one of two **staff spots behind the counter** (the
  south side, under the kiosk canopy's barista end; customers keep the two
  spots in front). Staff spots are tagged `use: "staff"` in
  `shared/src/world.ts`: customers never take them and staff never take the
  customers' spots, so customers can still buy while two people work.
- A shift is a server-timed action: **90 real seconds** (15 game minutes at
  the default clock), activity `working` (others see "· working" on the name
  tag and a serving pose), with progress and Cancel.
- While working, energy −8 and fun −4 per full shift, applied gradually. On
  completion: +10 communication XP (with the usual trait and mood
  multipliers) and the mood event *Good day's work* (+6 for 2 game hours).
- **Paid on completion only:** €6 or €8 through `applyMoneyChange`, category
  `wage`, ledger key `wage:<shift id>`, shown as "Wage: Café assistant" (or
  "Wage: Barista"). The shift counts as completed only once the wage and the
  shift record are written (one database transaction); the toast says
  "Shift done: +€6.00 wage". A cancelled, interrupted (walking away,
  choosing another action, quitting) or dropped shift pays nothing and is
  not recorded; the short length keeps that fair.
- The grade and wage are fixed when the shift starts; levelling up during a
  shift pays the higher wage from the next one.

**Limits.**
- The café is open **06:00–23:00** game time; a shift can start while it is
  open (one started at 22:55 may finish after 23:00).
- At most **4 completed shifts per game day**, counted by the day the shift
  started and checked again in the database when the wage is paid.
- Not while too tired: energy below 10, the same rule as studying.
- When a limit applies, *Work a shift* stays in the menu, greyed out with
  the reason ("Opens at 06:00", "4 of 4 shifts done today", "Too tired"), so
  players can see why; the server refuses with the same reasons if asked
  anyway. When both staff spots are taken the option is not shown, and a
  request is answered "Someone else is using that".

**What the player sees.** The character panel has a **Work** section between
Skills and Money: job and grade ("Café kiosk · Café assistant"), wage and
the next grade ("€6.00 per completed shift · Barista €8.00 at Communication
Lv 2"), shifts today ("Shifts today 1 of 4"), whether the café is open
("Open now, until 23:00" or "Closed · opens at 06:00") and *Quit job*.
Without a job it says how to get one. Wages appear in the money list.

**Economy check.** The halved allowance (€7.50) no longer pays for a day of
food on its own (the cheapest food costs about €13 per game day of hunger);
the allowance plus one assistant shift does. A unit test keeps that true
(`shared/test/work.test.ts`).

**Defaults chosen, open to change:** wages, shift length, opening hours and
the daily limit are tuning values; unpaid partial shifts are a design choice
the product owner can reverse (proportional pay instead); showing
unavailable shifts greyed out with a reason is recorded in D-036.

## University (M8)

**Implemented in M8** (multiplayer functional and persistence verified in
automated tests; see TESTING.md for results). Numbers are tuning values in
`shared/src/life/config.ts` (`COURSES`, `ACTION_EFFECTS.attend` and
`.exam`, `MOOD_EVENTS`) and still need play-testing by the product owner.
The rules are pure functions in `shared/src/life/university.ts`.

**One fictional course.** *Introduction to City Studies*: "a fictional
first-year course on how cities live and work". No real course names, and
nothing suggests a link with any real university. More courses, years and
graduation come later.

**The week.** Day 1 of the game clock is a Monday, so every game day has a
weekday (shown in the clock chip, "Wed 10:24 · €105.50", and in the panel).
A game day lasts 2.4 real hours at the kept clock (D-038), so a game week
lasts 16.8 real hours; the timetable is built for that:

| What | When (game time) | Where |
| --- | --- | --- |
| Lectures | Monday to Friday, on the hour 09:00–12:00 and 14:00–17:00 (eight a day, 50 minutes each, lunch at 13:00) | The university hall's lecture room, at a lecture desk |
| Joining a lecture | From its start until 20 minutes after (late entry); one attendance per lecture | Same |
| Exam sittings | Wednesday and Saturday, 09:00–19:00; one attempt per sitting | Same |

On a weekday between 09:00 and 17:00 game time the next lecture is at most
six real minutes away (except over lunch); there are none at night or at
weekends. Exam sittings come round 7.2 or 9.6 real hours apart and stay
open for one real hour.

**Enrolling.** The **University notice board** beside the university hall's
door (north-west corner of the square) offers *Enrol: Introduction to City
Studies* ("Free · lectures Mon–Fri, on the hour 09:00–12:00 and
14:00–17:00"). The character walks to it and is enrolled as soon as the
database records it. Enrolling is free and works at any hour. Once enrolled
(or passed), the option stays in the menu greyed out with the status.

**Attending a lecture.** Lecture desks offer enrolled students *Attend the
lecture* with the lecture's time ("09:00 lecture · join until 09:20"), or
greyed out with the reason ("Next lecture 14:00 · in about 8 min",
"Attended · next 10:00 …", "Too tired"). Attending is a seated, server-timed
action: **2 real minutes** (20 game minutes), activity `attending` (others
see "· in a lecture"), energy −6 and fun −3 and +10 academic XP gradually,
then +20 academic XP and the mood event *Interesting lecture* (+6 for 2
game hours) on completion. The timetable is checked when the student asks
and again when they reach the desk; the lecture counts only when completed
and recorded (`recordLecture`, one row per lecture key such as `d12-0900`).
A lecture left early never counts and can still be attended while late
entry is open.

**Studying counts.** While enrolled, every completed study session at any
desk or table (the square, the lecture room, the reading room, the café)
also counts for the course.

**The exam.** During a sitting, lecture desks offer *Sit the exam* with the
grade it would give now ("Expected 24/30 · 3 min · open until 19:00").
Sitting it is a seated, server-timed action of **3 real minutes** (30 game
minutes), activity `exam` (others see "· in an exam"), energy −10 and fun
−6, +20 academic XP on completion. When it ends the server grades it from
the stored attendance and study count and the character's academic level
(`examGrade`), in one transaction with its record:

- attendance counts in full at **8 lectures**, study at **6 sessions**,
  academic level at **level 4**; weights 45 %, 35 % and 20 %;
- grade = 12 + 19 × score, rounded: from 12 (no preparation) to 31, shown
  as **30 cum laude**; **18 passes** (the Italian 18–30 scale);
- for example: 4 lectures alone give 16 (not passed); 4 lectures and 2
  study sessions give 18; 8 lectures and 6 sessions give 27; everything at
  academic level 4 gives 30 cum laude.

The grade is deterministic, so the panel can say what sitting now would
give. **Passed:** the course is complete ("Exam passed: 27/30! You
completed Introduction to City Studies"), the mood event *Passed an exam*
(+15 for 6 game hours). **Not passed:** a gentle consequence: the grade
is recorded, the mood event *Failed an exam* (−8 for 4 game hours), the
course stays open with everything done so far, and the exam can be retaken
at the next sitting ("Not passed this time: 13/30. Attend lectures and
study, then try again. Retake it at the next sitting (Sat 09:00)"). An
exam left early is not graded and can be started again in the same
sitting.

**What the player sees.** The character panel has a **University** section
between Work and Money: the course, the lecture timetable and room, the
next lecture ("Next lecture 14:00 · in about 8 min" or "09:00 lecture ·
join until 09:20"), bars for lectures attended ("3 of 8") and study
sessions ("2 of 6"), the exam sittings and the next one, the grade sitting
now would give, and the last result if it was not a pass. After passing it
shows "Introduction to City Studies · Passed 27/30". Without an enrolment it
says where the notice board is. Attendance, study and results are private:
only the owner receives them (`life` message), and they are saved.

**Defaults chosen, open to change:** the timetable (hourly lectures, two
sittings a week) is built for the real-time clock and can be changed in
data; the grade formula and its targets are tuning values; a failed exam has
no cost beyond the mood event and waiting for the next sitting (no fees, no
limit on retakes). Recorded in D-040.

## Relationships (M9)

**Implemented in M9** (multiplayer functional and persistence verified in
automated tests; see TESTING.md for results). Numbers are tuning values in
`shared/src/life/config.ts` (`RELATIONSHIP_CONFIG`, `ACTION_EFFECTS.chat`,
`CHAT_EFFECTS`, `MOOD_EVENTS`); rules in `shared/src/life/relationships.ts`.

**Tapping another player** opens their menu: *Greet*, *Chat*, *Profile*,
*Block…* and *Report…*. *Profile* opens their **card**: name, a portrait of
their look, what they're doing ("Studying", "Chatting", "Hanging out"), and
**you and them**: the relationship's level, a friendship bar ("12 of 100"),
"Known since Wed · Day 262" and your last five shared moments. Never their
needs, money, skills or traits. Desktop: the right-hand column like the
character panel; touch: a bottom sheet.

**Chat** (new): your character walks up to the other player and chats for
**10 real seconds** (activity `chatting`, a talking pose, "· chatting" on the
name tag). The other player is told ("Ada is chatting with you.") and isn't
interrupted. When it finishes: you get social +18, fun +6, communication +6
XP and *Nice chat* (+8 for 2 game hours); they get social +12 and *Someone
chatted with you* (+6). It stops if they walk more than 4 m away. The same
player can be chatted with again after 30 real seconds (greetings: 5 s).

**Relationships** are between characters: one friendship score per pair,
0–100, the same for both. Shared moments raise it:

| Moment | Gain | Counts per pair per game day |
| --- | --- | --- |
| A greeting | +2 | 2 |
| A completed chat | +5 | 4 |
| Studying at the same table at the same time (counted when the first of the two finishes) | +4 | 3 |
| Attending the same lecture | +4 | 3 |

Levels: Acquaintance (from the first moment), Friendly (15), **Friend
(40)**, Good friend (70), Close friend (90). A full game day of every kind
with one person (2.4 real hours together) gives 48: Friend, not more. A
level-up tells both players ("You and Ben are now friends."); reaching
Friend also writes "Became friends with …" in both stories and gives both
*New friend* (+12 for 6 game hours). Nothing lowers a relationship in M9:
no rivalry, arguments or decay yet. Relationships are private to the two
players and saved; the last 20 moments per pair are kept.

## Safety (M9)

Decided by the product owner on 2026-10-27 (D-042); choices in D-043.

**Blocking** someone (from the menu or their card; a dialog confirms) covers
their **whole account**, all its characters. Neither of you can greet or
chat with the other, either way; their greetings don't reach you; shared
moments between you don't count. A greeting or chat in progress between you
stops. They aren't told: anything they try says "They can't be reached
right now." For you, their menu offers only *Profile* and *Unblock* and says
"Blocked". Your blocks are listed in your character panel (**Blocked
players**), each with *Unblock*. Blocks are saved and belong to accounts, so
they carry over when guests sign in (M12).

**Reporting** someone (from the menu or their card) asks for a reason
(harassment or bullying; hateful or discriminatory behaviour; offensive name
or look; cheating or exploiting the game; something else) and an optional
note of up to 300 characters. Only the reason, the note, both names, the
area and the game time are kept. Reporting also blocks them for you. Limits:
one report per reported account per real day ("You already reported Ben
today"), five reports per hour. The product owner reads reports with `npm
run reports` until the admin page comes with sign-in (M12); **every report
is deleted 90 days after it is made**, checked when the server starts and
every hour. Warnings, mutes and bans come with the admin page (M12).

## Story log (M9)

Each character keeps a private **story**: meaningful events written by the
server, newest first, in the character panel (**Your story**): getting a
job, a first shift, enrolling, passing or failing an exam (with the grade),
becoming friends with someone (their name as it was then). Each event is
written once. The panel shows the last ten; all are saved. It starts with
M9: jobs, enrolments and exams from before aren't added afterwards. M10
adds moving into a room, moving out and having to move because the rent
couldn't be paid; later milestones add more.

## A place to live (M10)

Choices behind these rules: D-044. Tuning: `shared/src/life/config.ts`
(`ROOM_TYPES`, `FURNITURE`, `HOUSING_CONFIG`); layouts:
`shared/src/homes.ts`; rules: `shared/src/life/housing.ts`. Rooms, prices
and furniture are fictional.

**Renting.** Tap the **Student housing** door on the south side of the
square. Without a room it offers **Rent a room…**: a dialog lists the three
rooms with their weekly rent (box room €25, single room €45, studio €80;
bigger rooms have more spots for furniture). The first week is paid at
once, through the ledger, and your character goes straight in. With a room,
the door offers **Go home**, **Change room…** (moving: the new room's first
week is paid now and your furniture goes into storage) and **Move out…**
(asks first; this week's rent isn't paid back; furniture into storage). One
room at a time.

**Your home is private.** It is a room of its own that only you can enter:
others see you go in through the door and leave the square, and nobody
else ever sees inside or what is in it. If you leave the game at home, you
come back at home.

**Rent.** Rent weeks run Monday to Sunday (Day 1 is a Monday). Each Monday
the week's rent is taken from your money. It is only ever charged for the
week you are in: weeks you spend away from the game aren't charged
afterwards. If the money isn't there (there is never debt, D-023):
1. a notice and a *Worried about rent* mood (−6 for 12 game hours); the
   character panel shows the deadline;
2. the rent is taken as soon as you have it (a wage, the allowance);
3. after **12 game hours** (72 real minutes) still unpaid, you move to the
   dearest cheaper room whose first week you can pay now (Q9), with a *Had
   to move out* mood (−10) and a story entry; furniture goes into storage.
   If no cheaper room is affordable, you have to leave and have no home
   until you rent again. If you were at home, you find yourself in the new
   room, or in front of the housing.

**Sleeping.** Tap the bed → **Sleep**: 3 real minutes (30 game minutes),
lying in bed. The room's own bed gives +50 energy and +15 comfort; a
sprung bed +65/+25, a memory-foam bed +80/+35. Waking early (moving,
Escape) keeps what you slept. A full sleep gives *Slept well* (+6).
Being offline still restores energy as before (D-022).

**Comfort** (the approved Q7) falls slowly (−3 a game hour) and rises while
sitting: +4 on benches and desk chairs, more on your own seats at home
(wooden chair +8, beanbag +14, armchair +22), and with sleep. Low comfort
lowers mood like any need ("Uncomfortable").

**Furnishing.** At home, your own menu (tap yourself) and the character
panel offer **Furnish your room**. Every room has fixed spots: a bed, one
or two seats, one to three decorations. For each spot the panel lists what
you can do: buy a piece from the catalogue (the price is the server's,
charged through the ledger, once per request), place one from your
storage, or put yours away. Each spot takes one piece of its kind; the
room's own bed stands in the bed spot until you place yours. Catalogue:
sprung bed €60, memory-foam bed €140, wooden chair €15, beanbag €35,
armchair €55, potted plant €12, floor lamp €20 (glows at night), bookshelf
€35. A character can own up to 30 pieces. Furniture is drawn in the room
as soon as the server confirms; you can sit on seats you place.

**Cosiness.** Pieces add cosiness (decorations and comfy seats 1–2 each).
A home with cosiness 3 or more is **cosy**: coming home and waking up
there give *Cosy home* (+6).

**Not built in M10:** shared flats and roommates, visitors, free placement
and rotation, kitchens and cooking, showers, bills, selling furniture,
other buildings' flats (the residences).

## Locals: non-player characters (M11)

Choices behind these rules: D-045. Data and rules: `shared/src/npcs.ts`;
tuning: `NPC_CONFIG` (`shared/src/config.ts`). Names and lines are
fictional; every NPC is an adult.

**Who.** Four locals: **Giulia**, the barista at the café kiosk, and three
students, **Marco**, **Sofia** and **Luca**. Each has a gold name tag with
their role ("Barista", "Student") and is never counted as a player.

**Their days** follow the shared game clock (Day 1 is a Monday):
- Giulia works shifts behind the kiosk (06:45–20:30 on weekdays, with a
  lunch break at a café table 13:00–13:30; 08:00–19:00 at weekends). She
  works like a hired player, at one of the two staff spots, unpaid.
- The students arrive in the morning, sit on the square, go into the
  university hall's lecture room at lecture time and study at their desk,
  have lunch at a café table, study in the library's reading room in the
  afternoon, and sketch or sit on the square in the evening; at weekends
  they spend a few hours on the square (and Sofia in the library).
- Outside their hours they are away: they arrive from a closed street at
  the square's edge and leave the same way.

**They share the world fairly.** They walk, sit and use doors with the same
rules as players and hold a seat while using it, so no two characters ever
share one. They only use their own places (benches 3–5, café tables 2–3,
the back lecture desk, the second reading table, the kiosk's staff spots)
and never the ones players need most. They take a seat only while at least
two seats stay free in that room, and a door or the kiosk only while
another spot there stays free.

**Talking to them.** Tap an NPC → *Greet*: you get the usual greeting
effect (social, mood), and they answer with a line that fits what they are
doing ("Ciao! The espresso's fresh."). If they are free they turn and wave.
They can't be chatted with, and have no card, friendship, block or report.

**Not built in M11:** NPCs with needs, money or memories; friendships with
NPCs; more roles (a librarian, a lecturer); NPCs reacting to the time of
day beyond their schedule, to crowds or to rain.

## Indoor rooms (M7c)

Every building gets a room for each of its uses, when that use arrives
(D-038, D-039). Tap a building's door and choose **Go in**: your character
walks to the door and, after a short fade, stands just inside it. Inside
you meet only the players in the same room, and they only see you; the
square carries on without you. The room's door says **Go out to the
square** and puts you in front of the building. If you leave the game
inside, you come back inside. Rooms are larger inside than the buildings
look from outside, and the walls and door on the camera's side are cut away
so you always see the room.

| Building | Room | Use | Status |
| --- | --- | --- | --- |
| University hall | Lecture room | Rows of desks facing a blackboard and lectern: study and sit; the course's lectures and exam (M8) | **Built (M7c, lectures M8)** |
| Library | Reading room | Shelves and two long reading tables: study and sit | **Built (M7c)** |
| Shops | A shop interior | A second workplace | Proposed (later milestone) |
| Residences and bookshop | Bookshop; flats | Books (later); more homes (later) | Proposed |
| Student housing | Your own room (one private room per tenant, three sizes) | Homes (M10): rent, sleep, comfort, furniture, private | **Built (M10)** |

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
