// New life, step 1: the character's name and (optional) personality.
// Personality changes how needs and skills develop; appearance never does.
// The server validates both again when the character is created.

import { GAME_CONFIG, MAX_TRAITS, TRAITS, TRAIT_IDS, sanitizeDisplayName, type TraitId } from "@padova/shared";
import { button, el } from "./dom.ts";
import { flowHeader } from "./flowChrome.ts";
import type { Screen } from "./screenHost.ts";

export interface SetupValues {
  displayName: string;
  traits: TraitId[];
}

export interface SetupActions {
  onBack(): void;
  onNext(values: SetupValues): void;
}

export class SetupScreen implements Screen {
  readonly element: HTMLElement;
  private readonly input: HTMLInputElement;
  private readonly error: HTMLElement;
  private traits: TraitId[];

  constructor(initial: SetupValues, private readonly actions: SetupActions, errorText?: string) {
    this.traits = [...initial.traits];
    this.element = el("section", "setup-screen flow-screen");
    this.element.dataset.screen = "setup";
    const header = flowHeader({ title: "New life", backLabel: "Title", onBack: () => actions.onBack(), steps: ["Name", "Look", "Review"], current: 0 });

    const form = el("form", "setup-body");
    form.noValidate = true;
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      this.next();
    });

    const intro = el("div", "setup-intro");
    intro.append(
      el("h2", "setup-heading", "Who are you in Padova?"),
      el("p", "setup-lead", "Everyone in the piazza sees this name above your character. It can't be changed later yet."),
    );

    const nameField = el("div", "field");
    const label = el("label", "field-label", "Name");
    this.input = el("input", "text-field name-field");
    this.input.id = "character-name";
    this.input.name = "displayName";
    this.input.setAttribute("autocomplete", "nickname");
    this.input.maxLength = GAME_CONFIG.nameMaxLength;
    this.input.placeholder = "e.g. Giulia";
    this.input.value = initial.displayName;
    this.input.dataset.autofocus = "";
    this.input.setAttribute("aria-describedby", "character-name-hint");
    label.htmlFor = this.input.id;
    const hint = el("p", "field-hint", `${GAME_CONFIG.nameMinLength} to ${GAME_CONFIG.nameMaxLength} characters.`);
    hint.id = "character-name-hint";
    nameField.append(label, this.input, hint);

    const personality = el("fieldset", "trait-picker");
    personality.dataset.field = "traits";
    personality.append(el("legend", "field-label", `Personality, up to ${MAX_TRAITS} (optional)`));
    const row = el("div", "trait-row");
    const buttons: HTMLButtonElement[] = [];
    const refresh = () => {
      for (const b of buttons) {
        const chosen = this.traits.includes(b.dataset.value as TraitId);
        b.setAttribute("aria-pressed", String(chosen));
        b.disabled = !chosen && this.traits.length >= MAX_TRAITS;
      }
    };
    for (const id of TRAIT_IDS) {
      const b = el("button", "trait-option");
      b.type = "button";
      b.dataset.value = id;
      b.append(el("span", "trait-name", TRAITS[id].label), el("span", "trait-desc", TRAITS[id].description));
      b.addEventListener("click", () => {
        this.traits = this.traits.includes(id) ? this.traits.filter((t) => t !== id) : [...this.traits, id].slice(0, MAX_TRAITS);
        refresh();
      });
      buttons.push(b);
      row.append(b);
    }
    refresh();
    personality.append(row, el("p", "field-hint", "Personality changes how your needs and skills develop. Appearance never affects gameplay."));

    const age = el("p", "setup-age", "All player characters are adults (18+) studying or working in Padova.");
    this.error = el("p", "form-error");
    this.error.setAttribute("role", "alert");
    if (errorText) this.error.textContent = errorText;

    const footer = el("div", "flow-footer");
    footer.append(
      button("Back", { className: "ui-button is-quiet", action: "setup-back", onClick: () => actions.onBack() }),
      button("Next: your look", { className: "ui-button is-primary", action: "setup-next", onClick: () => this.next() }),
    );
    form.append(intro, nameField, personality, age, this.error);
    const scroller = el("div", "flow-scroll");
    scroller.append(form);
    this.element.append(header, scroller, footer);
  }

  onEscape(): void {
    this.actions.onBack();
  }

  private next(): void {
    const name = sanitizeDisplayName(this.input.value);
    if (!name) {
      this.error.textContent = `Please enter a name of ${GAME_CONFIG.nameMinLength} to ${GAME_CONFIG.nameMaxLength} characters.`;
      this.input.setAttribute("aria-invalid", "true");
      this.input.focus();
      return;
    }
    this.input.removeAttribute("aria-invalid");
    this.error.textContent = "";
    this.actions.onNext({ displayName: name, traits: [...this.traits] });
  }
}
