/**
 * How a walk verb reports one page: a row led by its verdict, and the `--json` row. Every observation here
 * carries a private identifier in BOTH its requested and final URL, and each case asserts the whole rendered
 * value — so the URLs being absent is proven by exact equality, not only by a `not.toContain`.
 */
import { describe, expect, it } from "vitest";

import type { PageObservation } from "../../../../../atlas/kit/pageWalk.js";
import { jsonPage, pageLine } from "../../../../../cli/commands/atlas/walkReport.js";

const PRIVATE_SLUG = "acme-private-tenant-7f3a";

/** A reached, photographed page with two calls, overridable per case. */
function observation({
  over = {},
}: {
  over?: Partial<PageObservation<string>>;
} = {}): PageObservation<string> {
  return {
    artifacts: [],
    attempted: true,
    calls: ["GET /api/one", "GET /api/two"],
    captureComplete: false,
    finalUrl: `https://app.example.com/${PRIVATE_SLUG}/settings?moved=1`,
    observedAt: "2026-10-01T09:00:00.000Z",
    redirected: true,
    requestedUrl: `https://app.example.com/${PRIVATE_SLUG}/settings`,
    responseAccounting: { bodyFailed: 1, bodySucceeded: 4, eligible: 5, seen: 9 },
    screenshotMissingBecause: null,
    statusCode: 200,
    surface: "settings",
    title: "Settings",
    unreachableBecause: null,
    ...over,
  };
}

describe("pageLine", () => {
  it("leads a reached, photographed page with held, and its call and body counts", () => {
    expect(pageLine({ page: observation() })).toBe(
      "  settings                     held           2 call(s), 4 kept / 5 eligible",
    );
  });

  it("leads a page the walk never asked for with NOT-ATTEMPTED, ahead of any reason it carries", () => {
    const page = observation({
      over: {
        attempted: false,
        calls: [],
        screenshotMissingBecause: "never visited",
        unreachableBecause: "lost session",
      },
    });

    expect(pageLine({ page })).toBe(
      "  settings                     NOT-ATTEMPTED  0 call(s), 4 kept / 5 eligible — lost session — never visited",
    );
  });

  it("leads an unreachable page with UNREACHABLE, then the unreachable reason, then the screenshot reason", () => {
    const page = observation({
      over: { screenshotMissingBecause: "no picture of a wall", unreachableBecause: "sign-in wall" },
    });

    expect(pageLine({ page })).toBe(
      "  settings                     UNREACHABLE    2 call(s), 4 kept / 5 eligible — sign-in wall — no picture of a wall",
    );
  });

  it("leads a reached page with no screenshot with NO-SCREENSHOT and its reason", () => {
    const page = observation({ over: { screenshotMissingBecause: "blank render" } });

    expect(pageLine({ page })).toBe(
      "  settings                     NO-SCREENSHOT  2 call(s), 4 kept / 5 eligible — blank render",
    );
  });
});

describe("jsonPage", () => {
  it("carries the surface, verdict fields and counts, with no URL, title, time, artifacts or call bodies", () => {
    const page = observation({ over: { screenshotMissingBecause: "blank render", statusCode: 302 } });

    expect(jsonPage({ page })).toStrictEqual({
      attempted: true,
      callCount: 2,
      captureComplete: false,
      redirected: true,
      responseAccounting: { bodyFailed: 1, bodySucceeded: 4, eligible: 5, seen: 9 },
      screenshotMissingBecause: "blank render",
      statusCode: 302,
      surface: "settings",
      unreachableBecause: null,
    });
  });
});
