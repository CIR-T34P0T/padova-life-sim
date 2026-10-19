// Character appearance (M6): catalogue, versioned config with validation,
// colour maths, presets, randomiser and visibility rules. Pure data and
// functions; no rendering. Nothing here describes ethnicity (D-029) and
// nothing in shared/src/life may import from here (appearance has no
// gameplay effect).

export * from "./catalogue.ts";
export * from "./colour.ts";
export * from "./schema.ts";
export * from "./presets.ts";
export * from "./random.ts";
export * from "./layers.ts";
