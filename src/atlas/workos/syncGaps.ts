/**
 * What one sync is honest about not having answered — this atlas's gap list, kind by kind.
 *
 * "The gap list is a deliverable", in the owner's own words, so it is computed apart from the run that
 * publishes it: `sync.ts` acquires and writes, and everything here decides which open questions each kind
 * carries out of that run. The split is also what keeps the two readable, since a gap's reason is prose a
 * human reads and a publish step is mechanism.
 *
 * ## Rebuilt, not merged — except where a stored row is not this run's to judge
 *
 * The route and page halves rebuild their gaps from this run entirely, because a candidate that has become
 * present must stop being a gap and a stale `route-candidate-absent` row is exactly the doc rot this atlas
 * exists to avoid. The content half cannot: a family this run never attempted keeps whatever it already
 * carried, so only the three conditions content grading OWNS are cleared before its fresh row is added.
 */
import {
  describeWorkosGrade,
  isWorkosContentKind,
  type WorkosContentAcquisition,
  type WorkosContentOutcome,
} from "./contentAcquire.js";
import { WORKOS_DASHBOARD_ROUTES } from "./dashboardPages.js";
import { WORKOS_ENVIRONMENT_ID_ENV, type WorkosEnvironmentResolution } from "./environmentId.js";
import { openWorkosGap, type WorkosGapCondition } from "./gaps.js";
import type { WorkosAtlasKind, WorkosAtlasKindFile } from "./model.js";
import type { WorkosProbedRoute } from "./projection.js";
import { WORKOS_UNMAPPED_ORIGINS } from "./routeCandidates.js";
import { workosRouteIsPresent } from "./routeProbe.js";

/**
 * What both halves produced, before anything is merged or published.
 *
 * Declared here rather than in `sync.ts` because this is the module that reads both of its halves, and a
 * type owned by the file that publishes would make the dependency point the wrong way.
 *
 * @internal
 */
export interface WorkosAcquisition extends WorkosContentAcquisition {
  readonly probed: readonly WorkosProbedRoute[];
}

/**
 * This run's gaps for one kind, replacing only the conditions this run actually judged.
 *
 * @param stored the kind's file as it stood before this run, whose rows this run does not own are kept
 * @param environment this installation's environment segment, or the reason there is none
 * @param at this run's ISO timestamp
 * @returns the gaps that kind's file carries out of this run
 * @internal
 */
export function gapsFor({
  acquisition,
  kind,
  stored,
  environment,
  at,
}: {
  acquisition: WorkosAcquisition;
  kind: WorkosAtlasKind;
  stored: WorkosAtlasKindFile;
  environment: WorkosEnvironmentResolution;
  at: string;
}): WorkosAtlasKindFile["gaps"] {
  if (kind === "operation") {
    return operationGaps({ acquisition, at });
  }
  if (!isWorkosContentKind(kind)) {
    return pageGaps({ at, environment });
  }
  // Every content condition is cleared, not just the one this run would raise: a family that failed last
  // run and read fine this one must not keep a stale `content-unreadable` row beside its fresh rows.
  const kept = stored.gaps.filter((gap) => !isWorkosContentCondition({ condition: gap.condition }));
  const grade = acquisition.families[kind];
  if (grade.outcome === "synced") {
    return kept;
  }
  return [
    ...kept,
    openWorkosGap({
      at,
      condition: contentConditionFor({ outcome: grade.outcome }),
      kind,
      reason: describeWorkosGrade({ grade }),
      // Scoped by KIND so the four gaps this raises are four distinct ids rather than one id repeated
      // across four files — a gap list where two rows share an id cannot be reconciled row by row.
      scope: `workos:${kind}`,
      surfaces: ["api"],
    }),
  ];
}

/**
 * Which gap one unsynced family raises.
 *
 * Three outcomes, three conditions, because they send a reader three different places: no key is a
 * credential to configure, a refusal is an endpoint to investigate with the key that already works, and a
 * bound is a number in `contentRead.ts`. Collapsing them told a reader to go and set up a credential
 * because a directories endpoint answered HTTP 500.
 *
 * @param outcome the family's own outcome, which is never `synced` here
 * @returns the condition to raise
 */
function contentConditionFor({ outcome }: { outcome: WorkosContentOutcome }): WorkosGapCondition {
  if (outcome === "failed") {
    return "content-unreadable";
  }
  if (outcome === "truncated") {
    return "content-bounded";
  }
  return "content-not-configured";
}

/**
 * Whether a stored gap is one of the three a content family raises.
 *
 * @param condition the stored gap's condition
 * @returns `true` when this run's content grading owns that row
 */
function isWorkosContentCondition({ condition }: { condition: string }): boolean {
  return (
    condition === "content-not-configured" || condition === "content-unreadable" || condition === "content-bounded"
  );
}

/**
 * The route map's own gaps: one per candidate the server does not serve, plus the two standing bounds.
 *
 * Every one is rebuilt from this run rather than merged with what was stored, because a candidate that has
 * become present must stop being a gap and a stale `route-candidate-absent` row is exactly the doc rot this
 * atlas exists to avoid.
 *
 * @param acquisition what both halves produced
 * @param at this run's ISO timestamp
 * @returns the operation kind's gaps
 */
function operationGaps({
  acquisition,
  at,
}: {
  acquisition: WorkosAcquisition;
  at: string;
}): WorkosAtlasKindFile["gaps"] {
  const absent = acquisition.probed
    .filter((row) => !workosRouteIsPresent({ verdict: row.classification.verdict }))
    .map((row) =>
      openWorkosGap({
        at,
        condition: "route-candidate-absent",
        kind: "operation",
        reason:
          `the running API answered HTTP ${String(row.statusCode)} in the shape it uses for a pair it does ` +
          "not route. That is a fact about this METHOD and this path together, and never about the path " +
          "alone — see `routeProbe.ts` on the one-way limit",
        scope: `${row.candidate.httpMethod} ${row.candidate.path}`,
        surfaces: ["api"],
      }),
    );
  const origins = WORKOS_UNMAPPED_ORIGINS.map((unmapped) =>
    openWorkosGap({
      at,
      condition: "second-origin-unmapped",
      kind: "operation",
      reason:
        `${unmapped.family} is served from ${unmapped.origin}, which this atlas does not probe. Every ` +
        "candidate for it under the mapped origin answered not-routed, so the family exists and its surface " +
        "is unmapped rather than absent",
      scope: unmapped.origin,
      surfaces: ["api"],
    }),
  );
  return [
    ...absent,
    ...origins,
    openWorkosGap({
      at,
      condition: "route-denominator-is-local",
      kind: "operation",
      reason:
        "WorkOS publishes no OpenAPI document, so the set of routes ASKED about is a table in this " +
        "repository rather than one the vendor served. Every verdict above is the running server's; a route " +
        "nobody here thought to name is simply never probed, and this atlas cannot know it exists",
      scope: "workos:route-candidates",
      surfaces: ["api"],
    }),
  ];
}

/**
 * How many declared routes hang off the environment segment.
 *
 * A count rather than a constant, so the coverage reason cannot drift from the table it describes.
 *
 * @returns how many declared routes carry `scope: "environment"`
 * @internal
 */
export function environmentScopedRouteCount(): number {
  return WORKOS_DASHBOARD_ROUTES.filter((route) => route.scope === "environment").length;
}

/**
 * Where this run's environment segment came from, in one clause a coverage reason can carry.
 *
 * Names the SOURCE rather than the id: a reader grading coverage needs to know whether the addresses are
 * current or bootstrap, and the id itself is already in every deep link beside it.
 *
 * @param environment this installation's environment segment, or the reason there is none
 * @returns one clause naming where the segment came from, or that there is none
 * @internal
 */
export function environmentProvenance({ environment }: { environment: WorkosEnvironmentResolution }): string {
  if (environment.state !== "resolved") {
    return "no environment resolved, so those addresses are the bare bootstrap paths";
  }
  if (environment.source === "environment-variable") {
    return `environment declared by $${WORKOS_ENVIRONMENT_ID_ENV}`;
  }
  return "environment witnessed by a previous dashboard walk";
}

/**
 * The page map's own gaps: the standing unverifiability bound, plus one per unwitnessed address.
 *
 * @param at this run's ISO timestamp
 * @param environment this installation's environment segment, or the reason there is none
 * @returns the page kind's gaps
 */
function pageGaps({
  at,
  environment,
}: {
  at: string;
  environment: WorkosEnvironmentResolution;
}): WorkosAtlasKindFile["gaps"] {
  const unwitnessed = WORKOS_DASHBOARD_ROUTES.map((route) =>
    openWorkosGap({
      at,
      condition: "dashboard-page-unwitnessed",
      kind: "page",
      reason:
        "the address is declared and no browser has landed on it, so nothing here is evidence that this " +
        "page exists or that this account could open it",
      scope: route.path,
      surfaces: ["browser"],
    }),
  );
  return [
    ...unwitnessed,
    ...unresolvedEnvironmentGap({ at, environment }),
    openWorkosGap({
      at,
      condition: "dashboard-route-unverifiable-without-session",
      kind: "page",
      reason:
        "every unauthenticated dashboard path answers the same 307 to /signin?redirect=<path>, including a " +
        "deliberately nonsense one, so the sign-in redirect is a catch-all and the page map cannot be " +
        "checked at all without a signed-in walk. This is the standing bound, not a missing run",
      scope: "workos:dashboard",
      surfaces: ["browser"],
    }),
    openWorkosGap({
      at,
      condition: "dashboard-surface-moved-unknown-address",
      kind: "page",
      reason:
        "the dashboard's SSO connection list used to answer at /sso and no longer does, at that path or " +
        "under the environment segment (measured by a signed-in walk). The nav now reads " +
        "Authentication / Authorization / Applications, and this atlas has witnessed no address that " +
        "replaced it — so the surface is declared missing rather than declared at an address nobody has " +
        "opened. A walk that lands on it closes this: `slopweaver atlas workos walk`",
      scope: "/sso",
      surfaces: ["browser"],
    }),
  ];
}

/**
 * The gap that says this install's dashboard addresses are bootstrap paths, when they are.
 *
 * A list rather than a nullable so the caller spreads it: a resolved environment raises nothing at all, and
 * an `if` at every call site would say the same thing three times.
 */
function unresolvedEnvironmentGap({
  at,
  environment,
}: {
  at: string;
  environment: WorkosEnvironmentResolution;
}): WorkosAtlasKindFile["gaps"] {
  if (environment.state === "resolved") {
    return [];
  }
  return [
    openWorkosGap({
      at,
      condition: "dashboard-environment-unresolved",
      kind: "page",
      reason:
        `${String(environmentScopedRouteCount())} declared address(es) hang off this install's environment ` +
        `segment and it is not resolved, so each is published at its bare path — which WorkOS answers with ` +
        `its own not-found page for all but /api-keys and /webhooks, where its redirect is what reveals the ` +
        `segment. ${environment.reason}`,
      scope: "workos:dashboard-environment",
      surfaces: ["browser"],
    }),
  ];
}
