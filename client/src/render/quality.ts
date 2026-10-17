// Rendering quality profile. Phones get a cheaper configuration by default;
// a settings menu can override this later.

export interface QualityProfile {
  name: "low" | "high";
  maxPixelRatio: number;
  shadows: boolean;
  antialias: boolean;
}

export function detectQuality(): QualityProfile {
  const params = new URLSearchParams(location.search);
  const forced = params.get("quality");
  const coarse = window.matchMedia("(pointer: coarse)").matches;
  const low = forced === "low" || (forced !== "high" && coarse);
  return low
    ? { name: "low", maxPixelRatio: 1.5, shadows: false, antialias: false }
    : { name: "high", maxPixelRatio: 2, shadows: true, antialias: true };
}
