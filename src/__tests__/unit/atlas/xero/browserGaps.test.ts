/**
 * What one Xero browser walk could not answer, as gaps and rechecks.
 *
 * Every function under test is pure: observations in, gaps out. The gap IDs come from `openXeroGap`, which
 * owns the id derivation, so each expected gap is built with every argument written out here.
 */
import { describe, expect, it } from "vitest";

import { inventoryGap, walkPageGaps, walkRechecks, XERO_INVENTORY_SCOPE } from "../../../../atlas/xero/browserGaps.js";
import { XERO_BROWSER_PAGES } from "../../../../atlas/xero/browserPages.js";
import type { XeroPageObservation } from "../../../../atlas/xero/browserWalk.js";
import { openXeroGap, type XeroGapCondition } from "../../../../atlas/xero/gaps.js";
import type { XeroAtlasGap } from "../../../../atlas/xero/model.js";

const AT = "2026-10-12T03:04:05.000Z";

/**
 * A fully held page: attempted, reached, photographed and completely captured. Every field carries its own
 * distinct sentinel, so a read of the wrong field cannot coincide with the right one.
 */
function observation(over: Partial<XeroPageObservation> = {}): XeroPageObservation {
  return {
    artifacts: [
      {
        byteLength: 4711,
        kind: "page-png",
        mediaType: "image/png",
        relativePath: "artifacts/base-surface.png",
        sha256: "a".repeat(64),
      },
    ],
    attempted: true,
    calls: [
      {
        host: "api.xero.example",
        method: "GET",
        pathShape: "/base/{id}",
        responseFields: ["BaseField"],
        statusCode: 218,
      },
    ],
    captureComplete: true,
    finalUrl: "https://go.xero.com/final-sentinel",
    observedAt: "2026-10-12T01:02:03.000Z",
    redirected: false,
    requestedUrl: "https://go.xero.com/requested-sentinel",
    responseAccounting: { bodyFailed: 0, bodySucceeded: 7, eligible: 7, seen: 31 },
    screenshotMissingBecause: null,
    statusCode: 219,
    surface: "base-surface",
    title: "Base Title Sentinel",
    unreachableBecause: null,
    ...over,
  };
}

/**
 * Six pages, each attempted one raising a different condition, shared by both multi-page tests. Every page
 * below the one that decides it also carries a problem value, and every deciding field (`attempted`,
 * `unreachableBecause`, `redirected`, `screenshotMissingBecause`, `captureComplete`, `responseAccounting`)
 * differs from row 0 and from the row before it somewhere it decides, so a field read from another page
 * changes the condition or the reason.
 */
const WALK = [
  observation({ surface: "surface-held" }),
  observation({
    captureComplete: false,
    redirected: false,
    screenshotMissingBecause: "dead-shot",
    surface: "surface-dead",
    unreachableBecause: "dead-404",
  }),
  observation({
    captureComplete: false,
    redirected: true,
    screenshotMissingBecause: "moved-shot",
    surface: "surface-moved",
    unreachableBecause: "moved-elsewhere",
  }),
  observation({
    attempted: false,
    captureComplete: false,
    redirected: true,
    screenshotMissingBecause: "skipped-shot",
    surface: "surface-skipped",
  }),
  observation({
    captureComplete: false,
    redirected: true,
    screenshotMissingBecause: "shotless-shot",
    surface: "surface-shotless",
  }),
  observation({
    captureComplete: false,
    responseAccounting: { bodyFailed: 2, bodySucceeded: 5, eligible: 7, seen: 31 },
    surface: "surface-lossy",
  }),
];

/** One page gap as `walkPageGaps` files it, with only what varies between pages written at the call. */
function pageGap({
  condition,
  reason,
  scope,
}: {
  condition: XeroGapCondition;
  reason: string;
  scope: string;
}): XeroAtlasGap {
  return openXeroGap({
    at: AT,
    condition,
    fields: [],
    kind: "page",
    reason,
    scope,
    surfaces: ["browser"],
  });
}

describe("XERO_INVENTORY_SCOPE", () => {
  it("is the scope the permanent denominator gap is filed under", () => {
    expect(XERO_INVENTORY_SCOPE).toBe("xero-browser-inventory");
  });
});

describe("walkPageGaps", () => {
  it("raises nothing for a page that was reached, photographed and completely captured", () => {
    expect(walkPageGaps({ at: AT, pages: [observation()] })).toEqual([]);
  });

  it("raises nothing for no pages", () => {
    expect(walkPageGaps({ at: AT, pages: [] })).toEqual([]);
  });

  it("files a page the walk never asked for as not attempted, saying it was not reached", () => {
    const gaps = walkPageGaps({ at: AT, pages: [observation({ attempted: false, surface: "surface-skipped" })] });
    expect(gaps).toEqual([
      openXeroGap({
        at: AT,
        condition: "browser-page-not-attempted",
        fields: [],
        kind: "page",
        reason: "the page was not reached",
        scope: "surface-skipped",
        surfaces: ["browser"],
      }),
    ]);
  });

  it("lets not-attempted win over every other state, carrying the recorded unreachable reason", () => {
    const gaps = walkPageGaps({
      at: AT,
      pages: [
        observation({
          attempted: false,
          captureComplete: false,
          redirected: true,
          screenshotMissingBecause: "screenshot-conflict-sentinel",
          surface: "surface-conflicted-skip",
          unreachableBecause: "unreachable-conflict-sentinel",
        }),
      ],
    });
    expect(gaps).toEqual([
      openXeroGap({
        at: AT,
        condition: "browser-page-not-attempted",
        fields: [],
        kind: "page",
        reason: "unreachable-conflict-sentinel",
        scope: "surface-conflicted-skip",
        surfaces: ["browser"],
      }),
    ]);
  });

  it("files an unreachable page the client sent elsewhere as not addressable, with the recorded reason", () => {
    const gaps = walkPageGaps({
      at: AT,
      pages: [
        observation({
          captureComplete: false,
          redirected: true,
          screenshotMissingBecause: "screenshot-conflict-sentinel",
          surface: "surface-moved",
          unreachableBecause: "moved-elsewhere-sentinel",
        }),
      ],
    });
    expect(gaps).toEqual([
      openXeroGap({
        at: AT,
        condition: "browser-page-not-addressable",
        fields: [],
        kind: "page",
        reason: "moved-elsewhere-sentinel",
        scope: "surface-moved",
        surfaces: ["browser"],
      }),
    ]);
  });

  it("files an unreachable page that was not redirected as unreachable, ahead of a missing screenshot", () => {
    const gaps = walkPageGaps({
      at: AT,
      pages: [
        observation({
          captureComplete: false,
          redirected: false,
          screenshotMissingBecause: "screenshot-conflict-sentinel",
          surface: "surface-dead",
          unreachableBecause: "answered-404-sentinel",
        }),
      ],
    });
    expect(gaps).toEqual([
      openXeroGap({
        at: AT,
        condition: "browser-page-unreachable",
        fields: [],
        kind: "page",
        reason: "answered-404-sentinel",
        scope: "surface-dead",
        surfaces: ["browser"],
      }),
    ]);
  });

  it("files a reached page with no proof screenshot, ahead of an incomplete capture", () => {
    const gaps = walkPageGaps({
      at: AT,
      pages: [
        observation({
          captureComplete: false,
          responseAccounting: { bodyFailed: 2, bodySucceeded: 11, eligible: 13, seen: 29 },
          screenshotMissingBecause: "no-png-sentinel",
          surface: "surface-unphotographed",
        }),
      ],
    });
    expect(gaps).toEqual([
      openXeroGap({
        at: AT,
        condition: "browser-screenshot-missing",
        fields: [],
        kind: "page",
        reason: "no-png-sentinel",
        scope: "surface-unphotographed",
        surfaces: ["browser"],
      }),
    ]);
  });

  it("files a photographed page whose response bodies were lost, quoting the eligible accounting", () => {
    const gaps = walkPageGaps({
      at: AT,
      pages: [
        observation({
          captureComplete: false,
          responseAccounting: { bodyFailed: 2, bodySucceeded: 11, eligible: 13, seen: 29 },
          surface: "surface-lossy",
        }),
      ],
    });
    expect(gaps).toEqual([
      openXeroGap({
        at: AT,
        condition: "browser-capture-incomplete",
        fields: [],
        kind: "page",
        reason: "the page was reached and photographed, but 2 of 13 eligible response bodies were lost (11 kept)",
        scope: "surface-lossy",
        surfaces: ["browser"],
      }),
    ]);
  });

  it("files each unheld page's own gap in declaration order, and none for the held page", () => {
    expect(walkPageGaps({ at: AT, pages: WALK })).toEqual([
      pageGap({ condition: "browser-page-unreachable", reason: "dead-404", scope: "surface-dead" }),
      pageGap({ condition: "browser-page-not-addressable", reason: "moved-elsewhere", scope: "surface-moved" }),
      pageGap({
        condition: "browser-page-not-attempted",
        reason: "the page was not reached",
        scope: "surface-skipped",
      }),
      pageGap({ condition: "browser-screenshot-missing", reason: "shotless-shot", scope: "surface-shotless" }),
      pageGap({
        condition: "browser-capture-incomplete",
        reason: "the page was reached and photographed, but 2 of 7 eligible response bodies were lost (5 kept)",
        scope: "surface-lossy",
      }),
    ]);
  });
});

describe("inventoryGap", () => {
  it("is the permanent, open gap saying the browser denominator is a hand list", () => {
    expect(inventoryGap({ at: AT })).toEqual(
      openXeroGap({
        at: AT,
        condition: "provider-publishes-no-browser-inventory",
        fields: [],
        kind: "page",
        reason:
          "Xero publishes no manifest of its own web-client navigation, so this atlas's denominator is the " +
          `${String(XERO_BROWSER_PAGES.length)} hand-declared route(s) in browserPages.ts and browserPageEntries.ts — ` +
          "a surface Xero ships after that list was written is absent from it, and no run can discover the absence",
        scope: "xero-browser-inventory",
        surfaces: ["browser"],
      }),
    );
  });

  it("is stamped open at the run's own instant", () => {
    const gap = inventoryGap({ at: AT });
    expect(gap.status).toBe("open");
    expect(gap.firstDetectedAt).toBe(AT);
    expect(gap.lastDetectedAt).toBe(AT);
    expect(gap.lastCheckedAt).toBe(AT);
  });
});

describe("walkRechecks", () => {
  it("rechecks nothing for a page the walk never attempted", () => {
    expect(walkRechecks({ pages: [observation({ attempted: false })] })).toEqual([]);
  });

  it("rechecks nothing for no pages", () => {
    expect(walkRechecks({ pages: [] })).toEqual([]);
  });

  it("resolves all five conditions for a fully held attempted page", () => {
    expect(walkRechecks({ pages: [observation({ surface: "surface-held" })] })).toEqual([
      { condition: "browser-page-unreachable", resolved: true, scope: "surface-held" },
      { condition: "browser-page-not-addressable", resolved: true, scope: "surface-held" },
      { condition: "browser-page-not-attempted", resolved: true, scope: "surface-held" },
      { condition: "browser-screenshot-missing", resolved: true, scope: "surface-held" },
      { condition: "browser-capture-incomplete", resolved: true, scope: "surface-held" },
    ]);
  });

  it("leaves only the screenshot condition unresolved for an unphotographed page", () => {
    const pages = [observation({ screenshotMissingBecause: "no-png-sentinel", surface: "surface-unphotographed" })];
    expect(walkRechecks({ pages })).toEqual([
      { condition: "browser-page-unreachable", resolved: true, scope: "surface-unphotographed" },
      { condition: "browser-page-not-addressable", resolved: true, scope: "surface-unphotographed" },
      { condition: "browser-page-not-attempted", resolved: true, scope: "surface-unphotographed" },
      { condition: "browser-screenshot-missing", resolved: false, scope: "surface-unphotographed" },
      { condition: "browser-capture-incomplete", resolved: true, scope: "surface-unphotographed" },
    ]);
  });

  it("scopes each page's five rechecks to its own surface and skips an unattempted page between them", () => {
    const rechecksFor = ({ scope, open }: { scope: string; open: string | null }): unknown[] =>
      [
        "browser-page-unreachable",
        "browser-page-not-addressable",
        "browser-page-not-attempted",
        "browser-screenshot-missing",
        "browser-capture-incomplete",
      ].map((condition) => ({ condition, resolved: condition !== open, scope }));
    expect(walkRechecks({ pages: WALK })).toEqual([
      ...rechecksFor({ open: null, scope: "surface-held" }),
      ...rechecksFor({ open: "browser-page-unreachable", scope: "surface-dead" }),
      ...rechecksFor({ open: "browser-page-not-addressable", scope: "surface-moved" }),
      ...rechecksFor({ open: "browser-screenshot-missing", scope: "surface-shotless" }),
      ...rechecksFor({ open: "browser-capture-incomplete", scope: "surface-lossy" }),
    ]);
  });

  it("leaves the unreachable condition unresolved for an unreachable page that was not redirected", () => {
    const pages = [observation({ surface: "surface-dead", unreachableBecause: "answered-404-sentinel" })];
    expect(walkRechecks({ pages })).toEqual([
      { condition: "browser-page-unreachable", resolved: false, scope: "surface-dead" },
      { condition: "browser-page-not-addressable", resolved: true, scope: "surface-dead" },
      { condition: "browser-page-not-attempted", resolved: true, scope: "surface-dead" },
      { condition: "browser-screenshot-missing", resolved: true, scope: "surface-dead" },
      { condition: "browser-capture-incomplete", resolved: true, scope: "surface-dead" },
    ]);
  });
});
