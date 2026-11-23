/**
 * Unit: how one fill's observation grades into a generation — per-list cells, a failed list keeping what it
 * held, a 403 read as a permission boundary, the cloud-platform-only kinds blocked without a call — and the
 * whole thing published into a throwaway home and read back with no feed secret anywhere on disk.
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { failureWords, type GoogleSecopsPriorGeneration } from "../../../../atlas/googleSecops/cells.js";
import {
  CLOUD_PLATFORM_UNBLOCKED_BY,
  GOOGLE_SECOPS_FILL_CALLS,
  IAM_ROLE_UNBLOCKED_BY,
} from "../../../../atlas/googleSecops/fill/plan.js";
import {
  type GoogleSecopsFillObservation,
  runGoogleSecopsFill,
  type SecopsCallAnswered,
  type SecopsCallFailed,
  type SecopsGet,
} from "../../../../atlas/googleSecops/fill/run.js";
import { GOOGLE_SECOPS_ATLAS_KINDS, type GoogleSecopsAtlasKind } from "../../../../atlas/googleSecops/model.js";
import { readGoogleSecopsSnapshot } from "../../../../atlas/googleSecops/readAdapter.js";
import { buildGoogleSecopsGeneration, syncGoogleSecopsAtlas } from "../../../../atlas/googleSecops/sync.js";
import { ok, unwrap, unwrapErr } from "../../../../lib/result.js";
import { parseSecopsInstance } from "../../../../live/googleSecops/instance.js";

const NAME = "projects/fixture-project/locations/australia-southeast1/instances/00000000-0000-4000-8000-000000000001";
const AT = "2026-10-02T00:00:00.000Z";
const LATER = "2026-10-03T00:00:00.000Z";
const FAKE_SECRET = "fixture-secret-access-key-not-real";

/** A store that has never been published. */
function emptyPrior(): GoogleSecopsPriorGeneration {
  const files = {} as Record<GoogleSecopsAtlasKind, null>;
  for (const kind of GOOGLE_SECOPS_ATLAS_KINDS) {
    files[kind] = null;
  }
  return { files, manifest: null };
}

/** The planned call with this rpc. */
function call({ rpc }: { rpc: string }) {
  const found = GOOGLE_SECOPS_FILL_CALLS.find((entry) => entry.rpc === rpc)!;
  return { family: found.family, id: found.id, kind: found.kind, rpc: found.rpc };
}

/** A list that answered these provider ids, each with its family in the detail. */
function answered({
  rpc,
  ids,
  truncated = false,
}: {
  rpc: string;
  ids: readonly string[];
  truncated?: boolean;
}): SecopsCallAnswered {
  const identity = call({ rpc });
  return {
    ...identity,
    items: ids.map((providerId) => ({ detail: { family: identity.family }, providerId })),
    truncated,
  };
}

/** A list that failed with this status. */
function failed({ rpc, status }: { rpc: string; status: number | null }): SecopsCallFailed {
  return { ...call({ rpc }), message: "The caller does not have permission", status };
}

/** Every list answered empty, except the ones overridden. */
function observation({
  at = AT,
  answers = [],
  failures = [],
}: {
  at?: string;
  answers?: readonly SecopsCallAnswered[];
  failures?: readonly SecopsCallFailed[];
}): GoogleSecopsFillObservation {
  const named = new Set([...answers, ...failures].map((entry) => entry.rpc));
  const rest = GOOGLE_SECOPS_FILL_CALLS.filter((entry) => !named.has(entry.rpc)).map((entry) =>
    answered({ ids: [], rpc: entry.rpc }),
  );
  return { answered: [...answers, ...rest], failed: [...failures], filledAtIso: at };
}

describe("failureWords", () => {
  it("says Google never answered when there is no status, and names the status when there is", () => {
    expect(failureWords({ failure: failed({ rpc: "ListFeeds", status: null }) })).toBe(
      "failed before Google answered — The caller does not have permission",
    );
    expect(failureWords({ failure: failed({ rpc: "ListFeeds", status: 403 }) })).toBe(
      "answered 403 — The caller does not have permission",
    );
  });
});

describe("buildGoogleSecopsGeneration", () => {
  it("gives a two-list kind one cell per list, keyed by rpc", () => {
    const { files } = buildGoogleSecopsGeneration({ fill: observation({}), prior: emptyPrior() });
    expect(files.dashboard.coverage.map((cell) => `${cell.scope}:${cell.state}`)).toStrictEqual([
      "ListNativeDashboards:synced",
      "ListFeaturedContentNativeDashboards:synced",
    ]);
  });

  it("stamps a cloud-platform-only kind blocked on the scope, with no attempt", () => {
    const { files, manifest } = buildGoogleSecopsGeneration({ fill: observation({}), prior: emptyPrior() });
    expect(manifest.kinds.rule).toStrictEqual({
      digest: null,
      entityCount: 0,
      lastAttempt: null,
      lastSuccessAt: null,
      permissionBlocked: {
        at: AT,
        detail: "every GET under this kind accepts only cloud-platform; the grant carries chronicle.readonly",
        unblockedBy: CLOUD_PLATFORM_UNBLOCKED_BY,
      },
    });
    expect(files.rule.coverage.map((cell) => `${cell.scope}:${cell.state}`)).toStrictEqual([
      "cloud-platform-only:not-configured",
    ]);
  });

  it("marks a list cut at the page bound deferred rather than synced", () => {
    const fill = observation({ answers: [answered({ ids: ["t1"], rpc: "ListDataTables", truncated: true })] });
    const { files } = buildGoogleSecopsGeneration({ fill, prior: emptyPrior() });
    expect(files["data-table"].coverage.map((cell) => cell.state)).toStrictEqual(["deferred"]);
  });

  it("reads a 403 on one list as a permission boundary, stamping the other list's success and keeping the failed list's entities", () => {
    const first = buildGoogleSecopsGeneration({
      fill: observation({
        answers: [
          answered({ ids: ["native-1"], rpc: "ListNativeDashboards" }),
          answered({ ids: ["featured-1"], rpc: "ListFeaturedContentNativeDashboards" }),
        ],
      }),
      prior: emptyPrior(),
    });
    const second = buildGoogleSecopsGeneration({
      fill: observation({
        answers: [answered({ ids: ["native-2"], rpc: "ListNativeDashboards" })],
        at: LATER,
        failures: [failed({ rpc: "ListFeaturedContentNativeDashboards", status: 403 })],
      }),
      prior: first,
    });
    expect(second.files.dashboard.entities.map((entity) => entity.providerId)).toStrictEqual([
      "featured-1",
      "native-2",
    ]);
    expect(second.manifest.kinds.dashboard).toStrictEqual({
      digest: null,
      entityCount: 2,
      lastAttempt: {
        at: LATER,
        outcome: "failed",
        reasons: ["ListFeaturedContentNativeDashboards answered 403 — The caller does not have permission"],
      },
      lastSuccessAt: LATER,
      permissionBlocked: {
        at: LATER,
        detail: "ListFeaturedContentNativeDashboards answered 403 — The caller does not have permission",
        unblockedBy: IAM_ROLE_UNBLOCKED_BY,
      },
    });
    expect(second.files.dashboard.coverage.map((cell) => `${cell.scope}:${cell.state}`)).toStrictEqual([
      "ListNativeDashboards:synced",
      "ListFeaturedContentNativeDashboards:unreadable",
    ]);
  });

  it("does not stamp a block when a failure was not a 403", () => {
    const { manifest } = buildGoogleSecopsGeneration({
      fill: observation({ failures: [failed({ rpc: "ListFeeds", status: 500 })] }),
      prior: emptyPrior(),
    });
    expect(manifest.kinds.feed).toStrictEqual({
      digest: null,
      entityCount: 0,
      lastAttempt: {
        at: AT,
        outcome: "failed",
        reasons: ["ListFeeds answered 500 — The caller does not have permission"],
      },
      lastSuccessAt: null,
    });
  });

  it("keeps the first time an entity was seen across runs", () => {
    const first = buildGoogleSecopsGeneration({
      fill: observation({ answers: [answered({ ids: ["f1"], rpc: "ListFeeds" })] }),
      prior: emptyPrior(),
    });
    const second = buildGoogleSecopsGeneration({
      fill: observation({ answers: [answered({ ids: ["f1"], rpc: "ListFeeds" })], at: LATER }),
      prior: first,
    });
    const api = second.files.feed.entities[0]!.channels.api!;
    expect([api.firstSeenAt, api.lastSeenAt]).toStrictEqual([AT, LATER]);
  });
});

describe("syncGoogleSecopsAtlas", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  /** A fill over an instance holding one S3 feed whose settings carry a (fake) secret. */
  async function feedFill({ at }: { at: string }): Promise<GoogleSecopsFillObservation> {
    const get: SecopsGet = ({ url }) => {
      if (!url.pathname.endsWith("/feeds")) {
        return Promise.resolve(ok({}));
      }
      return Promise.resolve(
        ok({
          feeds: [
            {
              details: {
                amazonS3V2Settings: { authentication: { secretAccessKey: FAKE_SECRET } },
                feedSourceType: "AMAZON_S3_V2",
              },
              name: `${NAME}/feeds/f1`,
              state: "ACTIVE",
            },
          ],
        }),
      );
    };
    return runGoogleSecopsFill({ at, get, instance: unwrap(parseSecopsInstance({ value: NAME })) });
  }

  it("publishes a generation the read adapter serves, with the feed's settings named and never stored", async () => {
    const home = mkdtempSync(join(tmpdir(), "secops-sync-"));
    dirs.push(home);
    const report = unwrap(syncGoogleSecopsAtlas({ fill: await feedFill({ at: AT }), home }));
    expect(report.entitiesByKind.find((row) => row.kind === "feed")!.entities).toBe(1);
    const read = unwrap(readGoogleSecopsSnapshot({ home }));
    // Every kind file is vouched for: a blocked kind's manifest records its block, not a half-write.
    expect(read.generation.unpublished).toStrictEqual([]);
    const feed = read.kinds.find((kind) => kind.kind === "feed")!;
    expect(feed.entities.map((entity) => entity.detail)).toStrictEqual([
      {
        displayName: null,
        errorCode: null,
        family: "feed",
        feedSourceType: "AMAZON_S3_V2",
        logType: null,
        settingsField: "amazonS3V2Settings",
        state: "ACTIVE",
      },
    ]);
    expect(feed.entities[0]!.observations.map((seen) => seen.surface)).toStrictEqual(["chronicle-api-v1"]);
    expect(report.written.length).toBeGreaterThan(0);
    const onDisk = report.written.map((path) => readFileSync(path, "utf8")).join("\n");
    expect(onDisk).toContain("amazonS3V2Settings");
    expect(onDisk).not.toContain(FAKE_SECRET);
  });

  it("publishes a second generation over the first", async () => {
    const home = mkdtempSync(join(tmpdir(), "secops-sync-"));
    dirs.push(home);
    unwrap(syncGoogleSecopsAtlas({ fill: await feedFill({ at: AT }), home }));
    unwrap(syncGoogleSecopsAtlas({ fill: await feedFill({ at: LATER }), home }));
    const feed = unwrap(readGoogleSecopsSnapshot({ home })).kinds.find((kind) => kind.kind === "feed")!;
    expect(feed.lastSuccessAt).toBe(LATER);
  });

  it("refuses to publish a kind never read beside real ones when its list failed for a reason other than permission", () => {
    const home = mkdtempSync(join(tmpdir(), "secops-sync-"));
    dirs.push(home);
    const refused = unwrapErr(
      syncGoogleSecopsAtlas({ fill: observation({ failures: [failed({ rpc: "ListFeeds", status: 500 })] }), home }),
    );
    expect(refused[0]).toBe("the google-secops atlas would publish feed while having never acquired it");
  });
});
