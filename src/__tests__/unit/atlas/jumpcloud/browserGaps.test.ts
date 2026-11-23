/**
 * The gaps a JumpCloud console walk raises: one per declared page it did not hold, the two standing ones,
 * and the rechecks that may close a page's old gap — none from a page the walk never attempted.
 */
import { describe, expect, it } from "vitest";

import {
  consolePageGaps,
  consoleRechecks,
  JUMPCLOUD_CONSOLE_INVENTORY_SCOPE,
  JUMPCLOUD_CONSOLE_VIEW_STATE_SCOPE,
  standingConsoleGaps,
} from "../../../../atlas/jumpcloud/browserGaps.js";
import type { JumpcloudPageObservation } from "../../../../atlas/jumpcloud/browserWalk.js";

const AT = "2026-09-25T00:00:00.000Z";

/** One observation of the users page, with only the fields a test is about stated. */
function observation({ over }: { over: Partial<JumpcloudPageObservation> }): JumpcloudPageObservation {
  return {
    artifacts: [],
    attempted: true,
    calls: [],
    captureComplete: true,
    finalUrl: "https://console.jumpcloud.com/#/users",
    observedAt: AT,
    redirected: false,
    requestedUrl: "https://console.jumpcloud.com/#/users",
    responseAccounting: { bodyFailed: 0, bodySucceeded: 0, eligible: 0, seen: 0 },
    screenshotMissingBecause: null,
    statusCode: 200,
    surface: "users",
    title: "JumpCloud Admin Portal",
    unreachableBecause: null,
    ...over,
  };
}

describe("consolePageGaps", () => {
  it("files a route the client sent elsewhere as not addressable, carrying the walk's own reason", () => {
    const gaps = consolePageGaps({
      at: AT,
      pages: [observation({ over: { redirected: true, unreachableBecause: "sent to #/home" } })],
    });
    expect(gaps.map((gap) => [gap.condition, gap.scope, gap.reason])).toEqual([
      ["browser-page-not-addressable", "users", "sent to #/home"],
    ]);
  });

  it("files a reached page with no picture as screenshot-missing", () => {
    expect(consolePageGaps({ at: AT, pages: [observation({ over: {} })] }).map((gap) => gap.condition)).toEqual([
      "browser-screenshot-missing",
    ]);
  });

  it("files a page the walk never got to as not attempted", () => {
    expect(
      consolePageGaps({ at: AT, pages: [observation({ over: { attempted: false } })] }).map((gap) => gap.condition),
    ).toEqual(["browser-page-not-attempted"]);
  });
});

describe("standingConsoleGaps", () => {
  it("says the hand-declared denominator and the unaddressable view state out loud on every walk", () => {
    expect(standingConsoleGaps({ at: AT }).map((gap) => gap.scope)).toEqual([
      JUMPCLOUD_CONSOLE_INVENTORY_SCOPE,
      JUMPCLOUD_CONSOLE_VIEW_STATE_SCOPE,
    ]);
  });
});

describe("consoleRechecks", () => {
  it("rechecks nothing for a page the walk never attempted", () => {
    expect(consoleRechecks({ pages: [observation({ over: { attempted: false } })] })).toEqual([]);
  });

  it("leaves the condition an attempted page still raises unresolved", () => {
    const rechecks = consoleRechecks({ pages: [observation({ over: {} })] });
    expect(rechecks.filter((recheck) => !recheck.resolved).map((recheck) => recheck.condition)).toEqual([
      "browser-screenshot-missing",
    ]);
  });
});
