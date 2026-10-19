// Appearance catalogue (M6): every option a character can wear or be made
// of. Ids are stable: saved characters store them. Every id here must be
// drawn differently by the renderer (client/src/render/avatar/); a test in
// the client lab and the e2e suite checks that options change the model.
//
// Nothing here describes ethnicity or heritage (D-029). Options are about
// shape, texture and colour only, and combine freely.

export interface Option<Id extends string = string> {
  id: Id;
  label: string;
}

export interface ColourOption<Id extends string = string> extends Option<Id> {
  /** CSS hex colour (sRGB). */
  colour: string;
  /** Natural or fantasy (hair and eyes only). */
  kind?: "natural" | "fantasy";
}

const opts = <const T extends readonly Option[]>(list: T) => list;

// ── Body ────────────────────────────────────────────────────────────────────

export const BODY_FRAMES = opts([
  { id: "feminine", label: "Feminine" },
  { id: "masculine", label: "Masculine" },
] as const);

export const BUILDS = opts([
  { id: "slim", label: "Slim" },
  { id: "average", label: "Average" },
  { id: "athletic", label: "Athletic" },
  { id: "curvy", label: "Curvy" },
  { id: "broad", label: "Broad" },
  { id: "soft", label: "Soft" },
] as const);

// ── Skin ────────────────────────────────────────────────────────────────────

export const UNDERTONES = opts([
  { id: "cool", label: "Cool" },
  { id: "neutral", label: "Neutral" },
  { id: "warm", label: "Warm" },
] as const);

export const FRECKLES = opts([
  { id: "none", label: "None" },
  { id: "light", label: "Light" },
  { id: "many", label: "Many" },
] as const);

export const BEAUTY_MARKS = opts([
  { id: "none", label: "None" },
  { id: "cheek-left", label: "Left cheek" },
  { id: "cheek-right", label: "Right cheek" },
  { id: "lip", label: "Above lip" },
  { id: "chin", label: "Chin" },
] as const);

// ── Face ────────────────────────────────────────────────────────────────────

export const FACE_SHAPES = opts([
  { id: "oval", label: "Oval" },
  { id: "round", label: "Round" },
  { id: "square", label: "Square" },
  { id: "heart", label: "Heart" },
  { id: "long", label: "Long" },
  { id: "diamond", label: "Diamond" },
] as const);

export const EYE_SHAPES = opts([
  { id: "round", label: "Round" },
  { id: "almond", label: "Almond" },
  { id: "hooded", label: "Hooded" },
  { id: "monolid", label: "Monolid" },
  { id: "upturned", label: "Upturned" },
  { id: "downturned", label: "Downturned" },
] as const);

export const EYE_COLOURS = [
  { id: "dark-brown", label: "Dark brown", colour: "#3a2416", kind: "natural" },
  { id: "brown", label: "Brown", colour: "#5a3a22", kind: "natural" },
  { id: "hazel", label: "Hazel", colour: "#8a6a3a", kind: "natural" },
  { id: "amber", label: "Amber", colour: "#b07a2a", kind: "natural" },
  { id: "green", label: "Green", colour: "#3f7a4a", kind: "natural" },
  { id: "blue", label: "Blue", colour: "#3c6fb0", kind: "natural" },
  { id: "grey", label: "Grey", colour: "#7d8790", kind: "natural" },
  { id: "violet", label: "Violet", colour: "#7a52a8", kind: "fantasy" },
] as const satisfies readonly ColourOption[];

export const BROW_SHAPES = opts([
  { id: "straight", label: "Straight" },
  { id: "soft-arch", label: "Soft arch" },
  { id: "high-arch", label: "High arch" },
  { id: "thick", label: "Thick" },
  { id: "thin", label: "Thin" },
] as const);

export const NOSE_SHAPES = opts([
  { id: "button", label: "Button" },
  { id: "straight", label: "Straight" },
  { id: "broad", label: "Broad" },
  { id: "rounded", label: "Rounded" },
  { id: "narrow", label: "Narrow" },
] as const);

export const LIP_SHAPES = opts([
  { id: "full", label: "Full" },
  { id: "thin", label: "Thin" },
  { id: "heart", label: "Heart" },
  { id: "wide", label: "Wide" },
] as const);

// ── Hair ────────────────────────────────────────────────────────────────────

export type HairTexture = "none" | "straight" | "wavy" | "curly" | "coily" | "tightly-coiled";
export type HairLength = "none" | "very-short" | "short" | "medium" | "long";

export interface HairStyleOption extends Option {
  texture: HairTexture;
  length: HairLength;
  /** Protective styles (braids, twists, locs, cornrows) are flagged for filtering. */
  protective?: boolean;
  /** Under a beanie or cap: "hide" the whole style, or keep the parts below the hat ("keep-long"). */
  underHat: "hide" | "keep-long";
}

export const HAIR_STYLES = [
  { id: "bald", label: "Bald", texture: "none", length: "none", underHat: "hide" },
  { id: "buzz", label: "Buzz cut", texture: "straight", length: "very-short", underHat: "hide" },
  { id: "fade-crop", label: "Textured crop", texture: "wavy", length: "short", underHat: "hide" },
  { id: "curly-top-fade", label: "Curly top fade", texture: "coily", length: "short", underHat: "hide" },
  { id: "short-straight", label: "Short with fringe", texture: "straight", length: "short", underHat: "hide" },
  { id: "short-curls", label: "Short curls", texture: "curly", length: "short", underHat: "hide" },
  { id: "twists", label: "Twists", texture: "coily", length: "short", protective: true, underHat: "hide" },
  { id: "afro", label: "Rounded afro", texture: "tightly-coiled", length: "medium", underHat: "hide" },
  { id: "afro-puffs", label: "Afro puffs", texture: "coily", length: "medium", underHat: "hide" },
  { id: "wavy-bob", label: "Wavy bob", texture: "wavy", length: "medium", underHat: "keep-long" },
  { id: "cornrows", label: "Cornrows", texture: "tightly-coiled", length: "short", protective: true, underHat: "hide" },
  { id: "locs", label: "Locs", texture: "coily", length: "medium", protective: true, underHat: "keep-long" },
  { id: "box-braids", label: "Box braids", texture: "tightly-coiled", length: "long", protective: true, underHat: "keep-long" },
  { id: "ponytail", label: "High ponytail", texture: "straight", length: "long", underHat: "keep-long" },
  { id: "top-bun", label: "Top bun", texture: "straight", length: "medium", underHat: "hide" },
  { id: "long-straight", label: "Long straight", texture: "straight", length: "long", underHat: "keep-long" },
  { id: "long-curly", label: "Long curls", texture: "curly", length: "long", underHat: "keep-long" },
] as const satisfies readonly HairStyleOption[];

export const HAIR_TEXTURE_LABELS: Record<HairTexture, string> = {
  none: "No hair",
  straight: "Straight",
  wavy: "Wavy",
  curly: "Curly",
  coily: "Coily",
  "tightly-coiled": "Tightly coiled",
};

export const HAIRLINES = opts([
  { id: "rounded", label: "Rounded" },
  { id: "straight", label: "Straight" },
  { id: "peak", label: "Widow's peak" },
  { id: "receding", label: "Receding" },
] as const);

export const FACIAL_HAIR = opts([
  { id: "none", label: "None" },
  { id: "stubble", label: "Stubble" },
  { id: "moustache", label: "Moustache" },
  { id: "goatee", label: "Goatee" },
  { id: "short-beard", label: "Short beard" },
  { id: "full-beard", label: "Full beard" },
] as const);

/** Hair colours. The first eight ids existed in M4 and are kept for saved characters. */
export const HAIR_COLOURS = [
  { id: "black", label: "Black", colour: "#1d1a1c", kind: "natural" },
  { id: "dark-brown", label: "Dark brown", colour: "#3b2a22", kind: "natural" },
  { id: "chestnut", label: "Chestnut", colour: "#6e4128", kind: "natural" },
  { id: "auburn", label: "Auburn", colour: "#8e3b25", kind: "natural" },
  { id: "copper", label: "Copper", colour: "#b5562c", kind: "natural" },
  { id: "honey", label: "Honey", colour: "#b98a4a", kind: "natural" },
  { id: "blonde", label: "Blonde", colour: "#d9b26a", kind: "natural" },
  { id: "platinum", label: "Platinum", colour: "#e6dcc4", kind: "natural" },
  { id: "grey", label: "Grey", colour: "#8f8c8a", kind: "natural" },
  { id: "silver", label: "Silver", colour: "#c9c9d1", kind: "natural" },
  { id: "rose", label: "Rose", colour: "#e98aa8", kind: "fantasy" },
  { id: "lavender", label: "Lavender", colour: "#ab93db", kind: "fantasy" },
  { id: "cobalt", label: "Cobalt", colour: "#3c5bc8", kind: "fantasy" },
  { id: "teal", label: "Teal", colour: "#3fa3a0", kind: "fantasy" },
  { id: "mint", label: "Mint", colour: "#8fd1b5", kind: "fantasy" },
  { id: "cherry", label: "Cherry", colour: "#b8303f", kind: "fantasy" },
] as const satisfies readonly ColourOption[];

// ── Clothing and accessories ────────────────────────────────────────────────

export const TOPS = opts([
  { id: "tee", label: "T-shirt" },
  { id: "tank", label: "Tank top" },
  { id: "shirt", label: "Shirt" },
  { id: "hoodie", label: "Hoodie" },
  { id: "sweater", label: "Sweater" },
] as const);

export const BOTTOMS = opts([
  { id: "jeans", label: "Jeans" },
  { id: "trousers", label: "Wide trousers" },
  { id: "shorts", label: "Shorts" },
  { id: "skirt", label: "Skirt" },
  { id: "long-skirt", label: "Long skirt" },
] as const);

/** A full outfit replaces the top and bottom (which stay saved for later). */
export const FULL_OUTFITS = opts([
  { id: "none", label: "None (top + bottom)" },
  { id: "dress", label: "Dress" },
  { id: "maxi-dress", label: "Maxi dress" },
  { id: "jumpsuit", label: "Jumpsuit" },
] as const);

/** Fabric pattern of the top or full outfit. Drawn at runtime, no image files. */
export const PATTERNS = opts([
  { id: "plain", label: "Plain" },
  { id: "stripes", label: "Stripes" },
  { id: "checks", label: "Checks" },
  { id: "dots", label: "Dots" },
  { id: "geometric", label: "Bold geometric print" },
] as const);

export const SHOES = opts([
  { id: "trainers", label: "Trainers" },
  { id: "boots", label: "Boots" },
  { id: "sandals", label: "Sandals" },
  { id: "loafers", label: "Loafers" },
] as const);

export const OUTERWEAR = opts([
  { id: "none", label: "None" },
  { id: "denim-jacket", label: "Short jacket" },
  { id: "blazer", label: "Blazer" },
  { id: "cardigan", label: "Cardigan" },
  { id: "coat", label: "Long coat" },
] as const);

export const GLASSES = opts([
  { id: "none", label: "None" },
  { id: "round", label: "Round" },
  { id: "square", label: "Square" },
] as const);

/** Head accessories. Headwraps and headscarves cover the hair; hats cover the top of it. */
export const HEADWEAR = opts([
  { id: "none", label: "None" },
  { id: "headband", label: "Headband" },
  { id: "hair-clips", label: "Hair clips" },
  { id: "beanie", label: "Beanie" },
  { id: "cap", label: "Cap" },
  { id: "headwrap", label: "Headwrap" },
  { id: "headscarf", label: "Headscarf" },
] as const);

export const CLOTHING_COLOURS = [
  { id: "white", label: "White", colour: "#f2f0eb" },
  { id: "cream", label: "Cream", colour: "#ece0c8" },
  { id: "sand", label: "Sand", colour: "#d6bf98" },
  { id: "camel", label: "Camel", colour: "#b08354" },
  { id: "terracotta", label: "Terracotta", colour: "#c4623f" },
  { id: "brick", label: "Brick", colour: "#93392c" },
  { id: "mustard", label: "Mustard", colour: "#d4a12e" },
  { id: "olive", label: "Olive", colour: "#6b7340" },
  { id: "forest", label: "Forest", colour: "#2f5d46" },
  { id: "teal", label: "Teal", colour: "#2e7f7a" },
  { id: "sky", label: "Sky", colour: "#8fb8d8" },
  { id: "denim", label: "Denim", colour: "#4a6a92" },
  { id: "navy", label: "Navy", colour: "#2f3e63" },
  { id: "plum", label: "Plum", colour: "#7d3c63" },
  { id: "rose", label: "Rose", colour: "#d98a9c" },
  { id: "grey", label: "Grey", colour: "#9a9a9e" },
  { id: "charcoal", label: "Charcoal", colour: "#3a3a3e" },
  { id: "black", label: "Black", colour: "#1e1d20" },
] as const satisfies readonly ColourOption[];

/** Every option list, by name, for validation and UI. */
export const CATALOGUE = {
  frames: BODY_FRAMES,
  builds: BUILDS,
  undertones: UNDERTONES,
  freckles: FRECKLES,
  beautyMarks: BEAUTY_MARKS,
  faceShapes: FACE_SHAPES,
  eyeShapes: EYE_SHAPES,
  eyeColours: EYE_COLOURS,
  browShapes: BROW_SHAPES,
  noseShapes: NOSE_SHAPES,
  lipShapes: LIP_SHAPES,
  hairStyles: HAIR_STYLES,
  hairlines: HAIRLINES,
  facialHair: FACIAL_HAIR,
  hairColours: HAIR_COLOURS,
  tops: TOPS,
  bottoms: BOTTOMS,
  fullOutfits: FULL_OUTFITS,
  patterns: PATTERNS,
  shoes: SHOES,
  outerwear: OUTERWEAR,
  glasses: GLASSES,
  headwear: HEADWEAR,
  clothingColours: CLOTHING_COLOURS,
} as const;

export type CatalogueList = keyof typeof CATALOGUE;
type IdsOf<L extends CatalogueList> = (typeof CATALOGUE)[L][number]["id"];

export type BodyFrame = IdsOf<"frames">;
export type Build = IdsOf<"builds">;
export type Undertone = IdsOf<"undertones">;
export type Freckles = IdsOf<"freckles">;
export type BeautyMark = IdsOf<"beautyMarks">;
export type FaceShape = IdsOf<"faceShapes">;
export type EyeShape = IdsOf<"eyeShapes">;
export type EyeColour = IdsOf<"eyeColours">;
export type BrowShape = IdsOf<"browShapes">;
export type NoseShape = IdsOf<"noseShapes">;
export type LipShape = IdsOf<"lipShapes">;
export type HairStyle = IdsOf<"hairStyles">;
export type Hairline = IdsOf<"hairlines">;
export type FacialHair = IdsOf<"facialHair">;
export type HairColour = IdsOf<"hairColours">;
export type Top = IdsOf<"tops">;
export type Bottom = IdsOf<"bottoms">;
export type FullOutfit = IdsOf<"fullOutfits">;
export type Pattern = IdsOf<"patterns">;
export type Shoes = IdsOf<"shoes">;
export type Outerwear = IdsOf<"outerwear">;
export type Glasses = IdsOf<"glasses">;
export type Headwear = IdsOf<"headwear">;
export type ClothingColour = IdsOf<"clothingColours">;

export function findOption(list: CatalogueList, id: string): (Option & Partial<ColourOption> & Partial<HairStyleOption>) | undefined {
  return (CATALOGUE[list] as readonly (Option & Partial<ColourOption> & Partial<HairStyleOption>)[]).find((option) => option.id === id);
}

export function hairStyleInfo(id: string): HairStyleOption | undefined {
  return (HAIR_STYLES as readonly HairStyleOption[]).find((style) => style.id === id);
}

/** CSS hex colour of a colour option, or the fallback. */
export function colourOf(list: "hairColours" | "eyeColours" | "clothingColours", id: string, fallback = "#888888"): string {
  return findOption(list, id)?.colour ?? fallback;
}
