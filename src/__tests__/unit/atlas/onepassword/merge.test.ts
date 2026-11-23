import { describe, expect, it } from "vitest";

import { mergeOnepasswordKind } from "../../../../atlas/onepassword/merge.js";
import {
  ONEPASSWORD_CHANNELS,
  type OnepasswordChannel,
  type OnepasswordEntity,
} from "../../../../atlas/onepassword/model.js";
import { OnepasswordSyncErrors, onepasswordSyncErrorLines } from "../../../../atlas/onepassword/syncErrors.js";
import { unwrap, unwrapErr } from "../../../../lib/result.js";

const FIRST = "2026-08-01T00:00:00.000Z";
const SECOND = "2026-09-01T00:00:00.000Z";
const FRESH = "2026-09-15T00:00:00.000Z";
const AT = "2026-10-01T00:00:00.000Z";

type Slot = NonNullable<OnepasswordEntity["channels"]["admin-cli"]>;

function slot({
  channel,
  firstSeenAt,
  lastSeenAt,
  state,
}: {
  channel: OnepasswordChannel;
  firstSeenAt: string;
  lastSeenAt: string;
  state: "observed" | "stale";
}): Slot {
  return { channel, detail: null, firstSeenAt, lastSeenAt, source: null, state };
}

function user({ id, channels }: { id: string; channels: OnepasswordEntity["channels"] }): OnepasswordEntity {
  return { channels, id, kind: "user", providerId: `user-${id}` };
}

const storedAdmin = slot({ channel: "admin-cli", firstSeenAt: FIRST, lastSeenAt: FIRST, state: "observed" });
const storedEvents = slot({ channel: "events-api", firstSeenAt: FIRST, lastSeenAt: SECOND, state: "observed" });
const storedBrowser = slot({ channel: "browser", firstSeenAt: FIRST, lastSeenAt: SECOND, state: "observed" });
const freshAdmin = slot({ channel: "admin-cli", firstSeenAt: FRESH, lastSeenAt: FRESH, state: "observed" });
const freshEvents = slot({ channel: "events-api", firstSeenAt: FRESH, lastSeenAt: FRESH, state: "observed" });
const freshBrowser = slot({ channel: "browser", firstSeenAt: FRESH, lastSeenAt: FRESH, state: "observed" });

/** A stored entity's channels with every slot populated, each first seen at FIRST. */
const STORED_CHANNELS: Record<OnepasswordChannel, Slot> = {
  "admin-cli": storedAdmin,
  browser: storedBrowser,
  "events-api": storedEvents,
};
/** The one fresh slot a run on each channel observes. */
const FRESH_SLOTS: Record<OnepasswordChannel, Slot> = {
  "admin-cli": freshAdmin,
  browser: freshBrowser,
  "events-api": freshEvents,
};
const NO_CHANNELS: OnepasswordEntity["channels"] = { "admin-cli": null, browser: null, "events-api": null };

describe("mergeOnepasswordKind", () => {
  it("replaces the admin-cli slot, keeps its stored firstSeenAt, and carries events-api and browser from storage", () => {
    const stored = user({
      channels: { "admin-cli": storedAdmin, browser: storedBrowser, "events-api": storedEvents },
      id: "u1",
    });
    const observed = user({ channels: { "admin-cli": freshAdmin, browser: null, "events-api": null }, id: "u1" });
    const merged = unwrap(
      mergeOnepasswordKind({ at: AT, channel: "admin-cli", observed: [observed], stored: [stored] }),
    );
    expect(merged).toEqual([
      user({
        channels: {
          "admin-cli": { ...freshAdmin, firstSeenAt: FIRST },
          browser: storedBrowser,
          "events-api": storedEvents,
        },
        id: "u1",
      }),
    ]);
  });

  it("sets a brand new entity's firstSeenAt to the run's at, not the timestamp the fresh row carried", () => {
    const observed = user({ channels: { "admin-cli": freshAdmin, browser: null, "events-api": null }, id: "u1" });
    const merged = unwrap(mergeOnepasswordKind({ at: AT, channel: "admin-cli", observed: [observed], stored: [] }));
    expect(merged).toEqual([
      user({
        channels: { "admin-cli": { ...freshAdmin, firstSeenAt: AT }, browser: null, "events-api": null },
        id: "u1",
      }),
    ]);
  });

  it("drops channels other than the refreshed one that a brand new observed row carries", () => {
    const stray = slot({ channel: "events-api", firstSeenAt: FRESH, lastSeenAt: FRESH, state: "observed" });
    const observed = user({ channels: { "admin-cli": freshAdmin, browser: null, "events-api": stray }, id: "u1" });
    const merged = unwrap(mergeOnepasswordKind({ at: AT, channel: "admin-cli", observed: [observed], stored: [] }));
    expect(merged).toEqual([
      user({
        channels: { "admin-cli": { ...freshAdmin, firstSeenAt: AT }, browser: null, "events-api": null },
        id: "u1",
      }),
    ]);
  });

  it("refuses an observed entity with nothing on the refreshed channel, naming the entity and the channel", () => {
    const observed = user({ channels: { "admin-cli": null, browser: null, "events-api": null }, id: "u1" });
    const lines = unwrapErr(mergeOnepasswordKind({ at: AT, channel: "admin-cli", observed: [observed], stored: [] }));
    expect(lines).toEqual(["entity u1 was observed this run with no admin-cli channel populated"]);
  });

  it("renders that refusal exactly as the CHANNEL_EMPTY factory's lines", () => {
    const observed = user({ channels: { "admin-cli": null, browser: null, "events-api": null }, id: "u1" });
    const lines = unwrapErr(mergeOnepasswordKind({ at: AT, channel: "admin-cli", observed: [observed], stored: [] }));
    expect(lines).toEqual(
      onepasswordSyncErrorLines({
        error: OnepasswordSyncErrors.channelEmpty({ channel: "admin-cli", entityId: "u1" }),
      }),
    );
  });

  it("refuses an empty refreshed channel even when a stored predecessor exists", () => {
    const stored = user({
      channels: { "admin-cli": storedAdmin, browser: null, "events-api": storedEvents },
      id: "u2",
    });
    const observed = user({ channels: { "admin-cli": null, browser: null, "events-api": null }, id: "u2" });
    const lines = unwrapErr(
      mergeOnepasswordKind({ at: AT, channel: "admin-cli", observed: [observed], stored: [stored] }),
    );
    expect(lines).toEqual(["entity u2 was observed this run with no admin-cli channel populated"]);
  });

  it("stales only the admin-cli slot of a stored entity this run did not observe", () => {
    const stored = user({
      channels: { "admin-cli": storedAdmin, browser: storedBrowser, "events-api": storedEvents },
      id: "u1",
    });
    const merged = unwrap(mergeOnepasswordKind({ at: AT, channel: "admin-cli", observed: [], stored: [stored] }));
    expect(merged).toEqual([
      user({
        channels: {
          "admin-cli": { ...storedAdmin, state: "stale" },
          browser: storedBrowser,
          "events-api": storedEvents,
        },
        id: "u1",
      }),
    ]);
  });

  it("leaves an unobserved entity exactly as stored when its admin-cli slot is empty or already stale", () => {
    const empty = user({ channels: { "admin-cli": null, browser: null, "events-api": storedEvents }, id: "a" });
    const alreadyStale = user({
      channels: { "admin-cli": { ...storedAdmin, state: "stale" }, browser: null, "events-api": null },
      id: "b",
    });
    const merged = unwrap(
      mergeOnepasswordKind({ at: AT, channel: "admin-cli", observed: [], stored: [alreadyStale, empty] }),
    );
    expect(merged).toEqual([empty, alreadyStale]);
  });

  it("folds the observed row and stales the unobserved one in a mixed generation, sorted by id", () => {
    const absent = user({
      channels: { "admin-cli": storedAdmin, browser: null, "events-api": storedEvents },
      id: "a-absent",
    });
    const seen = user({
      channels: { "admin-cli": storedAdmin, browser: storedBrowser, "events-api": null },
      id: "b-seen",
    });
    const observed = user({ channels: { "admin-cli": freshAdmin, browser: null, "events-api": null }, id: "b-seen" });
    const merged = unwrap(
      mergeOnepasswordKind({ at: AT, channel: "admin-cli", observed: [observed], stored: [seen, absent] }),
    );
    expect(merged).toEqual([
      user({
        channels: { "admin-cli": { ...storedAdmin, state: "stale" }, browser: null, "events-api": storedEvents },
        id: "a-absent",
      }),
      user({
        channels: { "admin-cli": { ...freshAdmin, firstSeenAt: FIRST }, browser: storedBrowser, "events-api": null },
        id: "b-seen",
      }),
    ]);
  });

  it("refreshes the events-api channel without touching the stored admin-cli channel", () => {
    const stored = user({
      channels: { "admin-cli": storedAdmin, browser: storedBrowser, "events-api": storedEvents },
      id: "u1",
    });
    const observed = user({ channels: { "admin-cli": null, browser: null, "events-api": freshEvents }, id: "u1" });
    const merged = unwrap(
      mergeOnepasswordKind({ at: AT, channel: "events-api", observed: [observed], stored: [stored] }),
    );
    expect(merged).toEqual([
      user({
        channels: {
          "admin-cli": storedAdmin,
          browser: storedBrowser,
          "events-api": { ...freshEvents, firstSeenAt: FIRST },
        },
        id: "u1",
      }),
    ]);
  });

  it("first-sees a STORED entity on a channel that never looked before at the run's at, carrying the others", () => {
    const stored = user({ channels: { "admin-cli": storedAdmin, browser: null, "events-api": null }, id: "u1" });
    const observed = user({ channels: { "admin-cli": null, browser: null, "events-api": freshEvents }, id: "u1" });
    const merged = unwrap(
      mergeOnepasswordKind({ at: AT, channel: "events-api", observed: [observed], stored: [stored] }),
    );
    expect(merged).toEqual([
      user({
        channels: { "admin-cli": storedAdmin, browser: null, "events-api": { ...freshEvents, firstSeenAt: AT } },
        id: "u1",
      }),
    ]);
  });

  it("refreshes the browser channel without touching the stored admin-cli or events-api channels", () => {
    const stored = user({
      channels: { "admin-cli": storedAdmin, browser: storedBrowser, "events-api": storedEvents },
      id: "u1",
    });
    const observed = user({ channels: { "admin-cli": null, browser: freshBrowser, "events-api": null }, id: "u1" });
    const merged = unwrap(mergeOnepasswordKind({ at: AT, channel: "browser", observed: [observed], stored: [stored] }));
    expect(merged).toEqual([
      user({
        channels: {
          "admin-cli": storedAdmin,
          browser: { ...freshBrowser, firstSeenAt: FIRST },
          "events-api": storedEvents,
        },
        id: "u1",
      }),
    ]);
  });

  it("accepts exactly the channels the per-channel fixtures cover", () => {
    expect([...ONEPASSWORD_CHANNELS]).toEqual(["admin-cli", "events-api", "browser"]);
  });

  it.each(ONEPASSWORD_CHANNELS)(
    "driven on the %s channel: refreshes the observed row, keeps its stored firstSeenAt, stales the absent row's slot, leaves every other slot as stored",
    (channel) => {
      const seen = user({ channels: STORED_CHANNELS, id: "b-seen" });
      const absent = user({ channels: STORED_CHANNELS, id: "a-absent" });
      const observed = user({ channels: { ...NO_CHANNELS, [channel]: FRESH_SLOTS[channel] }, id: "b-seen" });
      const merged = unwrap(mergeOnepasswordKind({ at: AT, channel, observed: [observed], stored: [seen, absent] }));
      expect(merged).toEqual([
        user({
          channels: { ...STORED_CHANNELS, [channel]: { ...STORED_CHANNELS[channel], state: "stale" } },
          id: "a-absent",
        }),
        user({
          channels: { ...STORED_CHANNELS, [channel]: { ...FRESH_SLOTS[channel], firstSeenAt: FIRST } },
          id: "b-seen",
        }),
      ]);
    },
  );

  it("returns an empty list for an empty stored and an empty observed generation", () => {
    expect(unwrap(mergeOnepasswordKind({ at: AT, channel: "admin-cli", observed: [], stored: [] }))).toEqual([]);
  });
});
