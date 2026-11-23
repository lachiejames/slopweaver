/**
 * `slopweaver github stack restack` — the effectful shell of the whole-forest LOCAL restack.
 *
 * Owner ruling: a good stacking tool does the whole restack locally and then force pushes it all up to the
 * remote, so a stack is never left with one pull request rebased and the next not. This verb
 * is the first half of that rule, and it is deliberately the whole of what it does: **it reaches the
 * network exactly twice, to fetch and to read the operator's open pull requests, and it writes nothing to
 * the remote at all.** The push is a separate act on an already-restacked forest, which is what makes the
 * half-moved stack impossible rather than merely reported.
 *
 * Scope is every OPEN pull request the operator authored, from `listOpenPrsAuthoredByMe` — not the members
 * of a native GitHub stack, which is why `stack sync` planned zero rebases over 227 registered pull requests
 * in lachiejames/slopweaver and zero over 47 in acme/acme-admin when measured. A pull
 * request based directly on the trunk is a root of its own tree here, and is restacked like any other.
 */
import { randomUUID } from "node:crypto";

import type { WrittenPr } from "../../../corpus/github/write.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { type PrStateError } from "../../../outbound/github/prStateErrors.js";
import { writePrState } from "../../../outbound/github/prStateStore.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { resolveHome } from "../../optionParsers.js";
import type { FlagSpec } from "../../parseFlags.js";
import type { GithubVerbResult } from "./errors.js";
import { type RestackOutcome, restackStagingRef } from "./restackExec.js";
import {
  planRestackForest,
  type RestackForest,
  type RestackPullRequest,
  restackForestReportLines,
} from "./restackForestCore.js";
import { executeRestackForest, restackRunReportLines } from "./restackForestExecute.js";
import { gatherFacts } from "./restackForestFacts.js";
import { restackSnapshot } from "./restackSnapshot.js";
import {
  parseStackCommonArgs,
  STACK_COMMON_FLAG_NAMES,
  STACK_COMMON_FLAGS,
  type StackCommonArgs,
} from "./stackCommonArgs.js";
import { productionStackVerbDeps, type StackVerbDeps } from "./stackVerbDeps.js";
import { runWholeRepoStackVerb } from "./stackVerbShell.js";

const VERB_ARG_OFFSET = 5; // node, cli, "github", "stack", "restack"

/**
 * The flags this verb accepts.
 *
 * @internal the flag-name list below and this verb's own parser are its only readers.
 */
export const GITHUB_STACK_RESTACK_FLAGS: FlagSpec = STACK_COMMON_FLAGS;

/** Every accepted flag, with the `--` callers type. */
export const GITHUB_STACK_RESTACK_FLAG_NAMES: readonly string[] = STACK_COMMON_FLAG_NAMES;

/**
 * One parsed invocation.
 *
 * @internal named by this verb's own parser, shell and tests; nothing else in the repo consumes it.
 */
export type GithubStackRestackArgs = StackCommonArgs;

/**
 * Parse a restack invocation without touching Git or the network.
 *
 * @param argv the verb's own argument tail, after `github stack restack`
 * @returns the parsed options or every usage error
 */
export function parseGithubStackRestackArgs({
  argv,
}: {
  argv: readonly string[];
}): GithubVerbResult<GithubStackRestackArgs> {
  return parseStackCommonArgs({ argv }).map((parsed) => parsed.args);
}

/**
 * The id namespacing every staged ref one whole-forest replay writes.
 *
 * Sortable-first so `git for-each-ref refs/slopweaver/restack/` reads chronologically, with a random tail
 * because two runs in the same millisecond are not impossible and a collision would let one run's refs be
 * read as another's.
 *
 * @internal named by this verb's own shell; no caller outside it mints a generation.
 * @param now the instant the replay began
 * @returns the generation id
 */
export function restackGenerationId({ now }: { now: Date }): string {
  return `${now.toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`;
}

/** Everything resolving an invocation produced, before anything is replayed. */
interface ResolvedRestack {
  readonly args: GithubStackRestackArgs;
  readonly baseTips: ReadonlyMap<string, string>;
  readonly forest: RestackForest;
  readonly repo: string;
  readonly repoRoot: string;
  /** Every open pull request of the operator's on THIS remote, whether or not the plan moves it. */
  readonly inScope: readonly RestackPullRequest[];
}

/**
 * Fetch, read the operator's open pull requests, measure staleness and plan — no replay yet.
 *
 * Runs INSIDE the repository lock, deliberately. A plan built before the lock is taken is a plan built from
 * facts another run may already have invalidated by the time this one is admitted, which is the exact shape
 * of the drift the lock exists to prevent.
 */
async function resolveRestack({
  args,
  deps,
  repo,
  repoRoot,
}: {
  args: GithubStackRestackArgs;
  deps: StackVerbDeps;
  repo: string;
  repoRoot: string;
}): Promise<Result<ResolvedRestack, number>> {
  const inventory = await readOpenInventory({ args, deps, repo, repoRoot });
  if (inventory.isErr()) {
    return err(inventory.error);
  }
  const { mine, foreign } = inventory.value;
  const gathered = gatherFacts({
    deps,
    openPrs: mine.map((pr) => ({ baseRef: pr.baseRef, headRef: pr.head.ref, headSha: pr.head.sha, number: pr.number })),
    remote: args.remote,
    repoRoot,
  });
  const planned = planRestackForest({ pullRequests: gathered.pullRequests });
  // A pull request opened from a fork has a head branch this remote does not carry, so `refs/heads/<head>`
  // here names something else entirely — or nothing. Named as residue rather than silently restacked.
  const forkResidue = foreign.map(
    (pr) =>
      `#${String(pr.number)} (${pr.head.ref}) is opened from ${pr.head.repoFullName}, not ${repo} — ` +
      "a fork's head branch is not this remote's to restack",
  );
  return ok({
    args,
    baseTips: gathered.baseTips,
    forest: { residue: [...gathered.residue, ...forkResidue, ...planned.residue], trees: planned.trees },
    inScope: gathered.pullRequests,
    repo,
    repoRoot,
  });
}

/**
 * Fetch once, then read every open pull request the operator authored, split into this remote's and a
 * fork's — refusing outright when the walk was cut short, since completeness is this verb's whole claim.
 */
async function readOpenInventory({
  args,
  deps,
  repo,
  repoRoot,
}: {
  args: GithubStackRestackArgs;
  deps: StackVerbDeps;
  repo: string;
  repoRoot: string;
}): Promise<Result<{ readonly mine: readonly WrittenPr[]; readonly foreign: readonly WrittenPr[] }, number>> {
  const home = resolveHome({ named: args.home });
  const token = deps.token({ home });
  if (token === undefined) {
    deps.out({ line: "refused: no GitHub token resolved ($SLOPWEAVER_HOME/secrets/github-token, or gh auth token)" });
    return err(EXIT_ERROR);
  }
  const fetched = deps.git.writeGit({ args: ["fetch", args.remote], cwd: repoRoot });
  if (fetched.isErr()) {
    deps.out({ line: `refused: could not fetch ${args.remote}: ${fetched.error}` });
    return err(EXIT_ERROR);
  }
  const [owner, name] = repo.split("/");
  const listed = await deps.makeApi({ home, token }).listOpenPrsAuthoredByMe({ owner: owner!, repo: name! });
  if (listed.isErr()) {
    deps.out({ line: `refused: could not read your open pull requests: ${listed.error.message}` });
    return err(EXIT_ERROR);
  }
  // A capped walk cannot back a verb whose claim is "every open pull request you authored": restacking the
  // first 500 and reporting success is exactly the silent half-job this whole change exists to end.
  if (listed.value.truncated) {
    deps.out({
      line:
        "refused: this repository has more open pull requests than one walk returns, so the set this verb " +
        "would restack is not all of yours — raise the page bound in listOpenPrsVia before running it here",
    });
    return err(EXIT_ERROR);
  }
  return ok({
    foreign: listed.value.prs.filter((pr) => pr.head.repoFullName !== repo),
    mine: listed.value.prs.filter((pr) => pr.head.repoFullName === repo),
  });
}

/**
 * Run one whole-forest local restack.
 *
 * @param argv the full process argv; this verb's arguments begin after node, CLI, "github", "stack" and "restack"
 * @param deps injectable Git, API, clock, token and output edges
 * @returns the process exit code
 */
export async function runGithubStackRestack({
  argv,
  deps = productionStackVerbDeps(),
}: {
  argv: readonly string[];
  deps?: StackVerbDeps;
}): Promise<number> {
  return runWholeRepoStackVerb({
    argv,
    body: ({ args, repo, repoRoot }) => restackUnderLock({ args, deps, repo, repoRoot }),
    deps,
    offset: VERB_ARG_OFFSET,
    parse: parseGithubStackRestackArgs,
    refusedExitCode: EXIT_ERROR,
    usageExitCode: EXIT_USAGE,
  });
}

/**
 * Everything the lock protects: the fetch, the discovery, the plan, and every local replay.
 *
 * A dry run holds the lock too — its fetch moves this repository's remote-tracking refs, which is exactly
 * the state a concurrent real restack is planning from.
 *
 * @param args the parsed invocation
 * @returns the process exit code
 */
async function restackUnderLock({
  args,
  deps,
  repo,
  repoRoot,
}: {
  args: GithubStackRestackArgs;
  deps: StackVerbDeps;
  repo: string;
  repoRoot: string;
}): Promise<number> {
  const resolved = await resolveRestack({ args, deps, repo, repoRoot });
  if (resolved.isErr()) {
    return resolved.error;
  }
  const { baseTips, forest, inScope } = resolved.value;
  for (const line of restackForestReportLines({ forest })) {
    deps.out({ line });
  }
  if (args.dryRun) {
    deps.out({
      line: "dry run: no rebase, no ref moved, no snapshot written, and nothing was ever going to be pushed.",
    });
    return EXIT_OK;
  }
  const planned = forest.trees.flatMap((tree) => tree.nodes.filter((node) => node.reason !== undefined));
  const generationId = restackGenerationId({ now: deps.now() });
  const report = executeRestackForest({ baseTips, deps, forest, generationId, repoRoot });
  for (const line of restackRunReportLines({ report })) {
    deps.out({ line });
  }
  // Published even when NOTHING moved: an unchanged inventory still has to be recorded, or a pull request
  // that merged since the last run survives in the snapshot as a row nothing ever deletes — which is exactly
  // the never-pruned shape `ledgers/github-stack-members/` grew into.
  const published = publishSnapshot({
    baseTips,
    deps,
    forest,
    generationId,
    home: resolveHome({ named: args.home }),
    inScope,
    outcomes: report.outcomes,
    repo,
    repoRoot,
  });
  if (published.isErr()) {
    deps.out({ line: `refused: ${published.error.message}` });
    return EXIT_ERROR;
  }
  const restacked = report.outcomes.filter((outcome) => outcome.kind === "restacked").length;
  deps.out({
    line:
      `${String(restacked)} of ${String(planned.length)} planned branch(es) restacked locally, and all ` +
      `${String(inScope.length)} of your open pull requests recorded. Nothing has been pushed; each result ` +
      `is staged at ${restackStagingRef({ branch: "<branch>", generationId })}.`,
  });
  return restacked === planned.length ? EXIT_OK : EXIT_ERROR;
}

/** Write the snapshot for this repository, keyed by its git common directory so worktrees share one. */
function publishSnapshot({
  baseTips,
  deps,
  forest,
  generationId,
  home,
  inScope,
  outcomes,
  repo,
  repoRoot,
}: {
  baseTips: ReadonlyMap<string, string>;
  deps: StackVerbDeps;
  forest: RestackForest;
  generationId: string;
  home: string;
  inScope: readonly RestackPullRequest[];
  outcomes: readonly RestackOutcome[];
  repo: string;
  repoRoot: string;
}): Result<void, PrStateError> {
  return writePrState({
    gitCommonDir: gitCommonDirOf({ deps, repoRoot }),
    home,
    state: restackSnapshot({
      baseTips,
      deps,
      forest,
      generationId,
      inScope,
      nowIso: deps.now().toISOString(),
      outcomes,
      repo,
      repoRoot,
    }),
  });
}

/**
 * The clone's own git common directory, resolved absolutely, which is what keys the snapshot.
 *
 * Worktrees of one clone all answer the same path, which is the point: they share the branches a snapshot
 * describes, so they must share the snapshot. Two clones answer different paths and keep their own.
 */
function gitCommonDirOf({ deps, repoRoot }: { deps: StackVerbDeps; repoRoot: string }): string {
  return deps.git.readGit({ args: ["rev-parse", "--path-format=absolute", "--git-common-dir"], cwd: repoRoot });
}
