// Character creator: the live 3D preview and the controls for every part of
// the appearance config, grouped as Appearance, Face, Hair, Body, Clothing
// and Accessories (shared/src/appearance/categories.ts). Used when creating
// a character and when editing one (from the title screen or in the world).
// The screen around it (creatorScreen.ts) adds the header, review step and
// buttons. The server validates everything again on save.
//
// Preview: drag (mouse or touch) to turn, wheel or pinch to zoom, buttons
// and arrow / +/- keys for the same. Controls: option buttons, colour
// swatches and sliders; randomise all or one category, reset a category,
// undo / redo, hold to compare with the starting look, starting looks
// (presets), look codes and looks saved in this browser.

import {
  APPEARANCE_PRESETS,
  BEAUTY_MARKS,
  BODY_FRAMES,
  BOTTOMS,
  BROW_SHAPES,
  BUILDS,
  CATEGORY_FIELDS,
  CATEGORY_LABELS,
  CLOTHING_COLOURS,
  CREATOR_CATEGORIES,
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
  allFieldPaths,
  cloneAppearance,
  encodeLook,
  fromLookCode,
  getAppearanceField,
  heightCm,
  parseAppearanceConfig,
  randomAppearance,
  randomiseCategory,
  resetCategory,
  roundSlider,
  sameAppearance,
  setAppearanceField,
  skinColour,
  skinToneLabel,
  toLookCode,
  visibleLayers,
  type AppearanceConfig,
  type ColourOption,
  type CreatorCategory,
  type FieldPath,
  type HairTexture,
  type Option,
} from "@padova/shared";
import { CharacterModel } from "../render/avatar/index.ts";
import { PreviewStage, VIEW_ZOOM, type PreviewView } from "../render/previewStage.ts";
import { el, icon, iconButton } from "./screens/dom.ts";
import { ICONS } from "./screens/icons.ts";
import { fillPortrait } from "./screens/portraits.ts";
import { cameraSpeedFactor, prefersReducedMotion } from "./settings.ts";

export interface CreatorOptions {
  mode: "create" | "edit";
  initial: AppearanceConfig;
  /** Element that carries data-look / data-showing / data-build-ms (read by tests and tools). */
  host: HTMLElement;
  onChange?: (appearance: AppearanceConfig) => void;
}

const HISTORY_LIMIT = 60;
const SAVED_LOOKS_KEY = "padova.savedLooks";
const MAX_SAVED_LOOKS = 6;
const MIN_ZOOM = 0;
const MAX_ZOOM = 2;
/** Where the camera goes when a category opens (0 body … 2 face). */
const CATEGORY_ZOOM: Partial<Record<CreatorCategory, number>> = { face: 2, hair: 1.25, accessories: 1.35, body: 0, clothing: 0 };

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

export class CharacterCreator {
  /** The 3D preview with its camera toolbar. */
  readonly preview: HTMLElement;
  /** History tools, category tabs and the options of the open category. */
  readonly controls: HTMLElement;
  private appearance: AppearanceConfig;
  private readonly initial: AppearanceConfig;
  private readonly host: HTMLElement;
  private readonly history: string[] = [];
  private future: string[] = [];
  private category: CreatorCategory;
  private readonly stage: PreviewStage;
  private readonly model: CharacterModel;
  private readonly canvas: HTMLCanvasElement;
  private zoom = 0;
  private targetZoom = 0;
  private yaw = 0.35;
  private comparing: AppearanceConfig | null = null;
  private previewing: AppearanceConfig | null = null;
  private pendingBuild = false;
  private reviewing = false;
  private dragging = false;
  private frame = 0;
  private lastTick = performance.now();
  private lastTurn = performance.now();
  private running = true;
  private readonly panel: HTMLElement;
  private readonly tabList: HTMLElement;
  private readonly statusLine: HTMLElement;
  private readonly undoButton: HTMLButtonElement;
  private readonly redoButton: HTMLButtonElement;
  private readonly viewButtons: HTMLButtonElement[] = [];
  private resizeObserver: ResizeObserver | null = null;
  private sliderStart: string | null = null;

  constructor(private readonly options: CreatorOptions) {
    this.initial = cloneAppearance(options.initial);
    this.appearance = cloneAppearance(options.initial);
    this.host = options.host;
    this.category = options.mode === "create" ? "appearance" : "hair";

    // ── Preview ──
    this.preview = el("div", "creator-preview");
    const stageBox = el("div", "creator-stage");
    this.canvas = el("canvas", "creator-canvas");
    this.canvas.tabIndex = 0;
    this.canvas.setAttribute("role", "img");
    this.canvas.setAttribute("aria-label", "Live 3D preview of your character. Drag to turn, scroll or pinch to zoom. Arrow keys turn, plus and minus zoom.");
    stageBox.append(this.canvas);
    const toolbar = el("div", "creator-toolbar");
    const views = el("div", "tool-group view-group");
    views.setAttribute("role", "group");
    views.setAttribute("aria-label", "Camera");
    for (const [id, label] of [["body", "Body"], ["upper", "Upper"], ["face", "Face"]] as [PreviewView, string][]) {
      const b = el("button", "tool-button", label);
      b.type = "button";
      b.dataset.action = `view-${id}`;
      b.title = `Show ${label.toLowerCase()}`;
      b.addEventListener("click", () => this.setZoom(VIEW_ZOOM[id]));
      this.viewButtons.push(b);
      views.append(b);
    }
    const camera = el("div", "tool-group");
    camera.append(
      iconButton(ICONS.turnLeft, "Turn left", { className: "tool-button is-icon", action: "turn-left", onClick: () => (this.yaw -= Math.PI / 4) }),
      iconButton(ICONS.turnRight, "Turn right", { className: "tool-button is-icon", action: "turn-right", onClick: () => (this.yaw += Math.PI / 4) }),
      iconButton(ICONS.zoomOut, "Zoom out", { className: "tool-button is-icon", action: "zoom-out", onClick: () => this.setZoom(this.targetZoom - 0.5) }),
      iconButton(ICONS.zoomIn, "Zoom in", { className: "tool-button is-icon", action: "zoom-in", onClick: () => this.setZoom(this.targetZoom + 0.5) }),
    );
    const compare = el("button", "tool-button compare-button");
    compare.type = "button";
    compare.dataset.action = "compare";
    compare.title = "Hold to see the look you started with";
    compare.append(icon(ICONS.compare), el("span", undefined, options.mode === "create" ? "Hold to compare" : "Hold for saved look"));
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
    compare.addEventListener("contextmenu", (event) => event.preventDefault()); // long-press on phones
    compare.addEventListener("keydown", (event) => (event.key === " " || event.key === "Enter") && startCompare(event));
    compare.addEventListener("keyup", stopCompare);
    compare.addEventListener("blur", stopCompare);
    toolbar.append(views, camera, compare);
    this.preview.append(stageBox, toolbar);

    // ── Controls ──
    this.controls = el("div", "creator-controls-wrap");
    const history = el("div", "creator-history");
    this.undoButton = iconButton(ICONS.undo, "Undo (Ctrl+Z)", { className: "tool-button is-icon", action: "undo", onClick: () => this.undo() });
    this.redoButton = iconButton(ICONS.redo, "Redo (Ctrl+Shift+Z)", { className: "tool-button is-icon", action: "redo", onClick: () => this.redo() });
    const randomAll = el("button", "tool-button");
    randomAll.type = "button";
    randomAll.dataset.action = "randomise-all";
    randomAll.title = "A completely random look";
    randomAll.append(icon(ICONS.dice), el("span", undefined, "Randomise all"));
    randomAll.addEventListener("click", () => this.apply(randomAppearance(this.seed())));
    history.append(randomAll, this.undoButton, this.redoButton);

    this.tabList = el("div", "creator-tabs");
    this.tabList.setAttribute("role", "tablist");
    this.tabList.setAttribute("aria-label", "Appearance categories");
    for (const id of CREATOR_CATEGORIES) {
      const tab = el("button", "creator-tab");
      tab.type = "button";
      tab.id = `creator-tab-${id}`;
      tab.setAttribute("role", "tab");
      tab.setAttribute("aria-controls", "creator-panel");
      tab.dataset.tab = id;
      tab.append(icon(ICONS[id]), el("span", "creator-tab-label", CATEGORY_LABELS[id]));
      tab.addEventListener("click", () => this.showCategory(id));
      this.tabList.append(tab);
    }
    this.tabList.addEventListener("keydown", (event) => {
      const index = CREATOR_CATEGORIES.indexOf(this.category);
      const step = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 0;
      if (!step) return;
      event.preventDefault();
      const next = CREATOR_CATEGORIES[(index + step + CREATOR_CATEGORIES.length) % CREATOR_CATEGORIES.length]!;
      this.showCategory(next);
      this.tabList.querySelector<HTMLButtonElement>(`[data-tab="${next}"]`)?.focus();
    });
    this.panel = el("div", "creator-controls");
    this.panel.id = "creator-panel";
    this.panel.setAttribute("role", "tabpanel");
    this.statusLine = el("p", "creator-status");
    this.statusLine.setAttribute("aria-live", "polite");
    this.controls.append(history, this.tabList, this.panel, this.statusLine);

    // ── 3D ──
    this.stage = new PreviewStage(this.canvas, { background: null });
    this.model = new CharacterModel(this.appearance);
    this.model.pose({ moving: false, seated: false, activity: "idle", time: 0 });
    this.host.dataset.showing = "current";
    this.stage.show(this.model);
    this.attachPointer();
    this.canvas.addEventListener("keydown", (event) => {
      const turns: Record<string, number> = { ArrowLeft: -Math.PI / 12, ArrowRight: Math.PI / 12 };
      if (event.key in turns) {
        event.preventDefault();
        this.yaw += turns[event.key]!;
      } else if (event.key === "+" || event.key === "=") {
        event.preventDefault();
        this.setZoom(this.targetZoom + 0.25);
      } else if (event.key === "-" || event.key === "_") {
        event.preventDefault();
        this.setZoom(this.targetZoom - 0.25);
      }
    });
    this.host.addEventListener("keydown", (event) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "z" || this.reviewing) return;
      if ((event.target as HTMLElement).tagName === "INPUT" && (event.target as HTMLInputElement).type === "text") return;
      event.preventDefault();
      if (event.shiftKey) this.redo();
      else this.undo();
    });
    this.showCategory(this.category);
    this.refreshHistoryButtons();
    this.host.dataset.look = encodeLook(this.appearance);
    if (import.meta.env.DEV || new URLSearchParams(location.search).has("e2e")) {
      (window as unknown as { __creator: unknown }).__creator = {
        /** Kept for tests: the creator only animates while reviewing, so it is otherwise still. */
        freeze: () => undefined,
        stats: () => ({ ...this.model.stats }),
        showing: () => this.host.dataset.showing,
        camera: () => ({ yaw: this.yaw, zoom: this.zoom }),
      };
    }
    this.loop();
  }

  /** Must be called once the elements are in the document (to size the preview). */
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

  get initialValue(): AppearanceConfig {
    return cloneAppearance(this.initial);
  }

  /** True when the look differs from the one the creator opened with. */
  get changed(): boolean {
    return !sameAppearance(this.appearance, this.initial);
  }

  /** Shows a different look without adding to the history (e.g. a draft kept while going back a step). */
  startFrom(look: AppearanceConfig): void {
    this.apply(look, false);
  }

  /** Review step: slow turntable, whole body; controls are hidden by the screen. */
  setReviewing(reviewing: boolean): void {
    this.reviewing = reviewing;
    this.comparing = null;
    this.previewing = null;
    this.scheduleBuild();
    if (reviewing) this.setZoom(0);
    else this.setZoom(CATEGORY_ZOOM[this.category] ?? this.targetZoom);
  }

  status(text: string): void {
    this.statusLine.textContent = text;
  }

  destroy(): void {
    this.running = false;
    cancelAnimationFrame(this.frame);
    this.resizeObserver?.disconnect();
    this.visibilityObserver?.disconnect();
    this.model.dispose();
    this.stage.renderer.forceContextLoss();
    this.stage.dispose();
    const hook = window as unknown as { __creator?: unknown };
    if (hook.__creator) delete hook.__creator;
  }

  // ── State ─────────────────────────────────────────────────────────────

  private seed(): number {
    return Math.floor(Math.random() * 2 ** 31);
  }

  private record(before: string): void {
    this.history.push(before);
    if (this.history.length > HISTORY_LIMIT) this.history.shift();
    this.future = [];
  }

  /** Replaces the whole look (preset, randomise, undo…), recording history. */
  private apply(next: AppearanceConfig, record = true): void {
    const parsed = parseAppearanceConfig(next);
    if (!parsed.ok) {
      this.status(`That look couldn't be used (${parsed.field}).`);
      return;
    }
    if (sameAppearance(parsed.value, this.appearance)) return;
    if (record) this.record(encodeLook(this.appearance));
    this.appearance = parsed.value;
    this.changed_();
    this.renderPanel();
  }

  /** Changes one field. Sliders call this on every move with record=false, then once on release. */
  private setValue(path: FieldPath, value: unknown, record: boolean): void {
    if (getAppearanceField(this.appearance, path) === value && !record) return;
    const next = cloneAppearance(this.appearance);
    setAppearanceField(next, path, value);
    if (record) {
      const before = this.sliderStart ?? encodeLook(this.appearance);
      this.sliderStart = null;
      if (before !== encodeLook(next)) this.record(before);
    }
    this.appearance = next;
    this.changed_();
    // The skin-tone track and swatches are drawn for the current undertone.
    if (record && path === "skin.undertone") this.renderPanel();
    else this.refreshHiddenNotes();
  }

  private changed_(): void {
    this.options.onChange?.(this.value);
    this.host.dataset.look = encodeLook(this.appearance);
    this.refreshHistoryButtons();
    this.scheduleBuild();
  }

  private undo(): void {
    const previous = this.history.pop();
    if (!previous) return;
    this.future.push(encodeLook(this.appearance));
    this.appearance = JSON.parse(previous) as AppearanceConfig;
    this.changed_();
    this.renderPanel();
    this.status("Undone.");
  }

  private redo(): void {
    const next = this.future.pop();
    if (!next) return;
    this.history.push(encodeLook(this.appearance));
    this.appearance = JSON.parse(next) as AppearanceConfig;
    this.changed_();
    this.renderPanel();
    this.status("Redone.");
  }

  private refreshHistoryButtons(): void {
    this.undoButton.disabled = this.history.length === 0;
    this.redoButton.disabled = this.future.length === 0;
  }

  // ── Preview ───────────────────────────────────────────────────────────

  private scheduleBuild(): void {
    this.pendingBuild = true;
  }

  private setZoom(zoom: number): void {
    this.targetZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
    if (prefersReducedMotion()) this.zoom = this.targetZoom;
    const nearest = Math.round(this.targetZoom);
    for (const b of this.viewButtons) {
      const view = b.dataset.action!.slice(5) as PreviewView;
      b.setAttribute("aria-pressed", String(Math.abs(VIEW_ZOOM[view] - this.targetZoom) < 0.01 || (VIEW_ZOOM[view] === nearest && Math.abs(nearest - this.targetZoom) < 0.13)));
    }
  }

  private builds = 0;
  private renderedKey = "";

  /**
   * Renders only when something visible changed (look, angle, zoom, size),
   * except during the review turntable: a still preview costs nothing on
   * phones and laptops on battery.
   */
  private loop = (): void => {
    if (!this.running) return;
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.lastTick) / 1000);
    this.lastTick = now;
    if (this.pendingBuild) {
      this.pendingBuild = false;
      const shown = this.comparing ?? this.previewing ?? this.appearance;
      this.host.dataset.showing = this.comparing ? "compare" : this.previewing ? "preview" : "current";
      const stats = this.model.setAppearance(shown);
      this.model.pose({ moving: false, seated: false, activity: "idle", time: 0 });
      this.host.dataset.buildMs = stats.buildMs.toFixed(1);
      this.host.dataset.rebuilt = stats.rebuilt.join(",");
      this.host.dataset.fallback = stats.fallback.join(",");
      if (stats.fallback.length > 0) this.status("Part of this look couldn't be drawn, so the default is shown there. Your choice is still saved; please report this.");
      this.builds++;
    }
    // Review turntable at 30 fps: half the rendering cost of 60 fps for a slow turn.
    const turning = this.reviewing && !this.dragging && !prefersReducedMotion();
    if (turning && now - this.lastTurn >= 33) {
      this.yaw += (now - this.lastTurn) / 1000 * 0.5;
      this.lastTurn = now;
    } else if (!turning) this.lastTurn = now;
    if (Math.abs(this.zoom - this.targetZoom) > 0.002) this.zoom += (this.targetZoom - this.zoom) * (1 - Math.exp(-dt * 12));
    else this.zoom = this.targetZoom;
    const key = `${this.builds}|${this.zoom.toFixed(3)}|${this.yaw.toFixed(3)}|${this.canvas.width}x${this.canvas.height}`;
    if (key !== this.renderedKey) {
      this.renderedKey = key;
      this.stage.frameAt(this.model, this.zoom, this.yaw);
      this.stage.render();
    }
    this.frame = requestAnimationFrame(this.loop);
  };

  /** Drag to turn (any pointer), wheel to zoom, two-finger pinch to zoom. */
  private attachPointer(): void {
    const pointers = new Map<number, { x: number; y: number }>();
    let pinchStart: { distance: number; zoom: number } | null = null;
    const distance = () => {
      const [a, b] = [...pointers.values()];
      return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
    };
    this.canvas.addEventListener("pointerdown", (event) => {
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      this.canvas.setPointerCapture(event.pointerId);
      this.dragging = true;
      if (pointers.size === 2) pinchStart = { distance: distance(), zoom: this.targetZoom };
    });
    this.canvas.addEventListener("pointermove", (event) => {
      const last = pointers.get(event.pointerId);
      if (!last) return;
      const dx = event.clientX - last.x;
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (pointers.size === 1) this.yaw += dx * 0.012 * cameraSpeedFactor();
      else if (pinchStart && pinchStart.distance > 0) {
        this.setZoom(pinchStart.zoom + Math.log2(distance() / pinchStart.distance) * 1.4);
        this.zoom = this.targetZoom;
      }
    });
    const end = (event: PointerEvent) => {
      pointers.delete(event.pointerId);
      if (pointers.size < 2) pinchStart = null;
      if (pointers.size === 0) this.dragging = false;
    };
    this.canvas.addEventListener("pointerup", end);
    this.canvas.addEventListener("pointercancel", end);
    this.canvas.addEventListener(
      "wheel",
      (event) => {
        event.preventDefault();
        this.setZoom(this.targetZoom - event.deltaY * 0.0025);
      },
      { passive: false },
    );
  }

  // ── Categories ────────────────────────────────────────────────────────

  showCategory(category: CreatorCategory): void {
    this.category = category;
    for (const tab of this.tabList.querySelectorAll<HTMLButtonElement>(".creator-tab")) {
      const selected = tab.dataset.tab === category;
      tab.setAttribute("aria-selected", String(selected));
      tab.tabIndex = selected ? 0 : -1;
    }
    this.panel.setAttribute("aria-labelledby", `creator-tab-${category}`);
    const zoom = CATEGORY_ZOOM[category];
    if (zoom !== undefined && !this.reviewing) this.setZoom(zoom);
    this.renderPanel();
    this.panel.scrollTop = 0;
    // On phones the selected tab may be scrolled out of its strip.
    this.tabList.querySelector<HTMLElement>(`[data-tab="${category}"]`)?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }

  private renderPanel(): void {
    const scroll = this.panel.scrollTop;
    // The old content is about to go: stop watching its portraits (cached ones refill at once).
    this.visibilityObserver?.disconnect();
    this.visibilityObserver = null;
    this.panel.replaceChildren(...this.categoryContent(this.category));
    this.panel.dataset.tab = this.category;
    this.panel.scrollTop = scroll;
    this.refreshHiddenNotes();
  }

  private categoryTools(category: CreatorCategory): HTMLElement {
    const row = el("div", "section-tools");
    const name = CATEGORY_LABELS[category].toLowerCase();
    const randomise = el("button", "tool-button");
    randomise.type = "button";
    randomise.dataset.action = `randomise-${category}`;
    randomise.append(icon(ICONS.dice), el("span", undefined, `Randomise ${name}`));
    randomise.addEventListener("click", () => this.apply(randomiseCategory(this.appearance, category, this.seed())));
    const reset = el("button", "tool-button");
    reset.type = "button";
    reset.dataset.action = `reset-${category}`;
    reset.title = this.options.mode === "create" ? "Back to the starting look" : "Back to your saved look";
    reset.append(icon(ICONS.reset), el("span", undefined, `Reset ${name}`));
    reset.addEventListener("click", () => {
      this.apply(resetCategory(this.appearance, category, this.initial));
      this.status(`${CATEGORY_LABELS[category]} reset.`);
    });
    row.append(randomise, reset);
    return row;
  }

  private categoryContent(category: CreatorCategory): HTMLElement[] {
    const parts: HTMLElement[] = [this.categoryTools(category)];
    switch (category) {
      case "appearance":
        parts.push(
          this.startingLooks(),
          this.skinTone(),
          this.options_("skin.undertone", "Undertone", UNDERTONES),
          this.options_("skin.freckles", "Freckles", FRECKLES),
          this.options_("skin.mark", "Beauty mark", BEAUTY_MARKS),
          this.slider("skin.blush", "Blush", noneStrong),
          this.lookCodes(),
        );
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
        parts.push(
          this.hairStyles(),
          this.swatches("hair.colour", "Hair colour", HAIR_COLOURS),
          this.options_("hair.hairline", "Hairline", HAIRLINES),
          this.options_("hair.facial", "Facial hair", FACIAL_HAIR, "Available for every body frame."),
        );
        break;
      case "body":
        parts.push(
          this.options_("body.frame", "Body frame", BODY_FRAMES, "Frames change proportions only. Any look works with any frame."),
          this.options_("body.build", "Build", BUILDS),
          this.slider("body.height", "Height", (v) => `${heightCm(v)} cm`),
          this.slider("body.shoulders", "Shoulders", narrowWide),
          this.slider("body.torso", "Torso length", shortLong),
          this.slider("body.legs", "Leg length", shortLong),
          this.slider("body.arms", "Arm length", shortLong),
        );
        break;
      case "clothing":
        parts.push(
          this.options_("outfit.full", "Full outfit", FULL_OUTFITS),
          this.options_("outfit.top", "Top", TOPS),
          this.swatches("outfit.topColour", "Top or outfit colour", CLOTHING_COLOURS),
          this.options_("outfit.pattern", "Pattern", PATTERNS),
          this.options_("outfit.bottom", "Bottom", BOTTOMS),
          this.swatches("outfit.bottomColour", "Bottom colour", CLOTHING_COLOURS),
          this.options_("outfit.outer", "Outerwear", OUTERWEAR),
          this.swatches("outfit.outerColour", "Outerwear colour", CLOTHING_COLOURS),
          this.options_("outfit.shoes", "Shoes", SHOES),
          this.swatches("outfit.shoesColour", "Shoe colour", CLOTHING_COLOURS),
        );
        break;
      case "accessories":
        parts.push(
          this.options_("outfit.headwear", "Headwear", HEADWEAR, "Headwraps and headscarves cover the hair; hats cover the top of it. Your hair choice is kept."),
          this.swatches("outfit.headwearColour", "Headwear colour", CLOTHING_COLOURS),
          this.options_("outfit.glasses", "Glasses", GLASSES),
        );
        break;
    }
    return parts;
  }

  // ── Controls ──────────────────────────────────────────────────────────

  private group(path: FieldPath, title: string, note?: string): { group: HTMLElement; row: HTMLElement } {
    const group = el("div", "picker-group");
    group.dataset.field = path;
    const heading = el("div", "picker-title", title);
    heading.id = `picker-${path.replace(".", "-")}`;
    const row = el("div", "picker-row");
    group.append(heading, row);
    if (note) group.append(el("p", "picker-note", note));
    const hidden = el("p", "hidden-note");
    hidden.hidden = true;
    group.append(hidden);
    return { group, row };
  }

  private choice(row: HTMLElement, path: FieldPath, option: Option, content: HTMLElement | string, className: string): HTMLButtonElement {
    const b = el("button", className);
    b.type = "button";
    b.setAttribute("role", "radio");
    b.dataset.value = option.id;
    b.title = option.label;
    b.setAttribute("aria-label", option.label);
    if (typeof content === "string") b.textContent = content;
    else b.append(content);
    b.setAttribute("aria-checked", String(getAppearanceField(this.appearance, path) === option.id));
    b.addEventListener("click", () => {
      for (const sibling of row.closest(".picker-group")!.querySelectorAll('[role="radio"]')) sibling.setAttribute("aria-checked", String(sibling === b));
      this.setValue(path, option.id, true);
    });
    return b;
  }

  private options_(path: FieldPath, title: string, list: readonly Option[], note?: string): HTMLElement {
    const { group, row } = this.group(path, title, note);
    group.setAttribute("role", "radiogroup");
    group.setAttribute("aria-labelledby", `picker-${path.replace(".", "-")}`);
    for (const option of list) row.append(this.choice(row, path, option, option.label, "pill-option"));
    return group;
  }

  private swatches(path: FieldPath, title: string, list: readonly ColourOption[]): HTMLElement {
    const { group, row } = this.group(path, title);
    group.setAttribute("role", "radiogroup");
    group.setAttribute("aria-labelledby", `picker-${path.replace(".", "-")}`);
    const fantasy = list.some((c) => c.kind === "fantasy");
    let fantasyRow: HTMLElement | null = null;
    if (fantasy) {
      row.before(el("div", "picker-subtitle", "Natural"));
      fantasyRow = el("div", "picker-row");
      row.after(el("div", "picker-subtitle", "Fantasy"), fantasyRow);
    }
    for (const option of list) {
      const target = option.kind === "fantasy" && fantasyRow ? fantasyRow : row;
      const b = this.choice(target, path, option, "", "swatch");
      b.style.setProperty("--swatch", option.colour);
      target.append(b);
    }
    return group;
  }

  private slider(path: FieldPath, title: string, describe: (v: number) => string): HTMLElement {
    const { group, row } = this.group(path, title);
    const id = `slider-${path.replace(".", "-")}`;
    const input = el("input", "creator-slider");
    input.type = "range";
    input.id = id;
    input.min = "0";
    input.max = "100";
    input.step = "1";
    input.dataset.field = path;
    const value = getAppearanceField(this.appearance, path) as number;
    input.value = String(Math.round(value * 100));
    input.setAttribute("aria-labelledby", `picker-${path.replace(".", "-")}`);
    const output = el("output", "slider-value", describe(value));
    output.htmlFor.add(id);
    input.setAttribute("aria-valuetext", describe(value));
    input.addEventListener("pointerdown", () => (this.sliderStart = encodeLook(this.appearance)));
    input.addEventListener("keydown", () => (this.sliderStart ??= encodeLook(this.appearance)));
    input.addEventListener("input", () => {
      const v = roundSlider(Number(input.value) / 100);
      output.textContent = describe(v);
      input.setAttribute("aria-valuetext", describe(v));
      this.setValue(path, v, false);
    });
    input.addEventListener("change", () => this.setValue(path, roundSlider(Number(input.value) / 100), true));
    row.append(input, output);
    return group;
  }

  private skinTone(): HTMLElement {
    const path: FieldPath = "skin.tone";
    const { group, row } = this.group(path, "Skin tone");
    const input = el("input", "creator-slider skin-slider");
    input.type = "range";
    input.min = "0";
    input.max = "100";
    input.step = "1";
    input.id = "slider-skin-tone";
    input.dataset.field = path;
    input.setAttribute("aria-labelledby", "picker-skin-tone");
    const stops = Array.from({ length: 11 }, (_, i) => `${skinColour(i / 10, this.appearance.skin.undertone)} ${i * 10}%`);
    input.style.setProperty("--track", `linear-gradient(90deg, ${stops.join(", ")})`);
    input.value = String(Math.round(this.appearance.skin.tone * 100));
    input.setAttribute("aria-valuetext", skinToneLabel(this.appearance.skin.tone));
    const output = el("output", "slider-value", skinToneLabel(this.appearance.skin.tone));
    input.addEventListener("pointerdown", () => (this.sliderStart = encodeLook(this.appearance)));
    input.addEventListener("keydown", () => (this.sliderStart ??= encodeLook(this.appearance)));
    input.addEventListener("input", () => {
      const v = roundSlider(Number(input.value) / 100);
      output.textContent = skinToneLabel(v);
      input.setAttribute("aria-valuetext", skinToneLabel(v));
      this.setValue(path, v, false);
    });
    input.addEventListener("change", () => this.setValue(path, roundSlider(Number(input.value) / 100), true));
    row.append(input, output);
    const quick = el("div", "picker-row tone-stops");
    for (const stop of SKIN_TONE_STOPS) {
      const b = el("button", "swatch");
      b.type = "button";
      b.dataset.value = String(stop.at);
      b.title = stop.label;
      b.setAttribute("aria-label", stop.label);
      b.style.setProperty("--swatch", skinColour(stop.at, this.appearance.skin.undertone));
      b.addEventListener("click", () => {
        input.value = String(Math.round(stop.at * 100));
        output.textContent = stop.label;
        this.sliderStart = encodeLook(this.appearance);
        this.setValue(path, roundSlider(stop.at), true);
      });
      quick.append(b);
    }
    group.append(quick, el("p", "picker-note", "Any tone, from very fair to deep brown. Skin tone never affects gameplay."));
    return group;
  }

  private hairStyles(): HTMLElement {
    const path: FieldPath = "hair.style";
    const { group, row } = this.group(path, "Hair style");
    group.setAttribute("role", "radiogroup");
    group.setAttribute("aria-labelledby", "picker-hair-style");
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
    for (const group of this.panel.querySelectorAll<HTMLElement>(".picker-group")) {
      const note = group.querySelector<HTMLElement>(".hidden-note");
      if (!note) continue;
      const hidden = layers.hidden.find((h) => h.field === group.dataset.field);
      note.hidden = !hidden;
      note.textContent = hidden ? `${hidden.reason}: saved, but not visible right now.` : "";
      group.classList.toggle("is-hidden-choice", Boolean(hidden));
    }
  }

  // ── Starting looks and saved looks ────────────────────────────────────

  private startingLooks(): HTMLElement {
    const wrapper = el("div", "presets-tab");
    wrapper.append(el("div", "picker-title", "Starting looks"), el("p", "picker-note", "Optional starting points, named by their look. Hover or focus to preview, choose one to use it, then change anything."));
    const grid = el("div", "preset-grid");
    grid.setAttribute("role", "list");
    for (const preset of APPEARANCE_PRESETS) {
      const item = el("div", "preset-item");
      item.setAttribute("role", "listitem");
      const card = el("button", "preset-card");
      card.type = "button";
      card.dataset.preset = preset.id;
      card.setAttribute("aria-label", `Use starting look: ${preset.label}`);
      const image = el("img", "preset-thumb");
      image.alt = "";
      image.width = 96;
      image.height = 120;
      this.whenVisible(image, grid, () => fillPortrait(image, preset.appearance, "body"));
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
      card.addEventListener("focus", (event) => (event.target as HTMLElement).matches(":focus-visible") && preview());
      card.addEventListener("blur", endPreview);
      card.addEventListener("click", () => {
        this.previewing = null;
        this.apply(preset.appearance);
        this.status(`Using “${preset.label}”. Change anything you like.`);
      });
      item.append(card);
      grid.append(item);
    }
    wrapper.append(grid);
    return wrapper;
  }

  private visibilityObserver: IntersectionObserver | null = null;
  private readonly visibilityCallbacks = new WeakMap<Element, () => void>();

  /**
   * Runs `callback` once the element scrolls into (or near) view, so the
   * starting-look portraits are drawn a few at a time instead of all 17 when
   * the creator opens (each is a full character build). `root` is the
   * scrolling row, so cards just outside it (within the margin) are drawn
   * ahead of time.
   */
  private whenVisible(element: Element, root: Element, callback: () => void): void {
    if (typeof IntersectionObserver !== "function") return callback();
    this.visibilityObserver ??= new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          this.visibilityObserver?.unobserve(entry.target);
          this.visibilityCallbacks.get(entry.target)?.();
          this.visibilityCallbacks.delete(entry.target);
        }
      },
      { root, rootMargin: "0px 240px 0px 240px" },
    );
    this.visibilityCallbacks.set(element, callback);
    this.visibilityObserver.observe(element);
  }

  private lookCodesOpen = false;

  private lookCodes(): HTMLElement {
    const box = el("details", "look-codes");
    // Stays open when the panel re-renders (e.g. after applying a code).
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
    const codeInput = el("input", "look-code-input text-field");
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
        this.status("Look code shown in the box: copy it from there.");
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

// Every config field must have a control in exactly the category that owns it.
if (import.meta.env.DEV) {
  const grouped = new Set(CREATOR_CATEGORIES.flatMap((category) => [...CATEGORY_FIELDS[category]]));
  for (const path of allFieldPaths()) if (!grouped.has(path)) console.error(`Creator has no category for ${path}`);
}
