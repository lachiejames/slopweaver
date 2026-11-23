/**
 * The monitor calls `slopweaver datadog monitor` makes, as a seam over the SDK's `v1.MonitorsApi`, and the
 * sequencing over it: read, validate, update, the `can_delete` check and delete.
 *
 * ## Why the SDK and never `rawTransport.ts`
 *
 * `rawTransport.ts` is read-only by its TYPE — `PUT` and `DELETE` are not expressible there, which is the one
 * property an auditor can read off a single file. A monitor write is therefore issued through the official
 * SDK on the shared client (its retry loop, its pinned site), named as a write, exactly as
 * `historicalIngestion.ts` issues the HMI create. The SDK's models are converted to and from Datadog's wire
 * JSON by the SDK's own `ObjectSerializer` at this edge, so the core never sees a camelCase field.
 *
 * ## The seam
 *
 * {@link MonitorApi} is plain functions: the real one wraps the SDK, a test passes an in-memory monitor set.
 * A call that fails THROWS, and the functions below turn that into a typed error naming the monitor.
 */
import { v1 } from "@datadog/datadog-api-client";

import { err, ok, type Result } from "../lib/result.js";
import type { DatadogClient } from "./client.js";
import {
  type MonitorSnapshot,
  MonitorSnapshotSchema,
  type MonitorUpdateBody,
  type MonitorUpdatePlan,
} from "./monitorWrite.js";
import { type DatadogMonitorWriteError, DatadogMonitorWriteErrors } from "./monitorWriteErrors.js";

/**
 * What Datadog's `can_delete` check answered: the ids it clears, and why each other one is refused. Datadog
 * OMITS either field when it has nothing to put in it, so each is absent by design rather than emptied here.
 */
export interface MonitorDeletability {
  readonly ok: readonly number[] | undefined;
  readonly errors: Readonly<Record<string, readonly string[]>> | undefined;
}

/** The five calls this verb makes, in Datadog's wire JSON. */
export interface MonitorApi {
  readonly get: (request: { id: number }) => Promise<unknown>;
  readonly validate: (request: { id: number; monitor: Readonly<Record<string, unknown>> }) => Promise<void>;
  readonly update: (request: { id: number; body: MonitorUpdateBody }) => Promise<unknown>;
  readonly canDelete: (request: { ids: readonly number[] }) => Promise<MonitorDeletability>;
  readonly remove: (request: { id: number }) => Promise<void>;
}

/** Parse a monitor body, naming it unreadable rather than guessing at a partial one. */
function snapshotOf({ id, body }: { id: number; body: unknown }): Result<MonitorSnapshot, DatadogMonitorWriteError> {
  const parsed = MonitorSnapshotSchema.safeParse(body);
  if (!parsed.success) {
    const detail = parsed.error.issues.map((issue) => `${issue.path.map(String).join(".")}: ${issue.message}`);
    return err(
      DatadogMonitorWriteErrors.readFailed({ cause: `the response is not a monitor (${detail.join("; ")})`, id }),
    );
  }
  return ok(parsed.data);
}

/**
 * Read one monitor as Datadog holds it now.
 *
 * @param api the seam
 * @param id the monitor id
 * @returns the monitor, or why it could not be read
 */
export async function readMonitor({
  api,
  id,
}: {
  api: MonitorApi;
  id: number;
}): Promise<Result<MonitorSnapshot, DatadogMonitorWriteError>> {
  let body: unknown;
  try {
    body = await api.get({ id });
  } catch (cause: unknown) {
    return err(DatadogMonitorWriteErrors.readFailed({ cause, id }));
  }
  return snapshotOf({ body, id });
}

/**
 * Read every monitor, in the order given, stopping at the first that cannot be read.
 *
 * @param api the seam
 * @param ids the monitor ids
 * @returns every monitor as Datadog holds it now
 */
export async function readMonitors({
  api,
  ids,
}: {
  api: MonitorApi;
  ids: readonly number[];
}): Promise<Result<readonly MonitorSnapshot[], DatadogMonitorWriteError>> {
  const monitors: MonitorSnapshot[] = [];
  for (const id of ids) {
    const monitor = await readMonitor({ api, id });
    if (monitor.isErr()) {
      return err(monitor.error);
    }
    monitors.push(monitor.value);
  }
  return ok(monitors);
}

/**
 * Ask Datadog's own validator whether the monitor the plan leaves behind is one it would accept. Read-only:
 * the validate route changes nothing.
 *
 * @param api the seam
 * @param plan the planned update
 * @returns nothing when it validates, or Datadog's refusal
 */
export async function validateUpdate({
  api,
  plan,
}: {
  api: MonitorApi;
  plan: MonitorUpdatePlan;
}): Promise<Result<null, DatadogMonitorWriteError>> {
  const { id, type, query } = plan.before;
  try {
    await api.validate({ id, monitor: { query, type, ...plan.body } });
  } catch (cause: unknown) {
    return err(DatadogMonitorWriteErrors.validateRejected({ cause, id }));
  }
  return ok(null);
}

/**
 * Send the planned update and read the monitor Datadog answers with.
 *
 * @param api the seam
 * @param plan the planned update
 * @returns the monitor as it now stands, or Datadog's refusal
 */
export async function applyUpdate({
  api,
  plan,
}: {
  api: MonitorApi;
  plan: MonitorUpdatePlan;
}): Promise<Result<MonitorSnapshot, DatadogMonitorWriteError>> {
  const { id } = plan.before;
  let body: unknown;
  try {
    body = await api.update({ body: plan.body, id });
  } catch (cause: unknown) {
    return err(DatadogMonitorWriteErrors.writeRejected({ cause, doneBefore: [], id }));
  }
  return snapshotOf({ body, id });
}

/**
 * The ids Datadog's `can_delete` check does not clear, each with its reasons.
 *
 * @param deletability what the check answered
 * @param ids the ids asked about
 * @returns the refused ids keyed by id, empty when every one is cleared
 */
export function blockedDeletes({
  deletability,
  ids,
}: {
  deletability: MonitorDeletability;
  ids: readonly number[];
}): Readonly<Record<string, readonly string[]>> {
  const blocked: Record<string, readonly string[]> = {};
  for (const id of ids.filter((candidate) => deletability.ok?.includes(candidate) !== true)) {
    blocked[String(id)] = refusalReasons({ errors: deletability.errors, id });
  }
  return blocked;
}

/** Why `can_delete` did not clear one id: Datadog's own reasons, or that it cleared the id without giving any. */
function refusalReasons({ errors, id }: { errors: MonitorDeletability["errors"]; id: number }): readonly string[] {
  const reasons = errors?.[String(id)];
  if (reasons === undefined) {
    return ["not cleared by can_delete, with no reason given"];
  }
  return reasons;
}

/**
 * Run the `can_delete` check over every id at once, refusing the whole list if any one is not cleared.
 *
 * @param api the seam
 * @param ids the ids to delete
 * @returns nothing when every id is cleared, or each refused id with its reasons
 */
export async function checkDeletable({
  api,
  ids,
}: {
  api: MonitorApi;
  ids: readonly number[];
}): Promise<Result<null, DatadogMonitorWriteError>> {
  let deletability: MonitorDeletability;
  try {
    deletability = await api.canDelete({ ids });
  } catch (cause: unknown) {
    return err(DatadogMonitorWriteErrors.deleteCheckFailed({ cause, ids }));
  }
  const blocked = blockedDeletes({ deletability, ids });
  return Object.keys(blocked).length === 0 ? ok(null) : err(DatadogMonitorWriteErrors.cannotDelete({ blocked }));
}

/**
 * Delete each monitor in order, stopping at the first refusal and naming what had already gone.
 *
 * @param api the seam
 * @param ids the ids, already previewed and approved
 * @returns the ids deleted, or the refusal
 */
export async function deleteMonitors({
  api,
  ids,
}: {
  api: MonitorApi;
  ids: readonly number[];
}): Promise<Result<readonly number[], DatadogMonitorWriteError>> {
  const deleted: number[] = [];
  for (const id of ids) {
    try {
      await api.remove({ id });
    } catch (cause: unknown) {
      return err(DatadogMonitorWriteErrors.writeRejected({ cause, doneBefore: [...deleted], id }));
    }
    deleted.push(id);
  }
  return ok(deleted);
}

/**
 * The real seam over the shared client's `v1.MonitorsApi`.
 *
 * @param datadog the shared client
 * @returns the seam
 */
export function sdkMonitorApi({ datadog }: { datadog: DatadogClient }): MonitorApi {
  const toWire = ({ monitor }: { monitor: v1.Monitor }): unknown =>
    v1.ObjectSerializer.serialize(monitor, "Monitor", "");
  return {
    canDelete: async ({ ids }) => {
      const response = await datadog.monitors.checkCanDeleteMonitor({ monitorIds: [...ids] });
      return { errors: response.errors, ok: response.data.ok };
    },
    get: async ({ id }) => toWire({ monitor: await datadog.monitors.getMonitor({ monitorId: id }) }),
    remove: async ({ id }) => {
      await datadog.monitors.deleteMonitor({ monitorId: id });
    },
    update: async ({ id, body }) => {
      const request: v1.MonitorUpdateRequest = v1.ObjectSerializer.deserialize(body, "MonitorUpdateRequest", "");
      return toWire({ monitor: await datadog.monitors.updateMonitor({ body: request, monitorId: id }) });
    },
    validate: async ({ id, monitor }) => {
      const body: v1.Monitor = v1.ObjectSerializer.deserialize(monitor, "Monitor", "");
      await datadog.monitors.validateExistingMonitor({ body, monitorId: id });
    },
  };
}
