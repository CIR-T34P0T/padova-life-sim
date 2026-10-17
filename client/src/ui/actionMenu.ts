// Contextual action menus. Two presentations of the same contract:
//   RadialMenu  – desktop: compact fan of options around the selected target.
//   ActionSheet – touch: bottom sheet with large buttons.
// Menus only collect a choice; the caller sends the request to the server.

import type { ActionId } from "@padova/shared";

export interface MenuOption {
  id: ActionId;
  label: string;
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
  open(spec: MenuSpec, onChoose: (id: ActionId) => void): void;
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
const SPREAD_DEG = 52;
const EDGE_MARGIN_PX = 8;

class RadialMenu implements ActionMenu {
  readonly kind = "radial" as const;
  current: MenuSpec | null = null;
  private readonly element: HTMLElement;
  private onChoose: ((id: ActionId) => void) | null = null;
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

  open(spec: MenuSpec, onChoose: (id: ActionId) => void): void {
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
      const button = document.createElement("button");
      button.type = "button";
      button.className = "radial-option";
      button.setAttribute("role", "menuitem");
      button.dataset.action = option.id;
      button.textContent = option.label;
      button.addEventListener("click", (event) => {
        event.stopPropagation();
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
    const count = buttons.length;
    buttons.forEach((button, index) => {
      const angle = ((-90 + (index - (count - 1) / 2) * SPREAD_DEG) * Math.PI) / 180;
      const x = this.anchor.x + Math.cos(angle) * RADIUS_PX;
      const y = this.anchor.y + Math.sin(angle) * RADIUS_PX;
      place(button, x, y);
    });
    const title = this.element.querySelector<HTMLElement>(".radial-title");
    if (title) place(title, this.anchor.x, this.anchor.y + 34);
  }
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
  private onChoose: ((id: ActionId) => void) | null = null;

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

  open(spec: MenuSpec, onChoose: (id: ActionId) => void): void {
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
        const button = document.createElement("button");
        button.type = "button";
        button.className = "sheet-option";
        button.dataset.action = option.id;
        button.textContent = option.label;
        button.addEventListener("click", () => {
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
