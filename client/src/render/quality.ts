// Rendering quality profile. Phones get a cheaper configuration by default;
// the Graphics setting (title screen → Settings) or `?quality=low|high` in
// the address overrides it. Read once when the game starts.
//
// VITE_DEFAULT_QUALITY (build-time, optional) replaces the phone/computer
// guess for the "Automatic" setting. The browser tests set it to "low":
// the cloud test machine draws in software, and several full-detail
// browsers at once are too slow there (gameplay and collision are the same
// at both levels). Players never set it.

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
  const fallback = import.meta.env.VITE_DEFAULT_QUALITY as string | undefined;
  const automaticLow = fallback === "low" || fallback === "high" ? fallback === "low" : coarse;
  const low =
    forced === "low" || (forced !== "high" && (setting === "performance" || (setting === "auto" && automaticLow)));
  return low
    ? { name: "low", maxPixelRatio: 1.5, shadows: false, antialias: false }
    : { name: "high", maxPixelRatio: 2, shadows: true, antialias: true };
}
