/**
 * The investigate verbs of the `datadog` noun — one per event product, every one a read that counts first and
 * prints rows only on `--rows` (`commands/datadog/investigateRun.ts`). Held apart so `./datadog.ts` stays
 * under its file-size ceiling; they share a runner and a usage builder, so they are one family here too.
 */
import { investigateUsage } from "../commands/datadog/usage.js";
import { lazy, type VerbManifestEntry } from "../manifest.js";

/** `datadog logs|apm|rum|ci|tests|dbm|profiles`, spread into `datadogManifest`. */
export const datadogInvestigateManifest: Readonly<Record<string, VerbManifestEntry>> = {
  logs: lazy({
    load: () => import("../commands/datadog/investigateRun.js").then((m) => m.datadogLogsCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      // Reads only: an aggregate and a read-only event-track search, classified exactly as `probe` is.
      doorRouted: false,
      dryParseSafe: true,
      effect: "external-read",
      example: "slopweaver datadog logs 'service:core-api status:error' --from 1h",
      parseRejectIsIoFree: true,
      summary:
        "Investigate log events counted by service and status before any line is printed — counts first, --not to cut the noise, --rows to read events, " +
        "each group labelled by what the local census says it is",
      usage: investigateUsage({ product: "logs" }),
    },
  }),
  apm: lazy({
    load: () => import("../commands/datadog/investigateRun.js").then((m) => m.datadogApmCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      // Reads only: an aggregate and a read-only event-track search, classified exactly as `probe` is.
      doorRouted: false,
      dryParseSafe: true,
      effect: "external-read",
      example: "slopweaver datadog apm 'service:jobs-api' --by operation_name --rows 5",
      parseRejectIsIoFree: true,
      summary:
        "Investigate APM spans counted by service, operation and resource — counts first, --not to cut the noise, --rows to read events, " +
        "each group labelled by what the local census says it is",
      usage: investigateUsage({ product: "apm" }),
    },
  }),
  rum: lazy({
    load: () => import("../commands/datadog/investigateRun.js").then((m) => m.datadogRumCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      // Reads only: an aggregate and a read-only event-track search, classified exactly as `probe` is.
      doorRouted: false,
      dryParseSafe: true,
      effect: "external-read",
      example: "slopweaver datadog rum '@type:error' --from 1d",
      parseRejectIsIoFree: true,
      summary:
        "Investigate browser events counted by application and event type — counts first, --not to cut the noise, --rows to read events, " +
        "each group labelled by what the local census says it is",
      usage: investigateUsage({ product: "rum" }),
    },
  }),
  ci: lazy({
    load: () => import("../commands/datadog/investigateRun.js").then((m) => m.datadogCiCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      // Reads only: an aggregate and a read-only event-track search, classified exactly as `probe` is.
      doorRouted: false,
      dryParseSafe: true,
      effect: "external-read",
      example: "slopweaver datadog ci '@ci.status:error' --from 7d",
      parseRejectIsIoFree: true,
      summary:
        "Investigate CI pipeline events counted by pipeline and status — counts first, --not to cut the noise, --rows to read events, " +
        "each group labelled by what the local census says it is",
      usage: investigateUsage({ product: "ci" }),
    },
  }),
  tests: lazy({
    load: () => import("../commands/datadog/investigateRun.js").then((m) => m.datadogTestsCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      // Reads only: an aggregate and a read-only event-track search, classified exactly as `probe` is.
      doorRouted: false,
      dryParseSafe: true,
      effect: "external-read",
      example: "slopweaver datadog tests '@test.status:fail' --from 7d",
      parseRejectIsIoFree: true,
      summary:
        "Investigate test events counted by service, suite and status — counts first, --not to cut the noise, --rows to read events, " +
        "each group labelled by what the local census says it is",
      usage: investigateUsage({ product: "tests" }),
    },
  }),
  dbm: lazy({
    load: () => import("../commands/datadog/investigateRun.js").then((m) => m.datadogDbmCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      // Reads only: an aggregate and a read-only event-track search, classified exactly as `probe` is.
      doorRouted: false,
      dryParseSafe: true,
      effect: "external-read",
      example: "slopweaver datadog dbm --from 1h --rows 5",
      parseRejectIsIoFree: true,
      summary:
        "Investigate database query samples grouped by query signature — counts first, --not to cut the noise, --rows to read events, " +
        "each group labelled by what the local census says it is",
      usage: investigateUsage({ product: "dbm" }),
    },
  }),
  profiles: lazy({
    load: () => import("../commands/datadog/investigateRun.js").then((m) => m.datadogProfilesCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      // Reads only: an aggregate and a read-only event-track search, classified exactly as `probe` is.
      doorRouted: false,
      dryParseSafe: true,
      effect: "external-read",
      example: "slopweaver datadog profiles --from 1d",
      parseRejectIsIoFree: true,
      summary:
        "Investigate profiles grouped by service and profiler family — counts first, --not to cut the noise, --rows to read events, " +
        "each group labelled by what the local census says it is",
      usage: investigateUsage({ product: "profiles" }),
    },
  }),
};
