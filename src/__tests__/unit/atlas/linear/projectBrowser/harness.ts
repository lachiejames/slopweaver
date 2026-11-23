/*
 * What the Linear browser-channel projection test files share: the run instant and workspace address, the
 * screenshot builder and the screenshots more than one file reads, the three reached settings pages, a reading
 * that ran, the page and operation entities those pages project to, the walk coverage cell, the browser gap
 * builder, and the gaps and empty coverage more than one file expects.
 */
import type { AtlasArtifactRef } from "../../../../../atlas/kit/contract.js";
import { stableGapId } from "../../../../../atlas/kit/identity.js";
import type { LinearBrowserObservations } from "../../../../../atlas/linear/graphqlObservations.js";
import type {
  LinearAtlasEntity,
  LinearAtlasGap,
  LinearAtlasKind,
  LinearCoverageCell,
  LinearPageDetail,
} from "../../../../../atlas/linear/model.js";
import type { LinearBrowserReading } from "../../../../../atlas/linear/projectionKit.js";
import type { LinearPageObservation } from "../../../../../atlas/linear/walk.js";

export const AT = "2026-10-12T05:06:07.000Z";
export const BASE = "https://linear.app/acme";

/**
 * One screenshot reference, unique in every field.
 *
 * @param name the file stem, which also distinguishes the path
 * @param sha the digest character, repeated to a full digest
 * @param byteLength how many bytes the screenshot held
 * @returns the artifact reference
 */
export function art({ name, sha, byteLength }: { name: string; sha: string; byteLength: number }): AtlasArtifactRef {
  return {
    byteLength,
    kind: "page-png",
    mediaType: "image/png",
    relativePath: `artifacts/settings/${name}.png`,
    sha256: sha.repeat(64),
  };
}

export const ART_WORKSPACE = art({ byteLength: 101, name: "workspace", sha: "1" });
export const ART_LABELS_A = art({ byteLength: 303, name: "labels-a", sha: "3" });
export const ART_LABELS_B = art({ byteLength: 404, name: "labels-b", sha: "4" });
export const ART_WORKFLOW = art({ byteLength: 505, name: "workflow", sha: "5" });

/* Every page differs in outcome, capture, URLs, title, status, time, call count and artifacts. */
export const P_WORKSPACE: LinearPageObservation = {
  area: "workspace",
  artifacts: [ART_WORKSPACE],
  captureComplete: true,
  finalUrl: `${BASE}/settings/workspace?tab=general`,
  graphqlCallCount: 4,
  observedAt: "2026-10-12T01:00:01.000Z",
  outcome: "reached",
  pageScope: "workspace",
  providerId: "/settings/workspace",
  requestedUrl: `${BASE}/settings/workspace`,
  statusCode: 200,
  title: "Workspace · General",
};

export const P_LABELS: LinearPageObservation = {
  area: "team",
  artifacts: [ART_LABELS_A, ART_LABELS_B],
  captureComplete: false,
  finalUrl: `${BASE}/settings/teams/ENG/labels#top`,
  graphqlCallCount: 9,
  observedAt: "2026-10-12T01:00:03.000Z",
  outcome: "reached",
  pageScope: "ENG",
  providerId: "/settings/teams/ENG/labels",
  requestedUrl: `${BASE}/settings/teams/ENG/labels`,
  statusCode: 203,
  title: "ENG · Labels",
};

/* The null-boundary reached page: no title, no settle time, no final address. */
export const P_WORKFLOW: LinearPageObservation = {
  area: "team",
  artifacts: [ART_WORKFLOW],
  captureComplete: false,
  finalUrl: null,
  graphqlCallCount: 2,
  observedAt: null,
  outcome: "reached",
  pageScope: "OPS",
  providerId: "/settings/teams/OPS/workflow",
  requestedUrl: `${BASE}/settings/teams/OPS/workflow`,
  statusCode: 204,
  title: null,
};

export const REACHED_PAGES = [P_WORKSPACE, P_LABELS, P_WORKFLOW];

const OBSERVATIONS: LinearBrowserObservations = {
  graphqlResponses: 23,
  observations: [
    {
      detail: { callCount: 6, responsePaths: ["viewer.id", "viewer.name"], responsePathsTotal: 2 },
      providerId: "query.viewer",
    },
    { detail: { callCount: 3, responsePaths: ["teams.nodes"], responsePathsTotal: 41 }, providerId: "query.teams" },
  ],
  unexplainedKeys: ["ghostKey", "phantomField"],
  unresolvedRequests: 13,
};

/**
 * A browser reading that ran.
 *
 * @param pages the walk's page rows
 * @param limited whether the run was bounded by `--limit`
 * @returns the reading
 */
export function ranReading({
  pages,
  limited,
}: {
  pages: readonly LinearPageObservation[];
  limited: boolean;
}): LinearBrowserReading {
  return { limited, observations: OBSERVATIONS, pages, unavailableBecause: null };
}

/**
 * The entity one reached page must project to.
 *
 * @param providerId the route
 * @param detail the page detail the browser channel must carry
 * @param artifacts the page's own screenshots
 * @param deepLink the address the page settled on, or `null`
 * @param observedAt when the page was observed
 * @returns the expected entity
 */
function pageEntity({
  providerId,
  detail,
  artifacts,
  deepLink,
  observedAt,
}: {
  providerId: string;
  detail: LinearPageDetail;
  artifacts: readonly AtlasArtifactRef[];
  deepLink: string | null;
  observedAt: string;
}): LinearAtlasEntity {
  return {
    channels: {
      api: null,
      browser: {
        channel: "browser",
        detail,
        firstSeenAt: AT,
        lastSeenAt: AT,
        source: {
          artifacts: [...artifacts],
          channel: "browser",
          deepLink,
          deepLinkStatus: "browser-discovered",
          endpoint: providerId,
          observedAt,
        },
        state: "observed",
      },
    },
    id: `page:${providerId}`,
    kind: "page",
    providerId,
  };
}

/**
 * The entity one observed browser operation must project to.
 *
 * @param providerId the root field
 * @param detail what the web client was seen to get back
 * @returns the expected entity
 */
function operationEntity({ providerId, detail }: { providerId: string; detail: unknown }): LinearAtlasEntity {
  return {
    channels: {
      api: null,
      browser: {
        channel: "browser",
        detail,
        firstSeenAt: AT,
        lastSeenAt: AT,
        source: {
          artifacts: [],
          channel: "browser",
          deepLink: null,
          deepLinkStatus: "unavailable",
          endpoint: "POST /graphql — observed in the first-party web client",
          observedAt: AT,
        },
        state: "observed",
      },
    },
    id: `operation:${providerId}`,
    kind: "operation",
    providerId,
  };
}

export const EXPECTED_PAGE_ENTITIES: LinearAtlasEntity[] = [
  pageEntity({
    artifacts: [ART_WORKSPACE],
    deepLink: `${BASE}/settings/workspace?tab=general`,
    detail: {
      graphqlCallCount: 4,
      redirected: false,
      statusCode: 200,
      title: "Workspace · General",
      url: `${BASE}/settings/workspace?tab=general`,
    },
    observedAt: "2026-10-12T01:00:01.000Z",
    providerId: "/settings/workspace",
  }),
  pageEntity({
    artifacts: [ART_LABELS_A, ART_LABELS_B],
    deepLink: `${BASE}/settings/teams/ENG/labels#top`,
    detail: {
      graphqlCallCount: 9,
      redirected: false,
      statusCode: 203,
      title: "ENG · Labels",
      url: `${BASE}/settings/teams/ENG/labels#top`,
    },
    observedAt: "2026-10-12T01:00:03.000Z",
    providerId: "/settings/teams/ENG/labels",
  }),
  pageEntity({
    artifacts: [ART_WORKFLOW],
    deepLink: null,
    detail: {
      graphqlCallCount: 2,
      redirected: false,
      statusCode: 204,
      title: "",
      url: `${BASE}/settings/teams/OPS/workflow`,
    },
    observedAt: AT,
    providerId: "/settings/teams/OPS/workflow",
  }),
];

export const EXPECTED_OPERATION_ENTITIES: LinearAtlasEntity[] = [
  operationEntity({
    detail: { callCount: 6, responsePaths: ["viewer.id", "viewer.name"], responsePathsTotal: 2 },
    providerId: "query.viewer",
  }),
  operationEntity({
    detail: { callCount: 3, responsePaths: ["teams.nodes"], responsePathsTotal: 41 },
    providerId: "query.teams",
  }),
];

/**
 * A walk coverage cell the browser channel earned.
 *
 * @param artifacts the screenshots the cell must hold
 * @param reason the exact walk reason
 * @param state the grade the walk earned
 * @returns the expected cell
 */
export function walkCell({
  artifacts,
  reason,
  state,
}: {
  artifacts: readonly AtlasArtifactRef[];
  reason: string;
  state: LinearCoverageCell["state"];
}): LinearCoverageCell {
  return {
    artifacts: [...artifacts],
    channel: "browser",
    lastSuccessAt: AT,
    latestAttemptFailed: false,
    reason,
    role: "authoritative",
    scope: "settings-walk",
    state,
    surface: "settings-browser",
    unblockedBy: null,
    visibilityScope: "one-member-session",
  };
}

/**
 * An open gap raised on the browser surface.
 *
 * @param condition the gap condition
 * @param kind the kind the gap is about
 * @param scope the route or walk it concerns
 * @param fields the routes or keys it names
 * @param reason the exact reason it must carry
 * @returns the expected gap
 */
export function browserGap({
  condition,
  kind,
  scope,
  fields,
  reason,
}: {
  condition: string;
  kind: LinearAtlasKind;
  scope: string;
  fields: string[];
  reason: string;
}): LinearAtlasGap {
  return {
    condition,
    fields,
    firstDetectedAt: AT,
    id: stableGapId({ condition, scope }),
    kind,
    lastCheckedAt: AT,
    lastDetectedAt: AT,
    reason,
    scope,
    status: "open",
    surfaces: ["browser"],
  };
}

export const EXPECTED_OPERATION_GAPS: LinearAtlasGap[] = [
  browserGap({
    condition: "request-shape-unresolved",
    fields: [],
    kind: "operation",
    reason:
      "13 captured GraphQL request(s) carried no readable document — a persisted query sends only a hash — so nothing was attributed from them rather than a root field being guessed",
    scope: "settings-walk",
  }),
  browserGap({
    condition: "browser-response-key-unexplained",
    fields: ["ghostKey", "phantomField"],
    kind: "operation",
    reason:
      "these response keys appeared under `data` and no captured document explains them, so they were not attributed to any schema root field",
    scope: "settings-walk",
  }),
];

export const CAPTURE_INCOMPLETE_GAP = browserGap({
  condition: "settings-page-capture-incomplete",
  fields: ["/settings/teams/ENG/labels", "/settings/teams/OPS/workflow"],
  kind: "page",
  reason: "2 page(s) lost at least one response body, so their call census understates what was asked for",
  scope: "settings-walk",
});

export const NO_COVERAGE: Readonly<Record<LinearAtlasKind, readonly LinearCoverageCell[]>> = {
  operation: [],
  page: [],
  setting: [],
  type: [],
};
