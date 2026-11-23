/**
 * The channel-scoped merge, which is what stops the two surfaces staling each other.
 *
 * A kind-scoped merge would let a sync blank every operation the walk found and a walk blank every operation
 * the SDK declares — and since the disjointness between those two sets is this atlas's whole corroboration
 * output, that would destroy exactly the finding.
 */
import { describe, expect, it } from "vitest";

import { foldXeroChannel, mergeXeroChannel, staleXeroChannel } from "../../../../atlas/xero/merge.js";
import type { XeroAtlasEntity, XeroChannelEntity } from "../../../../atlas/xero/model.js";
import { unwrap, unwrapErr } from "../../../../lib/result.js";

const AT = "2026-09-05T00:00:00.000Z";
const EARLIER = "2026-09-01T00:00:00.000Z";

/** One channel's view, with only the fields a test is about stated. */
function channel({ over }: { over: Partial<XeroChannelEntity> }): XeroChannelEntity {
  return {
    channel: "api",
    detail: { note: "api" },
    firstSeenAt: AT,
    lastSeenAt: AT,
    source: null,
    state: "observed",
    ...over,
  };
}

/** One entity, with only the channels a test is about stated. */
function entity({
  over,
  channels,
}: {
  over?: Partial<XeroAtlasEntity>;
  channels?: Partial<XeroAtlasEntity["channels"]>;
} = {}): XeroAtlasEntity {
  return {
    channels: { api: null, browser: null, ...channels },
    id: "one",
    kind: "method",
    providerId: "GET api.xero.com/api.xro/2.0/Invoices",
    ...over,
  };
}

describe("foldXeroChannel", () => {
  it("replaces only the channel this run refreshed", () => {
    const stored = entity({
      channels: { browser: channel({ over: { channel: "browser", detail: { note: "walk" } } }) },
    });
    const observed = entity({ channels: { api: channel({ over: {} }) } });
    expect(foldXeroChannel({ channel: "api", observed, stored }).channels.browser?.detail).toEqual({ note: "walk" });
  });

  it("carries firstSeenAt forward, so a long-known entity does not claim to be new", () => {
    const stored = entity({ channels: { api: channel({ over: { firstSeenAt: EARLIER } }) } });
    const observed = entity({ channels: { api: channel({ over: {} }) } });
    expect(foldXeroChannel({ channel: "api", observed, stored }).channels.api?.firstSeenAt).toBe(EARLIER);
  });

  it("keeps this run's firstSeenAt when the stored entity never held this channel", () => {
    const stored = entity({ channels: { browser: channel({ over: { channel: "browser", firstSeenAt: EARLIER } }) } });
    const observed = entity({ channels: { api: channel({ over: {} }) } });
    expect(foldXeroChannel({ channel: "api", observed, stored }).channels.api!.firstSeenAt).toBe(AT);
  });

  it("takes this run's channel whole for an entity the store never held", () => {
    const observed = entity({ channels: { api: channel({ over: {} }) } });
    expect(foldXeroChannel({ channel: "api", observed, stored: undefined })).toStrictEqual(observed);
  });

  it("keeps the stored channel when this run observed nothing for it", () => {
    const stored = entity({ channels: { api: channel({ over: { detail: { note: "old" } } }) } });
    const observed = entity({ channels: { api: null } });
    expect(foldXeroChannel({ channel: "api", observed, stored }).channels.api?.detail).toEqual({ note: "old" });
  });
});

describe("staleXeroChannel", () => {
  it("marks a channel stale when this run refreshed it and did not see the entity", () => {
    const stored = entity({ channels: { api: channel({ over: {} }) } });
    expect(staleXeroChannel({ channel: "api", stored })?.channels.api?.state).toBe("stale");
  });

  it("leaves an already-stale channel exactly as it is", () => {
    const stored = entity({ channels: { api: channel({ over: { state: "stale" } }) } });
    expect(staleXeroChannel({ channel: "api", stored })).toBe(null);
  });

  it("leaves a channel that never looked alone", () => {
    expect(staleXeroChannel({ channel: "browser", stored: entity() })).toBe(null);
  });
});

describe("mergeXeroChannel", () => {
  it("refuses a run that produced the same entity id twice, because that is how a count double-counts", () => {
    const merged = mergeXeroChannel({ at: AT, channel: "api", observed: [entity(), entity()], stored: [] });
    expect(unwrapErr(merged)).toEqual([
      "this run produced the same entity id twice: one",
      "refusing to merge — one read producing two records for one thing is how a count double-counts",
    ]);
  });

  it("sorts the merged list by id, so a published file is stable", () => {
    const merged = mergeXeroChannel({
      at: AT,
      channel: "api",
      observed: [entity({ over: { id: "b" } }), entity({ over: { id: "a" } })],
      stored: [],
    });
    expect(unwrap(merged).map((one) => one.id)).toEqual(["a", "b"]);
  });

  it("stales a stored entity this run's channel did not observe", () => {
    const stored = [entity({ channels: { api: channel({ over: {} }) }, over: { id: "gone" } })];
    const merged = unwrap(mergeXeroChannel({ at: AT, channel: "api", observed: [], stored }));
    expect(merged[0]!.channels.api?.state).toBe("stale");
  });

  // The property the whole two-writer design rests on.
  it("does not stale the OTHER channel of an entity this run's channel did not observe", () => {
    const stored = [
      entity({
        channels: { api: channel({ over: {} }), browser: channel({ over: { channel: "browser" } }) },
        over: { id: "gone" },
      }),
    ];
    const merged = unwrap(mergeXeroChannel({ at: AT, channel: "api", observed: [], stored }));
    expect(merged[0]!.channels.browser?.state).toBe("observed");
  });
});
