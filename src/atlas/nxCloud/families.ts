/**
 * The voluminous families: how each is measured, and what "enumerated and declared" means as code.
 *
 * `docs/atlas-intent/06-holdings.md` rules that a highly voluminous surface is enumerated and declared rather than
 * stored whole, and that this is a DISPOSITION rather than an exclusion — the family is still reached, over
 * a bounded window, and simply never publishes a row per record. This file is that sentence made
 * executable: each family names the call that reaches it, where its records sit in the payload, and where
 * the platform's own total sits when it reports one.
 *
 * ## Three families, and two of them come out of ONE bounded call
 *
 * MEASURED against a live workspace. `runs.data` returns a DEFERRED page of runs, each carrying
 * its own tasks inline, so one call measures both the run family and the task family — the run count is the
 * page length and the task count is the sum across it. `analytics/insights.data?dayCount=7` reports the
 * platform's own pipeline-execution count over a seven-day window (the `family` entity's `reportedTotal`
 * holds the live figure), which is what turns "there are pipeline executions" into a number a later run can contradict.
 *
 * ## The field names are the point
 *
 * A `family` entity's value to a reader is its `responseFields`: `runs[].status`, `runs[].tasks[].status`,
 * `runs[].command`. That is what tells a session which fields a live query can ask for — which is the whole
 * job of an atlas that says what exists and answers nothing itself.
 */
import { isRecord } from "../../lib/parsers.js";

/**
 * Where one family's records and totals live in one call's payload.
 *
 * @internal
 */
export interface NxCloudFamilySpec {
  /** The family's own name, and its `providerId`. */
  readonly name: string;
  /** Which inventory call reaches it. */
  readonly callId: string;
  /** The client route id whose loader block carries it. */
  readonly routeId: string;
  /** The dotted path, inside that block's `data`, to the array of records. Empty when it reports no rows. */
  readonly recordsPath: string;
  /** The dotted path to the array of records NESTED in each record, for a family measured through another. */
  readonly nestedRecordsPath: string;
  /** The dotted path to the platform's own total, when it reports one. Empty when it does not. */
  readonly totalPath: string;
  /** What the bounded call asked for, in English. */
  readonly windowDescription: string;
  /** Why this family is not stored whole, in this atlas's own words. */
  readonly voluminousBecause: string;
}

/** Every voluminous family this atlas declares, and how each is measured. */
export const NX_CLOUD_FAMILY_SPECS: readonly NxCloudFamilySpec[] = [
  {
    callId: "workspace-insights",
    name: "ci-pipeline-execution",
    nestedRecordsPath: "",
    recordsPath: "",
    routeId: "routes/_resource.orgs.$orgId.workspaces.$workspaceId.analytics.insights",
    totalPath: "cipe.count",
    voluminousBecause:
      "one record per CI pipeline execution, emitted by the platform on every push and identified by its" +
      " own instant rather than by a name anybody chose",
    windowDescription: "the platform's own count over a seven-day insights window",
  },
  {
    callId: "workspace-runs",
    name: "run",
    nestedRecordsPath: "",
    recordsPath: "deferredRunListPage.runs",
    routeId: "routes/_auth.orgs.$orgId.workspaces.$workspaceId.runs",
    totalPath: "",
    voluminousBecause:
      "one record per `nx` invocation inside a pipeline execution — tens per execution, emitted rather than" +
      " authored, and unbounded in the same way",
    windowDescription: "one page of the workspace run list, as the runs page itself asks for it",
  },
  {
    callId: "workspace-runs",
    name: "task",
    nestedRecordsPath: "tasks",
    recordsPath: "deferredRunListPage.runs",
    routeId: "routes/_auth.orgs.$orgId.workspaces.$workspaceId.runs",
    totalPath: "",
    voluminousBecause:
      "one record per target executed inside a run, which is where a cache hit or miss lives. The most" +
      " voluminous family here by an order of magnitude, and the reason the atlas records the SHAPE that" +
      " tells a session which fields a live query can ask for",
    windowDescription: "every task carried inline by one page of the workspace run list",
  },
] as const;

/**
 * Follow a dotted path into a payload.
 *
 * @param source the node to start from
 * @param path the dotted path; an empty path returns the node itself
 * @returns whatever is there, or `undefined`
 */
export function atPath({ source, path }: { source: unknown; path: string }): unknown {
  if (path === "") {
    return source;
  }
  let cursor: unknown = source;
  for (const segment of path.split(".")) {
    cursor = isRecord(cursor) ? cursor[segment] : undefined;
  }
  return cursor;
}

/**
 * What one family's bounded call actually measured.
 *
 * @internal
 */
export interface NxCloudFamilyMeasurement {
  /** How many records the bounded call returned, or `null` when nothing countable came back. */
  readonly recordsInWindow: number | null;
  /** The platform's own total, when the payload reports one. */
  readonly reportedTotal: number | null;
}

/**
 * Measure one family against one call's decoded loader data.
 *
 * A family measured THROUGH another — tasks, which arrive inline on each run — sums its nested arrays
 * rather than counting the outer one, so the number means what its name says.
 *
 * @param spec the family being measured
 * @param data the loader block's `data`, deferred values already resolved
 * @returns what was measured; both numbers are `null` when the payload carried neither
 */
export function measureNxCloudFamily({
  spec,
  data,
}: {
  spec: NxCloudFamilySpec;
  data: unknown;
}): NxCloudFamilyMeasurement {
  const total = atPath({ path: spec.totalPath, source: data });
  const reportedTotal =
    spec.totalPath !== "" && typeof total === "number" && Number.isFinite(total) ? Math.trunc(total) : null;
  const records = atPath({ path: spec.recordsPath, source: data });
  if (spec.recordsPath === "" || !Array.isArray(records)) {
    return { recordsInWindow: null, reportedTotal };
  }
  if (spec.nestedRecordsPath === "") {
    return { recordsInWindow: records.length, reportedTotal };
  }
  const nested = records.reduce((sum: number, record: unknown): number => {
    const inner = atPath({ path: spec.nestedRecordsPath, source: record });
    return sum + (Array.isArray(inner) ? inner.length : 0);
  }, 0);
  return { recordsInWindow: nested, reportedTotal };
}
