// Small DOM helpers shared by the title-screen flow. No framework (D-007).

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

export interface ButtonOptions {
  className?: string;
  action?: string;
  title?: string;
  /** SVG markup for an icon shown before the label (decorative). */
  icon?: string;
  onClick?: (event: MouseEvent) => void;
}

export function button(label: string, options: ButtonOptions = {}): HTMLButtonElement {
  const b = el("button", options.className ?? "ui-button");
  b.type = "button";
  if (options.action) b.dataset.action = options.action;
  if (options.title) b.title = options.title;
  if (options.icon) b.append(icon(options.icon));
  b.append(el("span", "ui-button-label", label));
  if (options.onClick) b.addEventListener("click", options.onClick);
  return b;
}

/** An icon-only button: the label becomes its accessible name and tooltip. */
export function iconButton(svg: string, label: string, options: Omit<ButtonOptions, "icon"> = {}): HTMLButtonElement {
  const b = el("button", options.className ?? "icon-button");
  b.type = "button";
  b.setAttribute("aria-label", label);
  b.title = options.title ?? label;
  if (options.action) b.dataset.action = options.action;
  b.append(icon(svg));
  if (options.onClick) b.addEventListener("click", options.onClick);
  return b;
}

export function icon(svg: string): HTMLElement {
  const span = el("span", "ui-icon");
  span.setAttribute("aria-hidden", "true");
  span.innerHTML = svg; // markup comes only from icons.ts / backdrop.ts constants
  return span;
}

/** "2 hours ago", "yesterday", "3 days ago"; for "last played". */
export function relativeTime(iso: string | null, now = Date.now()): string {
  if (!iso) return "Not played yet";
  const ms = now - Date.parse(iso);
  if (!Number.isFinite(ms)) return "";
  const minutes = Math.round(ms / 60_000);
  if (minutes < 2) return "Played just now";
  if (minutes < 60) return `Played ${minutes} minutes ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return hours === 1 ? "Played an hour ago" : `Played ${hours} hours ago`;
  const days = Math.round(hours / 24);
  if (days === 1) return "Played yesterday";
  if (days < 30) return `Played ${days} days ago`;
  return `Played on ${new Date(iso).toLocaleDateString()}`;
}
