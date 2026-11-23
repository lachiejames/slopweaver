import { describe, expect, it } from "vitest";

import { foldTrelicaChannel, mergeTrelicaChannel, staleTrelicaChannel } from "../../../../atlas/trelica/merge.js";
import {
  TRELICA_ATLAS_CHANNELS,
  type TrelicaAtlasChannel,
  type TrelicaAtlasEntity,
} from "../../../../atlas/trelica/model.js";
import { unwrap, unwrapErr } from "../../../../lib/result.js";

const FIRST = "2026-08-01T00:00:00.000Z";
const SECOND = "2026-09-01T00:00:00.000Z";
const AT = "2026-10-01T00:00:00.000Z";

type Slot = TrelicaAtlasEntity["channels"]["published-api"];

function slot({
  channel,
  detail,
  firstSeenAt,
  lastSeenAt,
  state,
}: {
  channel: "published-api" | "first-party-api" | "browser";
  detail: string;
  firstSeenAt: string;
  lastSeenAt: string;
  state: "observed" | "stale";
}): NonNullable<Slot> {
  return { channel, detail, firstSeenAt, lastSeenAt, source: null, state };
}

function entity({ id, channels }: { id: string; channels: TrelicaAtlasEntity["channels"] }): TrelicaAtlasEntity {
  return { channels, id, kind: "method", providerId: `GET /v1/${id}` };
}

const storedPublished = slot({
  channel: "published-api",
  detail: "stored-published",
  firstSeenAt: FIRST,
  lastSeenAt: FIRST,
  state: "observed",
});
const storedFirstParty = slot({
  channel: "first-party-api",
  detail: "stored-first-party",
  firstSeenAt: FIRST,
  lastSeenAt: SECOND,
  state: "observed",
});
const storedBrowser = slot({
  channel: "browser",
  detail: "stored-browser",
  firstSeenAt: FIRST,
  lastSeenAt: SECOND,
  state: "observed",
});
const freshPublished = slot({
  channel: "published-api",
  detail: "fresh-published",
  firstSeenAt: AT,
  lastSeenAt: AT,
  state: "observed",
});
const freshFirstParty = slot({
  channel: "first-party-api",
  detail: "fresh-first-party",
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
const STORED_CHANNELS: Record<TrelicaAtlasChannel, NonNullable<Slot>> = {
  browser: storedBrowser,
  "first-party-api": storedFirstParty,
  "published-api": storedPublished,
};
/** The one fresh slot a run on each channel observes. */
const FRESH_SLOTS: Record<TrelicaAtlasChannel, NonNullable<Slot>> = {
  browser: freshBrowser,
  "first-party-api": freshFirstParty,
  "published-api": freshPublished,
};
const NO_CHANNELS: TrelicaAtlasEntity["channels"] = { browser: null, "first-party-api": null, "published-api": null };

describe("foldTrelicaChannel", () => {
  it("replaces the published-api channel, keeps its stored firstSeenAt, and carries first-party-api and browser", () => {
    const stored = entity({
      channels: { browser: storedBrowser, "first-party-api": storedFirstParty, "published-api": storedPublished },
      id: "apps",
    });
    const observed = entity({
      channels: { browser: null, "first-party-api": null, "published-api": freshPublished },
      id: "apps",
    });
    expect(foldTrelicaChannel({ channel: "published-api", observed, stored })).toEqual(
      entity({
        channels: {
          browser: storedBrowser,
          "first-party-api": storedFirstParty,
          "published-api": { ...freshPublished, firstSeenAt: FIRST },
        },
        id: "apps",
      }),
    );
  });

  it("ignores first-party-api and browser channels the observed row carries when a stored row exists", () => {
    const stray = slot({
      channel: "first-party-api",
      detail: "observed-stray-first-party",
      firstSeenAt: AT,
      lastSeenAt: AT,
      state: "observed",
    });
    const strayBrowser = slot({
      channel: "browser",
      detail: "observed-stray-browser",
      firstSeenAt: AT,
      lastSeenAt: AT,
      state: "observed",
    });
    const stored = entity({
      channels: { browser: storedBrowser, "first-party-api": storedFirstParty, "published-api": storedPublished },
      id: "apps",
    });
    const observed = entity({
      channels: { browser: strayBrowser, "first-party-api": stray, "published-api": freshPublished },
      id: "apps",
    });
    const folded = foldTrelicaChannel({ channel: "published-api", observed, stored });
    expect(folded).toEqual(
      entity({
        channels: {
          browser: storedBrowser,
          "first-party-api": storedFirstParty,
          "published-api": { ...freshPublished, firstSeenAt: FIRST },
        },
        id: "apps",
      }),
    );
  });

  it("keeps the observed firstSeenAt and channel map for an entity with no stored predecessor", () => {
    const observed = entity({
      channels: { browser: null, "first-party-api": null, "published-api": freshPublished },
      id: "apps",
    });
    expect(foldTrelicaChannel({ channel: "published-api", observed, stored: undefined })).toEqual(observed);
  });

  it("retains the stored slot exactly when the observed row carries nothing on the refreshed channel", () => {
    const stored = entity({
      channels: { browser: storedBrowser, "first-party-api": storedFirstParty, "published-api": storedPublished },
      id: "apps",
    });
    const observed = entity({
      channels: { browser: null, "first-party-api": null, "published-api": null },
      id: "apps",
    });
    expect(foldTrelicaChannel({ channel: "published-api", observed, stored })).toEqual(stored);
  });

  it("refreshes the first-party-api channel without touching the stored published-api channel", () => {
    const stored = entity({
      channels: { browser: storedBrowser, "first-party-api": storedFirstParty, "published-api": storedPublished },
      id: "apps",
    });
    const observed = entity({
      channels: { browser: null, "first-party-api": freshFirstParty, "published-api": null },
      id: "apps",
    });
    expect(foldTrelicaChannel({ channel: "first-party-api", observed, stored })).toEqual(
      entity({
        channels: {
          browser: storedBrowser,
          "first-party-api": { ...freshFirstParty, firstSeenAt: FIRST },
          "published-api": storedPublished,
        },
        id: "apps",
      }),
    );
  });
});

describe("staleTrelicaChannel", () => {
  it("marks only the refreshed channel stale and leaves every other field and channel exact", () => {
    const stored = entity({
      channels: { browser: storedBrowser, "first-party-api": storedFirstParty, "published-api": storedPublished },
      id: "apps",
    });
    expect(staleTrelicaChannel({ channel: "published-api", stored })).toEqual(
      entity({
        channels: {
          browser: storedBrowser,
          "first-party-api": storedFirstParty,
          "published-api": { ...storedPublished, state: "stale" },
        },
        id: "apps",
      }),
    );
  });

  it("returns null when the refreshed channel was never populated", () => {
    const stored = entity({
      channels: { browser: storedBrowser, "first-party-api": storedFirstParty, "published-api": null },
      id: "apps",
    });
    expect(staleTrelicaChannel({ channel: "published-api", stored })).toBeNull();
  });

  it("returns null when the refreshed channel is already stale", () => {
    const stored = entity({
      channels: {
        browser: null,
        "first-party-api": null,
        "published-api": { ...storedPublished, state: "stale" },
      },
      id: "apps",
    });
    expect(staleTrelicaChannel({ channel: "published-api", stored })).toBeNull();
  });
});

describe("mergeTrelicaChannel", () => {
  it("folds the observed row, stales only the published-api channel of the absent stored row, and sorts by id", () => {
    const absent = entity({
      channels: { browser: storedBrowser, "first-party-api": storedFirstParty, "published-api": storedPublished },
      id: "a-absent",
    });
    const heldObserved = entity({
      channels: { browser: storedBrowser, "first-party-api": storedFirstParty, "published-api": storedPublished },
      id: "b-seen",
    });
    const observed = entity({
      channels: { browser: null, "first-party-api": null, "published-api": freshPublished },
      id: "b-seen",
    });
    const merged = unwrap(
      mergeTrelicaChannel({ at: AT, channel: "published-api", observed: [observed], stored: [heldObserved, absent] }),
    );
    expect(merged).toEqual([
      entity({
        channels: {
          browser: storedBrowser,
          "first-party-api": storedFirstParty,
          "published-api": { ...storedPublished, state: "stale" },
        },
        id: "a-absent",
      }),
      entity({
        channels: {
          browser: storedBrowser,
          "first-party-api": storedFirstParty,
          "published-api": { ...freshPublished, firstSeenAt: FIRST },
        },
        id: "b-seen",
      }),
    ]);
  });

  it("accepts exactly the channels the per-channel fixtures cover", () => {
    expect([...TRELICA_ATLAS_CHANNELS]).toEqual(["published-api", "first-party-api", "browser"]);
  });

  it.each(TRELICA_ATLAS_CHANNELS)(
    "driven on the %s channel: refreshes the observed row, keeps its stored firstSeenAt, stales the absent row's slot, leaves every other slot as stored",
    (channel) => {
      const seen = entity({ channels: STORED_CHANNELS, id: "b-seen" });
      const absent = entity({ channels: STORED_CHANNELS, id: "a-absent" });
      const observed = entity({ channels: { ...NO_CHANNELS, [channel]: FRESH_SLOTS[channel] }, id: "b-seen" });
      const merged = unwrap(mergeTrelicaChannel({ at: AT, channel, observed: [observed], stored: [seen, absent] }));
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
    const observed = entity({
      channels: { browser: null, "first-party-api": null, "published-api": freshPublished },
      id: "fresh",
    });
    const merged = unwrap(
      mergeTrelicaChannel({
        at: "2026-12-31T00:00:00.000Z",
        channel: "published-api",
        observed: [observed],
        stored: [],
      }),
    );
    expect(merged).toEqual([observed]);
  });

  it("leaves a stored entity untouched when it was not observed and its published-api channel was never populated", () => {
    const firstPartyOnly = entity({
      channels: { browser: null, "first-party-api": storedFirstParty, "published-api": null },
      id: "internal",
    });
    const merged = unwrap(
      mergeTrelicaChannel({ at: AT, channel: "published-api", observed: [], stored: [firstPartyOnly] }),
    );
    expect(merged).toEqual([firstPartyOnly]);
  });

  it("refuses an observed generation that names one id twice", () => {
    const observed = entity({
      channels: { browser: null, "first-party-api": null, "published-api": freshPublished },
      id: "twice",
    });
    const lines = unwrapErr(
      mergeTrelicaChannel({ at: AT, channel: "published-api", observed: [observed, observed], stored: [] }),
    );
    expect(lines).toEqual([
      "this run produced the same entity id twice: twice",
      "refusing to merge — one read producing two records for one thing is how a count double-counts",
    ]);
  });

  it("returns an empty list for an empty stored and an empty observed generation", () => {
    expect(unwrap(mergeTrelicaChannel({ at: AT, channel: "published-api", observed: [], stored: [] }))).toEqual([]);
  });
});
