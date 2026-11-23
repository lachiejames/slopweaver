import { describe, expect, it } from "vitest";

import type { BrazeCollectionOperationRow } from "../../../../atlas/braze/collection.js";
import {
  BRAZE_API_SURFACE,
  BRAZE_COLLECTION_SURFACE,
  BRAZE_DASHBOARD_SURFACE,
  BRAZE_DOCS_SURFACE,
  brazeCoverageFreshness,
  failedBrazeCoverageCell,
  operationCoverage,
  succeededBrazeCoverageCell,
} from "../../../../atlas/braze/coverage.js";
import type { BrazeDocsOperationRow } from "../../../../atlas/braze/docsCatalogue.js";
import {
  BRAZE_CHANNELS,
  type BrazeArtifactRef,
  type BrazeChannel,
  type BrazeCoverageCell,
  emptyBrazeKindFile,
} from "../../../../atlas/braze/model.js";

const AT = "2026-10-12T07:00:00.000Z";
const RUN_AT = "2026-10-12T11:00:00.000Z";
const NOW_MS = Date.parse("2026-10-12T12:00:00.000Z");
/** The descriptor declares the pinned window: fourteen days. */
const WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

const PROOF: BrazeArtifactRef = {
  byteLength: 512,
  kind: "page-png",
  mediaType: "image/png",
  relativePath: "proof/dashboard.png",
  sha256: "c".repeat(64),
};

const SCOPE_BY_CHANNEL: readonly (readonly [BrazeChannel, string])[] = [
  ["docs", "docs-published-reference"],
  ["collection", "collection-published-postman"],
  ["api", "api-workspace-key"],
  ["browser", "browser-signed-in-role"],
];

function succeeded({ channel, at }: { channel: BrazeChannel; at: string }): BrazeCoverageCell {
  return succeededBrazeCoverageCell({
    artifacts: [PROOF],
    at,
    channel,
    reason: "read every operation",
    role: "authoritative",
    scope: "operations",
    state: "synced",
    surface: "rest-api",
  });
}

function failed({
  channel,
  previous,
}: {
  channel: BrazeChannel;
  previous: BrazeCoverageCell | null;
}): BrazeCoverageCell {
  return failedBrazeCoverageCell({
    channel,
    previous,
    reason: "r",
    role: "authoritative",
    scope: "s",
    state: "unavailable",
    surface: "rest-api",
    unblockedBy: null,
  });
}

function docsRow(): BrazeDocsOperationRow {
  return {
    disposition: "reachable",
    dispositionReason: "a listable read",
    dispositionRuleId: "rule-a",
    kind: "messaging",
    lastModified: "2026-09-01",
    method: "GET",
    parameters: [],
    pathDefect: null,
    pathShape: "/messages/scheduled_broadcasts",
    providerId: "get /messages/scheduled_broadcasts",
    rateLimit: null,
    responseFields: [],
    title: "List upcoming scheduled campaigns",
    url: "https://www.braze.com/docs/api/endpoints/messaging/example",
  };
}

function collectionRow(): BrazeCollectionOperationRow {
  return {
    disposition: "reachable",
    dispositionReason: "a listable read",
    dispositionRuleId: "rule-a",
    folders: ["Messaging"],
    headers: [],
    method: "GET",
    name: "List upcoming scheduled campaigns",
    pathDefect: null,
    pathShape: "/messages/scheduled_broadcasts",
    providerId: "get /messages/scheduled_broadcasts",
    queryParams: [],
    requestBodyFields: [],
  };
}

const SENTINEL: BrazeCoverageCell = {
  artifacts: [],
  channel: "browser",
  lastSuccessAt: "2026-10-01T00:00:00.000Z",
  latestAttemptFailed: false,
  reason: "an unmanaged surface a later channel added",
  role: "discovery",
  scope: "sentinel-scope",
  state: "synced",
  surface: "sentinel-surface",
  unblockedBy: null,
  visibilityScope: "browser-signed-in-role",
};

const REST_PRIOR: BrazeCoverageCell = {
  artifacts: [PROOF],
  channel: "api",
  lastSuccessAt: "2026-10-02T00:00:00.000Z",
  latestAttemptFailed: false,
  reason: "an earlier live call",
  role: "authoritative",
  scope: "workspace-entities",
  state: "synced",
  surface: BRAZE_API_SURFACE,
  unblockedBy: null,
  visibilityScope: "api-workspace-key",
};

const DASHBOARD_PRIOR: BrazeCoverageCell = {
  artifacts: [PROOF],
  channel: "browser",
  lastSuccessAt: "2026-10-03T00:00:00.000Z",
  latestAttemptFailed: false,
  reason: "an earlier walk",
  role: "corroborating",
  scope: "dashboard-pages",
  state: "synced",
  surface: BRAZE_DASHBOARD_SURFACE,
  unblockedBy: null,
  visibilityScope: "browser-signed-in-role",
};

const REST_REASON =
  "no Braze workspace API key is configured, so the REST API has never been called and no entity of " +
  "this workspace has been read. Every operation above is a declaration, not a capability";
const REST_UNBLOCKED_BY =
  "a read-only workspace API key from the dashboard's Settings > API Keys page, which needs the Braze " +
  "account this installation does not have — an access request the owner raises, never this atlas";
const DASHBOARD_REASON =
  "this installation has no Braze account, so no dashboard page has been reached, photographed or " +
  "graded for this kind";
const DASHBOARD_UNBLOCKED_BY =
  "a Braze dashboard invite at the level `SOP: Braze Access` describes, then a walk of the declared " +
  "routes in the owner's own Chrome";

function kindFile({ coverage }: { coverage: BrazeCoverageCell[] }): ReturnType<typeof emptyBrazeKindFile> {
  return { ...emptyBrazeKindFile({ kind: "messaging", updatedAt: AT }), coverage };
}

describe("succeededBrazeCoverageCell", () => {
  it("stamps the whole cell as a fresh success under the channel's own ceiling", () => {
    expect(succeeded({ at: AT, channel: "docs" })).toStrictEqual({
      artifacts: [PROOF],
      channel: "docs",
      lastSuccessAt: AT,
      latestAttemptFailed: false,
      reason: "read every operation",
      role: "authoritative",
      scope: "operations",
      state: "synced",
      surface: "rest-api",
      unblockedBy: null,
      visibilityScope: "docs-published-reference",
    });
  });

  it("maps every channel to its own visibility scope", () => {
    expect(BRAZE_CHANNELS.length).toBeGreaterThan(0);
    expect(SCOPE_BY_CHANNEL.map(([channel]) => channel)).toStrictEqual([...BRAZE_CHANNELS]);
    expect(SCOPE_BY_CHANNEL.map(([channel]) => succeeded({ at: AT, channel }).visibilityScope)).toStrictEqual(
      SCOPE_BY_CHANNEL.map(([, scope]) => scope),
    );
  });

  it("copies the artifacts rather than aliasing the caller's array", () => {
    const artifacts = [PROOF];
    const cell = succeededBrazeCoverageCell({
      artifacts,
      at: AT,
      channel: "browser",
      reason: "r",
      role: "corroborating",
      scope: "s",
      state: "synced",
      surface: "dashboard",
    });
    artifacts.push({ ...PROOF, relativePath: "proof/other.png" });
    expect(cell.artifacts).toStrictEqual([PROOF]);
  });
});

describe("failedBrazeCoverageCell", () => {
  it("keeps the prior success and artifacts while the attempt's own fields replace the rest", () => {
    const previous = succeeded({ at: AT, channel: "docs" });
    const cell = failedBrazeCoverageCell({
      channel: "api",
      previous,
      reason: "the key was revoked",
      role: "corroborating",
      scope: "workspace-entities",
      state: "invalid-configuration",
      surface: "rest-api",
      unblockedBy: "issue a new key",
    });
    expect(cell).toStrictEqual({
      artifacts: [PROOF],
      channel: "api",
      lastSuccessAt: AT,
      latestAttemptFailed: true,
      reason: "the key was revoked",
      role: "corroborating",
      scope: "workspace-entities",
      state: "invalid-configuration",
      surface: "rest-api",
      unblockedBy: "issue a new key",
      visibilityScope: "api-workspace-key",
    });
    expect(cell.artifacts).not.toBe(previous.artifacts);
  });

  it("has no success to carry when the surface was never touched", () => {
    const cell = failed({ channel: "api", previous: null });
    expect(cell.lastSuccessAt).toBe(null);
    expect(cell.artifacts).toStrictEqual([]);
    expect(cell.latestAttemptFailed).toBe(true);
    expect(cell.unblockedBy).toBe(null);
  });

  it("maps every channel to its own visibility scope", () => {
    const scopes = SCOPE_BY_CHANNEL.map(([channel]) => failed({ channel, previous: null }).visibilityScope);
    expect(scopes).toStrictEqual(SCOPE_BY_CHANNEL.map(([, scope]) => scope));
  });

  it("copies the prior artifacts rather than aliasing them", () => {
    const previous = succeeded({ at: AT, channel: "docs" });
    const cell = failed({ channel: "docs", previous });
    previous.artifacts.push({ ...PROOF, relativePath: "proof/other.png" });
    expect(cell.artifacts).toStrictEqual([PROOF]);
  });
});

describe("brazeCoverageFreshness", () => {
  it("judges against the descriptor's declared window, so a five-hour-old success is still current", () => {
    const verdict = brazeCoverageFreshness({ cell: succeeded({ at: AT, channel: "docs" }), nowMs: NOW_MS });
    expect(verdict.verdict).toBe("current");
    expect(verdict.mayQuoteAsCurrent).toBe(true);
    expect(verdict.windowMs).toBe(WINDOW_MS);
    expect(verdict.ageMs).toBe(5 * 60 * 60 * 1000);
  });

  it("is still current exactly at the window's edge", () => {
    const at = new Date(NOW_MS - WINDOW_MS).toISOString();
    const verdict = brazeCoverageFreshness({ cell: succeeded({ at, channel: "docs" }), nowMs: NOW_MS });
    expect(verdict.verdict).toBe("current");
  });

  it("is historical one minute past the declared window", () => {
    const at = new Date(NOW_MS - WINDOW_MS - 60_000).toISOString();
    const verdict = brazeCoverageFreshness({ cell: succeeded({ at, channel: "docs" }), nowMs: NOW_MS });
    expect(verdict.verdict).toBe("historical");
    expect(verdict.mayQuoteAsCurrent).toBe(false);
    expect(verdict.windowMs).toBe(WINDOW_MS);
  });

  it("is historical inside the window when the latest attempt failed", () => {
    const cell = failed({ channel: "api", previous: succeeded({ at: AT, channel: "api" }) });
    expect(brazeCoverageFreshness({ cell, nowMs: NOW_MS }).verdict).toBe("historical");
  });

  it("is never-synced for a cell with no success", () => {
    const cell = failed({ channel: "api", previous: null });
    expect(brazeCoverageFreshness({ cell, nowMs: NOW_MS }).verdict).toBe("never-synced");
  });
});

describe("operationCoverage", () => {
  it("keeps the unmanaged cell first and rebuilds the four managed surfaces in order, however the store ordered them", () => {
    const result = operationCoverage({
      at: RUN_AT,
      collectionRows: [],
      docsRows: [docsRow(), docsRow()],
      stored: kindFile({ coverage: [DASHBOARD_PRIOR, SENTINEL, REST_PRIOR] }),
    });
    expect(result).toStrictEqual([
      SENTINEL,
      {
        artifacts: [],
        channel: "docs",
        lastSuccessAt: RUN_AT,
        latestAttemptFailed: false,
        reason:
          "2 operation(s) read from Braze's own endpoint reference. This says the published pages were read in " +
          "full and nothing about what this installation may call",
        role: "authoritative",
        scope: "published-reference-operations",
        state: "synced",
        surface: BRAZE_DOCS_SURFACE,
        unblockedBy: null,
        visibilityScope: "docs-published-reference",
      },
      {
        artifacts: [],
        channel: "collection",
        lastSuccessAt: RUN_AT,
        latestAttemptFailed: false,
        reason:
          "0 operation(s) read from Braze's official Postman collection. It is corroborating rather than " +
          "authoritative: where it disagrees with the reference, the reference is the vendor describing its " +
          "product and this is a convenience artefact that has drifted",
        role: "corroborating",
        scope: "published-collection-operations",
        state: "synced",
        surface: BRAZE_COLLECTION_SURFACE,
        unblockedBy: null,
        visibilityScope: "collection-published-postman",
      },
      {
        artifacts: [PROOF],
        channel: "api",
        lastSuccessAt: "2026-10-02T00:00:00.000Z",
        latestAttemptFailed: true,
        reason: REST_REASON,
        role: "authoritative",
        scope: "workspace-entities",
        state: "not-configured",
        surface: BRAZE_API_SURFACE,
        unblockedBy: REST_UNBLOCKED_BY,
        visibilityScope: "api-workspace-key",
      },
      {
        artifacts: [PROOF],
        channel: "browser",
        lastSuccessAt: "2026-10-03T00:00:00.000Z",
        latestAttemptFailed: true,
        reason: DASHBOARD_REASON,
        role: "corroborating",
        scope: "dashboard-pages",
        state: "not-configured",
        surface: BRAZE_DASHBOARD_SURFACE,
        unblockedBy: DASHBOARD_UNBLOCKED_BY,
        visibilityScope: "browser-signed-in-role",
      },
    ]);
  });

  it("counts the collection's rows in its own reason and carries no prior success on a first sync", () => {
    const result = operationCoverage({
      at: RUN_AT,
      collectionRows: [collectionRow(), collectionRow(), collectionRow()],
      docsRows: [],
      stored: kindFile({ coverage: [] }),
    });
    expect(result.map((cell) => cell.surface)).toStrictEqual([
      BRAZE_DOCS_SURFACE,
      BRAZE_COLLECTION_SURFACE,
      BRAZE_API_SURFACE,
      BRAZE_DASHBOARD_SURFACE,
    ]);
    expect(result[0]!.reason).toBe(
      "0 operation(s) read from Braze's own endpoint reference. This says the published pages were read in " +
        "full and nothing about what this installation may call",
    );
    expect(result[1]!.reason).toBe(
      "3 operation(s) read from Braze's official Postman collection. It is corroborating rather than " +
        "authoritative: where it disagrees with the reference, the reference is the vendor describing its " +
        "product and this is a convenience artefact that has drifted",
    );
    expect(result[2]!.lastSuccessAt).toBe(null);
    expect(result[2]!.artifacts).toStrictEqual([]);
    expect(result[3]!.lastSuccessAt).toBe(null);
    expect(result[3]!.artifacts).toStrictEqual([]);
  });

  it("does not alias the stored cells' artifacts into the rebuilt row", () => {
    const stored = kindFile({ coverage: [{ ...REST_PRIOR, artifacts: [PROOF] }] });
    const result = operationCoverage({ at: RUN_AT, collectionRows: [], docsRows: [], stored });
    stored.coverage[0]!.artifacts.push({ ...PROOF, relativePath: "proof/other.png" });
    expect(result[2]!.artifacts).toStrictEqual([PROOF]);
  });
});
