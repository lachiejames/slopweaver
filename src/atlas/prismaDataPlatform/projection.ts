/**
 * Turning the three compiled inventories into atlas entities.
 *
 * All three projections here are OFFLINE. The management-API surface comes from the operation registry
 * generated from the platform's own OpenAPI document, the authorization surface from an endpoint inventory
 * probed against a 404 control, and the console surface from what a signed-out request and the console's own
 * route manifest established — so `slopweaver atlas prisma-data-platform sync` publishes the whole surface
 * map with no network call and no credential, exactly as `atlas figma sync` does.
 *
 * What is NOT here is the entity projection — a workspace, a database, a connection, a service. Those need a
 * credential this installation does not hold, and inventing a shape for them before one exists would be a
 * contract nothing has ever satisfied. `descriptor.ts` says so, and each of those kinds publishes a
 * `not-configured` coverage cell naming what would fill it.
 *
 * ## Every method row carries a deep link, and its status is the honest one
 *
 * For the 45 documented operations the link is the docs page the generator MATCHED to that operation — read
 * from the docs sitemap rather than constructed from the operation id, so it is `provider-provided`. For the
 * other 70 there is no page anywhere, so the link is `null` with status `unavailable`: the provider offers
 * none, which is a different fact from nobody having looked, and the deep-link contract exists to keep those
 * apart.
 */
import { PRISMA_AUTH_ENDPOINTS, PRISMA_AUTH_ORIGIN, type PrismaAuthEndpoint } from "./authEndpoints.js";
import { PRISMA_CONSOLE_ORIGIN, PRISMA_CONSOLE_ROUTES, type PrismaConsoleRoute } from "./consoleRoutes.js";
import { PRISMA_SPEC_PIN } from "./generated/specLock.js";
import { PRISMA_DATA_PLATFORM_SURFACES } from "./generated/surfaces.js";
import { prismaDataPlatformEntityId } from "./identity.js";
import type { PrismaDataPlatformAtlasKind } from "./kinds.js";
import type { PrismaDataPlatformEntity, PrismaMethodApiDetail } from "./model.js";
import type { PrismaSurfaceRow } from "./surfaceRow.js";

/**
 * The surface name the management API's coverage and provenance are recorded under.
 * @internal
 */
export const PRISMA_SPEC_SURFACE = "management-api-spec";

/**
 * The surface name the authorization server's endpoint inventory is recorded under.
 * @internal
 */
export const PRISMA_AUTH_SURFACE = "authorization-server";

/**
 * The surface name the console's route inventory is recorded under.
 * @internal
 */
export const PRISMA_CONSOLE_SURFACE = "console-routes";

/** The provider key a method entity is matched on across channels: the request line, byte-exactly. */
function methodProviderId({ row }: { row: PrismaSurfaceRow }): string {
  return `${row.method} ${row.path}`;
}

/** What the pinned document states about one operation, reduced to names and this atlas's decisions. */
function methodDetail({ row }: { row: PrismaSurfaceRow }): PrismaMethodApiDetail {
  return {
    authMethods: [...row.authMethods],
    deprecated: row.deprecated,
    disposition: row.disposition,
    dispositionBecause: row.dispositionBecause,
    docsUrl: row.docsUrl,
    exclusionReason: row.exclusionReason,
    method: row.method,
    paging: row.paging,
    path: row.path,
    probeEvidence: row.probeEvidence,
    responseFieldCount: row.responseFieldCount,
    scopes: [...row.scopes],
    stability: row.stability,
    summary: row.summary,
    tag: row.tag,
  };
}

/**
 * Every operation in the generated registry, as a `method` entity carrying only its `api` channel.
 *
 * @param at this run's ISO timestamp
 * @returns one entity per operation, in the registry's own order
 */
export function projectPrismaMethods({ at }: { at: string }): readonly PrismaDataPlatformEntity[] {
  return PRISMA_DATA_PLATFORM_SURFACES.map((row): PrismaDataPlatformEntity => {
    const providerId = methodProviderId({ row });
    return {
      channels: {
        api: {
          channel: "api",
          detail: methodDetail({ row }),
          firstSeenAt: at,
          lastSeenAt: at,
          source: {
            artifacts: [],
            channel: "api",
            deepLink: row.docsUrl,
            deepLinkStatus: row.docsUrl === null ? "unavailable" : "provider-provided",
            endpoint: `${PRISMA_SPEC_PIN.documentUrl}#${row.name}`,
            observedAt: at,
          },
          state: "observed",
        },
        browser: null,
      },
      id: prismaDataPlatformEntityId({ kind: "method", providerId }),
      kind: "method",
      providerId,
      scope: null,
    };
  });
}

/** What the probe established about one authorization-server endpoint, as a stored detail. */
function authDetail({ endpoint }: { endpoint: PrismaAuthEndpoint }): Record<string, unknown> {
  return { evidence: endpoint.evidence, holds: endpoint.holds, namedBy: endpoint.namedBy };
}

/**
 * Every authorization-server endpoint, as an `oauth-endpoint` entity carrying only its `api` channel.
 *
 * The deep link is the endpoint's own address and its status is `provider-provided` for a row the document
 * or the metadata named, `unverified` for one this atlas found by probing, and `unavailable` for the three
 * that are not there. Three different facts, three different values — which is the whole reason the status
 * is a separate field from the link.
 *
 * @param at this run's ISO timestamp
 * @returns one entity per declared endpoint
 */
export function projectPrismaAuthEndpoints({ at }: { at: string }): readonly PrismaDataPlatformEntity[] {
  return PRISMA_AUTH_ENDPOINTS.map((endpoint): PrismaDataPlatformEntity => {
    const url = `${PRISMA_AUTH_ORIGIN}${endpoint.path}`;
    return {
      channels: {
        api: {
          channel: "api",
          detail: authDetail({ endpoint }),
          firstSeenAt: at,
          lastSeenAt: at,
          source: {
            artifacts: [],
            channel: "api",
            deepLink: endpoint.evidence === "absent-404" ? null : url,
            deepLinkStatus: deepLinkStatusOf({ endpoint }),
            endpoint: url,
            observedAt: at,
          },
          state: "observed",
        },
        browser: null,
      },
      id: prismaDataPlatformEntityId({ kind: "oauth-endpoint", providerId: endpoint.path }),
      kind: "oauth-endpoint",
      providerId: endpoint.path,
      scope: null,
    };
  });
}

/** How an authorization endpoint's link was come by. */
function deepLinkStatusOf({
  endpoint,
}: {
  endpoint: PrismaAuthEndpoint;
}): "provider-provided" | "unavailable" | "unverified" {
  if (endpoint.evidence === "absent-404") {
    return "unavailable";
  }
  return endpoint.namedBy === "probe-only" ? "unverified" : "provider-provided";
}

/** What the signed-out probe and the route manifest established about one console route, as a detail. */
function consoleDetail({ route }: { route: PrismaConsoleRoute }): Record<string, unknown> {
  return { evidence: route.evidence, holds: route.holds, screenshotWanted: route.screenshot };
}

/**
 * Every established console route, as a `console-route` entity carrying only its `browser` channel.
 *
 * Three rows, and the shortness is the measurement rather than a stub — `consoleRoutes.ts` carries why. The
 * deep link is the route on the console's own origin with status `unverified`, because nothing has OPENED
 * it: recording it as `browser-discovered` would claim a walk that has not happened, which is the specific
 * dishonesty `kit/contract.ts` built the field to prevent.
 *
 * @param at this run's ISO timestamp
 * @returns one entity per established route
 */
export function projectPrismaConsoleRoutes({ at }: { at: string }): readonly PrismaDataPlatformEntity[] {
  return PRISMA_CONSOLE_ROUTES.map((route): PrismaDataPlatformEntity => {
    return {
      channels: {
        api: null,
        browser: {
          channel: "browser",
          detail: consoleDetail({ route }),
          firstSeenAt: at,
          lastSeenAt: at,
          source: {
            artifacts: [],
            channel: "browser",
            deepLink: `${PRISMA_CONSOLE_ORIGIN}${route.route}`,
            deepLinkStatus: "unverified",
            endpoint: `${PRISMA_CONSOLE_ORIGIN}${route.route}`,
            observedAt: at,
          },
          state: "observed",
        },
      },
      id: prismaDataPlatformEntityId({ kind: "console-route", providerId: route.route }),
      kind: "console-route",
      providerId: route.route,
      scope: null,
    };
  });
}

/**
 * The kinds this build can currently fill, so a sync can report every OTHER kind as not-configured rather
 * than leaving a reader to infer it from an empty file.
 *
 * @returns the three surface-map kinds
 */
export function prismaFillableKinds(): readonly PrismaDataPlatformAtlasKind[] {
  return ["console-route", "method", "oauth-endpoint"];
}
