// The profile panel: "connecting", "create your character", "edit
// appearance", and plain messages (e.g. signed in elsewhere). Creating and
// editing use the full character creator (creator.ts) with a live 3D
// preview. Choices are validated again by the server.

import {
  DEFAULT_APPEARANCE,
  GAME_CONFIG,
  MAX_TRAITS,
  TRAITS,
  TRAIT_IDS,
  cloneAppearance,
  type AppearanceConfig,
  type CharacterProfile,
  type NewCharacterInput,
  type TraitId,
} from "@padova/shared";
import { CharacterCreator } from "./creator.ts";

export type PanelMode = "hidden" | "connecting" | "create" | "edit" | "message";

export class ProfilePanel {
  mode: PanelMode = "hidden";
  private traits: TraitId[] = [];
  private errorElement: HTMLElement | null = null;
  private submitButton: HTMLButtonElement | null = null;
  private creator: CharacterCreator | null = null;
  /** Told when the full-screen creator opens or closes (the world needn't render behind it). */
  onCoverChange: ((covered: boolean) => void) | null = null;

  constructor(private readonly element: HTMLElement) {}

  showConnecting(text = "Connecting to the piazza…"): void {
    this.render("connecting", (body) => {
      body.append(heading("Padova Life SIM"), paragraph(text, "join-sub"));
    });
  }

  /** First visit: name, appearance and personality. Player characters are adults. */
  showCreate(onSubmit: (input: NewCharacterInput) => void, notice?: string): void {
    this.traits = [];
    const label = document.createElement("label");
    label.htmlFor = "character-name";
    label.textContent = "Name";
    const input = document.createElement("input");
    input.id = "character-name";
    input.name = "displayName";
    input.setAttribute("autocomplete", "nickname");
    input.maxLength = GAME_CONFIG.nameMaxLength;
    input.placeholder = "e.g. Giulia";
    const nameRow = document.createElement("div");
    nameRow.className = "creator-name";
    nameRow.append(label, input);
    const header: HTMLElement[] = [];
    if (notice) header.push(paragraph(notice, "join-notice"));
    header.push(nameRow);
    const personality = document.createElement("div");
    personality.append(this.traitPicker(), paragraph("Personality affects how your character's needs and skills change. Appearance never does.", "picker-note"));

    this.renderCreator("create", { mode: "create", initial: cloneAppearance(DEFAULT_APPEARANCE), header, personality }, (actions) => {
      actions.append(
        this.actions("Create character", () => {
          onSubmit({ displayName: input.value, ageCategory: "adult", appearance: this.creator!.value, traits: [...this.traits] });
        }),
        paragraph("Age: adult (18+). All player characters are university-age adults. Your progress is saved to a temporary guest profile in this browser. Not affiliated with the University of Padua.", "join-note"),
      );
    });
    queueMicrotask(() => input.focus());
  }

  /** Change appearance of an existing character. Name and age are not editable yet. */
  showEdit(profile: CharacterProfile, onSave: (appearance: AppearanceConfig) => void, onCancel: () => void, readOnly = false): void {
    if (readOnly) {
      this.render("edit", (body) => {
        body.append(heading("Edit appearance"), paragraph(profile.displayName, "join-sub"));
        body.append(paragraph("This profile was saved by a newer version of the game and can't be edited here.", "join-notice"));
        body.append(this.actions("Close", onCancel));
      });
      return;
    }
    this.renderCreator("edit", { mode: "edit", initial: profile.appearance, header: [paragraph(profile.displayName, "join-sub")] }, (actions) => {
      const buttons = this.actions("Save changes", () => onSave(this.creator!.value));
      const cancel = document.createElement("button");
      cancel.type = "button";
      cancel.className = "secondary";
      cancel.textContent = "Cancel";
      cancel.addEventListener("click", onCancel);
      buttons.querySelector(".panel-actions")?.append(cancel);
      actions.append(buttons);
    });
  }

  showMessage(title: string, text: string, actionLabel: string, onAction: () => void): void {
    this.render("message", (body) => {
      body.append(heading(title), paragraph(text, "join-sub"));
      body.append(this.actions(actionLabel, onAction));
    });
  }

  showError(text: string): void {
    if (this.errorElement) this.errorElement.textContent = text;
    this.setBusy(false);
  }

  setBusy(busy: boolean): void {
    if (this.submitButton) this.submitButton.disabled = busy;
  }

  hide(): void {
    this.mode = "hidden";
    this.destroyCreator();
    this.element.hidden = true;
    this.element.classList.remove("is-creator");
    this.element.replaceChildren();
    this.errorElement = null;
    this.submitButton = null;
  }

  // ── Building blocks ─────────────────────────────────────────────────────

  private destroyCreator(): void {
    if (this.creator) this.onCoverChange?.(false);
    this.creator?.destroy();
    this.creator = null;
  }

  private render(mode: PanelMode, build: (body: HTMLElement) => void): void {
    this.destroyCreator();
    this.mode = mode;
    this.element.classList.remove("is-creator");
    this.element.replaceChildren();
    this.errorElement = null;
    this.submitButton = null;
    const form = document.createElement("form");
    form.className = "panel-form";
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      this.submitButton?.click();
    });
    build(form);
    this.element.append(form);
    this.element.dataset.mode = mode;
    this.element.hidden = false;
  }

  private renderCreator(mode: "create" | "edit", options: ConstructorParameters<typeof CharacterCreator>[0], buildActions: (actions: HTMLElement) => void): void {
    this.destroyCreator();
    this.mode = mode;
    this.element.replaceChildren();
    this.errorElement = null;
    this.submitButton = null;
    this.element.classList.add("is-creator");
    this.element.dataset.mode = mode;
    this.element.hidden = false;
    try {
      this.creator = new CharacterCreator(options);
    } catch (error) {
      // No WebGL (or it failed): say so rather than showing a creator with an empty preview.
      console.error("Character creator unavailable", error);
      this.element.classList.remove("is-creator");
      this.render("message", (body) => {
        body.append(heading("3D preview unavailable"), paragraph("This browser couldn't start the 3D preview (WebGL). Try another browser or update your graphics drivers.", "join-sub"));
        body.append(this.actions("Reload", () => location.reload()));
      });
      return;
    }
    this.onCoverChange?.(true);
    const actions = document.createElement("div");
    actions.className = "creator-actions";
    buildActions(actions);
    this.creator.element.querySelector(".creator-side")!.append(actions);
    const form = document.createElement("form");
    form.className = "creator-form";
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      this.submitButton?.click();
    });
    form.append(this.creator.element);
    this.element.append(form);
    this.creator.mounted();
  }

  /** Up to MAX_TRAITS personality traits. Chosen once, at creation (validated again by the server). */
  private traitPicker(): HTMLElement {
    const group = document.createElement("div");
    group.className = "picker-group trait-picker";
    group.setAttribute("role", "group");
    group.setAttribute("aria-label", "Personality");
    group.dataset.field = "traits";
    const title = document.createElement("div");
    title.className = "picker-title";
    title.textContent = `Personality (pick up to ${MAX_TRAITS}, optional)`;
    const row = document.createElement("div");
    row.className = "trait-row";
    const buttons: HTMLButtonElement[] = [];
    const refresh = () => {
      for (const button of buttons) {
        const chosen = this.traits.includes(button.dataset.value as TraitId);
        button.setAttribute("aria-pressed", String(chosen));
        button.disabled = !chosen && this.traits.length >= MAX_TRAITS;
      }
    };
    for (const id of TRAIT_IDS) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "trait-option";
      button.dataset.value = id;
      const name = document.createElement("span");
      name.className = "trait-name";
      name.textContent = TRAITS[id].label;
      const description = document.createElement("span");
      description.className = "trait-desc";
      description.textContent = TRAITS[id].description;
      button.append(name, description);
      button.addEventListener("click", () => {
        this.traits = this.traits.includes(id) ? this.traits.filter((trait) => trait !== id) : [...this.traits, id].slice(0, MAX_TRAITS);
        refresh();
      });
      buttons.push(button);
      row.append(button);
    }
    refresh();
    group.append(title, row);
    return group;
  }

  private actions(label: string, onClick: () => void): HTMLElement {
    const actions = document.createElement("div");
    actions.className = "panel-actions";
    this.errorElement = document.createElement("p");
    this.errorElement.className = "join-error";
    this.errorElement.setAttribute("role", "alert");
    const button = document.createElement("button");
    button.type = "button";
    button.className = "primary";
    button.textContent = label;
    button.addEventListener("click", () => {
      if (this.errorElement) this.errorElement.textContent = "";
      onClick();
    });
    this.submitButton = button;
    actions.append(button);
    const wrapper = document.createElement("div");
    wrapper.append(this.errorElement, actions);
    return wrapper;
  }
}

function heading(text: string): HTMLElement {
  const h = document.createElement("h1");
  h.textContent = text;
  return h;
}

function paragraph(text: string, className: string): HTMLElement {
  const p = document.createElement("p");
  p.className = className;
  p.textContent = text;
  return p;
}
