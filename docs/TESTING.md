# Testing

## Commands

| Command | Scope | Needs |
| --- | --- | --- |
| `npm run typecheck` | All packages, strict TypeScript | — |
| `npm test` | `shared/test` unit tests, `client/test` (the district art against the collision layout, in Node) and `server/test` integration tests | — (starts its own servers on ports 2611–2650, each with an in-memory PGlite database) |
| `TEST_DATABASE_URL=… npm test` | The same, plus every database test repeated on a real PostgreSQL server | A PostgreSQL user allowed to create databases; each test creates and drops a throwaway database |
| `npm run check` | Both of the above | — |
| `npm run test:e2e` | Playwright, real server + real client + several browsers | A Chromium (`npx playwright install chromium`, or `CHROMIUM_PATH`). The test server uses an in-memory database (never `.data/`) and a raised guest-creation limit |
| `E2E_DATABASE_URL=… npm run test:e2e` | The browser tests with the server on a real PostgreSQL | An empty database the tests may write to |

## What is covered

**Unit (13 tests, `shared/test/rules.test.ts`):** spawn points walkable;
obstacles and out-of-bounds blocked; no tunnelling; wall sliding; pathfinding
around obstacles with every segment walkable; blocked/out-of-bounds targets
rejected; path following at walking speed; message validation; direction
clamping; display-name sanitising.

**Server integration (9 tests, `server/test/plaza.test.ts`)** — real WebSocket
clients via the Colyseus SDK, nothing mocked: two players see each other;
guest naming; move replicated to another client; move into an obstacle
rejected without movement; forged `position`/`setState` messages ignored;
oversized direction capped to walking speed; malformed/out-of-bounds moves
rejected; leaving removes the player for others; a simulated network drop
reconnects to the same session and the player can still move.

**Interaction rules (18 tests, `shared/test/interactions.test.ts`):** every
interactable has a matching obstacle and unique seat ids; every approach point
is walkable and reachable from spawn; menu contents for free, full and
occupied benches and desks, the café counter and the fountain (standing spots
taken → `busy`); players never offer actions to themselves or when
offline; validation of wrong actions, full seats, distance, self/offline/
unknown targets and greeting cooldown; nearest-free-seat choice; walkable
greeting spot next to a wall; a walled-in bench is unreachable; `interact`
payload validation, including café item ids and purchase request ids.

**Life rules (25 tests, `shared/test/life.test.ts`, M5):** clock — starts at
08:00 Day 1, 10 game minutes per real minute, depends only on real time and
scale, rejects bad `GAME_TIME_SCALE` values; needs — documented rates, stay in
0–100, **nothing empties in under 90 real minutes of ordinary play**, walking
drains and sitting restores energy, trait effects, offline catch-up capped at
8 game hours at half rate with a floor of 35, "too tired" below 10 energy,
corrupt stored values repaired; mood — from needs (lows hurt twice as much as
highs help), recent events with reasons and expiry, no stacking, thresholds;
skills — XP curve (100, 300, 600 … 5500, max level 10), trait and mood
multipliers, cleaning stored XP; traits — at most two distinct known ids;
money — whole cents, euro formatting, no spending beyond the balance, **the
daily allowance covers at least half a day of food** (a whole day until M7
halved it; with one shift it still does, `shared/test/work.test.ts`), safe
request ids; action effects —
what each action and café item does, proportional shares when stopped early,
halved social gain when grubby.

**Interaction integration (14 tests, `server/test/interactions.test.ts`)** —
real servers with faster tuning (walk 9 m/s, study 1.2 s, greet 0.5 s):
walk-sit lifecycle with seat reservation visible to others and exact seated
position; stand up frees the seat; two players racing for one desk seat (one
wins, the other gets `no_free_seat`); third player refused on a full bench;
invalid requests (unknown target, wrong action, stand when not seated, self,
unknown player, malformed); cancel while walking stops, frees the seat and
lets another player take it; walking elsewhere interrupts; study timed on the
server and forged completion messages ignored; seat kept through a drop and
freed on leave; greeting walks over, notifies the target and replicates the
gesture, then refuses a repeat (`too_soon`); greeting fails with
`target_left` when the target leaves; greeting a seated player leaves them
seated; `too_far` with a 25 m limit; `unreachable` in a walled world.

**Profile rules (`shared/test/profile.test.ts`):** adult vs non-adult
categories; valid characters accepted with names cleaned; unexpected fields
such as a client-chosen id or owner ignored; non-adult player characters
refused; malformed input rejected; invalid appearance refused naming the
field (`hair.colour`); version upgrades run one step at a time; **an M5
(version 2) flat appearance upgrades to a config that keeps its look**, and
corrupt version-2 data upgrades to a valid config; newer, missing-step and
invalid versions refused.

**Appearance rules (`shared/test/appearance.test.ts`, M6):** catalogue ids
unique with labels and valid colours; every hair texture from straight to
tightly coiled and the protective styles exist; **no option, field or preset
mentions ethnicity, nationality or heritage**; skin tones get steadily deeper
along the slider with no jumps, hit the nine named stops exactly, and
undertones shift hue without changing depth; bad input never throws; strict
validation names the bad field (version, missing section, unknown id, slider
out of range, NaN, wrong type) and drops unknown fields; stored data is
repaired (sliders clamped, bad ids replaced and listed); 200 random looks
round-trip through the replicated string under 2 KB; equal looks encode to
equal strings; unreadable looks decode to the default; look codes round-trip
and tampered codes are refused; presets are valid, unique and span the skin
range, every hair texture, both frames and five or more builds; the
randomiser is deterministic, always valid, **can produce every option of
every field**, and randomising one section leaves the others unchanged;
visibility rules (full outfit hides top and bottom, headwrap/headscarf hide
hair, hats keep long hair below them, hair clips need hair); M4 options all
map to valid configs in the old skin-tone order.

**Boundaries (`server/test/boundaries.test.ts`, M6, widened in the
2026-10-20 audit):** no life-simulation rule mentions appearance (looks have
no gameplay effect); neither do the server's life system
(`server/src/life/`), the interaction system or the shared interaction
rules; and the appearance schema has no ethnicity, race, heritage or
nationality field. Since M7b: no file in `shared/src` or `server/src`
imports the client or names the day/night light, so no gameplay rule can
depend on it.

**Day and night rules (12 tests, `client/test/daylight.test.ts`, M7b):**
checked at every minute of a game day: the light depends only on the minute
of the day (the same on any day, for negative and fractional minutes); the
phases (night, dawn, day, dusk); **no jumps from one game minute to the
next**, midnight included (colours, strengths, haze range, and the light
direction turning less than 4° per game minute); the key table is sorted;
the sun rises in the east, crosses the south at its highest at midday and
sets in the west; the light always comes from at least 14° above the
horizon and is a unit vector; moonlight from the moon's direction at night;
16:00 equals the world art pass's afternoon; lamps on whenever the sun is
down and off in full daylight; stars only at night; the ambient light never
below 55 % of midday's and characters lifted in the dark; the sky darker at
night.

**Client ↔ server state contract (`client/test/contract.test.ts`, audit
2026-10-20):** the client's `ReplicatedPlayer` interface has exactly the
fields of the server's `PlayerState` schema (the compiler can't check this,
because the client reads Colyseus state through its own interface).

**Life simulation through the real room (15 tests, `server/test/life.test.ts`,
M5)** — real WebSocket clients and servers with faster tuning: entering with
starting needs, money and empty skills, with the clock from the server; **the
complete loop** (buy a panino, eat it, study, see every change in `life`
messages, leave and come back to the same values, with the ledger checked in
the database; a client-sent price is ignored); a repeated purchase request
charged and served once (`duplicate_request`); a burst of orders charges only
the one that reaches the counter; unknown and missing items refused; too tired
to study until an espresso helps; greeting lifts both players' social need and
the greeter's communication; sketching (creativity, fun) and washing
(hygiene); an Organised character learns 15–25 % more from the same session;
**life data private** (other players never receive it); insufficient funds
refused before walking with nothing charged; an order abandoned during
payment is refunded (slowed database); needs follow the server clock (scale
600), not client frames; offline catch-up capped; daily allowance once per
game day.

**Life database (11 tests, `server/test/lifeDatabase.test.ts`, M5)** — the
migration gives pre-M5 characters needs, a wallet and a starting allowance;
rollback leaves profiles intact; creation writes traits, needs, wallet and
ledger in one go; save/load only for the owner; need and XP limits enforced by
the database itself; a purchase is charged once and a repeated request returns
the same result; insufficient funds writes nothing; the balance can't go
negative even by a direct UPDATE; another account's money can't be moved;
**of two simultaneous purchases that the balance covers once, exactly one
succeeds**; refunds and allowances once per key. Runs on PGlite and, with
`TEST_DATABASE_URL`, on PostgreSQL too.

**Work rules (15 tests, `shared/test/work.test.ts`, M7):** the café job has
two grades with whole-cent wages and the counter as workplace; the barista
grade from communication level 2; open 06:00–23:00 every day; time-of-day
formatting; a shift is allowed for an employee while open, under the daily
limit and not too tired, and refused with the reason the player sees
otherwise; yesterday's shifts don't count today; the shift effect (90 s,
energy −8, fun −4, communication only on completion, *Good day's work*);
**the halved allowance plus one shift still buys a day of the cheapest
food**; the counter has two customer spots in front and two staff spots
behind, all walkable and reachable; menus offer *Ask about work* without a
job and a shift to employees; customers and staff keep to their own spots;
server validation of work requests; the new actions accepted in `interact`
messages; the clock offset and its validation.

**Work through the real room (13 tests, `server/test/work.test.ts`, M7)** —
real servers, databases and WebSocket clients with a 1.2 s shift and the
clock set to 10:00 game time: hired at the counter, a shift at a staff spot
behind it, the wage paid once (ledger and `work_shifts` checked in the
database), communication XP and energy change; **nothing paid** for a shift
cancelled, walked away from, ended by leaving, or cut by a network drop (the
job survives the drop and the next shift is paid); four shifts a game day
and the fifth refused; hiring someone already employed and shifts for
someone without the job refused; too tired refused; quitting mid-shift
pays nothing and removes the job, asking again hires again, repeated quit
messages change nothing; **the barista wage** (€8, "Wage: Barista") for a
character at communication level 2; **job and pay private** (another player
never receives them; the replicated player has no job, grade or pay fields);
the allowance setting is the halved €7.50 (the amount actually paid is
checked by the life tests); two employees on the two staff spots, a
third told `busy`, a customer still served meanwhile; hiring at night but
shifts refused while closed; job, today's shifts and wage kept across a
server restart on the same database.

**Areas and indoor rooms (15 tests, `shared/test/areas.test.ts`, M7c):** the
square and the two rooms exist and unknown ids (including `toString`) are
not areas; every door links to a door in another area that leads straight
back (two pairs); arriving puts you on walkable ground in front of the
linked door, facing away; object and seat ids are unique across all areas;
per room: a floor inside its walls with every object on or around it, no
overlapping boxes, closed (nothing walkable outside the walls), every seat
and the way out reachable from the arrival point, desks offer study and sit
and the door offers *Go out to the square* (busy when both spots are
taken); the square's doors offer *Go in* and are reachable from the spawn.

**Indoor rooms through the real room (6 tests, `server/test/areas.test.ts`,
M7c)** — real servers, databases and WebSocket clients: going in through the
hall's door puts you inside in front of the room's door, and **players in
different areas stop receiving each other** (then see each other again when
both are inside); studying at a lecture desk inside works; going back out
puts you in front of the hall's door, and two doors give under 2 fitness XP
(the jump isn't walking); the library's door leads to the reading room and
back; greeting a player, or using an object, in another area is refused
(`unknown_target`); **the room is saved** (the stored row checked; coming
back puts you inside at the same spot; an unknown saved area puts you on the
square); a dropped player stays in the room and both players see each other
again after the reconnection.

**University rules (18 tests, `shared/test/university.test.ts`, M8):** the
week starts on a Monday and repeats every seven game days; the course is
fictional (no real university's name), held in an existing indoor room that
has lecture desks (and only there); lectures fit in the day, don't overlap,
outlast late entry, and someone joining at the last moment still finishes in
time; the exam fits in its sitting; weights add up to 1; eight lectures on
weekdays with a lunch break and none at weekends; joining from the start
until late entry closes; the next lecture across lunch and the weekend;
sittings on Wednesdays and Saturdays, 09:00–19:00, and the next one; real
waits at the clock's speed; refusals (not enrolled, passed, outside late
entry, the same lecture twice, too tired; one exam per sitting); grades (12
unprepared, 30 cum laude prepared, the weights, never worse with more
preparation, the Italian scale); the notice board offers enrolment and
refuses it once enrolled or passed; lecture desks offer the lecture and the
exam only to enrolled students, other desks never; seated in a lecture or
the exam, only *Stand up*.

**University through the real room (8 tests, `server/test/university.test.ts`,
M8)** — real servers, databases and WebSocket clients, three servers with
their clocks set to a Monday at 09:01, a Wednesday at 13:01, and a **fast
clock** (1 real second = 10 game minutes): enrolling at the notice board
once (refused twice), the course in the owner's `life` only (no course data
in the shared state or another player's messages), the enrolment row
stored; a lecture desk refuses the lecture before enrolling; attending the
lecture on now counts it once with its timetable key, gives academic XP and
*Interesting lecture*, and the same lecture is refused again; no exam on a
Monday; studying counts for the course; a reload keeps attendance and
study; a lecture left early doesn't count and can still be attended;
refused outside its slot; an unprepared exam fails gently (12, *Failed an
exam*, course still open, the same sitting refused, the stored row); a
prepared student passes with 27 from the stored rows, *Passed an exam*,
then the desk and the notice board refuse (*course passed*), still passed
after a reload; on the fast clock, **a lecture accepted at :12 is refused
at the desk when late entry closed during the walk**, and lectures in
consecutive hours count separately.

**University database (9 tests per backend, `server/test/universityDatabase.test.ts`,
M8)** — migration 0006 down and up with no enrolments, **rollback refused,
changing nothing, once someone is enrolled**; enrol once, never another
account's character; each lecture counted once (including two recorded at
the same moment), only while enrolled; study sessions only while enrolled,
owner only; an unprepared exam graded 12 and kept open, the same result
when repeated; a grade from 8 stored lectures, 6 sessions and level 2 (29),
which closes the course (no more lectures, study or exams; no
re-enrolment); a retake at a later sitting with the progress made since
(18, passed); the database refusing inconsistent rows (passed without a
grade, a passing status below 18, attendance without an enrolment); a
character's university rows deleted with it.

**University wording (6 tests, `client/test/university.test.ts`, M8)** — the
timetable and sittings in one line each; today / tomorrow / weekday times;
real waits; what a lecture desk says in each state (on now with late entry,
next lecture, attended, too tired; expected grade, next sitting, today's
result, passed); the expected grade.

**Relationships and safety rules (14 tests, `shared/test/relationships.test.ts`,
M9):** levels from Acquaintance to Close friend in rising order; reaching
Friend detected once; every moment's gain up to its daily cap, never above
100; a full game day of everything reaches Friend, not Good friend; the pair
order; moment and story kinds; *Chat* offered with *Greet*, with its own
longer cooldown; the chat's effects and mood events for both players; the
profile, block, unblock and report parsers (session ids, UUIDs, known
reasons, notes cleaned and limited); 90-day retention and the limits set.

**Relationships and safety through the real room (10 tests, `server/test/social.test.ts`,
M9)** — real servers, databases and WebSocket clients: a chat lifts both
players (needs and mood events), tells the other, and starts a relationship
both see on their cards (a greeting adds to it), while a third player
receives nothing and has none; the chat's 30 s cooldown; a chat broken off
when the other walks away; studying at the same table counted once for the
pair; attending the same lecture counted; reaching Friend tells both with a
level-up, writes both stories and gives both *New friend*; **a block refuses
greetings and chats both ways with `not_reachable`, ends a chat in
progress**, shows only in the blocker's list (the blocked player's stays
empty), can be lifted only by the blocker, covers the account and is back
when the blocker returns; **a report is stored with minimal context**, also
blocks, counts once a day, ignores bad reasons, and the reported player
learns nothing; players in another room can't be viewed, blocked or
reported; the story log records the job, the first shift (once) and
enrolling, only for the owner, and keeps them after a reload. The exam
result's story event is checked in `server/test/university.test.ts`.

**Relationships and safety database (10 tests per backend, `server/test/socialDatabase.test.ts`,
M9)** — migration 0007 down and up when empty, **rollback refused, changing
nothing, once there is social data**; one relationship per pair whoever
starts; daily caps per kind with a new day starting again; only the newest
20 moments kept and the score capped at 100; moments refused for mismatched
owners or oneself; blocks (once, listed with the name, lifted only by the
blocker; a mismatched owner pair refused even when the other pair is
valid); reports (once a day per reported account, five an hour, the
database refusing unknown reasons and long notes); **reports older than 90
days deleted, younger ones kept**; story events once per key, newest first,
owner only, deleted with the character; relationships deleted with a
character while the other side's account block stays.

**Home rules (20 tests, `shared/test/homes.test.ts`, M10):** for each room
type, every catalogue piece of a spot's kind fits inside that spot and the
room; the room has a bed, a desk and a door, seats offer *Sit*, the bed
*Sleep*, the door leads back to the housing; the room's own bed stands until
you place yours, and what may go where; bigger rooms cost more and have
more spots; home area ids never clash with fixed areas; the housing's door
exists, can be reached from the square's spawn and offers renting without a
home, going home, changing room and moving out with one; rent weeks from
Monday; when rent is charged, overdue or moves you; the cheaper room chosen
(or none); comfort while sitting (better seats faster); better beds sleep
better; cosiness; the furnishing message parsers.

**Homes through the real room and on a hand-moved clock (6 tests,
`server/test/housing.test.ts`, M10)** — the housing system with the real
repository on PGlite and a game clock the test moves: renting charges the
first week, makes the home an area and tells only its tenant (a repeat
changes nothing, the same room is refused); rent taken once each Monday;
**unpaid rent gives a notice and a worry, and is paid as soon as the money
arrives in the grace period**; **after the grace period a move to the
dearest affordable cheaper room with the tenant and their furniture (into
storage), a week later out, never into debt**; furnishing refused away from
home, in the wrong spot or for the room's own bed. Through the real room
and WebSocket clients: the housing door refuses *Go home* without a home and
an unknown room; renting goes straight in and **the other player stops
seeing you**; sleeping raises energy, gives *Slept well* and stands you up;
home seats never reach the shared seat map; buying a beanbag is charged
once per request (a repeat answers `duplicate`), a wrong spot is refused,
and another player can't furnish; sitting on it, putting it away (stands
you up) and placing it again; **a reload brings you back home with the same
room and furniture**; going out (seen again) and moving out keep the
furniture in storage.

**Homes database (15 tests per backend, `server/test/housingDatabase.test.ts`,
M10)** — migration 0008 down and up when empty, **rollback refused, changing
nothing, once anyone has a home**; comfort 70 for every character; renting
charges the first week once per request, **also when the same request
arrives twice at once**; the room you have and a room you can't afford
refused, changing nothing; changing room keeps the history and stores the
furniture; another account can't read, rent for, furnish or move out
someone's character; weekly rent once per home and week, the overdue start
kept on repeats; never into debt; the move to a cheaper room (furniture into
storage) only after the grace period, or out when nothing is affordable;
nobody moved whose rent can be paid now or was paid meanwhile; furniture
bought once per request into a free spot, a taken spot and a full storage
refused; two purchases for one spot at once (one placed, the other neither
placed nor charged); putting away and placing scoped to the owner and the
current home.

**Work database (9 tests, `server/test/workDatabase.test.ts`, M7)** —
migration 0005 down and up again with no job data, the ledger accepting
`wage` only while it is applied; **rollback refused, changing nothing,
while a character has a job or was ever paid a wage**; hire once, quit, and
never touch another account's character; a shift paid once however often
it is recorded; the daily limit enforced in the database per game day; no
pay for a character without the job or another account's character;
**a shift recorded twice at the same moment is paid once, and of two shifts
racing for the last free place only one passes**; database CHECKs refuse
wages and shift rows that break the rules; job and shift history deleted
with the character. Runs on PGlite and, with `TEST_DATABASE_URL`, on
PostgreSQL too.

**Database (`server/test/database.test.ts`)** — on in-memory PGlite and, with
`TEST_DATABASE_URL`, on a real PostgreSQL server: migration files numbered
without gaps; statement splitting; passwords never printed; fresh database
migrates idempotently; rollback and re-apply; guest + character created
atomically and only the token hash stored; account found only with the exact
token; appearance and position saved and loaded, **with the M4 columns
holding the closest old look**; reads/writes refused for a non-owning
account; **several characters per account up to the limit, also when two
are created at the same time (exactly one of the racing pair fits)**; the
list comes back most recently played first and never includes another
account's characters; **deleting a character removes its rows in every
per-character table, only for its owner, and keeps the account, token and
other characters**; rolling back migration 0004 works with one character
per account and fails without changing anything with two; age-category and version constraints
enforced by the database itself; the appearance document must be a JSON
object under 4 KB; **rolling back migration 0003 leaves a version-2
character with the closest old look, and migrating again loads it**; a
failed creation rolls back completely; configuration chooses the backend and
resolves folders correctly.

**Profiles through the real room (`server/test/profiles.test.ts`)** — real
WebSocket clients: a first visit is anonymous (an empty title screen) and
stores nothing; creating a character issues a guest token once and others
see the appearance; invalid characters refused and the visitor stays
anonymous; no creating or entering another character while in the world
(`in_world`); a later visit shows the character on the title screen (look,
last played, no life data) without placing it in the world, and entering
brings back the same character at its saved position; unknown or
malformed tokens refused (4401); appearance changes saved, replicated (the
decoded `look` equals the saved config) and kept; invalid appearance refused
naming the field (`skin.tone`, `body.height`, `v`); one player can never change another's profile
(forged ids in the payload are ignored); the newest session **in the world**
wins and the older one is saved and closed (4100), while a second window
that only opens the title screen disconnects nobody; a network drop keeps the character;
**a dropped player who never returns is removed for everyone when the 20 s
reconnection window ends, with the position saved, and the same guest token
then plays the character exactly once** (audit 2026-10-20); a seated
character is saved where it would stand up; retired appearance options are
repaired on load (only the broken fields fall back, one readable notice) and
saved; **an M5 character (version 2, flat columns, no document) is upgraded
on load, keeps its look, is saved as version 3 and replicates the new look**;
a newer-version profile loads read-only and is
never overwritten; guest creations are limited per IP; autosave writes online
players' positions; **leaving and immediately rejoining loads the position the
old session was still saving** (regression test with deliberately slowed saves).

**Creator categories and title screen requests (6 tests,
`shared/test/categories.test.ts`):** every appearance field belongs to
exactly one of the six creator categories; randomising one category never
touches another (12 seeds each, always valid); resetting one category
restores only it; the review summary describes every preset in plain words
and says when hair is covered; character ids must be UUIDs; deleting needs a
typed name, compared without case or extra spaces.

**District layout (8 tests, `shared/test/world.test.ts`, world art pass):**
every obstacle has a unique id, a real size, a label and a place inside the
square; no two solid boxes overlap (they may touch); the eight chairs belong
to existing interactables and every sitter sits on a chair; **no walkable
pocket is cut off** from where players arrive (flood fill over the
navigation grid); the university hall's porch is walkable and reachable;
the portico can be walked end to end behind its columns and entered
between them; every street is walkable up to its planters and blocked
there; the arrival points see each other and a short route leads to the
fountain.

**District art against collision (10 tests, `client/test/world.test.ts`,
world art pass)** — the real district code built in Node at both detail
levels, checked vertex by vertex: **nothing solid below head height (2.2 m)
is drawn outside the box it belongs to** (6 cm tolerance; a building split
around its porch counts as one); decoration below head height is flat,
inside some box, or outside the square; **every collision box is visibly
filled** (85 % of its width and depth, 60 % for round lamps and tables), so
there are no invisible walls; every clickable object and chair has its own
highlightable mesh and every building has fade volumes; triangle budgets
(220 000 high, 110 000 low). Since M7b (5 more tests): every piece carries a
glow strength per vertex at both detail levels (so batches still merge);
lanterns (at least one per street lamp), more than 40 lit windows, shop
windows and the far streets' windows glow, the ground and trees never do;
lit windows are chosen by position alone, about 40 % of them.

**Title screen and several lives through the real room (12 tests,
`server/test/lobby.test.ts`):** create lives from the title screen up to
three (same guest token), the fourth refused, any of them can be entered and
others see the right name and look; each life keeps its own needs and money;
back to the title and in again at the same spot, and the character still
moves; pressing Continue twice enters once (`busy`/`in_world`); **pressing
Begin twice creates one character and one guest profile**, on a first visit
and when adding a life (audit 2026-10-20); **gameplay messages from a
session at the title screen (move, stop, interact, buy, cancel) are
ignored**: nothing appears, is reserved, answered or charged, and the
session still enters normally (audit 2026-10-20); a network
drop at the title screen keeps the session; **changing the look from the
title screen and in the world leaves needs, wallet, ledger, skills, traits
and position untouched** (database rows compared); deleting only from the
title screen, with the name typed, never while the character is played in
another window, removing its rows; another profile can't see, play, change
or delete a character (`character_not_found`); malformed title-screen
requests refused; a window entering the world takes over from a window
playing another life of the same profile (4100).

**End to end, the whole player journey (`e2e/journey.spec.ts`, audit
2026-10-20)** — two clients, one run: launch; create a customised character
with a trait; a second player sees exactly that look; walk (the other player
sees the arrival); wash at the fountain (hygiene up, "Freshened up" mood,
the other player sees "washing") and sketch on a bench (creativity XP, seen
as "sketching"); walk away; reload → Continue: same position, look, skills,
traits, needs (within drift), money and mood event; a simulated network drop
reconnects into the same character with no duplicate; an appearance change
reaches the other player and touches nothing else; closing the browser
removes the character for the other player, and returning with the same
guest identity in a new browser context brings back one character with the
new look and the same state, and the title screen still lists one life.
Throughout, no page error, failed request or HTTP error (missing file) is
allowed on any client. Money checks allow for a daily allowance paid if a
game day starts mid-test.

**End to end, the district (`e2e/world.spec.ts`, world art pass)** — two
players, one at full detail (`?quality=high`) and one at the light level:
the district is built at both levels within its triangle budgets (the
build time, meshes, triangles and draw calls are logged as `[world perf]`);
on arrival the shops beside the camera are faded and ground seen through
them can be tapped (D-035); from beside the café kiosk, tapping a plane tree's trunk is refused with
"Plane tree: you can't walk there."; a café table offers Study and Sit,
the character walks over and sits on one of its chairs, and the other
player sees the seat taken; walking into the portico fades the houses above
(`building:portico`), the walkway is walked end to end behind the columns,
and stepping well away brings them back (near the portico the
camera's 3.5 m rule keeps them faded). Every walk target is checked to be on
screen and not hidden before it is tapped, and the camera is left to
settle after each walk.

**End to end, title screen (`e2e/title-flow.spec.ts`)** — the title menu
(five items, Continue disabled without a life, the not-affiliated notice);
Settings stored in the browser and applied (reduced motion, camera speed,
hidden controls reminder, graphics "Performance" taking effect after a
reload); Credits; New life: a name is required, at most two traits, going
back from the look keeps name and look, the review lists name, traits and
one line per category, "Change" jumps back to that category, Begin enters
the world with the chosen look and traits. Returning players: Continue
names the last played character with a portrait; a second life from the
character list; most recently played first; editing from the title screen
with Cancel asking before discarding (nothing saved), then saving through
the review ("Changes to save: Hair."); deleting with the typed name; another
player sees the saved look. In the world: Cancel changes nothing; Save
changes the look but not money, ledger, skills or traits (needs within
normal drift); **a simulated network drop reconnects into the same
character with the same look**; a reload returns through Continue. Phone
(390×844 touch, then 844×390): every menu item, category tab and footer
button on screen, menu items at least 44 px tall, preview above the
categories, **one-finger drag turns and a two-finger pinch zooms the
preview**, creating and editing work by tapping, and the creator sits side
by side in landscape.

**End to end, character creator (`e2e/creator.spec.ts`, M6)** — in the real
creator with its live WebGL preview: **every hair style, every top and every
eye shape produces a different preview image** (canvas screenshots compared),
and a hair change rebuilds only the head while a top never rebuilds it;
choosing a headscarf then another hair style keeps the choice, labels it
"Covered by the headscarf", and the preview stays identical (it doesn't
pretend), until the headscarf comes off; a full outfit labels the top as
covered; presets apply and show thumbnails; undo/redo; randomise all;
reset one tab leaves the others; hold-to-compare shows the starting look;
look codes copy, apply and refuse invalid codes. Phone (390×844, touch):
preview above the controls, no sideways scrolling, tapping a preset and a
skin-tone stop, creating the character; the saved look matches. Four
browsers with diverse presets: every player sees every other player's exact
look; each character stays under 30 000 triangles and 14 meshes; a picture
of them together is saved to `test-results/m6-diverse-plaza.png`.

**Character lab (`client/lab.html`, manual)** — renders every preset, hair
style (front and back), hairline, facial hair, top, bottom, full outfit,
pattern, outerwear, shoes, headwear, glasses, skin-tone stop, undertone,
build, body and face slider extreme, and walk/seated/greeting poses, with
triangle counts and build times. Used for the visual checks in the results log.

**End to end, persistence (`e2e/persistence.spec.ts`)** — create a character
with chosen options, walk, reload: the title screen offers "Continue as
Giulia", and Continue brings back the same name, look, position and guest
token; edit the look via clicking yourself (review lists "Hair, Clothing"),
another player sees the change, still there after a reload; a second tab
only showing the title screen disconnects nobody, Continue there takes the
character over and the first tab shows "Playing in another window", with
only one copy in the world; an unrecognised saved token is discarded and
the title screen explains why.

**End to end, life simulation (`e2e/life.spec.ts`, M5)** — desktop, with the
game's real durations: create a character with a trait; click yourself →
Character opens a panel (≤ 30 % of the screen width) showing traits, mood,
current action, all needs, skills and money; with the panel still open, walk
to the café, buy a panino from the menu (prices shown), see €4.50 charged
exactly once in the panel and ledger, "Eating a panino", hunger rising; walk
to a desk and study, academic XP rising (15–31 XP for one session) and shown
in the panel; reload and get the same skills, money, purchase history and
needs back. Every click is checked to reach the 3D view, not the panel. Phone
(Pixel 7 emulation): the HUD chip doesn't overlap the connection pills and is
≥ 44 px tall; tap yourself → Character opens a bottom sheet under half the
screen height, hides the joystick, scrolls to the money section; closing
restores the joystick; the chip toggles the panel. Since M7 the café menu
also lists *Ask about work*.

**Indoor room art against collision (20 tests, `client/test/interiors.test.ts`,
M7c)** — five checks for each room at both detail levels: nothing solid below head height
outside its box, decoration only flat (the rug) or above head height, every
box visibly filled, every clickable object with its own mesh, every wall a
fade volume, every piece a glow strength, and a small triangle budget.

**End to end, indoor rooms (`e2e/interiors.spec.ts`, M7c)** — desktop with two
players: the hall's door shows "University hall" with *Go in*; going in draws
the lecture room ("Lecture room", an indoor scene); the two players stop
seeing each other ("1 player here"); a lecture desk inside offers Study and
studying works; the second player comes in and they see each other again; a
reload comes back inside, drawn from the first frame; the room's door leads
out in front of the hall ("Back on the square"). Phone (Pixel 7 emulation):
the door's sheet shows *Go in* at least 48 px tall; inside, tapping the
room's door and *Go out to the square* works by touch.

**End to end, university (`e2e/university.spec.ts`, M8)** — the suite's
clock starts on a Wednesday at 09:00 (playwright.config.ts). Desktop, with
the game's real durations: the clock chip shows "Wed"; the notice board
beside the hall offers *Enrol: Introduction to City Studies*; enrolling
works, with its note, and the panel's University section shows the course,
the timetable, "0 of 8" and an expected 12/30; in the lecture room a
lecture desk offers *Attend the lecture* (or greys it out with the next one
and the test waits for it); attending the whole lecture (2 real minutes)
counts it once, with its note, then the option is greyed out; the desk
shows *Sit the exam* with "Expected 13/30 · 3 min · open until 19:00";
sitting it (3 real minutes) fails gently (13/30, the course still open, its
note), then the option shows "Taken today: 13/30 · next sitting Sat 09:00"; the panel
shows "1 of 8" and the result, and a reload keeps both. Phone (Pixel 7
emulation): the clock chip shows the weekday; the notice board's sheet has
*Enrol* at least 48 px tall; enrolling by touch; the panel sheet's
University section shows attendance, the next lecture and the sittings.

**End to end, relationships and safety (`e2e/social.spec.ts`, M9)** —
desktop with two players: the player menu offers *Greet*, *Chat*, *Profile*,
*Block…*, *Report…*; a real 10-second chat shows "Chatting with Ben" and
tells Ben; both cards then show "Acquaintance", "5 of 100" and "Chatted";
blocking from the card asks first, then the card says Unblock and Ben's
chat attempt says "They can't be reached right now", and Ada's menu on Ben
offers only *Profile* and *Unblock* ("Blocked"); the character panel lists
Ben under Blocked players and *Unblock* lifts it; reporting needs a reason,
takes a note, and blocks. Phone (Pixel 7 emulation): the player sheet's
options at least 48 px tall, the card as a bottom sheet with Block and
Report at least 44 px, the report dialog's choices at least 44 px.

**NPC rules (11 tests, `shared/test/npcs.test.ts`, M11):** a few adults
with roles, known looks and unique ids, one barista; session ids that can't
be taken for players; blocks ordered, contiguous through the day, with
places and lines; every place exists in its area and offers its action, and
none is an object players need most (benches 1–2, study desks, café table
1, fountain, notice board, the front lecture desks, reading table 1); entry
points on open ground at the square's edge, reachable from the spawn; the
weekday and weekend timetables (away outside them, the same plan every
week); places in a fixed order for the hour, turning each hour; greeting
lines from the block, the same all day for one greeter; a seat only while
two stay free in the room, the kiosk and doors only while another spot
stays free; NPCs can be greeted, not chatted with.

**NPCs through the real room (8 tests, `server/test/npcs.test.ts`, M11)** —
real servers, databases and WebSocket clients, fast clocks: the barista
arrives from her street after 06:45, works shift after shift at a staff
spot, is replicated with her role (players have none), and leaves no
character row and no wage; greeting her gets a line (and the greeter's
social need rises), chat is refused; students walk through the hall's door
to their lecture desk and study there, two at one desk on different seats,
**while every seat is checked every 50 ms to have one holder only**, and a
player on the square doesn't receive them; at 14:00 they go to the
library's reading room; at 20:30 the barista stops, walks to her street and
leaves; **the tick time with every NPC active stays under the budget**; the
hooks never charge, pay, hire, enrol or record an NPC.

**End to end, NPCs (`e2e/npcs.spec.ts`, M11)** — desktop: Giulia is listed
as an NPC with her role, not as a player; the HUD says "1 player here"; her
gold name tag says "Barista"; her menu is "Giulia", "Barista · not a
player", *Greet*; greeting her shows her answer. Phone (Pixel 7 emulation):
her menu as a bottom sheet with a Greet button at least 48 px tall.

**Operations through the real room (7 tests, `server/test/operations.test.ts`,
M12)** — deleting a whole guest profile: a profile with two characters, a
second window at the title screen, a wrong word refused
(`confirm_mismatch`), "  Delete " accepted; both windows get
`profileDeleted` and an empty lobby; the account, credential, characters,
needs, wallet and ledger rows are gone; the old token is refused
(`ERROR_INVALID_GUEST_TOKEN`); a second deletion answers
`profile_not_found`. Refused in the world (`in_world`), while a character
is played in another window (`character_in_use`) and with a malformed
payload. On every test database backend: `deleteAccount` cascades to
story, blocks made and received, reports about the account, and keeps
reports it made with the reporter cleared. `/health` (200, then 503 with
the database made unreachable) and `/status` (aggregate fields only, no
names or ids). The log line formats. And a load-test finding: **a client at
the title screen receives nothing about the player map** while others
enter the world and move (before the fix it logged `"refId" not found`).

**End to end, your data (`e2e/privacy.spec.ts`, M12)** — desktop, one
browser profile with two windows: Settings has no *Your data* before a
profile exists; with a character being played in the first window, the
second window's *Delete my profile…* (at least 44 px) needs the word
*delete* (wrong word: button disabled), and is refused with "being played
in another window"; after the first window goes back to the title, it goes
through: both windows show "Profile deleted", the stored token is gone, the
title says "No saved life yet", and after a reload there are no characters,
no "couldn't find your profile" notice and no *Your data* section.

**Load test (`npm run loadtest`, M12, manual)** — not part of the suites:
bot players against a running server; results in the log below.

**End to end, a place to live (`e2e/home.spec.ts`, M10)** — desktop with two
players: the student housing's door (camera turned round) offers *Rent a
room…* "From €25.00 a week"; the dialog lists three rooms and needs a
choice; renting takes Ada in ("Welcome home") and out of Ben's view; the
character panel shows "Single room · €45.00 a week" and "This week is paid";
the bed offers *Sleep* "+50 energy · 3 min", Ada lies down, and waking early
keeps the energy gained; the furnishing panel buys a beanbag for the seat
spot (drawn at once, sat on), then puts it away into storage; a reload comes
back home with the room and storage; *Go out to the square* brings Ada back
into Ben's view; the door then offers *Go home*, *Change room…* and *Move
out…*; moving out asks first and keeps the beanbag. Phone (Pixel 7
emulation): the rent dialog's choices at least 44 px, renting a box room,
the furnishing panel as a bottom sheet with its spots and options at least
44 px.

**End to end, day and night (`e2e/daylight.spec.ts`, M7b)** — the world lab
(no server) at 12:00, 19:40 and 23:00: the phase, lamps and stars follow the
time; night costs at most 2 draw calls and under 2 000 triangles more than
midday; two characters measured in the picture (one in dark clothes in the
open, one at the lit café counter) keep over 55 % of their midday brightness
and over 80 % of their contrast with the ground around them at dusk and at
night; no page errors. The real game with two players: the first frame that
showed each character after entering already used the server's game minute
(no default light), with the phase and lamps the rule gives for that
minute, and both players see the same time of day. The suite's clock starts
at 09:00 game time, so this part runs by day; joining at night was checked
by a script against a server set to 23:00 (results log).

**End to end, first job (`e2e/work.spec.ts`, M7)** — desktop, with the
game's real 90-second shift and the test server's clock at 09:00 game time:
the counter lists the menu and *Ask about work* (€6.00 a shift); choosing it
hires ("You got the job: Café assistant"); the counter then offers *Work a
shift* (€6.00 · 90 s) and says "you work here"; the character works south of
the counter (the staff side) with "Working a shift" in the action bar, and a
second player sees the `working` activity; after 90 s "Shift done: +€6.00
wage", one wage of €6.00 in the ledger, the balance up by exactly the wage
(plus an allowance if the game day changed), communication XP up and energy
down; the panel's Work section shows job, grade, wage, the next grade,
"Shifts today 1 of 4 · Open now, until 23:00" and the wage in the money
list; after a reload the job, today's shift and the wage come back; *Quit
job* ends the job ("You quit your job at the café") and keeps the wage in
the history. Phone (Pixel 7 emulation): tapping the counter opens the sheet
with *Ask about work* as a button ≥ 48 px showing the wage; tapping it
hires; the panel sheet scrolls to the Work section, *Quit job* is at least
44 × 44 px and the sheet stays under half the screen height.

**End to end, interactions (`e2e/interactions.spec.ts`)** — desktop: dragging
across an object selects nothing; hover shows a pointer; clicking a bench
opens a radial menu with "Sit" and "Sketch"; Escape closes it; Sit walks there and
the other player sees the seat taken; clicking yourself while seated offers
Sketch, Stand up and Character; clicking another player offers Greet, who sees a toast and the
gesture; clicking yourself while standing offers only your own options (Character, Edit appearance); a study desk
offers Study/Sit and the action can be cancelled while walking (seat
released). Mobile (Pixel 7 emulation): tapping a bench opens a bottom sheet
with buttons ≥ 48 px and hides the joystick in portrait; the close button
restores it; Sit works; a seated touch player greets another player.

**End to end, walking skeleton (`e2e/walking-skeleton.spec.ts`)** — two desktop browsers and one
Chromium **mobile emulation** (Pixel 7 profile: touch, 412×839, mobile UA):
all three see each other; desktop click-to-move replicated; touch tap-to-move
replicated; WASD movement; virtual joystick movement (real touch events via
CDP); clicking a solid, non-interactive object (a market stall) shows
feedback and does not move; closing a tab
removes the player for the others. Screenshots are saved to `test-results/`.

## Integration audit (2026-10-20)

A check of what is really built for M3–M6c, made before M7. Labels:
**Verified** = covered by automated tests that ran and passed in this audit
(Chromium on Linux, phones in emulation); **Implemented, not verified** =
the code exists but no automated test covers it; **Partial**; **Missing**;
**Blocked** = needs something unavailable here (the product owner's devices,
art, a decision). "Verified" here is automated evidence only: the roadmap's
owner sign-off and real-device checks are separate and still open.
M7 (the first job, built after this audit) has its criteria and evidence in
ROADMAP.md "M7 first job: acceptance criteria"; rows below changed by M7
say so.

| Milestone | Feature | Label | Code | Evidence |
| --- | --- | --- | --- | --- |
| M3 | Select objects and players by click/tap, with highlights | Verified | `client/src/interaction/interactionController.ts`, `render/worldScene.ts` | `e2e/interactions.spec.ts`, `walking-skeleton.spec.ts` |
| M3 | Contextual menu: radial (mouse), bottom sheet (touch); Escape and outside taps close it | Verified | `client/src/ui/actionMenu.ts` | `interactions.spec.ts` |
| M3 | Radial menu turning into a column for long labels; action sheet docked right in landscape | Implemented, not verified | `actionMenu.ts`, `styles.css` | — |
| M3 | Server validation (target, action, distance, free seat, self, offline, cooldown, reachability) | Verified | `shared/src/interactions.ts`, `server/src/InteractionSystem.ts` | `shared/test/interactions.test.ts`, `server/test/interactions.test.ts` |
| M3 | Walk-to-then-act lifecycle, seat reservation, races, cancel, forged completion ignored | Verified | `InteractionSystem.ts` | `server/test/interactions.test.ts`, `interactions.spec.ts` |
| M3 | Bench (sit, sketch, stand), desk and café table (sit, study), greet | Verified | same | integration tests; `world.spec.ts` (café table); `journey.spec.ts` (sketch) |
| M3 | Menus that scroll or page; doors; running; sleeping | Missing | — | Planned (GAME_DESIGN requirements table, M10) |
| M3 | Public info panel for another player | Partial | name and activity tag only | Proposed for M9 |
| M4 | Guest identity: hashed token, checked before joining, 4401 for unknown tokens | Verified | `server/src/identity/guestIdentity.ts`, `PlazaRoom.onAuth` | `server/test/profiles.test.ts`, `persistence.spec.ts` |
| M4 | Versioned profile with upgrades 1 → 2 → 3, newer versions read-only | Verified | `shared/src/profile.ts`, `server/src/profiles/ProfileService.ts` | `shared/test/profile.test.ts`, `profiles.test.ts`; real M5 database loaded by today's server (see below) |
| M4 | Owner-scoped SQL; ids sent by clients never trusted | Verified | `profileRepository.ts`, `lifeRepository.ts` | `database.test.ts`, `lifeDatabase.test.ts`, `lobby.test.ts`, `profiles.test.ts` |
| M4 | Migrations 0001–0004 up, down, up; CLI status and migrate | Verified | `server/src/db/migrate.ts`, `server/migrations/` | `database.test.ts` on PGlite and PostgreSQL 16; `db:status`/`db:migrate` on a fresh on-disk database (idempotent) |
| M4 | Saved position, 30 s autosave, seated characters saved where they stand up | Verified | `PlazaRoom.ts`, `LifeService.ts` | `profiles.test.ts`, `journey.spec.ts` |
| M4 | Newest session wins (4100); a title-screen-only window disconnects nobody | Verified | `profiles/sessionRegistry.ts` | `profiles.test.ts`, `persistence.spec.ts` |
| M4 | Reconnecting within 20 s resumes the same session | Verified | `PlazaRoom.onDrop/onReconnect` | `plaza.test.ts`, `title-flow.spec.ts`, `journey.spec.ts` |
| M4 | Removal after the 20 s reconnection window expires: saved, removed for everyone, playable again exactly once | Verified (test added in this audit) | `PlazaRoom.ts` | `profiles.test.ts` |
| M4 | Guest-creation limit per IP; character deletion with typed name | Verified | `ProfileService.ts`, `PlazaRoom.ts` | `profiles.test.ts`, `lobby.test.ts`, `title-flow.spec.ts` |
| M4 | Real sign-in, account deletion | Missing (by design, D-017) | — | Decided before M9 (D-035, Q5) |
| M4 | The owner's own saved database on Windows | Blocked (not reachable from the cloud workspace) | — | The upgrade path from a real M5 database was checked instead |
| M5 | Server world clock, replicated; clients never time the world | Verified | `shared/src/life/clock.ts` | `shared/test/life.test.ts`, `server/test/life.test.ts` |
| M5 | Five needs with rates and gentle consequences; offline catch-up capped | Verified | `needs.ts`, `server/src/life/LifeSystem.ts` | `shared/test/life.test.ts`, `server/test/life.test.ts` |
| M5 | Mood from needs and events, with reasons | Verified | `mood.ts` | unit and integration tests; `journey.spec.ts` ("Freshened up") |
| M5 | Five skills, XP curve, trait and mood multipliers | Verified (cooking has no source yet) | `skills.ts` | unit and integration tests; `life.spec.ts`, `journey.spec.ts` |
| M5 | Skills unlocking anything | Missing at the audit; started in M7 (communication level 2 → barista wage) | `shared/src/life/work.ts` | `shared/test/work.test.ts`, `server/test/work.test.ts` (added with M7, 2026-10-26) |
| M5 | Four traits chosen at creation | Verified | `traits.ts`, `setupScreen.ts` | `life.spec.ts`, `journey.spec.ts` |
| M5 | Money ledger: idempotent, row-locked, never negative; café purchases; allowances | Verified | `lifeRepository.ts` (`applyMoneyChange`) | `lifeDatabase.test.ts` on both databases, `server/test/life.test.ts`, `life.spec.ts` |
| M5 | Life data private to its owner | Verified | `LifeSystem.ts` (`life` message) | `server/test/life.test.ts` |
| M5 | Character panel on desktop and phone (portrait) | Verified | `client/src/ui/characterPanel.ts` | `life.spec.ts` |
| M5 | Character panel docked right on a phone in landscape | Implemented, not verified | `styles.css` | — |
| M5 | Comfort need, sleep, cooking source | Missing | — | Approved for M10 (D-035) |
| M6 | Versioned appearance config, strict and lenient validation, look strings | Verified | `shared/src/appearance/` | `appearance.test.ts`, `profiles.test.ts` |
| M6 | Skin tones, undertones, 17 hair styles, face and body options, clothing, accessories | Verified (every hair style, top and eye shape compared as images; others checked by eye in the lab) | `client/src/render/avatar/` | `creator.spec.ts`; character lab screenshots |
| M6 | No ethnicity field; appearance never affects gameplay | Verified | schema; gameplay modules | `boundaries.test.ts` (widened in this audit), `appearance.test.ts` |
| M6 | Look replicated to other players, only changed parts rebuilt | Verified | `character.ts`, `PlayerState.look` | `creator.spec.ts`, `persistence.spec.ts`, `journey.spec.ts` |
| M6 | Per-character geometry budgets | Verified | — | `creator.spec.ts` (four browsers) |
| M6 | Default part when a body part can't be built; message without WebGL | Implemented, not verified | `character.ts`, `creator.ts` | — |
| M6 | Facial expressions, fingers, artist-made models | Missing (Stage-1 procedural art, D-027) | — | Options explained when M8 starts (Q6) |
| M6b | Title screen (New life, Continue, Manage characters, Settings, Credits), up to three lives | Verified | `client/src/ui/flow.ts`, `ui/screens/` | `title-flow.spec.ts`, `lobby.test.ts` |
| M6b | New life in three steps; nothing saved before the review | Verified | `flow.ts`, `ui/creator.ts` | `title-flow.spec.ts`, `journey.spec.ts` |
| M6b | Six categories; turn, zoom, randomise, reset, undo/redo, compare, look codes | Verified | `ui/creator.ts`, `shared/src/appearance/categories.ts` | `creator.spec.ts`, `title-flow.spec.ts`, `categories.test.ts` |
| M6b | Editing a look from the title screen or the world; Cancel asks first; life data untouched | Verified | `flow.ts`, `PlazaRoom.ts` | `lobby.test.ts`, `title-flow.spec.ts`, `journey.spec.ts` |
| M6b | Begin or Continue pressed twice | Verified (Begin added in this audit) | `PlazaRoom.exclusive` | `lobby.test.ts` |
| M6b | Gameplay messages (move, stop, interact, buy, cancel) from a session at the title screen are ignored: nothing appears, is reserved, answered or charged | Verified (test added in this audit) | `PlazaRoom.acceptIntent`, `InteractionSystem` | `lobby.test.ts` |
| M6b | Settings stored per browser and applied | Verified | `ui/settings.ts` | `title-flow.spec.ts` |
| M6b | Phone portrait and landscape: screens fit, touch turns and pinches the preview | Verified (emulation) | `styles.css`, `creator.ts` | `title-flow.spec.ts`, `creator.spec.ts` |
| M6b | "The server didn't answer" after 15 s; "Connection lost" screen | Implemented, not verified | `flow.ts` | — |
| M6c | District built within budgets at both detail levels | Verified | `client/src/render/world/`, `worldScene.ts` | `client/test/world.test.ts`, `world.spec.ts` |
| M6c | Art inside the collision boxes; every box visibly filled | Verified | same | `client/test/world.test.ts` |
| M6c | Layout: no cut-off pockets, porch and portico reachable, streets closed | Verified | `shared/src/world.ts` | `shared/test/world.test.ts` |
| M6c | Fading (hiding you, or right beside the camera), taps through faded buildings | Verified | `worldScene.ts` | `world.spec.ts` |
| M6c | Frame rate on a real graphics card or phone; the owner's look at the art | Blocked (needs the owner's devices) | — | ROADMAP open items 1 and 3 |
| M6c | Day and night; per-object level of detail; camera collision | Missing at the audit; day and night built in M7b (ROADMAP "M7b day and night: acceptance criteria"); level of detail and camera collision still missing | `client/src/render/world/daylight.ts` | `client/test/daylight.test.ts`, `e2e/daylight.spec.ts` (added with M7b, 2026-10-26) |
| All | Mouse and keyboard; touch (tap, joystick, pinch) | Verified (Chromium; phones in emulation) | `client/src/input/` | `walking-skeleton.spec.ts`, `interactions.spec.ts`, `title-flow.spec.ts` |
| All | Client and server types agree | Verified | shared TypeScript types; client mirror of the player state | `npm run typecheck` (all three packages); `client/test/contract.test.ts` (new) |
| All | Every message validated on the server | Verified | parsers in `shared/src/protocol.ts` used by every `onMessage` handler; unknown types ignored | `plaza.test.ts`, `interactions.test.ts`, `lobby.test.ts`, `profiles.test.ts` |
| All | Files load: no missing files, failed requests or page errors | Verified | fonts and code bundled; nothing downloaded at runtime | `journey.spec.ts` health checks (development server) |
| All | The production build loads and plays: all four font weights, creating a character, the full district, both developer pages | Verified by a scripted check, not part of the suite | `npm run build -w client` served by `vite preview` | Audit run 2026-10-20: no page errors, no HTTP errors (see "Results log") |
| All | Real phones, Windows, Firefox, Safari | Blocked (not available here) | — | Manual checklist below |
| All | Lint | Not run: no linter is configured in the project | — | Recommendation in "Known issues" |

**The player journey (all ten steps)** ran in one browser test,
`e2e/journey.spec.ts`, with two clients: launch → create and customise →
save and enter → walk and use objects → wash (needs, mood) and sketch
(skill) → saved → reload and network drop keep everything → a second
player sees the same look, movement and actions → an appearance change
reaches them → leave and return with the same guest identity: one
character, same state. Every step uses features that exist; nothing was
skipped. In its first full-suite run it failed once: the skills read after
the reload did not equal the ones read before it. The "before" snapshot
was taken the moment the character stopped walking, but the server sends
`life` at most every 500 ms, so the last fitness XP from the walk had not
reached the client yet; the saved value was the higher, correct one (the
upgrade check below shows the same effect: the M5 client's last update said
2.6 XP, the database 2.7). No progress was lost. The test now waits until
the life data stops changing before comparing, and prints both values if
they ever differ. Later it failed once at its final step (a third page
opening the title screen took over 30 s while another heavy check shared
the CPU); that wait is now 90 s.

**Upgrading a real older database.** The M5 version (commit `f61da63`) was
exported to a scratch folder and run against a fresh on-disk database; its
server created a character (profile version 2, M4-style appearance), bought
an espresso and saved a walk. Today's server, started on the same database,
applied migrations 0003 and 0004, listed the character on the title screen,
upgraded it to profile version 3 with the same look (frame, skin, hair,
eyes, outfit), and kept its trait, balance (€113.50), ledger row and
position. The repository itself was not changed by this check.

## Results log

| Date | Suite | Result | Notes |
| --- | --- | --- | --- |
| 2026-10-27 (M12 part 1) | typecheck + build | Pass | `npm run check` typecheck and `npm run build` (client and server) |
| 2026-10-27 (M12 part 1) | unit + integration | 599/599 pass (38 files) | In-memory PGlite. New: 7 operations tests (`server/test/operations.test.ts`: profile deletion through the room and its refusals, the database cascade, `/health`, `/status`, log formats, and the title-screen regression below) |
| 2026-10-27 (M12 part 1) | unit + integration on PostgreSQL 16.15 | 668/668 pass (38 files) | `TEST_DATABASE_URL` on a throwaway PostgreSQL 16.15 (609 s): the database tests repeated on PostgreSQL, including the profile-deletion cascade |
| 2026-10-27 (M12 part 1) | e2e | 35/35 pass (59.4 min) | The full suite with the new `e2e/privacy.spec.ts` (51 s alone), NPCs on, in-memory database |
| 2026-10-27 (M12 part 1) | load test | Pass: 16/16 bots, tick 1.0 ms worst average | `npm run loadtest -- --bots 16 --seconds 120` against a server on PostgreSQL 16.15 with the four locals on (Wednesday 17:30 game time), in the cloud workspace (2 CPUs), bots and server on the same machine. Join p50 18 ms, p95 64 ms; new character p50 43 ms, p95 109 ms; walk request → movement seen p50 69 ms, p95 97 ms (one 50 ms tick plus one 50 ms patch); 698 requests (424 walks, 161 sits, 113 greetings), no message rejected; the refusals were game rules (a bench already full, a greeting interrupted by the bot's next walk). Server tick worst average 1.0 ms, worst p95 2.2 ms, worst max 4.5 ms (budget 5 ms average); memory 106 → 145 MB; CPU at most 0.09 of one core; database round trip p50 0.7 ms, max 1.3 ms. Clean-up deleted all 16 profiles (database checked empty afterwards). With 20 bots: 2 rooms (16 + 4), each a separate copy of the square, ticks within budget. Not measured on the production host or over a real network. **Found and fixed:** clients at the title screen logged `"refId" not found` from the state decoder each time someone entered the world (a locals' arrival included): the server asked every view to remove players it never showed, which sent those clients a delete for a map they didn't have. Views now change only for players that appear or leave them (which also stops resending every visible player's full state on each arrival); regression test in `server/test/operations.test.ts`, which failed before the fix |
| 2026-10-27 (M12 part 1) | visual check (Claude, screenshots) | Pass | From the browser test: Settings with *Your data* and the delete dialog (wrong-window message shown), the "Profile deleted" screen. Not yet seen by the product owner |
| 2026-10-27 (M11) | typecheck + build | Pass | `npm run check` typecheck and `npm run build` (client and server) |
| 2026-10-27 (M11) | unit + integration | 592/592 pass (37 files) | In-memory PGlite. New: 11 NPC rules (`shared/test/npcs.test.ts`), 8 NPC tests (`server/test/npcs.test.ts`: six through the real room at fast clocks, two on the hooks). The server test helper turns NPCs off unless a test turns them on, so the older tests see only their own players; the contract test gained `role`. While writing them: two tests started too close to an NPC's arrival or departure (starting the test database takes a few seconds, a few game minutes at that speed) and now start earlier; the schedules had short gaps between blocks, which would have sent students off the square and straight back, and are now contiguous (a test checks it) |
| 2026-10-27 (M11) | unit + integration on PostgreSQL 16.15 | 659/660, then the failure fixed and passed 3/3 | `TEST_DATABASE_URL` on a throwaway PostgreSQL 16.15 (810 s). The failure was an older test, unrelated to NPCs (the server tests run without them): the daily allowance test counted game days and then read the ledger, and a new game day (one every 6 real seconds in that test) could start in between, so it saw one allowance more; it now reads both within one game day and stays exact. The whole life test file then passed on PGlite |
| 2026-10-27 (M11) | tick budget | 0.47 ms average (budget 5 ms) | In the server test with every NPC active (a barista working, three students walking, studying and sitting) and two players, over 126 ticks: 0.466 ms average, 1.14 ms p95, 4.5 ms max (one tick). Measured in the cloud workspace, not on the production host |
| 2026-10-27 (M11) | e2e | 33/34 in the full run (1.0 h), then the failure passed | With NPCs on for every spec. The new NPC spec passed (desktop and phone). The failure: the world spec's tree tap (at 18:59 game time, all four NPCs on the square) picked another object at the one point it aimed at, most likely because walking skipped a spot an NPC stood on and the view shifted; the test now tries four heights up the trunk, and passed alone at evening game time. The phone NPC test needed short walking hops to bring the barista on screen in portrait |
| 2026-10-27 (M11) | visual check (Claude, screenshots) | Pass | From the e2e runs: Giulia's gold "Barista" tag, her greet-only menu on desktop and as a phone sheet ("Barista · not a player"), her answer as a note ("Busy morning at the kiosk!"), the count "1 player here" with NPCs about. Not yet seen by the product owner |
| 2026-10-27 (M10) | typecheck + build | Pass | `npm run check` typecheck and `npm run build` (client and server) |
| 2026-10-27 (M10) | unit + integration | 573/573 pass (35 files) | In-memory PGlite. New: 20 home rules (`shared/test/homes.test.ts`), 6 housing tests (`server/test/housing.test.ts`: four on a hand-moved clock, two through the real room), 15 database tests (`server/test/housingDatabase.test.ts`), 4 housing words (`client/test/housing.test.ts`), and the room art checks repeated for every room type empty and with three furniture mixes (120). Existing tests updated for migration 0008 and the comfort need. While writing them, three real bugs were found and fixed: (1) the same rent or furniture request arriving twice at once could, on PostgreSQL, make the second wait for the wallet, see the first's payment and fail instead of answering "duplicate"; it now returns the home or piece that payment made; (2) repeating a furniture purchase (a lost reply) answered "spot taken" because the server's own check saw the piece it had just bought, so a retry could look like a failure; a taken spot now goes to the database, which recognises repeats first; (3) seats in deep furniture (beanbag, armchair) put the character on the front edge, beside the piece; they now sit in it |
| 2026-10-27 (M10) | unit + integration on PostgreSQL 16.15 | 641/641 pass | `TEST_DATABASE_URL` on a throwaway PostgreSQL 16.15: the 68 database tests repeated on PostgreSQL, including the 15 new housing ones (renting and buying the same request twice at once included); 632 s |
| 2026-10-27 (M10) | e2e on PostgreSQL 16.15 + upgrade | 8/8 pass | `E2E_DATABASE_URL` on `padova_e2e` at migration 7 with 31 characters: the server applied 0008 on start; afterwards the earlier characters' balances, needs and positions, all 63 earlier ledger rows, the enrolments, shift, lecture, exam, relationship, block and report were unchanged (compared by fingerprint) and the earlier characters had comfort 70; new rows as expected (a single room ended by moving out, a current box room, a beanbag in storage, two rent payments of €45 and €25, three story events). Home, persistence and social specs |
| 2026-10-27 (M10) | e2e | 32/32 pass (52.5 min) | The full suite with the two new home tests (about 3 min and 40 s). While writing the home spec: the room's name, shown on entering, replaced the "Welcome home" note a moment after renting; the room name is now a minor note that waits for other notes; the phone walk needed shorter hops; the panel remembers unfolded spots (the test now unfolds only a folded one) |
| 2026-10-27 (M10) | visual check (Claude, screenshots) | Pass with known limitations | World lab: each room type empty and furnished, by day and at night (the floor lamp glows), a sleeper lying along the bed; the square's south side with the new housing door. From the e2e runs: the rent dialog, the furnishing panel (desktop side panel, phone sheet), sleeping, sitting in the beanbag (after the fix above). The room's south wall and door cover part of the room in the world lab's fixed view (the game cuts them away). Not yet seen by the product owner |
| 2026-10-27 (M9) | typecheck + build | Pass | `npm run check` typecheck and `npm run build` (client and server); no linter is configured |
| 2026-10-27 (M9) | unit + integration | 393/393 pass | In-memory PGlite: 34 new tests (14 relationship and safety rules, 10 through the real room, 10 database); the exam's story event checked in the M8 test; existing tests updated for migration 0007, the greeting message's new `action` field and Chat in the player actions. While writing them: one test mistake (a blocker given the other account's id hit "same account" first), and it showed a real flaw, now fixed: the owner check counted matching characters, so two owners naming one character could pass; each (character, account) pair is now checked on its own. A block was checked after the chat cooldown, so a blocked player could get "too soon" instead of the neutral answer; the block now comes first |
| 2026-10-27 (M9) | unit + integration on PostgreSQL 16.15 | 446/446 pass | `TEST_DATABASE_URL` on a throwaway PostgreSQL 16.15: the 53 database tests repeated on PostgreSQL, including the 10 social ones. The run now takes about 10 minutes on this machine (578 s); a first attempt under a 590-second limit was cut off and was run again without it |
| 2026-10-27 (M9) | e2e on PostgreSQL 16.15 + upgrade | 6/6 pass | `E2E_DATABASE_URL` on `padova_e2e` at migration 6 with 22 characters: the server applied 0007 on start; afterwards the 22 characters' balances, the 45 earlier ledger rows, the enrolments, the shift, the lecture and the exam row were unchanged (compared by fingerprint); new rows as expected (one relationship at 5 with a chat moment, one block, one report). `npm run reports` listed the report from that database. Social and persistence specs |
| 2026-10-27 (M9) | e2e | 28/30 in the full run (45.8 min), then the 2 failures passed 2/2 | Includes the two new social tests (2.3 and 1.6 min). The two failures were the M3 interactions spec expecting a player menu of only *Greet*; it now expects *Greet*, *Chat*, *Profile*, *Block…*, *Report…* and passed (desktop and phone). The new social spec passed on its first run, alone, again in the full run and on PostgreSQL |
| 2026-10-27 (M9) | `npm run reports` | Pass | On an unmigrated embedded database (says the game must update it first), on a migrated empty one ("No reports.") and on PostgreSQL with one report (its reason, both names, area, game time and note) |
| 2026-10-27 (M9) | visual check (Claude, screenshots) | Pass with known limitations | From the e2e runs: the player card on desktop (portrait, "Acquaintance", "5 of 100", "Chatted", Block and Report), the report dialog with its five reasons and note, the card as a phone bottom sheet. The idle activity read "Here" and now reads "Hanging out". Not yet seen by the product owner |
| 2026-10-27 (M8) | typecheck + build | Pass | `npm run check` typecheck and `npm run build` (client and server); no linter is configured |
| 2026-10-27 (M8) | unit + integration | 359/359 pass | In-memory PGlite: 42 new tests (19 university rules including the clock offset, 8 through the real room including 2 on a fast clock, 9 university database, 6 wording). Existing tests updated: the rollback tests for migration 0006, two life tests for the new `course` and `timeScale` fields. While writing them: the integration tests timed out when run from `server/` (the 30 s limit lives in the root Vitest config; run from the root) and two checks read the seated state before its patch arrived (now waited for); no game change |
| 2026-10-27 (M8) | unit + integration on PostgreSQL 16.15 | 402/402 pass | `TEST_DATABASE_URL` on a throwaway PostgreSQL 16.15: the 43 database tests repeated on PostgreSQL, including the 9 university ones (two copies of one lecture recorded at the same moment count once) |
| 2026-10-27 (M8) | e2e on PostgreSQL 16.15 + upgrade | 6/6 pass | `E2E_DATABASE_URL` on the existing `padova_e2e` database at migration 5 with 15 characters: the server applied 0006 on start; afterwards the 15 characters' balances and the 31 earlier ledger rows were unchanged (compared by fingerprint) and the shift row was still there; new rows as expected (one enrolment with 1 lecture and an exam graded 13, not passed; one enrolment), no lecture recorded twice, no exam without its enrolment. University and persistence specs |
| 2026-10-27 (M8) | e2e | 28/28 pass (final full run, 32.4 min) | Includes the two new university tests with the real durations (the desktop one 5.8 min). A first full run was cut off by a container restart after 7 passing tests and was run again in full. While writing the university test: (1) one expectation was wrong (after a full lecture late entry has closed, so the desk shows "Next lecture …", not "Attended …"); (2) the phone helper tapped beside a chair where a character can't stand and the server rightly refused the walk, so `walkTo` now skips spots the shared collision rules call unwalkable; (3) in portrait the next spot was off screen (shorter hops). The exam line's wording changed afterwards ("Taken today", was "Sat today", which read like Saturday); the university spec passed again after that (next row) |
| 2026-10-27 (M8) | e2e, university spec after the wording change | 2/2 pass | Desktop 6.0 min (real lecture and exam), phone 37 s; "Taken today: 13/30 · next sitting Sat 09:00 · in about 7 h" |
| 2026-10-27 (M8) | visual check (Claude, screenshots) | Pass with known limitations | From the e2e runs: the lecture room during a lecture ("Ada · in a lecture", progress "In the lecture"), the exam result note and the University section on desktop (1280×720); the notice board's sheet and the University section on Pixel 7 emulation; the weekday in the clock chip on both. Not yet seen by the product owner |
| 2026-10-26 (M7c) | typecheck + build | Pass | `npm run check` typecheck and `npm run build` (client and server); no linter is configured |
| 2026-10-26 (M7c) | unit + integration | 317/317 pass | In-memory PGlite: 41 new tests (15 area and door rules, 6 server area tests through the real room, 20 room art-against-collision checks). While writing them, 9 existing server tests failed because a client at the title screen now has no `players` map until its character exists (each client sees only its own area); the tests now read it as optional, no game change. No migration and no SQL change (the area goes into the existing `character_state.area` column through the same save as before), so the PostgreSQL runs were not repeated: the saved area is verified on PGlite only |
| 2026-10-26 (M7c) | e2e | 26/26 pass (final full run, 40.6 min) | Includes the two new indoor-room tests. The first full run was 25/26: the phone work test tapped the ground while the camera still glided after a walk (the character stopped 0.8 m from the aimed point). Cause: the tests checked for a still camera with two reads 250 ms apart, which can fall inside one slow software-rendered phone frame. They now read a few drawn frames apart (`afterFrames`, see notes below); then both phone tests 3/3 each, then the full run. The indoor desktop test had needed retries while aiming at objects right after a walk or a door (same cause) |
| 2026-10-26 (M7c) | visual check (Claude, screenshots) | Pass with known limitations | World lab (`?area=`, before the wall cutaway was added): lecture room at both detail levels, reading room at full detail, both doors from the square. In the game, from the final e2e run: the lecture room on desktop (1280×720) and Pixel 7 emulation, with the camera-side wall see-through and the student at a desk visible. The reading room was not looked at in the game (its desk and door are exercised by the server tests and the art by the room tests). Stage-1 art (plain walls, no windows); in phone portrait the room fills only the middle third of the screen. Not yet seen by the product owner |
| 2026-10-26 (M7b) | typecheck + build | Pass | `npm run check` typecheck and `npm run build` (client and server); no linter is configured |
| 2026-10-26 (M7b) | unit + integration | 276/276 pass | In-memory PGlite: 18 new tests (12 day/night rules, 5 night glow in the district test, 1 boundary). No database or server code changed in this milestone, so the PostgreSQL runs were not repeated |
| 2026-10-26 (M7b) | e2e | 23/24 in one full run, then the failing test passed 3/3 alone | Includes the two new day/night tests. The failure was the district test aiming at a café table while the camera still glided (the tap point hit the ground). It passed twice alone unchanged; it now waits until the table's screen position is steady, and passed again |
| 2026-10-26 (M7b) | world lab measurements | Recorded | Without characters, by day exactly the earlier budgets (overview 86 / 47 draw calls, game camera 69 / 31, high / low); at night +2 draw calls and +1 388 triangles at both levels. Two characters measured in the picture (low detail): relative contrast with the ground at night 0.70 and 0.46 against 0.74 and 0.41 at midday; brightness 63 % and 71 % of midday at night, 60 % and 68 % at dusk |
| 2026-10-26 (M7b) | the game at night (script) | Pass | A game server with its clock at 23:00 (`GAME_CLOCK_OFFSET_MINUTES`): a new player on desktop (high detail) and on Pixel 7 emulation entered with the first frame already at night (`entryLight` phase night, minute equal to the server's); no page errors; screenshots checked by eye |
| 2026-10-26 (M7) | typecheck + build | Pass | `npm run check` typecheck and `npm run build` (client and server); no linter is configured |
| 2026-10-26 (M7) | unit + integration | 292/292 pass | With `TEST_DATABASE_URL` on a throwaway PostgreSQL 16.15: 258 tests, 34 database tests repeated on PostgreSQL (including the 9 new work-database tests). Without PostgreSQL, `npm run check` 257/257 before the barista integration test was added; `server/test/work.test.ts` 13/13 after |
| 2026-10-26 (M7) | e2e | 22/22 pass (one full run) | Includes the two new work tests with the real 90-second shift. `work.spec.ts` also passed alone on the in-memory database and on PostgreSQL (next row). Its first run, on 2026-10-20, failed one step: the panel redrew while the test scrolled to the Work section (a test timing problem; the scroll now retries) |
| 2026-10-26 (M7) | e2e on PostgreSQL 16.15 + upgrade | 2/2 pass | `E2E_DATABASE_URL` on the existing `padova_e2e` database, which held 12 characters at migration 4: the server applied 0005 on start; afterwards the 12 earlier characters had the same balances and ledger rows, and the new shift had exactly one matching €6.00 wage (no duplicate keys, no shift without its wage) |
| 2026-10-20 (integration audit) | typecheck + build | Pass | shared, server, client (including `client/test`); no linter is configured, so none ran |
| 2026-10-20 (integration audit) | unit + integration | 246/246 pass | With `TEST_DATABASE_URL` on a throwaway PostgreSQL 16.15 (221 tests, 25 database tests repeated on PostgreSQL). New: double-clicked Begin, title-screen gameplay messages ignored, reconnection window ending, client/server player contract, wider appearance boundary. Each new test also passed on its own first |
| 2026-10-20 (integration audit) | e2e | 20/20 pass (one full run) | Includes the new journey test. Before the final run the journey test ran 3 times alone: 2 passed, 1 failed at its last step (a third page's title screen took over 30 s while a production-build check shared the CPU; wait raised to 90 s). Its earlier full-suite failure (skills read before a reload vs after) was a stale snapshot, not lost data (see "Integration audit"). Journey, persistence and title-screen specs also on PostgreSQL 16.15 (`E2E_DATABASE_URL`): 9/9; rows checked with SQL (one character per name, no repeated ledger keys, skills saved) |
| 2026-10-20 (integration audit) | upgrade from a real M5 database | Pass | M5 server (commit `f61da63`) on a fresh on-disk PGlite: a profile-version-2 character with an espresso and a walk; today's server on the same files: migrations 0003 and 0004 applied, character listed, upgraded to version 3 with the same look, trait, balance, ledger and position. Run twice (the first run's second half was interrupted), passed both times it completed |
| 2026-10-20 (integration audit) | production build, scripted | Pass | `npm run build -w client`, served by `vite preview` with a game server: all four font weights loaded, a character created (afro hair) and the district built (47 meshes, full detail); world lab rendered in 1.8 s, character lab (every hair style) in 77 s with the CPU shared; no page errors, no HTTP errors |
| 2026-10-20 (near-camera fade, D-035) | typecheck + build + unit + integration | Pass; 216/216 | No server or shared change; client typecheck and production build pass |
| 2026-10-20 (near-camera fade) | e2e | 19/19 pass (final, by file) | The district test gained an arrival step (the shops beside the camera are faded and ground seen through them can be tapped); two of its later checks moved because the portico now also fades when the camera is within 3.5 m of it (2/2 alone). Full suite: 18/19; the phone character-panel test failed once because the panel redrew its money section during a scroll (a test race, unrelated to this change), now retried; then 3/3. Visual check of the arrival view at 1366×800 and 844×390 |
| 2026-10-19 (M6c, world art pass) | typecheck + build | Pass | shared, server, client (including `client/test`); production build with three entries (game, character lab, world lab); the district code is its own 63 KB chunk (23 KB gzipped) |
| 2026-10-19 (M6c) | unit + integration | 216/216 pass | Includes the new layout tests (`shared/test/world.test.ts`) and art-against-collision tests (`client/test/world.test.ts`), and every existing server test on the new layout. One earlier full run had one failure in the life-loop test that did not repeat (4/4 alone, then the full suite passed twice). The database and persistence code did not change in this milestone, so the PostgreSQL runs were not repeated |
| 2026-10-19 (M6c) | e2e | 19/19 pass (final, by file) | First full run at full detail: the four-browser creator test timed out (a third software-rendered browser waited over 60 s at the welcome screen), so test browsers now default to the light detail level (`VITE_DEFAULT_QUALITY=low`; see notes below). Second full run: all 18 existing tests pass in the new district; the new district test failed on its own test route (the café kiosk, then a portico column, hid the spot it tapped). Fixed in the test (a route checked by probing every point from the arrival area, on-screen checks, waiting for the camera, a choice of spots between the columns); then 3/3 consecutive passes |
| 2026-10-19 (M6c) | manual visual check (Claude, screenshots) | Pass with known limitations | World lab: every viewpoint (overview, game camera, hall, porch, library, portico, café, market, fountain, north street, south side, skyline), the collision overlay and the light detail level; in the game at 1366×800, 390×844 and 844×390 touch, walking to the café, under the portico (fading) and north. Limitations listed under "Known issues". Not yet seen by the product owner, on Windows or on a phone |
| 2026-10-19 (M6b, title screen) | typecheck + build | Pass | shared, server, client; production build 925 KB of JavaScript (259 KB gzipped) plus 81 KB of WOFF2 fonts |
| 2026-10-19 (M6b) | unit + integration | 198/198 pass (final) | With `TEST_DATABASE_URL` on a throwaway PostgreSQL 16.15: 222/223 on the last full run; the one failure was test timing (a title-screen test read the shared state before the patch removing the player arrived; the test now waits for it), then `lobby.test.ts` 10/10 twice on both backends. An earlier full run had a similar timing failure in "pressing Continue twice enters once" (fixed the same way). Includes migration 0004 up, refused rollback with two characters, rollback with one, and up again, on PGlite and PostgreSQL |
| 2026-10-19 (M6b) | e2e | 18/18 pass (final, by file) | Three full runs on the in-memory database: 13/18, 15/18, then 17/18. Run 1: two test mistakes (a review line is "Rounded afro", not "Afro"; a layout check measured during the screen's slide-in) and two- to four-browser tests over their time limits. Run 2: three multi-browser tests just over 150 s, so those now allow 300 s and the four-browser test 900 s; starting-look portraits are now drawn as they scroll into view instead of all 17 at once. Run 3: only the desktop life test failed, because the café counter landed a few pixels under the character panel's edge depending on where the walk ended; the test now stops closer to the counter in two steps and waits for the camera to settle: 3/3 re-runs pass. Title-screen spec re-run 4/4 after the last CSS change. Title-screen and persistence specs also on PostgreSQL 16.15 (`E2E_DATABASE_URL`): 8/8; rows checked with SQL (migration 0004 applied, `characters_by_account` index in place of the one-per-account index, every character with its appearance, needs, wallet and position rows, no ledger rows left by deleted characters) |
| 2026-10-19 (M6b) | manual visual check (Claude, screenshots) | Pass | Every screen at 1366×800, 390×844 touch and 844×390 touch: title (first visit and returning), name and personality, creator (each category), review, welcome transition, world, character panel, character list, edit look and its review, delete confirmation, Settings, Credits. Not yet checked by the product owner, on Windows or on a real phone |
| 2026-10-19 (M6b) | problems found while testing | Fixed | (1) Phone: six category tabs truncated their names; now two rows of three. (2) Title: stars behind the logo and menu hurt legibility (now faded there), keyboard focus jumped when the menu re-rendered, and the footer notice was hard to read. (3) Animated stars cost about 1.9 CPU cores with software rendering (measured), so the sky is now still; the loading bar no longer repaints the sky. (4) The review turntable is capped at 30 fps. (5) Phone landscape: the "SIM" badge touched the logo |
| 2026-10-19 (M6) | typecheck + build | Pass | shared, server, client; production build with the game and the character lab as two entries (880 KB, 245 KB gzipped) |
| 2026-10-19 (M6) | unit + integration | 179/179 pass | `npm run check` (shared 94 incl. 25 new appearance tests; server 85 incl. new upgrade, migration-rollback and boundary tests). Database tests with `TEST_DATABASE_URL` on a throwaway PostgreSQL 16: 48/48 (both backends, incl. migration 0003 up, down with the closest old look, and up again) |
| 2026-10-19 (M6) | e2e | 14/14 pass (after fixes) | Full suite on the in-memory database: 13/14 on the first full run; the appearance-edit test then hit the 60 s default timeout (two software-rendered browsers plus the creator) and got 150 s like the other multi-browser tests; re-run 4/4. Persistence spec also on PostgreSQL 16 (`E2E_DATABASE_URL`): 4/4, rows checked with SQL (profile version 3, `config` v1, M4 columns holding the closest old look) |
| 2026-10-19 (M6) | manual visual check (Claude, character lab screenshots) | Pass with known limitations | Every preset (body and face), every hair style front and back, hairlines, facial hair, every top, bottom, full outfit, pattern, outerwear, shoe, headwear and glasses, all nine skin-tone stops and three undertones, builds and every body and face slider at 0 and 1, walk / seated / greeting poses. No broken geometry found; limitations listed in ASSET_PIPELINE.md. Not yet checked by the product owner |
| 2026-10-19 (M6) | bugs found while testing | Fixed | (1) Sleeveless tops produced NaN arm vertices (division by a zero sleeve length). (2) Locs and braids rooted at the front fell over the face; locks now turn to fall beside it. (3) Skin-tone quick buttons sent 0.375 while the server stores two decimals (0.38): now rounded in the creator. (4) The look-code box closed itself when a preset was applied. (5) A three-step toon ramp left blotchy bands on faces; replaced by a soft ramp. (6) The creator re-rendered every frame; it now renders only when something changes, and the world isn't rendered behind it |
| 2026-10-18 (M5) | typecheck + build | Pass | shared, server, client; client production build |
| 2026-10-18 (M5) | unit + integration | 150/150 pass | `npm run check` (70 shared + 80 server). With `TEST_DATABASE_URL` on a throwaway PostgreSQL 16.15: 170/170 (database and life-database tests on both backends) |
| 2026-10-18 (M5) | e2e | 9/9 pass | Full suite twice: once on the in-memory database, once with the server on PostgreSQL 16.15 (`E2E_DATABASE_URL`, empty database); the café purchase (one 450-cent "Panino" row, balance 11 500 → 11 050) and 26.4 academic XP confirmed with SQL. The life loop uses the game's real durations (about 70 s) |
| 2026-10-18 (M5) | manual | Pass | Server started with `GAME_TIME_SCALE=60` (logged and used) and with `GAME_TIME_SCALE=abc` (refuses to start with a clear message) |
| 2026-10-18 (M5) | bugs found by tests | Fixed | (1) Radial menu options overlapped when labels were long ("Character" under "Edit appearance"; the café's priced options would too); the fan now widens, then becomes a column. (2) The café counter stood in front of the 12 m south building, which hid it and the player from the default camera; moved into the open piazza. (3) `GAME_TIME_SCALE` was documented but never read; now read by the server entry point. (4) Walking-skeleton and desktop-interactions e2e tests exceeded 60 s on this 2-CPU machine, at the M4 commit as well (checked in a separate worktree): timeouts raised to 150 s |
| 2026-10-17 | typecheck | Pass | shared, server, client |
| 2026-10-17 | unit + integration | 22/22 pass | Repeated runs, all passing |
| 2026-10-17 (M4) | typecheck + unit + integration | 93/93 pass | `npm run check` and `npm test`. With `TEST_DATABASE_URL` pointing at a throwaway PostgreSQL 16.15 server: 102/102 (database tests on both backends) |
| 2026-10-17 (M4) | e2e | 7/7 pass | Plus the 4 persistence tests again with the server on real PostgreSQL 16.15 (`E2E_DATABASE_URL`): 4/4, rows confirmed in the database |
| 2026-10-17 (M4) | manual | Pass | Server restart on on-disk PGlite: character created, server stopped and started, same character id, name and appearance loaded. `db:status`, `db:migrate`, `db:rollback -- 2` run against a scratch database |
| 2026-10-17 (M4) | bugs found by tests | Fixed | (1) Race: a reload could load the position from before the closing tab's final save; fixed in `PlazaRoom` (removal is one shared promise that eviction waits for) with a regression test that failed before the fix. (2) A relative `PGLITE_DATA_DIR` depended on the working folder; now resolved from the repo root. Test-only fixes: browser tests now wait for rendered frames before computing screen points, raise the guest limit, and use an in-memory database |
| 2026-10-17 (M3) | typecheck | Pass | shared, server, client |
| 2026-10-17 (M3) | unit + integration | 51/51 pass | 28 shared + 23 server; `npm run check` and `npm test` run, plus two more full runs, all passing. While writing them, 5 interaction tests failed because they read replicated state before the next patch arrived; fixed in the tests by waiting for state (no server change) |
| 2026-10-17 (M3) | e2e | 3/3 pass, 3 consecutive full-suite runs | Earlier runs failed on test design only: targets behind the camera after the player moved, and contexts not closed after a failed test (now closed in `afterEach`). The walking-skeleton test still passes unchanged |
| 2026-10-17 | e2e | 13 of 14 runs passed | Counted after fixing three test-script bugs (an occluded click target, a target at the screen edge, a single-shot check that should poll). One run then failed waiting up to 5 s for a join to finish; the join timeout is now 15 s and a failed join reports its on-screen error. 7 consecutive passes since. Suspected cause: CPU contention from three software-rendered WebGL pages. Runs used a preinstalled Chromium 141 via `CHROMIUM_PATH` because Playwright's browser download was blocked in that environment. |

## Known issues and gaps

Bugs (behaviour that is wrong or unreliable):

- **E2E join intermittently slow**: 1 of 14 runs timed out waiting for a join
  (see results log). Not reproduced since the timeout was raised; watch for it.
- **Multi-browser e2e tests are slow on 2-CPU machines.** In the M5 session's
  container the walking-skeleton and desktop-interactions tests needed just
  over 60 s and timed out, at the M4 commit too (checked), so the cause is
  machine speed (three software-rendered WebGL pages), not M5. Those tests now
  allow 150 s. Since the title screen milestone every browser joins through
  the title screen first, and the two- and three-browser tests needed just
  over 150 s on this machine: they now allow 300 s (the four-browser diverse
  characters test 900 s). On a normal PC with a graphics card they take a
  fraction of that.

Untested or limited (behaviour that is unverified, or limited by design for now):

- **No physical phone or tablet tested yet.** Mobile results come from
  emulation. Manual check needed on a real Android phone and an iPhone (Safari).
- **Windows not tested.** All automated runs were on Linux. `scripts/dev.mjs`
  uses `npm.cmd` with `shell: true` on Windows, which has not been exercised.
- Ground hidden behind an object from the camera's angle cannot be clicked:
  the click lands on the object and is refused. Rotate the camera instead.
  A later UX pass may route clicks to the ground behind low objects.
- The local player has no client-side prediction, so it responds with about
  100–150 ms of delay (D-006).
- Display names are not unique or reserved.
- **M5 life simulation limitations:**
  - Cooking skill exists but nothing trains it yet (no kitchen). No inventory:
    café food is eaten at once. No beds or sleep: energy recovers only by
    sitting, coffee and offline time.
  - Skill levels don't unlock anything yet; traits can only be chosen when
    creating a character, so characters created before M5 have none.
  - A meal or study session interrupted by a disconnect keeps what was applied
    so far; the rest is lost (the price is not refunded once eating started).
  - Mood has no visible effect on the avatar (no animations yet).
  - Balance tuning (rates, prices, allowance) is a first pass from the design
    doc and unit tests; it has not been play-tested by people.
  - Changing `GAME_TIME_SCALE` moves the world clock (by design, D-021): mood
    event times and the allowance day are in game minutes, so switching scales
    on a database with real players can expire events or allow an extra
    allowance. Development and testing only.
  - The character panel's landscape-phone layout (docked right) and the
    radial menu's stacked layout on narrow desktop windows have no automated
    test. Camera occlusion is not handled: buildings can hide characters at
    the south edge of the piazza.
- **M4 identity and persistence limitations:**
  - Guest identity only (D-017): no sign-in, recovery or cross-device play;
    clearing site data loses the character; a script injected into the page
    could read the token from `localStorage`. Needs HTTPS/WSS in production.
  - Characters can be deleted (since M6b), and a whole guest profile (M12);
    cleanup of abandoned guest accounts doesn't exist yet.
  - A room holds 16 players: the 17th opens a second, separate copy of the
    square with its own locals, and players in different copies don't see
    each other (load test, M12).
  - Guest-creation limit and session registry are in memory, per server process.
  - Activity, seats and pending actions are not saved; after a reload the
    character stands at the spot it would stand up to.
  - Up to three characters per guest profile (D-031); name and age can't be
    changed after creation.
  - Not tested: a real phone, Windows, Firefox, Safari; profile room tests run
    on PGlite only (the database layer and the persistence and title-screen
    browser tests were also run on real PostgreSQL).
- **M3 interaction limitations:**
  - One action at a time; a new request replaces the current one (D-011). No multi-action queue.
  - Poses are simple procedural limb rotations (since M6): walk, sit, study,
    sketch, wave, café and fountain actions; no blending between poses.
  - A greeter walks to where the other player was; if they keep moving, it
    re-plans up to 3 times, then fails with `target_moved`.
  - Objects hidden behind others from the camera's angle can't be selected;
    small, distant objects are hard to tap on a phone (no enlarged tap area yet).
  - No info panel for other players beyond name and activity (your own
    character panel exists since M5).
  - Menus have no scrolling or paging; at most three options exist today
    (the café). Long labels switch the radial fan to a column.
  - The landscape layout of the action sheet has no automated test.
  - Greetings have no block/mute option yet, only a 5 s cooldown per pair.
- Firefox and Safari not tested.
- Reconnection-window expiry (player removed after 20 s offline) is not
  covered by an automated test.
- Rendering performance measured only on this cloud machine with software
  WebGL (geometry budgets per character are enforced by e2e; see
  ASSET_PIPELINE.md "Measured cost"). No frame-rate measurement on a real
  GPU or phone yet, and no frame-time budget.
- Load beyond 4 simultaneous players not tested.
- **M6 character limitations:** procedural Stage-1 art, not artist-made
  models (D-027; visual limitations in ASSET_PIPELINE.md); no level of detail
  for distant characters; each new or changed character is built on the main
  thread in one go (a short stall per player joining); looks saved in the
  browser (`localStorage`) are a per-browser convenience only; the "no WebGL"
  message in the creator has no automated test; opening the creator takes
  several seconds in software-rendered test browsers (shader compilation),
  not measured on real devices.
- **M6b title screen limitations:**
  - Sessions at the title screen still receive the shared room state (other
    players' positions) and count toward the room's player limit; the client
    builds no avatars for them until it enters. Interest management later.
  - Entering the world takes about 4 s on this machine with software
    rendering (0.9 s server, 2.4 s first world frame, 1.25 s welcome
    screen); not measured on a real GPU. Shaders are not precompiled yet.
  - The fallback that draws a default body part when a part can't be built,
    the portrait fallback without WebGL and the creator's no-WebGL message
    have no automated test.
  - Device settings and saved looks live in one browser only. The Graphics
    setting applies after a reload.
  - The review turntable renders continuously (capped at 30 fps) while the
    review step is open; menus are otherwise still (the star sky is not
    animated: it cost 1.9 cores in software rendering, see results log).
  - Two windows of the same profile at the title screen can show slightly
    stale lists (e.g. after a deletion in the other window); every action is
    checked by the server, which refreshes the list on a stale request.
  - A rare race: if one window deletes a character at the exact moment
    another window of the same profile enters the world with it, the second
    window can play a character whose saves then fail (logged). Both checks
    run before the delete, so this needs two windows acting within
    milliseconds.
- **Indoor rooms (M7c):** only two rooms so far (the other buildings get
  theirs with their uses, D-039); no windows inside; Stage-1 art. The seat
  map is still sent to every client (seat ids and session ids only). A faded
  room door stays tappable, so tapping a character standing just behind it
  from the camera's side selects the door; turn the camera to reach them.
  In phone portrait the room fills only the middle third of the screen;
  pinch to zoom in.
- **University (M8):** one course; no withdrawing, no graduation, no
  lecturer, and the blackboard doesn't change during a lecture. The numbers
  (timetable, grade targets) are not play-tested. The browser test fails an
  unprepared exam; passing is covered by the server and database tests.
  Attending takes as long as late entry, so right after a lecture the desk
  shows "Next lecture …" rather than "Attended …". Trying lectures or exams
  at a chosen real time means restarting the server with the offset from
  `npm run clock` (everyone on a server shares its one clock).
- **Relationships and safety (M9):** nothing lowers a relationship (no
  rivalry, arguments or decay); no romance, groups or reputation; *Chat* is
  an action, there is no typed chat. Blocked players still see each other
  walk around. Moderation decisions (warnings, mutes, bans) and the
  owner's admin page come with sign-in (M12); until then `npm run reports`
  lists reports, and with the embedded development database the game must
  be stopped first. Blocks load a moment after a player enters the world;
  during that moment the server doesn't yet know their blocks. A failed
  story write is logged, not retried. The story starts with M9: events from
  before (an earlier job, enrolment or exam) aren't filled in. The numbers (gains, caps, levels) are
  not play-tested.
- **Locals (M11):** four NPCs; they appear and disappear at closed
  streets on the square's edge (no animation); they have no needs, money or
  memories, and no friendships with players; their places are fixed lists,
  so when theirs are taken they wait where they are. Tests that predate M11
  run with NPCs off on the server (`npcs: false` in the server test helper);
  the browser tests run with them on. The tick time was measured in the
  cloud workspace, not on the production host.
- **A place to live (M10):** one room per character in the student
  housing; no shared flats, roommates or visitors, no free placement or
  rotation, no selling furniture, no kitchen, shower or bills. Rent is
  charged only for the week you are in (weeks away aren't charged). The
  rents, prices, grace period and comfort rates are not play-tested. Rent
  falls due only while the character is in the world (it is checked on
  entering, then every tick). The room's south wall and door hide part of
  the room until the camera cuts them away; on a phone in portrait the room
  is small on screen.
- **World art pass limitations:**
  - The district is Stage-1 procedural art (D-033): only the hall and the
    library doors lead inside (M7c); no interiors behind the other doors
    and windows, faceted tree canopies, still water, colour-striped
    roof tiles. Not yet seen by the product owner.
  - Day and night (M7b) are Stage-1 too: lit windows are flat warm colour
    with nothing behind them, lamplight is painted on the ground (lamps
    don't light walls or characters from the side), stars are small
    squares. Night is deliberately bright enough to play (D-037). Not yet
    seen by the product owner.
  - A faded building shows its nearest surface at 16 % opacity; when the
    camera is inside a building (near the edges, or under the portico) the
    view looks busy. No camera collision yet.
  - Buildings within 3.5 m of the camera fade (D-035), so the shops no
    longer fill the first view on a computer. On a phone held sideways, the
    wider view still shows a strip of the shops' wall (5 m away) at the right
    edge on arrival; a wider fade distance would fade buildings too often.
  - Frame rate on a real graphics card or phone is not measured; on the
    cloud machine (software rendering) a full-detail full-window frame takes
    hundreds of milliseconds, which is why the browser tests default to the
    light detail level (see "Notes for running tests").
  - Taps pass through tree canopies, awnings and parasols (only the solid
    parts have tap boxes), so tapping a canopy walks to the ground behind it.
  - Saved characters standing where a new prop now is are moved to a spawn
    point on their next visit (by design; not covered by its own test).
- **No linter is configured** (no ESLint or similar); strict TypeScript
  type-checking is the only static check. Adding a linter is a new
  development dependency and would need its own small change (recommended
  before the codebase grows much further, not done in the audit).
- `npm audit` reports 9 low/moderate advisories, all inside `@colyseus/auth`
  (pulled in by the SDK, unused by this project). The suggested `--force` fix
  would downgrade Colyseus to 0.15, so it was not applied. Recheck on Colyseus updates.
- The game loads about 1 015 KB of JavaScript (290 KB gzipped) since the
  world art pass: the main chunk 280 KB, a shared chunk with Three.js and the
  characters 671 KB, the district 63 KB (production build of 2026-10-19), plus
  38 KB of CSS and 81 KB of fonts loaded once. Further code splitting is a
  later optimisation.

## Notes for running tests in Claude's cloud workspace

- Playwright's browser download (`cdn.playwright.dev`) is blocked there. A
  Chromium is preinstalled; run the e2e suite with
  `CHROMIUM_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome npm run test:e2e`.
- Use absolute paths (`/home/claude/padova-life-sim`): `~` in the shell resolves
  to `/root`, not the project's parent folder.
- The Colyseus startup banner appears in test output; it is cosmetic.
- The browser tests build the client with `VITE_DEFAULT_QUALITY=low`, so
  every test browser draws the light world (no shadows, fewer details)
  unless a test asks for `?quality=high` (`e2e/world.spec.ts` does, for one
  player). Collision, tap boxes and gameplay are identical at both levels.
  Reason: since the world art pass, three or four software-rendered
  browsers drawing the full-detail district at once on 2 CPUs could not
  finish a frame fast enough (a third player waited over 60 s at the
  welcome screen). `E2E_QUALITY=high npm run test:e2e` runs every browser
  at desktop detail on a machine with a real GPU.
- Don't edit files under `client/` or `shared/` while the browser tests run:
  the test client is Vite's dev server, which reloads the page on a change and
  makes the running test fail (seen once during the title screen milestone).
- Before a test clicks or taps a screen point, it checks that the camera has
  stopped by reading the point twice a few drawn frames apart
  (`afterFrames` in `e2e/helpers.ts`), not a fixed time apart. Under
  software rendering, phone emulation above all, one frame can take longer
  than 250 ms, so two reads 250 ms apart could fall in the same frame and
  "see" a still camera while it was still gliding (the tap then landed
  0.8 m off, M7c).

## Manual test checklist (real devices)

1. `npm run dev` on a computer; open `http://<computer-ip>:5173` on a phone on the same Wi-Fi.
2. Join from the computer and the phone with different names; both see 2 players.
3. Tap the ground on the phone; the computer sees the character walk there.
4. Use the joystick; drag to rotate; pinch to zoom. The page must not scroll or zoom.
5. Turn the phone's Wi-Fi off for ~5 s, then on: the character goes translucent for others, then returns.
6. Close the phone browser tab: the computer shows 1 player within a few seconds.
7. Rejoin on the phone. Tap a bench: a bottom sheet appears with a large "Sit"
   button; tap it. The character walks over and sits; the computer sees
   "· sitting" on its name tag.
8. Tap your own character: the sheet offers "Stand up".
9. On the computer, click the phone player: the menu offers "Greet". Choose it;
   the phone shows `<name> says "Ciao!"` and the computer player shows a bubble.
10. Turn the phone sideways: the sheet docks to the right and the joystick stays usable.
11. **Saved characters:** on first visit, create a character and pick a look.
    Walk somewhere, then reload the page: the title screen says *Continue as
    <name>*; Continue brings back the same look at the same spot.
12. Tap yourself (standing) → **Edit look**, change the hair colour, Review,
    Save look. The other device sees the change; reload and it is still there.
13. Stop the server (Ctrl+C), start it again, reload: the character is still there.
14. Open the game in a second tab of the same browser and press Continue: the
    character moves to the new tab and the first tab says "Playing in another
    window".
15. **Life simulation (M5):** create a new character and pick a personality
    trait. Tap/click yourself → **Character**: the panel shows mood, needs,
    skills and €107.50 (€100 start + today's €7.50; €115.00 before M7). On a phone it is a bottom
    sheet covering less than half the screen.
16. Walk east to the café counter, open it and buy a **Panino** (€4.50). The
    balance drops once, the panel says "Eating a panino" and hunger rises over
    about 15 seconds.
17. Study at a desk for 20 seconds: Academic XP rises in the panel; energy and
    fun dip a little.
18. Reload the page (and, once, restart the server): money, purchases, skills
    and needs are as you left them.
19. **Characters (M6):** in a private window, New life → name → the character
    creator opens with a 3D preview. Drag the preview to turn it; try Body / Upper / Face. Pick a
    few presets, then change the skin-tone slider end to end, the hair style
    (every style must look different), a face shape and an outfit. Undo and
    Redo work; *Hold to compare* shows the starting look.
20. Choose **Headscarf** under Accessories → Headwear, then change the hair style:
    the hair stays covered and the creator says "Covered by the headscarf".
21. Create the character, walk, sit on a bench and greet someone: the new
    character walks, sits and waves. The other device sees exactly the same
    look; reload and it is still the same. On the phone the preview is on top
    and the controls scroll below.
22. **Title screen:** the title shows New life, Continue, Manage characters,
    Settings and Credits over the starry sky and porticoes; Continue names
    your last character with its portrait. Keyboard: Tab / Enter work and
    Escape goes back on every screen.
23. In New life, try **Next** without a name (an error asks for one), pick
    two traits (a third is disabled), go to the look, then **Back** and
    **Next** again: name, traits and look are kept. On **Review**, press
    *Change* on Hair: it opens the Hair category. **Begin life in Padova**:
    a "Welcome to Padova" screen, then the piazza.
24. Character panel → **Back to title** → **Manage characters**: create a
    second life, then edit the first one's look and press **Cancel**: you
    are asked before changes are thrown away, and the look is unchanged.
    Edit again, Review lists the changes, **Save look**.
25. **Delete** the second life: the button stays disabled until its name is
    typed. Afterwards one life is left.
26. **Settings:** choose Reduced animation (menus stop moving, the review
    turntable stops), Fast camera speed (dragging turns further), hide the
    controls reminder (gone in the piazza); Graphics: Performance, then
    Reload now: shadows are gone.
27. **Phone, portrait and landscape:** every title screen fits without
    sideways scrolling; in the creator all six categories are visible, one
    finger turns the character and two fingers zoom; Review and Begin are
    reachable without hunting; turning the phone keeps everything usable.
28. **The district (world art pass):** walk round the square. Nothing you can
    see should let you walk through it (trees, lamps, chairs, planters,
    stall poles), and you should never stop at something invisible. Report
    the spot if either happens (the coordinates are in the browser console
    with `__padova.players()` on a `?e2e` page).
29. Walk into the university hall's porch (between the two study desks) and
    along the portico on the east side behind its columns: the portico
    houses fade while you are under them, then come back.
30. Tap a tree, a lamp and a street planter: each says what it is and that
    you can't walk there. Tap a café table: Sit / Study; sit on a chair;
    another player sees you seated there.
31. Walk to the south edge and turn the camera to look south: the building
    between the camera and you fades. The clock on the hall's tower shows
    the same time as the clock chip.
32. On a phone, check the frame rate feels smooth in the square (graphics
    "Automatic" picks the lighter detail there).
33. **First job (M7):** the café is open 06:00–23:00 game time (the clock
    chip). If it shows night, stop the server and start it with the clock
    shifted, e.g. in PowerShell `$env:GAME_CLOCK_OFFSET_MINUTES=600; npm run
    dev` (then `Remove-Item Env:GAME_CLOCK_OFFSET_MINUTES` afterwards). Tap
    the café counter: the menu lists the three items and **Ask about work**
    (€6.00 a shift). Choose it: the character walks to the counter and a
    message says "You got the job: Café assistant".
34. Tap the counter again: **Work a shift** (€6.00 · 90 s). Choose it: the
    character walks behind the counter, the action bar says "Working a
    shift", and a second player sees "· working" over the name. Wait 90
    seconds: "Shift done: +€6.00 wage"; the panel's Money list shows "Wage:
    Café assistant".
35. Start another shift and press **Cancel** halfway: no wage. Open the
    panel's **Work** section: "Shifts today 1 of 4", the opening hours, and
    **Quit job** (on a phone, scroll the sheet; the button is easy to tap).
36. Reload (and, once, restart the server): the job, today's shifts and the
    wage are still there. **Quit job**: "You quit your job at the café", and
    the counter offers Ask about work again.
37. **Day and night (M7b):** open `http://localhost:5173/world-lab.html?time=23:00`
    and then `?time=06:30` and `?time=19:40` (add `&view=game&people` for
    the arrival view with characters): night with lamplight pools, lit
    windows and stars; a warm dawn and dusk. Say whether night is dark
    enough or too dark.
38. To play at night, stop the server and start it with the clock moved, e.g.
    `$env:GAME_CLOCK_OFFSET_MINUTES=720; npm run dev` (12 game hours on;
    afterwards `Remove-Item Env:GAME_CLOCK_OFFSET_MINUTES`). Continue: the
    very first view is already the right time of day (no flash of
    daylight at night), and a second window or the phone shows the same.
39. At night, check your character, other players, name tags and menus are
    as easy to see as by day, on the computer and on the phone, and that the
    frame rate feels the same as by day.
40. **Indoor rooms (M7c):** walk to the university hall's porch (north-west)
    and tap its door → **Go in**: a short fade, then the lecture room with
    rows of desks, a blackboard and a lectern. Tap a desk → Study.
41. In a second window (InPrivate) or on the phone, stay on the square: you
    can't see the player who went in ("1 player here"). Go in too: you see
    each other again.
42. Reload inside the room and press Continue: you are back inside. Tap the
    room's door → **Go out to the square**: you stand in front of the hall.
    Try the library's door (north-east) too: the reading room.
43. **University (M8):** the clock chip shows the weekday ("Wed 10:24 · …").
    Tap the **University notice board** beside the hall's door → *Enrol:
    Introduction to City Studies*. Open your character panel: the University
    section shows the timetable and the next lecture. On a weekday between
    09:00 and 17:00 (game time), go into the lecture room, tap a desk →
    *Attend the lecture* (or see when the next one starts, greyed out);
    after 2 real minutes the lecture counts ("1 of 8"). On a Wednesday or
    Saturday, *Sit the exam* shows the grade you would get; after 3 real
    minutes you get a grade. To try it at any time: `npm run clock -- wed
    10:00` prints the PowerShell line that starts the game at that time.
44. **Relationships and safety (M9):** with a second player (an InPrivate
    window or the phone) nearby, tap them → *Chat*: after 10 seconds both
    see a note, and *Profile* shows "Acquaintance" with "Chatted". From the
    card, *Block* → confirm: the other player's *Chat* says "They can't be
    reached right now". Your character panel lists them under Blocked
    players → *Unblock*. *Report…* asks for a reason (and an optional note)
    and blocks them. Stop the game and run `npm run reports`: the report is
    listed. Your story (character panel) lists your job, first shift,
    enrolment, exams and new friends.
45. **A place to live (M10):** walk to the south side of the square, turn
    the camera round (drag), tap the **Student housing** door → *Rent a
    room…* → choose a room → *Rent*: you are inside your room and €25, €45
    or €80 is gone (character panel → Home and Money). Tap the bed →
    *Sleep* (3 minutes; tap Escape to wake early): energy rises. Tap
    yourself → *Furnish your room* → open a spot → *Buy* a piece: it
    appears at once; sit on a seat you bought. Reload: you are back in your
    room with the same furniture.
46. **Rent and moving (M10):** a second player outside doesn't see you
    while you are at home, and sees you again when you tap the room's door →
    *Go out to the square*. At the housing door, *Change room…* and *Move
    out…* ask first; your furniture is kept in storage. To see rent fall
    due, restart the game on a Monday: `npm run clock -- mon 08:00` prints
    the PowerShell line.
47. **Locals (M11):** on the square during the day, Giulia (gold tag
    "Barista") works at the café kiosk. Tap her → the menu says "Barista ·
    not a player" and offers *Greet*; greet her: she answers with a line.
    The top-left count shows only real players. On a weekday morning
    (`npm run clock -- mon 08:30`) students arrive, sit on the benches, and
    after 09:00 go into the university hall (walk in to see them at the back
    desk).
48. **Your data (M12):** on the title screen open *Settings*: with a saved
    character there is a **Your data** section. *Delete my profile…* → type
    something else (the red button stays disabled) → type `delete` →
    *Delete my profile*: "Profile deleted"; *Back to the title screen* says
    "No saved life yet"; a reload stays empty and Settings has no Your data
    section. With the game open in a second tab of the same browser, that
    tab shows "Profile deleted" too. If a character is being played in the
    other tab, deleting is refused until that tab goes back to the title.
49. **Health and status (M12):** while `npm run dev` runs, open
    `http://localhost:2567/health` (says `{"status":"ok"}`) and
    `http://localhost:2567/status` (players, NPCs, tick time, memory, no
    names).
