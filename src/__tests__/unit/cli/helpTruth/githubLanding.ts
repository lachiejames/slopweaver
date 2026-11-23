/**
 * The help-truth tables' rows for `github`'s landing verbs — merged by `./allTables.ts` and swept by `../helpTruth.test.ts`,
 * whose header says what each table proves.
 */

import {
  GITHUB_BUMP_DRIVE_FLAG_NAMES,
  parseGithubBumpDriveArgs,
} from "../../../../cli/commands/github/bumpDriveCore.js";
import { GITHUB_CYCLE_FLAG_NAMES, parseGithubCycleArgs } from "../../../../cli/commands/github/cycleCore.js";
import { GITHUB_ENQUEUE_FLAG_NAMES, parseGithubEnqueueArgs } from "../../../../cli/commands/github/enqueueArgs.js";
import { githubVerbErrorLines } from "../../../../cli/commands/github/errors.js";
import {
  GITHUB_HOLD_FLAG_NAMES,
  GITHUB_RELEASE_FLAG_NAMES,
  parseGithubHoldArgs,
  parseGithubReleaseArgs,
} from "../../../../cli/commands/github/holdCore.js";
import { GITHUB_LANDING_FLAG_NAMES, parseGithubLandingArgs } from "../../../../cli/commands/github/landingCore.js";
import { GITHUB_MERGE_FLAG_NAMES, parseGithubMergeArgs } from "../../../../cli/commands/github/mergeArgs.js";
import {
  GITHUB_PRESS_RESEAL_FLAG_NAMES,
  parseGithubPressResealArgs,
} from "../../../../cli/commands/github/pressResealArgs.js";
import { GITHUB_TURN_PATH_FLAG_NAMES, parseGithubTurnPathArgs } from "../../../../cli/commands/github/turnPathCore.js";
import { type HelpTruthSlice } from "./mergeSlices.js";
import { dedupeFlags } from "./sharedProbes.js";

/**
 * A valid `github hold` PLACEMENT, so each placement flag's probe only needs to add itself.
 *
 * `--status` is deliberately not in it: the verb refuses `--status` alongside a placement flag, so a probe
 * of `--status` has to stand on its own — see the entry in {@link PARSERS}.
 */
const GITHUB_HOLD_BASE_PROBE: readonly string[] = ["--pr", "32", "--repo", "owner/name", "--why", "rebase hell"];

/** A valid `github enqueue` invocation: both flags are required, so every probe has to carry them. */
const GITHUB_ENQUEUE_BASE_PROBE: readonly string[] = ["--pr", "32", "--repo", "owner/name"];

/** A valid `github release` invocation: both flags are required, so every probe has to carry them. */
const GITHUB_RELEASE_BASE_PROBE: readonly string[] = ["--pr", "32", "--repo", "owner/name"];

/** A valid `github press-reseal` preview: `--repo` is required, so every probe has to carry it. */
const GITHUB_PRESS_RESEAL_BASE_PROBE: readonly string[] = ["--repo", "owner/name"];

/** A valid `github press-reseal` apply: the apply-only flags are refused on a preview, so they travel together. */
const GITHUB_PRESS_RESEAL_APPLY_PROBE: readonly string[] = [
  ...GITHUB_PRESS_RESEAL_BASE_PROBE,
  "--apply",
  "--source-sha256",
  "a".repeat(64),
  "--reason",
  "carried home",
];

/** A valid `github merge` invocation, so each flag's own probe only needs to add itself to it. */
const GITHUB_MERGE_BASE_PROBE: readonly string[] = [
  "--repo",
  "owner/name",
  "--base",
  "main",
  "--head",
  "a-branch",
  "--description",
  "-",
];

const guarded: NonNullable<HelpTruthSlice["guarded"]> = {
  "github turn-path": GITHUB_TURN_PATH_FLAG_NAMES,
  "github bump-drive": GITHUB_BUMP_DRIVE_FLAG_NAMES,
  "github landing": GITHUB_LANDING_FLAG_NAMES,
  "github hold": GITHUB_HOLD_FLAG_NAMES,
  "github enqueue": GITHUB_ENQUEUE_FLAG_NAMES,
  "github merge": GITHUB_MERGE_FLAG_NAMES,
  "github release": GITHUB_RELEASE_FLAG_NAMES,
  "github press-reseal": GITHUB_PRESS_RESEAL_FLAG_NAMES,
  "github cycle": GITHUB_CYCLE_FLAG_NAMES,
};

const probes: NonNullable<HelpTruthSlice["probes"]> = {
  "github hold": {
    "--home": ["--status", "--home", "/tmp"],
    "--json": ["--status", "--json"],
    "--pr": [...GITHUB_HOLD_BASE_PROBE],
    "--repo": [...GITHUB_HOLD_BASE_PROBE],
    "--history": ["--history"],
    "--limit": ["--history", "--limit", "5"],
    "--stale-minutes": [...GITHUB_HOLD_BASE_PROBE, "--stale-minutes", "90"],
    "--status": ["--status"],
    "--why": [...GITHUB_HOLD_BASE_PROBE],
  },
  "github enqueue": {
    // --acknowledge-all is refused without --reason, so the two are each other's only valid company.
    "--acknowledge": [...GITHUB_ENQUEUE_BASE_PROBE, "--acknowledge", "ci-not-green,not-mergeable"],
    "--acknowledge-all": [...GITHUB_ENQUEUE_BASE_PROBE, "--acknowledge-all", "--reason", "sole codeowner"],
    "--dequeue": [...GITHUB_ENQUEUE_BASE_PROBE, "--dequeue"],
    "--dry-run": [...GITHUB_ENQUEUE_BASE_PROBE, "--dry-run"],
    "--home": [...GITHUB_ENQUEUE_BASE_PROBE, "--home", "/tmp"],
    "--json": [...GITHUB_ENQUEUE_BASE_PROBE, "--json"],
    "--pr": [...GITHUB_ENQUEUE_BASE_PROBE],
    "--reason": [...GITHUB_ENQUEUE_BASE_PROBE, "--acknowledge-all", "--reason", "sole codeowner"],
    "--repo": [...GITHUB_ENQUEUE_BASE_PROBE],
  },
  "github release": {
    "--home": [...GITHUB_RELEASE_BASE_PROBE, "--home", "/tmp"],
    "--pr": [...GITHUB_RELEASE_BASE_PROBE],
    "--repo": [...GITHUB_RELEASE_BASE_PROBE],
    "--sha": [...GITHUB_RELEASE_BASE_PROBE, "--sha", "abc1234"],
  },
  "github press-reseal": {
    "--apply": [...GITHUB_PRESS_RESEAL_APPLY_PROBE],
    "--home": [...GITHUB_PRESS_RESEAL_BASE_PROBE, "--home", "/tmp"],
    "--json": [...GITHUB_PRESS_RESEAL_BASE_PROBE, "--json"],
    "--reason": [...GITHUB_PRESS_RESEAL_APPLY_PROBE],
    "--repo": [...GITHUB_PRESS_RESEAL_BASE_PROBE],
    "--source-sha256": [...GITHUB_PRESS_RESEAL_APPLY_PROBE],
  },
  "github merge": {
    "--acknowledge": [...GITHUB_MERGE_BASE_PROBE, "--acknowledge", "src/x.ts,a-doc-slug"],
    "--acknowledge-all": [...GITHUB_MERGE_BASE_PROBE, "--acknowledge-all", "--reason", "reviewed by hand"],
    // --admin and --number are each other's only valid company: --admin must name what it merges, and a
    // --number without one would be a merge that was asked for and silently did not happen.
    "--admin": [...GITHUB_MERGE_BASE_PROBE, "--admin", "--number", "21"],
    // --dry-run describes the --admin landing, so it is refused without it.
    "--dry-run": [...GITHUB_MERGE_BASE_PROBE, "--admin", "--number", "21", "--dry-run"],
    "--base": GITHUB_MERGE_BASE_PROBE,
    "--cwd": [...GITHUB_MERGE_BASE_PROBE, "--cwd", "/tmp"],
    "--deletion-threshold": [...GITHUB_MERGE_BASE_PROBE, "--deletion-threshold", "10"],
    "--description": GITHUB_MERGE_BASE_PROBE,
    "--head": GITHUB_MERGE_BASE_PROBE,
    "--home": [...GITHUB_MERGE_BASE_PROBE, "--home", "/tmp"],
    "--number": [...GITHUB_MERGE_BASE_PROBE, "--admin", "--number", "21"],
    "--reason": [...GITHUB_MERGE_BASE_PROBE, "--reason", "reviewed by hand"],
    "--remote": [...GITHUB_MERGE_BASE_PROBE, "--remote", "upstream"],
    "--repo": GITHUB_MERGE_BASE_PROBE,
  },
  "github bump-drive": {
    "--dry-run": ["--dry-run"],
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
    "--limit": ["--limit", "10"],
    "--opt-out-label": ["--opt-out-label", "no-auto-merge"],
    "--repo": ["--repo", "owner/name"],
  },
  "github landing": {
    "--author": ["--author", "someone"],
    // --cadence-minutes sets how long a --if-due read holds, so the parser refuses it alone.
    "--cadence-minutes": ["--if-due", "--cadence-minutes", "15"],
    "--drafts-only": ["--drafts-only"],
    // --dry-run describes what --press or --register would do, so the parser refuses it alone.
    "--dry-run": ["--press", "--dry-run"],
    "--full": ["--full"],
    "--home": ["--home", "/tmp"],
    "--if-due": ["--if-due"],
    "--include-drafts": ["--include-drafts"],
    "--json": ["--json"],
    "--limit": ["--limit", "10"],
    "--opt-out-label": ["--opt-out-label", "no-auto-merge"],
    // --pr drills into one row, so the parser refuses it without exactly one --repo.
    "--pr": ["--pr", "7", "--repo", "owner/name"],
    "--press": ["--press"],
    // --record-reading records only the owner's own pull requests, so the parser refuses it without --author @me.
    "--record-reading": ["--author", "@me", "--record-reading", "tick-12"],
    "--register": ["--register"],
    "--repo": ["--repo", "owner/name"],
    "--slack-live": ["--slack-live"],
  },
  "github turn-path": {
    "--base": ["--head", "a-branch", "--base", "origin/develop"],
    "--cwd": ["--head", "a-branch", "--cwd", "/tmp"],
    "--head": ["--head", "a-branch"],
    "--json": ["--head", "a-branch", "--json"],
    "--number": ["--head", "a-branch", "--number", "145"],
    "--remote": ["--head", "a-branch", "--remote", "upstream"],
    "--repo": ["--head", "a-branch", "--repo", "owner/name"],
  },
  "github cycle": {
    "--dry-run": ["--repo", "owner/name", "--number", "1", "--dry-run"],
    "--home": ["--repo", "owner/name", "--number", "1", "--home", "/tmp"],
    "--json": ["--repo", "owner/name", "--number", "1", "--json"],
    "--number": ["--repo", "owner/name", "--number", "1"],
    "--prime": ["--repo", "owner/name", "--number", "1", "--prime"],
    "--repo": ["--repo", "owner/name", "--number", "1"],
  },
};

const parsers: NonNullable<HelpTruthSlice["parsers"]> = {
  "github turn-path": ({ fragment }) =>
    parseGithubTurnPathArgs({ rest: dedupeFlags({ base: ["--head", "a-branch"], fragment }) }),
  "github bump-drive": ({ fragment }) => parseGithubBumpDriveArgs({ rest: [...fragment] }),
  "github landing": ({ fragment }) => parseGithubLandingArgs({ rest: [...fragment] }),
  // A fragment that already names its sub-command is passed through UNCHANGED, so an update-only flag is
  // proved through update's own parser. Anything else gets a minimal create baseline, which is what the
  // generic unknown-flag strictness probe needs.
  // Both report modes are exclusive with the placement flags, so a fragment naming either stands alone;
  // everything else gets the placement baseline, which is what the generic unknown-flag strictness probe needs.
  "github hold": ({ fragment }) =>
    parseGithubHoldArgs({
      rest:
        fragment.includes("--status") || fragment.includes("--history")
          ? [...fragment]
          : dedupeFlags({ base: GITHUB_HOLD_BASE_PROBE, fragment }),
    }).mapErr((error) => githubVerbErrorLines({ error })),
  "github enqueue": ({ fragment }) =>
    parseGithubEnqueueArgs({ rest: dedupeFlags({ base: GITHUB_ENQUEUE_BASE_PROBE, fragment }) }),
  "github merge": ({ fragment }) => parseGithubMergeArgs({ argv: [...fragment] }),
  "github release": ({ fragment }) =>
    parseGithubReleaseArgs({ rest: dedupeFlags({ base: GITHUB_RELEASE_BASE_PROBE, fragment }) }),
  "github cycle": ({ fragment }) => parseGithubCycleArgs({ rest: [...fragment] }),
  "github press-reseal": ({ fragment }) => parseGithubPressResealArgs({ rest: [...fragment] }),
};

/** The rows for `github`'s landing verbs. */
export const githubLandingSlice: HelpTruthSlice = { guarded, probes, parsers };
