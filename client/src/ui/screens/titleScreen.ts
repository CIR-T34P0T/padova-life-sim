// Title screen: New life, Continue, Manage characters, Settings, Credits,
// over the starry-sky-and-porticoes key visual. Continue shows the most
// recently played character with a portrait of the real 3D model.

import { TRAITS, decodeLook, type CharacterSummary } from "@padova/shared";
import { porticoesSvg, starrySkySvg } from "./backdrop.ts";
import { el, relativeTime } from "./dom.ts";
import { fillPortrait } from "./portraits.ts";
import type { Screen } from "./screenHost.ts";

export type LobbyStatus = "connecting" | "ready" | "offline";

export interface LobbyView {
  status: LobbyStatus;
  characters: CharacterSummary[];
  maxCharacters: number;
  /** A problem to show under the menu (e.g. "Couldn't load your characters"). */
  message?: string;
}

export interface TitleActions {
  onNewLife(): void;
  onContinue(character: CharacterSummary): void;
  onManage(): void;
  onSettings(): void;
  onCredits(): void;
  onRetry(): void;
}

export class TitleScreen implements Screen {
  readonly element: HTMLElement;
  private readonly menu: HTMLElement;
  private readonly card: HTMLElement;
  private readonly status: HTMLElement;
  private view: LobbyView;

  constructor(view: LobbyView, private readonly actions: TitleActions) {
    this.view = view;
    this.element = el("section", "title-screen");
    this.element.dataset.screen = "title";
    this.element.setAttribute("aria-label", "Padova Life SIM title screen");

    const sky = el("div", "title-sky");
    sky.innerHTML = starrySkySvg();
    const street = el("div", "title-street");
    street.innerHTML = porticoesSvg();

    const layout = el("div", "title-layout");
    const logo = el("header", "title-logo");
    const h1 = el("h1", "logo");
    h1.append(el("span", "logo-line logo-padova", "Padova"), el("span", "logo-line logo-life", "Life"));
    const badge = el("span", "logo-badge", "SIM");
    badge.setAttribute("aria-label", "Sim");
    h1.append(badge);
    logo.append(h1, el("p", "title-tagline", "University life in a city of porticoes"));

    this.menu = el("nav", "title-menu");
    this.menu.setAttribute("aria-label", "Main menu");
    this.card = el("aside", "title-card");
    this.card.setAttribute("aria-label", "Your most recent character");
    this.status = el("p", "title-status");
    this.status.setAttribute("role", "status");
    const foot = el("footer", "title-foot", "Fan-made game. Not affiliated with or endorsed by the University of Padua.");

    layout.append(logo, this.menu, this.card, this.status, foot);
    this.element.append(sky, street, layout);
    this.render();
  }

  update(view: LobbyView): void {
    this.view = view;
    this.render();
  }

  private get lastPlayed(): CharacterSummary | undefined {
    return this.view.characters[0];
  }

  private render(): void {
    const { status, characters, maxCharacters } = this.view;
    const last = this.lastPlayed;
    const ready = status === "ready";
    this.element.dataset.status = status;

    const item = (label: string, action: string, onClick: () => void, sub?: string, primary = false, disabled = false) => {
      const b = el("button", `menu-item${primary ? " is-primary" : ""}`);
      b.type = "button";
      b.dataset.action = action;
      b.append(el("span", "menu-label", label));
      if (sub) b.append(el("span", "menu-sub", sub));
      b.disabled = disabled;
      b.addEventListener("click", onClick);
      return b;
    };

    const full = characters.length >= maxCharacters;
    const newLifeSub = !ready ? undefined : full ? `All ${maxCharacters} lives in use` : characters.length === 0 ? "Create your character" : undefined;
    const continueSub = status === "connecting" ? "Connecting…" : last ? `as ${last.displayName}` : ready ? "No saved life yet" : undefined;
    const manageSub = ready ? `${characters.length} of ${maxCharacters} lives` : undefined;

    // Keep keyboard focus where the player put it when the menu re-renders (e.g. once
    // connected); if focus was only placed automatically, move it to the main action.
    const active = document.activeElement as HTMLElement | null;
    const hadFocus = Boolean(active && this.menu.contains(active));
    const chosen = hadFocus && !active!.hasAttribute("data-autofocus") ? active!.dataset.action : undefined;
    this.menu.replaceChildren(
      item("New life", "new-life", () => this.actions.onNewLife(), newLifeSub, ready && !last, !ready),
      item("Continue", "continue", () => last && this.actions.onContinue(last), continueSub, Boolean(last), !ready || !last),
      item("Manage characters", "manage", () => this.actions.onManage(), manageSub, false, !ready),
      item("Settings", "settings", () => this.actions.onSettings()),
      item("Credits", "credits", () => this.actions.onCredits()),
    );
    const again = chosen ? this.menu.querySelector<HTMLButtonElement>(`[data-action="${chosen}"]:not(:disabled)`) : null;
    const preferred = this.menu.querySelector<HTMLButtonElement>(".menu-item.is-primary:not(:disabled)") ?? this.menu.querySelector<HTMLButtonElement>(".menu-item:not(:disabled)");
    const target = again ?? preferred;
    if (target && !again) target.setAttribute("data-autofocus", "");
    if (target && hadFocus) target.focus({ preventScroll: true });

    this.renderCard(last);

    this.status.replaceChildren();
    if (status === "offline") {
      this.status.append(el("span", undefined, this.view.message ?? "Can't reach the game server. Check that it is running, then try again. "));
      const retry = el("button", "text-button", "Try again");
      retry.type = "button";
      retry.dataset.action = "retry";
      retry.addEventListener("click", () => this.actions.onRetry());
      this.status.append(retry);
    } else if (this.view.message) {
      this.status.textContent = this.view.message;
    }
  }

  private renderCard(last: CharacterSummary | undefined): void {
    this.card.replaceChildren();
    this.card.hidden = !last;
    if (!last) return;
    const frame = el("div", "portrait-frame");
    const image = el("img", "portrait");
    image.alt = `${last.displayName}, your character`;
    image.width = 192;
    image.height = 240;
    image.dataset.initial = last.displayName.charAt(0).toUpperCase();
    frame.dataset.initial = image.dataset.initial;
    frame.append(image);
    fillPortrait(image, decodeLook(last.look).appearance, "body");
    const text = el("div", "title-card-text");
    text.append(el("p", "title-card-name", last.displayName), el("p", "title-card-meta", relativeTime(last.lastPlayedAt)));
    if (last.traits.length) {
      const traits = el("p", "title-card-traits", last.traits.map((t) => TRAITS[t]?.label ?? t).join(" and "));
      text.append(traits);
    }
    this.card.append(frame, text);
  }
}
