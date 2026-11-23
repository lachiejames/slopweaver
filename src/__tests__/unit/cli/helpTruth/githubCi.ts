/**
 * The help-truth tables' rows for `github`'s CI verbs — merged by `./allTables.ts` and swept by `../helpTruth.test.ts`,
 * whose header says what each table proves.
 */

import {
  GITHUB_BOTTLENECK_FLAG_NAMES,
  parseGithubBottleneckArgs,
} from "../../../../cli/commands/github/bottleneckCore.js";
import { GITHUB_CHECKS_FLAG_NAMES, parseGithubChecksArgs } from "../../../../cli/commands/github/checksCore.js";
import { GITHUB_CI_RUNS_FLAG_NAMES, parseGithubCiRunsArgs } from "../../../../cli/commands/github/ciRunsCore.js";
import { GITHUB_CI_TIMING_FLAG_NAMES, parseGithubCiTimingArgs } from "../../../../cli/commands/github/ciTimingCore.js";
import {
  GITHUB_REQUIRED_CONTEXTS_FLAG_NAMES,
  parseGithubRequiredContextsArgs,
} from "../../../../cli/commands/github/requiredContextsCore.js";
import { GITHUB_RERUN_FLAG_NAMES, parseGithubRerunArgs } from "../../../../cli/commands/github/rerunCore.js";
import { GITHUB_RUN_LOG_FLAG_NAMES, parseGithubRunLogArgs } from "../../../../cli/commands/github/runLogCore.js";
import { GITHUB_WATCHERS_FLAG_NAMES, parseGithubWatchersArgs } from "../../../../cli/commands/github/watchersCore.js";
import { type HelpTruthSlice } from "./mergeSlices.js";

const guarded: NonNullable<HelpTruthSlice["guarded"]> = {
  "github checks": GITHUB_CHECKS_FLAG_NAMES,
  "github ci-runs": GITHUB_CI_RUNS_FLAG_NAMES,
  "github ci-timing": GITHUB_CI_TIMING_FLAG_NAMES,
  "github run-log": GITHUB_RUN_LOG_FLAG_NAMES,
  "github bottleneck": GITHUB_BOTTLENECK_FLAG_NAMES,
  "github watchers": GITHUB_WATCHERS_FLAG_NAMES,
  "github rerun": GITHUB_RERUN_FLAG_NAMES,
  "github required-contexts": GITHUB_REQUIRED_CONTEXTS_FLAG_NAMES,
};

const probes: NonNullable<HelpTruthSlice["probes"]> = {
  "github bottleneck": {
    "--author": ["--author", "someone"],
    "--exclude-drafts": ["--exclude-drafts"],
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
    "--limit": ["--limit", "10"],
    "--repo": ["--repo", "owner/name"],
    "--slack-live": ["--slack-live"],
  },
  "github watchers": {
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
    "--repo": ["--repo", "owner/name"],
  },
  "github checks": {
    "--home": ["--number", "1", "--home", "/tmp"],
    "--json": ["--number", "1", "--json"],
    "--limit": ["--number", "1", "--limit", "10"],
    "--number": ["--number", "1"],
    "--repo": ["--number", "1", "--repo", "owner/name"],
    "--since": ["--number", "1", "--until", "any", "--since", "2026-09-03T00:00:00Z"],
    "--timeout-seconds": ["--number", "1", "--timeout-seconds", "60"],
    "--until": ["--number", "1", "--until", "merge"],
    "--wait": ["--number", "1", "--wait"],
    "--log": ["--number", "1", "--log"],
    "--lines": ["--number", "1", "--log", "--lines", "12"],
  },
  // The run id is a POSITIONAL, so every probe carries one: a fragment holding only a flag names no run.
  "github run-log": {
    "--home": ["42", "--home", "/tmp"],
    "--job": ["42", "--job", "lint"],
    "--json": ["42", "--json"],
    "--lines": ["42", "--lines", "12"],
    "--repo": ["42", "--repo", "owner/name"],
  },
  // `--run-id` is the one REQUIRED flag (the verb refuses rather than guessing which run you meant), so every
  // probe here carries it and then adds the flag it is testing.
  "github ci-timing": {
    "--home": ["--run-id", "1", "--home", "/tmp"],
    "--repo": ["--run-id", "1", "--repo", "owner/name"],
    "--run-id": ["--run-id", "1"],
  },
  // Every flag is optional here: the verb's whole default invocation is the owner's own question, the last
  // twenty `push` runs of `main`, so each probe carries only the flag it is testing.
  "github ci-runs": {
    "--branch": ["--branch", "any"],
    "--event": ["--event", "pull_request"],
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
    "--repo": ["--repo", "owner/name"],
    "--runs": ["--runs", "5"],
    "--steps": ["--steps"],
    "--workflow": ["--workflow", "ci.yml"],
  },
  "github rerun": {
    "--dry-run": ["--repo", "owner/name", "--run-id", "1", "--dry-run"],
    "--home": ["--repo", "owner/name", "--run-id", "1", "--home", "/tmp"],
    "--json": ["--repo", "owner/name", "--run-id", "1", "--json"],
    "--number": ["--repo", "owner/name", "--number", "1"],
    "--repo": ["--repo", "owner/name", "--run-id", "1"],
    "--run-id": ["--repo", "owner/name", "--run-id", "1"],
  },
  "github required-contexts": {
    "--branch": ["--repo", "owner/name", "--branch", "main"],
    "--drop": ["--repo", "owner/name", "--drop", "a"],
    "--dry-run": ["--repo", "owner/name", "--require", "a", "--dry-run"],
    "--entries": ["--repo", "owner/name", "--entries", "5"],
    "--exact": ["--repo", "owner/name", "--require", "a", "--exact"],
    "--home": ["--repo", "owner/name", "--home", "/tmp"],
    "--json": ["--repo", "owner/name", "--json"],
    "--repo": ["--repo", "owner/name"],
    "--require": ["--repo", "owner/name", "--require", "a"],
  },
};

const parsers: NonNullable<HelpTruthSlice["parsers"]> = {
  "github checks": ({ fragment }) => parseGithubChecksArgs({ rest: [...fragment] }),
  // The verb reports a TYPED usage union rather than authored strings, so the probe reads each issue's own
  // `message` — the same field the shell prints — instead of re-wording one here.
  "github ci-runs": ({ fragment }) =>
    parseGithubCiRunsArgs({ rest: [...fragment] }).mapErr((issues) => issues.map((issue) => issue.message)),
  "github ci-timing": ({ fragment }) =>
    parseGithubCiTimingArgs({ rest: [...fragment] }).mapErr((issues) => issues.map((issue) => issue.message)),
  // The same typed-union shape as `ci-runs`, read the same way. A fragment already naming a run id passes
  // through unchanged; anything else gets one, since the generic unknown-flag strictness probe carries no
  // positional of its own and this verb's run id is positional.
  "github run-log": ({ fragment }) => {
    const named = /^\d+$/u.test(String(fragment[0]));
    const rest = named ? [...fragment] : ["42", ...fragment];
    return parseGithubRunLogArgs({ rest }).mapErr((issues) => issues.map((issue) => issue.message));
  },
  "github bottleneck": ({ fragment }) => parseGithubBottleneckArgs({ rest: [...fragment] }),
  "github watchers": ({ fragment }) => parseGithubWatchersArgs({ rest: [...fragment] }),
  "github rerun": ({ fragment }) => parseGithubRerunArgs({ rest: [...fragment] }),
  "github required-contexts": ({ fragment }) => parseGithubRequiredContextsArgs({ rest: [...fragment] }),
};

/** The rows for `github`'s CI verbs. */
export const githubCiSlice: HelpTruthSlice = { guarded, probes, parsers };
