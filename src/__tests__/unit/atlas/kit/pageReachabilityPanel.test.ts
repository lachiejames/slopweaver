/**
 * The exists-versus-hit panel in each form its denominator takes: a count only when the count is a measurement,
 * and a scoped or refused answer when it is not. The whole page's composition is `pageHtml.test.ts`'s subject.
 */
import { describe, expect, it } from "vitest";

import type { AtlasPageModel } from "../../../../atlas/kit/pageModel.js";
import { reachabilityPanel } from "../../../../atlas/kit/pageReachabilityPanel.js";

type Reachability = AtlasPageModel["reachability"];

const NEVER_HIT_ROW: Reachability["neverHit"][number] = {
  deepLink: "https://example.test/x",
  endpoint: "GET /x",
  kind: "widget",
  providerId: "x",
  surface: "spec",
};

/** One model carrying the given verdict, everything else defaulted. */
function model({
  platform = "example",
  reachability,
}: {
  platform?: string;
  reachability: Reachability;
}): AtlasPageModel {
  return {
    closedGapCount: 0,
    defects: [],
    detailTables: [],
    entityCount: 0,
    exclusions: [],
    freshnessWindow: null,
    generationDisagreements: [],
    generationUpdatedAt: "2026-09-01T00:00:00.000Z",
    kinds: [],
    liveReadCommand: null,
    openGapCount: 0,
    openGaps: [],
    platform,
    question: "what does example hold",
    reachability,
    resyncCommand: "slopweaver atlas example sync",
    schemaVersion: 3,
    screenshots: [],
    surfaces: [],
    visibilityScope: "whatever this token opens",
    writePolicy: "refuse-every-write",
  };
}

describe("reachabilityPanel", () => {
  it("prints the three counts and opens the rows when a declared atlas has something it never hit", () => {
    const html = reachabilityPanel({
      model: model({
        reachability: {
          corroboratedCount: 2,
          denominator: "declared",
          kinds: [],
          neverHit: [NEVER_HIT_ROW],
          neverHitCount: 1,
          undeclaredFindCount: 3,
          undeterminedKinds: [],
          unknownBecause: null,
        },
      }),
    });
    expect(html).toContain(
      '<p class="verdict">1 declared and never reached · 2 declared and reached · 3 reached but never declared.</p>',
    );
    expect(html).toContain("<details open><summary>the 1 it can name</summary>");
    expect(html).toContain(
      "<tr><td>widget</td><td><code>x</code></td><td><code>GET /x</code></td><td>spec</td>" +
        '<td><a href="https://example.test/x" rel="noreferrer">open</a></td></tr>',
    );
  });

  it("leaves the disclosure shut when a declared atlas has nothing behind it", () => {
    const html = reachabilityPanel({
      model: model({
        reachability: {
          corroboratedCount: 0,
          denominator: "declared",
          kinds: [],
          neverHit: [],
          neverHitCount: 0,
          undeclaredFindCount: 0,
          undeterminedKinds: [],
          unknownBecause: null,
        },
      }),
    });
    expect(html).toContain("<details><summary>the 0 it can name</summary>");
  });

  it("says how many rows it is showing when the list was capped", () => {
    const html = reachabilityPanel({
      model: model({
        reachability: {
          corroboratedCount: 0,
          denominator: "declared",
          kinds: [],
          neverHit: [NEVER_HIT_ROW],
          neverHitCount: 2,
          undeclaredFindCount: 0,
          undeterminedKinds: [],
          unknownBecause: null,
        },
      }),
    });
    expect(html).toContain("Showing 1 of 2 — raise <code>--never-hit-cap</code> for the rest.");
  });

  it("scopes a partial atlas's count to what it can answer, a zero included", () => {
    const html = reachabilityPanel({
      model: model({
        reachability: {
          corroboratedCount: 1,
          denominator: "partial",
          kinds: [],
          neverHit: [],
          neverHitCount: 0,
          undeclaredFindCount: 0,
          undeterminedKinds: ["console-page"],
          unknownBecause: "only some of this atlas is measurable",
        },
      }),
    });
    expect(html).toContain("PARTLY UNKNOWN — this atlas can answer for some of what it holds and not for 1 of its");
    expect(html).toContain("Nothing declares what exists for console-page.");
    expect(html).toContain("That figure covers those kinds and no others — including when it is zero.");
    expect(html).not.toContain("0 declared and never reached · 1 declared and reached");
  });

  it("names twelve undetermined kinds and counts the rest", () => {
    const html = reachabilityPanel({
      model: model({
        reachability: {
          corroboratedCount: 0,
          denominator: "partial",
          kinds: [],
          neverHit: [],
          neverHitCount: 0,
          undeclaredFindCount: 0,
          undeterminedKinds: Array.from({ length: 13 }, (_, index) => `kind-${String(index)}`),
          unknownBecause: "only some of this atlas is measurable",
        },
      }),
    });
    expect(html).toContain("kind-11 and 1 more.");
    expect(html).not.toContain("kind-12");
  });

  it("refuses to count when nothing declares the surface, escaping the reason and the platform", () => {
    const html = reachabilityPanel({
      model: model({
        platform: "a&b",
        reachability: {
          corroboratedCount: 0,
          denominator: "absent",
          kinds: [],
          neverHit: [],
          neverHitCount: 0,
          undeclaredFindCount: 7,
          undeterminedKinds: [],
          unknownBecause: "no spec for <x>",
        },
      }),
    });
    expect(html).toContain("UNKNOWN — and that is not the same as none.");
    expect(html).toContain("<p>no spec for &lt;x&gt;.</p>");
    expect(html).toContain("against what a&amp;b has.");
    expect(html).toContain("7 entities were found by visiting.");
    expect(html).not.toContain("<details");
  });
});
