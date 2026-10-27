// Another player's card (M9): their name, look and what they are doing, and
// your relationship with them (level, friendship bar, how long you've known
// each other, your last shared moments). Block or unblock and report are at
// the bottom. Only public facts about them are shown: never their needs,
// money, skills or traits. The relationship comes from the server
// (`profileView`), private to the two of you. Desktop: the right-hand column
// like the character panel; touch: a bottom sheet.

import { RELATIONSHIP_CONFIG, type AppearanceConfig, type ProfileViewPayload } from "@padova/shared";
import { ACTIVITY_SUBTITLE } from "./activity.ts";
import { fillPortrait } from "./screens/portraits.ts";
import { dayLabel, momentLabel } from "./story.ts";

export interface PlayerCardInfo {
  name: string;
  look: AppearanceConfig;
  activity: string;
  connected: boolean;
}

export interface PlayerCardActions {
  onBlock(targetId: string): void;
  onUnblock(targetId: string): void;
  onReport(targetId: string): void;
  onClose(): void;
}

export class PlayerCard {
  readonly mode: "side" | "sheet";
  private readonly element: HTMLElement;
  private readonly nameElement: HTMLElement;
  private readonly subtitle: HTMLElement;
  private readonly portrait: HTMLImageElement;
  private readonly body: HTMLElement;
  /** Kept across redraws so a tap on them is never lost. */
  private readonly blockButton: HTMLButtonElement;
  private readonly reportButton: HTMLButtonElement;
  private target: string | null = null;
  private profile: ProfileViewPayload | null = null;
  private blocked = false;
  private lookKey = "";

  constructor(root: HTMLElement, private readonly actions: PlayerCardActions) {
    const params = new URLSearchParams(location.search);
    const forced = params.get("menu");
    const coarse = window.matchMedia("(pointer: coarse)").matches;
    this.mode = forced === "sheet" || (forced !== "radial" && coarse) ? "sheet" : "side";

    this.element = document.createElement("aside");
    this.element.id = "player-card";
    this.element.className = `character-panel player-card is-${this.mode}`;
    this.element.setAttribute("aria-label", "Player card");
    this.element.hidden = true;

    const header = document.createElement("div");
    header.className = "cp-header";
    const titles = document.createElement("div");
    this.nameElement = element("div", "cp-name");
    this.subtitle = element("div", "cp-muted pc-activity");
    titles.append(this.nameElement, this.subtitle);
    const close = document.createElement("button");
    close.type = "button";
    close.className = "cp-close";
    close.setAttribute("aria-label", "Close player card");
    close.textContent = "✕";
    close.addEventListener("click", () => this.close());
    header.append(titles, close);

    const top = element("div", "pc-top");
    this.portrait = document.createElement("img");
    this.portrait.className = "pc-portrait";
    this.portrait.alt = "";
    top.append(this.portrait);
    this.body = element("div", "cp-body");
    this.body.prepend(top);

    const footer = element("div", "cp-footer");
    this.blockButton = button("Block", "block");
    this.blockButton.addEventListener("click", () => {
      if (!this.target) return;
      if (this.blocked) this.actions.onUnblock(this.target);
      else this.actions.onBlock(this.target);
    });
    this.reportButton = button("Report", "report");
    this.reportButton.addEventListener("click", () => this.target && this.actions.onReport(this.target));
    footer.append(this.blockButton, this.reportButton);
    this.element.append(header, this.body, footer);
    this.element.addEventListener("pointerdown", (event) => event.stopPropagation());
    root.appendChild(this.element);
  }

  get isOpen(): boolean {
    return this.target !== null;
  }

  get targetId(): string | null {
    return this.target;
  }

  /** Opens the card for a player; the relationship arrives with `setProfile`. */
  open(targetId: string, info: PlayerCardInfo, blocked: boolean): void {
    if (this.target !== targetId) this.profile = null;
    this.target = targetId;
    this.blocked = blocked;
    this.element.hidden = false;
    document.body.classList.toggle("panel-sheet-open", this.mode === "sheet");
    this.setInfo(info);
    this.render();
  }

  close(): void {
    if (this.target === null) return;
    this.target = null;
    this.profile = null;
    this.element.hidden = true;
    document.body.classList.remove("panel-sheet-open");
    this.actions.onClose();
  }

  /** Name, look and activity changed (or first shown). */
  setInfo(info: PlayerCardInfo): void {
    this.nameElement.textContent = info.name;
    this.subtitle.textContent = info.connected ? (ACTIVITY_SUBTITLE[info.activity] ?? "Hanging out") : "Away";
    const key = JSON.stringify(info.look);
    if (key !== this.lookKey) {
      this.lookKey = key;
      this.portrait.alt = `${info.name}'s look`;
      fillPortrait(this.portrait, info.look, "bust");
    }
  }

  setProfile(profile: ProfileViewPayload): void {
    if (profile.targetId !== this.target) return;
    this.profile = profile;
    this.blocked = profile.blockedByYou;
    this.render();
  }

  setBlocked(blocked: boolean): void {
    if (blocked === this.blocked) return;
    this.blocked = blocked;
    this.render();
  }

  /** Read-only snapshot for tests. */
  debugState() {
    return { open: this.isOpen, targetId: this.target, mode: this.mode, blocked: this.blocked, text: this.isOpen ? this.element.innerText : "" };
  }

  private render(): void {
    const top = this.body.querySelector(".pc-top")!;
    const section = element("section", "cp-section");
    section.dataset.testid = "relationship";
    section.append(element("h2", "cp-title", "You and them"));
    const relationship = this.profile?.relationship;
    if (!this.profile) {
      section.append(element("p", "cp-muted", "Loading…"));
    } else if (!relationship) {
      section.append(element("p", "cp-muted", "You haven't spent time together yet. Greet them, chat, or study at the same table to get to know each other."));
    } else {
      const level = element("p", "cp-job", relationship.label);
      level.dataset.testid = "relationship-level";
      section.append(level, friendshipMeter(relationship.score), element("p", "cp-muted", `Known since ${dayLabel(relationship.sinceGameMinute)}`));
      const list = element("ul", "pc-moments");
      for (const moment of relationship.recent) {
        const item = element("li", "");
        item.append(element("span", "pc-moment", momentLabel(moment.kind)), element("span", "cp-muted", dayLabel(moment.gameMinute)));
        list.append(item);
      }
      section.append(list);
    }
    const safety = element("section", "cp-section");
    if (this.blocked) {
      const note = element("p", "cp-muted", "You blocked them: you can't greet or chat with each other. They aren't told.");
      note.dataset.testid = "blocked-note";
      safety.append(note);
    }
    this.blockButton.querySelector(".pc-button-label")!.textContent = this.blocked ? "Unblock" : "Block";
    this.blockButton.dataset.action = this.blocked ? "unblock" : "block";
    this.body.replaceChildren(top, section, safety);
  }
}

function friendshipMeter(score: number): HTMLElement {
  const row = element("div", "cp-meter is-stacked");
  row.dataset.testid = "friendship";
  const bar = element("div", "cp-bar");
  const fill = element("div", "cp-fill");
  fill.style.width = `${Math.round((score / RELATIONSHIP_CONFIG.maxScore) * 100)}%`;
  bar.append(fill);
  row.append(element("span", "cp-label", "Friendship"), element("span", "cp-value", `${score} of ${RELATIONSHIP_CONFIG.maxScore}`), bar);
  return row;
}

function element(tag: string, className: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(label: string, action: string): HTMLButtonElement {
  const node = document.createElement("button");
  node.type = "button";
  node.className = "cp-action";
  node.dataset.action = action;
  node.append(element("span", "pc-button-label", label));
  return node;
}
