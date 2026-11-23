/**
 * One reader per kind family: the calls, in the order Falcon requires them, projected into storable
 * entities and carrying the proof of whether the read finished.
 *
 * Split from `sync.ts` so that file owns folding and publishing and this one, with `syncPostureReaders.ts`
 * beside it for the policy, Zero Trust and detection families, owns talking to the provider.
 * Everything here is driven through `client.ts`, which takes a CALL ID rather than a path — so no reader
 * can reach an endpoint the closed inventory does not list, however it is written.
 *
 * ## Falcon's query-then-entity shape, and where the enrichments sit
 *
 * Most families are two calls: a `queries` endpoint returning ids, then an `entities` endpoint taking them
 * in batches. Hosts add one more query, for hidden-device ids, which fails the family like any id query, and
 * two enrichment calls that decorate the ids already obtained. Only the two enrichments are SOFT: one that
 * fails leaves its fields null and records a problem, rather than failing the family. A host with no online
 * state is still a host; a host list that failed is not a shorter fleet.
 *
 * ## The Spotlight read takes a narrowing filter
 *
 * Spotlight is filtered to `status:'open'` because a closed finding is not a finding the ISO
 * question asks about, and that narrowing is declared in the coverage reason rather than left implicit.
 */
import { isRecord } from "../../lib/parsers.js";
import { err, ok, type Result } from "../../lib/result.js";

import type { CrowdstrikeClientDeps } from "./client.js";
import type { CrowdstrikeHost, CrowdstrikeHostGroup, CrowdstrikeVulnerability } from "./entities.js";
import type { CrowdstrikeError } from "./errors.js";
import { type CompleteFamilyRead, provenCompleteRead } from "./merge.js";
import type { CrowdstrikeKind } from "./model.js";
import { readCursorPaged, readIdBatches, readOffsetPaged } from "./paging.js";
import { projectCrowdstrikeHost, projectCrowdstrikeHostGroup } from "./projectHosts.js";
import type { ProjectionContext } from "./projectionEnvelope.js";
import { projectCrowdstrikeVulnerability } from "./projectVulnerabilities.js";

/** How many records to ask for per page. Generous: the whole host list arrives in one page at this size. */
export const PAGE_SIZE = 500;

/** What one family read produced. */
export interface KindRead<TEntity> {
  readonly entities: readonly TEntity[];
  /** The proof that the read finished, or `null` when it did not — `merge.ts` will stale nothing then. */
  readonly complete: CompleteFamilyRead | null;
  /** What a successful coverage cell says about this read, in English. */
  readonly reason: string;
  /** Records the provider returned that could not be projected, and enrichments that failed. */
  readonly problems: readonly string[];
}

/**
 * Every string in a resource list, for a `queries` endpoint that returns bare ids.
 *
 * @returns the non-empty string ids, in resource order
 */
export function idsOf({ resources }: { resources: readonly unknown[] }): readonly string[] {
  return resources.filter((entry): entry is string => typeof entry === "string" && entry.length > 0);
}

/**
 * Project a list of raw resources, collecting refusals rather than failing the family.
 *
 * @returns the entities that projected, and every refusal from those that did not
 */
export function projectAll<TEntity>({
  resources,
  project,
}: {
  resources: readonly unknown[];
  project: (input: { raw: unknown }) => Result<TEntity>;
}): { entities: readonly TEntity[]; problems: readonly string[] } {
  const entities: TEntity[] = [];
  const problems: string[] = [];
  for (const raw of resources) {
    const projected = project({ raw });
    if (projected.isErr()) {
      problems.push(...projected.error);
      continue;
    }
    entities.push(projected.value);
  }
  return { entities, problems };
}

/**
 * The projection context for one API-surface read.
 *
 * @returns the context stamping each entity with this run's instant and the `falcon-api` endpoint it came from
 */
export function apiContext({ at, endpoint }: { at: string; endpoint: string }): ProjectionContext {
  return { at, source: { endpoint, observedAt: at, surface: "falcon-api" } };
}

/** Index raw resources by one of their own string fields, for an enrichment fold. */
function indexBy({ resources, field }: { resources: readonly unknown[]; field: string }): Map<string, unknown> {
  const index = new Map<string, unknown>();
  for (const raw of resources) {
    if (!isRecord(raw)) {
      continue;
    }
    const key = raw[field];
    if (typeof key === "string" && key.length > 0) {
      index.set(key, raw);
    }
  }
  return index;
}

/**
 * Read one enrichment, treating a failure as a missing decoration rather than a failed family.
 *
 * @param callId the admitted enrichment call
 * @param ids the ids to decorate
 * @param byBody whether the ids travel in a POST body
 * @param keyField the field each returned resource is keyed by
 * @param deps the client dependencies
 * @returns the index, and the reason it is empty when the call failed
 */
async function readEnrichment({
  callId,
  ids,
  byBody,
  keyField,
  deps,
}: {
  callId: string;
  ids: readonly string[];
  byBody: boolean;
  keyField: string;
  deps: CrowdstrikeClientDeps;
}): Promise<{ index: Map<string, unknown>; problems: readonly string[] }> {
  const read = await readIdBatches({ batchLimit: 100, byBody, callId, deps, idParam: "ids", ids });
  if (read.isErr()) {
    return { index: new Map<string, unknown>(), problems: [`enrichment ${callId} did not run: ${read.error.message}`] };
  }
  return { index: indexBy({ field: keyField, resources: read.value.resources }), problems: [] };
}

/**
 * Read every host, visible and hidden, with its online state and most recent login folded in.
 *
 * Hidden devices are read through their own query and carried with `hidden: true` rather than dropped: a
 * machine Falcon has stopped counting is exactly the kind of thing the ISO question is about, and omitting
 * it would make this atlas quietly disagree with the console for a reason nobody could see.
 *
 * @param deps the client dependencies
 * @param at this run's ISO timestamp
 * @returns the hosts and the proof the read finished, or the typed failure that stopped it
 */
export async function readCrowdstrikeHosts({
  deps,
  at,
}: {
  deps: CrowdstrikeClientDeps;
  at: string;
}): Promise<Result<KindRead<CrowdstrikeHost>, CrowdstrikeError>> {
  const visible = await readOffsetPaged({ callId: "hosts-visible-ids", deps, pageSize: PAGE_SIZE, query: {} });
  if (visible.isErr()) {
    return err(visible.error);
  }
  const hiddenRead = await readOffsetPaged({ callId: "hosts-hidden-ids", deps, pageSize: PAGE_SIZE, query: {} });
  if (hiddenRead.isErr()) {
    return err(hiddenRead.error);
  }
  const visibleIds = idsOf({ resources: visible.value.resources });
  const hiddenIds = idsOf({ resources: hiddenRead.value.resources });
  const allIds = [...new Set([...visibleIds, ...hiddenIds])];

  const detail = await readIdBatches({
    batchLimit: 100,
    byBody: false,
    callId: "host-entities",
    deps,
    idParam: "ids",
    ids: allIds,
  });
  if (detail.isErr()) {
    return err(detail.error);
  }
  const decorated = await decorateHosts({
    context: apiContext({ at, endpoint: detail.value.endpoint }),
    deps,
    hidden: new Set(hiddenIds),
    ids: allIds,
    resources: detail.value.resources,
  });
  const complete = provenCompleteRead({
    kind: "host",
    observed: decorated.entities.length,
    pagesExhausted: visible.value.pagesExhausted && hiddenRead.value.pagesExhausted,
    reportedTotal: totalOf({ left: visible.value.reportedTotal, right: hiddenRead.value.reportedTotal }),
  });
  return ok({
    complete: complete.isOk() ? complete.value : null,
    entities: decorated.entities,
    problems: [...decorated.problems, ...(complete.isErr() ? complete.error : [])],
    reason: `read ${String(decorated.entities.length)} host(s) — ${String(visibleIds.length)} visible and ${String(hiddenIds.length)} hidden`,
  });
}

/**
 * Fold the two soft enrichments onto the host detail and project the result.
 *
 * Soft on purpose: an enrichment that failed leaves its fields null and records a problem, rather than
 * failing the family. A host with no online state is still a host; a host LIST that failed is not a shorter
 * fleet, and that difference is why these two are read here and the list is read above.
 *
 * @param resources the raw host detail
 * @param ids every host id, so an enrichment covers the hidden ones too
 * @param hidden which of those ids came from the hidden-device query
 * @param context this run's provenance
 * @param deps the client dependencies
 * @returns the projected hosts and everything that could not be read or projected
 */
async function decorateHosts({
  resources,
  ids,
  hidden,
  context,
  deps,
}: {
  resources: readonly unknown[];
  ids: readonly string[];
  hidden: ReadonlySet<string>;
  context: ProjectionContext;
  deps: CrowdstrikeClientDeps;
}): Promise<{ entities: readonly CrowdstrikeHost[]; problems: readonly string[] }> {
  const online = await readEnrichment({ byBody: false, callId: "host-online-state", deps, ids, keyField: "id" });
  const logins = await readEnrichment({
    byBody: true,
    callId: "host-login-history",
    deps,
    ids,
    keyField: "device_id",
  });
  const projected = projectAll({
    project: ({ raw }) =>
      projectCrowdstrikeHost({
        context,
        hidden: hidden.has(deviceIdOf({ raw })),
        loginHistory: logins.index.get(deviceIdOf({ raw })) ?? null,
        onlineState: online.index.get(deviceIdOf({ raw })) ?? null,
        raw,
      }),
    resources,
  });
  return {
    entities: projected.entities,
    problems: [...projected.problems, ...online.problems, ...logins.problems],
  };
}

/** The `device_id` of a raw host resource, or the empty string when it has none. */
function deviceIdOf({ raw }: { raw: unknown }): string {
  if (!isRecord(raw)) {
    return "";
  }
  const id = raw["device_id"];
  return typeof id === "string" ? id : "";
}

/** Add two optional provider totals, keeping `null` when neither side reported one. */
function totalOf({ left, right }: { left: number | null; right: number | null }): number | null {
  if (left === null && right === null) {
    return null;
  }
  return (left ?? 0) + (right ?? 0);
}

/**
 * Read a family that is one `queries` call followed by one `entities` call.
 *
 * The shape most Falcon families take, so it is one function rather than five near-copies — a batch limit
 * and a projection are the only things that differ.
 *
 * @param kind the kind being read, which the completeness proof names
 * @param queryCallId the admitted call returning ids
 * @param entityCallId the admitted call returning detail
 * @param batchLimit how many ids the entity call takes at once
 * @param label what a coverage reason calls one of these, e.g. `prevention policy`
 * @param project how to turn one raw resource into an entity
 * @param deps the client dependencies
 * @param at this run's ISO timestamp
 * @returns the entities and the proof the read finished, or the typed failure that stopped it
 *
 * @internal
 */
export async function readQueryThenEntities<TEntity>({
  kind,
  queryCallId,
  entityCallId,
  batchLimit,
  label,
  project,
  deps,
  at,
}: {
  kind: CrowdstrikeKind;
  queryCallId: string;
  entityCallId: string;
  batchLimit: number;
  label: string;
  project: (input: { raw: unknown; context: ProjectionContext }) => Result<TEntity>;
  deps: CrowdstrikeClientDeps;
  at: string;
}): Promise<Result<KindRead<TEntity>, CrowdstrikeError>> {
  const query = await readOffsetPaged({ callId: queryCallId, deps, pageSize: PAGE_SIZE, query: {} });
  if (query.isErr()) {
    return err(query.error);
  }
  const ids = idsOf({ resources: query.value.resources });
  const detail = await readIdBatches({ batchLimit, byBody: false, callId: entityCallId, deps, idParam: "ids", ids });
  if (detail.isErr()) {
    return err(detail.error);
  }
  const context = apiContext({ at, endpoint: detail.value.endpoint });
  const projected = projectAll({ project: ({ raw }) => project({ context, raw }), resources: detail.value.resources });
  const complete = provenCompleteRead({
    kind,
    observed: projected.entities.length,
    pagesExhausted: query.value.pagesExhausted,
    reportedTotal: query.value.reportedTotal,
  });
  return ok({
    complete: complete.isOk() ? complete.value : null,
    entities: projected.entities,
    problems: [...projected.problems, ...(complete.isErr() ? complete.error : [])],
    reason: `read ${String(projected.entities.length)} ${label}(s)`,
  });
}

/**
 * Read every host group.
 *
 * @param deps the client dependencies
 * @param at this run's ISO timestamp
 * @returns the host groups and the proof the read finished, or the typed failure that stopped it
 */
export async function readCrowdstrikeHostGroups({
  deps,
  at,
}: {
  deps: CrowdstrikeClientDeps;
  at: string;
}): Promise<Result<KindRead<CrowdstrikeHostGroup>, CrowdstrikeError>> {
  return readQueryThenEntities({
    at,
    batchLimit: 100,
    deps,
    entityCallId: "host-group-entities",
    kind: "host-group",
    label: "host group",
    project: ({ raw, context }) => projectCrowdstrikeHostGroup({ context, raw }),
    queryCallId: "host-group-ids",
  });
}

/**
 * Read every open Spotlight finding.
 *
 * Narrowed to open findings and read with the `cve` facet, which is what carries the base score, the
 * severity, the exploit status and the CISA KEV flag — without it the response holds only the CVE's id, and
 * a vulnerability record with no score answers none of the questions it exists for.
 *
 * @param deps the client dependencies
 * @param at this run's ISO timestamp
 * @returns the findings and the proof the read finished, or the typed failure that stopped it
 */
export async function readCrowdstrikeVulnerabilities({
  deps,
  at,
}: {
  deps: CrowdstrikeClientDeps;
  at: string;
}): Promise<Result<KindRead<CrowdstrikeVulnerability>, CrowdstrikeError>> {
  const read = await readCursorPaged({
    callId: "open-vulnerabilities",
    deps,
    pageSize: 400,
    query: { facet: "cve", filter: "status:'open'" },
  });
  if (read.isErr()) {
    return err(read.error);
  }
  const context = apiContext({ at, endpoint: read.value.endpoint });
  const projected = projectAll({
    project: ({ raw }) => projectCrowdstrikeVulnerability({ context, raw }),
    resources: read.value.resources,
  });
  const complete = provenCompleteRead({
    kind: "vulnerability",
    observed: projected.entities.length,
    pagesExhausted: read.value.pagesExhausted,
    reportedTotal: read.value.reportedTotal,
  });
  return ok({
    complete: complete.isOk() ? complete.value : null,
    entities: projected.entities,
    problems: [...projected.problems, ...(complete.isErr() ? complete.error : [])],
    reason: `read ${String(projected.entities.length)} open Spotlight finding(s); closed findings are deliberately not read`,
  });
}
