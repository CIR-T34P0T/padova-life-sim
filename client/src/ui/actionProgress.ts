// Shows the player's current action ("Walking to the bench…", "Studying")
// with a progress bar for timed actions and a Cancel button. Visible only
// while an action is queued or running; the timing shown here is cosmetic,
// the server decides when an action actually ends.

export class ActionProgress {
  private readonly element: HTMLElement;
  private readonly label: HTMLElement;
  private readonly bar: HTMLElement;
  private readonly fill: HTMLElement;
  private startedAt = 0;
  private durationMs = 0;

  constructor(root: HTMLElement, onCancel: () => void) {
    this.element = document.createElement("div");
    this.element.className = "action-progress";
    this.element.id = "action-progress";
    this.element.setAttribute("role", "status");
    this.element.setAttribute("aria-live", "polite");
    this.element.hidden = true;

    this.label = document.createElement("span");
    this.label.className = "action-progress-label";
    this.bar = document.createElement("div");
    this.bar.className = "action-progress-bar";
    this.fill = document.createElement("div");
    this.fill.className = "action-progress-fill";
    this.bar.appendChild(this.fill);
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "action-progress-cancel";
    cancel.textContent = "Cancel";
    cancel.addEventListener("click", (event) => {
      event.stopPropagation();
      onCancel();
    });
    this.element.append(this.label, this.bar, cancel);
    this.element.addEventListener("pointerdown", (event) => event.stopPropagation());
    root.appendChild(this.element);
  }

  get text(): string | null {
    return this.element.hidden ? null : this.label.textContent;
  }

  /** Shows an action without a known end (walking to a target, sitting down). */
  showIndefinite(text: string): void {
    this.label.textContent = text;
    this.durationMs = 0;
    this.bar.hidden = true;
    this.element.hidden = false;
  }

  /** Shows a timed action; the bar fills over `durationMs`. */
  showTimed(text: string, durationMs: number): void {
    this.label.textContent = text;
    this.startedAt = performance.now();
    this.durationMs = durationMs;
    this.bar.hidden = false;
    this.fill.style.width = "0%";
    this.element.hidden = false;
  }

  hide(): void {
    this.element.hidden = true;
    this.durationMs = 0;
  }

  /** Called every frame to animate the bar. */
  frame(now: number): void {
    if (this.element.hidden || this.durationMs <= 0) return;
    const progress = Math.min(1, (now - this.startedAt) / this.durationMs);
    this.fill.style.width = `${(progress * 100).toFixed(1)}%`;
  }
}
