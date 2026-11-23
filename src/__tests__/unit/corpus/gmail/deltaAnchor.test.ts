/**
 * Unit: the delta crawl's two anchors — the one Gmail RETURNED, which the walk stores, and the REQUESTED one,
 * whose expiry bounds the recovery window. Neither ever stands in for the other.
 */
import { describe, expect, it } from "vitest";

import { recoveryWindow } from "../../../../corpus/gmail/deltaAnchor.js";

describe("recoveryWindow", () => {
  const window = { since: "2026-08-28", until: "2026-08-29" };

  it("widens the window back to the day the expired anchor was taken", () => {
    const anchor = { anchoredAtIso: "2026-08-20T09:30:00.000Z", fullCrawl: true, historyId: "9903" };
    expect(recoveryWindow({ anchor, window })).toStrictEqual({ since: "2026-08-20", until: "2026-08-29" });
  });

  it("never narrows a planned window that already reaches further back", () => {
    const anchor = { anchoredAtIso: "2026-08-28T09:30:00.000Z", fullCrawl: true, historyId: "9903" };
    const wide = { since: "2026-08-01", until: "2026-08-29" };
    expect(recoveryWindow({ anchor, window: wide })).toStrictEqual(wide);
  });

  it("keeps the planned window for a legacy anchor that recorded no time", () => {
    const anchor = { anchoredAtIso: "", fullCrawl: false, historyId: "9903" };
    expect(recoveryWindow({ anchor, window })).toStrictEqual(window);
  });
});
