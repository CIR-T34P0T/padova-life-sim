// New life steps 2 and 3 (look, review) and "Edit look": the character
// creator with its live 3D preview, then a review card with the final
// confirmation. Nothing is sent to the server until the player confirms on
// the review step; cancelling discards the changes.

import {
  CATEGORY_LABELS,
  TRAITS,
  changedCategories,
  describeLook,
  type AppearanceConfig,
  type CreatorCategory,
  type TraitId,
} from "@padova/shared";
import { CharacterCreator } from "../creator.ts";
import { button, el } from "./dom.ts";
import { flowHeader } from "./flowChrome.ts";
import type { Screen } from "./screenHost.ts";

export type CreatorStep = "look" | "review";

export interface CreatorScreenOptions {
  mode: "create" | "edit";
  displayName: string;
  traits: readonly TraitId[];
  /** Look the creator opens with (the draft when coming back to it). */
  start: AppearanceConfig;
  /** What reset and compare go back to: the starting look (create) or the saved look (edit). */
  base: AppearanceConfig;
  readOnly?: boolean;
  onBack(): void;
  onChange(appearance: AppearanceConfig): void;
  onConfirm(appearance: AppearanceConfig): void;
}

export class CreatorScreen implements Screen {
  readonly element: HTMLElement;
  readonly creator: CharacterCreator;
  private step: CreatorStep = "look";
  private readonly side: HTMLElement;
  private readonly header: HTMLElement;
  private readonly review: HTMLElement;
  private readonly footer: HTMLElement;
  private errorElement: HTMLElement | null = null;
  private confirmButton: HTMLButtonElement | null = null;
  private busy = false;

  constructor(private readonly options: CreatorScreenOptions) {
    this.element = el("section", "creator-screen creator flow-screen");
    this.element.dataset.screen = options.mode === "create" ? "creator" : "edit-look";
    this.element.dataset.mode = options.mode;
    this.header = el("div", "flow-header-slot");
    // Throws without WebGL; the flow shows a message instead of an empty preview.
    this.creator = new CharacterCreator({ mode: options.mode, initial: options.base, host: this.element, onChange: (look) => options.onChange(look) });
    if (!sameLook(options.start, options.base)) this.creator.startFrom(options.start);

    const body = el("div", "creator-body");
    this.side = el("div", "creator-side");
    this.review = el("div", "review-card");
    this.review.hidden = true;
    this.footer = el("div", "flow-footer creator-footer");
    this.side.append(this.creator.controls, this.review);
    body.append(this.creator.preview, this.side);
    this.element.append(this.header, body, this.footer);
    this.showStep("look");
  }

  mounted(): void {
    this.creator.mounted();
  }

  destroy(): void {
    this.creator.destroy();
  }

  onEscape(): void {
    if (this.step === "review") this.showStep("look");
    else this.options.onBack();
  }

  get currentStep(): CreatorStep {
    return this.step;
  }

  showStep(step: CreatorStep, category?: CreatorCategory): void {
    this.step = step;
    this.element.dataset.step = step;
    const create = this.options.mode === "create";
    const steps = create ? ["Name", "Look", "Review"] : ["Look", "Review"];
    const current = (create ? 1 : 0) + (step === "review" ? 1 : 0);
    this.header.replaceChildren(
      flowHeader({
        title: create ? "New life" : `Edit look: ${this.options.displayName}`,
        backLabel: step === "review" ? "Look" : create ? "Name" : "Cancel",
        onBack: () => (step === "review" ? this.showStep("look") : this.options.onBack()),
        steps,
        current,
      }),
    );
    this.creator.controls.hidden = step === "review";
    this.review.hidden = step !== "review";
    this.creator.setReviewing(step === "review");
    if (category) this.creator.showCategory(category);
    this.footer.replaceChildren();
    if (step === "look") {
      this.footer.append(
        button(create ? "Back" : "Cancel", { className: "ui-button is-quiet", action: create ? "creator-back" : "creator-cancel", onClick: () => this.options.onBack() }),
        button("Review", { className: "ui-button is-primary", action: "creator-review", onClick: () => this.showStep("review") }),
      );
      this.errorElement = null;
      this.confirmButton = null;
    } else {
      this.renderReview();
      this.review.querySelector<HTMLElement>("h2")?.focus({ preventScroll: true });
    }
  }

  setError(text: string): void {
    if (this.step !== "review") this.showStep("review");
    this.setBusy(false);
    if (this.errorElement) this.errorElement.textContent = text;
  }

  setBusy(busy: boolean): void {
    this.busy = busy;
    if (this.confirmButton) this.confirmButton.disabled = busy || (this.options.mode === "edit" && !this.creator.changed);
    this.element.classList.toggle("is-busy", busy);
  }

  private renderReview(): void {
    const look = this.creator.value;
    const create = this.options.mode === "create";
    const heading = el("h2", "review-name", this.options.displayName);
    heading.tabIndex = -1;
    const meta = el("p", "review-meta", create ? "Adult (18+), new in Padova" : "Adult (18+)");
    const parts: HTMLElement[] = [heading, meta];
    if (this.options.traits.length) {
      const traits = el("ul", "review-traits");
      traits.setAttribute("aria-label", "Personality");
      for (const id of this.options.traits) traits.append(el("li", "chip", TRAITS[id]?.label ?? id));
      parts.push(traits);
    }
    if (!create) {
      const changed = changedCategories(this.creator.initialValue, look);
      parts.push(
        el(
          "p",
          `review-changes${changed.length ? "" : " is-empty"}`,
          changed.length ? `Changes to save: ${changed.map((c) => CATEGORY_LABELS[c]).join(", ")}.` : "No changes yet. Go back to the look to change something.",
        ),
      );
    }
    const lines = el("ul", "review-lines");
    for (const line of describeLook(look)) {
      const item = el("li", "review-line");
      item.dataset.category = line.category;
      const change = el("button", "text-button", "Change");
      change.type = "button";
      change.dataset.action = `change-${line.category}`;
      change.setAttribute("aria-label", `Change ${CATEGORY_LABELS[line.category].toLowerCase()}`);
      change.addEventListener("click", () => this.showStep("look", line.category));
      item.append(el("span", "review-line-text", line.text), change);
      lines.append(item);
    }
    parts.push(lines);
    parts.push(
      el(
        "p",
        "review-note",
        create
          ? "Your look never affects gameplay. You can change it later from your character panel or the character list."
          : "Only your look changes. Needs, money, skills and relationships stay exactly as they are.",
      ),
    );
    if (this.options.readOnly) parts.push(el("p", "form-error", "This character was saved by a newer version of the game, so its look can't be changed here."));
    this.errorElement = el("p", "form-error");
    this.errorElement.setAttribute("role", "alert");
    parts.push(this.errorElement);
    this.review.replaceChildren(...parts);

    this.confirmButton = button(create ? "Begin life in Padova" : "Save look", {
      className: "ui-button is-primary",
      action: create ? "create-character" : "save-look",
      onClick: () => {
        if (this.busy) return;
        if (this.errorElement) this.errorElement.textContent = "";
        this.options.onConfirm(this.creator.value);
      },
    });
    this.confirmButton.disabled = this.busy || this.options.readOnly === true || (!create && !this.creator.changed);
    this.footer.append(button("Back to look", { className: "ui-button is-quiet", action: "review-back", onClick: () => this.showStep("look") }), this.confirmButton);
  }
}

function sameLook(a: AppearanceConfig, b: AppearanceConfig): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
