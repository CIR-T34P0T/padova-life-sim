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
  life-sim) and a card list with costs/durations (mobile life-sim). We will
  design our own visual language for both layouts in M3.

## Open design questions

1. **Time in a shared world.** One server clock for everyone; no pausing or
   fast-forward. Needs a model for day length, sleep and schedules. To decide
   before M5.
2. **First real district** — e.g. around the historic university/market squares,
   or the Portello area. To decide before building real geometry.
3. **Character customisation depth vs art budget** — decided after the VRM spike in M6.
