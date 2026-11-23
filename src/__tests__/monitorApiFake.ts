/**
 * An in-memory Datadog monitor store behind the `MonitorApi` seam — plain functions over a `Map`, not a mock.
 * `writes` records every update and delete it was handed, so "Datadog was not reached" is asserted through a
 * value that MOVES when it is.
 */
import { client } from "@datadog/datadog-api-client";

import type { MonitorApi } from "../datadog/monitorApi.js";
import type { MonitorSnapshot, MonitorUpdateBody } from "../datadog/monitorWrite.js";

/**
 * The host CPU monitor the owner's ruling edits, as Datadog's wire JSON would carry it.
 *
 * @returns the monitor, with any field the caller names replaced
 */
export function cpuMonitor(overrides: Partial<MonitorSnapshot> = {}): MonitorSnapshot {
  return {
    creator: { email: "someone@example.com", handle: "someone@example.com", name: "Someone" },
    id: 50100,
    message: "CPU is high on {{host.name}} @slack-alerts",
    modified: "2026-09-01T00:00:00.000000+00:00",
    name: "Host CPU high",
    options: { notify_no_data: false, renotify_interval: 0, thresholds: { critical: 90 } },
    overall_state: "Alert",
    query: "avg(last_5m):avg:system.cpu.user{*} by {host} > 90",
    tags: ["team:platform"],
    type: "metric alert",
    ...overrides,
  };
}

/** One write the fake was handed. */
export type RecordedMonitorWrite =
  | { readonly kind: "update"; readonly id: number; readonly body: MonitorUpdateBody }
  | { readonly kind: "delete"; readonly id: number };

/** How the fake departs from a Datadog that accepts everything. */
export interface MonitorFakeBehaviour {
  /** Ids `can_delete` refuses, each with Datadog's reason. */
  readonly referenced?: Readonly<Record<string, readonly string[]>>;
  /** When set, the validator throws this status. */
  readonly validateStatus?: number;
  /** When true, an update is accepted and changes nothing — the monitor answered is the one stored. */
  readonly sticky?: boolean;
  /** Ids whose delete throws a 400. */
  readonly refuseRemove?: readonly number[];
}

/**
 * Build the fake over a set of monitors.
 *
 * @param monitors the monitors Datadog holds
 * @param behaviour how it departs from accepting everything
 * @returns the seam, the live store and the record of writes
 */
export function fakeMonitorApi({
  monitors,
  behaviour = {},
}: {
  monitors: readonly MonitorSnapshot[];
  behaviour?: MonitorFakeBehaviour;
}): { api: MonitorApi; store: Map<number, MonitorSnapshot>; writes: RecordedMonitorWrite[] } {
  const store = new Map(monitors.map((monitor) => [monitor.id, monitor]));
  const writes: RecordedMonitorWrite[] = [];
  const notFound = (): Promise<never> =>
    Promise.reject(new client.ApiException(404, { errors: ["Monitor not found"] }));
  const api: MonitorApi = {
    canDelete: ({ ids }) =>
      Promise.resolve({
        errors: behaviour.referenced,
        ok: ids.filter((id) => behaviour.referenced?.[String(id)] === undefined),
      }),
    get: ({ id }) => {
      const monitor = store.get(id);
      return monitor === undefined ? notFound() : Promise.resolve(monitor);
    },
    remove: ({ id }) => {
      writes.push({ id, kind: "delete" });
      if (behaviour.refuseRemove?.includes(id) === true) {
        return Promise.reject(new client.ApiException(400, { errors: ["monitor is referenced"] }));
      }
      store.delete(id);
      return Promise.resolve();
    },
    update: ({ id, body }) => {
      writes.push({ body, id, kind: "update" });
      const monitor = store.get(id);
      if (monitor === undefined) {
        return notFound();
      }
      const next =
        behaviour.sticky === true ? monitor : { ...monitor, ...body, modified: "2026-10-01T00:00:00.000000+00:00" };
      store.set(id, next);
      return Promise.resolve(next);
    },
    validate: () =>
      behaviour.validateStatus === undefined
        ? Promise.resolve()
        : Promise.reject(new client.ApiException(behaviour.validateStatus, { errors: ["The query is invalid"] })),
  };
  return { api, store, writes };
}
