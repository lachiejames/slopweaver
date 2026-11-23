import { describe, expect, it } from "vitest";

import { foldClerkChannel, mergeClerkChannel, staleClerkChannel } from "../../../../atlas/clerk/merge.js";
import { CLERK_CHANNELS, type ClerkAtlasEntity, type ClerkChannel } from "../../../../atlas/clerk/model.js";
import { unwrap, unwrapErr } from "../../../../lib/result.js";

const FIRST = "2026-08-01T00:00:00.000Z";
const SECOND = "2026-09-01T00:00:00.000Z";
const AT = "2026-10-01T00:00:00.000Z";

type Slot = ClerkAtlasEntity["channels"]["compiled"];

function slot({
  channel,
  detail,
  firstSeenAt,
  lastSeenAt,
  state,
}: {
  channel: "compiled" | "api" | "browser";
  detail: string;
  firstSeenAt: string;
  lastSeenAt: string;
  state: "observed" | "stale";
}): NonNullable<Slot> {
  return { channel, detail, firstSeenAt, lastSeenAt, source: null, state };
}

function entity({ id, channels }: { id: string; channels: ClerkAtlasEntity["channels"] }): ClerkAtlasEntity {
  return { channels, id, kind: "operation", providerId: `GET bapi:/v1/${id}` };
}

const storedCompiled = slot({
  channel: "compiled",
  detail: "stored-compiled",
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
const storedApi = slot({
  channel: "api",
  detail: "stored-api",
  firstSeenAt: FIRST,
  lastSeenAt: SECOND,
  state: "observed",
});
const freshCompiled = slot({
  channel: "compiled",
  detail: "fresh-compiled",
  firstSeenAt: AT,
  lastSeenAt: AT,
  state: "observed",
});
const freshApi = slot({ channel: "api", detail: "fresh-api", firstSeenAt: AT, lastSeenAt: AT, state: "observed" });
const freshBrowser = slot({
  channel: "browser",
  detail: "fresh-browser",
  firstSeenAt: AT,
  lastSeenAt: AT,
  state: "observed",
});

/** A stored entity's channels with every slot populated, each first seen at FIRST. */
const STORED_CHANNELS: Record<ClerkChannel, NonNullable<Slot>> = {
  api: storedApi,
  browser: storedBrowser,
  compiled: storedCompiled,
};
/** The one fresh slot a run on each channel observes. */
const FRESH_SLOTS: Record<ClerkChannel, NonNullable<Slot>> = {
  api: freshApi,
  browser: freshBrowser,
  compiled: freshCompiled,
};
const NO_CHANNELS: ClerkAtlasEntity["channels"] = { api: null, browser: null, compiled: null };

describe("foldClerkChannel", () => {
  it("replaces the refreshed compiled channel, keeps its stored firstSeenAt, and carries the stored browser channel", () => {
    const stored = entity({ channels: { api: null, browser: storedBrowser, compiled: storedCompiled }, id: "users" });
    const observed = entity({ channels: { api: null, browser: null, compiled: freshCompiled }, id: "users" });
    expect(foldClerkChannel({ channel: "compiled", observed, stored })).toEqual(
      entity({
        channels: {
          api: null,
          browser: storedBrowser,
          compiled: { ...freshCompiled, firstSeenAt: FIRST },
        },
        id: "users",
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
    const stored = entity({ channels: { api: null, browser: storedBrowser, compiled: storedCompiled }, id: "users" });
    const observed = entity({ channels: { api: null, browser: stray, compiled: freshCompiled }, id: "users" });
    expect(foldClerkChannel({ channel: "compiled", observed, stored })).toEqual(
      entity({
        channels: { api: null, browser: storedBrowser, compiled: { ...freshCompiled, firstSeenAt: FIRST } },
        id: "users",
      }),
    );
  });

  it("keeps the observed firstSeenAt and channel map for an entity with no stored predecessor", () => {
    const observed = entity({ channels: { api: null, browser: null, compiled: freshCompiled }, id: "users" });
    expect(foldClerkChannel({ channel: "compiled", observed, stored: undefined })).toEqual(observed);
  });

  it("keeps the fresh firstSeenAt when the stored row never held the refreshed channel", () => {
    const stored = entity({ channels: { api: null, browser: storedBrowser, compiled: null }, id: "users" });
    const observed = entity({ channels: { api: null, browser: null, compiled: freshCompiled }, id: "users" });
    expect(foldClerkChannel({ channel: "compiled", observed, stored })).toEqual(
      entity({ channels: { api: null, browser: storedBrowser, compiled: freshCompiled }, id: "users" }),
    );
  });

  it("retains the stored slot exactly when the observed row carries nothing on the refreshed channel", () => {
    const stored = entity({ channels: { api: null, browser: storedBrowser, compiled: storedCompiled }, id: "users" });
    const observed = entity({ channels: { api: null, browser: null, compiled: null }, id: "users" });
    expect(foldClerkChannel({ channel: "compiled", observed, stored })).toEqual(stored);
  });

  it("refreshes the browser channel without touching the stored compiled channel", () => {
    const stored = entity({ channels: { api: null, browser: storedBrowser, compiled: storedCompiled }, id: "users" });
    const observed = entity({ channels: { api: null, browser: freshBrowser, compiled: null }, id: "users" });
    expect(foldClerkChannel({ channel: "browser", observed, stored })).toEqual(
      entity({
        channels: { api: null, browser: { ...freshBrowser, firstSeenAt: FIRST }, compiled: storedCompiled },
        id: "users",
      }),
    );
  });
});

describe("staleClerkChannel", () => {
  it("marks only the refreshed channel stale and leaves every other field and channel exact", () => {
    const stored = entity({ channels: { api: null, browser: storedBrowser, compiled: storedCompiled }, id: "users" });
    expect(staleClerkChannel({ channel: "compiled", stored })).toEqual(
      entity({
        channels: { api: null, browser: storedBrowser, compiled: { ...storedCompiled, state: "stale" } },
        id: "users",
      }),
    );
  });

  it("returns null when the refreshed channel was never populated", () => {
    const stored = entity({ channels: { api: null, browser: storedBrowser, compiled: null }, id: "users" });
    expect(staleClerkChannel({ channel: "compiled", stored })).toBeNull();
  });

  it("returns null when the refreshed channel is already stale", () => {
    const stored = entity({
      channels: { api: null, browser: null, compiled: { ...storedCompiled, state: "stale" } },
      id: "users",
    });
    expect(staleClerkChannel({ channel: "compiled", stored })).toBeNull();
  });
});

describe("mergeClerkChannel", () => {
  it("folds the observed row, stales only the compiled channel of the absent stored row, and sorts by id", () => {
    const absent = entity({
      channels: { api: null, browser: storedBrowser, compiled: storedCompiled },
      id: "a-absent",
    });
    const heldObserved = entity({
      channels: { api: null, browser: storedBrowser, compiled: storedCompiled },
      id: "b-seen",
    });
    const observed = entity({ channels: { api: null, browser: null, compiled: freshCompiled }, id: "b-seen" });
    const merged = unwrap(
      mergeClerkChannel({ at: AT, channel: "compiled", observed: [observed], stored: [heldObserved, absent] }),
    );
    expect(merged).toEqual([
      entity({
        channels: { api: null, browser: storedBrowser, compiled: { ...storedCompiled, state: "stale" } },
        id: "a-absent",
      }),
      entity({
        channels: { api: null, browser: storedBrowser, compiled: { ...freshCompiled, firstSeenAt: FIRST } },
        id: "b-seen",
      }),
    ]);
  });

  it("accepts exactly the channels the per-channel fixtures cover", () => {
    expect([...CLERK_CHANNELS]).toEqual(["compiled", "api", "browser"]);
  });

  it.each(CLERK_CHANNELS)(
    "driven on the %s channel: refreshes the observed row, keeps its stored firstSeenAt, stales the absent row's slot, leaves every other slot as stored",
    (channel) => {
      const seen = entity({ channels: STORED_CHANNELS, id: "b-seen" });
      const absent = entity({ channels: STORED_CHANNELS, id: "a-absent" });
      const observed = entity({ channels: { ...NO_CHANNELS, [channel]: FRESH_SLOTS[channel] }, id: "b-seen" });
      const merged = unwrap(mergeClerkChannel({ at: AT, channel, observed: [observed], stored: [seen, absent] }));
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
    const observed = entity({ channels: { api: null, browser: null, compiled: freshCompiled }, id: "fresh" });
    const merged = unwrap(
      mergeClerkChannel({ at: "2026-12-31T00:00:00.000Z", channel: "compiled", observed: [observed], stored: [] }),
    );
    expect(merged).toEqual([observed]);
  });

  it("leaves a stored entity untouched when it was not observed and its compiled channel was never populated", () => {
    const browserOnly = entity({ channels: { api: null, browser: storedBrowser, compiled: null }, id: "dash" });
    const merged = unwrap(mergeClerkChannel({ at: AT, channel: "compiled", observed: [], stored: [browserOnly] }));
    expect(merged).toEqual([browserOnly]);
  });

  it("refuses an observed generation that names one id twice", () => {
    const observed = entity({ channels: { api: null, browser: null, compiled: freshCompiled }, id: "twice" });
    const lines = unwrapErr(
      mergeClerkChannel({ at: AT, channel: "compiled", observed: [observed, observed], stored: [] }),
    );
    expect(lines).toEqual([
      "this run produced the same entity id twice: twice",
      "refusing to merge — one read producing two records for one thing is how a count double-counts",
    ]);
  });

  it("returns an empty list for an empty stored and an empty observed generation", () => {
    expect(unwrap(mergeClerkChannel({ at: AT, channel: "compiled", observed: [], stored: [] }))).toEqual([]);
  });
});
