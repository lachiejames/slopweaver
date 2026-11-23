import { describe, expect, it } from "vitest";

import { foldBrazeChannel, mergeBrazeChannel, staleBrazeChannel } from "../../../../atlas/braze/merge.js";
import type { BrazeAtlasEntity, BrazeChannelEntity } from "../../../../atlas/braze/model.js";
import { unwrap } from "../../../../lib/result.js";

const AT = "2026-09-05T00:00:00.000Z";
const EARLIER = "2026-08-01T00:00:00.000Z";

/** One channel's view, varied per test. */
function channel({ name, seen }: { name: "docs" | "collection"; seen: string }): BrazeChannelEntity {
  return {
    channel: name,
    detail: { note: name },
    firstSeenAt: seen,
    lastSeenAt: seen,
    source: null,
    state: "observed",
  };
}

/** One entity carrying only the named channel. */
function entity({ id, only, seen }: { id: string; only: "docs" | "collection"; seen: string }): BrazeAtlasEntity {
  return {
    channels: {
      api: null,
      browser: null,
      collection: only === "collection" ? channel({ name: "collection", seen }) : null,
      docs: only === "docs" ? channel({ name: "docs", seen }) : null,
    },
    id,
    kind: "export",
    providerId: `GET /${id}`,
  };
}

describe("foldBrazeChannel", () => {
  it("carries firstSeenAt forward, so a long-known operation does not claim to be new", () => {
    const stored = entity({ id: "a", only: "docs", seen: EARLIER });
    const folded = foldBrazeChannel({ channel: "docs", observed: entity({ id: "a", only: "docs", seen: AT }), stored });
    expect(folded.channels.docs?.firstSeenAt).toBe(EARLIER);
    expect(folded.channels.docs?.lastSeenAt).toBe(AT);
  });

  it("leaves the other channels exactly as the store held them", () => {
    const stored: BrazeAtlasEntity = {
      ...entity({ id: "a", only: "docs", seen: EARLIER }),
      channels: {
        api: null,
        browser: null,
        collection: channel({ name: "collection", seen: EARLIER }),
        docs: channel({ name: "docs", seen: EARLIER }),
      },
    };
    const folded = foldBrazeChannel({ channel: "docs", observed: entity({ id: "a", only: "docs", seen: AT }), stored });
    expect(folded.channels.collection?.lastSeenAt).toBe(EARLIER);
    expect(folded.channels.collection?.state).toBe("observed");
  });

  it("takes an operation no earlier run mapped exactly as this run saw it", () => {
    const observed = entity({ id: "a", only: "docs", seen: AT });
    expect(foldBrazeChannel({ channel: "docs", observed, stored: undefined })).toEqual(observed);
  });

  it("dates a channel's first view from this run when the stored entity held nothing through it", () => {
    const stored = entity({ id: "a", only: "docs", seen: EARLIER });
    const folded = foldBrazeChannel({
      channel: "collection",
      observed: entity({ id: "a", only: "collection", seen: AT }),
      stored,
    });
    expect(folded.channels.collection).toEqual(channel({ name: "collection", seen: AT }));
    expect(folded.channels.docs).toEqual(channel({ name: "docs", seen: EARLIER }));
  });

  it("keeps the stored view of the refreshed channel when this run's entity carries none", () => {
    const stored = entity({ id: "a", only: "collection", seen: EARLIER });
    const folded = foldBrazeChannel({
      channel: "collection",
      observed: entity({ id: "a", only: "docs", seen: AT }),
      stored,
    });
    expect(folded.channels.collection).toEqual(channel({ name: "collection", seen: EARLIER }));
  });
});

describe("staleBrazeChannel", () => {
  it("stales a channel this run refreshed and did not see", () => {
    const stored = entity({ id: "a", only: "docs", seen: EARLIER });
    expect(staleBrazeChannel({ channel: "docs", stored })?.channels.docs?.state).toBe("stale");
  });

  it("leaves an entity alone when the refreshed channel never looked at it", () => {
    const stored = entity({ id: "a", only: "docs", seen: EARLIER });
    expect(staleBrazeChannel({ channel: "collection", stored })).toBe(null);
  });
});

describe("mergeBrazeChannel", () => {
  it("adds an operation only the collection has without disturbing the reference's rows", () => {
    const stored = [entity({ id: "a", only: "docs", seen: EARLIER })];
    const merged = unwrap(
      mergeBrazeChannel({
        at: AT,
        channel: "collection",
        observed: [entity({ id: "b", only: "collection", seen: AT })],
        stored,
      }),
    );
    expect(merged.length).toBe(2);
    expect(merged.find((held) => held.id === "a")?.channels.docs?.state).toBe("observed");
    expect(merged.find((held) => held.id === "b")?.channels.collection?.state).toBe("observed");
  });

  it("stales only the refreshed channel of an entity this run did not see", () => {
    const stored: BrazeAtlasEntity[] = [
      {
        ...entity({ id: "a", only: "docs", seen: EARLIER }),
        channels: {
          api: null,
          browser: null,
          collection: channel({ name: "collection", seen: EARLIER }),
          docs: channel({ name: "docs", seen: EARLIER }),
        },
      },
    ];
    const merged = unwrap(mergeBrazeChannel({ at: AT, channel: "collection", observed: [], stored }));
    expect(merged[0]?.channels.collection?.state).toBe("stale");
    expect(merged[0]?.channels.docs?.state).toBe("observed");
  });
});
