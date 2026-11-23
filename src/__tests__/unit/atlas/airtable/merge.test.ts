import { describe, expect, it } from "vitest";

import { foldAirtableChannel } from "../../../../atlas/airtable/merge.js";
import type {
  AirtableAtlasChannel,
  AirtableAtlasEntity,
  AirtableChannelEntity,
} from "../../../../atlas/airtable/model.js";

const FIRST_SEEN = "2026-09-01T00:00:00.000Z";
const AT = "2026-10-12T05:00:00.000Z";

/** One channel's view, first seen and last seen at the instants given. */
function view({
  channel,
  firstSeenAt,
  lastSeenAt,
}: {
  channel: AirtableAtlasChannel;
  firstSeenAt: string;
  lastSeenAt: string;
}): AirtableChannelEntity {
  return { channel, detail: null, firstSeenAt, lastSeenAt, source: null, state: "observed" };
}

/** The base `appOne`, carrying the two channel views given. */
function base({
  api,
  browser,
}: {
  api: AirtableChannelEntity | null;
  browser: AirtableChannelEntity | null;
}): AirtableAtlasEntity {
  return { channels: { api, browser }, id: "base:appOne", kind: "base", providerId: "appOne", scope: "wspOne" };
}

const FRESH_API = view({ channel: "api", firstSeenAt: AT, lastSeenAt: AT });

describe("foldAirtableChannel", () => {
  it("takes this run's view whole for an entity the store has never held", () => {
    const folded = foldAirtableChannel({
      channel: "api",
      observed: base({ api: FRESH_API, browser: null }),
      stored: undefined,
    });
    expect(folded).toStrictEqual(base({ api: FRESH_API, browser: null }));
  });

  it("carries the stored first sighting forward onto this run's view", () => {
    const stored = base({
      api: view({ channel: "api", firstSeenAt: FIRST_SEEN, lastSeenAt: FIRST_SEEN }),
      browser: null,
    });
    const folded = foldAirtableChannel({ channel: "api", observed: base({ api: FRESH_API, browser: null }), stored });
    expect(folded.channels.api).toStrictEqual(view({ channel: "api", firstSeenAt: FIRST_SEEN, lastSeenAt: AT }));
  });

  it("takes this run's first sighting for a channel the stored entity never had", () => {
    const stored = base({
      api: null,
      browser: view({ channel: "browser", firstSeenAt: FIRST_SEEN, lastSeenAt: FIRST_SEEN }),
    });
    const folded = foldAirtableChannel({ channel: "api", observed: base({ api: FRESH_API, browser: null }), stored });
    expect(folded.channels.api).toStrictEqual(FRESH_API);
  });

  it("keeps the stored view of the refreshed channel when this run carries none, and leaves the other channel alone", () => {
    const storedBrowser = view({ channel: "browser", firstSeenAt: FIRST_SEEN, lastSeenAt: FIRST_SEEN });
    const storedApi = view({ channel: "api", firstSeenAt: FIRST_SEEN, lastSeenAt: FIRST_SEEN });
    const folded = foldAirtableChannel({
      channel: "api",
      observed: base({ api: null, browser: null }),
      stored: base({ api: storedApi, browser: storedBrowser }),
    });
    expect(folded.channels).toStrictEqual({ api: storedApi, browser: storedBrowser });
  });
});
