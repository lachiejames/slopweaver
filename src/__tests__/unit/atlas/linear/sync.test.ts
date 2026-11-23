/**
 * The Linear sync's per-channel fold, the workspace it publishes, and its first refusal: a run where neither
 * surface produced a reading publishes nothing.
 *
 * The refusal runs over a real throwaway home, so "nothing is written" is checked on disk rather than assumed
 * from the return value — the refusal must fire before the store is read or any file is laid down.
 */
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { initialLinearAtlasManifest, type LinearChannelEntity } from "../../../../atlas/linear/model.js";
import { linearAtlasPaths } from "../../../../atlas/linear/store.js";
import { foldLinearChannel, publishedWorkspaceId, syncLinearAtlas } from "../../../../atlas/linear/sync.js";

const AT = "2026-09-05T00:00:00.000Z";
const EARLIER = "2026-09-01T00:00:00.000Z";

/** One channel slot, with every field set so a test states only what it is about. */
function slot(over: Partial<LinearChannelEntity> = {}): LinearChannelEntity {
  return {
    channel: "api",
    detail: null,
    firstSeenAt: EARLIER,
    lastSeenAt: EARLIER,
    source: null,
    state: "observed",
    ...over,
  };
}

describe("foldLinearChannel", () => {
  it("keeps the stored slot exactly when this run's channel did not see the entity", () => {
    const previous = slot({ state: "stale" });
    expect(foldLinearChannel({ at: AT, fresh: null, previous })).toEqual(previous);
  });

  it("leaves a slot empty when neither the store nor this run's channel saw the entity", () => {
    expect(foldLinearChannel({ at: AT, fresh: null, previous: null })).toBeNull();
  });

  it("stamps a first sighting on this channel as seen now, keeping its own first-seen time", () => {
    const fresh = slot({ firstSeenAt: AT, lastSeenAt: EARLIER });
    expect(foldLinearChannel({ at: AT, fresh, previous: null })).toEqual(slot({ firstSeenAt: AT, lastSeenAt: AT }));
  });

  it("carries the stored first sighting forward onto a fresh reading", () => {
    const fresh = slot({ detail: "new", firstSeenAt: AT });
    expect(foldLinearChannel({ at: AT, fresh, previous: slot({ detail: "old" }) })).toEqual(
      slot({ detail: "new", firstSeenAt: EARLIER, lastSeenAt: AT }),
    );
  });
});

describe("publishedWorkspaceId", () => {
  const prior = initialLinearAtlasManifest({ updatedAt: EARLIER, workspaceId: "ws-stored" });

  it("records the workspace this run established", () => {
    expect(publishedWorkspaceId({ api: { workspaceId: "ws-fresh" }, prior })).toBe("ws-fresh");
  });

  it("keeps the stored workspace when the API read could not establish one", () => {
    expect(publishedWorkspaceId({ api: { workspaceId: null }, prior })).toBe("ws-stored");
  });

  it("keeps the stored workspace when the API channel did not run", () => {
    expect(publishedWorkspaceId({ api: null, prior })).toBe("ws-stored");
  });

  it("records no workspace on a first publish that could not establish one", () => {
    expect(publishedWorkspaceId({ api: null, prior: null })).toBeNull();
  });
});

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "slopweaver-linear-sync-"));
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

describe("syncLinearAtlas", () => {
  it("refuses a run with no API reading and no browser, naming why the browser did not run", () => {
    const paths = linearAtlasPaths({ home });
    const synced = syncLinearAtlas({
      api: null,
      at: "2026-09-05T00:00:00.000Z",
      browser: {
        limited: false,
        observations: { graphqlResponses: 0, observations: [], unexplainedKeys: [], unresolvedRequests: 0 },
        pages: [],
        unavailableBecause: "no Playwright Extension consent token is configured",
      },
      paths,
      plannedCount: 0,
      workspaceUrlBase: null,
    });
    expect(synced._unsafeUnwrapErr()).toEqual([
      "neither surface produced a reading, so there is nothing to publish",
      "no Playwright Extension consent token is configured",
    ]);
    expect(existsSync(paths.directory)).toBe(false);
  });
});
