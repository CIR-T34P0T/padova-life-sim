import { CLOSE_SIGNED_IN_ELSEWHERE } from "@padova/shared";
import type { ConnectionStatus } from "../net/connection.ts";

const STATUS_TEXT: Record<ConnectionStatus, string> = {
  connecting: "Connecting…",
  connected: "Connected",
  reconnecting: "Reconnecting…",
  disconnected: "Disconnected",
};

export class Hud {
  private toastTimer: number | undefined;

  constructor(
    private readonly statusElement: HTMLElement,
    private readonly playersElement: HTMLElement,
    private readonly toastElement: HTMLElement,
  ) {}

  setStatus(status: ConnectionStatus, detail?: string, code?: number): void {
    this.statusElement.dataset.state = status;
    this.statusElement.textContent = STATUS_TEXT[status];
    this.statusElement.title = detail ?? "";
    // "Signed in elsewhere" gets its own explanation from the profile panel.
    if (status === "disconnected" && code !== CLOSE_SIGNED_IN_ELSEWHERE) this.toast("Connection lost. Reload the page to rejoin.", 8000);
  }

  setPlayerCount(count: number): void {
    this.playersElement.textContent = count === 1 ? "1 player here" : `${count} players here`;
  }

  toast(message: string, durationMs = 2200): void {
    this.toastElement.textContent = message;
    this.toastElement.hidden = false;
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => {
      this.toastElement.hidden = true;
    }, durationMs);
  }
}
