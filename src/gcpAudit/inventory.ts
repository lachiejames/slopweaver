/**
 * The facts that bound what a pull's entries can show: each container's logging buckets (their retention) and
 * sinks (copies routed where this reader does not look), the organisation's audit-log configuration, and the
 * permissions of every role a later `--plan` names. Each read that Google refuses is recorded and the pull
 * carries on, so a refusal surfaces as a named gap rather than as an empty answer.
 */
import pLimit from "p-limit";

import { unsetFieldAsNull } from "#lib/absent.js";
import type { Result } from "#lib/result.js";

import { call, pageToEnd, pageTokenField, refusal } from "./call.js";
import type { GcpAuditError } from "./errors.js";
import type { GcpAuditManifest, GcpBucketFact, GcpCachedRole, GcpRefusalFact, GcpSinkFact } from "./store.js";
import type { GcpAuditSend, GcpContainer } from "./transport.js";
import { GET_IAM_POLICY, GET_ROLE, LIST_BUCKETS, LIST_SINKS } from "./wire.js";

/** Container-scoped calls in flight at once; entries are read one batch at a time to stay under 60/min. */
const CONTAINER_CONCURRENCY = 4;

/** Every container's buckets and sinks, and the containers that refused either list. */
export interface GcpInventory {
  readonly buckets: readonly GcpBucketFact[];
  readonly sinks: readonly GcpSinkFact[];
  readonly bucketRefusals: readonly GcpRefusalFact[];
  readonly sinkRefusals: readonly GcpRefusalFact[];
}

/** The organisation's audit-log configuration, or the refusal that hid it. */
export interface GcpAuditConfigRead {
  readonly auditConfigs: GcpAuditManifest["auditConfigs"];
  readonly policyRefusals: readonly GcpRefusalFact[];
}

/** Every requested role's permissions and facts, and the roles that could not be read. */
export interface GcpRoleRead {
  readonly cached: readonly GcpCachedRole[];
  readonly roleFacts: GcpAuditManifest["roles"];
  readonly roleRefusals: readonly GcpRefusalFact[];
}

/**
 * Every logging bucket in one container, paged to the end.
 *
 * @param container the organisation, folder or project to list
 * @returns each bucket's retention fact, or the failure that stopped paging
 */
async function listBuckets({
  send,
  container,
}: {
  send: GcpAuditSend;
  container: GcpContainer;
}): Promise<Result<readonly GcpBucketFact[], GcpAuditError>> {
  const listed = await pageToEnd({
    fetchPage: async ({ pageToken }) =>
      (
        await call({
          boundary: LIST_BUCKETS,
          request: { kind: "list-buckets", parent: container, ...pageTokenField({ pageToken }) },
          send,
        })
      ).map((value) => {
        // A container holding no bucket omits `buckets`: none, not an unknown.
        if (value.buckets === undefined) {
          return { items: [], next: value.nextPageToken };
        }
        return { items: value.buckets, next: value.nextPageToken };
      }),
  });
  return listed.map((buckets) =>
    buckets.map((bucket): GcpBucketFact => ({
      analyticsEnabled: unsetFieldAsNull({ key: "analyticsEnabled", record: bucket }),
      container,
      lifecycleState: unsetFieldAsNull({ key: "lifecycleState", record: bucket }),
      locked: unsetFieldAsNull({ key: "locked", record: bucket }),
      name: bucket.name,
      retentionDays: unsetFieldAsNull({ key: "retentionDays", record: bucket }),
    })),
  );
}

/**
 * Every log sink in one container, paged to the end.
 *
 * @param container the organisation, folder or project to list
 * @returns each sink's routing fact, or the failure that stopped paging
 */
async function listSinks({
  send,
  container,
}: {
  send: GcpAuditSend;
  container: GcpContainer;
}): Promise<Result<readonly GcpSinkFact[], GcpAuditError>> {
  const listed = await pageToEnd({
    fetchPage: async ({ pageToken }) =>
      (
        await call({
          boundary: LIST_SINKS,
          request: { kind: "list-sinks", parent: container, ...pageTokenField({ pageToken }) },
          send,
        })
      ).map((value) => {
        // A container routing no log omits `sinks`: none, not an unknown.
        if (value.sinks === undefined) {
          return { items: [], next: value.nextPageToken };
        }
        return { items: value.sinks, next: value.nextPageToken };
      }),
  });
  return listed.map((sinks) =>
    sinks.map((sink): GcpSinkFact => ({
      container,
      destination: sink.destination,
      disabled: unsetFieldAsNull({ key: "disabled", record: sink }),
      filter: unsetFieldAsNull({ key: "filter", record: sink }),
      includeChildren: unsetFieldAsNull({ key: "includeChildren", record: sink }),
      interceptChildren: unsetFieldAsNull({ key: "interceptChildren", record: sink }),
      name: sink.name,
    })),
  );
}

/**
 * List every container's buckets and then its sinks, a few containers at a time.
 *
 * @param send the sender
 * @param containers every container discovery kept
 * @returns the facts in completion order, and each container that refused a list
 */
export async function readInventory({
  send,
  containers,
}: {
  send: GcpAuditSend;
  containers: readonly GcpContainer[];
}): Promise<GcpInventory> {
  const limit = pLimit(CONTAINER_CONCURRENCY);
  const buckets: GcpBucketFact[] = [];
  const sinks: GcpSinkFact[] = [];
  const bucketRefusals: GcpRefusalFact[] = [];
  const sinkRefusals: GcpRefusalFact[] = [];
  await Promise.all(
    containers.map((container) =>
      limit(async () => {
        const listedBuckets = await listBuckets({ container, send });
        if (listedBuckets.isErr()) {
          bucketRefusals.push(refusal({ error: listedBuckets.error, what: container }));
        } else {
          buckets.push(...listedBuckets.value);
        }
        const listedSinks = await listSinks({ container, send });
        if (listedSinks.isErr()) {
          sinkRefusals.push(refusal({ error: listedSinks.error, what: container }));
        } else {
          sinks.push(...listedSinks.value);
        }
      }),
    ),
  );
  return { bucketRefusals, buckets, sinkRefusals, sinks };
}

/** The log types one audit config records; a config naming none omits `auditLogConfigs`, so it records none. */
function loggedTypes({
  config,
}: {
  config: { auditLogConfigs?: readonly { logType: string }[] | undefined };
}): string[] {
  if (config.auditLogConfigs === undefined) {
    return [];
  }
  return config.auditLogConfigs.map((row) => row.logType);
}

/** A role's permissions, sorted; a role granting none omits `includedPermissions`, so it grants none. */
function sortedPermissions({ role }: { role: { includedPermissions?: readonly string[] | undefined } }): string[] {
  if (role.includedPermissions === undefined) {
    return [];
  }
  return [...role.includedPermissions].toSorted();
}

/**
 * Read which services the organisation's allow policy records audit logs for.
 *
 * @param send the sender
 * @param org the organisation number
 * @returns each service's configured log types, or the refusal that hid them
 */
export async function readAuditConfigs({
  send,
  org,
}: {
  send: GcpAuditSend;
  org: string;
}): Promise<GcpAuditConfigRead> {
  const resource: `organizations/${string}` = `organizations/${org}`;
  const policy = await call({ boundary: GET_IAM_POLICY, request: { kind: "get-iam-policy", resource }, send });
  if (policy.isErr()) {
    return { auditConfigs: [], policyRefusals: [refusal({ error: policy.error, what: resource })] };
  }
  // A policy recording no audit config omits `auditConfigs`: Admin Activity only, which is the default.
  if (policy.value.auditConfigs === undefined) {
    return { auditConfigs: [], policyRefusals: [] };
  }
  return {
    auditConfigs: policy.value.auditConfigs.map((config) => ({
      logTypes: loggedTypes({ config }),
      resource,
      service: config.service,
    })),
    policyRefusals: [],
  };
}

/**
 * Read each named role, one at a time, caching its permissions for a later `--plan`.
 *
 * @param send the sender
 * @param roles the role names `--role` named
 * @returns the cache, each role's facts, and each role that could not be read
 */
export async function cacheRoles({
  send,
  roles,
}: {
  send: GcpAuditSend;
  roles: readonly string[];
}): Promise<GcpRoleRead> {
  const roleRefusals: GcpRefusalFact[] = [];
  const cached: GcpCachedRole[] = [];
  const roleFacts: GcpAuditManifest["roles"][number][] = [];
  for (const name of roles) {
    const role = await call({ boundary: GET_ROLE, request: { kind: "get-role", role: name }, send });
    if (role.isErr()) {
      roleRefusals.push(refusal({ error: role.error, what: name }));
      continue;
    }
    const permissions = sortedPermissions({ role: role.value });
    cached.push({ name, permissions });
    roleFacts.push({
      deleted: unsetFieldAsNull({ key: "deleted", record: role.value }),
      etag: unsetFieldAsNull({ key: "etag", record: role.value }),
      name,
      permissionCount: permissions.length,
      stage: unsetFieldAsNull({ key: "stage", record: role.value }),
      title: unsetFieldAsNull({ key: "title", record: role.value }),
    });
  }
  return { cached, roleFacts, roleRefusals };
}
