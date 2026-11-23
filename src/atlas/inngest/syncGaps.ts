/**
 * What one sync run RECORDS as a gap, separated from the run itself.
 *
 * `sync.ts` owns the order in which the network is read and the generation is published. What belongs here
 * is the judgement it hands down afterwards — which of the things it observed is a question this atlas could
 * not answer, and in whose words. Both halves are pure over what a run measured, so every gap this atlas can
 * open is provable against a fixture rather than against a live probe.
 *
 * The split was forced by the `file-size-ratchet` gate and is an improvement rather than a concession: a
 * reader asking "what does this atlas admit it does not know" now has one file to open.
 */
import type { InngestDashboardRoute } from "./dashboardRoutes.js";
import { openInngestGap } from "./gaps.js";
import { INNGEST_OPERATION_KIND, INNGEST_PAGE_KIND, type InngestAtlasGap } from "./model.js";
import type { InngestProbeOutcome } from "./projection.js";
import { type InngestCatalogueOperation, inngestOperationProviderId } from "./restCatalogue.js";

/** What the missing credential blocks, said once so every cell and gap agrees. */
export const CREDENTIAL_REMEDY =
  "an Inngest API credential scoped to this account, stored through `slopweaver secrets set`, and a REST " +
  "client landed against it — a widening of credential access rather than a piece of work";

/**
 * The gap the API reference's own broken markdown mirror earns.
 *
 * @param brokenMirrors the mirror addresses that answered a server error, with their statuses
 * @param at this run's ISO timestamp
 * @returns the gap, or `null` when both mirrors answered
 */
function brokenMirrorGap({
  brokenMirrors,
  at,
}: {
  brokenMirrors: readonly string[];
  at: string;
}): InngestAtlasGap | null {
  if (brokenMirrors.length === 0) {
    return null;
  }
  return openInngestGap({
    at,
    condition: "vendor-document-errors",
    fields: [],
    kind: INNGEST_OPERATION_KIND,
    reason:
      `Inngest's API reference serves its operation catalogue but answers HTTP 500 for ${brokenMirrors.join(", ")} — ` +
      "the markdown mirror its own client bundle asks for. So no machine-readable source states any " +
      "operation's HTTP method or path template, and this atlas records neither rather than inferring " +
      "them from an operation's title",
    scope: "api-docs.inngest.com markdown mirror",
    surfaces: ["compiled"],
  });
}

/**
 * The gap a v2 surface that authenticates before it routes earns.
 *
 * @param v2ControlAgrees whether the invented v2 address answered what a real one did
 * @param v2Note both answers, exactly as observed
 * @param at this run's ISO timestamp
 * @returns the gap, or `null` when v2 has begun discriminating
 */
function v2UnprobeableGap({
  v2ControlAgrees,
  v2Note,
  at,
}: {
  v2ControlAgrees: boolean;
  v2Note: string;
  at: string;
}): InngestAtlasGap | null {
  if (!v2ControlAgrees) {
    return null;
  }
  return openInngestGap({
    at,
    condition: "rest-route-unprobeable",
    fields: [],
    kind: INNGEST_OPERATION_KIND,
    reason:
      "the v2 REST surface authenticates before it routes, so no unauthenticated request can establish " +
      `whether a v2 address exists. Observed this run: ${v2Note}. Closed only by ${CREDENTIAL_REMEDY}`,
    scope: "api.inngest.com /v2",
    surfaces: ["compiled"],
  });
}

/**
 * The gap one operation whose reviewed address answered 404 earns.
 *
 * @param operation the catalogued operation
 * @param outcome what the probe established about its reviewed address
 * @param at this run's ISO timestamp
 * @returns the gap, or `null` when the address was not found absent
 */
function absentAddressGap({
  operation,
  outcome,
  at,
}: {
  operation: InngestCatalogueOperation;
  outcome: InngestProbeOutcome | undefined;
  at: string;
}): InngestAtlasGap | null {
  if (outcome?.evidence !== "absent-404") {
    return null;
  }
  return openInngestGap({
    at,
    condition: "rest-route-absent",
    fields: [],
    kind: INNGEST_OPERATION_KIND,
    reason:
      `the reviewed address for ${operation.version} ${operation.operationId} answered 404 while this ` +
      "surface's controls discriminate, so the reviewed binding in restAddresses.ts is wrong. " +
      outcome.note,
    scope: `${operation.version} ${operation.operationId}`,
    surfaces: ["compiled"],
  });
}

/**
 * Every gap this run's REST reading produced.
 *
 * @param operations every operation the published catalogue declares
 * @param outcomes what each operation's probe established, keyed by provider id
 * @param v2ControlAgrees whether the invented v2 address answered what a real one did
 * @param v2Note both v2 answers, exactly as observed
 * @param brokenMirrors the mirror addresses that answered a server error
 * @param at this run's ISO timestamp
 * @returns every REST gap this run detected, in the order a reader meets them
 *
 * @internal
 */
export function restGaps({
  operations,
  outcomes,
  v2ControlAgrees,
  v2Note,
  brokenMirrors,
  at,
}: {
  operations: readonly InngestCatalogueOperation[];
  outcomes: ReadonlyMap<string, InngestProbeOutcome>;
  v2ControlAgrees: boolean;
  v2Note: string;
  brokenMirrors: readonly string[];
  at: string;
}): readonly InngestAtlasGap[] {
  const absent = operations.map((operation) =>
    absentAddressGap({ at, operation, outcome: outcomes.get(inngestOperationProviderId({ operation })) }),
  );
  return [brokenMirrorGap({ at, brokenMirrors }), v2UnprobeableGap({ at, v2ControlAgrees, v2Note }), ...absent].filter(
    (gap): gap is InngestAtlasGap => gap !== null,
  );
}

/**
 * The gap one declared dashboard route earns, or `null` when it earns none.
 *
 * @param route the route the application's own table declares
 * @param outcome what the probe established about it, or `undefined` when none was attempted
 * @param at this run's ISO timestamp
 * @returns the gap, or `null` when the route's existence was established
 */
function dashboardRouteGap({
  route,
  outcome,
  at,
}: {
  route: InngestDashboardRoute;
  outcome: InngestProbeOutcome | undefined;
  at: string;
}): InngestAtlasGap | null {
  if (outcome === undefined) {
    return null;
  }
  if (outcome.evidence === "unprobeable-control-agrees" || outcome.evidence === "unprobeable-parameterised") {
    return openInngestGap({
      at,
      condition: "dashboard-route-unprobeable",
      fields: [],
      kind: INNGEST_PAGE_KIND,
      reason:
        `${route.routePath} is declared by the application's own route table and its existence cannot be ` +
        `established without signing in. ${outcome.note}. Closed by: slopweaver atlas inngest walk`,
      scope: route.routePath,
      surfaces: ["compiled"],
    });
  }
  if (outcome.evidence === "absent-404") {
    return openInngestGap({
      at,
      condition: "dashboard-route-absent",
      fields: [],
      kind: INNGEST_PAGE_KIND,
      reason: `${route.routePath} is declared by the application's own route table and answered 404. ${outcome.note}`,
      scope: route.routePath,
      surfaces: ["compiled"],
    });
  }
  if (outcome.evidence === "probe-failed") {
    return openInngestGap({
      at,
      condition: "dashboard-route-errors",
      fields: [],
      kind: INNGEST_PAGE_KIND,
      reason: `${route.routePath} answered a server error rather than a page or a sign-in wall. ${outcome.note}`,
      scope: route.routePath,
      surfaces: ["compiled"],
    });
  }
  return null;
}

/**
 * Every gap this run's dashboard reading produced.
 *
 * @param routes every route the application's own table declares
 * @param outcomes what each route's probe established, keyed by the route's own path
 * @param at this run's ISO timestamp
 * @returns every dashboard gap this run detected, in declaration order
 *
 * @internal
 */
export function dashboardGaps({
  routes,
  outcomes,
  at,
}: {
  routes: readonly InngestDashboardRoute[];
  outcomes: ReadonlyMap<string, InngestProbeOutcome>;
  at: string;
}): readonly InngestAtlasGap[] {
  return routes
    .map((route) => dashboardRouteGap({ at, outcome: outcomes.get(route.routePath), route }))
    .filter((gap): gap is InngestAtlasGap => gap !== null);
}
