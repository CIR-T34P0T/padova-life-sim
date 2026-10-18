# Game design

Summary of the product owner's vision (full brief in the claude.ai Project).
This file records design intent; implementation status is in the README.

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
   *Since M4:* a saved profile with name, age category and appearance (two body
   presets, 8 skin tones, 3 hair styles, 8 hair colours, 6 eye colours, 6
   outfits), drawn by placeholder avatars. Player characters are university-age
   adults (D-019); non-adult categories exist in the data model for future NPCs.
6. **Housing** — dorms, shared flats, roommates, furnishing with a controlled catalogue first.
7. **Emergent stories** — meaningful events are recorded and influence the future.

## World

Start with one compact, dense district and expand by connected districts.
Real places are stylised; fictional places are clearly marked as such in data.
The current greybox piazza is a placeholder test space, not a real location.

## Interaction model (Sims-inspired, original UI)

- The world is the main interface: click or tap a character, object or place
  to get a contextual menu of the actions valid right now.
- Choosing an action validates it on the server, walks the character to the
  interaction point, plays it, updates state and shows the result.
- Desktop: mouse to select, keyboard to move, mouse to orbit the camera.
- Mobile: tap to select, optional joystick, gestures for the camera, large touch
  targets, landscape preferred.
- Reference screenshots supplied: a radial menu around the target (desktop
  life-sim) and a card list with costs/durations (mobile life-sim).
- **Implemented in M3** with an original look: terracotta pill options fanned
  above the target on desktop; a bottom sheet with large buttons on touch.
  Objects so far: benches (sit, stand) and study desks (sit, study). Players:
  greet. Only currently valid actions are shown; the server re-checks them.
- **Added in M5:** benches also offer *Sketch*; the café counter sells food
  and drinks (with prices in the menu); the fountain offers *Wash up*.
  Clicking yourself opens *Character* (needs, mood, skills, money).

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

Planned unlocks (not built): academic level gates exam preparation,
communication helps job interviews, cooking unlocks home recipes, fitness
unlocks running.

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
  day while playing (no back pay). Jobs come in M7.
- Expenses: café purchases. The café (a placeholder outdoor bar counter in
  the open piazza, east of where players arrive) sells **Espresso €1.50** (+15 energy, +5 fun), **Cornetto €1.80**
  (+20 hunger, +5 fun) and **Panino €4.50** (+45 hunger, +5 energy).
- Food is eaten straight away after paying; there is no inventory yet. If the
  order is abandoned while the payment is still being processed, it is refunded.

### First complete loop (M5 target)

Enter the world → open the character panel → walk to the café → buy a panino
(server transaction) → eat it (hunger rises) → study at a desk (academic
skill rises) → see the changes in the panel → reload and find needs, skills,
money and mood events as they were.

## Open design questions

1. ~~**Time in a shared world.**~~ Decided above (D-021, D-022); sleep and
   schedules are designed with housing and university timetables.
2. **First real district** — e.g. around the historic university/market squares,
   or the Portello area. To decide before building real geometry.
3. **Character customisation depth vs art budget** — decided after the VRM spike in M6.
