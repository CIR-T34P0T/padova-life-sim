// Shows one full-screen menu screen at a time (title, setup, creator,
// characters, settings, credits, transitions) above the game view, and
// hides them all while playing. Escape goes "back" on screens that allow it.

import { prefersReducedMotion } from "../settings.ts";

export interface Screen {
  readonly element: HTMLElement;
  /** Called once the element is in the document (sizes are known). */
  mounted?(): void;
  destroy?(): void;
  /** Escape was pressed (and no dialog is open). */
  onEscape?(): void;
}

export class ScreenHost {
  private currentScreen: Screen | null = null;

  constructor(private readonly root: HTMLElement) {
    document.addEventListener("keydown", (event) => {
      if (event.key !== "Escape" || !this.currentScreen?.onEscape) return;
      if (document.querySelector(".ui-dialog-backdrop")) return; // the dialog handles it
      event.preventDefault();
      this.currentScreen.onEscape();
    });
  }

  get current(): Screen | null {
    return this.currentScreen;
  }

  show(screen: Screen): void {
    const previous = this.currentScreen;
    this.currentScreen = screen;
    previous?.destroy?.();
    previous?.element.remove();
    this.root.hidden = false;
    screen.element.classList.add("screen");
    if (!prefersReducedMotion()) {
      screen.element.classList.add("is-entering");
      screen.element.addEventListener("animationend", () => screen.element.classList.remove("is-entering"), { once: true });
    }
    this.root.append(screen.element);
    this.root.dataset.screen = screen.element.dataset.screen ?? "";
    screen.mounted?.();
    // Move focus into the new screen for keyboard and screen-reader users.
    const focusTarget = screen.element.querySelector<HTMLElement>("[data-autofocus]") ?? screen.element.querySelector<HTMLElement>("h1, h2");
    if (focusTarget) {
      if (!focusTarget.hasAttribute("tabindex") && !/^(INPUT|BUTTON|SELECT|TEXTAREA|A)$/.test(focusTarget.tagName)) focusTarget.tabIndex = -1;
      focusTarget.focus({ preventScroll: true });
    }
  }

  /** Removes every screen: the game view is visible and playable. */
  clear(): void {
    this.currentScreen?.destroy?.();
    this.currentScreen?.element.remove();
    this.currentScreen = null;
    this.root.hidden = true;
    this.root.dataset.screen = "";
  }
}
