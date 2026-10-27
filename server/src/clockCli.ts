// `npm run clock -- wed 10:00` prints the GAME_CLOCK_OFFSET_MINUTES value
// that makes the game clock read that weekday and time now, so lectures and
// exams (M8) can be tried at any real time. Development and testing only:
// everyone on a server shares its one clock (D-021, D-036).

import { TIME_CONFIG, WEEKDAY_SHORT, clockOffsetFor, gameMinuteAt, parseTimeScale, readClock, weekdayOf } from "@padova/shared";

const [dayArg, timeArg] = process.argv.slice(2);
const weekday = WEEKDAY_SHORT.findIndex((d) => dayArg?.toLowerCase().startsWith(d.toLowerCase()));
const time = /^(\d{1,2}):(\d{2})$/.exec(timeArg ?? "");
const hours = time ? Number(time[1]) : NaN;
const minutes = time ? Number(time[2]) : NaN;

if (weekday < 0 || !time || hours > 23 || minutes > 59) {
  console.error("Usage: npm run clock -- <day> <hh:mm>   e.g.  npm run clock -- wed 10:00");
  console.error("Days: mon tue wed thu fri sat sun. Prints the GAME_CLOCK_OFFSET_MINUTES value that makes the game clock read that time now.");
  process.exit(1);
}

const scale = parseTimeScale(process.env.GAME_TIME_SCALE);
const now = Date.now();
const offset = clockOffsetFor(now, weekday, hours, minutes, scale);
const before = gameMinuteAt(now, scale);
const after = gameMinuteAt(now, scale, offset);
const label = (m: number) => `${WEEKDAY_SHORT[weekdayOf(m)]} ${readClock(m).label}`;

console.log(`Game time now:          ${label(before)}${scale === TIME_CONFIG.defaultScale ? "" : ` (time scale ${scale})`}`);
console.log(`With the offset below:  ${label(after)}`);
console.log("");
console.log("Start the game with it (it stays right for a few minutes; then the clock runs on as usual):");
console.log(`  PowerShell:  $env:GAME_CLOCK_OFFSET_MINUTES="${offset}"; npm run dev`);
console.log(`  macOS/Linux: GAME_CLOCK_OFFSET_MINUTES=${offset} npm run dev`);
console.log("Afterwards, in PowerShell: Remove-Item Env:GAME_CLOCK_OFFSET_MINUTES (or open a new window).");
