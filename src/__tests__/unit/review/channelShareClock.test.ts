/*
 * The share state's clock on its own: each horizon in words, and one colour per way the clock can be read, over
 * a real post instant.
 */
import { describe, expect, it } from "vitest";

import {
  clockOf,
  type Horizons,
  minuteOf,
  RED_AFTER_BUSINESS_DAYS,
  seenOf,
} from "../../../review/channelShareClock.js";

/** An #dev-team post instant, a Sunday night in Melbourne. */
const POSTED = "2026-09-27T11:30:21.000Z";

/** Both absences carried through one instant. */
function caughtUp({ iso }: { iso: string }): Horizons {
  return { asks: { throughIso: iso }, replies: { throughIso: iso } };
}

describe("minuteOf", () => {
  it("prints an instant as the rows do, to the minute", () => {
    expect(minuteOf({ iso: "2026-09-27T15:19:42.000Z" })).toBe("2026-09-27 15:19Z");
  });
});

describe("seenOf", () => {
  it("names where each carrier stops, and why one carries nothing", () => {
    const horizons: Horizons = {
      asks: { throughIso: "2026-09-27T15:19:00.000Z" },
      replies: { missing: "the thread under the post in #dev-team was not read", throughIso: undefined },
    };
    expect(seenOf({ horizons })).toBe(
      "asks seen through 2026-09-27 15:19Z (the Slack corpus), replies unproven — the thread under the post in #dev-team was not read",
    );
  });
});

describe("clockOf", () => {
  it("reads YELLOW, no engagement, a business day after the post with both horizons caught up", () => {
    const nowIso = "2026-09-28T16:00:00.000Z";
    const clock = clockOf({
      horizons: caughtUp({ iso: nowIso }),
      lastReplyAtIso: undefined,
      nowIso,
      postedAtIso: POSTED,
    })!;
    expect([clock.tone, clock.badge, clock.asOfIso]).toEqual(["yellow", "no engagement", nowIso]);
    expect(clock.why).toBe("no reply in 1.1 business days since the post");
  });

  it(`reads RED after ${String(RED_AFTER_BUSINESS_DAYS)} business days with no reviewer`, () => {
    const nowIso = "2026-09-30T14:30:00.000Z";
    const clock = clockOf({
      horizons: caughtUp({ iso: nowIso }),
      lastReplyAtIso: undefined,
      nowIso,
      postedAtIso: POSTED,
    })!;
    expect([clock.tone, clock.badge, clock.sincePost]).toEqual(["red", "no reviewer — name one", 3]);
  });

  it("reads UNKNOWN past the first business day when the ask absence is carried by nothing, as of the post", () => {
    const nowIso = "2026-09-30T14:30:00.000Z";
    const horizons: Horizons = {
      asks: { missing: "the Slack corpus was never ingested", throughIso: undefined },
      replies: { throughIso: nowIso },
    };
    const clock = clockOf({ horizons, lastReplyAtIso: undefined, nowIso, postedAtIso: POSTED })!;
    expect([clock.tone, clock.badge, clock.asOfIso]).toEqual(["unknown", "clock not known", POSTED]);
    expect(clock.why).toBe(
      "3 business days since the post, and the Slack corpus was never ingested, so an ask since may not be seen — sync Slack",
    );
  });
});
