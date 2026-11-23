/**
 * The monitor-configuration verb of the `datadog` noun — `monitor show|update|delete`. Held apart so
 * `./datadog.ts` stays under its file-size ceiling.
 *
 * `update` and `delete` change what pages the organisation, and a delete cannot be undone, so the verb is
 * `effect: "external-write"` + `doorRouted: true`, and every write `requiresApproval`: it is sent only with
 * `--approve` carrying the digest a preview printed of that exact change. `show`, and every invocation
 * without `--approve`, only reads.
 */
import { DATADOG_MONITOR_USAGE } from "../commands/datadog/monitorUsage.js";
import { lazy, type VerbManifestEntry } from "../manifest.js";

/** `datadog monitor`, spread into `datadogManifest`. */
export const datadogMonitorManifest: Readonly<Record<string, VerbManifestEntry>> = {
  monitor: lazy({
    load: () => import("../commands/datadog/monitorRun.js").then((m) => m.datadogMonitorCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      doorRouted: true,
      dryParseSafe: true,
      effect: "external-write",
      example: "slopweaver datadog monitor update 50100 --query '<the new query>'",
      parseRejectIsIoFree: true,
      summary:
        "Show one Datadog monitor, or preview an exact update or delete with an approval digest and apply it " +
        "only with --approve, refusing IaC-managed monitors and any recovery block or renotify interval",
      usage: DATADOG_MONITOR_USAGE,
    },
  }),
};
