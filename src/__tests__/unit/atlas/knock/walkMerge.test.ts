/**
 * The regression that made `staleAbsent` a parameter, and the two-channel independence it protects.
 *
 * MEASURED: a dashboard walk lost its session on the FIRST page and attempted no other. Every
 * other declared page was therefore absent from its observations, and the merge marked every one of them
 * stale although an earlier walk had genuinely reached and photographed them.
 */
import { describe, expect, it } from "vitest";

import { foldKnockChannel, mergeKnockChannel, staleKnockChannel } from "../../../../atlas/knock/merge.js";
import type { KnockEntity } from "../../../../atlas/knock/model.js";
import { unwrap } from "../../../../lib/result.js";

const AT = "2026-09-07T00:00:00.000Z";

/** One entity with a filled channel, so a fold and a stale have something to act on. */
function entity({
  id,
  channel,
  firstSeenAt = AT,
}: {
  id: string;
  channel: "api" | "browser";
  firstSeenAt?: string;
}): KnockEntity {
  const view = {
    channel,
    detail: null,
    firstSeenAt,
    lastSeenAt: AT,
    source: null,
    state: "observed" as const,
  };
  return {
    channels: { api: channel === "api" ? view : null, browser: channel === "browser" ? view : null },
    id,
    kind: "dashboard-route",
    providerId: id,
    scope: null,
  };
}

describe("mergeKnockChannel", () => {
  it("stales an absent entity when the run genuinely looked for it", () => {
    const merged = unwrap(
      mergeKnockChannel({
        at: AT,
        channel: "browser",
        observed: [],
        staleAbsent: true,
        stored: [entity({ channel: "browser", id: "a" })],
      }),
    );
    expect(merged[0]!.channels.browser!.state).toBe("stale");
  });

  it("leaves an absent entity exactly as it was when the run could not look", () => {
    const merged = unwrap(
      mergeKnockChannel({
        at: AT,
        channel: "browser",
        observed: [],
        staleAbsent: false,
        stored: [entity({ channel: "browser", id: "a" })],
      }),
    );
    expect(merged[0]!.channels.browser!.state).toBe("observed");
  });

  it("refreshes one channel and leaves the other channel's rows untouched", () => {
    const stored = entity({ channel: "api", id: "a" });
    const merged = unwrap(
      mergeKnockChannel({
        at: AT,
        channel: "browser",
        observed: [entity({ channel: "browser", id: "a" })],
        staleAbsent: true,
        stored: [stored],
      }),
    );
    expect(merged[0]!.channels.api!.state).toBe("observed");
    expect(merged[0]!.channels.browser!.state).toBe("observed");
  });
});

describe("foldKnockChannel", () => {
  it("carries firstSeenAt forward, so a page observed for weeks does not claim to be new", () => {
    const stored = entity({ channel: "browser", firstSeenAt: "2026-08-01T00:00:00.000Z", id: "a" });
    const folded = foldKnockChannel({ channel: "browser", observed: entity({ channel: "browser", id: "a" }), stored });
    expect(folded.channels.browser!.firstSeenAt).toBe("2026-08-01T00:00:00.000Z");
  });

  it("keeps the stored channel when this run observed nothing for it", () => {
    const stored = entity({ channel: "browser", id: "a" });
    const observed: KnockEntity = { ...stored, channels: { api: null, browser: null } };
    expect(foldKnockChannel({ channel: "browser", observed, stored }).channels.browser).not.toBe(null);
  });
});

describe("staleKnockChannel", () => {
  it("answers null for a channel that has never looked, so nothing is written", () => {
    expect(staleKnockChannel({ channel: "browser", stored: entity({ channel: "api", id: "a" }) })).toBe(null);
  });

  it("answers null for a channel already stale, so a rerun writes nothing", () => {
    const stored = entity({ channel: "browser", id: "a" });
    const staled = staleKnockChannel({ channel: "browser", stored })!;
    expect(staleKnockChannel({ channel: "browser", stored: staled })).toBe(null);
  });
});
