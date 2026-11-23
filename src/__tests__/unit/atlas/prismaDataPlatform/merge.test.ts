import { describe, expect, it } from "vitest";

import { foldPrismaChannel } from "../../../../atlas/prismaDataPlatform/merge.js";
import type {
  PrismaChannelEntity,
  PrismaDataPlatformAtlasChannel,
  PrismaDataPlatformEntity,
} from "../../../../atlas/prismaDataPlatform/model.js";

const FIRST_SEEN = "2026-09-01T00:00:00.000Z";
const AT = "2026-10-12T05:00:00.000Z";

/** One channel's view, first seen and last seen at the instants given. */
function view({
  channel,
  firstSeenAt,
  lastSeenAt,
}: {
  channel: PrismaDataPlatformAtlasChannel;
  firstSeenAt: string;
  lastSeenAt: string;
}): PrismaChannelEntity {
  return { channel, detail: null, firstSeenAt, lastSeenAt, source: null, state: "observed" };
}

/** The database `db_1`, carrying the two channel views given. */
function database({
  api,
  browser,
}: {
  api: PrismaChannelEntity | null;
  browser: PrismaChannelEntity | null;
}): PrismaDataPlatformEntity {
  return {
    channels: { api, browser },
    id: "database:db_1",
    kind: "database",
    providerId: "db_1",
    scope: "project/acme",
  };
}

const FRESH_API = view({ channel: "api", firstSeenAt: AT, lastSeenAt: AT });
const STORED_API = view({ channel: "api", firstSeenAt: FIRST_SEEN, lastSeenAt: FIRST_SEEN });
const STORED_BROWSER = view({ channel: "browser", firstSeenAt: FIRST_SEEN, lastSeenAt: FIRST_SEEN });

describe("foldPrismaChannel", () => {
  it("takes this run's view whole for an entity the store has never held", () => {
    const folded = foldPrismaChannel({
      channel: "api",
      observed: database({ api: FRESH_API, browser: null }),
      stored: undefined,
    });
    expect(folded).toStrictEqual(database({ api: FRESH_API, browser: null }));
  });

  it("carries the stored first sighting forward onto this run's view, keeping the browser channel's rows", () => {
    const folded = foldPrismaChannel({
      channel: "api",
      observed: database({ api: FRESH_API, browser: null }),
      stored: database({ api: STORED_API, browser: STORED_BROWSER }),
    });
    expect(folded.channels).toStrictEqual({
      api: view({ channel: "api", firstSeenAt: FIRST_SEEN, lastSeenAt: AT }),
      browser: STORED_BROWSER,
    });
  });

  it("takes this run's first sighting for a channel the stored entity never had", () => {
    const folded = foldPrismaChannel({
      channel: "api",
      observed: database({ api: FRESH_API, browser: null }),
      stored: database({ api: null, browser: STORED_BROWSER }),
    });
    expect(folded.channels.api).toStrictEqual(FRESH_API);
  });

  it("keeps the stored view of the refreshed channel when this run carries none", () => {
    const folded = foldPrismaChannel({
      channel: "api",
      observed: database({ api: null, browser: null }),
      stored: database({ api: STORED_API, browser: STORED_BROWSER }),
    });
    expect(folded.channels).toStrictEqual({ api: STORED_API, browser: STORED_BROWSER });
  });
});
