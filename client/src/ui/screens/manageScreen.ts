// Character management: every life in this guest profile, with Play,
// Edit look and Delete, and a "New life" slot while there is room.

import { TRAITS, decodeLook, type CharacterSummary } from "@padova/shared";
import { button, el, icon, relativeTime } from "./dom.ts";
import { ICONS } from "./icons.ts";
import { fillPortrait } from "./portraits.ts";
import type { Screen } from "./screenHost.ts";

export interface ManageActions {
  onBack(): void;
  onPlay(character: CharacterSummary): void;
  onEdit(character: CharacterSummary): void;
  onDelete(character: CharacterSummary): void;
  onNewLife(): void;
}

export class ManageScreen implements Screen {
  readonly element: HTMLElement;
  private readonly grid: HTMLElement;
  private readonly count: HTMLElement;
  private readonly status: HTMLElement;

  constructor(
    characters: CharacterSummary[],
    maxCharacters: number,
    private readonly actions: ManageActions,
  ) {
    this.element = el("section", "manage-screen flow-screen");
    this.element.dataset.screen = "manage";
    const header = el("header", "flow-header");
    const back = el("button", "back-button");
    back.type = "button";
    back.dataset.action = "back";
    back.append(icon(ICONS.back), el("span", undefined, "Title"));
    back.addEventListener("click", () => actions.onBack());
    this.count = el("p", "manage-count");
    header.append(back, el("h1", "flow-title", "Your characters"), this.count);
    this.grid = el("div", "life-grid");
    this.status = el("p", "manage-status");
    this.status.setAttribute("role", "status");
    const note = el(
      "p",
      "manage-note",
      "Your lives are kept in a temporary guest profile tied to this browser. Clearing this site's data loses them. Each life has its own needs, money and skills.",
    );
    const scroller = el("div", "flow-scroll");
    scroller.append(this.grid, this.status, note);
    this.element.append(header, scroller);
    this.update(characters, maxCharacters);
  }

  onEscape(): void {
    this.actions.onBack();
  }

  setStatus(text: string): void {
    this.status.textContent = text;
  }

  update(characters: CharacterSummary[], maxCharacters: number): void {
    this.count.textContent = `${characters.length} of ${maxCharacters} lives`;
    const cards = characters.map((character) => this.card(character));
    if (characters.length < maxCharacters) {
      const slot = el("button", "life-card is-new");
      slot.type = "button";
      slot.dataset.action = "new-life";
      const left = maxCharacters - characters.length;
      slot.append(icon(ICONS.plus), el("span", "life-new-label", "New life"), el("span", "life-new-sub", left === 1 ? "1 place left" : `${left} places left`));
      slot.addEventListener("click", () => this.actions.onNewLife());
      cards.push(slot);
    }
    this.grid.replaceChildren(...cards);
    if (characters.length === 0) this.setStatus("No characters yet. Start a new life to create one.");
  }

  private card(character: CharacterSummary): HTMLElement {
    const card = el("article", "life-card");
    card.dataset.characterId = character.characterId;
    card.setAttribute("aria-label", character.displayName);
    const frame = el("div", "portrait-frame");
    frame.dataset.initial = character.displayName.charAt(0).toUpperCase();
    const image = el("img", "portrait");
    image.alt = "";
    image.width = 192;
    image.height = 240;
    fillPortrait(image, decodeLook(character.look).appearance, "body");
    frame.append(image);
    const text = el("div", "life-text");
    text.append(el("h2", "life-name", character.displayName), el("p", "life-meta", relativeTime(character.lastPlayedAt)));
    if (character.traits.length) text.append(el("p", "life-traits", character.traits.map((t) => TRAITS[t]?.label ?? t).join(" and ")));
    for (const notice of character.notices) text.append(el("p", "life-notice", notice));
    if (character.readOnly) text.append(el("p", "life-notice", "Saved by a newer version of the game: you can play, but not change the look here."));
    const actions = el("div", "life-actions");
    const edit = button("Edit look", { className: "ui-button is-quiet", action: "edit-look", onClick: () => this.actions.onEdit(character) });
    edit.disabled = character.readOnly;
    actions.append(
      button("Play", { className: "ui-button is-primary", action: "play", onClick: () => this.actions.onPlay(character) }),
      edit,
      button("Delete", { className: "ui-button is-danger-quiet", action: "delete", onClick: () => this.actions.onDelete(character) }),
    );
    card.append(frame, text, actions);
    return card;
  }
}
