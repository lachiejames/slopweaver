/**
 * The help-truth tables' rows for `datadog`'s alerting and SDLC verbs — merged by `./allTables.ts` and swept by `../helpTruth.test.ts`,
 * whose header says what each table proves.
 */

import {
  DATADOG_ALERT_DIGEST_FLAG_NAMES,
  parseDatadogAlertDigestArgs,
} from "../../../../cli/commands/datadog/alertDigestCore.js";
import {
  DATADOG_COMPARE_ENVS_FLAG_NAMES,
  parseDatadogCompareEnvsOptions,
} from "../../../../cli/commands/datadog/compareEnvsCore.js";
import { DATADOG_SUBMIT_FLAG_NAMES, parseDatadogSubmitOptions } from "../../../../cli/commands/datadog/core.js";
import { datadogArgsErrorLines } from "../../../../cli/commands/datadog/errors.js";
import {
  DATADOG_MONITOR_FLAG_NAMES,
  parseDatadogMonitorOptions,
} from "../../../../cli/commands/datadog/monitorCore.js";
import {
  DATADOG_PRODUCE_FLAG_NAMES,
  parseDatadogProduceOptions,
} from "../../../../cli/commands/datadog/produceCore.js";
import { type HelpTruthSlice } from "./mergeSlices.js";
import { dedupeFlags } from "./sharedProbes.js";

const guarded: NonNullable<HelpTruthSlice["guarded"]> = {
  "datadog compare-envs": DATADOG_COMPARE_ENVS_FLAG_NAMES,
  "datadog produce": DATADOG_PRODUCE_FLAG_NAMES,
  "datadog submit": DATADOG_SUBMIT_FLAG_NAMES,
  "datadog monitor": DATADOG_MONITOR_FLAG_NAMES,
  "datadog alert-digest": DATADOG_ALERT_DIGEST_FLAG_NAMES,
};

const probes: NonNullable<HelpTruthSlice["probes"]> = {
  "datadog alert-digest": {
    "--form": ["--form"],
    "--json": ["--json"],
    "--intro": ["--intro", '["this is a trial."]'],
    "--label": [],
    "--lead": ["--lead", "Upstream is drowning the rest."],
    "--probes": [],
    "--recommendations": ["--recommendations", '{"recommendations":[]}'],
    "--window": ["--window", "24h"],
  },
  "datadog compare-envs": {
    "--after": ["--after", "proof-after"],
    "--before": ["--before", "proof-before"],
    "--by": ["--by", "resource_name"],
    "--from": ["--from", "2h"],
    "--json": ["--json"],
    "--limit": ["--limit", "10"],
    "--query": ["--query", "p90:trace.http.server.request{*} by {resource_name}"],
    "--to": ["--to", "now"],
  },
  "datadog produce": {
    "--day": ["--day", "2026-09-16"],
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
    "--out": ["--out", "/tmp/series.json"],
    "--producer": ["--producer", "daily-delivery"],
  },
  "datadog submit": {
    "--allow-late": ["--allow-late"],
    "--dry-run": ["--dry-run"],
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
    "--series": ["--series", "/tmp/series.json"],
  },
  "datadog monitor": {
    "--approve": ["delete", "50100", "--approve", "0123456789abcdef"],
    "--home": ["delete", "50100", "--home", "/tmp"],
    "--iac-override": ["delete", "50100", "--iac-override", "the stack no longer declares it"],
    "--json": ["show", "50100", "--json"],
    "--message": ["update", "50100", "--message", "the new message"],
    "--name": ["update", "50100", "--name", "the new name"],
    "--patch": ["update", "50100", "--patch", "/tmp/patch.json"],
    "--query": ["update", "50100", "--query", "avg(last_5m):avg:system.load.1{*} > 4"],
    "--tags": ["update", "50100", "--tags", "team:platform,service:agent"],
  },
};

const parsers: NonNullable<HelpTruthSlice["parsers"]> = {
  // `--query`, `--before` and `--after` are all required, so a fragment probing any OTHER flag has to
  // carry them or every probe reports the same missing-flag error instead of the one it was testing.
  "datadog compare-envs": ({ fragment }) =>
    parseDatadogCompareEnvsOptions({
      rest: [
        ...(fragment.includes("--query") ? [] : ["--query", "p90:trace.http.server.request{*} by {resource_name}"]),
        ...(fragment.includes("--before") ? [] : ["--before", "proof-before"]),
        ...(fragment.includes("--after") ? [] : ["--after", "proof-after"]),
        ...fragment,
      ],
    }).mapErr((error) => [error.message]),
  // `--producer`, `--day` and `--out` are required, so a fragment probing any other flag carries them; today is
  // pinned past the fixture's day so the probe never depends on the wall clock.
  "datadog produce": ({ fragment }) =>
    parseDatadogProduceOptions({
      rest: dedupeFlags({
        base: ["--producer", "daily-delivery", "--day", "2026-09-16", "--out", "/tmp/series.json"],
        fragment,
      }),
      todayUtc: "2026-09-17",
    }).mapErr((error) => datadogArgsErrorLines({ error })),
  // `--series` is required, so a fragment probing any OTHER flag has to carry it or every probe reports
  // the same missing-flag error instead of the one it was testing.
  "datadog submit": ({ fragment }) =>
    parseDatadogSubmitOptions({
      rest: fragment.includes("--series") ? [...fragment] : ["--series", "/tmp/series.json", ...fragment],
    }).mapErr((error) => [error.message]),
  "datadog monitor": ({ fragment }) =>
    parseDatadogMonitorOptions({ rest: [...fragment] }).mapErr((error) => [error.message]),
  "datadog alert-digest": ({ fragment }) =>
    parseDatadogAlertDigestArgs({ rest: ["--probes", "-", "--label", "Knock", ...fragment] }).mapErr((error) =>
      datadogArgsErrorLines({ error }),
    ),
};

/** The rows for `datadog`'s alerting and SDLC verbs. */
export const datadogOperationsSlice: HelpTruthSlice = { guarded, probes, parsers };
