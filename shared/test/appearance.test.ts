import { describe, expect, it } from "vitest";
import {
  APPEARANCE_PRESETS,
  APPEARANCE_SECTIONS,
  APPEARANCE_SPEC,
  CATALOGUE,
  DEFAULT_APPEARANCE,
  HAIR_STYLES,
  MAX_LOOK_LENGTH,
  SKIN_TONE_STOPS,
  cloneAppearance,
  decodeLook,
  encodeLook,
  fromLookCode,
  hairStyleInfo,
  hexToOklab,
  parseAppearanceConfig,
  randomAppearance,
  randomiseSection,
  sameAppearance,
  sanitizeAppearance,
  skinColour,
  skinToneLabel,
  toLookCode,
  upgradeLegacyAppearance,
  visibleLayers,
  type AppearanceConfig,
} from "../src/index.ts";

const HEX = /^#[0-9a-f]{6}$/;
type Loose = Record<string, Record<string, unknown>>;
const loose = (config: AppearanceConfig) => config as unknown as Loose;

/** Words that would tie an appearance option to ethnicity, nationality or heritage (D-029). */
const HERITAGE_WORDS = /\b(ethnic\w*|race|racial|heritage|nationality|african|asian|european|latin\w*|hispanic|arab\w*|indian|caucasian|nordic|oriental|tribal|exotic)\b/i;

describe("appearance catalogue", () => {
  it("has unique ids and a label in every list, and valid colours", () => {
    for (const [name, list] of Object.entries(CATALOGUE)) {
      const ids = list.map((option) => option.id);
      expect(new Set(ids).size, name).toBe(ids.length);
      for (const option of list as readonly { id: string; label: string; colour?: string }[]) {
        expect(option.label.length, `${name}.${option.id}`).toBeGreaterThan(0);
        if (option.colour !== undefined) expect(option.colour, `${name}.${option.id}`).toMatch(HEX);
      }
    }
  });

  it("covers every hair texture from straight to tightly coiled, and protective styles", () => {
    const textures = new Set(HAIR_STYLES.map((style) => style.texture));
    for (const texture of ["straight", "wavy", "curly", "coily", "tightly-coiled"]) expect(textures.has(texture as never), texture).toBe(true);
    const ids = HAIR_STYLES.map((style) => style.id);
    for (const id of ["afro", "box-braids", "twists", "locs", "cornrows", "buzz", "fade-crop", "ponytail", "top-bun", "bald"]) expect(ids).toContain(id);
  });

  it("never describes ethnicity, nationality or heritage", () => {
    const labels = Object.values(CATALOGUE).flatMap((list) => list.map((option) => `${option.id} ${option.label}`));
    for (const label of labels) expect(label).not.toMatch(HERITAGE_WORDS);
    const fieldNames = APPEARANCE_SECTIONS.flatMap((section) => Object.keys(APPEARANCE_SPEC[section]));
    for (const field of fieldNames) expect(field).not.toMatch(HERITAGE_WORDS);
  });
});

describe("skin tones", () => {
  it("get steadily deeper along the slider, with no jumps", () => {
    let previous = Infinity;
    for (let i = 0; i <= 100; i++) {
      const L = hexToOklab(skinColour(i / 100, "neutral")).L;
      expect(L).toBeLessThan(previous + 1e-9);
      if (i > 0) expect(previous - L).toBeLessThan(0.02);
      previous = L;
    }
  });

  it("hits the named stops exactly and labels the nearest one", () => {
    for (const stop of SKIN_TONE_STOPS) {
      expect(skinColour(stop.at, "neutral")).toBe(stop.colour);
      expect(skinToneLabel(stop.at)).toBe(stop.label);
    }
    expect(SKIN_TONE_STOPS.map((stop) => stop.label)).toEqual([
      "Very fair", "Fair", "Light", "Medium", "Olive", "Tan", "Brown", "Dark brown", "Deep brown",
    ]);
  });

  it("shifts undertones towards pink (cool) or golden (warm) without changing depth much", () => {
    for (const tone of [0, 0.3, 0.6, 1]) {
      const cool = hexToOklab(skinColour(tone, "cool"));
      const neutral = hexToOklab(skinColour(tone, "neutral"));
      const warm = hexToOklab(skinColour(tone, "warm"));
      expect(cool.b).toBeLessThan(neutral.b);
      expect(warm.b).toBeGreaterThan(neutral.b);
      expect(Math.abs(cool.L - neutral.L)).toBeLessThan(0.03);
      expect(Math.abs(warm.L - neutral.L)).toBeLessThan(0.03);
    }
  });

  it("returns valid colours for bad input instead of throwing", () => {
    for (const tone of [-5, 7, Number.NaN]) expect(skinColour(tone, "neutral")).toMatch(HEX);
    expect(skinColour(0.5, "unknown" as never)).toBe(skinColour(0.5, "neutral"));
  });
});

describe("appearance config validation", () => {
  it("accepts the default and every preset", () => {
    expect(parseAppearanceConfig(DEFAULT_APPEARANCE)).toEqual({ ok: true, value: DEFAULT_APPEARANCE });
    for (const preset of APPEARANCE_PRESETS) expect(parseAppearanceConfig(preset.appearance).ok, preset.id).toBe(true);
  });

  it("refuses a wrong version, a missing section, unknown ids and bad slider values, naming the field", () => {
    const edit = (change: (config: Loose) => void) => {
      const config = loose(cloneAppearance(DEFAULT_APPEARANCE));
      change(config);
      return parseAppearanceConfig(config);
    };
    expect(edit((c) => ((c as unknown as { v: number }).v = 2))).toEqual({ ok: false, field: "v" });
    expect(edit((c) => delete c.face)).toEqual({ ok: false, field: "face" });
    expect(edit((c) => (c.hair!.style = "mohawk"))).toEqual({ ok: false, field: "hair.style" });
    expect(edit((c) => (c.skin!.tone = 1.2))).toEqual({ ok: false, field: "skin.tone" });
    expect(edit((c) => (c.body!.height = Number.NaN))).toEqual({ ok: false, field: "body.height" });
    expect(edit((c) => (c.face!.jaw = "0.5"))).toEqual({ ok: false, field: "face.jaw" });
    expect(edit((c) => delete c.outfit!.shoes)).toEqual({ ok: false, field: "outfit.shoes" });
    expect(parseAppearanceConfig(null)).toEqual({ ok: false, field: "appearance" });
    expect(parseAppearanceConfig("PLS1.abc")).toEqual({ ok: false, field: "appearance" });
  });

  it("rounds sliders to two decimals and drops unknown fields", () => {
    const config = loose(cloneAppearance(DEFAULT_APPEARANCE));
    config.skin!.tone = 0.123456;
    config.hair!.ethnicity = "x";
    (config as unknown as Record<string, unknown>).extra = { anything: true };
    const parsed = parseAppearanceConfig(config);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.skin.tone).toBe(0.12);
    expect("ethnicity" in parsed.value.hair).toBe(false);
    expect("extra" in parsed.value).toBe(false);
  });

  it("repairs stored data: clamps sliders, replaces invalid fields with defaults and lists them", () => {
    const config = loose(cloneAppearance(DEFAULT_APPEARANCE));
    config.hair!.style = "retired-style";
    config.body!.height = 3;
    delete config.outfit!.glasses;
    const result = sanitizeAppearance(config);
    expect(result.changed).toBe(true);
    expect(result.replaced.sort()).toEqual(["hair.style", "outfit.glasses"]);
    expect(result.appearance.body.height).toBe(1);
    expect(result.appearance.hair.style).toBe(DEFAULT_APPEARANCE.hair.style);
    expect(parseAppearanceConfig(result.appearance).ok).toBe(true);
    expect(sanitizeAppearance(DEFAULT_APPEARANCE)).toEqual({ appearance: DEFAULT_APPEARANCE, replaced: [], changed: false });
    expect(sanitizeAppearance("garbage")).toMatchObject({ appearance: DEFAULT_APPEARANCE, changed: true });
  });
});

describe("compact forms", () => {
  it("round-trips through the replicated look string and stays small", () => {
    for (let seed = 1; seed <= 200; seed++) {
      const config = randomAppearance(seed);
      const look = encodeLook(config);
      expect(look.length).toBeLessThan(MAX_LOOK_LENGTH);
      expect(decodeLook(look)).toEqual({ appearance: config, replaced: [], changed: false });
    }
  });

  it("encodes equal looks to equal strings, whatever the key order", () => {
    const config = randomAppearance(7);
    const reordered = { outfit: config.outfit, hair: config.hair, face: config.face, skin: config.skin, body: config.body, v: config.v };
    expect(encodeLook(reordered as AppearanceConfig)).toBe(encodeLook(config));
    expect(sameAppearance(reordered as AppearanceConfig, config)).toBe(true);
  });

  it("decodes unreadable looks to the default without throwing", () => {
    for (const look of ["", "{", "null", "[1,2]", '{"v":1}']) {
      const result = decodeLook(look);
      expect(parseAppearanceConfig(result.appearance).ok).toBe(true);
      expect(result.changed).toBe(true);
    }
  });

  it("round-trips look codes and refuses tampered ones", () => {
    for (const preset of APPEARANCE_PRESETS) {
      const code = toLookCode(preset.appearance);
      expect(code).toMatch(/^PLS1\.[A-Za-z0-9_-]+$/);
      expect(fromLookCode(` ${code} `)).toEqual(preset.appearance);
    }
    const good = toLookCode(DEFAULT_APPEARANCE);
    expect(fromLookCode(good.slice(0, -6))).toBeNull();
    expect(fromLookCode(good.replace("PLS1.", "PLS2."))).toBeNull();
    expect(fromLookCode("PLS1.!!!")).toBeNull();
    expect(fromLookCode("hello")).toBeNull();
  });
});

describe("presets", () => {
  it("are valid, unique and named by look rather than by heritage", () => {
    expect(APPEARANCE_PRESETS.length).toBeGreaterThanOrEqual(12);
    expect(new Set(APPEARANCE_PRESETS.map((p) => p.id)).size).toBe(APPEARANCE_PRESETS.length);
    expect(new Set(APPEARANCE_PRESETS.map((p) => encodeLook(p.appearance))).size).toBe(APPEARANCE_PRESETS.length);
    for (const preset of APPEARANCE_PRESETS) expect(`${preset.id} ${preset.label}`).not.toMatch(HERITAGE_WORDS);
  });

  it("span the skin-tone range, every hair texture, both frames and several builds", () => {
    const tones = APPEARANCE_PRESETS.map((p) => p.appearance.skin.tone);
    expect(Math.min(...tones)).toBeLessThan(0.1);
    expect(Math.max(...tones)).toBeGreaterThan(0.9);
    const bands = new Set(tones.map((tone) => Math.min(3, Math.floor(tone * 4))));
    expect(bands.size).toBe(4);
    const textures = new Set(APPEARANCE_PRESETS.map((p) => hairStyleInfo(p.appearance.hair.style)!.texture));
    for (const texture of ["straight", "wavy", "curly", "coily", "tightly-coiled"]) expect(textures.has(texture as never), texture).toBe(true);
    expect(new Set(APPEARANCE_PRESETS.map((p) => p.appearance.body.frame))).toEqual(new Set(["feminine", "masculine"]));
    expect(new Set(APPEARANCE_PRESETS.map((p) => p.appearance.body.build)).size).toBeGreaterThanOrEqual(5);
  });
});

describe("randomiser", () => {
  it("is deterministic per seed and always valid", () => {
    expect(randomAppearance(42)).toEqual(randomAppearance(42));
    expect(encodeLook(randomAppearance(42))).not.toBe(encodeLook(randomAppearance(43)));
    for (let seed = 0; seed < 300; seed++) expect(parseAppearanceConfig(randomAppearance(seed)).ok, `seed ${seed}`).toBe(true);
  });

  it("can produce every option of every field", () => {
    const seen = new Map<string, Set<unknown>>();
    for (let seed = 0; seed < 1500; seed++) {
      const config = loose(randomAppearance(seed));
      for (const section of APPEARANCE_SECTIONS) {
        for (const [field, value] of Object.entries(config[section]!)) {
          const key = `${section}.${field}`;
          if (!seen.has(key)) seen.set(key, new Set());
          seen.get(key)!.add(value);
        }
      }
    }
    for (const section of APPEARANCE_SECTIONS) {
      for (const [field, spec] of Object.entries(APPEARANCE_SPEC[section]) as [string, { kind: string; options?: { id: string }[] }][]) {
        if (spec.kind !== "enum") continue;
        for (const option of spec.options!) expect(seen.get(`${section}.${field}`)!.has(option.id), `${section}.${field}=${option.id}`).toBe(true);
      }
    }
  });

  it("randomises one section and leaves the rest unchanged", () => {
    const base = APPEARANCE_PRESETS[0]!.appearance;
    for (const section of APPEARANCE_SECTIONS) {
      const next = randomiseSection(base, section, 5);
      for (const other of APPEARANCE_SECTIONS) if (other !== section) expect(next[other]).toEqual(base[other]);
      expect(parseAppearanceConfig(next).ok).toBe(true);
    }
    expect(base).toEqual(APPEARANCE_PRESETS[0]!.appearance);
  });
});

describe("visible layers", () => {
  const with_ = (change: (c: AppearanceConfig) => void) => {
    const config = cloneAppearance(DEFAULT_APPEARANCE);
    change(config);
    return visibleLayers(config);
  };

  it("shows everything by default", () => {
    expect(with_(() => {})).toMatchObject({ topAndBottom: true, hair: "full" });
  });

  it("hides the top and bottom under a full outfit", () => {
    const layers = with_((c) => (c.outfit.full = "jumpsuit"));
    expect(layers.topAndBottom).toBe(false);
    expect(layers.hidden.map((h) => h.field)).toContain("outfit.top");
  });

  it("covers all hair under a headwrap or headscarf, and short styles under a hat", () => {
    expect(with_((c) => (c.outfit.headwear = "headwrap")).hair).toBe("hidden");
    expect(with_((c) => (c.outfit.headwear = "headscarf")).hair).toBe("hidden");
    expect(with_((c) => ((c.outfit.headwear = "beanie"), (c.hair.style = "afro"))).hair).toBe("hidden");
    expect(with_((c) => ((c.outfit.headwear = "cap"), (c.hair.style = "long-straight"))).hair).toBe("below-hat");
    expect(with_((c) => ((c.outfit.headwear = "cap"), (c.hair.style = "bald"))).hair).toBe("full");
    const scarf = with_((c) => (c.outfit.headwear = "headscarf"));
    expect(scarf.hidden.find((h) => h.field === "hair.style")?.reason).toBe("Covered by the headscarf");
  });

  it("flags hair clips that have no hair to sit in", () => {
    expect(with_((c) => ((c.outfit.headwear = "hair-clips"), (c.hair.style = "bald"))).hidden.map((h) => h.field)).toContain("outfit.headwear");
  });
});

describe("upgrading M4/M5 appearances", () => {
  it("keeps the old skin-tone order and maps every old option", () => {
    const tones = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => upgradeLegacyAppearance({ skinTone: `skin-${n}` }).skin.tone);
    expect([...tones].sort((a, b) => a - b)).toEqual(tones);
    for (const hairStyle of ["short", "long", "bun"]) expect(upgradeLegacyAppearance({ hairStyle }).hair.style).not.toBe(undefined);
    for (const outfit of ["tee-terracotta", "hoodie-navy", "shirt-cream", "jacket-olive", "sweater-mustard", "dress-plum"]) {
      expect(parseAppearanceConfig(upgradeLegacyAppearance({ outfit })).ok, outfit).toBe(true);
    }
    expect(upgradeLegacyAppearance({ outfit: "dress-plum" }).outfit).toMatchObject({ full: "dress", topColour: "plum" });
    expect(upgradeLegacyAppearance({ outfit: "jacket-olive" }).outfit).toMatchObject({ outer: "denim-jacket", outerColour: "olive" });
    expect(upgradeLegacyAppearance({ preset: "male", hairStyle: "short" })).toMatchObject({ body: { frame: "masculine" }, hair: { style: "short-straight" } });
  });
});
