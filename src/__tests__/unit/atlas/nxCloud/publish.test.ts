/**
 * The one publish path both Nx Cloud channels take, driven over a real temp-directory generation: what it
 * writes, what it leaves alone, and what the sensitivity gate does and does not refuse.
 */
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { openGap } from "../../../../atlas/kit/gaps.js";
import { endpointEntityId, routeEntityId } from "../../../../atlas/nxCloud/identity.js";
import type {
  NxCloudAtlasChannel,
  NxCloudAtlasEntity,
  NxCloudAtlasGap,
  NxCloudAtlasKind,
  NxCloudCoverageCell,
} from "../../../../atlas/nxCloud/model.js";
import { type NxCloudChannelObservation, publishNxCloudChannel } from "../../../../atlas/nxCloud/publish.js";
import {
  type NxCloudAtlasPaths,
  nxCloudAtlasPaths,
  readNxCloudAtlas,
  readNxCloudKindFile,
} from "../../../../atlas/nxCloud/store.js";
import { unwrap, unwrapErr } from "../../../../lib/result.js";

const AT = "2026-09-05T00:00:00.000Z";
const LATER = "2026-09-06T00:00:00.000Z";
const WORKSPACE = "bbbbbbbbbbbbbbbbbbbbbbbb";
const ENDPOINT_PATH = "/orgs/:orgId/workspaces";

let home: string;
let paths: NxCloudAtlasPaths;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "slopweaver-nx-cloud-publish-"));
  paths = nxCloudAtlasPaths({ home });
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

/** Every entry under the temp home, with each file's bytes, in path order — the whole stored state. */
function homeSnapshot(): readonly (readonly [string, string | null])[] {
  return readdirSync(home, { encoding: "utf8", recursive: true })
    .toSorted((left, right) => left.localeCompare(right))
    .map((entry) => {
      const full = join(home, entry);
      return [entry, statSync(full).isFile() ? readFileSync(full, "utf8") : null] as const;
    });
}

/** One channel's synced coverage cell for one surface. */
function syncedCell({ channel, at }: { channel: NxCloudAtlasChannel; at: string }): NxCloudCoverageCell {
  return {
    artifacts: [],
    channel,
    lastSuccessAt: at,
    latestAttemptFailed: false,
    reason: "1 record(s) read",
    role: "authoritative",
    scope: WORKSPACE,
    state: "synced",
    surface: channel,
    unblockedBy: null,
    visibilityScope: "session-member-role",
  };
}

/** One endpoint as the `web-data` channel sees it, with whatever detail the caller hands it. */
function endpointEntity({ detail, at }: { detail: Record<string, unknown>; at: string }): NxCloudAtlasEntity {
  return {
    channels: {
      browser: null,
      "web-data": { channel: "web-data", detail, firstSeenAt: at, lastSeenAt: at, source: null, state: "observed" },
    },
    id: endpointEntityId({ method: "GET", pathPattern: ENDPOINT_PATH }),
    kind: "endpoint",
    providerId: `GET ${ENDPOINT_PATH}`,
    scope: WORKSPACE,
  };
}

/** A clean endpoint detail, in the shape `model.ts` declares. */
const ENDPOINT_DETAIL = {
  callCount: 2,
  loaderRouteIds: [],
  queryParams: ["page"],
  responseFields: ["workspaces[].id"],
  seenOnRoutes: [],
  statusCode: 200,
};

/** One route as the `browser` channel sees it. */
const ROUTE_ENTITY: NxCloudAtlasEntity = {
  channels: {
    browser: {
      channel: "browser",
      detail: {
        callCount: 0,
        captureComplete: true,
        finalUrl: "https://cloud.nx.app/profile/tokens",
        manifestRouteId: null,
        pathPattern: "/profile/tokens",
        redirected: false,
        responseAccounting: { bodyFailed: 0, bodySucceeded: 0, eligible: 0, seen: 0 },
        statusCode: 200,
        title: "Personal access tokens",
        unreachableBecause: null,
      },
      firstSeenAt: AT,
      lastSeenAt: AT,
      source: null,
      state: "observed",
    },
    "web-data": null,
  },
  id: routeEntityId({ pathPattern: "/profile/tokens" }),
  kind: "route",
  providerId: "/profile/tokens",
  scope: WORKSPACE,
};

/** One open endpoint gap, built through the kit's own constructor. */
const ENDPOINT_GAP: NxCloudAtlasGap = {
  ...openGap({
    at: AT,
    condition: "call-refused",
    fields: [],
    kind: "endpoint",
    reason: "the settings call answered HTTP 403",
    scope: `${WORKSPACE}:settings`,
    surfaces: ["web-data"],
  }),
  fields: [],
  kind: "endpoint",
  surfaces: ["web-data"],
};

/** An observation of ONE kind; every other kind is neither observed nor graded. */
function observationOf({
  kind,
  entities,
  coverage,
  gaps,
}: {
  kind: NxCloudAtlasKind;
  entities: readonly NxCloudAtlasEntity[];
  coverage: readonly NxCloudCoverageCell[];
  gaps: readonly NxCloudAtlasGap[];
}): NxCloudChannelObservation {
  const entitiesByKind: Record<NxCloudAtlasKind, readonly NxCloudAtlasEntity[]> = {
    endpoint: [],
    family: [],
    organization: [],
    route: [],
    workspace: [],
  };
  const coverageByKind: Record<NxCloudAtlasKind, readonly NxCloudCoverageCell[]> = {
    endpoint: [],
    family: [],
    organization: [],
    route: [],
    workspace: [],
  };
  entitiesByKind[kind] = entities;
  coverageByKind[kind] = coverage;
  return { coverage: coverageByKind, entities: entitiesByKind, gaps, rechecks: [] };
}

/** Publish one clean `web-data` endpoint observation at `at`. */
function publishEndpoint({
  detail,
  at,
  denylist,
}: {
  detail: Record<string, unknown>;
  at: string;
  denylist: string[];
}) {
  return publishNxCloudChannel({
    at,
    channel: "web-data",
    denylist,
    observation: observationOf({
      coverage: [syncedCell({ at, channel: "web-data" })],
      entities: [endpointEntity({ at, detail })],
      gaps: [ENDPOINT_GAP],
      kind: "endpoint",
    }),
    paths,
    surface: "web-data",
  });
}

/** Seed the generation with one browser-channel route, the kind an endpoint publish does not observe. */
function seedRoute(): void {
  unwrap(
    publishNxCloudChannel({
      at: AT,
      channel: "browser",
      denylist: [],
      observation: observationOf({
        coverage: [syncedCell({ at: AT, channel: "browser" })],
        entities: [ROUTE_ENTITY],
        gaps: [],
        kind: "route",
      }),
      paths,
      surface: "browser",
    }),
  );
}

describe("publishNxCloudChannel", () => {
  it("writes the endpoint file and the manifest, and counts what it wrote", () => {
    const outcome = unwrap(publishEndpoint({ at: AT, denylist: [], detail: ENDPOINT_DETAIL }));

    expect(outcome).toEqual({
      entityCounts: { endpoint: 1, family: 0, organization: 0, route: 0, workspace: 0 },
      openGapCount: 1,
      written: [paths.kinds.endpoint, paths.manifest],
    });
    expect(unwrap(readNxCloudKindFile({ kind: "endpoint", paths }))).toEqual({
      coverage: [syncedCell({ at: AT, channel: "web-data" })],
      entities: [endpointEntity({ at: AT, detail: ENDPOINT_DETAIL })],
      gaps: [ENDPOINT_GAP],
      kind: "endpoint",
      platform: "nx-cloud",
      schemaVersion: 1,
      updatedAt: AT,
    });
  });

  it("stamps the endpoint kind's manifest status and leaves an unwritten kind never-synced", () => {
    unwrap(publishEndpoint({ at: AT, denylist: [], detail: ENDPOINT_DETAIL }));

    const manifest = unwrap(readNxCloudAtlas({ paths })).manifest!;
    const endpoint = manifest.kinds.endpoint;
    expect({
      entityCount: endpoint.entityCount,
      lastAttempt: endpoint.lastAttempt,
      lastSuccessAt: endpoint.lastSuccessAt,
    }).toEqual({ entityCount: 1, lastAttempt: { at: AT, outcome: "ok", reasons: [] }, lastSuccessAt: AT });
    expect(manifest.kinds.workspace).toEqual({ digest: null, entityCount: 0, lastAttempt: null, lastSuccessAt: null });
  });

  it("leaves a stored route file byte-for-byte as it was when this pass observed only endpoints", () => {
    seedRoute();
    const routeBefore = readFileSync(paths.kinds.route, "utf8");
    const routeStatusBefore = unwrap(readNxCloudAtlas({ paths })).manifest!.kinds.route;

    unwrap(publishEndpoint({ at: LATER, denylist: [], detail: ENDPOINT_DETAIL }));

    expect(unwrap(readNxCloudKindFile({ kind: "route", paths }))!.entities).toEqual([ROUTE_ENTITY]);
    expect(readFileSync(paths.kinds.route, "utf8")).toBe(routeBefore);
    expect(unwrap(readNxCloudAtlas({ paths })).manifest!.kinds.route).toEqual(routeStatusBefore);
  });

  it("publishes an entity carrying a private denylist word, because this atlas records that class", () => {
    const detail = { ...ENDPOINT_DETAIL, seenOnRoutes: ["acme-private-word"] };

    const outcome = publishEndpoint({ at: AT, denylist: ["acme-private-word"], detail });

    expect(unwrap(outcome).written).toEqual([paths.kinds.endpoint, paths.manifest]);
    expect(unwrap(readNxCloudKindFile({ kind: "endpoint", paths }))!.entities).toEqual([
      endpointEntity({ at: AT, detail }),
    ]);
  });

  it("refuses an entity carrying a credential key, and leaves every stored file's bytes unchanged", () => {
    unwrap(publishEndpoint({ at: AT, denylist: [], detail: ENDPOINT_DETAIL }));
    const before = homeSnapshot();

    const refused = publishEndpoint({ at: LATER, denylist: [], detail: { ...ENDPOINT_DETAIL, apiKey: "x" } });

    expect(unwrapErr(refused)).toEqual([
      "refusing to write endpoint file: the sensitivity gate found 1 thing(s) that must never reach this atlas",
      "  entities.0.channels.web-data.detail.apiKey: the key `apiKey` names a credential or a personal identifier " +
        "this atlas never holds [witness 61ea4113f56b]",
      "nothing was written — the value itself is deliberately not printed above",
    ]);
    // The first publish wrote a real generation, so an unchanged snapshot is not an empty one passing vacuously.
    expect(before.some(([entry]) => entry.endsWith(".json"))).toBe(true);
    expect(homeSnapshot()).toEqual(before);
  });
});
