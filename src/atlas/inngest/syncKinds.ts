/**
 * Building each kind's next file from what one sync run observed.
 *
 * `sync.ts` owns the order the network is read in and the publish itself; `syncGaps.ts` owns what a run
 * admits it could not answer. What is here is the third piece — turning observations into the eleven files a
 * generation is made of — and it is one builder per kind rather than one function over all of them, because
 * the three surface-map kinds and the eight entity kinds are built for completely different reasons.
 *
 * ## The eight entity kinds are WRITTEN rather than skipped
 *
 * A kind whose file is absent and a kind that has been reached and found unreadable are different claims,
 * and only the second is true here. So each entity kind gets a `not-configured` coverage cell naming the
 * missing credential and an `api-credential-absent` gap, with `lastSuccessAt` deliberately left null and a
 * recorded ATTEMPT — which is exactly the combination `store.ts`'s `gradeNeverSucceeded` exists to grade as
 * published rather than half-written.
 */
import { err, ok, type Result } from "../../lib/result.js";
import { assembleKindFile } from "../kit/compiledSync.js";

import { failedInngestCoverageCell, succeededInngestCoverageCell } from "./coverage.js";
import type { InngestDashboardRoute } from "./dashboardRoutes.js";
import { INNGEST_DASHBOARD_BOOTSTRAP_URL } from "./dashboardRoutes.js";
import {
  INNGEST_CATALOGUE_SURFACE,
  INNGEST_DASHBOARD_SURFACE,
  INNGEST_GRAPHQL_SURFACE,
  INNGEST_REST_SURFACE,
} from "./descriptor.js";
import { INNGEST_DISPOSITION_RULES, inngestDispositionFor } from "./dispositions.js";
import { type InngestGapRecheck, openInngestGap, reconcileInngestGaps } from "./gaps.js";
import { INNGEST_GRAPHQL_INTROSPECTION_REPRO } from "./graphqlEndpoint.js";
import { mergeInngestChannel } from "./merge.js";
import {
  emptyInngestKindFile,
  INNGEST_GRAPHQL_OPERATION_KIND,
  INNGEST_KINDS,
  INNGEST_OPERATION_KIND,
  INNGEST_PAGE_KIND,
  type InngestAtlasGap,
  type InngestAtlasKindFile,
  type InngestKind,
} from "./model.js";
import { type InngestProbeOutcome, projectInngestOperation, projectInngestRoute } from "./projection.js";
import {
  INNGEST_REST_CATALOGUE_URL,
  type InngestCatalogueOperation,
  inngestOperationProviderId,
} from "./restCatalogue.js";
import { CREDENTIAL_REMEDY } from "./syncGaps.js";

/**
 * The kinds this atlas can only fill from an account it cannot currently reach.
 *
 * @internal
 */
export const INNGEST_ENTITY_KINDS: readonly InngestKind[] = INNGEST_KINDS.filter(
  (kind) => kind !== INNGEST_OPERATION_KIND && kind !== INNGEST_PAGE_KIND && kind !== INNGEST_GRAPHQL_OPERATION_KIND,
);

/** What a mutating operation with no GET-reachable address records instead of a probe result. */
const UNPROBED_MUTATING: InngestProbeOutcome = {
  evidence: "unprobeable-mutating",
  note: "no reviewed address serves this operation with a GET, and this atlas sends no other method",
};

/** Everything one run measured, handed to the builders as one value. */
export interface InngestSyncObservations {
  readonly at: string;
  readonly dashboardGapList: readonly InngestAtlasGap[];
  readonly graphqlNote: string;
  readonly operations: readonly InngestCatalogueOperation[];
  readonly probedUrls: ReadonlyMap<string, string | null>;
  readonly restGapList: readonly InngestAtlasGap[];
  readonly restOutcomes: ReadonlyMap<string, InngestProbeOutcome>;
  readonly routeOutcomes: ReadonlyMap<string, InngestProbeOutcome>;
  readonly routes: readonly InngestDashboardRoute[];
  readonly stored: Readonly<Partial<Record<InngestKind, InngestAtlasKindFile | null>>>;
}

/** The stored file for one kind, or a fresh empty one when the generation does not hold it. */
function storedFile({
  observed,
  kind,
}: {
  observed: InngestSyncObservations;
  kind: InngestKind;
}): InngestAtlasKindFile {
  return observed.stored[kind] ?? emptyInngestKindFile({ kind, updatedAt: observed.at });
}

/**
 * The gap a reviewed disposition rule that matched nothing earns.
 *
 * A dead rule reads as considered judgement and is not one, so the sync raises it rather than letting it rot.
 *
 * @param claimedRuleIds every rule at least one operation in this run was decided by
 * @param at this run's ISO timestamp
 * @returns one gap per rule that fired for nothing
 */
function deadRuleGaps({
  claimedRuleIds,
  at,
}: {
  claimedRuleIds: ReadonlySet<string>;
  at: string;
}): readonly InngestAtlasGap[] {
  return INNGEST_DISPOSITION_RULES.filter((rule) => !claimedRuleIds.has(rule.id)).map((rule) =>
    openInngestGap({
      at,
      condition: "disposition-rule-never-fired",
      fields: [],
      kind: INNGEST_OPERATION_KIND,
      reason:
        `the reviewed disposition rule \`${rule.id}\` matched no operation in this run's catalogue, so it ` +
        "reads as considered judgement and is not one — an operation was renamed, or the rule is dead",
      scope: rule.id,
      surfaces: ["compiled"],
    }),
  );
}

/** What reaching the publish step proves about the REST reading, so those gaps may close. */
function restRechecks(): readonly InngestGapRecheck[] {
  return [
    { condition: "rest-catalogue-unreachable", resolved: true, scope: INNGEST_REST_CATALOGUE_URL },
    { condition: "rest-catalogue-uncompilable", resolved: true, scope: INNGEST_REST_CATALOGUE_URL },
  ];
}

/** What reaching the publish step proves about the dashboard reading. */
function dashboardRechecks(): readonly InngestGapRecheck[] {
  return [{ condition: "dashboard-route-table-unreadable", resolved: true, scope: INNGEST_DASHBOARD_BOOTSTRAP_URL }];
}

/**
 * Build the `operation` kind's next file, and the disposition census behind it.
 *
 * @param observed everything this run measured
 * @returns the next file, or the first reason it cannot be built
 */
function buildOperationKind({ observed }: { observed: InngestSyncObservations }): Result<InngestAtlasKindFile> {
  const { at, operations, restOutcomes } = observed;
  const claimedRuleIds = new Set<string>();
  const entities = operations.map((operation) => {
    const disposition = inngestDispositionFor({ operation });
    claimedRuleIds.add(disposition.ruleId);
    return projectInngestOperation({
      at,
      disposition,
      operation,
      probe: restOutcomes.get(inngestOperationProviderId({ operation })) ?? UNPROBED_MUTATING,
    });
  });
  const stored = storedFile({ kind: INNGEST_OPERATION_KIND, observed });
  return assembleKindFile({
    at,
    coverage: [
      succeededInngestCoverageCell({
        artifacts: [],
        at,
        channel: "compiled",
        reason:
          `${String(operations.length)} operations compiled from ${INNGEST_REST_CATALOGUE_URL}, each carrying ` +
          "its version, group, title and description. No method or path: no machine-readable source states " +
          "them — see the vendor-document-errors gap",
        role: "authoritative",
        scope: "the published REST catalogue",
        state: "synced",
        surface: INNGEST_CATALOGUE_SURFACE,
      }),
      failedInngestCoverageCell({
        channel: "api",
        previous: null,
        reason: "no Inngest API credential is configured, so no operation has been called against this account",
        role: "authoritative",
        scope: "api.inngest.com under a credential",
        state: "not-configured",
        surface: INNGEST_REST_SURFACE,
        unblockedBy: CREDENTIAL_REMEDY,
      }),
    ],
    gaps: reconcileInngestGaps({
      at,
      observed: [...observed.restGapList, ...deadRuleGaps({ at, claimedRuleIds })],
      rechecks: restRechecks(),
      runFailed: false,
      stored: stored.gaps,
    }),
    merged: mergeInngestChannel({ at, channel: "compiled", observed: entities, stored: stored.entities }),
    stored,
  });
}

/**
 * Build the `page` kind's next file from the routes the application's own table declares.
 *
 * @param observed everything this run measured
 * @returns the next file, or the first reason it cannot be built
 */
function buildPageKind({ observed }: { observed: InngestSyncObservations }): Result<InngestAtlasKindFile> {
  const { at, routes, routeOutcomes, probedUrls } = observed;
  const entities = routes.map((route) =>
    projectInngestRoute({
      at,
      probe: routeOutcomes.get(route.routePath) ?? {
        evidence: "unprobeable-parameterised",
        note: "this run probed no address for this route",
      },
      probedUrl: probedUrls.get(route.routePath) ?? null,
      route,
    }),
  );
  const stored = storedFile({ kind: INNGEST_PAGE_KIND, observed });
  return assembleKindFile({
    at,
    coverage: [
      succeededInngestCoverageCell({
        artifacts: [],
        at,
        channel: "compiled",
        reason:
          `${String(routes.length)} routes read out of the application's own route table, which it ships to a ` +
          `signed-out visitor at ${INNGEST_DASHBOARD_BOOTSTRAP_URL}. This is the vendor's own statement of its ` +
          "navigation surface, not a list this atlas guessed",
        role: "authoritative",
        scope: "the dashboard's declared routes",
        state: "synced",
        surface: INNGEST_CATALOGUE_SURFACE,
      }),
      failedInngestCoverageCell({
        channel: "browser",
        previous: null,
        reason: "no page has been rendered in a signed-in browser, so no route's contents are held",
        role: "authoritative",
        scope: "app.inngest.com, signed in",
        state: "unreadable",
        surface: INNGEST_DASHBOARD_SURFACE,
        unblockedBy: "run: slopweaver atlas inngest walk",
      }),
    ],
    gaps: reconcileInngestGaps({
      at,
      observed: observed.dashboardGapList,
      rechecks: dashboardRechecks(),
      runFailed: false,
      stored: stored.gaps,
    }),
    merged: mergeInngestChannel({ at, channel: "compiled", observed: entities, stored: stored.entities }),
    stored,
  });
}

/**
 * Build the `graphql-operation` kind's next file, which a sync can only ever declare.
 *
 * Its entities are the walk's alone, so this replaces the coverage and the gap and never the entity list.
 *
 * @param observed everything this run measured
 * @returns the next file
 */
function buildGraphqlKind({ observed }: { observed: InngestSyncObservations }): InngestAtlasKindFile {
  const { at, graphqlNote } = observed;
  const stored = storedFile({ kind: INNGEST_GRAPHQL_OPERATION_KIND, observed });
  return {
    ...stored,
    coverage: [
      failedInngestCoverageCell({
        channel: "browser",
        previous: null,
        reason: `${graphqlNote}. Introspection is disabled, so nothing can be compiled from this endpoint`,
        role: "discovery",
        scope: "api.inngest.com/gql",
        state: "unreadable",
        surface: INNGEST_GRAPHQL_SURFACE,
        unblockedBy: "run: slopweaver atlas inngest walk — the only census of this surface is what the dashboard sends",
      }),
    ],
    gaps: [
      openInngestGap({
        at,
        condition: "graphql-introspection-disabled",
        fields: [],
        kind: INNGEST_GRAPHQL_OPERATION_KIND,
        reason:
          "api.inngest.com/gql answers `introspection disabled`, so this surface has no published denominator " +
          `and any census of it is a FLOOR rather than a fraction. Settle it in one line: ${INNGEST_GRAPHQL_INTROSPECTION_REPRO}`,
        scope: "api.inngest.com/gql",
        surfaces: ["browser"],
      }),
    ],
    updatedAt: at,
  };
}

/**
 * Build one entity kind's next file: its honest not-configured state, and nothing else.
 *
 * @param observed everything this run measured
 * @param kind the entity kind
 * @returns the next file
 */
function buildEntityKind({
  observed,
  kind,
}: {
  observed: InngestSyncObservations;
  kind: InngestKind;
}): InngestAtlasKindFile {
  const { at } = observed;
  const stored = storedFile({ kind, observed });
  return {
    ...stored,
    coverage: [
      failedInngestCoverageCell({
        channel: "api",
        previous: null,
        reason: `no Inngest API credential is configured, so no ${kind} of this account has been read`,
        role: "authoritative",
        scope: "api.inngest.com under a credential",
        state: "not-configured",
        surface: INNGEST_REST_SURFACE,
        unblockedBy: CREDENTIAL_REMEDY,
      }),
      failedInngestCoverageCell({
        channel: "browser",
        previous: null,
        reason: `no page has been walked, so no ${kind} has been read out of the dashboard either`,
        role: "authoritative",
        scope: "app.inngest.com, signed in",
        state: "unreadable",
        surface: INNGEST_DASHBOARD_SURFACE,
        unblockedBy: "run: slopweaver atlas inngest walk",
      }),
    ],
    gaps: [
      openInngestGap({
        at,
        condition: "api-credential-absent",
        fields: [],
        kind,
        reason:
          `nothing in this installation can list this account's ${kind} records: the REST channel has no ` +
          `credential and no page has been walked. Unblocked by ${CREDENTIAL_REMEDY}, or by running ` +
          "slopweaver atlas inngest walk",
        scope: kind,
        surfaces: ["api", "browser"],
      }),
    ],
    updatedAt: at,
  };
}

/**
 * Build every kind's next file from what this run observed.
 *
 * @param observed everything this run measured
 * @returns one file per kind, or the first reason the generation cannot be built
 *
 * @internal
 */
export function buildInngestKindFiles({
  observed,
}: {
  observed: InngestSyncObservations;
}): Result<Record<InngestKind, InngestAtlasKindFile>> {
  const operationFile = buildOperationKind({ observed });
  if (operationFile.isErr()) {
    return err(operationFile.error);
  }
  const pageFile = buildPageKind({ observed });
  if (pageFile.isErr()) {
    return err(pageFile.error);
  }
  const files: Partial<Record<InngestKind, InngestAtlasKindFile>> = {
    [INNGEST_GRAPHQL_OPERATION_KIND]: buildGraphqlKind({ observed }),
    [INNGEST_OPERATION_KIND]: operationFile.value,
    [INNGEST_PAGE_KIND]: pageFile.value,
  };
  for (const kind of INNGEST_ENTITY_KINDS) {
    files[kind] = buildEntityKind({ kind, observed });
  }
  // Every kind above is assigned, so the partial is total; stated rather than proven to the compiler because
  // the loop's key type is the kind union itself.
  // oxlint-disable-next-line no-unsafe-type-assertion
  return ok(files as Record<InngestKind, InngestAtlasKindFile>);
}
