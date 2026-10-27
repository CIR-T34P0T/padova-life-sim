// Words for relationships and the story log (M9), shared by the player card
// and the character panel. Display only.

import { COURSES, JOBS, ROOM_TYPES, WEEKDAY_SHORT, formatGrade, isCourseId, isJobId, isRoomTypeId, readClock, weekdayOf, type SharedMomentKind, type StoryEntry } from "@padova/shared";

/** "Mon · Day 12" for a game minute. */
export function dayLabel(gameMinute: number): string {
  return `${WEEKDAY_SHORT[weekdayOf(gameMinute)]} · Day ${readClock(gameMinute).day}`;
}

const MOMENTS: Record<SharedMomentKind, string> = {
  greet: "Said hello",
  chat: "Chatted",
  study_together: "Studied together",
  lecture_together: "Went to a lecture together",
};

/** A shared moment as the player card lists it. */
export function momentLabel(kind: SharedMomentKind): string {
  return MOMENTS[kind];
}

const jobLabel = (id: string | undefined) => (id && isJobId(id) ? JOBS[id].label : "a job");
const courseLabel = (id: string | undefined) => (id && isCourseId(id) ? COURSES[id].label : "a course");
const roomName = (id: string | undefined) => (id && isRoomTypeId(id) ? `a ${ROOM_TYPES[id].label.toLowerCase()}` : "a room");

/** One story event as a sentence. */
export function storyText(entry: StoryEntry): string {
  const d = entry.details;
  switch (entry.kind) {
    case "hired":
      return `Got a job at the ${jobLabel(d.jobId).toLowerCase()}`;
    case "first_shift":
      return `Worked a first shift at the ${jobLabel(d.jobId).toLowerCase()}`;
    case "enrolled":
      return `Enrolled in ${courseLabel(d.courseId)}`;
    case "exam_passed":
      return `Passed ${courseLabel(d.courseId)}${d.grade !== undefined ? `: ${formatGrade(d.grade)}` : ""}`;
    case "exam_failed":
      return `Didn't pass the ${courseLabel(d.courseId)} exam${d.grade !== undefined ? ` (${formatGrade(d.grade)})` : ""}`;
    case "new_friend":
      return d.name ? `Became friends with ${d.name}` : "Made a new friend";
    case "moved_in":
      return `Moved into ${roomName(d.roomType)} in the student housing`;
    case "moved_out":
      return `Moved out of ${roomName(d.fromRoomType)}`;
    case "rent_trouble":
      return d.roomType ? `Couldn't pay the rent: moved from ${roomName(d.fromRoomType)} to ${roomName(d.roomType)}` : `Couldn't pay the rent and had to leave ${roomName(d.fromRoomType)}`;
  }
}
