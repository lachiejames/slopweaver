import { describe, expect, it } from "vitest";

import { hasFilledBrowserSurface, unfilledSurfaces } from "../../../../atlas/kit/contract.js";
import type { LinearApiSurfaceReading } from "../../../../atlas/linear/apiSurface.js";
import { LINEAR_ATLAS_DESCRIPTOR } from "../../../../atlas/linear/descriptor.js";
import type { LinearAtlasGap } from "../../../../atlas/linear/model.js";
import type { LinearAtlasSnapshot } from "../../../../atlas/linear/store.js";
import { atlasPlatforms } from "../../../../atlas/registry.js";
import {
  apiBrowserDisagreements,
  LINEAR_VERB_USAGE,
  noBrowserReading,
  parsed,
  renderSyncSummary,
  workspaceShape,
} from "../../../../cli/commands/atlas/linearCore.js";
import { unwrap, unwrapErr } from "../../../../lib/result.js";

/** An API reading whose settings hold exactly the groups given, each carrying one record per value. */
function apiReading({ groups }: { groups: Readonly<Record<string, readonly unknown[]>> }): LinearApiSurfaceReading {
  return {
    introspectionBatches: 1,
    operations: [],
    schemaFingerprint: "fp",
    settings: Object.entries(groups).map(([group, values]) => ({
      group,
      pageBoundReached: false,
      pagesRead: 1,
      records: values.map((value, index) => ({
        detail: { group, label: "", settingScope: "workspace", value },
        providerId: `${group}:${String(index)}`,
      })),
      refusedBecause: null,
    })),
    types: [],
    workspaceId: null,
  };
}

/** One gap on the operation kind — each case below changes the fields it is about. */
function gap({ status, condition }: { status: "open" | "closed"; condition: string }): LinearAtlasGap {
  return {
    condition,
    fields: ["issueCreate"],
    firstDetectedAt: "2026-09-01T00:00:00.000Z",
    id: `gap-${status}-${condition}`,
    kind: "operation",
    lastCheckedAt: null,
    lastDetectedAt: "2026-09-01T00:00:00.000Z",
    reason: "the browser saw a root field the API did not",
    scope: "operation/issueCreate",
    status,
    surfaces: ["api", "browser"],
  };
}

/** A published generation whose operation kind holds the gaps given, or no operation file at all. */
function snapshotWith({ gaps }: { gaps: readonly LinearAtlasGap[] | null }): LinearAtlasSnapshot {
  return {
    files: {
      operation:
        gaps === null
          ? null
          : {
              coverage: [],
              entities: [],
              gaps: [...gaps],
              kind: "operation",
              platform: "linear",
              schemaVersion: 1,
              updatedAt: "2026-09-01T00:00:00.000Z",
            },
      page: null,
      setting: null,
      type: null,
    },
    manifest: null,
    mismatched: [],
    missing: [],
    superseded: [],
    unpublished: [],
  };
}

describe("LINEAR_VERB_USAGE", () => {
  it("spells the platform and the verb in every line, so a pasted line runs as printed", () => {
    for (const [verb, usage] of Object.entries(LINEAR_VERB_USAGE)) {
      expect(usage.startsWith(`usage: slopweaver atlas linear ${verb} `)).toBe(true);
    }
  });

  it("advertises the flags reachable under each verb", () => {
    expect(LINEAR_VERB_USAGE.sync).toBe(
      "usage: slopweaver atlas linear sync [--skip-browser] [--limit <n>] [--json] [--home <dir>]",
    );
    expect(LINEAR_VERB_USAGE.walk).toBe("usage: slopweaver atlas linear walk [--limit <n>] [--json] [--home <dir>]");
    expect(LINEAR_VERB_USAGE.report).toBe("usage: slopweaver atlas linear report [--json] [--home <dir>]");
    expect(LINEAR_VERB_USAGE.reset).toBe(
      "usage: slopweaver atlas linear reset --confirm archive [--json] [--home <dir>]",
    );
  });
});

describe("parsed", () => {
  it("reads the tail after the verb, and the shared flags in it", () => {
    const { parsedFlags, rest } = parsed({
      argv: ["node", "slopweaver", "atlas", "linear", "report", "--json", "--home", "/acme/home"],
      verb: "report",
    });
    expect(rest).toEqual(["--json", "--home", "/acme/home"]);
    const flags = unwrap(parsedFlags);
    expect([...flags.flags]).toEqual(["json"]);
    expect(flags.values).toEqual({ home: "/acme/home" });
  });

  it("refuses a flag no Linear verb knows", () => {
    const { parsedFlags } = parsed({
      argv: ["node", "slopweaver", "atlas", "linear", "reset", "--force"],
      verb: "reset",
    });
    expect(unwrapErr(parsedFlags)).toEqual(["unknown flag: --force"]);
  });
});

describe("renderSyncSummary", () => {
  it("leads with which surfaces actually contributed", () => {
    const lines = renderSyncSummary({
      input: { entityCounts: { operation: 2 }, openGapCounts: { operation: 1 }, surfacesRead: ["api", "browser"] },
    });
    expect(lines[0]).toBe("linear atlas synced — surfaces read: api, browser");
  });

  it("says NONE rather than an empty list when neither surface contributed", () => {
    const lines = renderSyncSummary({
      input: { entityCounts: {}, openGapCounts: {}, surfacesRead: [] },
    });
    expect(lines[0]).toBe("linear atlas synced — surfaces read: none");
  });

  it("reports a kind's entity count and its open gaps together", () => {
    const lines = renderSyncSummary({
      input: { entityCounts: { page: 6 }, openGapCounts: { page: 2 }, surfacesRead: ["browser"] },
    });
    expect(lines[1]).toContain("6 entities, 2 open gap(s)");
  });

  it("reports no open gap for a kind the run recorded no gap count for", () => {
    const lines = renderSyncSummary({
      input: { entityCounts: { page: 6 }, openGapCounts: {}, surfacesRead: ["browser"] },
    });
    expect(lines[1]).toBe(`  ${"page".padEnd(10)}     6 entities, 0 open gap(s)`);
  });
});

describe("workspaceShape", () => {
  it("reads the organisation's urlKey and every team key the API returned", () => {
    expect(
      workspaceShape({
        api: apiReading({ groups: { organization: [{ urlKey: "acme" }], team: [{ key: "ENG" }, { key: "OPS" }] } }),
      }),
    ).toEqual({ teamKeys: ["ENG", "OPS"], urlKey: "acme" });
  });

  it("walks no team when the API read held no team group, and has no root without an organisation", () => {
    expect(workspaceShape({ api: apiReading({ groups: {} }) })).toEqual({ teamKeys: [], urlKey: null });
  });

  it("skips a team record that carries no string key", () => {
    expect(workspaceShape({ api: apiReading({ groups: { team: [{ key: 7 }, { key: "ENG" }] } }) }).teamKeys).toEqual([
      "ENG",
    ]);
  });
});

describe("apiBrowserDisagreements", () => {
  it("keeps only the OPEN api-browser disagreements", () => {
    const open = gap({ condition: "api-browser-disagreement", status: "open" });
    expect(
      apiBrowserDisagreements({
        snapshot: snapshotWith({
          gaps: [
            open,
            gap({ condition: "api-browser-disagreement", status: "closed" }),
            gap({ condition: "permission-refused", status: "open" }),
          ],
        }),
      }),
    ).toEqual([open]);
  });

  it("records none when no operation kind was ever published", () => {
    expect(apiBrowserDisagreements({ snapshot: snapshotWith({ gaps: null }) })).toEqual([]);
  });
});

describe("LINEAR_ATLAS_DESCRIPTOR", () => {
  it("is reachable through the platform-generic registry", () => {
    expect(atlasPlatforms()).toContain("linear");
  });

  it("declares one platform, spelled the way the registry keys it", () => {
    expect(LINEAR_ATLAS_DESCRIPTOR.platform).toBe("linear");
  });

  it("declares both an API surface and a driven-browser surface", () => {
    expect(LINEAR_ATLAS_DESCRIPTOR.surfaces.map((surface) => surface.acquisition).toSorted()).toEqual([
      "api",
      "driven-browser",
    ]);
  });

  it("grades both surfaces authoritative, so neither can demote the other's unique findings", () => {
    expect(LINEAR_ATLAS_DESCRIPTOR.surfaces.every((surface) => surface.role === "authoritative")).toBe(true);
  });

  it("names a reason for every surface it declares and has not filled", () => {
    unfilledSurfaces({ descriptor: LINEAR_ATLAS_DESCRIPTOR }).forEach((surface) => {
      expect(surface.unfilledBecause === null).toBe(false);
    });
  });

  it("declares what it does NOT hold, which is the fact a reader needs most", () => {
    expect(LINEAR_ATLAS_DESCRIPTOR.excludes.length).toBeGreaterThan(0);
  });

  it("names one command that brings the whole atlas current", () => {
    expect(LINEAR_ATLAS_DESCRIPTOR.resyncCommand).toBe("slopweaver atlas linear sync");
  });

  it("carries the permanent claim boundary this credential can never exceed", () => {
    expect(LINEAR_ATLAS_DESCRIPTOR.visibilityScope).toBe("one-member-session");
  });

  it("declares all four kinds it holds", () => {
    expect([...LINEAR_ATLAS_DESCRIPTOR.kinds].toSorted()).toEqual(["operation", "page", "setting", "type"]);
  });

  it("says its browser surface is not yet filled, matching the surface it declares unfilled", () => {
    expect(hasFilledBrowserSurface({ descriptor: LINEAR_ATLAS_DESCRIPTOR })).toBe(false);
  });
});

describe("noBrowserReading", () => {
  it("reports an empty browser surface carrying the one reason it could not be read", () => {
    expect(noBrowserReading({ because: "no Playwright Extension consent token is configured" })).toEqual({
      limited: false,
      observations: { graphqlResponses: 0, observations: [], unexplainedKeys: [], unresolvedRequests: 0 },
      pages: [],
      unavailableBecause: "no Playwright Extension consent token is configured",
    });
  });
});
