import { describe, expect, it } from "vitest";

import { foldNxCloudChannel, mergeNxCloudChannel, staleNxCloudChannel } from "../../../../atlas/nxCloud/merge.js";
import type { NxCloudAtlasEntity, NxCloudChannelEntity } from "../../../../atlas/nxCloud/model.js";
import { unwrap, unwrapErr } from "../../../../lib/result.js";

const FIRST = "2026-09-01T00:00:00.000Z";
const NOW = "2026-09-05T00:00:00.000Z";

/** One channel record, observed at the given instant. */
function channel({ at, detail }: { at: string; detail: unknown }): NxCloudChannelEntity {
  return { channel: "web-data", detail, firstSeenAt: at, lastSeenAt: at, source: null, state: "observed" };
}

/** One entity carrying whichever channels the caller supplies. */
function entity({
  id,
  web = null,
  browser = null,
}: {
  id: string;
  web?: NxCloudChannelEntity | null;
  browser?: NxCloudChannelEntity | null;
}): NxCloudAtlasEntity {
  return {
    channels: { browser, "web-data": web },
    id,
    kind: "endpoint",
    providerId: id,
    scope: "platform",
  };
}

describe("foldNxCloudChannel", () => {
  it("carries the original first-seen stamp forward, so an old entity does not claim to be new", () => {
    const stored = entity({ id: "a", web: channel({ at: FIRST, detail: { callCount: 1 } }) });
    const observed = entity({ id: "a", web: channel({ at: NOW, detail: { callCount: 2 } }) });
    const folded = foldNxCloudChannel({ channel: "web-data", observed, stored });
    expect(folded.channels["web-data"]!.firstSeenAt).toBe(FIRST);
  });

  it("replaces only the refreshed channel's detail", () => {
    const stored = entity({ browser: channel({ at: FIRST, detail: { callCount: 9 } }), id: "a" });
    const observed = entity({ id: "a", web: channel({ at: NOW, detail: { callCount: 1 } }) });
    const folded = foldNxCloudChannel({ channel: "web-data", observed, stored });
    expect(folded.channels.browser!.detail).toEqual({ callCount: 9 });
  });

  it("keeps the stored channel when this run observed nothing for it", () => {
    const stored = entity({ id: "a", web: channel({ at: FIRST, detail: { callCount: 9 } }) });
    const folded = foldNxCloudChannel({ channel: "web-data", observed: entity({ id: "a" }), stored });
    expect(folded.channels["web-data"]!.detail).toEqual({ callCount: 9 });
  });

  it("takes a brand new entity exactly as observed, its own first sighting included", () => {
    const observed = entity({ id: "a", web: channel({ at: NOW, detail: { callCount: 1 } }) });
    expect(foldNxCloudChannel({ channel: "web-data", observed, stored: undefined })).toEqual(observed);
  });

  it("keeps this run's first sighting on a stored entity whose refreshed channel never looked before", () => {
    const stored = entity({ browser: channel({ at: FIRST, detail: { callCount: 9 } }), id: "a" });
    const observed = entity({ id: "a", web: channel({ at: NOW, detail: { callCount: 1 } }) });
    const folded = foldNxCloudChannel({ channel: "web-data", observed, stored });
    expect(folded.channels["web-data"]).toEqual(channel({ at: NOW, detail: { callCount: 1 } }));
    expect(folded.channels.browser).toEqual(channel({ at: FIRST, detail: { callCount: 9 } }));
  });
});

describe("staleNxCloudChannel", () => {
  it("marks the refreshed channel stale when this run did not see the entity", () => {
    const stored = entity({ id: "a", web: channel({ at: FIRST, detail: {} }) });
    expect(staleNxCloudChannel({ channel: "web-data", stored })!.channels["web-data"]!.state).toBe("stale");
  });

  it("leaves an entity alone when the refreshed channel never held it", () => {
    expect(staleNxCloudChannel({ channel: "web-data", stored: entity({ id: "a" }) })).toBe(null);
  });

  it("leaves an already-stale channel exactly as it is", () => {
    const stale: NxCloudChannelEntity = { ...channel({ at: FIRST, detail: {} }), state: "stale" };
    expect(staleNxCloudChannel({ channel: "web-data", stored: entity({ id: "a", web: stale }) })).toBe(null);
  });
});

describe("mergeNxCloudChannel", () => {
  it("keeps an entity only the OTHER channel knows about, untouched", () => {
    const stored = [entity({ browser: channel({ at: FIRST, detail: { callCount: 3 } }), id: "b" })];
    const merged = unwrap(mergeNxCloudChannel({ at: NOW, channel: "web-data", observed: [], stored }));
    expect(merged[0]!.channels.browser!.state).toBe("observed");
  });

  it("stales an entity this channel used to hold and no longer sees", () => {
    const stored = [entity({ id: "a", web: channel({ at: FIRST, detail: {} }) })];
    const merged = unwrap(mergeNxCloudChannel({ at: NOW, channel: "web-data", observed: [], stored }));
    expect(merged[0]!.channels["web-data"]!.state).toBe("stale");
  });

  it("sorts by id, so two runs over the same data write identical bytes", () => {
    const observed = [
      entity({ id: "z", web: channel({ at: NOW, detail: {} }) }),
      entity({ id: "a", web: channel({ at: NOW, detail: {} }) }),
    ];
    const merged = unwrap(mergeNxCloudChannel({ at: NOW, channel: "web-data", observed, stored: [] }));
    expect(merged.map((row) => row.id)).toEqual(["a", "z"]);
  });

  it("refuses a run that produced the same entity twice, which is how a count double-counts", () => {
    const twice = [
      entity({ id: "a", web: channel({ at: NOW, detail: {} }) }),
      entity({ id: "a", web: channel({ at: NOW, detail: {} }) }),
    ];
    expect(unwrapErr(mergeNxCloudChannel({ at: NOW, channel: "web-data", observed: twice, stored: [] }))).toEqual([
      "this run produced the same entity id twice: a",
      "refusing to merge — one read producing two records for one thing is how a count double-counts",
    ]);
  });
});
