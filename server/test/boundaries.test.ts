// Architecture guards that are easiest to check by reading source files.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const sharedSrc = join(import.meta.dirname, "../../shared/src");

describe("appearance boundaries (D-029)", () => {
  it("life-simulation rules never read appearance: looks have no gameplay effect", () => {
    const lifeDir = join(sharedSrc, "life");
    for (const file of readdirSync(lifeDir)) {
      expect(readFileSync(join(lifeDir, file), "utf8"), file).not.toMatch(/appearance/i);
    }
  });

  it("no gameplay module on the server or in the interaction rules reads appearance (audit 2026-10-20)", () => {
    const serverSrc = join(import.meta.dirname, "../src");
    const files = [
      ...readdirSync(join(serverSrc, "life")).map((file) => join(serverSrc, "life", file)),
      join(serverSrc, "InteractionSystem.ts"),
      join(sharedSrc, "interactions.ts"),
    ];
    for (const file of files) {
      // Appearance reaches the server only as the profile's config and the replicated `look` string.
      expect(readFileSync(file, "utf8"), file).not.toMatch(/appearance|decodeLook|encodeLook|\.look\b|skin/i);
    }
  });

  it("the appearance model stores no ethnicity, race or heritage field", () => {
    const schema = readFileSync(join(sharedSrc, "appearance/schema.ts"), "utf8");
    const spec = schema.slice(schema.indexOf("export const APPEARANCE_SPEC"), schema.indexOf("export const DEFAULT_APPEARANCE"));
    expect(spec.length).toBeGreaterThan(100);
    expect(spec).not.toMatch(/ethnic|race|heritage|nationality/i);
  });
});

describe("day and night is presentation only (M7b, D-037)", () => {
  /** Every TypeScript file under a folder. */
  const sources = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
      entry.isDirectory() ? sources(join(dir, entry.name)) : entry.name.endsWith(".ts") ? [join(dir, entry.name)] : [],
    );

  it("no shared rule or server module reads the light: needs, money and actions don't depend on it", () => {
    const serverSrc = join(import.meta.dirname, "../src");
    const files = [...sources(sharedSrc), ...sources(serverSrc)];
    expect(files.length).toBeGreaterThan(20);
    for (const file of files) {
      // The light lives in client/src/render (daylight.ts, nightShading.ts); gameplay code never imports client code.
      const text = readFileSync(file, "utf8");
      expect(text, file).not.toMatch(/from\s+["'][^"']*(client\/|daylight|nightShading)/);
      expect(text, file).not.toMatch(/daylightAt|sunIsUp|characterLift|uNightGlow|NIGHT_UNIFORMS/);
    }
  });
});
