/**
 * `atlas clerk sync` — publish the COMPILED surface: every operation the four pinned Clerk documents
 * declare, onto the `operation` kind's `compiled` channel, plus every webhook event onto its own kind.
 *
 * ## What this verb can and cannot claim
 *
 * It reads four public documents and reaches no Clerk account, so a `synced` cell here says the pinned
 * documents were compiled in full and says NOTHING about what this installation may call. The
 * `instance-api` surface stays `declared-unfilled` and every kind carries a `not-configured` cell for it,
 * because reading a compiled operation as a capability is the single most available mistake with this atlas
 * and a coverage cell is where it has to be refused.
 *
 * ## The census assertion is aimed at THIS code, not at Clerk
 *
 * The documents are pinned to an immutable commit and digest-verified before they are parsed, so their own
 * numbers cannot move. The assertion (`syncCensus.ts`) therefore catches a change in the READER — a `$ref`
 * that stopped being resolved, an HTTP method quietly dropped from the walk — which is the failure a digest
 * cannot see.
 *
 * ## Three gaps are raised on every successful run, and that is correct
 *
 * `clerk-credential-absent`, `clerk-api-versions-not-compiled` and `browser-single-instance-only`. None can
 * be closed by anything this verb does, and an atlas whose gap list emptied because the only pass that
 * could run had run would be reporting completeness it does not have.
 *
 * ## It never touches the `page` kind
 *
 * The walk owns that kind and the `operation` kind's browser channel. `publishAtlas` leaves an omitted
 * kind's file untouched, and the merge here is channel-scoped, so a sync cannot stale a single row a walk
 * wrote — which matters because the corroboration between the two is the output.
 */
import { countBy } from "../../lib/collections.js";
import { err, ok, type Result } from "../../lib/result.js";

import { compiledGaps } from "./compiledGaps.js";
import { failedClerkCoverageCell, succeededClerkCoverageCell } from "./coverage.js";
import { reconcileClerkGaps } from "./gaps.js";
import { mergeClerkChannel } from "./merge.js";
import {
  CLERK_OPERATION_KIND,
  CLERK_WEBHOOK_EVENT_KIND,
  type ClerkAtlasKind,
  type ClerkAtlasKindFile,
  type ClerkAtlasManifest,
  type ClerkDisposition,
  emptyClerkKindFile,
  initialClerkManifest,
} from "./model.js";
import { projectClerkCompiledOperations } from "./projection.js";
import { CLERK_SPEC_COMMIT } from "./specLock.js";
import { type ClerkOperationRow, type ClerkWebhookEventRow, readClerkSurface } from "./specRead.js";
import { loadClerkSpecs, type SpecFetchLike } from "./specSource.js";
import {
  type ClerkAtlasPaths,
  type ClerkAtlasSnapshot,
  publishClerkAtlas,
  readClerkAtlas,
  withClerkPublishLock,
} from "./store.js";
import { CLERK_API_SURFACE, CLERK_SPEC_SURFACE } from "./surfaceFill.js";
import { clerkCensusMismatch } from "./syncCensus.js";
import { webhookEventKindFile } from "./syncWebhookEvents.js";

/** The entity count of each kind a sync writes — both, always, so the manifest reads each one directly. */
type SyncedKindCounts = Readonly<Record<typeof CLERK_OPERATION_KIND | typeof CLERK_WEBHOOK_EVENT_KIND, number>>;

/** What a sync did, which is what `--json` prints. */
export interface ClerkSyncOutcome {
  readonly specOrigins: Readonly<Record<string, "cache" | "fetch">>;
  readonly operationCount: number;
  readonly webhookEventCount: number;
  readonly dispositionCounts: Readonly<Record<ClerkDisposition, number>>;
  readonly apiCounts: Readonly<Record<string, number>>;
  readonly written: readonly string[];
}

/**
 * Compile the pinned documents and publish them.
 *
 * @param paths the resolved atlas paths
 * @param at this run's ISO timestamp
 * @param fetchImpl the HTTP seam used only when a pinned document is not already cached
 * @returns what was published, or every reason it could not be
 */
export async function syncClerkCompiledSurface({
  paths,
  at,
  fetchImpl,
}: {
  paths: ClerkAtlasPaths;
  at: string;
  fetchImpl?: SpecFetchLike;
}): Promise<Result<ClerkSyncOutcome>> {
  const specs = await loadClerkSpecs(
    fetchImpl === undefined ? { root: paths.directory } : { fetchImpl, root: paths.directory },
  );
  if (specs.isErr()) {
    return err(specs.error);
  }
  const surface = readClerkSurface({ documents: specs.value });
  if (surface.isErr()) {
    return err(surface.error);
  }
  const censusFailure = clerkCensusMismatch({ censuses: surface.value.censuses });
  if (censusFailure !== null) {
    return err(censusFailure);
  }
  const origins: Record<string, "cache" | "fetch"> = {};
  for (const spec of specs.value) {
    origins[spec.document] = spec.origin;
  }
  return withClerkPublishLock({
    nowIso: at,
    paths,
    publish: () =>
      publishCompiled({
        at,
        operations: surface.value.operations,
        origins,
        paths,
        webhookEvents: surface.value.webhookEvents,
      }),
  });
}

/** Read the generation, merge the compiled channel onto it, and publish. */
function publishCompiled({
  paths,
  at,
  operations,
  webhookEvents,
  origins,
}: {
  paths: ClerkAtlasPaths;
  at: string;
  operations: readonly ClerkOperationRow[];
  webhookEvents: readonly ClerkWebhookEventRow[];
  origins: Readonly<Record<string, "cache" | "fetch">>;
}): Result<ClerkSyncOutcome> {
  const snapshot = readClerkAtlas({ paths });
  if (snapshot.isErr()) {
    return err(snapshot.error);
  }
  const built = buildKindFiles({ at, operations, snapshot: snapshot.value, webhookEvents });
  if (built.isErr()) {
    return err(built.error);
  }
  const published = publishClerkAtlas({
    derivedFrom: snapshot.value.manifest,
    files: built.value.files,
    manifest: syncManifest({ at, counts: built.value.counts, manifest: snapshot.value.manifest }),
    paths,
  });
  if (published.isErr()) {
    return err(published.error);
  }
  return ok({
    apiCounts: apiCounts({ operations }),
    dispositionCounts: dispositionCounts({ operations }),
    operationCount: operations.length,
    specOrigins: origins,
    webhookEventCount: webhookEvents.length,
    written: published.value,
  });
}

/**
 * Build the two kind files this verb writes from what it compiled and what the store already holds.
 *
 * The `page` kind is deliberately absent from the returned map, which is what makes a sync unable to touch
 * what a walk wrote.
 */
function buildKindFiles({
  operations,
  webhookEvents,
  snapshot,
  at,
}: {
  operations: readonly ClerkOperationRow[];
  webhookEvents: readonly ClerkWebhookEventRow[];
  snapshot: ClerkAtlasSnapshot;
  at: string;
}): Result<{
  files: Partial<Record<ClerkAtlasKind, ClerkAtlasKindFile>>;
  counts: SyncedKindCounts;
}> {
  const storedOperations =
    snapshot.files[CLERK_OPERATION_KIND] ?? emptyClerkKindFile({ kind: CLERK_OPERATION_KIND, updatedAt: at });
  const storedEvents =
    snapshot.files[CLERK_WEBHOOK_EVENT_KIND] ?? emptyClerkKindFile({ kind: CLERK_WEBHOOK_EVENT_KIND, updatedAt: at });
  const operationFile = operationKindFile({ at, operations, stored: storedOperations });
  if (operationFile.isErr()) {
    return err(operationFile.error);
  }
  const eventFile = webhookEventKindFile({ at, rows: webhookEvents, stored: storedEvents });
  if (eventFile.isErr()) {
    return err(eventFile.error);
  }
  return ok({
    counts: {
      [CLERK_OPERATION_KIND]: operationFile.value.entities.length,
      [CLERK_WEBHOOK_EVENT_KIND]: eventFile.value.entities.length,
    },
    files: { [CLERK_OPERATION_KIND]: operationFile.value, [CLERK_WEBHOOK_EVENT_KIND]: eventFile.value },
  });
}

/** The `operation` kind's next file: the compiled channel merged on, its two coverage cells, and its gaps. */
function operationKindFile({
  operations,
  stored,
  at,
}: {
  operations: readonly ClerkOperationRow[];
  stored: ClerkAtlasKindFile;
  at: string;
}): Result<ClerkAtlasKindFile> {
  const merged = mergeClerkChannel({
    at,
    channel: "compiled",
    observed: projectClerkCompiledOperations({ at, rows: operations }),
    stored: stored.entities,
  });
  if (merged.isErr()) {
    return err(merged.error);
  }
  const gaps = reconcileClerkGaps({
    at,
    observed: compiledGaps({ at, kind: CLERK_OPERATION_KIND, operations }),
    rechecks: [{ condition: "spec-census-moved", resolved: true, scope: CLERK_OPERATION_KIND }],
    runFailed: false,
    stored: stored.gaps,
  });
  if (gaps.isErr()) {
    return err(gaps.error);
  }
  return ok({
    ...stored,
    coverage: compiledCoverage({ at, operations, stored }),
    entities: [...merged.value],
    gaps: [...gaps.value],
    updatedAt: at,
  });
}

/** How many operations this run gave each disposition. */
function dispositionCounts({
  operations,
}: {
  operations: readonly ClerkOperationRow[];
}): Readonly<Record<ClerkDisposition, number>> {
  const counts = { excluded: 0, reachable: 0, voluminous: 0 };
  for (const row of operations) {
    counts[row.disposition] += 1;
  }
  return counts;
}

/** How many operations this run compiled per API. */
function apiCounts({ operations }: { operations: readonly ClerkOperationRow[] }): Readonly<Record<string, number>> {
  return Object.fromEntries(countBy({ keys: operations.map((row) => row.api) }));
}

/** The two coverage cells the operation kind carries: what was compiled, and what has never been called. */
function compiledCoverage({
  operations,
  stored,
  at,
}: {
  operations: readonly ClerkOperationRow[];
  stored: ClerkAtlasKindFile;
  at: string;
}): ClerkAtlasKindFile["coverage"] {
  const counts = dispositionCounts({ operations });
  const kept = stored.coverage.filter(
    (cell) => cell.surface !== CLERK_SPEC_SURFACE && cell.surface !== CLERK_API_SURFACE,
  );
  const previousApi = stored.coverage.find((cell) => cell.surface === CLERK_API_SURFACE) ?? null;
  return [
    ...kept,
    succeededClerkCoverageCell({
      artifacts: [],
      at,
      channel: "compiled",
      reason:
        `${String(operations.length)} operation(s) compiled from the four documents pinned at ` +
        `commit ${CLERK_SPEC_COMMIT.slice(0, 12)}: ${String(counts.reachable)} reachable, ` +
        `${String(counts.voluminous)} voluminous (enumerated and declared, never stored whole), ` +
        `${String(counts.excluded)} excluded. This says the documents were read in full and nothing about ` +
        "what this installation may call",
      role: "authoritative",
      scope: "published-operations",
      state: "synced",
      surface: CLERK_SPEC_SURFACE,
    }),
    failedClerkCoverageCell({
      channel: "api",
      previous: previousApi,
      reason:
        "no Clerk credential is configured on this installation, so no Clerk API has ever been called and " +
        "no entity of this account's has been read. Every operation above is a declaration, not a capability",
      role: "authoritative",
      scope: "instance-entities",
      state: "not-configured",
      surface: CLERK_API_SURFACE,
      unblockedBy:
        "a read-only Clerk secret key minted in the dashboard and stored as `clerk-secret-key` — a widening " +
        "of access, and the owner's to grant",
    }),
  ];
}

/** Stamp the two kinds this run published, leaving every other kind's row exactly as it stood. */
function syncManifest({
  manifest,
  counts,
  at,
}: {
  manifest: ClerkAtlasManifest | null;
  counts: SyncedKindCounts;
  at: string;
}): ClerkAtlasManifest {
  const base = manifest ?? initialClerkManifest({ updatedAt: at });
  const kinds: ClerkAtlasManifest["kinds"] = { ...base.kinds };
  for (const kind of [CLERK_OPERATION_KIND, CLERK_WEBHOOK_EVENT_KIND] as const) {
    kinds[kind] = {
      digest: null,
      entityCount: counts[kind],
      lastAttempt: { at, outcome: "ok", reasons: [] },
      lastSuccessAt: at,
    };
  }
  return { ...base, kinds, updatedAt: at };
}
