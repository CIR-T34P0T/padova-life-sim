// Friendly text for server refusal and failure reasons.

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
};

export function reasonText(reason: string | undefined): string {
  return (reason && REASON_TEXT[reason]) || "That action couldn't be completed.";
}
