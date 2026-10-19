// Character panel (M5): the player's own needs, mood (with reasons), skills,
// money and current action. Opened by clicking/tapping your own character
// (→ "Character") or the HUD chip. Desktop: a narrow panel on the right.
// Touch: a bottom sheet capped below half the screen height. Everything shown
// comes from the server's `life` message; nothing here is calculated as truth.

import {
  NEEDS_CONFIG,
  NEED_IDS,
  SKILL_CONFIG,
  SKILL_IDS,
  TRAITS,
  formatEuros,
  readClock,
  xpForLevel,
  type LifePayload,
  type MoodLevel,
  type NeedId,
  type SkillId,
  type TraitId,
} from "@padova/shared";

const NEED_LABELS: Record<NeedId, string> = {
  hunger: "Hunger",
  energy: "Energy",
  hygiene: "Hygiene",
  social: "Social",
  fun: "Fun",
};

const SKILL_LABELS: Record<SkillId, string> = {
  academic: "Academic",
  communication: "Communication",
  cooking: "Cooking",
  fitness: "Fitness",
  creativity: "Creativity",
};

const MOOD_LABELS: Record<MoodLevel, string> = {
  miserable: "Miserable",
  low: "Low",
  okay: "Okay",
  good: "Good",
  great: "Great",
};

export interface CharacterPanelActions {
  onEditAppearance(): void;
  onLeaveToTitle(): void;
}

export class CharacterPanel {
  readonly mode: "side" | "sheet";
  private readonly element: HTMLElement;
  private readonly nameElement: HTMLElement;
  private readonly traitsElement: HTMLElement;
  private readonly body: HTMLElement;
  private life: LifePayload | null = null;
  private currentAction: string | null = null;
  private openState = false;

  constructor(root: HTMLElement, actions: CharacterPanelActions) {
    const params = new URLSearchParams(location.search);
    const forced = params.get("menu");
    const coarse = window.matchMedia("(pointer: coarse)").matches;
    this.mode = forced === "sheet" || (forced !== "radial" && coarse) ? "sheet" : "side";

    this.element = document.createElement("aside");
    this.element.id = "character-panel";
    this.element.className = `character-panel is-${this.mode}`;
    this.element.setAttribute("aria-label", "Your character");
    this.element.hidden = true;

    const header = document.createElement("div");
    header.className = "cp-header";
    const titles = document.createElement("div");
    this.nameElement = document.createElement("div");
    this.nameElement.className = "cp-name";
    this.traitsElement = document.createElement("div");
    this.traitsElement.className = "cp-traits";
    titles.append(this.nameElement, this.traitsElement);
    const close = document.createElement("button");
    close.type = "button";
    close.className = "cp-close";
    close.setAttribute("aria-label", "Close character panel");
    close.textContent = "✕";
    close.addEventListener("click", () => this.close());
    header.append(titles, close);

    this.body = document.createElement("div");
    this.body.className = "cp-body";
    const footer = document.createElement("div");
    footer.className = "cp-footer";
    const edit = document.createElement("button");
    edit.type = "button";
    edit.className = "cp-action";
    edit.dataset.action = "edit-appearance";
    edit.textContent = "Edit look";
    edit.addEventListener("click", () => actions.onEditAppearance());
    const leave = document.createElement("button");
    leave.type = "button";
    leave.className = "cp-action";
    leave.dataset.action = "leave-to-title";
    leave.textContent = "Back to title";
    leave.title = "Saves and takes your character out of the piazza";
    leave.addEventListener("click", () => actions.onLeaveToTitle());
    footer.append(edit, leave);
    this.element.append(header, this.body, footer);
    // Taps inside the panel never reach the game view.
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
    this.openState = false;
    this.element.hidden = true;
    document.body.classList.remove("panel-sheet-open");
  }

  toggle(): void {
    if (this.openState) this.close();
    else this.open();
  }

  setIdentity(name: string, traits: readonly TraitId[]): void {
    this.nameElement.textContent = name;
    this.traitsElement.replaceChildren(
      ...traits.map((trait) => {
        const chip = document.createElement("span");
        chip.className = "cp-trait";
        chip.textContent = TRAITS[trait].label;
        chip.title = TRAITS[trait].description;
        return chip;
      }),
    );
  }

  update(life: LifePayload): void {
    this.life = life;
    if (this.openState) this.render();
  }

  setCurrentAction(text: string | null): void {
    if (text === this.currentAction) return;
    this.currentAction = text;
    if (this.openState) this.render();
  }

  /** Read-only snapshot for tests. */
  debugState() {
    return {
      open: this.openState,
      mode: this.mode,
      text: this.openState ? this.element.innerText : "",
    };
  }

  private render(): void {
    const life = this.life;
    if (!life) {
      this.body.replaceChildren(text("p", "cp-muted", "Loading your character…"));
      return;
    }
    this.body.replaceChildren(this.moodSection(life), this.nowSection(life), this.needsSection(life), this.skillsSection(life), this.moneySection(life));
  }

  private moodSection(life: LifePayload): HTMLElement {
    const section = sectionWithTitle("Mood");
    const row = document.createElement("div");
    row.className = `cp-mood is-${life.mood.level}`;
    row.dataset.mood = life.mood.level;
    row.append(text("span", "cp-mood-level", MOOD_LABELS[life.mood.level]), text("span", "cp-mood-score", signed(life.mood.score)));
    const reasons = document.createElement("div");
    reasons.className = "cp-reasons";
    for (const reason of life.mood.reasons.slice(0, 5)) {
      const chip = text("span", reason.value < 0 ? "cp-reason is-negative" : "cp-reason", `${reason.label} ${signed(reason.value)}`);
      reasons.append(chip);
    }
    if (life.mood.reasons.length === 0) reasons.append(text("span", "cp-muted", "Nothing much on your mind."));
    section.append(row, reasons);
    return section;
  }

  private nowSection(life: LifePayload): HTMLElement {
    const section = sectionWithTitle("Now");
    section.append(text("p", "cp-now", `${this.currentAction ?? "Idle"} · ${readClock(life.gameMinute).label}`));
    return section;
  }

  private needsSection(life: LifePayload): HTMLElement {
    const section = sectionWithTitle("Needs");
    for (const need of NEED_IDS) {
      const value = life.needs[need];
      section.append(meter(NEED_LABELS[need], value / 100, String(Math.round(value)), value <= NEEDS_CONFIG.lowWarning, `need-${need}`));
    }
    return section;
  }

  private skillsSection(life: LifePayload): HTMLElement {
    const section = sectionWithTitle("Skills");
    for (const skill of SKILL_IDS) {
      const view = life.skills[skill];
      const next = view.level >= SKILL_CONFIG.maxLevel ? "max" : `${Math.floor(view.xp)}/${xpForLevel(view.level + 1)} XP`;
      section.append(meter(`${SKILL_LABELS[skill]} · Lv ${view.level}`, view.progress, next, false, `skill-${skill}`, true));
    }
    return section;
  }

  private moneySection(life: LifePayload): HTMLElement {
    const section = sectionWithTitle("Money");
    const balance = text("p", "cp-balance", formatEuros(life.money.balanceCents));
    balance.dataset.testid = "balance";
    section.append(balance);
    const list = document.createElement("ul");
    list.className = "cp-ledger";
    for (const entry of life.money.recent.slice(0, 3)) {
      const item = document.createElement("li");
      const amount = entry.direction === "income" ? entry.amountCents : -entry.amountCents;
      item.append(
        text("span", amount < 0 ? "cp-amount is-negative" : "cp-amount", amount < 0 ? formatEuros(amount) : `+${formatEuros(amount)}`),
        text("span", "cp-desc", entry.description),
      );
      list.append(item);
    }
    section.append(list);
    return section;
  }
}

function sectionWithTitle(title: string): HTMLElement {
  const section = document.createElement("section");
  section.className = "cp-section";
  section.append(text("h2", "cp-title", title));
  return section;
}

/** A labelled bar. Stacked: label and value on one line, the bar underneath (for longer labels). */
function meter(label: string, fraction: number, valueText: string, low: boolean, testId: string, stacked = false): HTMLElement {
  const row = document.createElement("div");
  row.className = ["cp-meter", low ? "is-low" : "", stacked ? "is-stacked" : ""].filter(Boolean).join(" ");
  row.dataset.testid = testId;
  const bar = document.createElement("div");
  bar.className = "cp-bar";
  const fill = document.createElement("div");
  fill.className = "cp-fill";
  fill.style.width = `${Math.round(Math.min(1, Math.max(0, fraction)) * 100)}%`;
  bar.append(fill);
  if (stacked) row.append(text("span", "cp-label", label), text("span", "cp-value", valueText), bar);
  else row.append(text("span", "cp-label", label), bar, text("span", "cp-value", valueText));
  return row;
}

function text(tag: string, className: string, content: string): HTMLElement {
  const element = document.createElement(tag);
  element.className = className;
  element.textContent = content;
  return element;
}

const signed = (value: number) => (value > 0 ? `+${Math.round(value)}` : value < 0 ? `−${Math.abs(Math.round(value))}` : "0");
