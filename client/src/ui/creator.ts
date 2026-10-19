// Character creator (M6): live 3D preview plus controls for every part of
// the appearance config. Used for "create your character" and "edit
// appearance". The server validates everything again on save.
//
// Features: presets with thumbnails (hover or focus to compare in the
// preview, click to use), body / skin / face / hair / outfit tabs with
// option buttons, colour swatches and sliders, randomise all or one tab,
// reset a tab, undo / redo, hold-to-compare with the starting look, rotate
// and zoom, look codes and looks saved in this browser.

import {
  APPEARANCE_PRESETS,
  APPEARANCE_SPEC,
  BEAUTY_MARKS,
  BODY_FRAMES,
  BOTTOMS,
  BROW_SHAPES,
  BUILDS,
  CLOTHING_COLOURS,
  EYE_COLOURS,
  EYE_SHAPES,
  FACE_SHAPES,
  FACIAL_HAIR,
  FRECKLES,
  FULL_OUTFITS,
  GLASSES,
  HAIRLINES,
  HAIR_COLOURS,
  HAIR_STYLES,
  HAIR_TEXTURE_LABELS,
  HEADWEAR,
  LIP_SHAPES,
  NOSE_SHAPES,
  OUTERWEAR,
  PATTERNS,
  SHOES,
  SKIN_TONE_STOPS,
  TOPS,
  UNDERTONES,
  cloneAppearance,
  encodeLook,
  fromLookCode,
  parseAppearanceConfig,
  randomAppearance,
  randomiseSection,
  roundSlider,
  sameAppearance,
  skinColour,
  skinToneLabel,
  toLookCode,
  visibleLayers,
  type AppearanceConfig,
  type AppearanceSection,
  type ColourOption,
  type HairTexture,
  type Option,
} from "@padova/shared";
import { CharacterModel } from "../render/avatar/index.ts";
import { PreviewStage, type PreviewView } from "../render/previewStage.ts";

export type CreatorTab = "presets" | AppearanceSection | "personality";

export interface CreatorOptions {
  mode: "create" | "edit";
  initial: AppearanceConfig;
  /** Extra panel content for a tab that isn't about appearance (personality in create mode). */
  personality?: HTMLElement;
  /** Content above the tabs (name field in create mode). */
  header?: HTMLElement[];
  onChange?: (appearance: AppearanceConfig) => void;
}

const SECTION_LABELS: Record<AppearanceSection, string> = { body: "Body", skin: "Skin", face: "Face", hair: "Hair", outfit: "Outfit" };
const HISTORY_LIMIT = 60;
const SAVED_LOOKS_KEY = "padova.savedLooks";
const MAX_SAVED_LOOKS = 6;

type Path = `${AppearanceSection}.${string}`;

function getField(config: AppearanceConfig, path: Path): unknown {
  const [section, field] = path.split(".") as [AppearanceSection, string];
  return (config[section] as Record<string, unknown>)[field];
}

function setField(config: AppearanceConfig, path: Path, value: unknown): void {
  const [section, field] = path.split(".") as [AppearanceSection, string];
  (config[section] as Record<string, unknown>)[field] = value;
}

function readSavedLooks(): { name: string; code: string }[] {
  try {
    const raw = localStorage.getItem(SAVED_LOOKS_KEY);
    const list = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(list) ? list.filter((x): x is { name: string; code: string } => typeof x?.name === "string" && typeof x?.code === "string").slice(0, MAX_SAVED_LOOKS) : [];
  } catch {
    return [];
  }
}

function writeSavedLooks(list: { name: string; code: string }[]): boolean {
  try {
    localStorage.setItem(SAVED_LOOKS_KEY, JSON.stringify(list.slice(0, MAX_SAVED_LOOKS)));
    return true;
  } catch {
    return false;
  }
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] => {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
};

export class CharacterCreator {
  readonly element: HTMLElement;
  private appearance: AppearanceConfig;
  private readonly initial: AppearanceConfig;
  private readonly history: string[] = [];
  private future: string[] = [];
  private tab: CreatorTab;
  private readonly stage: PreviewStage;
  private readonly model: CharacterModel;
  private readonly canvas: HTMLCanvasElement;
  private view: PreviewView = "body";
  private yaw = 0.35;
  private comparing: AppearanceConfig | null = null;
  private previewing: AppearanceConfig | null = null;
  private pendingBuild = false;
  private frame = 0;
  private running = true;
  private readonly controls: HTMLElement;
  private readonly tabList: HTMLElement;
  private readonly statusLine: HTMLElement;
  private readonly undoButton: HTMLButtonElement;
  private readonly redoButton: HTMLButtonElement;
  private thumbnails = new Map<string, string>();
  private resizeObserver: ResizeObserver | null = null;

  constructor(private readonly options: CreatorOptions) {
    this.initial = cloneAppearance(options.initial);
    this.appearance = cloneAppearance(options.initial);
    this.tab = options.mode === "create" ? "presets" : "hair";

    this.element = el("div", "creator");
    this.element.dataset.mode = options.mode;

    // Preview column.
    const preview = el("div", "creator-preview");
    this.canvas = el("canvas", "creator-canvas");
    this.canvas.setAttribute("role", "img");
    this.canvas.setAttribute("aria-label", "Live preview of your character. Drag to turn.");
    const toolbar = el("div", "creator-toolbar");
    const toolButton = (label: string, title: string, action: string, onClick: () => void) => {
      const button = el("button", "tool-button", label);
      button.type = "button";
      button.title = title;
      button.setAttribute("aria-label", title);
      button.dataset.action = action;
      button.addEventListener("click", onClick);
      return button;
    };
    const views: [PreviewView, string][] = [["body", "Body"], ["upper", "Upper"], ["face", "Face"]];
    const viewGroup = el("div", "tool-group");
    viewGroup.setAttribute("role", "radiogroup");
    viewGroup.setAttribute("aria-label", "Camera");
    for (const [id, label] of views) {
      const button = toolButton(label, `Show ${label.toLowerCase()}`, `view-${id}`, () => {
        this.view = id;
        for (const b of viewGroup.querySelectorAll("button")) b.setAttribute("aria-pressed", String(b === button));
      });
      button.setAttribute("aria-pressed", String(id === this.view));
      viewGroup.append(button);
    }
    const turnGroup = el("div", "tool-group");
    turnGroup.append(
      toolButton("⟲", "Turn left", "turn-left", () => (this.yaw -= Math.PI / 4)),
      toolButton("⟳", "Turn right", "turn-right", () => (this.yaw += Math.PI / 4)),
    );
    const compare = toolButton("Hold to compare", "Hold to see the look you started with", "compare", () => {});
    const startCompare = (event: Event) => {
      event.preventDefault();
      this.comparing = this.initial;
      this.scheduleBuild();
    };
    const stopCompare = () => {
      if (!this.comparing) return;
      this.comparing = null;
      this.scheduleBuild();
    };
    compare.addEventListener("pointerdown", startCompare);
    compare.addEventListener("pointerup", stopCompare);
    compare.addEventListener("pointerleave", stopCompare);
    compare.addEventListener("pointercancel", stopCompare);
    compare.addEventListener("keydown", (event) => (event.key === " " || event.key === "Enter") && startCompare(event));
    compare.addEventListener("keyup", stopCompare);
    toolbar.append(viewGroup, turnGroup, compare);
    preview.append(this.canvas, toolbar);

    // Controls column.
    const side = el("div", "creator-side");
    const title = el("h1", undefined, options.mode === "create" ? "Create your character" : "Edit appearance");
    side.append(title, ...(options.header ?? []));
    const history = el("div", "creator-history");
    this.undoButton = toolButton("Undo", "Undo (Ctrl+Z)", "undo", () => this.undo());
    this.redoButton = toolButton("Redo", "Redo (Ctrl+Shift+Z)", "redo", () => this.redo());
    history.append(toolButton("Randomise all", "Random look", "randomise-all", () => this.apply(randomAppearance(this.seed()))), this.undoButton, this.redoButton);
    side.append(history);
    this.tabList = el("div", "creator-tabs");
    this.tabList.setAttribute("role", "tablist");
    const tabs: [CreatorTab, string][] = [["presets", "Presets"], ["body", "Body"], ["skin", "Skin"], ["face", "Face"], ["hair", "Hair"], ["outfit", "Outfit"]];
    if (options.personality) tabs.push(["personality", "Personality"]);
    for (const [id, label] of tabs) {
      const button = el("button", "creator-tab", label);
      button.type = "button";
      button.setAttribute("role", "tab");
      button.dataset.tab = id;
      button.addEventListener("click", () => this.showTab(id));
      this.tabList.append(button);
    }
    this.controls = el("div", "creator-controls");
    this.controls.setAttribute("role", "tabpanel");
    this.statusLine = el("p", "creator-status");
    this.statusLine.setAttribute("aria-live", "polite");
    side.append(this.tabList, this.controls, this.statusLine);
    this.element.append(preview, side);

    // Preview setup.
    this.stage = new PreviewStage(this.canvas, { background: 0xefe5d8 });
    this.model = new CharacterModel(this.appearance);
    this.model.pose({ moving: false, seated: false, activity: "idle", time: 0 });
    this.element.dataset.showing = "current";
    this.stage.show(this.model);
    this.attachDrag();
    this.element.addEventListener("keydown", (event) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "z") return;
      if ((event.target as HTMLElement).tagName === "INPUT" && (event.target as HTMLInputElement).type === "text") return;
      event.preventDefault();
      if (event.shiftKey) this.redo();
      else this.undo();
    });
    this.showTab(this.tab);
    this.refreshHistoryButtons();
    this.element.dataset.look = encodeLook(this.appearance);
    if (import.meta.env.DEV || new URLSearchParams(location.search).has("e2e")) {
      (window as unknown as { __creator: unknown }).__creator = {
        /** Kept for tests: the creator preview has no idle animation, so it is always still. */
        freeze: () => undefined,
        stats: () => ({ ...this.model.stats }),
        showing: () => this.element.dataset.showing,
      };
    }
    this.loop();
  }

  /** Must be called once the element is in the document (to size the preview). */
  mounted(): void {
    const resize = () => {
      const rect = this.canvas.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) this.stage.setSize(rect.width, rect.height);
    };
    resize();
    this.resizeObserver = new ResizeObserver(resize);
    this.resizeObserver.observe(this.canvas);
  }

  get value(): AppearanceConfig {
    return cloneAppearance(this.appearance);
  }

  destroy(): void {
    this.running = false;
    cancelAnimationFrame(this.frame);
    this.resizeObserver?.disconnect();
    this.model.dispose();
    this.stage.renderer.forceContextLoss();
    this.stage.dispose();
    this.element.remove();
    const hook = window as unknown as { __creator?: unknown };
    if (hook.__creator) delete hook.__creator;
  }

  // ── State ─────────────────────────────────────────────────────────────

  private seed(): number {
    return Math.floor(Math.random() * 2 ** 31);
  }

  /** Replaces the whole look (preset, randomise, undo…), recording history. */
  private apply(next: AppearanceConfig, record = true): void {
    const parsed = parseAppearanceConfig(next);
    if (!parsed.ok) {
      this.status(`That look couldn't be used (${parsed.field}).`);
      return;
    }
    if (sameAppearance(parsed.value, this.appearance)) return;
    if (record) {
      this.history.push(encodeLook(this.appearance));
      if (this.history.length > HISTORY_LIMIT) this.history.shift();
      this.future = [];
    }
    this.appearance = parsed.value;
    this.changed();
    this.renderControls();
  }

  /** Changes one field. Sliders call this on every move with record=false, then once on release. */
  private setValue(path: Path, value: unknown, record: boolean): void {
    if (getField(this.appearance, path) === value && !record) return;
    const next = cloneAppearance(this.appearance);
    setField(next, path, value);
    if (record) {
      const before = this.sliderStart ?? encodeLook(this.appearance);
      this.sliderStart = null;
      if (before !== encodeLook(next)) {
        this.history.push(before);
        if (this.history.length > HISTORY_LIMIT) this.history.shift();
        this.future = [];
      }
    }
    this.appearance = next;
    this.changed();
    // The skin-tone track and swatches are drawn for the current undertone.
    if (record && path === "skin.undertone") this.renderControls();
    else this.refreshHiddenNotes();
  }

  private sliderStart: string | null = null;

  private changed(): void {
    this.options.onChange?.(this.value);
    this.element.dataset.look = encodeLook(this.appearance);
    this.refreshHistoryButtons();
    this.scheduleBuild();
  }

  private undo(): void {
    const previous = this.history.pop();
    if (!previous) return;
    this.future.push(encodeLook(this.appearance));
    this.appearance = JSON.parse(previous) as AppearanceConfig;
    this.changed();
    this.renderControls();
    this.status("Undone.");
  }

  private redo(): void {
    const next = this.future.pop();
    if (!next) return;
    this.history.push(encodeLook(this.appearance));
    this.appearance = JSON.parse(next) as AppearanceConfig;
    this.changed();
    this.renderControls();
    this.status("Redone.");
  }

  private refreshHistoryButtons(): void {
    this.undoButton.disabled = this.history.length === 0;
    this.redoButton.disabled = this.future.length === 0;
  }

  private status(text: string): void {
    this.statusLine.textContent = text;
  }

  // ── Preview ───────────────────────────────────────────────────────────

  private scheduleBuild(): void {
    this.pendingBuild = true;
  }

  private builds = 0;
  private renderedKey = "";

  /**
   * Renders only when something visible changed (look, angle, camera, size):
   * no idle animation in the creator, so a still preview costs nothing on
   * phones and laptops on battery.
   */
  private loop = (): void => {
    if (!this.running) return;
    if (this.pendingBuild) {
      this.pendingBuild = false;
      const shown = this.comparing ?? this.previewing ?? this.appearance;
      this.element.dataset.showing = this.comparing ? "compare" : this.previewing ? "preview" : "current";
      const stats = this.model.setAppearance(shown);
      this.model.pose({ moving: false, seated: false, activity: "idle", time: 0 });
      this.element.dataset.buildMs = stats.buildMs.toFixed(1);
      this.element.dataset.rebuilt = stats.rebuilt.join(",");
      this.builds++;
    }
    const key = `${this.builds}|${this.view}|${this.yaw.toFixed(3)}|${this.canvas.width}x${this.canvas.height}`;
    if (key !== this.renderedKey) {
      this.renderedKey = key;
      this.stage.frame(this.model, this.view, this.yaw);
      this.stage.render();
    }
    this.frame = requestAnimationFrame(this.loop);
  };

  private attachDrag(): void {
    let lastX: number | null = null;
    this.canvas.addEventListener("pointerdown", (event) => {
      lastX = event.clientX;
      this.canvas.setPointerCapture(event.pointerId);
    });
    this.canvas.addEventListener("pointermove", (event) => {
      if (lastX === null) return;
      this.yaw += (event.clientX - lastX) * 0.012;
      lastX = event.clientX;
    });
    const end = () => (lastX = null);
    this.canvas.addEventListener("pointerup", end);
    this.canvas.addEventListener("pointercancel", end);
  }

  // ── Tabs ──────────────────────────────────────────────────────────────

  showTab(tab: CreatorTab): void {
    this.tab = tab;
    for (const button of this.tabList.querySelectorAll<HTMLButtonElement>(".creator-tab")) {
      const selected = button.dataset.tab === tab;
      button.setAttribute("aria-selected", String(selected));
      button.tabIndex = selected ? 0 : -1;
    }
    this.view = tab === "face" ? "face" : tab === "hair" ? "upper" : this.view === "face" && tab !== "presets" ? "body" : this.view;
    for (const button of this.element.querySelectorAll<HTMLButtonElement>('[data-action^="view-"]')) {
      button.setAttribute("aria-pressed", String(button.dataset.action === `view-${this.view}`));
    }
    this.renderControls();
    this.controls.scrollTop = 0;
  }

  private renderControls(): void {
    const scroll = this.controls.scrollTop;
    this.controls.replaceChildren();
    this.controls.dataset.tab = this.tab;
    switch (this.tab) {
      case "presets":
        this.controls.append(this.presetsTab());
        break;
      case "personality":
        if (this.options.personality) this.controls.append(this.options.personality);
        break;
      default:
        this.controls.append(...this.sectionTab(this.tab));
    }
    this.controls.scrollTop = scroll;
    this.refreshHiddenNotes();
  }

  private sectionTools(section: AppearanceSection): HTMLElement {
    const row = el("div", "section-tools");
    const randomise = el("button", "tool-button", `Randomise ${SECTION_LABELS[section].toLowerCase()}`);
    randomise.type = "button";
    randomise.dataset.action = `randomise-${section}`;
    randomise.addEventListener("click", () => this.apply(randomiseSection(this.appearance, section, this.seed())));
    const reset = el("button", "tool-button", `Reset ${SECTION_LABELS[section].toLowerCase()}`);
    reset.type = "button";
    reset.dataset.action = `reset-${section}`;
    reset.title = this.options.mode === "create" ? "Back to the starting look" : "Back to your saved look";
    reset.addEventListener("click", () => {
      const next = cloneAppearance(this.appearance);
      (next as unknown as Record<string, unknown>)[section] = { ...this.initial[section] };
      this.apply(next);
    });
    row.append(randomise, reset);
    return row;
  }

  private sectionTab(section: AppearanceSection): HTMLElement[] {
    const parts: HTMLElement[] = [this.sectionTools(section)];
    switch (section) {
      case "body":
        parts.push(
          this.options_("body.frame", "Body frame", BODY_FRAMES, "Frames change proportions only. Any look works with any frame."),
          this.options_("body.build", "Build", BUILDS),
          this.slider("body.height", "Height", (v) => `${Math.round(156 + v * 32)} cm`),
          this.slider("body.shoulders", "Shoulders", narrowWide),
          this.slider("body.torso", "Torso length", shortLong),
          this.slider("body.legs", "Leg length", shortLong),
          this.slider("body.arms", "Arm length", shortLong),
        );
        break;
      case "skin":
        parts.push(this.skinTone(), this.options_("skin.undertone", "Undertone", UNDERTONES), this.options_("skin.freckles", "Freckles", FRECKLES), this.options_("skin.mark", "Beauty mark", BEAUTY_MARKS), this.slider("skin.blush", "Blush", noneStrong));
        break;
      case "face":
        parts.push(
          this.options_("face.shape", "Face shape", FACE_SHAPES),
          this.slider("face.cheekbones", "Cheekbones", softDefined),
          this.slider("face.jaw", "Jaw width", narrowWide),
          this.slider("face.chin", "Chin length", shortLong),
          this.slider("face.forehead", "Forehead", lowHigh),
          this.options_("face.eyeShape", "Eye shape", EYE_SHAPES),
          this.slider("face.eyeSize", "Eye size", smallLarge),
          this.slider("face.eyeSpacing", "Eye spacing", closeWide),
          this.swatches("face.eyeColour", "Eye colour", EYE_COLOURS),
          this.options_("face.browShape", "Eyebrows", BROW_SHAPES),
          this.slider("face.browHeight", "Eyebrow height", lowHigh),
          this.options_("face.noseShape", "Nose", NOSE_SHAPES),
          this.slider("face.noseWidth", "Nose width", narrowWide),
          this.slider("face.noseLength", "Nose length", shortLong),
          this.options_("face.lipShape", "Lips", LIP_SHAPES),
          this.slider("face.lipFullness", "Lip fullness", thinFull),
        );
        break;
      case "hair":
        parts.push(this.hairStyles(), this.swatches("hair.colour", "Hair colour", HAIR_COLOURS), this.options_("hair.hairline", "Hairline", HAIRLINES), this.options_("hair.facial", "Facial hair", FACIAL_HAIR, "Available for every body frame."));
        break;
      case "outfit":
        parts.push(
          this.options_("outfit.full", "Full outfit", FULL_OUTFITS),
          this.options_("outfit.top", "Top", TOPS),
          this.swatches("outfit.topColour", "Top / outfit colour", CLOTHING_COLOURS),
          this.options_("outfit.pattern", "Pattern", PATTERNS),
          this.options_("outfit.bottom", "Bottom", BOTTOMS),
          this.swatches("outfit.bottomColour", "Bottom colour", CLOTHING_COLOURS),
          this.options_("outfit.outer", "Outerwear", OUTERWEAR),
          this.swatches("outfit.outerColour", "Outerwear colour", CLOTHING_COLOURS),
          this.options_("outfit.shoes", "Shoes", SHOES),
          this.swatches("outfit.shoesColour", "Shoe colour", CLOTHING_COLOURS),
          this.options_("outfit.headwear", "Headwear", HEADWEAR, "Headwraps and headscarves cover the hair; hats cover the top of it. Your hair choice is kept."),
          this.swatches("outfit.headwearColour", "Headwear colour", CLOTHING_COLOURS),
          this.options_("outfit.glasses", "Glasses", GLASSES),
        );
        break;
    }
    return parts;
  }

  // ── Controls ──────────────────────────────────────────────────────────

  private group(path: Path, title: string, note?: string): { group: HTMLElement; row: HTMLElement } {
    const group = el("div", "picker-group");
    group.dataset.field = path;
    const heading = el("div", "picker-title", title);
    const row = el("div", "picker-row");
    group.append(heading, row);
    if (note) group.append(el("p", "picker-note", note));
    const hidden = el("p", "hidden-note");
    hidden.hidden = true;
    group.append(hidden);
    return { group, row };
  }

  private choice(row: HTMLElement, path: Path, option: Option, content: HTMLElement | string, className: string): HTMLButtonElement {
    const button = el("button", className);
    button.type = "button";
    button.setAttribute("role", "radio");
    button.dataset.value = option.id;
    button.title = option.label;
    button.setAttribute("aria-label", option.label);
    if (typeof content === "string") button.textContent = content;
    else button.append(content);
    button.setAttribute("aria-checked", String(getField(this.appearance, path) === option.id));
    button.addEventListener("click", () => {
      for (const sibling of row.closest(".picker-group")!.querySelectorAll('[role="radio"]')) sibling.setAttribute("aria-checked", String(sibling === button));
      this.setValue(path, option.id, true);
    });
    return button;
  }

  private options_(path: Path, title: string, list: readonly Option[], note?: string): HTMLElement {
    const { group, row } = this.group(path, title, note);
    group.setAttribute("role", "radiogroup");
    group.setAttribute("aria-label", title);
    for (const option of list) row.append(this.choice(row, path, option, option.label, "pill-option"));
    return group;
  }

  private swatches(path: Path, title: string, list: readonly ColourOption[]): HTMLElement {
    const { group, row } = this.group(path, title);
    group.setAttribute("role", "radiogroup");
    group.setAttribute("aria-label", title);
    const fantasy = list.some((c) => c.kind === "fantasy");
    let fantasyRow: HTMLElement | null = null;
    if (fantasy) {
      row.before(el("div", "picker-subtitle", "Natural"));
      fantasyRow = el("div", "picker-row");
      row.after(el("div", "picker-subtitle", "Fantasy"), fantasyRow);
    }
    for (const option of list) {
      const target = option.kind === "fantasy" && fantasyRow ? fantasyRow : row;
      const button = this.choice(target, path, option, "", "swatch");
      button.style.setProperty("--swatch", option.colour);
      target.append(button);
    }
    return group;
  }

  private slider(path: Path, title: string, describe: (v: number) => string): HTMLElement {
    const { group, row } = this.group(path, title);
    const id = `slider-${path.replace(".", "-")}`;
    const input = el("input", "creator-slider");
    input.type = "range";
    input.id = id;
    input.min = "0";
    input.max = "100";
    input.step = "1";
    input.dataset.field = path;
    const value = getField(this.appearance, path) as number;
    input.value = String(Math.round(value * 100));
    input.setAttribute("aria-label", title);
    const output = el("output", "slider-value", describe(value));
    output.htmlFor.add(id);
    input.addEventListener("pointerdown", () => (this.sliderStart = encodeLook(this.appearance)));
    input.addEventListener("keydown", () => (this.sliderStart ??= encodeLook(this.appearance)));
    input.addEventListener("input", () => {
      const v = roundSlider(Number(input.value) / 100);
      output.textContent = describe(v);
      this.setValue(path, v, false);
    });
    input.addEventListener("change", () => this.setValue(path, roundSlider(Number(input.value) / 100), true));
    row.append(input, output);
    return group;
  }

  private skinTone(): HTMLElement {
    const path: Path = "skin.tone";
    const { group, row } = this.group(path, "Skin tone");
    const input = el("input", "creator-slider skin-slider");
    input.type = "range";
    input.min = "0";
    input.max = "100";
    input.step = "1";
    input.id = "slider-skin-tone";
    input.dataset.field = path;
    input.setAttribute("aria-label", "Skin tone");
    const stops = Array.from({ length: 11 }, (_, i) => `${skinColour(i / 10, this.appearance.skin.undertone)} ${i * 10}%`);
    input.style.setProperty("--track", `linear-gradient(90deg, ${stops.join(", ")})`);
    input.value = String(Math.round(this.appearance.skin.tone * 100));
    const output = el("output", "slider-value", skinToneLabel(this.appearance.skin.tone));
    input.addEventListener("pointerdown", () => (this.sliderStart = encodeLook(this.appearance)));
    input.addEventListener("keydown", () => (this.sliderStart ??= encodeLook(this.appearance)));
    input.addEventListener("input", () => {
      const v = roundSlider(Number(input.value) / 100);
      output.textContent = skinToneLabel(v);
      this.setValue(path, v, false);
    });
    input.addEventListener("change", () => this.setValue(path, roundSlider(Number(input.value) / 100), true));
    row.append(input, output);
    const quick = el("div", "picker-row tone-stops");
    for (const stop of SKIN_TONE_STOPS) {
      const button = el("button", "swatch");
      button.type = "button";
      button.dataset.value = String(stop.at);
      button.title = stop.label;
      button.setAttribute("aria-label", stop.label);
      button.style.setProperty("--swatch", skinColour(stop.at, this.appearance.skin.undertone));
      button.addEventListener("click", () => {
        input.value = String(Math.round(stop.at * 100));
        output.textContent = stop.label;
        this.sliderStart = encodeLook(this.appearance);
        this.setValue(path, roundSlider(stop.at), true);
      });
      quick.append(button);
    }
    group.append(quick, el("p", "picker-note", "Any tone, from very fair to deep brown. Skin tone never affects gameplay."));
    return group;
  }

  private hairStyles(): HTMLElement {
    const path: Path = "hair.style";
    const { group, row } = this.group(path, "Hair style");
    group.setAttribute("role", "radiogroup");
    group.setAttribute("aria-label", "Hair style");
    row.classList.add("hair-styles");
    const textures: HairTexture[] = ["none", "straight", "wavy", "curly", "coily", "tightly-coiled"];
    for (const texture of textures) {
      const styles = HAIR_STYLES.filter((s) => s.texture === texture);
      if (styles.length === 0) continue;
      const block = el("div", "hair-texture");
      block.append(el("div", "picker-subtitle", HAIR_TEXTURE_LABELS[texture]));
      const line = el("div", "picker-row");
      for (const style of styles) line.append(this.choice(line, path, style, `${style.label}${"protective" in style && style.protective ? " ·" : ""}`, "pill-option"));
      block.append(line);
      row.append(block);
    }
    group.append(el("p", "picker-note", "· protective style (braids, twists, locs, cornrows)."));
    return group;
  }

  /** Shows "Covered by the headscarf" and similar under choices that aren't visible right now. */
  private refreshHiddenNotes(): void {
    const layers = visibleLayers(this.appearance);
    for (const group of this.controls.querySelectorAll<HTMLElement>(".picker-group")) {
      const note = group.querySelector<HTMLElement>(".hidden-note");
      if (!note) continue;
      const hidden = layers.hidden.find((h) => h.field === group.dataset.field);
      note.hidden = !hidden;
      note.textContent = hidden ? `${hidden.reason} — saved, but not visible right now.` : "";
      group.classList.toggle("is-hidden-choice", Boolean(hidden));
    }
  }

  // ── Presets and saved looks ───────────────────────────────────────────

  private presetsTab(): HTMLElement {
    const wrapper = el("div", "presets-tab");
    wrapper.append(el("p", "picker-note", "Optional starting points, named by their look. Hover or focus to compare in the preview, click to use, then change anything."));
    const grid = el("div", "preset-grid");
    grid.setAttribute("role", "list");
    for (const preset of APPEARANCE_PRESETS) {
      const card = el("button", "preset-card");
      card.type = "button";
      card.dataset.preset = preset.id;
      card.setAttribute("role", "listitem");
      card.setAttribute("aria-label", `Use preset: ${preset.label}`);
      const image = el("img", "preset-thumb");
      image.alt = "";
      image.width = 96;
      image.height = 120;
      const cached = this.thumbnails.get(preset.id);
      if (cached) image.src = cached;
      card.append(image, el("span", "preset-label", preset.label));
      card.setAttribute("aria-pressed", String(sameAppearance(preset.appearance, this.appearance)));
      const preview = () => {
        this.previewing = preset.appearance;
        this.scheduleBuild();
      };
      const endPreview = () => {
        if (this.previewing !== preset.appearance) return;
        this.previewing = null;
        this.scheduleBuild();
      };
      card.addEventListener("pointerenter", (event) => event.pointerType === "mouse" && preview());
      card.addEventListener("pointerleave", endPreview);
      card.addEventListener("focus", preview);
      card.addEventListener("blur", endPreview);
      card.addEventListener("click", () => {
        this.previewing = null;
        this.apply(preset.appearance);
        this.status(`Using “${preset.label}”. Change anything you like.`);
      });
      grid.append(card);
    }
    wrapper.append(grid, this.lookCodes());
    if (this.thumbnails.size < APPEARANCE_PRESETS.length) requestAnimationFrame(() => void this.renderThumbnails(grid));
    return wrapper;
  }

  private thumbnailsRunning = false;

  /** Draws preset thumbnails one per frame with a small offscreen renderer, then frees it. */
  private async renderThumbnails(grid: HTMLElement): Promise<void> {
    if (this.thumbnailsRunning) return;
    this.thumbnailsRunning = true;
    const canvas = document.createElement("canvas");
    let stage: PreviewStage | null = null;
    try {
      stage = new PreviewStage(canvas, { antialias: true, background: 0xf4ece1 });
      stage.renderer.setPixelRatio(1);
      stage.setSize(192, 240);
      for (const preset of APPEARANCE_PRESETS) {
        if (!this.running) break;
        if (!this.thumbnails.has(preset.id)) {
          const model = new CharacterModel(preset.appearance);
          model.pose({ moving: false, seated: false, activity: "idle", time: 0 });
          stage.show(model);
          stage.frame(model, "body", 0.3);
          stage.render();
          this.thumbnails.set(preset.id, canvas.toDataURL("image/png"));
          model.dispose();
        }
        const image = grid.querySelector<HTMLImageElement>(`[data-preset="${preset.id}"] img`);
        if (image && !image.src) image.src = this.thumbnails.get(preset.id)!;
        await new Promise((resolve) => requestAnimationFrame(resolve));
      }
    } catch (error) {
      console.warn("Preset thumbnails unavailable", error);
    } finally {
      stage?.renderer.forceContextLoss();
      stage?.dispose();
      this.thumbnailsRunning = false;
    }
  }

  private lookCodesOpen = false;

  private lookCodes(): HTMLElement {
    const box = el("details", "look-codes");
    // Stays open when the tab re-renders (e.g. after applying a code).
    box.open = this.lookCodesOpen;
    box.addEventListener("toggle", () => (this.lookCodesOpen = box.open));
    box.append(el("summary", undefined, "Saved looks and look codes"));
    const saved = el("div", "saved-looks");
    const renderSaved = () => {
      saved.replaceChildren();
      const list = readSavedLooks();
      if (list.length === 0) saved.append(el("p", "picker-note", "No looks saved in this browser yet."));
      for (const [index, entry] of list.entries()) {
        const item = el("div", "saved-look");
        const load = el("button", "tool-button", entry.name);
        load.type = "button";
        load.dataset.action = "load-look";
        load.addEventListener("click", () => {
          const config = fromLookCode(entry.code);
          if (config) {
            this.apply(config);
            this.status(`Loaded “${entry.name}”.`);
          } else this.status("That saved look is from an older version and can't be loaded.");
        });
        const remove = el("button", "tool-button", "Remove");
        remove.type = "button";
        remove.addEventListener("click", () => {
          writeSavedLooks(readSavedLooks().filter((_, i) => i !== index));
          renderSaved();
        });
        item.append(load, remove);
        saved.append(item);
      }
    };
    renderSaved();
    const save = el("button", "tool-button", "Save this look in this browser");
    save.type = "button";
    save.dataset.action = "save-look";
    save.addEventListener("click", () => {
      const list = readSavedLooks();
      const name = `Look ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
      const ok = writeSavedLooks([{ name, code: toLookCode(this.appearance) }, ...list].slice(0, MAX_SAVED_LOOKS));
      this.status(ok ? `Saved as “${name}” in this browser (up to ${MAX_SAVED_LOOKS}).` : "This browser won't let the game save looks.");
      renderSaved();
    });
    const codeRow = el("div", "look-code-row");
    const codeInput = el("input", "look-code-input");
    codeInput.type = "text";
    codeInput.placeholder = "Paste a look code (PLS1.…)";
    codeInput.setAttribute("aria-label", "Look code");
    const copy = el("button", "tool-button", "Copy my look code");
    copy.type = "button";
    copy.dataset.action = "copy-look";
    copy.addEventListener("click", async () => {
      const code = toLookCode(this.appearance);
      codeInput.value = code;
      try {
        // Some browsers never settle the clipboard promise without permission: give up after a second.
        await Promise.race([navigator.clipboard.writeText(code), new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 1000))]);
        this.status("Look code copied.");
      } catch {
        codeInput.select();
        this.status("Look code shown above: copy it from the box.");
      }
    });
    const use = el("button", "tool-button", "Use code");
    use.type = "button";
    use.dataset.action = "use-look-code";
    use.addEventListener("click", () => {
      const config = fromLookCode(codeInput.value);
      if (!config) {
        this.status("That look code isn't valid.");
        return;
      }
      this.apply(config);
      this.status("Look code applied.");
    });
    codeRow.append(codeInput, use);
    box.append(saved, save, copy, codeRow);
    return box;
  }
}

const narrowWide = (v: number) => (v < 0.34 ? "Narrow" : v > 0.66 ? "Wide" : "Medium");
const shortLong = (v: number) => (v < 0.34 ? "Short" : v > 0.66 ? "Long" : "Medium");
const lowHigh = (v: number) => (v < 0.34 ? "Low" : v > 0.66 ? "High" : "Medium");
const smallLarge = (v: number) => (v < 0.34 ? "Small" : v > 0.66 ? "Large" : "Medium");
const closeWide = (v: number) => (v < 0.34 ? "Close" : v > 0.66 ? "Wide" : "Medium");
const softDefined = (v: number) => (v < 0.34 ? "Soft" : v > 0.66 ? "Defined" : "Medium");
const thinFull = (v: number) => (v < 0.34 ? "Thin" : v > 0.66 ? "Full" : "Medium");
const noneStrong = (v: number) => (v < 0.05 ? "None" : v < 0.4 ? "Light" : v < 0.7 ? "Medium" : "Strong");

// The spec table is the source of truth for which fields exist; fail loudly in development if a field has no control.
if (import.meta.env.DEV) {
  const covered = new Set([
    "body.frame", "body.build", "body.height", "body.shoulders", "body.torso", "body.legs", "body.arms",
    "skin.tone", "skin.undertone", "skin.freckles", "skin.mark", "skin.blush",
    "face.shape", "face.cheekbones", "face.jaw", "face.chin", "face.forehead", "face.eyeShape", "face.eyeSize", "face.eyeSpacing", "face.eyeColour",
    "face.browShape", "face.browHeight", "face.noseShape", "face.noseWidth", "face.noseLength", "face.lipShape", "face.lipFullness",
    "hair.style", "hair.colour", "hair.hairline", "hair.facial",
    "outfit.top", "outfit.topColour", "outfit.pattern", "outfit.bottom", "outfit.bottomColour", "outfit.full", "outfit.shoes", "outfit.shoesColour",
    "outfit.outer", "outfit.outerColour", "outfit.glasses", "outfit.headwear", "outfit.headwearColour",
  ]);
  for (const [section, fields] of Object.entries(APPEARANCE_SPEC)) {
    for (const field of Object.keys(fields)) if (!covered.has(`${section}.${field}`)) console.error(`Creator has no control for ${section}.${field}`);
  }
}
