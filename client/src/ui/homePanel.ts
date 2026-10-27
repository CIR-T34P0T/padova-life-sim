// Furnishing your home (M10): the room's fixed spots, what stands in each
// (yours, the room's own, or nothing), and per spot what you can do: put your
// piece away, place one from your storage, or buy one from the catalogue.
// Opened at home from your own menu or the character panel. Desktop: the
// right-hand column like the character panel; touch: a bottom sheet. Every
// change is a request; the server checks it and answers (`furnishResult`),
// then sends the new home (`housing`). Prices come from the shared catalogue
// and are charged by the server.

import {
  FURNITURE,
  FURNITURE_IDS,
  formatEuros,
  furnishedSlots,
  type FurnitureId,
  type FurnitureView,
  type HomeView,
} from "@padova/shared";
import { cosinessLine, furnitureLabel, roomLabel } from "./housing.ts";

export interface HomePanelActions {
  onBuy(slot: string, itemId: FurnitureId): void;
  onPlace(slot: string, furnitureId: string): void;
  onPutAway(furnitureId: string): void;
  onClose(): void;
}

/** A request without an answer re-enables the buttons after this long. */
const ANSWER_TIMEOUT_MS = 6_000;

export class HomePanel {
  readonly mode: "side" | "sheet";
  private readonly element: HTMLElement;
  private readonly title: HTMLElement;
  private readonly subtitle: HTMLElement;
  private readonly body: HTMLElement;
  private home: HomeView | null = null;
  private storage: FurnitureView[] = [];
  private balanceCents: number | null = null;
  private openState = false;
  /** Spots unfolded by the player, kept across redraws. */
  private readonly unfolded = new Set<string>();
  private waiting: ReturnType<typeof setTimeout> | null = null;
  /** What the last drawing showed: redrawn only when it changes, so a button is never replaced under the pointer. */
  private drawnKey = "";

  constructor(
    root: HTMLElement,
    private readonly actions: HomePanelActions,
  ) {
    const params = new URLSearchParams(location.search);
    const forced = params.get("menu");
    const coarse = window.matchMedia("(pointer: coarse)").matches;
    this.mode = forced === "sheet" || (forced !== "radial" && coarse) ? "sheet" : "side";

    this.element = document.createElement("aside");
    this.element.id = "home-panel";
    this.element.className = `character-panel home-panel is-${this.mode}`;
    this.element.setAttribute("aria-label", "Furnish your room");
    this.element.hidden = true;

    const header = el("div", "cp-header");
    const titles = el("div", "");
    this.title = el("div", "cp-name", "Your room");
    this.subtitle = el("div", "cp-muted");
    titles.append(this.title, this.subtitle);
    const close = document.createElement("button");
    close.type = "button";
    close.className = "cp-close";
    close.setAttribute("aria-label", "Close the furnishing panel");
    close.textContent = "✕";
    close.addEventListener("click", () => this.close());
    header.append(titles, close);
    this.body = el("div", "cp-body");
    this.element.append(header, this.body);
    this.element.addEventListener("pointerdown", (event) => event.stopPropagation());
    root.appendChild(this.element);
  }

  get isOpen(): boolean {
    return this.openState;
  }

  open(): void {
    this.openState = true;
    this.element.hidden = false;
    document.body.classList.toggle("panel-sheet-open", this.mode === "sheet");
    this.render();
  }

  close(): void {
    if (!this.openState) return;
    this.openState = false;
    this.element.hidden = true;
    document.body.classList.remove("panel-sheet-open");
    this.actions.onClose();
  }

  /** The home, storage or money changed. */
  update(home: HomeView | null, storage: FurnitureView[], balanceCents: number | null): void {
    this.home = home;
    this.storage = storage;
    this.balanceCents = balanceCents;
    if (this.openState && this.key() !== this.drawnKey) this.render();
  }

  private key(): string {
    const affordable = FURNITURE_IDS.filter((id) => this.balanceCents === null || (FURNITURE[id].priceCents ?? 0) <= this.balanceCents);
    return JSON.stringify([this.home, this.storage, affordable, this.waiting !== null]);
  }

  /** The server answered the last request: buttons work again. */
  answered(): void {
    if (this.waiting) clearTimeout(this.waiting);
    this.waiting = null;
    if (this.openState) this.render();
  }

  /** Read-only snapshot for tests. */
  debugState() {
    return { open: this.openState, mode: this.mode, waiting: this.waiting !== null, text: this.openState ? this.element.innerText : "" };
  }

  private request(send: () => void): void {
    if (this.waiting) return;
    send();
    this.waiting = setTimeout(() => this.answered(), ANSWER_TIMEOUT_MS);
    this.render();
  }

  private render(): void {
    this.drawnKey = this.key();
    const home = this.home;
    if (!home) {
      this.title.textContent = "Your room";
      this.subtitle.textContent = "";
      this.body.replaceChildren(el("p", "cp-muted", "You don't have a room. Rent one at the student housing's door."));
      return;
    }
    this.title.textContent = `Your ${roomLabel(home.roomType).toLowerCase()}`;
    this.subtitle.textContent = cosinessLine(home.cosiness);
    const busy = this.waiting !== null;
    const spots = furnishedSlots(home.roomType, home.placements).map(({ slot, itemId, yours }) => {
      const details = document.createElement("details");
      details.className = "hp-spot";
      details.dataset.spot = slot.id;
      details.open = this.unfolded.has(slot.id);
      details.addEventListener("toggle", () => {
        if (details.open) this.unfolded.add(slot.id);
        else this.unfolded.delete(slot.id);
      });
      const summary = document.createElement("summary");
      summary.append(el("span", "hp-spot-label", slot.label), el("span", "cp-muted", itemId ? furnitureLabel(itemId) : "Empty"));
      details.append(summary);
      const options = el("div", "hp-options");
      const piece = yours ? home.placements.find((p) => p.slot === slot.id) : undefined;
      if (piece) {
        options.append(this.button("Put away", "Keeps it in your storage", busy, () => this.request(() => this.actions.onPutAway(piece.furnitureId)), { putAway: piece.furnitureId }));
      } else {
        for (const stored of this.storage.filter((s) => FURNITURE[s.itemId].category === slot.category)) {
          options.append(this.button(`Place: ${furnitureLabel(stored.itemId)}`, "From your storage", busy, () => this.request(() => this.actions.onPlace(slot.id, stored.furnitureId)), { place: stored.furnitureId }));
        }
        for (const id of FURNITURE_IDS) {
          const item = FURNITURE[id];
          if (item.category !== slot.category || item.priceCents === null) continue;
          const short = this.balanceCents !== null && this.balanceCents < item.priceCents;
          const detail = short ? `${formatEuros(item.priceCents)} · not enough money` : `${formatEuros(item.priceCents)} · ${item.blurb}`;
          options.append(this.button(`Buy: ${item.label}`, detail, busy || short, () => this.request(() => this.actions.onBuy(slot.id, id)), { buy: id }));
        }
      }
      details.append(options);
      return details;
    });
    const spotsSection = el("section", "cp-section");
    spotsSection.append(el("h2", "cp-title", "Spots in your room"), el("p", "cp-muted", "Each spot takes one piece: a bed, a seat or a decoration."), ...spots);
    const storageSection = el("section", "cp-section");
    storageSection.dataset.testid = "storage";
    storageSection.append(el("h2", "cp-title", "Storage"));
    if (this.storage.length === 0) storageSection.append(el("p", "cp-muted", "Empty. Pieces you put away or leave behind when you move are kept here."));
    else {
      const list = el("ul", "cp-transactions");
      for (const piece of this.storage) list.append(el("li", "", furnitureLabel(piece.itemId)));
      storageSection.append(list);
    }
    this.body.replaceChildren(spotsSection, storageSection);
  }

  private button(label: string, detail: string, disabled: boolean, onClick: () => void, data: Record<string, string>): HTMLButtonElement {
    const node = document.createElement("button");
    node.type = "button";
    node.className = "hp-option";
    node.disabled = disabled;
    for (const [key, value] of Object.entries(data)) node.dataset[key] = value;
    node.append(el("span", "hp-option-label", label), el("span", "hp-option-detail", detail));
    node.addEventListener("click", onClick);
    return node;
  }
}

function el(tag: string, className: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
