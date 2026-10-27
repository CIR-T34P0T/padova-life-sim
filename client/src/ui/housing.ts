// Words for homes, rent and furniture (M10), shared by the character panel,
// the home panel, the menus and the dialogs. Display only: every decision
// (rent, placement, prices) is the server's.

import {
  FURNITURE,
  HOUSING_CONFIG,
  ROOMS_BY_RENT,
  ROOM_TYPES,
  formatEuros,
  isCosy,
  rentWeekOf,
  type FurnitureId,
  type HomeView,
  type HousingNotice,
  type RoomTypeId,
} from "@padova/shared";
import { whenLabel } from "./university.ts";

export const roomLabel = (id: RoomTypeId): string => ROOM_TYPES[id].label;
export const furnitureLabel = (id: FurnitureId): string => FURNITURE[id].label;

/** The cheapest room's weekly rent (menus: "from €25 a week"). */
export const cheapestRentCents = (): number => ROOM_TYPES[ROOMS_BY_RENT[0]!].rentCents;

/** The rent's state in one line; `warning` when it is overdue. */
export function rentLine(home: HomeView, gameMinute: number): { text: string; warning: boolean } {
  if (home.overdue) {
    return {
      text: `Rent overdue: ${formatEuros(home.rentCents)}. It's taken as soon as you have it; by ${whenLabel(gameMinute, home.overdue.deadlineGameMinute)} at the latest, or you move to a cheaper room.`,
      warning: true,
    };
  }
  if (home.paidWeek >= rentWeekOf(gameMinute)) return { text: `This week is paid. Next rent: ${formatEuros(home.rentCents)} on Monday.`, warning: false };
  return { text: `This week's rent (${formatEuros(home.rentCents)}) is being taken now.`, warning: false };
}

/** How cosy the home is, and what that does. */
export function cosinessLine(cosiness: number): string {
  if (isCosy(cosiness)) return `Cosy (${cosiness}): coming home and waking up here lift your mood.`;
  return `Cosiness ${cosiness} of ${HOUSING_CONFIG.cosyAt}: plants, lamps, shelves and comfy seats make it cosy.`;
}

/** A rent notice from the server, as a toast. */
export function noticeText(notice: HousingNotice, gameMinute: number | null): string {
  switch (notice.kind) {
    case "rent_paid":
      return `Rent paid: ${formatEuros(notice.rentCents)} for this week.`;
    case "rent_overdue":
      return `You couldn't pay this week's rent (${formatEuros(notice.rentCents)}). Find the money by ${gameMinute === null ? "the deadline" : whenLabel(gameMinute, notice.deadlineGameMinute)}, or you'll move to a cheaper room.`;
    case "moved_cheaper":
      return `The rent couldn't be paid, so you moved from your ${roomLabel(notice.fromRoomType).toLowerCase()} to a ${roomLabel(notice.roomType).toLowerCase()} (${formatEuros(notice.rentCents)} a week). Your furniture is in storage.`;
    case "moved_out_unpaid":
      return `The rent couldn't be paid and no cheaper room was affordable, so you had to leave your ${roomLabel(notice.fromRoomType).toLowerCase()}. Your furniture is in storage.`;
  }
}
