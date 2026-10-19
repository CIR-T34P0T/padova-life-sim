// Rendering quality profile. Phones get a cheaper configuration by default;
// the Graphics setting (title screen → Settings) or `?quality=low|high` in
// the address overrides it. Read once when the game starts.

import { getSettings } from "../ui/settings.ts";

export interface QualityProfile {
  name: "low" | "high";
  maxPixelRatio: number;
  shadows: boolean;
  antialias: boolean;
}

export function detectQuality(): QualityProfile {
  const params = new URLSearchParams(location.search);
  const forced = params.get("quality");
  const setting = getSettings().graphics;
  const coarse = window.matchMedia("(pointer: coarse)").matches;
  const low =
    forced === "low" || (forced !== "high" && (setting === "performance" || (setting === "auto" && coarse)));
  return low
    ? { name: "low", maxPixelRatio: 1.5, shadows: false, antialias: false }
    : { name: "high", maxPixelRatio: 2, shadows: true, antialias: true };
}
