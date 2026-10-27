import { CLOSE_SIGNED_IN_ELSEWHERE, WEEKDAY_NAMES, WEEKDAY_SHORT, formatEuros, readClock, weekdayOf, type LifePayload, type MoodLevel } from "@padova/shared";
import type { ConnectionStatus } from "../net/connection.ts";

const STATUS_TEXT: Record<ConnectionStatus, string> = {
  connecting: "Connecting…",
  connected: "Connected",
  reconnecting: "Reconnecting…",
  disconnected: "Disconnected",
};

const MOOD_TEXT: Record<MoodLevel, string> = {
  miserable: "Miserable",
  low: "Low",
  okay: "Okay",
  good: "Good",
  great: "Great",
};

export interface HudElements {
  status: HTMLElement;
  players: HTMLElement;
  toast: HTMLElement;
  /** Compact "me" chip: mood colour, time and money. Opens the character panel. */
  meChip: HTMLButtonElement;
}

export class Hud {
  private toastTimer: number | undefined;
  private gameMinute: number | null = null;
  private life: LifePayload | null = null;

  constructor(private readonly elements: HudElements) {}

  /** Called when the player clicks/taps the "me" chip. */
  onMeChip(handler: () => void): void {
    this.elements.meChip.addEventListener("click", (event) => {
      event.stopPropagation();
      handler();
    });
  }

  setStatus(status: ConnectionStatus, detail?: string, code?: number): void {
    const element = this.elements.status;
    element.dataset.state = status;
    element.textContent = STATUS_TEXT[status];
    element.title = detail ?? STATUS_TEXT[status];
    // "Signed in elsewhere" gets its own explanation from the profile panel.
    if (status === "disconnected" && code !== CLOSE_SIGNED_IN_ELSEWHERE) this.toast("Connection lost. Reload the page to rejoin.", 8000);
  }

  setPlayerCount(count: number): void {
    this.elements.players.textContent = count === 1 ? "1 player here" : `${count} players here`;
  }

  /** The world clock, as replicated by the server. */
  setClock(gameMinute: number): void {
    this.gameMinute = gameMinute;
    this.renderMeChip();
  }

  setLife(life: LifePayload): void {
    this.life = life;
    this.renderMeChip();
  }

  toast(message: string, durationMs = 2200): void {
    this.elements.toast.textContent = message;
    this.toastUntil = performance.now() + durationMs;
    this.elements.toast.hidden = false;
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => {
      this.elements.toast.hidden = true;
    }, durationMs);
  }

  /** A minor note (e.g. the room you walked into): shown only when no other toast is on screen, so it never hides news. */
  note(message: string, durationMs = 2200): void {
    if (performance.now() < this.toastUntil) return;
    this.toast(message, durationMs);
  }

  private toastUntil = 0;

  private renderMeChip(): void {
    const chip = this.elements.meChip;
    if (!this.life) {
      chip.hidden = true;
      return;
    }
    const minute = this.gameMinute ?? this.life.gameMinute;
    const clock = readClock(minute);
    const time = `${String(clock.hours).padStart(2, "0")}:${String(clock.minutes).padStart(2, "0")}`;
    // The weekday matters since lectures follow a weekly timetable (M8).
    const weekday = weekdayOf(minute);
    const mood = MOOD_TEXT[this.life.mood.level];
    chip.hidden = false;
    chip.dataset.mood = this.life.mood.level;
    chip.textContent = `${WEEKDAY_SHORT[weekday]} ${time} · ${formatEuros(this.life.money.balanceCents)}`;
    chip.setAttribute("aria-label", `Your character: mood ${mood}, ${WEEKDAY_NAMES[weekday]}, ${clock.label}, ${formatEuros(this.life.money.balanceCents)}. Open character panel.`);
    chip.title = `Mood: ${mood} · ${WEEKDAY_NAMES[weekday]} · ${clock.label}`;
  }
}
