/*
 * In the src lane, not the site one, because `FETCHABLE_SOURCES` lives in `src/`, which the site build cannot reach.
 * The console's freshness reader refuses a report missing any source it lists, so the two lists must agree exactly:
 * a source the verb added and the site did not know would refuse every report, and one the site expects but the
 * verb dropped would too. The site module is imported at run time, by address, because `src/`'s `rootDir` may not
 * contain a `site/` file (TS6059).
 */

import { describe, expect, it } from "vitest";

import { FETCHABLE_SOURCES } from "../../integrations/corpusSources.js";

const SOURCE_FRESHNESS = new URL("../../../site/lib/sourceFreshnessReport.ts", import.meta.url).href;

/**
 * Whether a module exposes the site's `SOURCE_FRESHNESS_SOURCES` list.
 *
 * @param module what the run-time import returned
 * @returns true when it carries that list
 */
function hasSourceList(module: unknown): module is { SOURCE_FRESHNESS_SOURCES: readonly string[] } {
  return typeof module === "object" && module !== null && "SOURCE_FRESHNESS_SOURCES" in module;
}

describe("the console's freshness sources mirror what the verb reports", () => {
  it("names every fetchable source exactly once, and none the verb does not report", async () => {
    const site: unknown = await import(SOURCE_FRESHNESS);
    expect(hasSourceList(site)).toBe(true);
    const listed = (site as { SOURCE_FRESHNESS_SOURCES: readonly string[] }).SOURCE_FRESHNESS_SOURCES;
    expect(listed.length).toBeGreaterThan(0);
    expect(listed.toSorted((a, b) => a.localeCompare(b))).toEqual(
      [...FETCHABLE_SOURCES].toSorted((a, b) => a.localeCompare(b)),
    );
    expect(new Set(listed).size).toBe(listed.length);
  });
});
