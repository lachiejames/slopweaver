import { describe, expect, it } from "vitest";

import { foldHexChannel, mergeHexChannel, staleHexChannel } from "../../../../atlas/hex/merge.js";
import { HEX_ATLAS_CHANNELS, type HexAtlasChannel, type HexAtlasEntity } from "../../../../atlas/hex/model.js";
import { unwrap, unwrapErr } from "../../../../lib/result.js";

const FIRST = "2026-08-01T00:00:00.000Z";
const SECOND = "2026-09-01T00:00:00.000Z";
const AT = "2026-10-01T00:00:00.000Z";

type Slot = HexAtlasEntity["channels"]["api"];

function slot({
  channel,
  detail,
  firstSeenAt,
  lastSeenAt,
  state,
}: {
  channel: "api" | "browser";
  detail: string;
  firstSeenAt: string;
  lastSeenAt: string;
  state: "observed" | "stale";
}): NonNullable<Slot> {
  return { channel, detail, firstSeenAt, lastSeenAt, source: null, state };
}

function entity({ id, channels }: { id: string; channels: HexAtlasEntity["channels"] }): HexAtlasEntity {
  return { channels, id, kind: "method", providerId: `GET /v1/${id}` };
}

const storedApi = slot({
  channel: "api",
  detail: "stored-api",
  firstSeenAt: FIRST,
  lastSeenAt: FIRST,
  state: "observed",
});
const storedBrowser = slot({
  channel: "browser",
  detail: "stored-browser",
  firstSeenAt: FIRST,
  lastSeenAt: SECOND,
  state: "observed",
});
const freshApi = slot({
  channel: "api",
  detail: "fresh-api",
  firstSeenAt: AT,
  lastSeenAt: AT,
  state: "observed",
});
const freshBrowser = slot({
  channel: "browser",
  detail: "fresh-browser",
  firstSeenAt: AT,
  lastSeenAt: AT,
  state: "observed",
});

/** A stored entity's channels with every slot populated, each first seen at FIRST. */
const STORED_CHANNELS: Record<HexAtlasChannel, NonNullable<Slot>> = { api: storedApi, browser: storedBrowser };
/** The one fresh slot a run on each channel observes. */
const FRESH_SLOTS: Record<HexAtlasChannel, NonNullable<Slot>> = { api: freshApi, browser: freshBrowser };
const NO_CHANNELS: HexAtlasEntity["channels"] = { api: null, browser: null };

describe("foldHexChannel", () => {
  it("replaces the refreshed api channel, keeps its stored firstSeenAt, and carries the stored browser channel", () => {
    const stored = entity({ channels: { api: storedApi, browser: storedBrowser }, id: "projects" });
    const observed = entity({ channels: { api: freshApi, browser: null }, id: "projects" });
    expect(foldHexChannel({ channel: "api", observed, stored })).toEqual(
      entity({
        channels: { api: { ...freshApi, firstSeenAt: FIRST }, browser: storedBrowser },
        id: "projects",
      }),
    );
  });

  it("ignores a browser channel the observed row happens to carry when a stored row exists", () => {
    const stray = slot({
      channel: "browser",
      detail: "observed-stray-browser",
      firstSeenAt: AT,
      lastSeenAt: AT,
      state: "observed",
    });
    const stored = entity({ channels: { api: storedApi, browser: storedBrowser }, id: "projects" });
    const observed = entity({ channels: { api: freshApi, browser: stray }, id: "projects" });
    expect(foldHexChannel({ channel: "api", observed, stored })).toEqual(
      entity({ channels: { api: { ...freshApi, firstSeenAt: FIRST }, browser: storedBrowser }, id: "projects" }),
    );
  });

  it("keeps the observed firstSeenAt and channel map for an entity with no stored predecessor", () => {
    const observed = entity({ channels: { api: freshApi, browser: null }, id: "projects" });
    expect(foldHexChannel({ channel: "api", observed, stored: undefined })).toEqual(observed);
  });

  it("retains the stored slot exactly when the observed row carries nothing on the refreshed channel", () => {
    const stored = entity({ channels: { api: storedApi, browser: storedBrowser }, id: "projects" });
    const observed = entity({ channels: { api: null, browser: null }, id: "projects" });
    expect(foldHexChannel({ channel: "api", observed, stored })).toEqual(stored);
  });

  it("refreshes the browser channel without touching the stored api channel", () => {
    const stored = entity({ channels: { api: storedApi, browser: storedBrowser }, id: "projects" });
    const observed = entity({ channels: { api: null, browser: freshBrowser }, id: "projects" });
    expect(foldHexChannel({ channel: "browser", observed, stored })).toEqual(
      entity({ channels: { api: storedApi, browser: { ...freshBrowser, firstSeenAt: FIRST } }, id: "projects" }),
    );
  });
});

describe("staleHexChannel", () => {
  it("marks only the refreshed channel stale and leaves every other field and channel exact", () => {
    const stored = entity({ channels: { api: storedApi, browser: storedBrowser }, id: "projects" });
    expect(staleHexChannel({ channel: "api", stored })).toEqual(
      entity({ channels: { api: { ...storedApi, state: "stale" }, browser: storedBrowser }, id: "projects" }),
    );
  });

  it("returns null when the refreshed channel was never populated", () => {
    const stored = entity({ channels: { api: null, browser: storedBrowser }, id: "projects" });
    expect(staleHexChannel({ channel: "api", stored })).toBeNull();
  });

  it("returns null when the refreshed channel is already stale", () => {
    const stored = entity({ channels: { api: { ...storedApi, state: "stale" }, browser: null }, id: "projects" });
    expect(staleHexChannel({ channel: "api", stored })).toBeNull();
  });
});

describe("mergeHexChannel", () => {
  it("folds the observed row, stales only the api channel of the absent stored row, and sorts by id", () => {
    const absent = entity({ channels: { api: storedApi, browser: storedBrowser }, id: "a-absent" });
    const heldObserved = entity({ channels: { api: storedApi, browser: storedBrowser }, id: "b-seen" });
    const observed = entity({ channels: { api: freshApi, browser: null }, id: "b-seen" });
    const merged = unwrap(
      mergeHexChannel({ at: AT, channel: "api", observed: [observed], stored: [heldObserved, absent] }),
    );
    expect(merged).toEqual([
      entity({ channels: { api: { ...storedApi, state: "stale" }, browser: storedBrowser }, id: "a-absent" }),
      entity({ channels: { api: { ...freshApi, firstSeenAt: FIRST }, browser: storedBrowser }, id: "b-seen" }),
    ]);
  });

  it("accepts exactly the channels the per-channel fixtures cover", () => {
    expect([...HEX_ATLAS_CHANNELS]).toEqual(["api", "browser"]);
  });

  it.each(HEX_ATLAS_CHANNELS)(
    "driven on the %s channel: refreshes the observed row, keeps its stored firstSeenAt, stales the absent row's slot, leaves every other slot as stored",
    (channel) => {
      const seen = entity({ channels: STORED_CHANNELS, id: "b-seen" });
      const absent = entity({ channels: STORED_CHANNELS, id: "a-absent" });
      const observed = entity({ channels: { ...NO_CHANNELS, [channel]: FRESH_SLOTS[channel] }, id: "b-seen" });
      const merged = unwrap(mergeHexChannel({ at: AT, channel, observed: [observed], stored: [seen, absent] }));
      expect(merged).toEqual([
        entity({
          channels: { ...STORED_CHANNELS, [channel]: { ...STORED_CHANNELS[channel], state: "stale" } },
          id: "a-absent",
        }),
        entity({
          channels: { ...STORED_CHANNELS, [channel]: { ...FRESH_SLOTS[channel], firstSeenAt: FIRST } },
          id: "b-seen",
        }),
      ]);
    },
  );

  it("stamps a brand new entity with its own firstSeenAt, never the run's at", () => {
    const observed = entity({ channels: { api: freshApi, browser: null }, id: "fresh" });
    const merged = unwrap(
      mergeHexChannel({ at: "2026-12-31T00:00:00.000Z", channel: "api", observed: [observed], stored: [] }),
    );
    expect(merged).toEqual([observed]);
  });

  it("leaves a stored entity untouched when it was not observed and its api channel was never populated", () => {
    const browserOnly = entity({ channels: { api: null, browser: storedBrowser }, id: "page" });
    const merged = unwrap(mergeHexChannel({ at: AT, channel: "api", observed: [], stored: [browserOnly] }));
    expect(merged).toEqual([browserOnly]);
  });

  it("refuses an observed generation that names one id twice", () => {
    const observed = entity({ channels: { api: freshApi, browser: null }, id: "twice" });
    const lines = unwrapErr(mergeHexChannel({ at: AT, channel: "api", observed: [observed, observed], stored: [] }));
    expect(lines).toEqual([
      "this run produced the same entity id twice: twice",
      "refusing to merge — one read producing two records for one thing is how a count double-counts",
    ]);
  });

  it("returns an empty list for an empty stored and an empty observed generation", () => {
    expect(unwrap(mergeHexChannel({ at: AT, channel: "api", observed: [], stored: [] }))).toEqual([]);
  });
});
