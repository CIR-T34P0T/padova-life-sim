// Player settings for this device (title screen → Settings). Stored in this
// browser only, because they describe the device and the person in front of
// it, not the character. Every setting listed here has a working effect;
// nothing is shown that the game can't do yet (no audio exists, so no volume).

export interface Settings {
  /** Renderer profile. "auto": phones get "performance", others "quality". Read when the game starts. */
  graphics: "auto" | "performance" | "quality";
  /** How fast dragging turns the camera in the world and in the creator. */
  cameraSpeed: "slow" | "normal" | "fast";
  /** Interface animation. "system" follows the device's reduced-motion setting. */
  motion: "system" | "full" | "reduced";
  /** The controls reminder at the bottom of the screen in the world. */
  hints: "show" | "hide";
}

export const DEFAULT_SETTINGS: Settings = { graphics: "auto", cameraSpeed: "normal", motion: "system", hints: "show" };

export const SETTING_CHOICES: { [K in keyof Settings]: readonly { id: Settings[K]; label: string }[] } = {
  graphics: [
    { id: "auto", label: "Automatic" },
    { id: "performance", label: "Performance" },
    { id: "quality", label: "Quality" },
  ],
  cameraSpeed: [
    { id: "slow", label: "Slow" },
    { id: "normal", label: "Normal" },
    { id: "fast", label: "Fast" },
  ],
  motion: [
    { id: "system", label: "Like my device" },
    { id: "full", label: "Full" },
    { id: "reduced", label: "Reduced" },
  ],
  hints: [
    { id: "show", label: "Show" },
    { id: "hide", label: "Hide" },
  ],
};

const KEY = "padova.settings.v1";
const CAMERA_FACTORS: Record<Settings["cameraSpeed"], number> = { slow: 0.6, normal: 1, fast: 1.6 };

function isValid<K extends keyof Settings>(key: K, value: unknown): value is Settings[K] {
  return SETTING_CHOICES[key].some((choice) => choice.id === value);
}

function load(): Settings {
  const settings = { ...DEFAULT_SETTINGS };
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Record<string, unknown>;
    for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[]) {
      if (isValid(key, raw[key])) (settings as Record<string, unknown>)[key] = raw[key];
    }
  } catch {
    // Storage blocked or unreadable: defaults.
  }
  return settings;
}

let current: Settings = load();
const listeners = new Set<(settings: Settings) => void>();

export function getSettings(): Settings {
  return current;
}

/** Changes one setting. Returns false if this browser refused to store it (it still applies until reload). */
export function setSetting<K extends keyof Settings>(key: K, value: Settings[K]): boolean {
  current = { ...current, [key]: value };
  applySettings();
  for (const listener of listeners) listener(current);
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
    return true;
  } catch {
    return false;
  }
}

export function onSettingsChange(listener: (settings: Settings) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function prefersReducedMotion(): boolean {
  if (current.motion === "reduced") return true;
  if (current.motion === "full") return false;
  return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function cameraSpeedFactor(): number {
  return CAMERA_FACTORS[current.cameraSpeed];
}

/** Reflects settings on <html> for CSS (data-motion, data-hints). */
export function applySettings(): void {
  const root = document.documentElement;
  root.dataset.motion = prefersReducedMotion() ? "reduced" : "full";
  root.dataset.hints = current.hints;
}
