// Contextual action menus. Two presentations of the same contract:
//   RadialMenu  – desktop: compact fan of options around the selected target.
//   ActionSheet – touch: bottom sheet with large buttons.
// Menus only collect a choice; the caller sends the request to the server.

/**
 * Option key, also exposed as `data-action`: a server action ("sit"), a café
 * purchase ("buy:panino"), or a client-only option ("character",
 * "edit-appearance") that is handled locally and never sent as an action.
 */
export type MenuChoice = string;

export interface MenuOption {
  id: MenuChoice;
  label: string;
  /** Secondary text, e.g. a price. */
  detail?: string;
  /** Shown but not selectable (e.g. too tired, not enough money); `detail` says why. */
  disabled?: boolean;
}

export interface MenuSpec {
  title: string;
  subtitle?: string;
  options: MenuOption[];
}

export interface ActionMenu {
  readonly kind: "radial" | "sheet";
  readonly isOpen: boolean;
  readonly current: MenuSpec | null;
  open(spec: MenuSpec, onChoose: (id: MenuChoice) => void): void;
  /** Replaces the options of the open menu without moving it. */
  update(spec: MenuSpec): void;
  close(): void;
  /** Screen position of the selected target (radial menu follows it; sheet ignores it). */
  setAnchor(x: number, y: number, visible: boolean): void;
}

/** Picks the presentation for this device: touch-first screens get the sheet. */
export function createActionMenu(root: HTMLElement, onDismiss: () => void): ActionMenu {
  const params = new URLSearchParams(location.search);
  const forced = params.get("menu");
  const coarse = window.matchMedia("(pointer: coarse)").matches;
  const useSheet = forced === "sheet" || (forced !== "radial" && coarse);
  return useSheet ? new ActionSheet(root, onDismiss) : new RadialMenu(root);
}

const RADIUS_PX = 78;
/** The fan may widen up to this radius for longer labels; beyond it the options stack instead. */
const MAX_RADIUS_PX = 124;
const SPREAD_DEG = 52;
const EDGE_MARGIN_PX = 8;
/** Minimum gap between two options. */
const OPTION_GAP_PX = 6;
/** Stacked layout: distance from the target to the lowest option. */
const STACK_OFFSET_PX = 36;

class RadialMenu implements ActionMenu {
  readonly kind = "radial" as const;
  current: MenuSpec | null = null;
  private readonly element: HTMLElement;
  private onChoose: ((id: MenuChoice) => void) | null = null;
  private anchor = { x: 0, y: 0, visible: false };

  constructor(root: HTMLElement) {
    this.element = document.createElement("div");
    this.element.className = "radial-menu";
    this.element.id = "action-menu";
    this.element.setAttribute("role", "menu");
    this.element.hidden = true;
    root.appendChild(this.element);
  }

  get isOpen(): boolean {
    return this.current !== null;
  }

  open(spec: MenuSpec, onChoose: (id: MenuChoice) => void): void {
    this.onChoose = onChoose;
    this.render(spec);
  }

  update(spec: MenuSpec): void {
    if (this.current) this.render(spec);
  }

  close(): void {
    this.current = null;
    this.onChoose = null;
    this.element.hidden = true;
    this.element.replaceChildren();
  }

  setAnchor(x: number, y: number, visible: boolean): void {
    this.anchor = { x, y, visible };
    if (this.current) this.layout();
  }

  private render(spec: MenuSpec): void {
    this.current = spec;
    this.element.replaceChildren();
    const title = document.createElement("div");
    title.className = "radial-title";
    title.textContent = spec.subtitle ? `${spec.title} · ${spec.subtitle}` : spec.title;
    this.element.appendChild(title);
    for (const option of spec.options) {
      const button = optionButton("radial-option", option);
      button.setAttribute("role", "menuitem");
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        if (option.disabled) return;
        const choose = this.onChoose;
        this.close();
        choose?.(option.id);
      });
      this.element.appendChild(button);
    }
    this.element.hidden = false;
    this.layout();
  }

  /** Fans options above the target and keeps everything on screen. */
  private layout(): void {
    if (!this.current) return;
    this.element.style.visibility = this.anchor.visible ? "visible" : "hidden";
    const buttons = [...this.element.querySelectorAll<HTMLElement>(".radial-option")];
    const sizes = buttons.map((button) => ({ w: button.offsetWidth, h: button.offsetHeight }));
    const offsets = fanOffsets(sizes) ?? stackOffsets(sizes);
    buttons.forEach((button, index) => place(button, this.anchor.x + offsets[index]!.x, this.anchor.y + offsets[index]!.y));
    const title = this.element.querySelector<HTMLElement>(".radial-title");
    if (title) place(title, this.anchor.x, this.anchor.y + 34);
  }
}

interface Size {
  w: number;
  h: number;
}

/** Option centres fanned above the target, at the smallest radius where no two overlap; null if none fits. */
function fanOffsets(sizes: readonly Size[]): { x: number; y: number }[] | null {
  const count = sizes.length;
  for (let radius = RADIUS_PX; radius <= MAX_RADIUS_PX; radius += 6) {
    const offsets = sizes.map((_, index) => {
      const angle = ((-90 + (index - (count - 1) / 2) * SPREAD_DEG) * Math.PI) / 180;
      return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
    });
    if (!anyOverlap(offsets, sizes)) return offsets;
  }
  return null;
}

/** Option centres in a column above the target, first option on top. */
function stackOffsets(sizes: readonly Size[]): { x: number; y: number }[] {
  const total = sizes.reduce((sum, size) => sum + size.h, 0) + OPTION_GAP_PX * Math.max(0, sizes.length - 1);
  let top = -STACK_OFFSET_PX - total;
  return sizes.map((size) => {
    const centre = { x: 0, y: top + size.h / 2 };
    top += size.h + OPTION_GAP_PX;
    return centre;
  });
}

function anyOverlap(centres: readonly { x: number; y: number }[], sizes: readonly Size[]): boolean {
  for (let i = 0; i < centres.length; i++) {
    for (let j = i + 1; j < centres.length; j++) {
      const a = centres[i]!;
      const b = centres[j]!;
      const apartX = Math.abs(a.x - b.x) >= (sizes[i]!.w + sizes[j]!.w) / 2 + OPTION_GAP_PX;
      const apartY = Math.abs(a.y - b.y) >= (sizes[i]!.h + sizes[j]!.h) / 2 + OPTION_GAP_PX;
      if (!apartX && !apartY) return true;
    }
  }
  return false;
}

/** Centres an absolutely positioned element on (x, y), clamped inside the viewport. */
function place(element: HTMLElement, x: number, y: number): void {
  const width = element.offsetWidth;
  const height = element.offsetHeight;
  const left = Math.min(Math.max(x - width / 2, EDGE_MARGIN_PX), window.innerWidth - width - EDGE_MARGIN_PX);
  const top = Math.min(Math.max(y - height / 2, EDGE_MARGIN_PX), window.innerHeight - height - EDGE_MARGIN_PX);
  element.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
}

class ActionSheet implements ActionMenu {
  readonly kind = "sheet" as const;
  current: MenuSpec | null = null;
  private readonly element: HTMLElement;
  private readonly titleElement: HTMLElement;
  private readonly subtitleElement: HTMLElement;
  private readonly list: HTMLElement;
  private onChoose: ((id: MenuChoice) => void) | null = null;

  constructor(root: HTMLElement, private readonly onDismiss: () => void) {
    this.element = document.createElement("div");
    this.element.className = "action-sheet";
    this.element.id = "action-sheet";
    this.element.setAttribute("role", "dialog");
    this.element.setAttribute("aria-modal", "false");
    this.element.hidden = true;

    const header = document.createElement("div");
    header.className = "sheet-header";
    const titles = document.createElement("div");
    this.titleElement = document.createElement("div");
    this.titleElement.className = "sheet-title";
    this.subtitleElement = document.createElement("div");
    this.subtitleElement.className = "sheet-subtitle";
    titles.append(this.titleElement, this.subtitleElement);
    const close = document.createElement("button");
    close.type = "button";
    close.className = "sheet-close";
    close.setAttribute("aria-label", "Close");
    close.textContent = "✕";
    close.addEventListener("click", () => {
      this.close();
      this.onDismiss();
    });
    header.append(titles, close);

    this.list = document.createElement("div");
    this.list.className = "sheet-options";
    this.element.append(header, this.list);
    // Keep taps on the sheet from reaching the game view.
    this.element.addEventListener("pointerdown", (event) => event.stopPropagation());
    root.appendChild(this.element);
  }

  get isOpen(): boolean {
    return this.current !== null;
  }

  open(spec: MenuSpec, onChoose: (id: MenuChoice) => void): void {
    this.onChoose = onChoose;
    this.render(spec);
    document.body.classList.add("sheet-open");
  }

  update(spec: MenuSpec): void {
    if (this.current) this.render(spec);
  }

  close(): void {
    this.current = null;
    this.onChoose = null;
    this.element.hidden = true;
    document.body.classList.remove("sheet-open");
  }

  setAnchor(): void {
    // The sheet is docked to the screen edge; it does not follow the target.
  }

  private render(spec: MenuSpec): void {
    this.current = spec;
    this.titleElement.textContent = spec.title;
    this.subtitleElement.textContent = spec.subtitle ?? "";
    this.list.replaceChildren(
      ...spec.options.map((option) => {
        const button = optionButton("sheet-option", option);
        button.addEventListener("click", () => {
          if (option.disabled) return;
          const choose = this.onChoose;
          this.close();
          choose?.(option.id);
        });
        return button;
      }),
    );
    this.element.hidden = false;
  }
}

/** A menu button: label, optional detail (price, reason), disabled state. */
function optionButton(className: string, option: MenuOption): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.dataset.action = option.id;
  const label = document.createElement("span");
  label.className = "option-label";
  label.textContent = option.label;
  button.append(label);
  if (option.detail) {
    const detail = document.createElement("span");
    detail.className = "option-detail";
    detail.textContent = option.detail;
    button.append(detail);
  }
  if (option.disabled) {
    button.setAttribute("aria-disabled", "true");
    button.classList.add("is-disabled");
  }
  return button;
}
