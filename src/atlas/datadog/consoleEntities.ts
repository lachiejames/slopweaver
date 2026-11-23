/**
 * Projecting what the walk saw into the atlas's own entity shape: one row per declared page, one per
 * endpoint the console called, and a `console` channel on the registry operations it corroborated.
 *
 * Split from `consoleSurface.ts` on its real seam — that module decides COVERAGE and this one decides what a
 * row looks like. The property worth holding here is the same one the reduction holds: a `console-request`
 * row carries a method, a path SHAPE, parameter names and response field names, and never a value; a
 * `console-page` row carries what the walk found at an address it already declared.
 */
import type { AtlasArtifactRef } from "../kit/contract.js";

import type { ConsoleRequestObservation } from "./consoleReduction.js";
import type { ConsolePageObservation, DatadogWalkResult } from "./consoleWalk.js";
import type { DatadogChannelEntity, DatadogConsolePage, DatadogConsoleRequest, DatadogEntity } from "./documents.js";
import { datadogEntityId } from "./identity.js";
import { DATADOG_KINDS, type DatadogKind } from "./model.js";

/** One channel record for a console observation. */
function consoleChannel({
  detail,
  at,
  endpoint,
  deepLink,
  reached,
  artifacts,
}: {
  detail: unknown;
  at: string;
  endpoint: string;
  deepLink: string | null;
  reached: boolean;
  artifacts: readonly AtlasArtifactRef[];
}): DatadogChannelEntity {
  return {
    channel: "console",
    detail,
    firstSeenAt: at,
    lastSeenAt: at,
    source: {
      artifacts: [...artifacts],
      deepLink,
      deepLinkStatus: reached ? "browser-discovered" : "unavailable",
      endpoint,
      observedAt: at,
      surface: "console",
    },
    state: "observed",
  };
}

/**
 * Project one walked page into a `console-page` entity.
 *
 * @param page what the walk saw at this route
 * @param origin the console origin, which is both the scope and the deep link's base
 * @param at this run's ISO timestamp
 * @returns the entity
 */
export function pageEntity({
  page,
  origin,
  at,
}: {
  page: ConsolePageObservation;
  origin: string;
  at: string;
}): DatadogEntity {
  const detail: DatadogConsolePage = {
    finalUrl: page.finalUrl,
    href: page.route.href,
    label: page.route.label,
    outcome: page.outcome,
    posture: page.route.posture,
    // Spread rather than written as `responseAccounting: page.responseAccounting ?? undefined`, because
    // `exactOptionalPropertyTypes` makes those two different things: an unvisited route has no measurement
    // to store, and the key must be ABSENT rather than present-and-undefined.
    ...(page.responseAccounting === null ? {} : { responseAccounting: page.responseAccounting }),
    section: page.route.section,
    statusCode: page.statusCode,
    title: page.title,
  };
  return {
    channels: {
      api: null,
      "compiled-catalogue": null,
      console: consoleChannel({
        artifacts: [...page.artifacts],
        at,
        deepLink: `${origin}${page.route.href}`,
        detail,
        endpoint: page.route.href,
        reached: page.outcome === "landed",
      }),
    },
    id: datadogEntityId({ kind: "console-page", providerId: page.route.href }),
    kind: "console-page",
    providerId: page.route.href,
    scope: origin,
  };
}

/** The stored detail of one observed console call. */
function requestDetail({ request }: { request: ConsoleRequestObservation }): DatadogConsoleRequest {
  return {
    method: request.method,
    observedOnPages: [...request.observedOnPages],
    paramNames: [...request.paramNames],
    pathShape: request.pathShape,
    registryOperation: request.registry === null ? null : `${request.registry.method} ${request.registry.path}`,
    responseFieldPaths: [...request.responseFieldPaths],
    statusCodes: [...request.statusCodes],
  };
}

/**
 * Project one observed call into a `console-request` entity.
 *
 * @param request the reduced call
 * @param origin the console origin, which is the entity's scope
 * @param at this run's ISO timestamp
 * @returns the entity
 */
export function requestEntity({
  request,
  origin,
  at,
}: {
  request: ConsoleRequestObservation;
  origin: string;
  at: string;
}): DatadogEntity {
  const providerId = `${request.method} ${request.pathShape}`;
  return {
    channels: {
      api: null,
      "compiled-catalogue": null,
      console: consoleChannel({
        artifacts: [],
        at,
        deepLink: null,
        detail: requestDetail({ request }),
        endpoint: providerId,
        reached: true,
      }),
    },
    id: datadogEntityId({ kind: "console-request", providerId }),
    kind: "console-request",
    providerId,
    scope: origin,
  };
}

/**
 * The registry operations the console corroborated, as `console`-channel entities grouped by kind.
 *
 * The entity id is the COMPILED one (`row.name` under the row's kind), so the merge lands the channel on the
 * operation the catalogue already holds rather than beside it.
 *
 * @param walk what the walk produced
 * @param origin the console origin, which is each entity's scope
 * @param at this run's ISO timestamp
 * @returns the entities grouped by the registry kind they belong to
 */
export function corroborations({
  walk,
  origin,
  at,
}: {
  walk: DatadogWalkResult;
  origin: string;
  at: string;
}): ReadonlyMap<DatadogKind, readonly DatadogEntity[]> {
  const byKind = new Map<DatadogKind, DatadogEntity[]>();
  const declared = new Set<string>(DATADOG_KINDS);
  for (const request of walk.requests) {
    const row = request.registry;
    if (row === null || !declared.has(row.kind)) {
      continue;
    }
    // `as`: `declared.has` just proved the registry's string is one of the model's literals.
    // oxlint-disable-next-line no-unsafe-type-assertion
    const kind = row.kind as DatadogKind;
    const entity: DatadogEntity = {
      channels: {
        api: null,
        "compiled-catalogue": null,
        console: consoleChannel({
          artifacts: [],
          at,
          deepLink: null,
          detail: requestDetail({ request }),
          endpoint: `${request.method} ${request.pathShape}`,
          reached: true,
        }),
      },
      id: datadogEntityId({ kind, providerId: row.name }),
      kind,
      providerId: row.name,
      scope: origin,
    };
    const held = byKind.get(kind);
    if (held === undefined) {
      byKind.set(kind, [entity]);
    } else if (!held.some((existing) => existing.id === entity.id)) {
      held.push(entity);
    }
  }
  return byKind;
}
