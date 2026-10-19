// Settings, Credits, the entering-the-world transition and plain message
// screens (e.g. "playing in another window").

import { readClock } from "@padova/shared";
import { SETTING_CHOICES, getSettings, setSetting, type Settings } from "../settings.ts";
import { starrySkySvg } from "./backdrop.ts";
import { button, el, icon } from "./dom.ts";
import { ICONS } from "./icons.ts";
import type { Screen } from "./screenHost.ts";

function simpleHeader(title: string, onBack: () => void, backLabel = "Title"): HTMLElement {
  const header = el("header", "flow-header");
  const back = el("button", "back-button");
  back.type = "button";
  back.dataset.action = "back";
  back.append(icon(ICONS.back), el("span", undefined, backLabel));
  back.addEventListener("click", onBack);
  header.append(back, el("h1", "flow-title", title));
  return header;
}

const SETTING_TEXT: Record<keyof Settings, { title: string; hint: string }> = {
  graphics: {
    title: "Graphics",
    hint: "Performance draws a lighter city (no shadows, fewer small details, no smoothing) for slower phones and laptops. Automatic picks Performance on touch devices.",
  },
  cameraSpeed: { title: "Camera turning speed", hint: "How far a drag turns the camera, in the world and in the character preview." },
  motion: { title: "Interface animation", hint: "Reduced keeps menus still and stops the preview turntable." },
  hints: { title: "Controls reminder", hint: "The line of controls at the bottom of the screen while playing." },
};

export class SettingsScreen implements Screen {
  readonly element: HTMLElement;
  private readonly startGraphics = getSettings().graphics;

  constructor(
    private readonly onBack: () => void,
    /** True when the 3D view already exists (it is created at page load), so a graphics change needs a reload. */
    private readonly rendererStarted: boolean,
  ) {
    this.element = el("section", "settings-screen flow-screen");
    this.element.dataset.screen = "settings";
    const list = el("div", "settings-list");
    for (const key of Object.keys(SETTING_CHOICES) as (keyof Settings)[]) list.append(this.row(key));
    const status = el("p", "settings-status");
    status.setAttribute("role", "status");
    status.dataset.role = "settings-status";
    const note = el("p", "manage-note", "Settings are stored in this browser and apply to this device only.");
    const scroller = el("div", "flow-scroll");
    scroller.append(list, status, note);
    this.element.append(simpleHeader("Settings", onBack), scroller);
  }

  onEscape(): void {
    this.onBack();
  }

  private row<K extends keyof Settings>(key: K): HTMLElement {
    const row = el("div", "setting-row");
    row.dataset.setting = key;
    const id = `setting-${key}`;
    const title = el("div", "setting-title", SETTING_TEXT[key].title);
    title.id = id;
    const group = el("div", "segmented");
    group.setAttribute("role", "radiogroup");
    group.setAttribute("aria-labelledby", id);
    const buttons: HTMLButtonElement[] = [];
    const refresh = () => {
      for (const b of buttons) b.setAttribute("aria-checked", String(getSettings()[key] === b.dataset.value));
    };
    for (const choice of SETTING_CHOICES[key]) {
      const b = el("button", "segment", choice.label);
      b.type = "button";
      b.setAttribute("role", "radio");
      b.dataset.value = choice.id;
      b.addEventListener("click", () => {
        const stored = setSetting(key, choice.id as Settings[K]);
        refresh();
        this.afterChange(key, stored);
      });
      buttons.push(b);
      group.append(b);
    }
    refresh();
    row.append(title, group, el("p", "setting-hint", SETTING_TEXT[key].hint));
    return row;
  }

  private afterChange(key: keyof Settings, stored: boolean): void {
    const status = this.element.querySelector<HTMLElement>('[data-role="settings-status"]')!;
    status.replaceChildren();
    if (!stored) status.append(el("span", undefined, "This browser won't store settings, so they apply until you close the game. "));
    if (key === "graphics" && this.rendererStarted && getSettings().graphics !== this.startGraphics) {
      status.append(el("span", undefined, "The new graphics setting applies after reloading the game. "));
      const reload = el("button", "text-button", "Reload now");
      reload.type = "button";
      reload.dataset.action = "reload";
      reload.addEventListener("click", () => location.reload());
      status.append(reload);
    }
  }
}

export class CreditsScreen implements Screen {
  readonly element: HTMLElement;

  constructor(private readonly onBack: () => void) {
    this.element = el("section", "credits-screen flow-screen");
    this.element.dataset.screen = "credits";
    const body = el("div", "credits-body");
    const section = (title: string, lines: string[]) => {
      const block = el("section", "credits-section");
      block.append(el("h2", "credits-heading", title), ...lines.map((line) => el("p", "credits-line", line)));
      return block;
    };
    body.append(
      section("Padova Life SIM", [
        "A fan-made life simulation set in a stylised Padova. Not affiliated with or endorsed by the University of Padua.",
        "Inspired by the depth of life-simulation games. All characters, art, interface and code are original to this project.",
      ]),
      section("Made by", ["Game direction and design: CIR", "Programming, characters and interface: built with Claude, an AI model by Anthropic"]),
      section("Art", [
        "Characters and the city are generated in code (no purchased or downloaded models or textures).",
        "The university square is fictional, inspired by Padova's historic centre; it is not a model of a real place.",
        "The title screen sky and porticoes are original drawings inspired by Padova's starry fresco ceilings and arcaded streets.",
      ]),
      section("Fonts", [
        "Dela Gothic One. Copyright 2020 The Dela Gothic Project Authors. SIL Open Font License 1.1.",
        "M PLUS Rounded 1c. Copyright 2016 The Rounded M+ Project Authors. SIL Open Font License 1.1.",
      ]),
      section("Open-source software", [
        "Three.js (MIT), Colyseus (MIT), Vite (MIT), TypeScript (Apache 2.0), PGlite (Apache 2.0), node-postgres (MIT), Fontsource (MIT), Playwright (Apache 2.0), Vitest (MIT).",
      ]),
    );
    const scroller = el("div", "flow-scroll");
    scroller.append(body);
    this.element.append(simpleHeader("Credits", onBack), scroller);
  }

  onEscape(): void {
    this.onBack();
  }
}

/** Covers the screen while the server places the character and the world draws its first frame. */
export class TransitionScreen implements Screen {
  readonly element: HTMLElement;
  private readonly line: HTMLElement;
  private readonly sub: HTMLElement;

  constructor(name: string, kind: "arriving" | "leaving") {
    this.element = el("section", "transition-screen");
    this.element.dataset.screen = kind === "arriving" ? "entering" : "leaving";
    this.element.dataset.phase = "waiting";
    const sky = el("div", "title-sky");
    sky.innerHTML = starrySkySvg(30, 3);
    const box = el("div", "transition-box");
    this.line = el("h1", "transition-title", kind === "arriving" ? `Welcome to Padova, ${name}` : `See you soon, ${name}`);
    this.sub = el("p", "transition-sub", kind === "arriving" ? "Finding your spot in the piazza…" : "Saving your day…");
    this.sub.setAttribute("role", "status");
    const bar = el("div", "transition-bar");
    bar.append(el("span", "transition-bar-fill"));
    box.append(this.line, this.sub, bar);
    this.element.append(sky, box);
  }

  /** The world is ready: show the time of day, then the flow uncovers it. */
  arrived(gameMinute: number | null): void {
    this.element.dataset.phase = "done";
    if (gameMinute !== null) {
      const clock = readClock(gameMinute);
      const hh = String(clock.hours).padStart(2, "0");
      const mm = String(clock.minutes).padStart(2, "0");
      this.sub.textContent = `Day ${clock.day}, ${hh}:${mm} in the piazza`;
    } else this.sub.textContent = "You're in the piazza";
  }
}

export class MessageScreen implements Screen {
  readonly element: HTMLElement;

  constructor(title: string, text: string, actionLabel: string, onAction: () => void, secondary?: { label: string; onClick: () => void }) {
    this.element = el("section", "message-screen");
    this.element.dataset.screen = "message";
    const sky = el("div", "title-sky");
    sky.innerHTML = starrySkySvg(24, 5);
    const box = el("div", "message-box");
    const heading = el("h1", "message-title", title);
    const primary = button(actionLabel, { className: "ui-button is-primary", action: "message-action", onClick: onAction });
    primary.dataset.autofocus = "";
    const actions = el("div", "message-actions");
    if (secondary) actions.append(button(secondary.label, { className: "ui-button is-quiet", action: "message-secondary", onClick: secondary.onClick }));
    actions.append(primary);
    box.append(heading, el("p", "message-text", text), actions);
    this.element.append(sky, box);
  }
}
