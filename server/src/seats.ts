// Seat and standing-spot reservations (D-026): seat id → session id of the
// player sitting there or walking to it. Seats in shared places are
// replicated (PlazaState.seats) so every client shows only free ones. Seats
// in a home (M10) are kept here on the server only: nobody else is ever in
// your home, and which seat you use there is nobody's business.

import { HOME_AREA_PREFIX } from "@padova/shared";
import type { PlazaState } from "./schema.ts";

export class SeatBook {
  private readonly homeSeats = new Map<string, string>();

  constructor(private readonly state: PlazaState) {}

  private store(seatId: string): Pick<Map<string, string>, "get" | "has" | "set" | "delete"> {
    return seatId.startsWith(HOME_AREA_PREFIX) ? this.homeSeats : this.state.seats;
  }

  get(seatId: string): string | undefined {
    return this.store(seatId).get(seatId);
  }

  has(seatId: string): boolean {
    return this.store(seatId).has(seatId);
  }

  set(seatId: string, sessionId: string): void {
    this.store(seatId).set(seatId, sessionId);
  }

  delete(seatId: string): void {
    this.store(seatId).delete(seatId);
  }

  /** Every reservation held by this player, shared and private. */
  heldBy(sessionId: string): string[] {
    const held: string[] = [];
    this.state.seats.forEach((owner, seatId) => {
      if (owner === sessionId) held.push(seatId);
    });
    for (const [seatId, owner] of this.homeSeats) if (owner === sessionId) held.push(seatId);
    return held;
  }
}
