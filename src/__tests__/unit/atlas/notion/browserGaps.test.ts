import { describe, expect, it } from "vitest";

import {
  inventoryGap,
  NOTION_INVENTORY_SCOPE,
  walkPageGaps,
  walkRechecks,
} from "../../../../atlas/notion/browserGaps.js";
import type { NotionPageObservation } from "../../../../atlas/notion/browserWalk.js";

const AT = "2026-09-05T00:00:00.000Z";

/** One observation, with every field set so a test states only what it is about. */
function observation(over: Partial<NotionPageObservation> = {}): NotionPageObservation {
  return {
    artifacts: [],
    attempted: true,
    calls: [],
    captureComplete: true,
    finalUrl: "https://app.notion.com/space/my-account",
    observedAt: AT,
    redirected: false,
    requestedUrl: "https://app.notion.com/space/my-account",
    responseAccounting: { bodyFailed: 0, bodySucceeded: 3, eligible: 3, seen: 9 },
    screenshotMissingBecause: null,
    statusCode: 200,
    surface: "account-profile",
    title: "Notion",
    unreachableBecause: null,
    ...over,
  };
}

describe("walkPageGaps", () => {
  it("raises nothing for a page that was reached, photographed and fully captured", () => {
    expect(walkPageGaps({ at: AT, pages: [observation()] })).toEqual([]);
  });

  it("raises not-attempted for a page the walk never got to", () => {
    const gaps = walkPageGaps({
      at: AT,
      pages: [observation({ attempted: false, unreachableBecause: "session lost" })],
    });
    expect(gaps[0]!.condition).toBe("browser-page-not-attempted");
  });

  it("carries the walk's own reason for never attempting a page onto its gap", () => {
    const gaps = walkPageGaps({
      at: AT,
      pages: [observation({ attempted: false, unreachableBecause: "session lost" })],
    });
    expect(gaps[0]!.reason).toBe("session lost");
  });

  it("carries the unreachable page's own reason onto its gap", () => {
    const gaps = walkPageGaps({ at: AT, pages: [observation({ unreachableBecause: "navigation timed out" })] });
    expect(gaps[0]!.reason).toBe("navigation timed out");
  });

  it("raises not-addressable for a page the client redirected away from", () => {
    const gaps = walkPageGaps({
      at: AT,
      pages: [observation({ redirected: true, unreachableBecause: "sent to the marketing site" })],
    });
    expect(gaps[0]!.condition).toBe("browser-page-not-addressable");
  });

  it("raises unreachable for a page that failed without being redirected", () => {
    const gaps = walkPageGaps({ at: AT, pages: [observation({ unreachableBecause: "navigation timed out" })] });
    expect(gaps[0]!.condition).toBe("browser-page-unreachable");
  });

  it("raises screenshot-missing for a page that was reached and never photographed", () => {
    const gaps = walkPageGaps({ at: AT, pages: [observation({ screenshotMissingBecause: "no PNG came back" })] });
    expect(gaps[0]!.condition).toBe("browser-screenshot-missing");
  });

  it("carries the screenshot's own reason onto its gap", () => {
    const gaps = walkPageGaps({ at: AT, pages: [observation({ screenshotMissingBecause: "the disk is full" })] });
    expect(gaps[0]!.reason).toBe("the disk is full");
  });

  it("raises capture-incomplete for a page that was held but lost a response body", () => {
    const gaps = walkPageGaps({
      at: AT,
      pages: [
        observation({
          captureComplete: false,
          responseAccounting: { bodyFailed: 2, bodySucceeded: 10, eligible: 12, seen: 40 },
        }),
      ],
    });
    expect(gaps[0]!.condition).toBe("browser-capture-incomplete");
  });

  it("puts the lost-body counts on the incomplete gap, so the silence becomes a number", () => {
    const gaps = walkPageGaps({
      at: AT,
      pages: [
        observation({
          captureComplete: false,
          responseAccounting: { bodyFailed: 2, bodySucceeded: 10, eligible: 12, seen: 40 },
        }),
      ],
    });
    expect(gaps[0]!.reason).toContain("2 of 12 eligible response bodies were lost");
  });

  it("scopes each gap to the declared surface, so a page's own gap closes when that page succeeds", () => {
    const gaps = walkPageGaps({ at: AT, pages: [observation({ unreachableBecause: "timed out" })] });
    expect(gaps[0]!.scope).toBe("account-profile");
  });

  it("names the browser as the only surface a page gap concerns", () => {
    const gaps = walkPageGaps({ at: AT, pages: [observation({ unreachableBecause: "timed out" })] });
    expect(gaps[0]!.surfaces).toEqual(["browser"]);
  });
});

describe("inventoryGap", () => {
  it("files under the inventory scope, which no page can ever close", () => {
    expect(inventoryGap({ at: AT }).scope).toBe(NOTION_INVENTORY_SCOPE);
  });

  it("opens rather than closes, because Notion publishes no manifest to check against", () => {
    expect(inventoryGap({ at: AT }).status).toBe("open");
  });

  it("says how many routes the hand-declared denominator holds", () => {
    expect(inventoryGap({ at: AT }).reason).toContain("hand-declared route(s) in browserPages.ts");
  });
});

describe("walkRechecks", () => {
  it("rechecks nothing for a page the walk never attempted", () => {
    expect(walkRechecks({ pages: [observation({ attempted: false })] })).toEqual([]);
  });

  it("resolves every condition for a page that came back clean", () => {
    const rechecks = walkRechecks({ pages: [observation()] });
    expect(rechecks.filter((recheck) => !recheck.resolved)).toEqual([]);
  });

  it("leaves the one condition a page still raises unresolved", () => {
    const rechecks = walkRechecks({ pages: [observation({ screenshotMissingBecause: "no PNG came back" })] });
    expect(rechecks.filter((recheck) => !recheck.resolved).map((recheck) => recheck.condition)).toEqual([
      "browser-screenshot-missing",
    ]);
  });

  it("scopes every recheck to the page's own surface", () => {
    const rechecks = walkRechecks({ pages: [observation()] });
    expect(new Set(rechecks.map((recheck) => recheck.scope))).toEqual(new Set(["account-profile"]));
  });
});
