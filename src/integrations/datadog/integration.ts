/** The Datadog integration's manifest — strings, its atlas row and `import()` thunks only. */
import { DATADOG_ATLAS_REGISTRATION } from "../../atlas/datadog/registration.js";
import type { IntegrationManifest } from "../manifest.js";

/** The datadog row of the integration registry. */
export const DATADOG_INTEGRATION = {
  browserWrite: {
    ordinal: 5,
    row: {
      door: null,
      hosts: ["datadoghq.com", "datadoghq.eu", "ddog-gov.com"],
      policy: "read-before-write",
      provider: "Datadog",
    },
  },
  connection: {
    connectWith: "slopweaver secrets set datadog-api-key and datadog-app-key",
    credentialSets: [["datadog-api-key", "datadog-app-key"]],
    ordinal: 8,
  },
  features: {
    atlas: DATADOG_ATLAS_REGISTRATION,
    connect: async () => (await import("../../connect/datadog.js")).classifyDatadog,
    read: async () => (await import("../../datadog/client.js")).createDatadogClient,
    write: async () => (await import("../../datadog/monitorWrite.js")).MonitorSnapshotSchema,
  },
  id: "datadog",
  name: "Datadog",
  noun: { kind: "source-reading" },
  routing: [
    {
      capability: {
        availability: { kind: "available" },
        // This row used to read "Slopweaver has no telemetry connector", which was true when it was written and
        // is a lie on this build: `src/cli/commands/datadog/` ships fifteen `external-read` verbs. The command
        // is `verify` rather than a query for the reason the `drive` row gives — CREDENTIALS are what decide
        // whether this leg can answer, nothing in `src/route/` grades a Datadog key, and `verify` is the one
        // command that settles it without spending a query against the rate-limit budget. The id stays
        // `telemetry` because it is the join key a private overlay replaces a generic row by
        // (`mergedCapabilities`); renaming it would silently un-join every installation that had tuned it.
        command: ["slopweaver", "datadog", "verify"],
        coverage: {
          detail:
            "whether this install's DD_API_KEY and DD_APP_KEY both work. The READING is the separate act: " +
            "`slopweaver datadog logs '<query>' --from <window>` counts events by service and status before " +
            "printing a line, `datadog metrics --query <q>` runs one grouped scalar sum, and `datadog probe` " +
            "runs a real count over a window and prints a validated console link. Datadog's retention is " +
            "FIFTEEN DAYS on this tenant — a question reaching further back is `slopweaver hex`, not this leg",
          kind: "bounded",
        },
        effect: "read",
        freshness: { detail: "read directly from Datadog when the planned command runs", kind: "live" },
        id: "telemetry",
        owner: "slopweaver",
        sourceClass: "provider",
        terms: [
          "log",
          "logs",
          "logging",
          "retention",
          "telemetry",
          "observability",
          "metric",
          "metrics",
          "trace",
          "traces",
          "span",
          "spans",
          "dashboard",
          "dashboards",
          "alert",
          "alerts",
        ],
        truthMode: "current",
        what: "the telemetry estate — what the services are logging and emitting right now, counted by service and status before any line is read",
      },
      ordinal: 0,
    },
  ],
} as const satisfies IntegrationManifest;
