import { describe, expect, it } from "vitest";

import { foldFigmaChannel } from "../../../../atlas/figma/merge.js";
import type { FigmaAtlasChannel, FigmaAtlasEntity, FigmaChannelEntity } from "../../../../atlas/figma/model.js";

const FIRST_SEEN = "2026-09-01T00:00:00.000Z";
const AT = "2026-10-12T05:00:00.000Z";

/** One channel's view, first seen and last seen at the instants given. */
function view({
  channel,
  firstSeenAt,
  lastSeenAt,
}: {
  channel: FigmaAtlasChannel;
  firstSeenAt: string;
  lastSeenAt: string;
}): FigmaChannelEntity {
  return { channel, detail: null, firstSeenAt, lastSeenAt, source: null, state: "observed" };
}

/** The file `abc`, carrying the two channel views given. */
function file({
  api,
  browser,
}: {
  api: FigmaChannelEntity | null;
  browser: FigmaChannelEntity | null;
}): FigmaAtlasEntity {
  return { channels: { api, browser }, id: "file:abc", kind: "file", providerId: "abc", scope: "project/42" };
}

const FRESH_BROWSER = view({ channel: "browser", firstSeenAt: AT, lastSeenAt: AT });

describe("foldFigmaChannel", () => {
  it("takes this run's view whole for an entity the store has never held", () => {
    const folded = foldFigmaChannel({
      channel: "browser",
      observed: file({ api: null, browser: FRESH_BROWSER }),
      stored: undefined,
    });
    expect(folded).toStrictEqual(file({ api: null, browser: FRESH_BROWSER }));
  });

  it("carries the stored first sighting forward onto this run's view", () => {
    const stored = file({
      api: null,
      browser: view({ channel: "browser", firstSeenAt: FIRST_SEEN, lastSeenAt: FIRST_SEEN }),
    });
    const folded = foldFigmaChannel({
      channel: "browser",
      observed: file({ api: null, browser: FRESH_BROWSER }),
      stored,
    });
    expect(folded.channels.browser).toStrictEqual(
      view({ channel: "browser", firstSeenAt: FIRST_SEEN, lastSeenAt: AT }),
    );
  });

  it("takes this run's first sighting for a channel the stored entity never had", () => {
    const stored = file({
      api: view({ channel: "api", firstSeenAt: FIRST_SEEN, lastSeenAt: FIRST_SEEN }),
      browser: null,
    });
    const folded = foldFigmaChannel({
      channel: "browser",
      observed: file({ api: null, browser: FRESH_BROWSER }),
      stored,
    });
    expect(folded.channels.browser).toStrictEqual(FRESH_BROWSER);
  });

  it("keeps the stored view of the refreshed channel when this run carries none, and leaves the other channel alone", () => {
    const storedApi = view({ channel: "api", firstSeenAt: FIRST_SEEN, lastSeenAt: FIRST_SEEN });
    const storedBrowser = view({ channel: "browser", firstSeenAt: FIRST_SEEN, lastSeenAt: FIRST_SEEN });
    const folded = foldFigmaChannel({
      channel: "browser",
      observed: file({ api: null, browser: null }),
      stored: file({ api: storedApi, browser: storedBrowser }),
    });
    expect(folded.channels).toStrictEqual({ api: storedApi, browser: storedBrowser });
  });
});
