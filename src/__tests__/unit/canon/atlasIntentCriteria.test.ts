/**
 * The §6 criteria in `docs/atlas-intent/06-holdings.md` that a rewrite must not silently soften.
 *
 * This page is the one canon file whose whole job is to stop the atlas definition being re-derived, and its
 * §6 bound has already been weakened once by ordinary careful work: the first draft named audit logs and
 * event streams, which reads as a list of families to skip, and lost the property that actually decides the
 * question. A prose rule that nothing checks is a rule the next rewrite rounds off, so the two load-bearing
 * distinctions are pinned here rather than left to review.
 *
 * Same two-describe shape as `staleReferences.test.ts`: the first exercises the pure matcher on inline
 * fixtures and never touches disk, the second reads the real page.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * The phrases §6's voluminous bound cannot lose and still mean what it means.
 *
 * `observation` and `instant` carry the criterion itself; `disposition` carries the half that keeps it from
 * being read as an exclusion, which is the reading that would make an atlas answer "this platform has no log
 * search".
 */
const REQUIRED_SECTION_6_TERMS: readonly string[] = ["observation", "instant", "disposition", "cuts through"];

/**
 * Which required terms a page is missing, lowercased so a sentence may capitalise one.
 *
 * @param text the whole page
 * @param required the terms that must appear
 * @returns the missing terms, in the order they were required
 */
function missingTerms({ text, required }: { text: string; required: readonly string[] }): readonly string[] {
  const haystack = text.toLowerCase();
  return required.filter((term) => !haystack.includes(term.toLowerCase()));
}

describe("missingTerms", () => {
  it("names every absent term, in the order required", () => {
    expect(missingTerms({ required: ["alpha", "beta", "gamma"], text: "only beta is here" })).toEqual([
      "alpha",
      "gamma",
    ]);
  });

  it("is empty when every term is present, so the guard can pass", () => {
    expect(missingTerms({ required: ["alpha", "beta"], text: "alpha and beta" })).toEqual([]);
  });

  it("matches regardless of case, because a term may open a sentence", () => {
    expect(missingTerms({ required: ["observation"], text: "Observations are unbounded." })).toEqual([]);
  });
});

describe("docs/atlas-intent/06-holdings.md", () => {
  const page = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "docs", "atlas-intent", "06-holdings.md"),
    "utf8",
  );

  it("states the voluminous bound as a criterion, not as a list of families", () => {
    expect(missingTerms({ required: REQUIRED_SECTION_6_TERMS, text: page })).toEqual([]);
  });

  it("still carries the per-platform test §6 exists to state", () => {
    expect(page.includes("does something better suited already hold this platform's entities")).toBe(true);
  });

  it("keeps both arms of the per-platform test on the page, not just the one Slack landed on", () => {
    expect(page.includes("surface map")).toBe(true);
    expect(page.includes("everything reachable")).toBe(true);
  });
});
