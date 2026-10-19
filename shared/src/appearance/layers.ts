// Which parts of an appearance are actually visible (M6). Some options cover
// others: a full outfit replaces the top and bottom, a headwrap covers the
// hair, a beanie covers short hair. The covered choice stays saved (so
// taking the headwrap off brings the hair back), but the renderer must not
// draw it and the creator must say it's hidden — a menu label must never
// imply a change the character doesn't show.

import { hairStyleInfo } from "./catalogue.ts";
import type { AppearanceConfig } from "./schema.ts";

export type HairVisibility = "full" | "below-hat" | "hidden";

export interface VisibleLayers {
  /** Top and bottom are drawn (false when a full outfit is worn). */
  topAndBottom: boolean;
  /** How much of the hair style is drawn. */
  hair: HairVisibility;
  /** Fields whose current choice is saved but not visible, with the reason. */
  hidden: { field: string; reason: string }[];
}

const HAIR_COVERING = new Set(["headwrap", "headscarf"]);
const HATS = new Set(["beanie", "cap"]);

export function visibleLayers(config: AppearanceConfig): VisibleLayers {
  const hidden: VisibleLayers["hidden"] = [];
  const full = config.outfit.full !== "none";
  if (full) {
    const reason = "Hidden by the full outfit";
    hidden.push({ field: "outfit.top", reason }, { field: "outfit.bottom", reason }, { field: "outfit.bottomColour", reason });
  }

  let hair: HairVisibility = "full";
  const style = hairStyleInfo(config.hair.style);
  const headwear = config.outfit.headwear;
  if (style && style.texture !== "none") {
    if (HAIR_COVERING.has(headwear)) {
      hair = "hidden";
    } else if (HATS.has(headwear)) {
      hair = style.underHat === "keep-long" ? "below-hat" : "hidden";
    }
  }
  if (hair === "hidden") {
    const reason = `Covered by the ${headwear}`;
    hidden.push({ field: "hair.style", reason }, { field: "hair.hairline", reason });
  } else if (hair === "below-hat") {
    hidden.push({ field: "hair.hairline", reason: `Covered by the ${headwear}` });
  }
  // Hair clips need hair to sit in (they are not drawn on a bald or hidden style).
  if (headwear === "hair-clips" && (!style || style.texture === "none" || hair === "hidden")) {
    hidden.push({ field: "outfit.headwear", reason: "Needs hair to sit on" });
  }
  if (config.outfit.headwear === "none") hidden.push({ field: "outfit.headwearColour", reason: "No headwear chosen" });
  if (config.outfit.outer === "none") hidden.push({ field: "outfit.outerColour", reason: "No outerwear chosen" });
  return { topAndBottom: !full, hair, hidden };
}

/** Reason a field's choice isn't visible, or null when it is. */
export function hiddenReason(config: AppearanceConfig, field: string): string | null {
  return visibleLayers(config).hidden.find((entry) => entry.field === field)?.reason ?? null;
}
