import { describe, expect, it } from "vitest";

import { KNOCK_ROUTES } from "../../../../atlas/knock/generated/routes.js";
import { KNOCK_SURFACES } from "../../../../atlas/knock/generated/surfaces.js";
import { knockEntityId } from "../../../../atlas/knock/identity.js";
import type { KnockEntity, KnockMethodApiDetail } from "../../../../atlas/knock/model.js";
import {
  KNOCK_ROUTES_SURFACE,
  KNOCK_SPEC_SURFACE,
  KNOCK_WALK_SURFACE,
  projectKnockMethods,
  projectKnockRoutes,
} from "../../../../atlas/knock/projection.js";

const AT = "2026-10-01T00:00:00.000Z";
const BUILD_MANIFEST = "https://dashboard.knock.app/_next/static/HyftbuwlLzQG_GZ7ebguU/_buildManifest.js";

/** The mutating-operation sentence the generated registry stores on a DELETE row. */
const DELETE_BECAUSE = "DELETE changes the account, and this atlas only ever reads";
/** The sentence the generated registry stores on a shape-indexed observation family. */
const SHAPE_BECAUSE =
  "its records are observations Knock emits rather than configuration somebody created — unbounded, growing with the clock, identified by an instant — so only the family's shape is stored";

/** A method entity carrying only its `api` channel, the way the registry projection assembles one. */
function methodEntity({
  providerId,
  detail,
  deepLink,
  endpoint,
}: {
  providerId: string;
  detail: KnockMethodApiDetail;
  deepLink: string;
  endpoint: string;
}): KnockEntity {
  return {
    channels: {
      api: {
        channel: "api",
        detail,
        firstSeenAt: AT,
        lastSeenAt: AT,
        source: {
          artifacts: [],
          channel: "api",
          deepLink,
          deepLinkStatus: "provider-provided",
          endpoint,
          observedAt: AT,
        },
        state: "observed",
      },
      browser: null,
    },
    id: knockEntityId({ kind: "method", providerId }),
    kind: "method",
    providerId,
    scope: null,
  };
}

/** A dashboard-route entity carrying only its `api` channel, with no per-route address. */
function routeEntity({
  route,
  detail,
}: {
  route: string;
  detail: {
    apiBacked: boolean;
    kind: string | null;
    parameters: string[];
    scope: (typeof KNOCK_ROUTES)[number]["scope"];
    walkable: boolean;
  };
}): KnockEntity {
  return {
    channels: {
      api: {
        channel: "api",
        detail,
        firstSeenAt: AT,
        lastSeenAt: AT,
        source: {
          artifacts: [],
          channel: "api",
          deepLink: null,
          deepLinkStatus: "unavailable",
          endpoint: `${BUILD_MANIFEST}#${route}`,
          observedAt: AT,
        },
        state: "observed",
      },
      browser: null,
    },
    id: knockEntityId({ kind: "dashboard-route", providerId: route }),
    kind: "dashboard-route",
    providerId: route,
    scope: null,
  };
}

describe("surface names", () => {
  it("names the three coverage surfaces exactly", () => {
    expect({
      routes: KNOCK_ROUTES_SURFACE,
      spec: KNOCK_SPEC_SURFACE,
      walk: KNOCK_WALK_SURFACE,
    }).toEqual({ routes: "browser-routes", spec: "spec-declared", walk: "dashboard-walk" });
  });
});

describe("projectKnockMethods", () => {
  const projected = projectKnockMethods({ at: AT });
  const byProviderId = ({ providerId }: { providerId: string }): KnockEntity =>
    projected.find((entity) => entity.providerId === providerId)!;

  it("projects all 216 registry operations in the registry's own order", () => {
    expect(projected).toHaveLength(216);
    expect(projected.map((entity) => entity.providerId)).toEqual(
      KNOCK_SURFACES.map((row) => `${row.api} ${row.method} ${row.path}`),
    );
  });

  it("projects the first committed data-API row whole, under an API-qualified provider id", () => {
    expect(projected[0]).toEqual(
      methodEntity({
        deepLink: "https://docs.knock.app/api-reference/audiences/removeAudienceMembers",
        detail: {
          api: "data",
          deprecated: false,
          disposition: "excluded",
          dispositionBecause: DELETE_BECAUSE,
          environmentScoped: false,
          exclusionReason: "mutating",
          identifierFrom: "other-api",
          method: "DELETE",
          operationId: "removeAudienceMembers",
          paging: "none",
          path: "/v1/audiences/{key}/members",
          probeEvidence: "unprobed-mutating",
          responseFieldCount: 0,
          summary: "Remove members",
          tag: "Audiences",
        },
        endpoint: "https://api.knock.app/v1/openapi#removeAudienceMembers",
        providerId: "data DELETE /v1/audiences/{key}/members",
      }),
    );
  });

  it("projects a deprecated row whole, carrying its own deprecation rather than the first row's", () => {
    const providerId = "data PUT /v1/objects/{collection}/{object_id}/preferences/{id}/categories";
    expect(byProviderId({ providerId })).toEqual(
      methodEntity({
        deepLink: "https://docs.knock.app/api-reference/objects/updateObjectPreferenceCategories",
        detail: {
          api: "data",
          deprecated: true,
          disposition: "excluded",
          dispositionBecause: "PUT changes the account, and this atlas only ever reads",
          environmentScoped: false,
          exclusionReason: "mutating",
          identifierFrom: "unavailable",
          method: "PUT",
          operationId: "updateObjectPreferenceCategories",
          paging: "none",
          path: "/v1/objects/{collection}/{object_id}/preferences/{id}/categories",
          probeEvidence: "unprobed-mutating",
          responseFieldCount: 22,
          summary: "Update categories in preference set",
          tag: "Objects",
        },
        endpoint: "https://api.knock.app/v1/openapi#updateObjectPreferenceCategories",
        providerId,
      }),
    );
  });

  it("carries each registry row's own detail, every field of it, across all 216 operations", () => {
    expect(KNOCK_SURFACES.filter((row) => row.deprecated).length).toBeGreaterThan(0);
    expect(projected).toEqual(
      KNOCK_SURFACES.map((row) =>
        expect.objectContaining({
          channels: expect.objectContaining({
            api: expect.objectContaining({
              detail: {
                api: row.api,
                deprecated: row.deprecated,
                disposition: row.disposition,
                dispositionBecause: row.dispositionBecause,
                environmentScoped: row.environmentScoped,
                exclusionReason: row.exclusionReason,
                identifierFrom: row.identifierFrom,
                method: row.method,
                operationId: row.operationId,
                paging: row.paging,
                path: row.path,
                probeEvidence: row.probeEvidence,
                responseFieldCount: row.responseFieldCount,
                summary: row.summary,
                tag: row.tag,
              },
            }),
          }),
        }),
      ),
    );
  });

  it("keeps a collision-suffixed operation id in the endpoint and strips it from the reference page", () => {
    expect(byProviderId({ providerId: "data DELETE /v1/messages/{message_id}/archived" })).toEqual(
      methodEntity({
        deepLink: "https://docs.knock.app/api-reference/messages/unarchiveMessage",
        detail: {
          api: "data",
          deprecated: false,
          disposition: "excluded",
          dispositionBecause: DELETE_BECAUSE,
          environmentScoped: false,
          exclusionReason: "mutating",
          identifierFrom: "same-api",
          method: "DELETE",
          operationId: "unarchiveMessage (2)",
          paging: "none",
          path: "/v1/messages/{message_id}/archived",
          probeEvidence: "unprobed-mutating",
          responseFieldCount: 47,
          summary: "Unarchive message",
          tag: "Messages",
        },
        endpoint: "https://api.knock.app/v1/openapi#unarchiveMessage (2)",
        providerId: "data DELETE /v1/messages/{message_id}/archived",
      }),
    );
  });

  it("turns a multi-word tag into an underscore-joined lower-case reference section", () => {
    expect(
      byProviderId({
        providerId: "data DELETE /v1/objects/{collection}/{object_id}/channel_data/{channel_id}",
      }),
    ).toEqual(
      methodEntity({
        deepLink: "https://docs.knock.app/api-reference/channel_data/unsetObjectChannelData",
        detail: {
          api: "data",
          deprecated: false,
          disposition: "excluded",
          dispositionBecause: DELETE_BECAUSE,
          environmentScoped: false,
          exclusionReason: "mutating",
          identifierFrom: "unavailable",
          method: "DELETE",
          operationId: "unsetObjectChannelData",
          paging: "none",
          path: "/v1/objects/{collection}/{object_id}/channel_data/{channel_id}",
          probeEvidence: "unprobed-mutating",
          responseFieldCount: 0,
          summary: "Unset channel data",
          tag: "Channel data",
        },
        endpoint: "https://api.knock.app/v1/openapi#unsetObjectChannelData",
        providerId: "data DELETE /v1/objects/{collection}/{object_id}/channel_data/{channel_id}",
      }),
    );
  });

  it("carries a paged shape-indexed observation row's disposition, paging and field count", () => {
    expect(byProviderId({ providerId: "data GET /v1/messages" })).toEqual(
      methodEntity({
        deepLink: "https://docs.knock.app/api-reference/messages/listMessages",
        detail: {
          api: "data",
          deprecated: false,
          disposition: "shape-index",
          dispositionBecause: SHAPE_BECAUSE,
          environmentScoped: false,
          exclusionReason: null,
          identifierFrom: "none",
          method: "GET",
          operationId: "listMessages",
          paging: "cursor-page-size",
          path: "/v1/messages",
          probeEvidence: "exists-auth-required",
          responseFieldCount: 53,
          summary: "List messages",
          tag: "Messages",
        },
        endpoint: "https://api.knock.app/v1/openapi#listMessages",
        providerId: "data GET /v1/messages",
      }),
    );
  });

  it("projects a management-API row against the management reference root and document", () => {
    expect(byProviderId({ providerId: "management DELETE /v1/audiences/{audience_key}" })).toEqual(
      methodEntity({
        deepLink: "https://docs.knock.app/mapi-reference/audiences/archiveAudience",
        detail: {
          api: "management",
          deprecated: false,
          disposition: "excluded",
          dispositionBecause: DELETE_BECAUSE,
          environmentScoped: true,
          exclusionReason: "mutating",
          identifierFrom: "same-api",
          method: "DELETE",
          operationId: "archiveAudience",
          paging: "none",
          path: "/v1/audiences/{audience_key}",
          probeEvidence: "unprobed-mutating",
          responseFieldCount: 1,
          summary: "Archive an audience",
          tag: "Audiences",
        },
        endpoint: "https://control.knock.app/v1/openapi#archiveAudience",
        providerId: "management DELETE /v1/audiences/{audience_key}",
      }),
    );
  });

  it("gives one path declared by both APIs two distinct entities", () => {
    const dataId = byProviderId({ providerId: "data DELETE /v1/audiences/{key}/members" }).id;
    const managementId = byProviderId({ providerId: "management DELETE /v1/audiences/{audience_key}" }).id;
    expect(dataId).not.toBe(managementId);
  });
});

describe("projectKnockRoutes", () => {
  const projected = projectKnockRoutes({ at: AT });
  const byRoute = ({ route }: { route: string }): KnockEntity =>
    projected.find((entity) => entity.providerId === route)!;

  it("projects all 154 dashboard routes in the registry's own order", () => {
    expect(projected).toHaveLength(154);
    expect(projected.map((entity) => entity.providerId)).toEqual(KNOCK_ROUTES.map((row) => row.route));
  });

  it("projects every route whole from its own registry row, walkable or not", () => {
    expect(KNOCK_ROUTES.filter((row) => !row.walkable).length).toBeGreaterThan(0);
    expect(KNOCK_ROUTES.filter((row) => !row.apiBacked).length).toBeGreaterThan(0);
    expect(projected).toEqual(
      KNOCK_ROUTES.map((row) =>
        routeEntity({
          detail: {
            apiBacked: row.apiBacked,
            kind: row.kind,
            parameters: [...row.parameters],
            scope: row.scope,
            walkable: row.walkable,
          },
          route: row.route,
        }),
      ),
    );
  });

  it("projects the account root route whole, with no per-route address", () => {
    expect(byRoute({ route: "/" })).toEqual(
      routeEntity({
        detail: { apiBacked: true, kind: "account", parameters: [], scope: "account", walkable: true },
        route: "/",
      }),
    );
  });

  it("projects a browser-only parameterised route whole, keeping its parameters in path order", () => {
    expect(byRoute({ route: "/[slug]/[environment]/analytics" })).toEqual(
      routeEntity({
        detail: {
          apiBacked: false,
          kind: null,
          parameters: ["slug", "environment"],
          scope: "environment",
          walkable: true,
        },
        route: "/[slug]/[environment]/analytics",
      }),
    );
  });
});
