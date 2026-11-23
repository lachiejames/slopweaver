/**
 * Publish the API surface: the introspected schema, and — when a token exists — the registry's own content.
 *
 * ## Two acquisitions, one publish, and they fail independently
 *
 * The introspection needs no credential and answers the surface map; the content query needs a registry
 * access token and answers what the registry HOLDS. On an install whose only Hive access is an SSO
 * assignment the first succeeds and the second cannot even be attempted, and that combination is the
 * ORDINARY state rather than a broken run. So the two are graded separately: `operation` and `type` publish
 * a `synced` cell, the three registry kinds publish `not-configured` cells naming exactly what would fill
 * them, and a gap is raised so the open question is on the gap list rather than inferable from an absence.
 *
 * ## The exit code is universal, not existential
 *
 * `kit/coverage.ts` holds no `hasUsableCoverage` (`cells.some(...)`) predicate, because a sync that synced
 * one cell out of twenty would report success. This atlas never leans on one: {@link HiveSyncOutcome} carries the state of each acquisition and the CLI decides the
 * code from the MANDATORY one — a run whose introspection failed is an error however many pages it
 * published. The kit's own refusal now lives at publish time in `kit/mandatoryKinds.ts`.
 *
 * ## It publishes the API channel and never touches the browser one
 *
 * `merge.ts` folds only the channel a run declares, so a sync leaves every witness and every screenshot a
 * console walk wrote exactly where they were — which matters because the disagreement between the two
 * surfaces is this atlas's output rather than a build-time check.
 */
import { err, ok, type Result } from "../../lib/result.js";

import { type HiveClientDeps, hiveGraphql } from "./client.js";
import { mergeHiveChannel, mergeHivePartialChannel } from "./merge.js";
import {
  emptyHiveKindFile,
  HIVE_ATLAS_KINDS,
  type HiveAtlasEntity,
  type HiveAtlasKind,
  type HiveAtlasKindFile,
  type HiveAtlasManifest,
  initialHiveManifest,
} from "./model.js";
import {
  type HiveTargetSchemaArtifact,
  projectHiveConsolePages,
  projectHiveOperations,
  projectHiveOrganizations,
  projectHiveProjects,
  projectHiveTargets,
  projectHiveTypes,
} from "./projection.js";
import { acquireHiveRegistry, type HiveRegistryOutcome } from "./registryAcquire.js";
import { writeHiveSchemaArtifacts } from "./schemaArtifact.js";
import { HIVE_INTROSPECTION_QUERY, reduceHiveSchema } from "./schemaRead.js";
import { type HiveAtlasPaths, publishHiveAtlas, readHiveAtlas, withHivePublishLock } from "./store.js";
import { coverageFor, gapsFor, type HiveAcquisition, isSchemaKind } from "./syncGrading.js";

/** What publishing the API surface did. The CLI grades the exit code from `registry` and the counts. */
export interface HiveSyncOutcome {
  readonly operationCount: number;
  readonly typeCount: number;
  readonly organizationCount: number;
  readonly projectCount: number;
  readonly targetCount: number;
  readonly pageCount: number;
  readonly schemasStored: number;
  readonly registry: HiveRegistryOutcome;
  /** The typed reason the registry half did not sync, in English, or `null` when it did. */
  readonly registryReason: string | null;
  readonly written: readonly string[];
}

/**
 * Introspect Hive's schema, read the registry when a token allows it, and publish both onto the API channel.
 *
 * @param paths the resolved atlas paths
 * @param deps the transport and the token; a `null` token still introspects, and skips the content query
 * @param at this run's ISO timestamp
 * @returns what was published, or every reason nothing could be
 */
export async function syncHiveApiSurface({
  paths,
  deps,
  organizationSlugs,
  at,
}: {
  paths: HiveAtlasPaths;
  deps: HiveClientDeps;
  organizationSlugs: readonly string[];
  at: string;
}): Promise<Result<HiveSyncOutcome>> {
  const acquired = await acquire({ deps, organizationSlugs });
  if (acquired.isErr()) {
    return err(acquired.error);
  }
  // The read and the write are one critical section: another publisher landing between them would have its
  // rows replaced by files derived from the generation this one read. See `withHivePublishLock`.
  return withHivePublishLock({
    nowIso: at,
    paths,
    publish: () => publishAcquisition({ acquisition: acquired.value, at, paths }),
  });
}

/**
 * Run both queries, grading the registry half separately from the mandatory one.
 *
 * @param deps the transport and the token
 * @param organizationSlugs which organisations to read; the API declares no list field, so a run that names
 *   none can reach no content at all — see `registryRead.ts`
 * @returns both surfaces plus how the registry half went, or the reason the introspection itself failed
 */
async function acquire({
  deps,
  organizationSlugs,
}: {
  deps: HiveClientDeps;
  organizationSlugs: readonly string[];
}): Promise<Result<HiveAcquisition>> {
  const introspected = await hiveGraphql({ deps, query: HIVE_INTROSPECTION_QUERY, variables: {} });
  if (introspected.isErr()) {
    return err([introspected.error.message]);
  }
  const reduced = reduceHiveSchema({ data: introspected.value });
  if (reduced.isErr()) {
    return err([reduced.error.message]);
  }
  const schema = reduced.value;
  if (schema.operations.length === 0) {
    return err([
      "the introspection answered 200 and declared no root fields at all — this build cannot map a schema " +
        "it cannot read, and publishing an empty surface would claim Hive has no API",
    ]);
  }
  return ok({ ...(await acquireHiveRegistry({ deps, organizationSlugs, schema })), schema });
}

/** The critical section: read the generation, merge the API channel onto it, and publish. */
function publishAcquisition({
  acquisition,
  paths,
  at,
}: {
  acquisition: HiveAcquisition;
  paths: HiveAtlasPaths;
  at: string;
}): Result<HiveSyncOutcome> {
  const snapshot = readHiveAtlas({ paths });
  if (snapshot.isErr()) {
    return err(snapshot.error);
  }
  const schemas = writeHiveSchemaArtifacts({ paths, targets: acquisition.registry.targets });
  if (schemas.isErr()) {
    return err(schemas.error);
  }
  const projected = projectAll({ acquisition, at, schemas: schemas.value });
  const files = mergedFiles({ acquisition, at, projected, snapshot: snapshot.value.files });
  if (files.isErr()) {
    return err(files.error);
  }
  const published = publishHiveAtlas({
    derivedFrom: snapshot.value.manifest,
    files: files.value,
    manifest: syncManifest({ at, files: files.value, manifest: snapshot.value.manifest }),
    paths,
  });
  if (published.isErr()) {
    return err(published.error);
  }
  return ok(outcomeOf({ acquisition, files: files.value, schemas: schemas.value, written: published.value }));
}

/** Every kind's freshly projected entities, on the API channel alone. */
function projectAll({
  acquisition,
  schemas,
  at,
}: {
  acquisition: HiveAcquisition;
  schemas: readonly HiveTargetSchemaArtifact[];
  at: string;
}): Readonly<Record<HiveAtlasKind, readonly HiveAtlasEntity[]>> {
  const { registry, schema } = acquisition;
  return {
    operation: projectHiveOperations({ at, surface: schema }),
    organization: projectHiveOrganizations({ at, registry }),
    page: projectHiveConsolePages({ at, registry }),
    project: projectHiveProjects({ at, registry }),
    target: projectHiveTargets({ at, registry, schemas }),
    type: projectHiveTypes({ at, surface: schema }),
  };
}

/**
 * Merge each kind onto what the store already holds and attach this run's coverage cell.
 *
 * A kind the registry half could not read is deliberately merged with an EMPTY observation set rather than
 * skipped: the merge stales what it did not see, so a target the registry no longer returns stops claiming
 * to be current without its row being deleted — "accumulate, never replace".
 *
 * @param acquisition what both queries produced
 * @param projected this run's freshly projected entities per kind
 * @param snapshot the kind files the store already holds
 * @param at this run's ISO timestamp
 * @returns every kind file to publish, or the reason a merge was refused
 */
function mergedFiles({
  acquisition,
  projected,
  snapshot,
  at,
}: {
  acquisition: HiveAcquisition;
  projected: Readonly<Record<HiveAtlasKind, readonly HiveAtlasEntity[]>>;
  snapshot: Readonly<Partial<Record<HiveAtlasKind, HiveAtlasKindFile | null>>>;
  at: string;
}): Result<Readonly<Record<HiveAtlasKind, HiveAtlasKindFile>>> {
  const built = new Map<HiveAtlasKind, HiveAtlasKindFile>();
  for (const kind of HIVE_ATLAS_KINDS) {
    const stored = snapshot[kind] ?? emptyHiveKindFile({ kind, updatedAt: at });
    const merged = mergeFor({ acquisition, at, kind, observed: projected[kind], stored: stored.entities });
    if (merged.isErr()) {
      return err(merged.error);
    }
    built.set(kind, {
      ...stored,
      coverage: coverageFor({ acquisition, at, kind, stored }),
      entities: [...merged.value],
      gaps: gapsFor({ acquisition, at, kind, stored }),
      updatedAt: at,
    });
  }
  return ok({
    operation: built.get("operation")!,
    organization: built.get("organization")!,
    page: built.get("page")!,
    project: built.get("project")!,
    target: built.get("target")!,
    type: built.get("type")!,
  });
}

/**
 * Merge one kind, choosing whether this run saw enough of it to stale what it did not.
 *
 * Three cases, and they are genuinely different rather than three spellings of one. A schema kind, and any
 * kind on a run whose content half synced, was fully observed: stale the absent. The page kind on a run
 * whose content half did NOT sync was partially observed — the two root-scope routes and nothing else — so
 * it merges without staling. Any other kind on such a run was not observed at all, and is left exactly as
 * it stands.
 *
 * @param acquisition what both queries produced
 * @param kind the kind being merged
 * @param observed this run's projection for it
 * @param stored what the generation already holds
 * @param at this run's ISO timestamp
 * @returns the merged entities, or the reason the merge was refused
 */
function mergeFor({
  acquisition,
  kind,
  observed,
  stored,
  at,
}: {
  acquisition: HiveAcquisition;
  kind: HiveAtlasKind;
  observed: readonly HiveAtlasEntity[];
  stored: readonly HiveAtlasEntity[];
  at: string;
}): Result<readonly HiveAtlasEntity[]> {
  if (isSchemaKind({ kind }) || acquisition.outcome === "synced") {
    return mergeHiveChannel({ at, channel: "api", observed, stored });
  }
  if (kind === "page") {
    return mergeHivePartialChannel({ at, channel: "api", observed, stored });
  }
  return ok(stored);
}

/** Stamp every kind's status and the manifest's own clock from the same instant this run wrote its files. */
function syncManifest({
  manifest,
  files,
  at,
}: {
  manifest: HiveAtlasManifest | null;
  files: Readonly<Record<HiveAtlasKind, HiveAtlasKindFile>>;
  at: string;
}): HiveAtlasManifest {
  const base = manifest ?? initialHiveManifest({ updatedAt: at });
  const kinds = { ...base.kinds };
  for (const kind of HIVE_ATLAS_KINDS) {
    kinds[kind] = {
      digest: null,
      entityCount: files[kind].entities.length,
      lastAttempt: { at, outcome: "ok", reasons: [] },
      lastSuccessAt: at,
    };
  }
  return { ...base, kinds, updatedAt: at };
}

/** What to report, counted from what was actually published rather than from what was projected. */
function outcomeOf({
  acquisition,
  files,
  schemas,
  written,
}: {
  acquisition: HiveAcquisition;
  files: Readonly<Record<HiveAtlasKind, HiveAtlasKindFile>>;
  schemas: readonly HiveTargetSchemaArtifact[];
  written: readonly string[];
}): HiveSyncOutcome {
  return {
    operationCount: files.operation.entities.length,
    organizationCount: files.organization.entities.length,
    pageCount: files.page.entities.length,
    projectCount: files.project.entities.length,
    registry: acquisition.outcome,
    registryReason: acquisition.reason,
    schemasStored: schemas.length,
    targetCount: files.target.entities.length,
    typeCount: files.type.entities.length,
    written: [...written],
  };
}
