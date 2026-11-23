/**
 * The help-truth tables' rows for `datadog`'s investigation verbs — merged by `./allTables.ts` and swept by `../helpTruth.test.ts`,
 * whose header says what each table proves.
 *
 * Every Datadog host in this file reads the synthetic `ap1` site rather than the install's own.
 */

import { CATALOGUE_FLAG_NAMES, parseCatalogueArgs } from "../../../../cli/commands/datadog/catalogueCore.js";
import { DATADOG_ERRORS_FLAG_NAMES, parseDatadogErrorsOptions } from "../../../../cli/commands/datadog/errorsCore.js";
import { DATADOG_HMI_FLAG_NAMES, parseDatadogHmiOptions } from "../../../../cli/commands/datadog/hmiCore.js";
import { INVESTIGATE_FLAG_NAMES, parseInvestigateArgs } from "../../../../cli/commands/datadog/investigateCore.js";
import { DATADOG_SHOT_FLAG_NAMES, parseDatadogShotOptions } from "../../../../cli/commands/datadog/shotCore.js";
import { DATADOG_TRIAGE_FLAG_NAMES, parseDatadogTriageOptions } from "../../../../cli/commands/datadog/triageCore.js";
import { type HelpTruthSlice } from "./mergeSlices.js";

/**
 * `datadog shot`'s probes. Every fragment leads with the SUB-VERB the flag is valid under, because the
 * parser rejects `--id` outside `monitor` and `--url`/`--metric` outside `explorer` — a bare flag would
 * report that rejection instead of the one the probe is testing.
 */
const DATADOG_SHOT_PROBES: Readonly<Record<string, readonly string[]>> = {
  "--agg": ["explorer", "--metric", "copilot.judge.result", "--agg", "sum"],
  "--from": ["explorer", "--metric", "copilot.judge.result", "--from", "7d"],
  "--group": ["explorer", "--metric", "copilot.judge.result", "--group", "instrumentation_scope"],
  "--id": ["monitor", "--id", "600101"],
  "--image": ["file", "--image", "/tmp/shot.png"],
  "--json": ["monitor", "--id", "600101", "--json"],
  "--metric": ["explorer", "--metric", "copilot.judge.result"],
  "--preview-url": ["file", "--image", "/tmp/shot.png", "--preview-url", "https://ap1.datadoghq.com/x"],
  "--out": ["monitor", "--id", "600101", "--out", "/tmp/shot-probe"],
  "--scope": ["explorer", "--metric", "copilot.judge.result", "--scope", "env:staging"],
  "--to": ["explorer", "--metric", "copilot.judge.result", "--to", "now"],
  "--url": ["explorer", "--url", "https://ap1.datadoghq.com/metric/explorer"],
};

const guarded: NonNullable<HelpTruthSlice["guarded"]> = {
  "datadog logs": INVESTIGATE_FLAG_NAMES,
  "datadog apm": INVESTIGATE_FLAG_NAMES,
  "datadog rum": INVESTIGATE_FLAG_NAMES,
  "datadog ci": INVESTIGATE_FLAG_NAMES,
  "datadog tests": INVESTIGATE_FLAG_NAMES,
  "datadog dbm": INVESTIGATE_FLAG_NAMES,
  "datadog profiles": INVESTIGATE_FLAG_NAMES,
  "datadog catalogue": CATALOGUE_FLAG_NAMES,
  "datadog shot": DATADOG_SHOT_FLAG_NAMES,
  "datadog hmi": DATADOG_HMI_FLAG_NAMES,
  "datadog errors": DATADOG_ERRORS_FLAG_NAMES,
  "datadog triage": DATADOG_TRIAGE_FLAG_NAMES,
};

const probes: NonNullable<HelpTruthSlice["probes"]> = {
  "datadog shot": DATADOG_SHOT_PROBES,
  // Every fragment opens with the sub-verb the flag belongs to: `catalogue` dispatches, so a probe with no
  // sub-verb tests the dispatcher rather than the flag.
  "datadog logs": {
    "--by": ["--by", "service"],
    "--from": ["--from", "1h"],
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
    "--not": ["--not", "status:info"],
    "--rows": ["--rows", "5"],
    "--to": ["--to", "now"],
  },
  "datadog apm": {
    "--by": ["--by", "service"],
    "--from": ["--from", "1h"],
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
    "--not": ["--not", "status:info"],
    "--rows": ["--rows", "5"],
    "--to": ["--to", "now"],
  },
  "datadog rum": {
    "--by": ["--by", "service"],
    "--from": ["--from", "1h"],
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
    "--not": ["--not", "status:info"],
    "--rows": ["--rows", "5"],
    "--to": ["--to", "now"],
  },
  "datadog ci": {
    "--by": ["--by", "service"],
    "--from": ["--from", "1h"],
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
    "--not": ["--not", "status:info"],
    "--rows": ["--rows", "5"],
    "--to": ["--to", "now"],
  },
  "datadog tests": {
    "--by": ["--by", "service"],
    "--from": ["--from", "1h"],
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
    "--not": ["--not", "status:info"],
    "--rows": ["--rows", "5"],
    "--to": ["--to", "now"],
  },
  "datadog dbm": {
    "--by": ["--by", "service"],
    "--from": ["--from", "1h"],
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
    "--not": ["--not", "status:info"],
    "--rows": ["--rows", "5"],
    "--to": ["--to", "now"],
  },
  "datadog profiles": {
    "--by": ["--by", "service"],
    "--from": ["--from", "1h"],
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
    "--not": ["--not", "status:info"],
    "--rows": ["--rows", "5"],
    "--to": ["--to", "now"],
  },
  "datadog catalogue": {
    "--from": ["build", "--from", "7d"],
    "--home": ["build", "--home", "/tmp"],
    "--json": ["build", "--json"],
    "--limit": ["show", "--limit", "10"],
    "--product": ["build", "--product", "logs,spans"],
    "--query": ["show", "--query", "session"],
    "--service": ["show", "--service", "core-api"],
    "--to": ["build", "--to", "now"],
  },
  "datadog hmi": {
    "--dry-run": ["--enable", "--dry-run"],
    "--enable": ["--enable"],
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
    "--metric": ["--metric", "trajectory.task.turns"],
  },
  "datadog errors": {
    "--from": ["--from", "7d"],
    "--json": ["--json"],
    "--limit": ["--limit", "20"],
    "--order": ["--order", "newest"],
    "--query": ["--query", "env:production"],
    "--state": ["--state", "for-review,reviewed"],
    "--to": ["--to", "now"],
    "--track": ["--track", "rum"],
  },
  "datadog triage": {
    "--dry-run": ["--dry-run"],
    "--home": ["--home", "/tmp"],
    "--issue": ["--issue", "6d6d6d6d-4444-4444-8444-444444444444"],
    "--json": ["--json"],
    "--state": ["--state", "ignored"],
  },
};

const parsers: NonNullable<HelpTruthSlice["parsers"]> = {
  "datadog logs": ({ fragment }) => parseInvestigateArgs({ rest: fragment }).mapErr((error) => [error.message]),
  "datadog apm": ({ fragment }) => parseInvestigateArgs({ rest: fragment }).mapErr((error) => [error.message]),
  "datadog rum": ({ fragment }) => parseInvestigateArgs({ rest: fragment }).mapErr((error) => [error.message]),
  "datadog ci": ({ fragment }) => parseInvestigateArgs({ rest: fragment }).mapErr((error) => [error.message]),
  "datadog tests": ({ fragment }) => parseInvestigateArgs({ rest: fragment }).mapErr((error) => [error.message]),
  "datadog dbm": ({ fragment }) => parseInvestigateArgs({ rest: fragment }).mapErr((error) => [error.message]),
  "datadog profiles": ({ fragment }) => parseInvestigateArgs({ rest: fragment }).mapErr((error) => [error.message]),
  "datadog catalogue": ({ fragment }) => parseCatalogueArgs({ rest: fragment }).mapErr((error) => [error.message]),
  "datadog shot": ({ fragment }) => parseDatadogShotOptions({ rest: [...fragment] }).mapErr((error) => [error.message]),
  // `--metric` is required, so a fragment probing any OTHER flag carries one — the `submit` adaptation.
  "datadog hmi": ({ fragment }) =>
    parseDatadogHmiOptions({
      rest: fragment.includes("--metric") ? [...fragment] : ["--metric", "trajectory.task.turns", ...fragment],
    }).mapErr((error) => [error.message]),
  "datadog errors": ({ fragment }) =>
    parseDatadogErrorsOptions({ rest: [...fragment] }).mapErr((error) => [error.message]),
  // `--issue` and `--state` are both required, so a fragment probing any other flag carries whichever of the
  // two it does not name.
  "datadog triage": ({ fragment }) => {
    const issue = fragment.includes("--issue") ? [] : ["--issue", "6d6d6d6d-4444-4444-8444-444444444444"];
    const state = fragment.includes("--state") ? [] : ["--state", "ignored"];
    return parseDatadogTriageOptions({ rest: [...issue, ...state, ...fragment] }).mapErr((error) => [error.message]);
  },
};

/** The rows for `datadog`'s investigation verbs. */
export const datadogInvestigateSlice: HelpTruthSlice = { guarded, probes, parsers };
