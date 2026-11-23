/**
 * `slopweaver github merge` — the effectful shell. Every decision lives in `./mergeCore.js`; this file
 * resolves the repository, reads the description, shells git through `../../../outbound/github/mergeFacts.js`
 * and `../../../outbound/github/probeSweep.js`, and prints the report.
 *
 * ## Without `--admin` this verb REPORTS. It never calls GitHub.
 *
 * No token is resolved, no HTTP request is made, and nothing can merge, close or push anything. See
 * `./mergeCore.js`'s header for what that guard measures.
 *
 * It touches the NETWORK, which is a different property: one `git fetch` of
 * the base branch's tip, over the Git transport, before anything is measured. `--base main` resolved
 * to the LOCAL ref would be wrong, because every worktree on the owner's machine is routinely behind it, which
 * makes the guard report another
 * session's landed pull request as an unmentioned 146-line deletion in YOUR change. See
 * `./mergeCore.js`'s {@link ResolvedBase} for the fetch and for what happens when it cannot run.
 *
 * ## With `--admin` a CLEAN report is followed by a real squash merge
 *
 * `--admin` is an explicit option and never a default: it merges through the repository administrator's
 * branch-protection bypass, and only after this verb's own report comes back with nothing unacknowledged.
 * The whole of that path lives in `./mergeAdminRun.js`; see its header for the ordering it depends on and
 * the base-freshness remeasure it performs first. The stated limit is unchanged for everything else —
 * `gh pr merge` and an administrator's override in the GitHub UI bypass this guard completely, because it
 * is a discipline the operator runs, not a fence GitHub enforces.
 *
 * ## Order
 *
 *   parse → resolve the repository root → fetch the base branch's remote tip → read the description →
 *   measure the diff → sweep the board → sweep the docs budget against the merged tree → decide the findings
 *   → NAME the tree, base and head that were measured → print the verdict → [--admin only] merge
 *
 * A failure to resolve the repository or to measure the diff is a REFUSAL (a non-zero exit with a clear
 * reason), never a silent "clean" — the same discipline the pure core already applies to an unreachable
 * orchestration board. A failure to FETCH is the one step that degrades rather than refuses: it measures the
 * local ref and says so, in the report header and as its own acknowledgeable `base-unresolved` finding.
 */
import { readFileSync } from "node:fs";
import { resolveRepoRoot } from "../../../codex/gitDiff.js";
import type { IngestError } from "../../../lib/ingestError.js";
import { logger } from "../../../lib/logger.js";
import type { Result } from "../../../lib/result.js";
import { type MergeDocsBudgetSweep, sweepMergeDocsBudget } from "../../../outbound/github/docsBudgetSweep.js";
import { type MergeFacts, measureMergeFacts } from "../../../outbound/github/mergeFacts.js";
import { mergeGuardFindings } from "../../../outbound/github/mergeGuard.js";
import { type MergeProbeSweep, sweepMergeProbeRegressions } from "../../../outbound/github/probeSweep.js";
import { stateHomePaths } from "../../../stateHome.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { resolveHome } from "../../optionParsers.js";
import { behindBaseAdvisory } from "./baseFreshnessCore.js";
import {
  type CountCommitsAhead,
  countCommitsAhead,
  deletePrivateRef,
  fetchBranchIntoPrivateRef,
  newPrivateFetchRef,
  resolveCommitSha,
} from "./gitAncestry.js";
import { type MergeHoldDeps, productionMergeHoldDeps } from "./holdDeps.js";
import { remoteBaseBranchOf } from "./mergeAdminCore.js";
import { productionGithubAdminMergeDeps } from "./mergeAdminDeps.js";
import { performAdminMerge } from "./mergeAdminRun.js";
import type { GithubAdminMergeDeps } from "./mergeAdminTypes.js";
import { type GithubMergeArgs, parseGithubMergeArgs } from "./mergeArgs.js";
import {
  baseUnresolvedFindings,
  docsBudgetFindingsFromSweep,
  type MergeVerdict,
  measuredTreeLines,
  mergeVerdict,
  type ResolvedBase,
  regressionsFromSweep,
} from "./mergeCore.js";
import { refusedByHold } from "./mergeHoldStep.js";
import { productionGithubPushDeps } from "./pushRun.js";

/** Where this verb's own arguments start in `process.argv`: after node, the script, the noun and the verb. */
const VERB_ARG_OFFSET = 4;

/** The injectable edges. A test supplies plain functions; nothing here is a mock. */
export interface GithubMergeDeps {
  /** Reads the description: the literal text, or stdin when the source is `-`. */
  readonly readDescription: (args: { source: string }) => string;
  readonly resolveRepoRoot: (args: { cwd: string }) => Result<string, IngestError>;
  /** Resolves `--base` to the remote branch's live tip, falling back to the local ref and saying so. */
  readonly resolveBase: (args: { cwd: string; base: string; remote: string }) => ResolvedBase;
  readonly measureFacts: (args: { cwd: string; base: string; head: string }) => MergeFacts;
  /**
   * How many commits the base tip carries that the measured head does not — the staleness advisory's number.
   *
   * The same `git rev-list --count` `./baseFreshnessRun.js` counts its drift with, against the tip this verb
   * has ALREADY fetched, so nothing here reaches the network a second time.
   */
  readonly countBehindBase: CountCommitsAhead;
  readonly sweepProbes: (args: {
    repoRoot: string;
    base: string;
    head: string;
    handoversDir: string;
  }) => MergeProbeSweep;
  readonly sweepDocsBudget: (args: { repoRoot: string; base: string; head: string }) => MergeDocsBudgetSweep;
  readonly cwd: () => string;
  readonly out: (args: { line: string }) => void;
  /** The `--admin` merge's own edges. Never reached unless `--admin` was typed and the report came back clean. */
  readonly admin: GithubAdminMergeDeps;
  /** The merge hold's own edges — the document, the clock and the supervisor stream. */
  readonly hold: MergeHoldDeps;
}

/**
 * Resolve `--base` to the base branch's LIVE remote tip, or say why the local ref is being measured instead.
 *
 * The fetch lands in a private ref that is deleted the moment its commit has been resolved: the report is
 * taken against the SHA, and a ref this verb leaves behind is one a later `git fetch --prune` has to reason
 * about. `refs/heads/main`, `origin/main` and `main` all name the same branch here — {@link remoteBaseBranchOf}
 * normalises them — so a caller that already spells the remote gets the same measurement rather than a second
 * remote prefix.
 *
 * A failure never throws and never falls back silently. It returns the local ref WITH the reason, which
 * `baseUnresolvedFindings` turns into a printed, acknowledgeable finding and `measuredTreeLines` names in the
 * report's own header.
 *
 * @param cwd the repository to fetch into
 * @param base the base as the caller spelled it
 * @param remote the Git remote to fetch the tip from
 * @returns the revision to measure against, and where it came from
 */
function resolveBaseAgainstRemote({ cwd, base, remote }: { cwd: string; base: string; remote: string }): ResolvedBase {
  const branch = remoteBaseBranchOf({ base, remote });
  const git = productionGithubPushDeps();
  const ref = newPrivateFetchRef();
  try {
    const fetched = fetchBranchIntoPrivateRef({ branch, cwd, git, ref, remote });
    if (fetched.isErr()) {
      return { branch, fetchedFrom: undefined, revision: base, why: fetched.error.message };
    }
    const sha = resolveCommitSha({ cwd, ref: fetched.value.sha });
    if (sha.isErr()) {
      return { branch, fetchedFrom: undefined, revision: base, why: sha.error.message };
    }
    return { branch, fetchedFrom: remote, revision: sha.value, why: undefined };
  } finally {
    const deleted = deletePrivateRef({ cwd, git, ref });
    if (deleted.isErr()) {
      git.out({ line: `warning: could not delete private ref ${ref}: ${deleted.error.message}` });
    }
  }
}

const DEFAULT_DEPS: GithubMergeDeps = {
  admin: productionGithubAdminMergeDeps(),
  countBehindBase: countCommitsAhead,
  cwd: () => process.cwd(),
  hold: productionMergeHoldDeps(),
  measureFacts: ({ cwd, base, head }) => measureMergeFacts({ base, cwd, head }),
  out: logger.out,
  readDescription: ({ source }) => (source === "-" ? readFileSync(0, "utf8") : source),
  resolveBase: ({ cwd, base, remote }) => resolveBaseAgainstRemote({ base, cwd, remote }),
  resolveRepoRoot: ({ cwd }) => resolveRepoRoot({ cwd }),
  sweepDocsBudget: ({ repoRoot, base, head }) => sweepMergeDocsBudget({ baseRef: base, headRef: head, repoRoot }),
  sweepProbes: ({ repoRoot, base, head, handoversDir }) =>
    sweepMergeProbeRegressions({ baseRef: base, handoversDir, headRef: head, repoRoot }),
};

/**
 * The production edges.
 *
 * A named exported factory rather than a module-private constant, mirroring `productionGithubPrDeps()`.
 *
 * @returns the real filesystem, git and output sink
 */
export function productionGithubMergeDeps(): GithubMergeDeps {
  return DEFAULT_DEPS;
}

/**
 * The one line stating, before any finding, whether this invocation can merge.
 *
 * Printed on BOTH paths and never conditionally omitted: a reader scanning a transcript should not have to
 * reconstruct from the flags whether a merge was about to happen.
 */
function bannerFor({ admin, dryRun }: { admin: boolean; dryRun: boolean }): string {
  if (dryRun) {
    return (
      "--admin --dry-run: every check the --admin merge makes runs below, in its order, and it stops before the " +
      "first write — no walkthrough thread resolved, no door, no merge."
    );
  }
  return admin
    ? "--admin: a CLEAN report below is followed by a real squash merge through the repository " +
        "administrator's branch-protection bypass, and the door records it."
    : "this verb REPORTS ONLY: it never calls GitHub to merge, close or push anything. `gh pr merge` and a " +
        "repository administrator's override bypass it entirely — this is a discipline, not a fence.";
}

/** Measure the diff, catching a git failure as a refusal rather than letting it crash the process. */
function measureOrRefuse({
  deps,
  repoRoot,
  base,
  head,
}: {
  deps: GithubMergeDeps;
  repoRoot: string;
  base: string;
  head: string;
}): { facts: MergeFacts } | { reason: string } {
  try {
    return { facts: deps.measureFacts({ base, cwd: repoRoot, head }) };
  } catch (error: unknown) {
    return {
      reason: `could not measure the diff between "${base}" and "${head}" in ${repoRoot}: ${
        error instanceof Error ? error.message : "unknown error"
      }`,
    };
  }
}

/** Read the description, sweep the board, and turn both plus the measured diff into the printable verdict. */
function verdictFor({
  args,
  deps,
  facts,
  home,
  repoRoot,
  resolved,
}: {
  args: GithubMergeArgs;
  deps: GithubMergeDeps;
  facts: MergeFacts;
  home: string;
  repoRoot: string;
  resolved: ResolvedBase;
}): MergeVerdict {
  const description = deps.readDescription({ source: args.descriptionSource });
  const sweep = deps.sweepProbes({
    base: resolved.revision,
    handoversDir: stateHomePaths({ home }).handovers,
    head: args.head,
    repoRoot,
  });
  const docsBudgetSweep = deps.sweepDocsBudget({ base: resolved.revision, head: args.head, repoRoot });
  return mergeVerdict({
    acknowledge: args.acknowledge,
    acknowledgeAll: args.acknowledgeAll,
    admin: args.admin,
    findings: [
      ...mergeGuardFindings({
        baseAhead: facts.baseAhead,
        deletionThreshold: args.deletionThreshold,
        description,
        diff: facts.diff,
        regressions: regressionsFromSweep({ sweep }),
        reverted: facts.reverted,
      }),
      ...docsBudgetFindingsFromSweep({ sweep: docsBudgetSweep }),
      ...baseUnresolvedFindings({ resolved }),
    ],
    reason: args.reason,
  });
}

/**
 * The staleness advisory for this report, or nothing when this invocation cannot honestly give one.
 *
 * Counted ONLY when the base tip was actually fetched. A fetch that failed leaves `resolved.revision` on the
 * LOCAL ref (see {@link resolveBaseAgainstRemote}), and this module's own header carries what that costs:
 * a local `main` behind its `origin/main`. A count taken against a stale local ref
 * UNDER-reports staleness, and an advisory that under-reports is worse than none — the whole point is that a
 * session stops guessing how behind it is. That case already has its own `base-unresolved` finding, which
 * says the true thing: the measurement did not happen.
 *
 * @param facts the measured diff, whose two tips the count is taken between
 * @param resolved where the base came from — a fetched tip, or the local fallback
 * @returns the single advisory line, or an empty list
 */
function behindBaseLinesFor({
  deps,
  facts,
  repoRoot,
  resolved,
}: {
  deps: GithubMergeDeps;
  facts: MergeFacts;
  repoRoot: string;
  resolved: ResolvedBase;
}): readonly string[] {
  const fetchedFrom = resolved.fetchedFrom;
  if (fetchedFrom === undefined) {
    return [];
  }
  const counted = deps.countBehindBase({ cwd: repoRoot, from: facts.headSha, to: facts.baseSha });
  if (counted.isErr()) {
    return [];
  }
  return behindBaseAdvisory({ baseBranch: resolved.branch, behindBy: counted.value, remote: fetchedFrom });
}

/**
 * Print the whole report: the header, the banner, the staleness advisory, the three lines naming what was
 * measured, and the verdict.
 *
 * The identity lines sit ABOVE the findings on purpose. They are what turns a verdict about the wrong tree
 * into a visibly wrong ANSWER rather than only a wrong verdict — see {@link measuredTreeLines} — and a reader
 * who scrolls to the first finding and stops has still passed them. The advisory sits above THEM for the
 * same reason, and changes no verdict and no exit code: it is the owner's visibility ruling, not
 * a gate.
 */
function printReport({
  args,
  deps,
  facts,
  repoRoot,
  resolved,
  verdict,
}: {
  args: GithubMergeArgs;
  deps: GithubMergeDeps;
  facts: MergeFacts;
  repoRoot: string;
  resolved: ResolvedBase;
  verdict: MergeVerdict;
}): void {
  deps.out({ line: `slopweaver github merge — ${args.repo}  ${args.head} -> ${args.base}` });
  deps.out({ line: bannerFor({ admin: args.admin, dryRun: args.dryRun }) });
  const lines = [
    ...behindBaseLinesFor({ deps, facts, repoRoot, resolved }),
    ...measuredTreeLines({
      baseSha: facts.baseSha,
      head: args.head,
      headSha: facts.headSha,
      repoRoot,
      resolved,
    }),
    ...verdict.lines,
  ];
  for (const line of lines) {
    deps.out({ line });
  }
}

/** The checkout to measure: `--cwd` when given, else the process's own working directory. */
function checkoutOf({ args, deps }: { args: GithubMergeArgs; deps: GithubMergeDeps }): string {
  if (args.cwd === undefined) {
    return deps.cwd();
  }
  return args.cwd;
}

/**
 * The whole verb, with its edges injected.
 *
 * @param argv the FULL process argv; this verb's own arguments start at {@link VERB_ARG_OFFSET}
 * @param deps the injectable edges — description reader, git measurement, board sweep and output sink
 * @returns the process exit code
 */
export async function runGithubMerge({
  argv,
  deps = DEFAULT_DEPS,
}: {
  argv: readonly string[];
  deps?: GithubMergeDeps;
}): Promise<number> {
  const parsed = parseGithubMergeArgs({ argv: argv.slice(VERB_ARG_OFFSET) });
  if (parsed.isErr()) {
    for (const line of parsed.error) {
      deps.out({ line });
    }
    return EXIT_USAGE;
  }
  const args = parsed.value;
  const home = resolveHome({ named: args.home });
  if (refusedByHold({ args, deps, home })) {
    return EXIT_ERROR;
  }
  const root = deps.resolveRepoRoot({ cwd: checkoutOf({ args, deps }) });
  if (root.isErr()) {
    deps.out({ line: `refused: could not resolve a git repository: ${root.error.message}` });
    return EXIT_ERROR;
  }
  const repoRoot = root.value;
  const resolved = deps.resolveBase({ base: args.base, cwd: repoRoot, remote: args.remote });
  const measured = measureOrRefuse({ base: resolved.revision, deps, head: args.head, repoRoot });
  if ("reason" in measured) {
    deps.out({ line: `refused: ${measured.reason}` });
    return EXIT_ERROR;
  }
  const verdict = verdictFor({ args, deps, facts: measured.facts, home, repoRoot, resolved });
  printReport({ args, deps, facts: measured.facts, repoRoot, resolved, verdict });
  if (verdict.refused) {
    return EXIT_ERROR;
  }
  if (!args.admin || args.number === undefined) {
    return EXIT_OK;
  }
  return performAdminMerge({
    deps: deps.admin,
    request: {
      acknowledgement: { acknowledge: args.acknowledge, acknowledgeAll: args.acknowledgeAll, reason: args.reason },
      base: args.base,
      execution: args.dryRun ? "dry-run" : "merge",
      head: args.head,
      home,
      number: args.number,
      remote: args.remote,
      repo: args.repo,
      repoRoot,
    },
  });
}

/**
 * The registered command. Only `run` — every other field of the contract lives in
 * `../../manifests/githubPullRequestActions.js`.
 */
export const githubMergeCommand = defineCommand({
  run: (argv: readonly string[]) => runGithubMerge({ argv, deps: productionGithubMergeDeps() }),
});
