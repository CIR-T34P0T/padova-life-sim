// Starting presets for the character creator (M6). Each is a complete,
// valid appearance that players can pick and then change freely; none is
// required. Presets are named by what they look like (hair, clothes,
// accessories), never by ethnicity, nationality or heritage (D-029), and
// they deliberately mix skin tones, hair textures, body frames and builds.

import { cloneAppearance, DEFAULT_APPEARANCE, type AppearanceConfig, type AppearanceSection } from "./schema.ts";

export interface AppearancePreset {
  id: string;
  label: string;
  appearance: AppearanceConfig;
}

type PresetOverrides = { [S in AppearanceSection]?: Partial<AppearanceConfig[S]> };

function preset(id: string, label: string, overrides: PresetOverrides): AppearancePreset {
  const appearance = cloneAppearance(DEFAULT_APPEARANCE);
  for (const [section, values] of Object.entries(overrides) as [AppearanceSection, object][]) {
    Object.assign(appearance[section], values);
  }
  return { id, label, appearance };
}

export const APPEARANCE_PRESETS: readonly AppearancePreset[] = [
  preset("rounded-afro", "Rounded afro", {
    body: { frame: "feminine", build: "curvy", height: 0.5 },
    skin: { tone: 0.9, undertone: "warm", blush: 0.25 },
    face: { shape: "round", eyeShape: "round", eyeColour: "dark-brown", noseShape: "broad", lipShape: "full", lipFullness: 0.7 },
    hair: { style: "afro", colour: "black" },
    outfit: { top: "hoodie", topColour: "mustard", bottom: "jeans", bottomColour: "denim", shoes: "trainers", shoesColour: "white" },
  }),
  preset("box-braids", "Box braids & print dress", {
    body: { frame: "feminine", build: "slim", height: 0.62 },
    skin: { tone: 0.76, undertone: "neutral", mark: "cheek-left" },
    face: { shape: "oval", cheekbones: 0.7, eyeShape: "almond", eyeColour: "brown", noseShape: "rounded", lipShape: "full" },
    hair: { style: "box-braids", colour: "black" },
    outfit: { full: "dress", topColour: "terracotta", pattern: "geometric", shoes: "sandals", shoesColour: "camel" },
  }),
  preset("locs-beard", "Locs & beard", {
    body: { frame: "masculine", build: "athletic", height: 0.72, shoulders: 0.65 },
    skin: { tone: 0.96, undertone: "cool", blush: 0 },
    face: { shape: "square", jaw: 0.65, eyeShape: "almond", eyeColour: "dark-brown", browShape: "thick", noseShape: "broad", lipShape: "full" },
    hair: { style: "locs", colour: "black", facial: "full-beard" },
    outfit: { top: "shirt", topColour: "cream", bottom: "trousers", bottomColour: "olive", shoes: "boots", shoesColour: "camel" },
  }),
  preset("bob-glasses", "Wavy bob & glasses", {
    body: { frame: "feminine", build: "average", height: 0.3 },
    skin: { tone: 0.14, undertone: "cool", blush: 0.3 },
    face: { shape: "heart", eyeShape: "monolid", eyeColour: "dark-brown", browShape: "straight", noseShape: "button", lipShape: "heart" },
    hair: { style: "wavy-bob", colour: "black", hairline: "straight" },
    outfit: { top: "sweater", topColour: "navy", bottom: "skirt", bottomColour: "charcoal", shoes: "loafers", shoesColour: "black", glasses: "round" },
  }),
  preset("long-curls-jacket", "Long curls & short jacket", {
    body: { frame: "feminine", build: "average", height: 0.48 },
    skin: { tone: 0.46, undertone: "warm" },
    face: { shape: "oval", eyeShape: "almond", eyeColour: "hazel", browShape: "soft-arch", noseShape: "straight", lipShape: "wide" },
    hair: { style: "long-curly", colour: "chestnut" },
    outfit: { top: "tee", topColour: "white", bottom: "jeans", bottomColour: "navy", outer: "denim-jacket", outerColour: "denim" },
  }),
  preset("freckled-curls", "Freckles & copper curls", {
    body: { frame: "masculine", build: "slim", height: 0.6 },
    skin: { tone: 0.04, undertone: "cool", freckles: "many", blush: 0.35 },
    face: { shape: "long", eyeShape: "round", eyeColour: "green", browShape: "soft-arch", noseShape: "narrow", lipShape: "thin" },
    hair: { style: "short-curls", colour: "copper" },
    outfit: { top: "hoodie", topColour: "forest", bottom: "jeans", bottomColour: "charcoal", shoes: "trainers", shoesColour: "grey" },
  }),
  preset("headscarf-cardigan", "Headscarf & cardigan", {
    body: { frame: "feminine", build: "soft", height: 0.4 },
    skin: { tone: 0.54, undertone: "neutral" },
    face: { shape: "oval", eyeShape: "almond", eyeColour: "amber", browShape: "high-arch", noseShape: "straight", lipShape: "full" },
    hair: { style: "long-straight", colour: "black" },
    outfit: {
      top: "shirt", topColour: "cream", bottom: "long-skirt", bottomColour: "navy",
      outer: "cardigan", outerColour: "sand", headwear: "headscarf", headwearColour: "plum", shoes: "loafers", shoesColour: "camel",
    },
  }),
  preset("crop-blazer", "Textured crop & blazer", {
    body: { frame: "masculine", build: "average", height: 0.55 },
    skin: { tone: 0.62, undertone: "warm", blush: 0.05 },
    face: { shape: "diamond", eyeShape: "hooded", eyeColour: "brown", browShape: "straight", noseShape: "straight", lipShape: "wide" },
    hair: { style: "fade-crop", colour: "black", facial: "stubble" },
    outfit: { top: "tee", topColour: "white", bottom: "trousers", bottomColour: "charcoal", outer: "blazer", outerColour: "charcoal", glasses: "square", shoes: "loafers", shoesColour: "black" },
  }),
  preset("cornrows", "Cornrows & goatee", {
    body: { frame: "masculine", build: "broad", height: 0.66, shoulders: 0.7 },
    skin: { tone: 0.84, undertone: "neutral", blush: 0 },
    face: { shape: "square", jaw: 0.6, eyeShape: "downturned", eyeColour: "dark-brown", browShape: "thick", noseShape: "broad", lipShape: "full" },
    hair: { style: "cornrows", colour: "black", facial: "goatee" },
    outfit: { top: "tank", topColour: "white", bottom: "shorts", bottomColour: "olive", shoes: "trainers", shoesColour: "black" },
  }),
  preset("top-bun", "Top bun & jumpsuit", {
    body: { frame: "feminine", build: "athletic", height: 0.58 },
    skin: { tone: 0.28, undertone: "warm", freckles: "light" },
    face: { shape: "heart", eyeShape: "upturned", eyeColour: "blue", browShape: "soft-arch", noseShape: "button", lipShape: "heart" },
    hair: { style: "top-bun", colour: "honey" },
    outfit: { full: "jumpsuit", topColour: "olive", shoes: "boots", shoesColour: "black" },
  }),
  preset("lavender-ponytail", "Lavender ponytail", {
    body: { frame: "feminine", build: "slim", height: 0.36 },
    skin: { tone: 0.22, undertone: "neutral", blush: 0.4 },
    face: { shape: "round", eyeShape: "monolid", eyeSize: 0.62, eyeColour: "violet", browShape: "straight", noseShape: "button", lipShape: "heart" },
    hair: { style: "ponytail", colour: "lavender" },
    outfit: { top: "tee", topColour: "rose", pattern: "stripes", bottom: "skirt", bottomColour: "white", shoes: "trainers", shoesColour: "white" },
  }),
  preset("twists-sweater", "Twists & checked sweater", {
    body: { frame: "masculine", build: "soft", height: 0.5 },
    skin: { tone: 0.7, undertone: "warm" },
    face: { shape: "round", eyeShape: "round", eyeColour: "brown", browShape: "soft-arch", noseShape: "rounded", lipShape: "full" },
    hair: { style: "twists", colour: "dark-brown", facial: "short-beard" },
    outfit: { top: "sweater", topColour: "mustard", pattern: "checks", bottom: "jeans", bottomColour: "denim", shoes: "boots", shoesColour: "camel" },
  }),
  preset("silver-buzz", "Silver buzz & full beard", {
    body: { frame: "masculine", build: "broad", height: 0.42 },
    skin: { tone: 0.36, undertone: "neutral", mark: "chin" },
    face: { shape: "square", forehead: 0.6, eyeShape: "hooded", eyeColour: "grey", browShape: "thick", noseShape: "straight", lipShape: "thin" },
    hair: { style: "buzz", colour: "silver", hairline: "receding", facial: "full-beard" },
    outfit: { top: "shirt", topColour: "sky", bottom: "trousers", bottomColour: "navy", outer: "coat", outerColour: "camel", shoes: "loafers", shoesColour: "black" },
  }),
  preset("afro-puffs", "Afro puffs & dotted dress", {
    body: { frame: "feminine", build: "average", height: 0.44 },
    skin: { tone: 0.94, undertone: "warm", blush: 0.3 },
    face: { shape: "heart", eyeShape: "round", eyeSize: 0.6, eyeColour: "dark-brown", noseShape: "rounded", lipShape: "full" },
    hair: { style: "afro-puffs", colour: "black" },
    outfit: { full: "dress", topColour: "teal", pattern: "dots", shoes: "sandals", shoesColour: "white", headwear: "headband", headwearColour: "mustard" },
  }),
  preset("headwrap", "Headwrap & maxi dress", {
    body: { frame: "feminine", build: "curvy", height: 0.66 },
    skin: { tone: 0.8, undertone: "warm" },
    face: { shape: "long", cheekbones: 0.75, eyeShape: "almond", eyeColour: "brown", browShape: "high-arch", noseShape: "straight", lipShape: "full" },
    hair: { style: "twists", colour: "black" },
    outfit: { full: "maxi-dress", topColour: "brick", pattern: "geometric", headwear: "headwrap", headwearColour: "mustard", shoes: "sandals", shoesColour: "camel" },
  }),
  preset("platinum-buzz", "Platinum buzz & jacket", {
    body: { frame: "feminine", build: "athletic", height: 0.7 },
    skin: { tone: 0.66, undertone: "cool" },
    face: { shape: "diamond", cheekbones: 0.68, eyeShape: "upturned", eyeColour: "amber", browShape: "thin", noseShape: "narrow", lipShape: "wide" },
    hair: { style: "buzz", colour: "platinum" },
    outfit: { top: "tank", topColour: "black", bottom: "trousers", bottomColour: "sand", outer: "denim-jacket", outerColour: "black", shoes: "boots", shoesColour: "black" },
  }),
  preset("long-hair-cap", "Long hair & cap", {
    body: { frame: "masculine", build: "slim", height: 0.52 },
    skin: { tone: 0.5, undertone: "warm" },
    face: { shape: "oval", eyeShape: "almond", eyeColour: "brown", noseShape: "straight", lipShape: "thin" },
    hair: { style: "long-straight", colour: "dark-brown", facial: "moustache" },
    outfit: { top: "tee", topColour: "charcoal", pattern: "stripes", bottom: "shorts", bottomColour: "sand", headwear: "cap", headwearColour: "forest", shoes: "trainers", shoesColour: "white" },
  }),
];

export function findPreset(id: string): AppearancePreset | undefined {
  return APPEARANCE_PRESETS.find((p) => p.id === id);
}
