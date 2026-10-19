// How the character creator groups the appearance config for players:
// Appearance, Face, Hair, Body, Clothing and Accessories. The stored config
// keeps its own sections (body, skin, face, hair, outfit); this is only a
// view of the same fields, plus per-category randomise / reset and a plain
// summary of a look for the review screen. Pure functions, unit-tested.

import { findOption, type CatalogueList } from "./catalogue.ts";
import { skinToneLabel } from "./colour.ts";
import { randomiseSection } from "./random.ts";
import { APPEARANCE_SPEC, cloneAppearance, type AppearanceConfig, type AppearanceSection } from "./schema.ts";

export const CREATOR_CATEGORIES = ["appearance", "face", "hair", "body", "clothing", "accessories"] as const;
export type CreatorCategory = (typeof CREATOR_CATEGORIES)[number];

export const CATEGORY_LABELS: Record<CreatorCategory, string> = {
  appearance: "Appearance",
  face: "Face",
  hair: "Hair",
  body: "Body",
  clothing: "Clothing",
  accessories: "Accessories",
};

/** A field of the config as "section.field", e.g. "hair.style". */
export type FieldPath = `${AppearanceSection}.${string}`;

/** Every config field belongs to exactly one category (a unit test checks this against APPEARANCE_SPEC). */
export const CATEGORY_FIELDS: Record<CreatorCategory, readonly FieldPath[]> = {
  appearance: ["skin.tone", "skin.undertone", "skin.freckles", "skin.mark", "skin.blush"],
  face: [
    "face.shape", "face.cheekbones", "face.jaw", "face.chin", "face.forehead",
    "face.eyeShape", "face.eyeSize", "face.eyeSpacing", "face.eyeColour",
    "face.browShape", "face.browHeight", "face.noseShape", "face.noseWidth", "face.noseLength",
    "face.lipShape", "face.lipFullness",
  ],
  hair: ["hair.style", "hair.colour", "hair.hairline", "hair.facial"],
  body: ["body.frame", "body.build", "body.height", "body.shoulders", "body.torso", "body.legs", "body.arms"],
  clothing: [
    "outfit.full", "outfit.top", "outfit.topColour", "outfit.pattern", "outfit.bottom", "outfit.bottomColour",
    "outfit.outer", "outfit.outerColour", "outfit.shoes", "outfit.shoesColour",
  ],
  accessories: ["outfit.headwear", "outfit.headwearColour", "outfit.glasses"],
};

export function getAppearanceField(config: AppearanceConfig, path: FieldPath): unknown {
  const [section, field] = path.split(".") as [AppearanceSection, string];
  return (config[section] as Record<string, unknown>)[field];
}

export function setAppearanceField(config: AppearanceConfig, path: FieldPath, value: unknown): void {
  const [section, field] = path.split(".") as [AppearanceSection, string];
  (config[section] as Record<string, unknown>)[field] = value;
}

export function categoryOfField(path: string): CreatorCategory | null {
  for (const category of CREATOR_CATEGORIES) if ((CATEGORY_FIELDS[category] as readonly string[]).includes(path)) return category;
  return null;
}

/** Copies one category's fields from `source` into a copy of `config`. */
function withCategoryFrom(config: AppearanceConfig, source: AppearanceConfig, category: CreatorCategory): AppearanceConfig {
  const next = cloneAppearance(config);
  for (const path of CATEGORY_FIELDS[category]) setAppearanceField(next, path, getAppearanceField(source, path));
  return next;
}

/** Randomises one category only; everything else stays as it is. Deterministic per seed. */
export function randomiseCategory(config: AppearanceConfig, category: CreatorCategory, seed: number): AppearanceConfig {
  const section = CATEGORY_FIELDS[category][0]!.split(".")[0] as AppearanceSection;
  return withCategoryFrom(config, randomiseSection(config, section, seed), category);
}

/** Puts one category back to how it is in `base` (the starting or saved look). */
export function resetCategory(config: AppearanceConfig, category: CreatorCategory, base: AppearanceConfig): AppearanceConfig {
  return withCategoryFrom(config, base, category);
}

/** Categories in which two looks differ, in creator order. */
export function changedCategories(before: AppearanceConfig, after: AppearanceConfig): CreatorCategory[] {
  return CREATOR_CATEGORIES.filter((category) => CATEGORY_FIELDS[category].some((path) => getAppearanceField(before, path) !== getAppearanceField(after, path)));
}

/** Height shown for the height slider (the same scale the creator uses). */
export function heightCm(height: number): number {
  return Math.round(156 + height * 32);
}

const label = (list: CatalogueList, id: unknown): string => findOption(list, String(id))?.label ?? String(id);
const lower = (text: string) => text.charAt(0).toLowerCase() + text.slice(1);

export interface LookLine {
  category: CreatorCategory;
  text: string;
}

/**
 * One readable line per category, e.g. "Hair: Box braids, black". Used by
 * the review screen. Covered choices are described as covered, so the
 * summary never claims something the character doesn't show.
 */
export function describeLook(config: AppearanceConfig): LookLine[] {
  const { skin, face, hair, body, outfit } = config;
  const skinText = [`${skinToneLabel(skin.tone)}, ${lower(label("undertones", skin.undertone))} undertone`];
  if (skin.freckles !== "none") skinText.push(`${lower(label("freckles", skin.freckles))} freckles`);
  if (skin.mark !== "none") skinText.push("beauty mark");

  const hairCovered = outfit.headwear === "headwrap" || outfit.headwear === "headscarf";
  const hairText = hairCovered
    ? `${label("hairStyles", hair.style)} (covered by the ${lower(label("headwear", outfit.headwear))})`
    : `${label("hairStyles", hair.style)}, ${lower(label("hairColours", hair.colour))}`;
  const facial = hair.facial !== "none" ? `, ${lower(label("facialHair", hair.facial))}` : "";

  const clothes =
    outfit.full !== "none"
      ? [`${label("fullOutfits", outfit.full)} in ${lower(label("clothingColours", outfit.topColour))}`]
      : [`${label("tops", outfit.top)} in ${lower(label("clothingColours", outfit.topColour))}`, `${lower(label("bottoms", outfit.bottom))}`];
  if (outfit.outer !== "none") clothes.push(lower(label("outerwear", outfit.outer)));
  clothes.push(lower(label("shoes", outfit.shoes)));

  const accessories: string[] = [];
  if (outfit.headwear !== "none") accessories.push(`${label("headwear", outfit.headwear)} in ${lower(label("clothingColours", outfit.headwearColour))}`);
  if (outfit.glasses !== "none") accessories.push(lower(label("glasses", outfit.glasses)));

  return [
    { category: "appearance", text: `Skin: ${skinText.join(", ")}` },
    { category: "face", text: `Face: ${lower(label("faceShapes", face.shape))}, ${lower(label("eyeShapes", face.eyeShape))} ${lower(label("eyeColours", face.eyeColour))} eyes` },
    { category: "hair", text: `Hair: ${hairText}${facial}` },
    { category: "body", text: `Body: ${lower(label("frames", body.frame))} frame, ${lower(label("builds", body.build))}, ${heightCm(body.height)} cm` },
    { category: "clothing", text: `Clothing: ${clothes.join(", ")}` },
    { category: "accessories", text: `Accessories: ${accessories.length ? accessories.join(", ") : "none"}` },
  ];
}

/** Every field path in the spec, for coverage checks. */
export function allFieldPaths(): FieldPath[] {
  return (Object.entries(APPEARANCE_SPEC) as [AppearanceSection, Record<string, unknown>][]).flatMap(([section, fields]) =>
    Object.keys(fields).map((field) => `${section}.${field}` as FieldPath),
  );
}
