/**
 * The help-truth tables' rows for `linear`'s read verbs — merged by `./allTables.ts` and swept by `../helpTruth.test.ts`,
 * whose header says what each table proves.
 */

import { LINEAR_BRIEFING_FLAG_NAMES, parseLinearBriefingArgs } from "../../../../cli/commands/linear/briefingCore.js";
import { linearVerbErrorLines } from "../../../../cli/commands/linear/errors.js";
import { LINEAR_ISSUES_FLAG_NAMES, parseLinearIssuesArgs } from "../../../../cli/commands/linear/issuesCore.js";
import { LINEAR_LABELS_FLAG_NAMES, parseLinearLabelsArgs } from "../../../../cli/commands/linear/labelsCore.js";
import { LINEAR_QUERY_FLAG_NAMES, parseLinearQueryArgs } from "../../../../cli/commands/linear/queryCore.js";
import { LINEAR_SEARCH_FLAG_NAMES, parseLinearSearchArgs } from "../../../../cli/commands/linear/searchCore.js";
import { LINEAR_STATES_FLAG_NAMES, parseLinearStatesArgs } from "../../../../cli/commands/linear/statesCore.js";
import { PROVIDER_READ_FLAG_NAMES, parseProviderReadArgs } from "../../../../cli/commands/providerRead/core.js";
import { type HelpTruthSlice } from "./mergeSlices.js";

const guarded: NonNullable<HelpTruthSlice["guarded"]> = {
  "linear briefing": LINEAR_BRIEFING_FLAG_NAMES,
  "linear labels": LINEAR_LABELS_FLAG_NAMES,
  "linear issues": LINEAR_ISSUES_FLAG_NAMES,
  "linear read": PROVIDER_READ_FLAG_NAMES["linear"],
  "linear query": LINEAR_QUERY_FLAG_NAMES,
  "linear search": LINEAR_SEARCH_FLAG_NAMES,
  "linear states": LINEAR_STATES_FLAG_NAMES,
};

const probes: NonNullable<HelpTruthSlice["probes"]> = {
  "linear briefing": {
    "--form": [],
    "--json": ["--json"],
    "--out": [],
  },
  "linear read": {
    "--home": ["--home", "/tmp"],
    "--include": ["--include", "comments"],
    "--json": ["--json"],
    "--limit": ["--limit", "10"],
    "--pdf": ["--pdf"],
  },
  "linear labels": {
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
    "--team": ["--team", "ENG"],
  },
  "linear issues": {
    "--created-since": ["--created-since", "14d"],
    "--creator": ["--creator", "me"],
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
    "--project": ["--project", "0f1e2d3c-4b5a-4697-8a1b-2c3d4e5f6a7b"],
    "--team": ["--team", "ENG"],
  },
  "linear query": {
    "--assignee": ["--assignee", "kim.lee"],
    "--corpus": ["--corpus", "/tmp"],
    "--cycle": ["--cycle", "134"],
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
    "--kind": ["--kind", "issue"],
    "--label": ["--label", "/ship"],
    "--limit": ["--limit", "10"],
    "--no-verify": ["--no-verify"],
    "--priority": ["--priority", "2"],
    "--project": ["--project", "Pool rewrite"],
    "--state": ["--state", "In Review"],
    "--state-type": ["--state-type", "started"],
    "--team": ["--team", "ENG"],
    "--text": ["--text", "pool"],
    "--updated-since": ["--updated-since", "14d"],
  },
  "linear search": {
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
    "--limit": ["--limit", "10"],
  },
  "linear states": {
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
    "--limit": ["--limit", "10"],
    "--no-record": ["--no-record"],
    "--team": ["--team", "ENG"],
  },
};

const parsers: NonNullable<HelpTruthSlice["parsers"]> = {
  "linear briefing": ({ fragment }) =>
    parseLinearBriefingArgs({ argv: ["build", "--form", "-", "--out", "/tmp/b", ...fragment], cwd: "/" }).mapErr(
      (error) => linearVerbErrorLines({ error }),
    ),
  "linear read": ({ fragment }) =>
    parseProviderReadArgs({ provider: "linear", rest: ["AIL-1", ...fragment] }).mapErr((error) => [error.message]),
  "linear labels": ({ fragment }) =>
    parseLinearLabelsArgs({ rest: ["ENG", ...fragment] }).mapErr((error) => linearVerbErrorLines({ error })),
  // A scope is required, and the parser refuses a repeated flag, so the base names the one the fragment does not.
  "linear issues": ({ fragment }) =>
    parseLinearIssuesArgs({
      nowMs: Date.parse("2026-10-24T00:00:00.000Z"),
      rest: [...(fragment.includes("--team") ? ["--project", "p-1"] : ["--team", "ENG"]), ...fragment],
    }).mapErr((error) => linearVerbErrorLines({ error })),
  // The typed `LinearQueryError` is mapped to the string list every other probe reports, so one harness
  // reads every verb's refusal the same way.
  "linear query": ({ fragment }) =>
    parseLinearQueryArgs({ nowMs: Date.parse("2026-09-06T12:00:00.000Z"), rest: [...fragment] }).mapErr((error) => [
      error.message,
    ]),
  "linear search": ({ fragment }) =>
    parseLinearSearchArgs({ rest: ["a-term", ...fragment] }).mapErr((error) => linearVerbErrorLines({ error })),
  "linear states": ({ fragment }) =>
    parseLinearStatesArgs({ rest: ["ENG", ...fragment] }).mapErr((error) => linearVerbErrorLines({ error })),
};

/** The rows for `linear`'s read verbs. */
export const linearReadsSlice: HelpTruthSlice = { guarded, probes, parsers };
