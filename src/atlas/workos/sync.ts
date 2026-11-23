/**
 * `atlas workos sync` — probe the route map, read the content when a key allows it, and publish both onto
 * the API channel.
 *
 * ## The two halves are graded SEPARATELY, and that is the design
 *
 * On this platform the map and the content have different credential requirements: the route probe needs
 * none at all and the content read needs an environment-scoped key. Folding them into one outcome would
 * force one status to lie about the other — an install with no key would either report a broken atlas
 * (false: the map is complete) or a synced one (false: no entity was read). So the route half is mandatory
 * and its failure fails the run, while the content half is graded on its own and a missing key leaves a
 * `synced` map standing beside a `not-configured` content surface, exit 0.
 *
 * ## The four content FAMILIES are graded separately too, for the same reason one step down
 *
 * Organisations, users, SSO connections and SCIM directories are four independent endpoints with four
 * independent failure modes, so each carries its own grade, its own coverage cell, its own gap and its own
 * merge mode. MEASURED: the content half read all four families fine and then called
 * `GET /user_management/organization_memberships?limit=100`, which WorkOS refuses with HTTP 400 because
 * that listing requires `organization_id` or `user_id` — and one shared outcome turned that single
 * malformed call into a published run reporting zero organisations, zero users, zero connections and zero
 * directories. A run that has paid for four good collections must not throw them away because a fifth call
 * was wrong. The ROLLUP still exists, worst-first, and is what the CLI grades its exit code from; nothing
 * judges a single kind by it.
 *
 * ## The oracle is checked before anything is published
 *
 * The route map's whole value rests on `absent` meaning something. So a control path that cannot exist is
 * probed alongside the candidates, and a run whose control does NOT come back absent publishes nothing at
 * all — `ORACLE_UNTRUSTWORTHY`. Without that, a WorkOS that started answering `401` to every path would
 * fill this atlas with routes that do not exist and nothing would notice.
 *
 * ## The page kind is written here, and the walk writes the same rows' other channel
 *
 * A sync publishes every declared dashboard address on the API channel, because `docs/atlas-intent/05-browser-proof.md` puts
 * the exact URL first and an agent needs it on an install whose browser surface has never been filled.
 * `browserSurface.ts` fills the BROWSER channel of those same rows. The two never collide, because
 * `merge.ts` is channel-scoped.
 */
import { err, ok, type Result } from "../../lib/result.js";

import { type WorkosFetch, workosProbe } from "./client.js";
import {
  acquireWorkosContent,
  unattemptedWorkosContent,
  type WorkosContentKind,
  type WorkosContentOutcome,
} from "./contentAcquire.js";
import { resolveWorkosEnvironmentId, type WorkosEnvironmentResolution } from "./environmentId.js";
import { type WorkosApiError, WorkosApiErrors } from "./errors.js";
import { mergeFor } from "./merge.js";
import {
  emptyWorkosKindFile,
  initialWorkosManifest,
  WORKOS_ATLAS_KINDS,
  type WorkosAtlasEntity,
  type WorkosAtlasKind,
  type WorkosAtlasKindFile,
  type WorkosAtlasManifest,
} from "./model.js";
import {
  projectWorkosConnections,
  projectWorkosDeclaredPages,
  projectWorkosDirectories,
  projectWorkosOperations,
  projectWorkosOrganizations,
  projectWorkosUsers,
  type WorkosProbedRoute,
} from "./projection.js";
import { WORKOS_ORACLE_CONTROL_PATH, WORKOS_ROUTE_CANDIDATES } from "./routeCandidates.js";
import { classifyWorkosProbe, workosRouteIsPresent } from "./routeProbe.js";
import { publishWorkosAtlas, readWorkosAtlas, type WorkosAtlasPaths, withWorkosPublishLock } from "./store.js";
import { coverageFor } from "./syncCoverage.js";
import { gapsFor, type WorkosAcquisition } from "./syncGaps.js";
/** What publishing the API surface did. The CLI grades the exit code from `content` and the counts. */
export interface WorkosSyncOutcome {
  readonly probedCount: number;
  readonly presentCount: number;
  readonly absentCount: number;
  readonly pageCount: number;
  readonly organizationCount: number;
  readonly userCount: number;
  readonly connectionCount: number;
  readonly directoryCount: number;
  /** The ROLLUP, worst-first, and what the exit code is graded from. Never what one family is judged by. */
  readonly content: WorkosContentOutcome;
  /** The typed reason the content half did not sync, in English, or `null` when it did. */
  readonly contentReason: string | null;
  /**
   * Each family's own outcome and reason. Present because the rollup cannot say WHICH endpoint refused,
   * and this verb's `--json` is what a finding gets read out of.
   */
  readonly families: Readonly<Record<WorkosContentKind, { outcome: WorkosContentOutcome; reason: string | null }>>;
  readonly written: readonly string[];
}
/**
 * Probe every route, read the content when a key allows it, and publish both onto the API channel.
 *
 * @param paths the resolved atlas paths
 * @param fetch the injected transport
 * @param apiKey the resolved API key, or the typed reason there is none — a missing key still maps routes
 * @param env the process environment, which `WORKOS_ENVIRONMENT_ID` is read from
 * @param at this run's ISO timestamp
 * @returns what was published, or every reason nothing could be
 */
export async function syncWorkosApiSurface({
  paths,
  fetch,
  apiKey,
  env,
  at,
}: {
  paths: WorkosAtlasPaths;
  fetch: WorkosFetch;
  apiKey: Result<string, WorkosApiError>;
  env: Readonly<Record<string, string | undefined>>;
  at: string;
}): Promise<Result<WorkosSyncOutcome>> {
  const acquired = await acquire({ apiKey, fetch });
  if (acquired.isErr()) {
    return err(acquired.error);
  }
  // The read and the write are one critical section: another publisher landing between them would have its
  // rows replaced by files derived from the generation this one read. See `withWorkosPublishLock`.
  return withWorkosPublishLock({
    nowIso: at,
    paths,
    publish: () => publishAcquisition({ acquisition: acquired.value, at, env, paths }),
  });
}
/**
 * Run both halves, grading the content half separately from the mandatory one.
 *
 * @param fetch the injected transport
 * @param apiKey the resolved key, or the typed reason there is none
 * @returns both surfaces plus how the content half went, or the reason the route map itself failed
 */
async function acquire({
  fetch,
  apiKey,
}: {
  fetch: WorkosFetch;
  apiKey: Result<string, WorkosApiError>;
}): Promise<Result<WorkosAcquisition>> {
  const probed = await probeRoutes({ fetch });
  if (probed.isErr()) {
    return err([probed.error.message]);
  }
  if (apiKey.isErr()) {
    return ok({ ...unattemptedWorkosContent({ error: apiKey.error }), probed: probed.value });
  }
  const content = await acquireWorkosContent({ apiKey: apiKey.value, fetch });
  return ok({ ...content, probed: probed.value });
}
/**
 * Probe the control path and every candidate, refusing the whole run if the oracle no longer holds.
 *
 * @param fetch the injected transport
 * @returns every candidate's verdict, or the typed reason the map cannot be trusted
 */
async function probeRoutes({
  fetch,
}: {
  fetch: WorkosFetch;
}): Promise<Result<readonly WorkosProbedRoute[], WorkosApiError>> {
  const control = await workosProbe({ fetch, httpMethod: "GET", path: WORKOS_ORACLE_CONTROL_PATH });
  if (control.isErr()) {
    return err(control.error);
  }
  const controlVerdict = classifyWorkosProbe({ response: control.value }).verdict;
  if (controlVerdict !== "absent") {
    return err(
      WorkosApiErrors.oracleUntrustworthy({
        controlPath: WORKOS_ORACLE_CONTROL_PATH,
        observedVerdict: controlVerdict,
      }),
    );
  }
  const probed: WorkosProbedRoute[] = [];
  for (const candidate of WORKOS_ROUTE_CANDIDATES) {
    const response = await workosProbe({ fetch, httpMethod: candidate.httpMethod, path: candidate.path });
    if (response.isErr()) {
      return err(response.error);
    }
    probed.push({
      candidate,
      classification: classifyWorkosProbe({ response: response.value }),
      statusCode: response.value.status,
    });
  }
  return ok(probed);
}
/**
 * Merge, guard and publish one acquisition.
 *
 * @param acquisition what both halves produced
 * @param paths the resolved atlas paths
 * @param env the process environment, which `WORKOS_ENVIRONMENT_ID` is read from
 * @param at this run's ISO timestamp
 * @returns what was published, or every reason nothing could be
 */
function publishAcquisition({
  acquisition,
  paths,
  env,
  at,
}: {
  acquisition: WorkosAcquisition;
  paths: WorkosAtlasPaths;
  env: Readonly<Record<string, string | undefined>>;
  at: string;
}): Result<WorkosSyncOutcome> {
  const snapshot = readWorkosAtlas({ paths });
  if (snapshot.isErr()) {
    return err(snapshot.error);
  }
  // Resolved inside the lock, off the generation this run is about to derive from: the environment segment
  // is per-install state a previous walk witnessed, so reading it any earlier would read a different world.
  const environment = resolveWorkosEnvironmentId({ env, pages: storedPages({ files: snapshot.value.files }) });
  const projected = projectAll({ acquisition, at, environment });
  const files = mergedFiles({ acquisition, at, environment, projected, snapshot: snapshot.value.files });
  if (files.isErr()) {
    return err(files.error);
  }
  const published = publishWorkosAtlas({
    derivedFrom: snapshot.value.manifest,
    files: files.value,
    manifest: syncManifest({ at, files: files.value, manifest: snapshot.value.manifest }),
    paths,
  });
  if (published.isErr()) {
    return err(published.error);
  }
  return ok(outcomeOf({ acquisition, files: files.value, written: published.value }));
}
/**
 * The `page` entities the generation already holds, as the environment resolver reads them.
 *
 * Written as a branch rather than a defaulted lookup because `no-silent-fallback` bans the `??`, and the
 * absent case is real: the first sync on an install has no page file at all.
 */
function storedPages({
  files,
}: {
  files: Readonly<Partial<Record<WorkosAtlasKind, WorkosAtlasKindFile | null>>>;
}): readonly WorkosAtlasEntity[] {
  const page = files.page;
  if (page === undefined || page === null) {
    return [];
  }
  return page.entities;
}
/** Every kind's freshly projected entities, on the API channel alone. */
function projectAll({
  acquisition,
  environment,
  at,
}: {
  acquisition: WorkosAcquisition;
  environment: WorkosEnvironmentResolution;
  at: string;
}): Readonly<Record<WorkosAtlasKind, readonly WorkosAtlasEntity[]>> {
  const { content, probed } = acquisition;
  const environmentId = resolvedEnvironmentId({ environment });
  return {
    connection: projectWorkosConnections({ at, environmentId, records: content.connections }),
    directory: projectWorkosDirectories({ at, environmentId, records: content.directories }),
    operation: projectWorkosOperations({ at, probed }),
    organization: projectWorkosOrganizations({ at, environmentId, records: content.organizations }),
    page: projectWorkosDeclaredPages({ at, environmentId }),
    user: projectWorkosUsers({ at, environmentId, records: content.users }),
  };
}
/**
 * The resolved segment, or `null` when this install has none.
 *
 * The projections take the nullable form because an unresolved environment still has to produce the
 * bootstrap address (`dashboardPages.ts`); the resolution's own REASON is what the gap carries.
 */
function resolvedEnvironmentId({ environment }: { environment: WorkosEnvironmentResolution }): string | null {
  if (environment.state === "resolved") {
    return environment.environmentId;
  }
  return null;
}
/**
 * Merge each kind onto what the store already holds and attach this run's coverage cell and gaps.
 *
 * @param acquisition what both halves produced
 * @param projected this run's freshly projected entities per kind
 * @param snapshot the kind files the store already holds
 * @param environment this installation's environment segment, or the reason there is none
 * @param at this run's ISO timestamp
 * @returns every kind file to publish, or the reason a merge was refused
 */
function mergedFiles({
  acquisition,
  projected,
  snapshot,
  environment,
  at,
}: {
  acquisition: WorkosAcquisition;
  projected: Readonly<Record<WorkosAtlasKind, readonly WorkosAtlasEntity[]>>;
  snapshot: Readonly<Partial<Record<WorkosAtlasKind, WorkosAtlasKindFile | null>>>;
  environment: WorkosEnvironmentResolution;
  at: string;
}): Result<Readonly<Record<WorkosAtlasKind, WorkosAtlasKindFile>>> {
  const built = new Map<WorkosAtlasKind, WorkosAtlasKindFile>();
  for (const kind of WORKOS_ATLAS_KINDS) {
    const stored = snapshot[kind] ?? emptyWorkosKindFile({ kind, updatedAt: at });
    const merged = mergeFor({ acquisition, at, kind, observed: projected[kind], stored: stored.entities });
    if (merged.isErr()) {
      return err(merged.error);
    }
    built.set(kind, {
      ...stored,
      coverage: coverageFor({ acquisition, at, environment, kind, stored }),
      entities: [...merged.value],
      gaps: gapsFor({ acquisition, at, environment, kind, stored }),
      updatedAt: at,
    });
  }
  return ok({
    connection: built.get("connection")!,
    directory: built.get("directory")!,
    operation: built.get("operation")!,
    organization: built.get("organization")!,
    page: built.get("page")!,
    user: built.get("user")!,
  });
}
/** Stamp every kind's status and the manifest's own clock from the same instant this run wrote its files. */
function syncManifest({
  manifest,
  files,
  at,
}: {
  manifest: WorkosAtlasManifest | null;
  files: Readonly<Record<WorkosAtlasKind, WorkosAtlasKindFile>>;
  at: string;
}): WorkosAtlasManifest {
  const base = manifest ?? initialWorkosManifest({ updatedAt: at });
  const kinds = { ...base.kinds };
  for (const kind of WORKOS_ATLAS_KINDS) {
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
  written,
}: {
  acquisition: WorkosAcquisition;
  files: Readonly<Record<WorkosAtlasKind, WorkosAtlasKindFile>>;
  written: readonly string[];
}): WorkosSyncOutcome {
  const present = acquisition.probed.filter((row) => workosRouteIsPresent({ verdict: row.classification.verdict }));
  return {
    absentCount: acquisition.probed.length - present.length,
    connectionCount: files.connection.entities.length,
    content: acquisition.outcome,
    contentReason: acquisition.reason,
    directoryCount: files.directory.entities.length,
    families: acquisition.families,
    organizationCount: files.organization.entities.length,
    pageCount: files.page.entities.length,
    presentCount: present.length,
    probedCount: acquisition.probed.length,
    userCount: files.user.entities.length,
    written: [...written],
  };
}
