import { describe, expect, it } from "vitest";

import { INNGEST_ATLAS_DESCRIPTOR } from "../../../../atlas/inngest/descriptor.js";
import { foldInngestChannel, staleInngestChannel } from "../../../../atlas/inngest/merge.js";
import { INNGEST_KINDS, type InngestAtlasEntity, type InngestAtlasKindFile } from "../../../../atlas/inngest/model.js";
import { projectInngestWalkedPage } from "../../../../atlas/inngest/projection.js";
import {
  inngestDashboardFilled,
  inngestGraphqlFilled,
  surfaceHasWalkedEvidence,
} from "../../../../atlas/inngest/surfaceFill.js";

const AT = "2026-09-07T02:00:00.000Z";
const LATER = "2026-09-08T02:00:00.000Z";

/** One page entity carrying only the channel a caller names. */
function entity({ channel, at }: { channel: "browser" | "compiled"; at: string }): InngestAtlasEntity {
  const observed = {
    channel,
    detail: { seen: at },
    firstSeenAt: at,
    lastSeenAt: at,
    source: null,
    state: "observed" as const,
  };
  return {
    channels: {
      api: null,
      browser: channel === "browser" ? observed : null,
      compiled: channel === "compiled" ? observed : null,
    },
    id: "abc",
    kind: "page",
    providerId: "/settings",
  };
}

/** One kind file carrying just the coverage cells a fill judgement reads. */
function fileWith({ cells }: { cells: InngestAtlasKindFile["coverage"] }): InngestAtlasKindFile {
  return {
    coverage: cells,
    entities: [],
    gaps: [],
    kind: "page",
    platform: "inngest",
    schemaVersion: 1,
    updatedAt: AT,
  };
}

/** A coverage cell, with only the three fields a fill judgement reads varied. */
function cell({
  surface,
  state,
  lastSuccessAt,
}: {
  surface: string;
  state: "synced" | "unreadable";
  lastSuccessAt: string | null;
}): InngestAtlasKindFile["coverage"][number] {
  return {
    artifacts: [],
    channel: "browser",
    lastSuccessAt,
    latestAttemptFailed: false,
    reason: "x",
    role: "authoritative",
    scope: "y",
    state,
    surface,
    unblockedBy: null,
    visibilityScope: "browser-signed-in-account",
  };
}

describe("what this atlas declares", () => {
  it("declares every kind it publishes a file for, and one surface per acquisition it can reach", () => {
    expect([...INNGEST_ATLAS_DESCRIPTOR.kinds].toSorted()).toEqual([...INNGEST_KINDS].toSorted());
    expect(INNGEST_ATLAS_DESCRIPTOR.surfaces.map((surface) => surface.name)).toEqual([
      "published-catalogue",
      "rest-api",
      "graphql",
      "dashboard",
    ]);
    expect(INNGEST_ATLAS_DESCRIPTOR.writePolicy).toBe("refuse-every-write");
    // The resync command must be a verb this atlas actually ships — a `refresh` it never had ran exit 2 for nine days.
    expect(INNGEST_ATLAS_DESCRIPTOR.resyncCommand).toBe("slopweaver atlas inngest sync");
  });
});

describe("merging one channel onto what another already knew", () => {
  it("keeps the first sighting when the same channel is refreshed", () => {
    const merged = foldInngestChannel({
      channel: "compiled",
      observed: entity({ at: LATER, channel: "compiled" }),
      stored: entity({ at: AT, channel: "compiled" }),
    });
    expect(merged.channels.compiled!.firstSeenAt).toBe(AT);
    expect(merged.channels.compiled!.lastSeenAt).toBe(LATER);
  });

  // The whole multi-surface design: a compiled sync must never erase what a walk saw.
  it("leaves the other channel exactly as it was", () => {
    const stored: InngestAtlasEntity = {
      ...entity({ at: AT, channel: "compiled" }),
      channels: {
        ...entity({ at: AT, channel: "compiled" }).channels,
        browser: entity({ at: AT, channel: "browser" }).channels.browser,
      },
    };
    const merged = foldInngestChannel({
      channel: "compiled",
      observed: entity({ at: LATER, channel: "compiled" }),
      stored,
    });
    expect(merged.channels.browser!.lastSeenAt).toBe(AT);
    expect(merged.channels.browser!.state).toBe("observed");
  });

  it("takes an entity no earlier generation held exactly as this run saw it", () => {
    const observed = entity({ at: LATER, channel: "compiled" });
    expect(foldInngestChannel({ channel: "compiled", observed, stored: undefined })).toEqual(observed);
  });

  it("dates a channel's first view from this run when the stored entity held nothing through it", () => {
    const merged = foldInngestChannel({
      channel: "browser",
      observed: entity({ at: LATER, channel: "browser" }),
      stored: entity({ at: AT, channel: "compiled" }),
    });
    expect(merged.channels.browser).toEqual(entity({ at: LATER, channel: "browser" }).channels.browser);
    expect(merged.channels.compiled).toEqual(entity({ at: AT, channel: "compiled" }).channels.compiled);
  });

  it("keeps the stored view of the refreshed channel when this run's entity carries none", () => {
    const merged = foldInngestChannel({
      channel: "browser",
      observed: entity({ at: LATER, channel: "compiled" }),
      stored: entity({ at: AT, channel: "browser" }),
    });
    expect(merged.channels.browser).toEqual(entity({ at: AT, channel: "browser" }).channels.browser);
  });

  it("stales only the refreshed channel of an entity this run did not see, and only once", () => {
    const stored = entity({ at: AT, channel: "compiled" });
    const staled = staleInngestChannel({ channel: "compiled", stored })!;
    expect(staled.channels.compiled!.state).toBe("stale");
    expect(staleInngestChannel({ channel: "compiled", stored: staled })).toBe(null);
    expect(staleInngestChannel({ channel: "browser", stored })).toBe(null);
  });
});

describe("projecting a page the walk never asked for", () => {
  // MEASURED: the kit's placeholder for an unattempted page carries an empty `observedAt`, and the stored
  // schema requires an ISO instant — one such row refused a whole walk's publish after every page before
  // it had been driven. The run's own timestamp is the honest substitute.
  it("stamps the run's own instant rather than the empty one the placeholder carries", () => {
    const projected = projectInngestWalkedPage({
      at: AT,
      page: {
        artifacts: [],
        calls: [],
        captureComplete: false,
        finalUrl: "",
        observedAt: "",
        redirected: false,
        responseAccounting: { bodyFailed: 0, bodySucceeded: 0, eligible: 0, seen: 0 },
        statusCode: null,
        surface: "/settings",
        title: "",
        unreachableBecause: "the walk stopped before reaching it",
      },
      section: "settings",
    });
    expect(projected.channels.browser!.source!.observedAt).toBe(AT);
  });
});

describe("grading whether a browser surface has actually been walked", () => {
  // MEASURED by this test's own first run: `page` is written by BOTH the sync and the walk, so a manifest
  // row on it says only that somebody published the kind. Grading the dashboard surface that way flipped it
  // to `filled` on a sync that never opened a browser.
  it("refuses the unreadable cell a sync writes and accepts the synced cell only a walk writes", () => {
    const afterSync = {
      page: fileWith({ cells: [cell({ lastSuccessAt: null, state: "unreadable", surface: "dashboard" })] }),
    };
    const afterWalk = {
      page: fileWith({ cells: [cell({ lastSuccessAt: AT, state: "synced", surface: "dashboard" })] }),
    };
    expect(inngestDashboardFilled({ files: afterSync })).toBe(false);
    expect(inngestDashboardFilled({ files: afterWalk })).toBe(true);
  });

  it("reads each browser surface's evidence off its own kind rather than off any cell present", () => {
    const files = { page: fileWith({ cells: [cell({ lastSuccessAt: AT, state: "synced", surface: "dashboard" })] }) };
    expect(inngestGraphqlFilled({ files })).toBe(false);
    expect(surfaceHasWalkedEvidence({ files, kind: "page", surface: "graphql" })).toBe(false);
  });

  it("answers false for a generation holding no file for that kind at all", () => {
    expect(inngestDashboardFilled({ files: {} })).toBe(false);
    expect(inngestGraphqlFilled({ files: { "graphql-operation": null } })).toBe(false);
  });
});
