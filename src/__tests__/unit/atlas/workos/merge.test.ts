/**
 * The channel-scoped merge.
 *
 * The corroboration between the two surfaces is an OUTPUT of this atlas, so the property under test is the
 * one that protects it: a run refreshing one channel must never blank, stale or overwrite the other's rows.
 */
import { describe, expect, it } from "vitest";

import {
  foldWorkosChannel,
  mergeWorkosChannel,
  mergeWorkosPartialChannel,
  staleWorkosChannel,
} from "../../../../atlas/workos/merge.js";
import type { WorkosAtlasEntity, WorkosChannelEntity } from "../../../../atlas/workos/model.js";
import { unwrap } from "../../../../lib/result.js";

import { AT } from "./workosFixtures.js";

const EARLIER = "2026-09-01T00:00:00.000Z";

/** One channel's view, stamped as observed. */
function channel({
  name,
  at,
  detail,
}: {
  name: WorkosChannelEntity["channel"];
  at: string;
  detail: unknown;
}): WorkosChannelEntity {
  return { channel: name, detail, firstSeenAt: at, lastSeenAt: at, source: null, state: "observed" };
}

/** An entity with whichever channels a caller names. */
function entity({
  api,
  browser,
  id = "e1",
}: {
  api: WorkosChannelEntity | null;
  browser: WorkosChannelEntity | null;
  id?: string;
}): WorkosAtlasEntity {
  return { channels: { api, browser }, id, kind: "page", providerId: "/organizations" };
}

describe("foldWorkosChannel", () => {
  it("replaces only the refreshed channel and keeps the other exactly as it stood", () => {
    const stored = entity({
      api: channel({ at: EARLIER, detail: "old-api", name: "api" }),
      browser: channel({ at: EARLIER, detail: "witnessed", name: "browser" }),
    });
    const observed = entity({ api: channel({ at: AT, detail: "new-api", name: "api" }), browser: null });
    const folded = foldWorkosChannel({ channel: "api", observed, stored });
    expect(folded.channels.api?.detail).toBe("new-api");
    expect(folded.channels.browser?.detail).toBe("witnessed");
  });

  it("carries firstSeenAt back, so a long-known entity does not claim to be new", () => {
    const stored = entity({ api: channel({ at: EARLIER, detail: "old", name: "api" }), browser: null });
    const observed = entity({ api: channel({ at: AT, detail: "new", name: "api" }), browser: null });
    expect(foldWorkosChannel({ channel: "api", observed, stored }).channels.api?.firstSeenAt).toBe(EARLIER);
  });

  it("keeps the stored channel when this run observed nothing for it", () => {
    const stored = entity({ api: channel({ at: EARLIER, detail: "old", name: "api" }), browser: null });
    const observed = entity({ api: null, browser: null });
    expect(foldWorkosChannel({ channel: "api", observed, stored }).channels.api?.detail).toBe("old");
  });
});

describe("staleWorkosChannel", () => {
  it("stales the refreshed channel a run did not see", () => {
    const stored = entity({ api: channel({ at: EARLIER, detail: "old", name: "api" }), browser: null });
    expect(staleWorkosChannel({ channel: "api", stored })?.channels.api?.state).toBe("stale");
  });

  it("leaves an entity alone when the refreshed channel never looked at it", () => {
    const stored = entity({ api: null, browser: channel({ at: EARLIER, detail: "w", name: "browser" }) });
    expect(staleWorkosChannel({ channel: "api", stored })).toBe(null);
  });

  it("leaves an already-stale channel alone rather than rewriting it", () => {
    const held = { ...channel({ at: EARLIER, detail: "old", name: "api" as const }), state: "stale" as const };
    expect(staleWorkosChannel({ channel: "api", stored: entity({ api: held, browser: null }) })).toBe(null);
  });
});

describe("mergeWorkosChannel", () => {
  it("stales a stored entity this run did not see", () => {
    const stored = [entity({ api: channel({ at: EARLIER, detail: "old", name: "api" }), browser: null })];
    const merged = mergeWorkosChannel({ at: AT, channel: "api", observed: [], stored });
    expect(unwrap(merged)[0]?.channels.api?.state).toBe("stale");
  });

  it("keeps an unseen entity's browser channel observed while staling its api channel", () => {
    const stored = [
      entity({
        api: channel({ at: EARLIER, detail: "old", name: "api" }),
        browser: channel({ at: EARLIER, detail: "witnessed", name: "browser" }),
      }),
    ];
    const merged = mergeWorkosChannel({ at: AT, channel: "api", observed: [], stored });
    expect(unwrap(merged)[0]?.channels.browser?.state).toBe("observed");
  });
});

describe("mergeWorkosPartialChannel", () => {
  // Staling the absent is only correct when a run LOOKED at everything the kind holds. A key-less run
  // observes nothing about the content kinds, and staling them would report an organisation as no longer
  // current on the strength of a run that never asked.
  it("leaves an unobserved entity exactly as it stands", () => {
    const stored = [entity({ api: channel({ at: EARLIER, detail: "old", name: "api" }), browser: null })];
    const merged = mergeWorkosPartialChannel({ at: AT, channel: "api", observed: [], stored });
    expect(unwrap(merged)[0]?.channels.api?.state).toBe("observed");
  });

  it("still folds what it did observe", () => {
    const stored = [entity({ api: channel({ at: EARLIER, detail: "old", name: "api" }), browser: null })];
    const observed = [entity({ api: channel({ at: AT, detail: "new", name: "api" }), browser: null })];
    const merged = mergeWorkosPartialChannel({ at: AT, channel: "api", observed, stored });
    expect(unwrap(merged)[0]?.channels.api?.detail).toBe("new");
  });
});
