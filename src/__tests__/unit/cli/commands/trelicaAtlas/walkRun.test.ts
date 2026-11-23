/**
 * The row `atlas trelica walk` prints for one declared page.
 *
 * The verb itself attaches to the owner's Chrome, writes screenshots and samples the clock, so only the
 * pure `trelicaPageLine` is exercised: its verdict word, its call and body counts, and each reason a page
 * is not held.
 */
import { describe, expect, it } from "vitest";

import type { TrelicaPageObservation } from "../../../../../atlas/trelica/browserWalk.js";
import { trelicaPageLine } from "../../../../../cli/commands/trelicaAtlas/walkRun.js";

/** A reached, photographed page with two first-party calls and 4 of 5 eligible bodies kept. */
function heldPage(): TrelicaPageObservation {
  return {
    artifacts: [],
    attempted: true,
    calls: [
      { method: "GET", pathShape: "/AppsApi/CustomerApp/FilterItems", responseFields: ["id"], statusCode: 200 },
      { method: "POST", pathShape: "/AppsApi/Spend/Aggregate", responseFields: ["total"], statusCode: 200 },
    ],
    captureComplete: false,
    finalUrl: "https://tenant.example/apps",
    observedAt: "2026-09-05T00:00:00.000Z",
    redirected: false,
    requestedUrl: "https://tenant.example/apps",
    responseAccounting: { bodyFailed: 1, bodySucceeded: 4, eligible: 5, seen: 9 },
    screenshotMissingBecause: null,
    statusCode: 200,
    surface: "apps",
    title: "Apps",
    unreachableBecause: null,
  };
}

describe("trelicaPageLine", () => {
  it("renders a held page with its call count and kept/eligible bodies, and no reason clause", () => {
    expect(trelicaPageLine({ page: heldPage() })).toBe(
      "  apps                 HELD           2 call(s), 4 kept / 5 eligible",
    );
  });

  it("renders a reached page with no screenshot as NO-SHOT, carrying the screenshot reason", () => {
    const page: TrelicaPageObservation = { ...heldPage(), screenshotMissingBecause: "the PNG did not verify" };
    expect(trelicaPageLine({ page })).toBe(
      "  apps                 NO-SHOT        2 call(s), 4 kept / 5 eligible — the PNG did not verify",
    );
  });

  it("renders an unreachable page as NOT-HELD, carrying both the unreachable and the screenshot reason", () => {
    const page: TrelicaPageObservation = {
      ...heldPage(),
      screenshotMissingBecause: "no screenshot of an unreached page",
      unreachableBecause: "an empty shell answered",
    };
    expect(trelicaPageLine({ page })).toBe(
      "  apps                 NOT-HELD       2 call(s), 4 kept / 5 eligible — an empty shell answered — no screenshot of an unreached page",
    );
  });

  it("renders a page the walk never asked for as NOT-ATTEMPTED, ahead of any reason it carries", () => {
    const page: TrelicaPageObservation = {
      ...heldPage(),
      attempted: false,
      calls: [],
      responseAccounting: { bodyFailed: 0, bodySucceeded: 0, eligible: 0, seen: 0 },
      screenshotMissingBecause: "never visited",
      unreachableBecause: "the session was lost first",
    };
    expect(trelicaPageLine({ page })).toBe(
      "  apps                 NOT-ATTEMPTED  0 call(s), 0 kept / 0 eligible — the session was lost first — never visited",
    );
  });
});
