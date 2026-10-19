// Modal dialogs for confirmations (discard changes, delete a character).
// Keyboard: focus moves into the dialog and stays there, Escape cancels.

import { button, el } from "./dom.ts";

export interface DialogOptions {
  title: string;
  body: string[];
  confirmLabel: string;
  cancelLabel?: string;
  /** Red confirm button for destructive actions. */
  danger?: boolean;
  /** A text field that must be filled in before confirming (e.g. the character's name). */
  input?: { label: string; placeholder?: string };
  /** Confirm stays disabled until this returns true for the field's value. */
  canConfirm?: (value: string) => boolean;
  onConfirm(value: string, dialog: Dialog): void;
  onCancel?(): void;
}

export class Dialog {
  readonly element: HTMLElement;
  private readonly error: HTMLElement;
  private readonly confirm: HTMLButtonElement;
  private readonly field: HTMLInputElement | null = null;
  private readonly previousFocus: Element | null;
  private closed = false;

  constructor(private readonly options: DialogOptions) {
    this.previousFocus = document.activeElement;
    this.element = el("div", "ui-dialog-backdrop");
    const box = el("div", `ui-dialog${options.danger ? " is-danger" : ""}`);
    box.setAttribute("role", "alertdialog");
    box.setAttribute("aria-modal", "true");
    const titleId = `dialog-title-${Math.random().toString(36).slice(2, 8)}`;
    box.setAttribute("aria-labelledby", titleId);
    const title = el("h2", "ui-dialog-title", options.title);
    title.id = titleId;
    box.append(title, ...options.body.map((text) => el("p", "ui-dialog-text", text)));

    if (options.input) {
      const label = el("label", "field-label", options.input.label);
      const field = el("input", "text-field");
      field.type = "text";
      field.autocomplete = "off";
      field.spellcheck = false;
      field.placeholder = options.input.placeholder ?? "";
      const id = `${titleId}-field`;
      field.id = id;
      label.htmlFor = id;
      field.addEventListener("input", () => this.refresh());
      field.addEventListener("keydown", (event) => {
        if (event.key === "Enter" && !this.confirm.disabled) this.confirm.click();
      });
      this.field = field;
      box.append(label, field);
    }
    this.error = el("p", "form-error");
    this.error.setAttribute("role", "alert");
    const actions = el("div", "ui-dialog-actions");
    const cancel = button(options.cancelLabel ?? "Cancel", { className: "ui-button is-quiet", action: "dialog-cancel", onClick: () => this.cancel() });
    this.confirm = button(options.confirmLabel, {
      className: `ui-button ${options.danger ? "is-danger" : "is-primary"}`,
      action: "dialog-confirm",
      onClick: () => {
        this.error.textContent = "";
        options.onConfirm(this.field?.value ?? "", this);
      },
    });
    actions.append(cancel, this.confirm);
    box.append(this.error, actions);
    this.element.append(box);
    this.element.addEventListener("keydown", (event) => this.onKey(event));
    this.element.addEventListener("pointerdown", (event) => {
      if (event.target === this.element) this.cancel();
    });
    document.body.append(this.element);
    this.refresh();
    (this.field ?? this.confirm).focus();
  }

  setError(text: string): void {
    this.error.textContent = text;
    this.setBusy(false);
  }

  setBusy(busy: boolean): void {
    this.confirm.disabled = busy || !this.allowed();
    this.element.classList.toggle("is-busy", busy);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.element.remove();
    if (this.previousFocus instanceof HTMLElement && document.contains(this.previousFocus)) this.previousFocus.focus();
  }

  get isOpen(): boolean {
    return !this.closed;
  }

  private allowed(): boolean {
    return this.options.canConfirm ? this.options.canConfirm(this.field?.value ?? "") : true;
  }

  private refresh(): void {
    this.confirm.disabled = !this.allowed();
  }

  private cancel(): void {
    this.close();
    this.options.onCancel?.();
  }

  private onKey(event: KeyboardEvent): void {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      this.cancel();
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = [...this.element.querySelectorAll<HTMLElement>("button:not(:disabled), input")];
    if (focusable.length === 0) return;
    const first = focusable[0]!;
    const last = focusable.at(-1)!;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }
}
