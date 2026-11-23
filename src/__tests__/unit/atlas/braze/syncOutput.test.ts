import { describe, expect, it } from "vitest";

import type { BrazeSyncOutcome } from "../../../../atlas/braze/sync.js";
import { renderBrazeSyncLines } from "../../../../cli/commands/brazeAtlas/syncRun.js";

/** A whole outcome, varied per test rather than restated. */
function outcome({ unservedPages }: Pick<BrazeSyncOutcome, "unservedPages">): BrazeSyncOutcome {
  return {
    censusDrift: [],
    collectionOnlyCount: 1,
    collectionOperationCount: 140,
    collectionRequestCount: 150,
    corroboratedCount: 130,
    declaredRouteCount: 4,
    dispositionCounts: { excluded: 2, reachable: 140, voluminous: 4 },
    docsOnlyCount: 16,
    documentedCount: 146,
    operationCount: 147,
    pagesFetched: 1,
    pagesFromCache: 145,
    unservedPages,
    written: [],
  };
}

describe("renderBrazeSyncLines", () => {
  it("prints one line per declared page Braze does not serve, naming both addresses", () => {
    const lines = renderBrazeSyncLines({
      outcome: outcome({
        unservedPages: [
          {
            servedAs: "https://www.braze.com/docs/api/endpoints/user_data",
            url: "https://www.braze.com/docs/api/endpoints/user_data/get_users_track_status",
          },
        ],
      }),
    });
    expect(lines.filter((line) => line.startsWith("  unserved documentation page — "))).toEqual([
      "  unserved documentation page — https://www.braze.com/docs/api/endpoints/user_data/get_users_track_status " +
        "served as https://www.braze.com/docs/api/endpoints/user_data; the sitemap declares it and Braze does not " +
        "publish it yet, so it carries no operation and is asked for again next run",
    ]);
  });

  it("prints no unserved line when Braze serves every declared page", () => {
    const lines = renderBrazeSyncLines({ outcome: outcome({ unservedPages: [] }) });
    expect(lines.length).toBe(4);
    expect(lines.some((line) => line.includes("unserved"))).toBe(false);
  });
});
