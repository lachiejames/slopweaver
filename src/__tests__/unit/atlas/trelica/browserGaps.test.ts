/*
 * The gap rows and recheck rows a Trelica browser walk's page observations raise, judged directly on the
 * pure builders with synthetic observations.
 */
import { describe, expect, it } from "vitest";

import { observedGaps, rechecks } from "../../../../atlas/trelica/browserGaps.js";
import type { TrelicaPageObservation } from "../../../../atlas/trelica/browserWalk.js";

const AT = "2026-09-05T00:00:00.000Z";

/** One reached, photographed, fully captured observation, overridable field by field. */
function observation(over: Partial<TrelicaPageObservation> = {}): TrelicaPageObservation {
  return {
    artifacts: [],
    attempted: true,
    calls: [],
    captureComplete: true,
    finalUrl: "https://acme.example/People",
    observedAt: AT,
    redirected: false,
    requestedUrl: "https://acme.example/People",
    responseAccounting: { bodyFailed: 0, bodySucceeded: 2, eligible: 2, seen: 5 },
    screenshotMissingBecause: null,
    statusCode: 200,
    surface: "people",
    title: "People",
    unreachableBecause: null,
    ...over,
  };
}

describe("observedGaps", () => {
  it("raises the standing inventory gap and nothing else for a clean page", () => {
    const gaps = observedGaps({ at: AT, pages: [observation()] });
    expect(gaps.map((gap) => [gap.condition, gap.scope])).toEqual([
      ["provider-publishes-no-page-inventory", "declared-page-inventory"],
    ]);
  });

  it("raises only the not-attempted gap for a page the walk never reached", () => {
    const gaps = observedGaps({ at: AT, pages: [observation({ attempted: false, captureComplete: false })] });
    expect(gaps.map((gap) => [gap.condition, gap.scope])).toEqual([
      ["provider-publishes-no-page-inventory", "declared-page-inventory"],
      ["browser-page-not-attempted", "people"],
    ]);
  });

  it("carries the observation's own reason for an unreachable page", () => {
    const gaps = observedGaps({ at: AT, pages: [observation({ unreachableBecause: "redirected to sign-in" })] });
    expect(gaps.map((gap) => [gap.condition, gap.reason])).toEqual([
      [
        "provider-publishes-no-page-inventory",
        "this platform's own navigation lives behind a menu button rather than in links, and its route table ships in lazily-loaded client bundles, so the declared page list is maintained in `browserPages.ts` rather than read from the vendor. A page shipped tomorrow is absent from it until somebody notices",
      ],
      ["browser-page-unreachable", "redirected to sign-in"],
    ]);
  });

  it("raises the screenshot gap before the capture gap, counting the unread bodies", () => {
    const page = observation({
      captureComplete: false,
      responseAccounting: { bodyFailed: 3, bodySucceeded: 4, eligible: 7, seen: 9 },
      screenshotMissingBecause: "the screenshot call timed out",
    });
    const gaps = observedGaps({ at: AT, pages: [page] });
    expect(gaps.slice(1).map((gap) => [gap.condition, gap.reason])).toEqual([
      ["browser-screenshot-missing", "the screenshot call timed out"],
      [
        "browser-capture-incomplete",
        "3 of 7 eligible response bodies could not be read, so this page's observed operations understate what it asked for",
      ],
    ]);
  });
});

describe("rechecks", () => {
  it("skips an unattempted page and maps an attempted one's four conditions", () => {
    const result = rechecks({
      pages: [
        observation({ attempted: false, surface: "catalog" }),
        observation({ captureComplete: false, screenshotMissingBecause: "no picture" }),
      ],
    });
    expect(result).toEqual([
      { condition: "browser-page-not-attempted", resolved: true, scope: "people" },
      { condition: "browser-page-unreachable", resolved: true, scope: "people" },
      { condition: "browser-screenshot-missing", resolved: false, scope: "people" },
      { condition: "browser-capture-incomplete", resolved: false, scope: "people" },
    ]);
  });

  it("returns no rechecks for an empty walk", () => {
    expect(rechecks({ pages: [] })).toEqual([]);
  });
});
