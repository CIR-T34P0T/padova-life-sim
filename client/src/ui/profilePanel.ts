// The profile panel: "connecting", "create your character", "edit
// appearance", and plain messages (e.g. signed in elsewhere). A MINIMAL form
// for M4 persistence; the full character creator (live preview, more
// options) is a later milestone. Choices are validated again by the server.

import {
  APPEARANCE_CATALOGUE,
  APPEARANCE_FIELDS,
  DEFAULT_APPEARANCE,
  GAME_CONFIG,
  type Appearance,
  type CatalogueOption,
  type CharacterProfile,
  type NewCharacterInput,
} from "@padova/shared";

export type PanelMode = "hidden" | "connecting" | "create" | "edit" | "message";

const GROUP_LABELS: Record<keyof Appearance, string> = {
  preset: "Body",
  skinTone: "Skin tone",
  hairStyle: "Hair style",
  hairColour: "Hair colour",
  eyeColour: "Eye colour",
  outfit: "Outfit",
};

export class ProfilePanel {
  mode: PanelMode = "hidden";
  private appearance: Appearance = { ...DEFAULT_APPEARANCE };
  private errorElement: HTMLElement | null = null;
  private submitButton: HTMLButtonElement | null = null;

  constructor(private readonly element: HTMLElement) {}

  showConnecting(text = "Connecting to the piazza…"): void {
    this.render("connecting", (body) => {
      body.append(heading("Padova Life SIM"), paragraph(text, "join-sub"));
    });
  }

  /** First visit: name + appearance. Player characters are adults. */
  showCreate(onSubmit: (input: NewCharacterInput) => void, notice?: string): void {
    this.appearance = { ...DEFAULT_APPEARANCE };
    this.render("create", (body) => {
      body.append(heading("Create your character"));
      if (notice) body.append(paragraph(notice, "join-notice"));
      const label = document.createElement("label");
      label.htmlFor = "character-name";
      label.textContent = "Name";
      const input = document.createElement("input");
      input.id = "character-name";
      input.name = "displayName";
      input.setAttribute("autocomplete", "nickname");
      input.maxLength = GAME_CONFIG.nameMaxLength;
      input.placeholder = "e.g. Giulia";
      body.append(label, input, this.pickers());
      body.append(paragraph("Age: adult (18+). All player characters are university-age adults.", "join-note"));
      body.append(this.actions("Create character", () => {
        onSubmit({ displayName: input.value, ageCategory: "adult", appearance: { ...this.appearance } });
      }));
      body.append(paragraph("Your progress is saved to a temporary guest profile in this browser. Clearing site data, or using another device, starts over.", "join-note"));
      body.append(paragraph("A fan-made game. Not affiliated with the University of Padua.", "join-note"));
      queueMicrotask(() => input.focus());
    });
  }

  /** Change appearance of an existing character. Name and age are not editable yet. */
  showEdit(profile: CharacterProfile, onSave: (appearance: Appearance) => void, onCancel: () => void, readOnly = false): void {
    this.appearance = { ...profile.appearance };
    this.render("edit", (body) => {
      body.append(heading("Edit appearance"), paragraph(profile.displayName, "join-sub"));
      if (readOnly) {
        body.append(paragraph("This profile was saved by a newer version of the game and can't be edited here.", "join-notice"));
      } else {
        body.append(this.pickers());
      }
      const actions = this.actions(readOnly ? "Close" : "Save changes", () => (readOnly ? onCancel() : onSave({ ...this.appearance })));
      if (!readOnly) {
        const cancel = document.createElement("button");
        cancel.type = "button";
        cancel.className = "secondary";
        cancel.textContent = "Cancel";
        cancel.addEventListener("click", onCancel);
        actions.querySelector(".panel-actions")?.append(cancel);
      }
      body.append(actions);
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
    this.element.hidden = true;
    this.element.replaceChildren();
    this.errorElement = null;
    this.submitButton = null;
  }

  // ── Building blocks ─────────────────────────────────────────────────────

  private render(mode: PanelMode, build: (body: HTMLElement) => void): void {
    this.mode = mode;
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

  private pickers(): HTMLElement {
    const container = document.createElement("div");
    container.className = "pickers";
    for (const field of Object.keys(APPEARANCE_FIELDS) as (keyof Appearance)[]) {
      const options: readonly CatalogueOption[] = APPEARANCE_CATALOGUE[APPEARANCE_FIELDS[field]];
      const group = document.createElement("div");
      group.className = "picker-group";
      group.setAttribute("role", "radiogroup");
      group.setAttribute("aria-label", GROUP_LABELS[field]);
      group.dataset.field = field;
      const title = document.createElement("div");
      title.className = "picker-title";
      title.textContent = GROUP_LABELS[field];
      const row = document.createElement("div");
      row.className = "picker-row";
      for (const option of options) {
        const button = document.createElement("button");
        button.type = "button";
        button.setAttribute("role", "radio");
        button.dataset.value = option.id;
        button.title = option.label;
        button.setAttribute("aria-label", option.label);
        if (option.colour) {
          button.className = "swatch";
          button.style.setProperty("--swatch", option.colour);
        } else {
          button.className = "pill-option";
          button.textContent = option.label;
        }
        const select = () => {
          this.appearance[field] = option.id;
          for (const sibling of row.querySelectorAll("button")) sibling.setAttribute("aria-checked", String(sibling === button));
        };
        button.setAttribute("aria-checked", String(this.appearance[field] === option.id));
        button.addEventListener("click", select);
        row.append(button);
      }
      group.append(title, row);
      container.append(group);
    }
    return container;
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
