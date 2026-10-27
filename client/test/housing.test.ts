// Words for homes and rent (M10): what the character panel, toasts and story
// say for each state the server can send.

import { HOUSING_CONFIG, type HomeView } from "@padova/shared";
import { describe, expect, it } from "vitest";
import { cheapestRentCents, cosinessLine, noticeText, rentLine } from "../src/ui/housing.ts";
import { storyText } from "../src/ui/story.ts";

const minute = (day: number, hours = 10) => (day - 1) * 1440 + hours * 60;
const home = (overrides: Partial<HomeView> = {}): HomeView => ({
  areaId: "home/x",
  roomType: "single-room",
  rentCents: 4_500,
  paidWeek: 0,
  overdue: null,
  placements: [],
  cosiness: 0,
  ...overrides,
});

describe("housing words", () => {
  it("say whether this week's rent is paid, being taken, or overdue with its deadline", () => {
    expect(rentLine(home(), minute(3))).toEqual({ text: "This week is paid. Next rent: €45.00 on Monday.", warning: false });
    expect(rentLine(home(), minute(8)).warning).toBe(false);
    const overdue = rentLine(home({ overdue: { sinceGameMinute: minute(8, 2), deadlineGameMinute: minute(8, 2) + HOUSING_CONFIG.graceGameMinutes } }), minute(8, 3));
    expect(overdue.warning).toBe(true);
    expect(overdue.text).toContain("Rent overdue: €45.00");
    expect(overdue.text).toContain("14:00");
  });

  it("explain cosiness and the cheapest rent", () => {
    expect(cosinessLine(1)).toContain(`1 of ${HOUSING_CONFIG.cosyAt}`);
    expect(cosinessLine(HOUSING_CONFIG.cosyAt)).toMatch(/^Cosy/);
    expect(cheapestRentCents()).toBe(2_500);
  });

  it("turn every rent notice into a sentence", () => {
    expect(noticeText({ kind: "rent_paid", rentCents: 2_500 }, minute(8))).toBe("Rent paid: €25.00 for this week.");
    expect(noticeText({ kind: "rent_overdue", rentCents: 8_000, deadlineGameMinute: minute(8, 20) }, minute(8, 8))).toContain("by 20:00");
    expect(noticeText({ kind: "moved_cheaper", fromRoomType: "studio", roomType: "box-room", rentCents: 2_500 }, null)).toContain("from your studio to a box room");
    expect(noticeText({ kind: "moved_out_unpaid", fromRoomType: "box-room" }, null)).toContain("had to leave your box room");
  });

  it("write moving in, moving out and rent trouble in the story", () => {
    const at = { gameMinute: minute(2) };
    expect(storyText({ ...at, kind: "moved_in", details: { roomType: "studio" } })).toBe("Moved into a studio in the student housing");
    expect(storyText({ ...at, kind: "moved_out", details: { fromRoomType: "box-room" } })).toBe("Moved out of a box room");
    expect(storyText({ ...at, kind: "rent_trouble", details: { fromRoomType: "studio", roomType: "single-room" } })).toBe("Couldn't pay the rent: moved from a studio to a single room");
    expect(storyText({ ...at, kind: "rent_trouble", details: { fromRoomType: "box-room" } })).toBe("Couldn't pay the rent and had to leave a box room");
  });
});
