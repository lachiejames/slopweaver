/**
 * One audit-log pull: discover every container under the organisation, record the retention and routing that
 * bound what Cloud Logging still holds, then page every matching audit entry to disk and publish the manifest.
 *
 * Effectful only through {@link GcpAuditPullDeps}: the sender, the store and the clock are injected, so the
 * whole orchestration is driven by plain fakes in a unit test. A refusal Google returns for ONE container is
 * recorded and the pull carries on — a gap the manifest names is honest, a pull that dies on the first private
 * project reports nothing at all. Each phase lives in its own module: `discover.ts`, `inventory.ts`,
 * `entries.ts`; this file orders them and writes the manifest.
 */
import { err, ok, type Result } from "#lib/result.js";

import { unreadSinks } from "./coverage.js";
import { discoverContainers, type GcpDiscovery } from "./discover.js";
import { type GcpEntriesRead, readEntryBatches } from "./entries.js";
import type { GcpAuditError } from "./errors.js";
import { buildAuditFilter } from "./filter.js";
import {
  cacheRoles,
  type GcpAuditConfigRead,
  type GcpInventory,
  type GcpRoleRead,
  readAuditConfigs,
  readInventory,
} from "./inventory.js";
import type { GcpAuditManifest, GcpCachedRole, GcpEntriesWriter } from "./store.js";
import type { GcpAuditSend } from "./transport.js";

/** What one pull is asked to read. */
export interface GcpAuditPullInput {
  readonly org: string;
  readonly quotaProject: string;
  readonly since: string;
  readonly principals: readonly string[] | "all";
  readonly roles: readonly string[];
}

/** The pull's effects. */
export interface GcpAuditPullDeps {
  readonly send: GcpAuditSend;
  readonly open: (args: { generation: string }) => Result<GcpEntriesWriter, GcpAuditError>;
  readonly publish: (args: {
    manifest: GcpAuditManifest;
    roles: readonly GcpCachedRole[];
  }) => Result<string, GcpAuditError>;
  readonly nowIso: () => string;
  readonly generation: string;
  /** A progress line; never carries a caller IP or a resource name. */
  readonly progress: (line: string) => void;
}

/** Everything a pull read, phase by phase, before it is written down as a manifest. */
interface PullReadings {
  readonly discovery: GcpDiscovery;
  readonly inventory: GcpInventory;
  readonly policy: GcpAuditConfigRead;
  readonly roles: GcpRoleRead;
  readonly entries: GcpEntriesRead;
}

/**
 * Open the generation's entries file, read every batch into it, and close it whatever happened.
 *
 * @param filter the audit filter
 * @param discovery the containers to read
 * @param inventory the buckets that set each container's view cost
 * @returns every batch's outcome, or the failure that stopped the pull before it could publish
 */
async function readEntriesToStore({
  deps,
  filter,
  discovery,
  inventory,
}: {
  deps: GcpAuditPullDeps;
  filter: string;
  discovery: GcpDiscovery;
  inventory: GcpInventory;
}): Promise<Result<GcpEntriesRead, GcpAuditError>> {
  const writer = deps.open({ generation: deps.generation });
  if (writer.isErr()) {
    return err(writer.error);
  }
  try {
    return await readEntryBatches({
      buckets: inventory.buckets,
      containers: discovery.containers,
      filter,
      progress: deps.progress,
      send: deps.send,
      writer: writer.value,
    });
  } finally {
    writer.value.close();
  }
}

/**
 * Every reason the generation does not cover everything it set out to read, in the manifest's fixed order.
 *
 * @param readings what each phase read and was refused
 * @returns one sentence per gap; empty when coverage is complete
 */
function gapsOf({ readings }: { readings: PullReadings }): string[] {
  const { discovery, entries, inventory, policy, roles } = readings;
  const elsewhere = unreadSinks({ searched: discovery.containers, sinks: inventory.sinks });
  const destinations = [...new Set(elsewhere.map((sink) => sink.destination))].join(", ");
  return [
    ...(discovery.foldersRefused
      ? ["folder discovery was refused, so folder-level logs and every project under a folder are unread"]
      : []),
    ...(discovery.projectsRefused ? ["project discovery was refused, so project-level logs are unread"] : []),
    ...(entries.entryRefusals.length > 0
      ? [`${String(entries.entryRefusals.length)} container(s) refused their logs`]
      : []),
    ...(inventory.bucketRefusals.length > 0
      ? [`${String(inventory.bucketRefusals.length)} container(s) refused their bucket list`]
      : []),
    ...(inventory.sinkRefusals.length > 0
      ? [`${String(inventory.sinkRefusals.length)} container(s) refused their sink list`]
      : []),
    ...(policy.policyRefusals.length > 0 ? ["the organisation's audit-log configuration was refused"] : []),
    ...(roles.roleRefusals.length > 0 ? [`${String(roles.roleRefusals.length)} role(s) could not be read`] : []),
    ...(elsewhere.length > 0
      ? [`${String(elsewhere.length)} enabled sink(s) route copies outside Logging, unread here: ${destinations}`]
      : []),
  ];
}

/**
 * The manifest a pull publishes.
 *
 * @param input what the pull was asked to read
 * @param generation the generation id
 * @param pulledAtIso when the pull started
 * @param readings what each phase read and was refused
 * @returns the manifest, coverage `partial` whenever any gap was named
 */
function manifestOf({
  input,
  generation,
  pulledAtIso,
  readings,
}: {
  input: GcpAuditPullInput;
  generation: string;
  pulledAtIso: string;
  readings: PullReadings;
}): GcpAuditManifest {
  const { discovery, entries, inventory, policy, roles } = readings;
  const gaps = gapsOf({ readings });
  return {
    auditConfigs: policy.auditConfigs,
    batches: entries.batches,
    buckets: inventory.buckets.toSorted((a, b) => a.name.localeCompare(b.name)),
    containers: discovery.counts,
    coverage: gaps.length === 0 ? "complete" : "partial",
    entriesWritten: entries.entriesWritten,
    gaps,
    generation,
    org: input.org,
    principals: input.principals === "all" ? "all" : [...input.principals],
    pulledAtIso,
    quotaProject: input.quotaProject,
    refusals: {
      buckets: [...inventory.bucketRefusals],
      discovery: [...discovery.refusals],
      entries: [...entries.entryRefusals],
      policies: [...policy.policyRefusals],
      roles: [...roles.roleRefusals],
      sinks: [...inventory.sinkRefusals],
    },
    roles: roles.roleFacts,
    schemaVersion: 1,
    since: input.since,
    sinks: inventory.sinks.toSorted((a, b) => a.name.localeCompare(b.name)),
  };
}

/**
 * Run one pull end to end and publish its generation.
 *
 * @param input what to read
 * @param deps the effects
 * @returns the published manifest, or the failure that stopped the pull before it could publish
 */
export async function runGcpAuditPull({
  input,
  deps,
}: {
  input: GcpAuditPullInput;
  deps: GcpAuditPullDeps;
}): Promise<Result<GcpAuditManifest, GcpAuditError>> {
  const filter = buildAuditFilter({ principals: input.principals, since: input.since });
  if (filter.isErr()) {
    return err(filter.error);
  }
  const pulledAtIso = deps.nowIso();
  const discovery = await discoverContainers({ org: input.org, send: deps.send });
  deps.progress(
    `discovered ${String(discovery.counts.folders)} folder(s) and ${String(discovery.counts.projects)} project(s) under organizations/${input.org}`,
  );
  const inventory = await readInventory({ containers: discovery.containers, send: deps.send });
  deps.progress(`read ${String(inventory.buckets.length)} bucket(s) and ${String(inventory.sinks.length)} sink(s)`);
  const policy = await readAuditConfigs({ org: input.org, send: deps.send });
  const roles = await cacheRoles({ roles: input.roles, send: deps.send });
  const entries = await readEntriesToStore({ deps, discovery, filter: filter.value, inventory });
  if (entries.isErr()) {
    return err(entries.error);
  }
  const readings: PullReadings = { discovery, entries: entries.value, inventory, policy, roles };
  const manifest = manifestOf({ generation: deps.generation, input, pulledAtIso, readings });
  const published = deps.publish({ manifest, roles: roles.cached });
  if (published.isErr()) {
    return err(published.error);
  }
  return ok(manifest);
}
