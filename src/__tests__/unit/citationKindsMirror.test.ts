/*
 * In the src lane, not the site one, because the registry imports every atlas and the site build cannot resolve their
 * dependencies (CI `site`). Every atlas platform has a citation kind, held against `src/atlas/registry.ts` itself so a new atlas without a chip colour fails
 * here instead of drawing grey. The site module is imported at run time, by address, because `src/`'s `rootDir` may not
 * contain a `site/` file (TS6059).
 */

import { describe, expect, it } from "vitest";

import { atlasPlatforms } from "../../atlas/registry.js";

const CITATION_KINDS = new URL("../../../site/lib/citationKinds.ts", import.meta.url).href;

/**
 * Whether a module exposes the site's `atlasCitationPlatforms` function.
 *
 * @param module what the run-time import returned
 * @returns true when it carries that function
 */
function hasAtlasCitationPlatforms(module: unknown): module is { atlasCitationPlatforms: () => readonly string[] } {
  return typeof module === "object" && module !== null && "atlasCitationPlatforms" in module;
}

describe("citation kinds mirror the atlas registry", () => {
  it("names every atlas platform exactly once, and none the registry does not have", async () => {
    const kinds: unknown = await import(CITATION_KINDS);
    expect(hasAtlasCitationPlatforms(kinds)).toBe(true);
    const covered = (kinds as { atlasCitationPlatforms: () => readonly string[] }).atlasCitationPlatforms();
    expect(covered.length).toBeGreaterThan(0);
    expect(covered.toSorted((a, b) => a.localeCompare(b))).toEqual(
      [...atlasPlatforms()].toSorted((a, b) => a.localeCompare(b)),
    );
    expect(new Set(covered).size).toBe(covered.length);
  });
});
