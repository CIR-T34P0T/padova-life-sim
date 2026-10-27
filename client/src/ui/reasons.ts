// Friendly text for server refusal and failure reasons.

import { COURSES, JOBS, formatTimeOfDay } from "@padova/shared";

const REASON_TEXT: Record<string, string> = {
  // Movement
  target_blocked: "You can't walk there.",
  target_out_of_bounds: "That's outside the piazza.",
  search_limit: "That's too far to plan a route.",
  // Shared
  rate_limited: "Slow down a little.",
  invalid_payload: "That action wasn't understood.",
  unreachable: "There's no way to get there.",
  // Interactions
  unknown_target: "That's no longer here.",
  target_is_self: "You can't do that to yourself.",
  target_offline: "They're not connected right now.",
  action_not_available: "You can't do that right now.",
  no_free_seat: "There's no free seat.",
  too_far: "That's too far away. Walk closer first.",
  blocked: "Something is in the way.",
  target_left: "They left before you got there.",
  target_moved: "They walked off before you got there.",
  too_soon: "You just greeted them. Give it a moment.",
  busy: "Someone else is using that. Try again in a moment.",
  // Life simulation (M5)
  too_tired: "You're too tired to focus. Grab an espresso or rest first.",
  unknown_item: "That's not on the menu.",
  insufficient_funds: "You can't afford that right now.",
  purchase_failed: "The payment didn't go through. Nothing was charged.",
  duplicate_request: "That order was already placed.",
  // Work (M7)
  not_employed: "You don't work here. Choose \"Ask about work\" at the café counter first.",
  already_employed: "You already work at the café.",
  closed: `The café is closed until ${formatTimeOfDay(JOBS.cafe.opensAt)}.`,
  shift_limit: "That's enough shifts for today. Come back tomorrow.",
  hire_failed: "Couldn't sign you up just now. Nothing changed; try again in a moment.",
  wage_failed: "Your wage couldn't be paid because of a server problem, so the shift didn't count.",
  // University (M8)
  not_enrolled: "You're not enrolled. Enrol at the University notice board beside the university hall.",
  already_enrolled: "You're already enrolled. Your character panel has the timetable.",
  course_passed: "You've already passed this course.",
  no_lecture_now: `No lecture you can join right now. Lectures start on the hour; you can join in the first ${COURSES["city-studies"].lateEntryMinutes} minutes.`,
  already_attended: "You've already attended this lecture. The next one starts on the hour.",
  no_exam_now: "The exam isn't open now. Your character panel shows the next sitting.",
  already_sat: "You've already sat the exam at this sitting. Try again at the next one.",
  enrol_failed: "Couldn't enrol you just now. Nothing changed; try again in a moment.",
  record_failed: "That couldn't be recorded because of a server problem, so it didn't count.",
};

export function reasonText(reason: string | undefined): string {
  return (reason && REASON_TEXT[reason]) || "That action couldn't be completed.";
}
