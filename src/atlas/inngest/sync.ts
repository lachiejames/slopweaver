/**
 * `atlas inngest sync` — publish a generation from what Inngest serves every reader, with no credential and
 * no account reached.
 *
 * ## What one run does, in order
 *
 * 1. Read the published REST catalogue and compile its operations (`restCatalogue.ts`).
 * 2. Check the two markdown-mirror addresses whose 500s are the reason those operations carry no method or
 *    path, so the gap closes itself the day Inngest fixes them.
 * 3. Read the dashboard's sign-in page for its entry bundle and its own default environment slug, then read
 *    that bundle for the application's own route table (`dashboardRoutes.ts`).
 * 4. Probe: v1's three controls then its reviewed addresses, v2's control against a real v2 address, one
 *    control per dashboard prefix then every concrete route, and a document-free GET to the GraphQL
 *    endpoint (`probe.ts`, `graphqlEndpoint.ts`).
 * 5. Publish the `operation` and `page` kinds' compiled channel, and write every other kind's honest
 *    not-configured state.
 *
 * ## Why the eight entity kinds are WRITTEN rather than skipped
 *
 * A kind whose file is absent and a kind that has been reached and found unreadable are different claims,
 * and only the second is true here. So each entity kind gets a `not-configured` coverage cell naming the
 * missing credential and an `api-credential-absent` gap, with `lastSuccessAt` deliberately left null and a
 * recorded ATTEMPT — which is exactly the combination `store.ts`'s `gradeNeverSucceeded` exists to grade as
 * published rather than half-written.
 */
import { err, ok, type Result } from "../../lib/result.js";
import { stampedKindStatus } from "../kit/walkPublish.js";

import {
  INNGEST_KINDS,
  INNGEST_OPERATION_KIND,
  INNGEST_PAGE_KIND,
  type InngestAtlasKindFile,
  type InngestAtlasManifest,
  type InngestKind,
  initialInngestManifest,
} from "./model.js";
import { type InngestProbeOutcome } from "./projection.js";
import { type InngestCatalogueOperation, inngestOperationProviderId } from "./restCatalogue.js";
import { type InngestAtlasPaths, inngestAtlasPaths, publishInngestAtlas, readInngestAtlas } from "./store.js";
import { CREDENTIAL_REMEDY, dashboardGaps, restGaps } from "./syncGaps.js";
import { buildInngestKindFiles, INNGEST_ENTITY_KINDS, type InngestSyncObservations } from "./syncKinds.js";
import {
  type InngestProbeSweep,
  type InngestPublishedSources,
  readInngestPublishedSources,
  sweepInngestProbes,
} from "./syncSources.js";
import {
  httpDocumentTransport,
  httpProbeTransport,
  type InngestDocumentTransport,
  type InngestProbeTransport,
} from "./transport.js";

/** What one sync did, for the verb to print. */
export interface InngestSyncOutcome {
  readonly gapCount: number;
  readonly operationCount: number;
  readonly pageCount: number;
  readonly paths: readonly string[];
  /** One line per control, so a reader can check the probe method rather than trust the counts. */
  readonly probeNotes: readonly string[];
  readonly routesProbed: number;
}

/** The seams a sync runs against, so every step above the network is provable against fakes. */
export interface InngestSyncDeps {
  readonly documentTransport: InngestDocumentTransport;
  readonly probeTransport: InngestProbeTransport;
}

/**
 * The real transports.
 *
 * @returns the document and probe transports that actually reach the network
 */
export function httpInngestSyncDeps(): InngestSyncDeps {
  return { documentTransport: httpDocumentTransport, probeTransport: httpProbeTransport };
}

/**
 * Every operation's probe outcome, with v2's control note laid over the v1 pass.
 *
 * Keyed by PROVIDER ID rather than by operation id: `CancelRun`, `CreateWebhook` and `ListWebhooks` each
 * exist in both versions against different addresses, and a map keyed on the id alone had this overlay
 * silently overwrite v1's evidence for all three.
 *
 * @param operations every operation the published catalogue declares
 * @param v1 what the v1 pass established
 * @param v2 what the v2 control established
 * @returns one outcome per operation this run has anything to say about
 */
function v2RestOutcomes({
  operations,
  v1,
  v2,
}: {
  operations: readonly InngestCatalogueOperation[];
  v1: { readonly outcomes: ReadonlyMap<string, InngestProbeOutcome> };
  v2: { readonly note: string };
}): ReadonlyMap<string, InngestProbeOutcome> {
  const outcomes = new Map(v1.outcomes);
  for (const operation of operations) {
    if (operation.version === "v2") {
      outcomes.set(inngestOperationProviderId({ operation }), {
        evidence: "unprobeable-control-agrees",
        note: v2.note,
      });
    }
  }
  return outcomes;
}

/** The manifest the store held, or a fresh one stamped `at` when it held none. */
function heldManifest({ manifest, at }: { manifest: InngestAtlasManifest | null; at: string }): InngestAtlasManifest {
  if (manifest == null) {
    return initialInngestManifest({ updatedAt: at });
  }
  return manifest;
}

/**
 * The manifest this run publishes: a compiled kind is stamped with this run's success, and every other kind
 * records this run as a FAILED attempt over its kept success time. A sync rewrites the GraphQL and entity
 * files (their not-configured cells are this run's) without reaching one row of them, and recording that as
 * an `ok` attempt at `at` makes `manifestClockDefects` compare a file stamped now with a success recorded
 * at the walk, and refuses the sync with "graphql-operation carries two clocks".
 * A failed attempt is the honest record, and it is what the store's `gradeNeverSucceeded` reads as agreeing.
 *
 * An entity kind carries the failure as a PERMISSION BOUNDARY (`kit/permissionBlock.ts`): the one thing
 * between this installation and an app, a function or a signing key is a credential nobody has minted, and
 * the owner's ruling is that a reader must never have to guess whether that is the atlas being
 * wrong. The GraphQL kind stays a plain failed attempt — a walk fills it, not a grant.
 */
function syncManifest({
  manifest,
  files,
  at,
}: {
  manifest: InngestAtlasManifest | null;
  files: Readonly<Record<InngestKind, InngestAtlasKindFile>>;
  at: string;
}): InngestAtlasManifest {
  const base = heldManifest({ at, manifest });
  const kinds = { ...base.kinds };
  for (const kind of INNGEST_KINDS) {
    const file = files[kind];
    const compiled = kind === INNGEST_OPERATION_KIND || kind === INNGEST_PAGE_KIND;
    if (compiled) {
      kinds[kind] = stampedKindStatus({ at, count: file.entities.length });
      continue;
    }
    const entity = INNGEST_ENTITY_KINDS.includes(kind);
    kinds[kind] = {
      digest: null,
      entityCount: file.entities.length,
      lastAttempt: { at, outcome: "failed", reasons: [`a sync compiles published documents and reads no ${kind}`] },
      lastSuccessAt: base.kinds[kind].lastSuccessAt,
      ...(entity
        ? {
            permissionBlocked: {
              at,
              detail: `no Inngest signing key is configured on this installation, so no ${kind} of this account has been read`,
              unblockedBy: CREDENTIAL_REMEDY,
            },
          }
        : {}),
    };
  }
  return { ...base, kinds, updatedAt: at };
}

/**
 * Everything one run measured, assembled into the one value the kind builders read.
 *
 * @param sources what the published documents established
 * @param sweep what every probe established
 * @param stored the kind files the generation already holds
 * @param at this run's ISO timestamp
 * @returns the observations, gap judgements included
 */
function observationsOf({
  sources,
  sweep,
  stored,
  at,
}: {
  sources: InngestPublishedSources;
  sweep: InngestProbeSweep;
  stored: Readonly<Partial<Record<InngestKind, InngestAtlasKindFile | null>>>;
  at: string;
}): InngestSyncObservations {
  const { brokenMirrors, operations, routes } = sources;
  const { dashboard, graphql, v2 } = sweep;
  const restOutcomes = v2RestOutcomes({ operations, v1: sweep.v1, v2 });
  return {
    at,
    dashboardGapList: dashboardGaps({ at, outcomes: dashboard.outcomes, routes }),
    graphqlNote: graphql.note,
    operations,
    probedUrls: dashboard.probedUrls,
    restGapList: restGaps({
      at,
      brokenMirrors,
      operations,
      outcomes: restOutcomes,
      v2ControlAgrees: v2.controlAgrees,
      v2Note: v2.note,
    }),
    restOutcomes,
    routeOutcomes: dashboard.outcomes,
    routes,
    stored,
  };
}

/**
 * Write this run's generation and report what it published.
 *
 * @param files one file per kind, as the builders assembled them
 * @param snapshot the generation this run derived from
 * @param paths the resolved atlas paths
 * @param operations every operation the published catalogue declares
 * @param routes every route the application's own table declares
 * @param v1 what the v1 probe pass established
 * @param v2 what the v2 control established
 * @param dashboard what the dashboard probe pass established
 * @param graphql what the GraphQL endpoint answered
 * @param at this run's ISO timestamp
 * @returns what was published, or every reason nothing was
 */
function publishRun({
  files,
  snapshot,
  paths,
  operations,
  routes,
  v1,
  v2,
  dashboard,
  graphql,
  at,
}: {
  files: Record<InngestKind, InngestAtlasKindFile>;
  snapshot: { readonly manifest: InngestAtlasManifest | null };
  paths: InngestAtlasPaths;
  operations: readonly InngestCatalogueOperation[];
  routes: readonly unknown[];
  v1: { readonly controlNotes: readonly string[] };
  v2: { readonly note: string };
  dashboard: { readonly controlNotes: readonly string[]; readonly probedUrls: ReadonlyMap<string, string | null> };
  graphql: { readonly note: string };
  at: string;
}): Result<InngestSyncOutcome> {
  const published = publishInngestAtlas({
    derivedFrom: snapshot.manifest,
    files,
    manifest: syncManifest({ at, files, manifest: snapshot.manifest }),
    paths,
  });
  if (published.isErr()) {
    return err(published.error);
  }
  return ok({
    gapCount: INNGEST_KINDS.reduce((total, kind) => total + files[kind].gaps.length, 0),
    operationCount: operations.length,
    pageCount: routes.length,
    paths: published.value,
    probeNotes: [...v1.controlNotes, v2.note, ...dashboard.controlNotes, graphql.note],
    routesProbed: [...dashboard.probedUrls.values()].filter((url) => url !== null).length,
  });
}

/**
 * Compile a generation from Inngest's published surfaces and publish it.
 *
 * @param home the resolved `$SLOPWEAVER_HOME` to publish under
 * @param at this run's ISO timestamp
 * @param deps the document and probe transports, injected so every step above them is testable
 * @returns what was published, or every reason nothing was
 */
export async function syncInngestAtlas({
  home,
  at,
  deps,
}: {
  home: string;
  at: string;
  deps: InngestSyncDeps;
}): Promise<Result<InngestSyncOutcome>> {
  const paths: InngestAtlasPaths = inngestAtlasPaths({ home });
  const snapshot = readInngestAtlas({ paths });
  if (snapshot.isErr()) {
    return err(snapshot.error);
  }
  const sources = await readInngestPublishedSources({
    documentTransport: deps.documentTransport,
    probeTransport: deps.probeTransport,
  });
  if (sources.isErr()) {
    return err(sources.error);
  }
  const { environmentSlug, operations, routes } = sources.value;
  const probes = await sweepInngestProbes({ environmentSlug, probeTransport: deps.probeTransport, routes });
  if (probes.isErr()) {
    return err(probes.error);
  }
  const { dashboard, graphql, v1, v2 } = probes.value;
  const files = buildInngestKindFiles({
    observed: observationsOf({ at, sources: sources.value, stored: snapshot.value.files, sweep: probes.value }),
  });
  if (files.isErr()) {
    return err(files.error);
  }
  return publishRun({
    at,
    dashboard,
    files: files.value,
    graphql,
    operations,
    paths,
    routes,
    snapshot: snapshot.value,
    v1,
    v2,
  });
}

/**
 * The provider key one operation is matched on, re-exported so a verb can print one without importing the
 * catalogue module.
 *
 * @param operation the catalogued operation
 * @returns the provider key
 *
 * @internal
 */
export function inngestSyncOperationKey({
  operation,
}: {
  operation: Pick<InngestCatalogueOperation, "operationId" | "version">;
}): string {
  return inngestOperationProviderId({ operation });
}
