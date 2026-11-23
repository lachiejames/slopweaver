/**
 * The policy, Zero Trust and detection family reads, projected into storable entities and carrying the proof
 * of whether the read finished.
 *
 * Split from `syncReaders.ts`, which keeps the hosts, host-group and Spotlight reads and the shared reader
 * machinery these import. Everything here is driven through `client.ts`, which takes a CALL ID rather than a
 * path, so no reader can reach an endpoint the closed inventory does not list.
 *
 * ## The Zero Trust assessment read takes a filter the provider REQUIRES
 *
 * Measured: `/zero-trust-assessment/queries/assessments/v1` answers HTTP 400 `missing filter
 * expression` with no filter, and `score:>0` returns every scored agent — the visible hosts plus the
 * hidden ones.
 */
import { isRecord } from "../../lib/parsers.js";
import { err, ok, type Result } from "../../lib/result.js";

import type { CrowdstrikeClientDeps } from "./client.js";
import { requestCrowdstrike } from "./client.js";
import type {
  CrowdstrikeDetection,
  CrowdstrikePolicy,
  CrowdstrikeZeroTrustAssessment,
  CrowdstrikeZeroTrustAudit,
} from "./entities.js";
import type { CrowdstrikeError } from "./errors.js";
import { provenCompleteRead } from "./merge.js";
import { readIdBatches, readOffsetPaged, resourcesOf } from "./paging.js";
import { projectCrowdstrikeDetection } from "./projectDetections.js";
import { projectCrowdstrikePolicy } from "./projectPolicies.js";
import { projectCrowdstrikeZeroTrustAssessment, projectCrowdstrikeZeroTrustAudit } from "./projectZeroTrust.js";
import { apiContext, idsOf, type KindRead, PAGE_SIZE, projectAll, readQueryThenEntities } from "./syncReaders.js";

/**
 * Read every prevention or sensor-update policy.
 *
 * @param kind which policy kind to read
 * @param deps the client dependencies
 * @param at this run's ISO timestamp
 * @returns the policies and the proof the read finished, or the typed failure that stopped it
 */
export async function readCrowdstrikePolicies({
  kind,
  deps,
  at,
}: {
  kind: "prevention-policy" | "sensor-update-policy";
  deps: CrowdstrikeClientDeps;
  at: string;
}): Promise<Result<KindRead<CrowdstrikePolicy>, CrowdstrikeError>> {
  const prevention = kind === "prevention-policy";
  return readQueryThenEntities({
    at,
    batchLimit: 100,
    deps,
    entityCallId: prevention ? "prevention-policy-entities" : "sensor-update-policy-entities",
    kind,
    label: prevention ? "prevention policy" : "sensor update policy",
    project: ({ raw, context }) => projectCrowdstrikePolicy({ context, kind, raw }),
    queryCallId: prevention ? "prevention-policy-ids" : "sensor-update-policy-ids",
  });
}

/**
 * Read every Zero Trust Assessment.
 *
 * The query endpoint returns `{ aid, score }` objects rather than bare ids, and the entity endpoint takes
 * the agent ids out of them — measured, because passing the query's own resources through unchanged
 * returns an empty result with no error, which is the quietest possible way to publish an empty kind.
 *
 * @param deps the client dependencies
 * @param at this run's ISO timestamp
 * @returns the assessments and the proof the read finished, or the typed failure that stopped it
 */
export async function readCrowdstrikeZeroTrustAssessments({
  deps,
  at,
}: {
  deps: CrowdstrikeClientDeps;
  at: string;
}): Promise<Result<KindRead<CrowdstrikeZeroTrustAssessment>, CrowdstrikeError>> {
  const query = await readOffsetPaged({
    callId: "zta-assessment-ids",
    deps,
    pageSize: PAGE_SIZE,
    query: { filter: "score:>0" },
  });
  if (query.isErr()) {
    return err(query.error);
  }
  const aids = query.value.resources.flatMap((raw): readonly string[] => {
    if (!isRecord(raw)) {
      return [];
    }
    const aid = raw["aid"];
    return typeof aid === "string" && aid.length > 0 ? [aid] : [];
  });
  const detail = await readIdBatches({
    batchLimit: 1000,
    byBody: false,
    callId: "zta-assessment-entities",
    deps,
    idParam: "ids",
    ids: aids,
  });
  if (detail.isErr()) {
    return err(detail.error);
  }
  const context = apiContext({ at, endpoint: detail.value.endpoint });
  const projected = projectAll({
    project: ({ raw }) => projectCrowdstrikeZeroTrustAssessment({ context, raw }),
    resources: detail.value.resources,
  });
  const complete = provenCompleteRead({
    kind: "zero-trust-assessment",
    observed: projected.entities.length,
    pagesExhausted: query.value.pagesExhausted,
    reportedTotal: query.value.reportedTotal,
  });
  return ok({
    complete: complete.isOk() ? complete.value : null,
    entities: projected.entities,
    problems: [...projected.problems, ...(complete.isErr() ? complete.error : [])],
    reason: `read ${String(projected.entities.length)} Zero Trust assessment(s)`,
  });
}

/**
 * Read the tenant-wide Zero Trust summary.
 *
 * @param deps the client dependencies
 * @param at this run's ISO timestamp
 * @returns the one-row audit and the proof the read finished, or the typed failure that stopped it
 */
export async function readCrowdstrikeZeroTrustAudit({
  deps,
  at,
}: {
  deps: CrowdstrikeClientDeps;
  at: string;
}): Promise<Result<KindRead<CrowdstrikeZeroTrustAudit>, CrowdstrikeError>> {
  const response = await requestCrowdstrike({ callId: "zta-audit", deps, input: {} });
  if (response.isErr()) {
    return err(response.error);
  }
  const resources = resourcesOf({ body: response.value.body });
  const context = apiContext({ at, endpoint: response.value.endpoint });
  const projected = projectAll({
    project: ({ raw }) => projectCrowdstrikeZeroTrustAudit({ context, raw }),
    resources,
  });
  const complete = provenCompleteRead({
    kind: "zero-trust-audit",
    observed: projected.entities.length,
    pagesExhausted: true,
    reportedTotal: null,
  });
  return ok({
    complete: complete.isOk() ? complete.value : null,
    entities: projected.entities,
    problems: [...projected.problems, ...(complete.isErr() ? complete.error : [])],
    reason: `read the tenant-wide Zero Trust summary (${String(projected.entities.length)} document)`,
  });
}

/**
 * Read every detection.
 *
 * The alert entity call is a POST carrying `composite_ids` in its body — a read, because the alert UPDATE
 * path is a different endpoint taking an action list and is absent from the inventory entirely.
 *
 * @param deps the client dependencies
 * @param at this run's ISO timestamp
 * @returns the detections and the proof the read finished, or the typed failure that stopped it
 */
export async function readCrowdstrikeDetections({
  deps,
  at,
}: {
  deps: CrowdstrikeClientDeps;
  at: string;
}): Promise<Result<KindRead<CrowdstrikeDetection>, CrowdstrikeError>> {
  const query = await readOffsetPaged({ callId: "alert-ids", deps, pageSize: PAGE_SIZE, query: {} });
  if (query.isErr()) {
    return err(query.error);
  }
  const ids = idsOf({ resources: query.value.resources });
  const detail = await readIdBatches({
    batchLimit: 100,
    byBody: true,
    callId: "alert-entities",
    deps,
    idParam: "composite_ids",
    ids,
  });
  if (detail.isErr()) {
    return err(detail.error);
  }
  const context = apiContext({ at, endpoint: detail.value.endpoint });
  const projected = projectAll({
    project: ({ raw }) => projectCrowdstrikeDetection({ context, raw }),
    resources: detail.value.resources,
  });
  const complete = provenCompleteRead({
    kind: "detection",
    observed: projected.entities.length,
    pagesExhausted: query.value.pagesExhausted,
    reportedTotal: query.value.reportedTotal,
  });
  return ok({
    complete: complete.isOk() ? complete.value : null,
    entities: projected.entities,
    problems: [...projected.problems, ...(complete.isErr() ? complete.error : [])],
    reason: `read ${String(projected.entities.length)} detection(s)`,
  });
}
