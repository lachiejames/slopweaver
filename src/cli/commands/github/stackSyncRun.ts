/**
 * `slopweaver github stack sync` — the effectful shell.
 *
 * Repo-wide by design, not per-worktree: a rebase at the bottom of a stack has to propagate up through
 * every entry above it in one pass, so this walks every stack the operator is part of from whichever
 * worktree it is invoked in, discovering the others via `git worktree list` rather than assuming one.
 *
 * Reuses `pushCore.ts`'s exact-lease plan builder unchanged for every push, exactly like `stack push` does.
 */

import { DEFAULT_GATES } from "../../../admit/door.js";
import { notPerformedLines } from "../../../admit/doorRefusal.js";
import { throughDoor } from "../../../admit/effects.js";
import { acquireOperationLock } from "../../../admit/operationLock.js";
import { githubToken } from "../../../config.js";
import { type GithubWriteApi, makeGithubWriteApi } from "../../../corpus/github/write.js";
import { logger } from "../../../lib/logger.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { listRegisteredStackMembers } from "../../../outbound/github/stackLedger.js";
import { githubWritePrivacy } from "../../../outbound/github/writePrivacy.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { resolveHome } from "../../optionParsers.js";
import { githubVerbErrorLines } from "./errors.js";
import { invocationDir } from "./pushCore.js";
import { type GithubPushDeps, productionGithubPushDeps } from "./pushPrimitives.js";
import {
  type StackFactContext,
  type StackIsAncestor,
  stackFactsForEntries,
  stackIsAncestor,
  stackLocalFacts,
  stackRemoteDefaultBranch,
  stackWorktreeList,
} from "./stackFacts.js";
import { executeStackSteps, stackStepOutcomeLines, stackStepsFullyLanded } from "./stackStepExec.js";
import {
  type GithubStackSyncArgs,
  type GithubStackSyncEntryFact,
  type GithubStackSyncPlan,
  githubStackSyncDoorRequest,
  githubStackSyncPlan,
  githubStackSyncReportLines,
  parseGithubStackSyncArgs,
} from "./stackSyncCore.js";

const VERB_ARG_OFFSET = 5; // node, cli, "github", "stack", "sync"

/** The injectable edges — Git through `pushRun.ts`'s deps, plus the write API, ancestry check and output sink. */
export interface GithubStackSyncDeps {
  readonly git: GithubPushDeps;
  readonly isAncestor: StackIsAncestor;
  readonly makeApi: (input: { readonly home: string; readonly token: string }) => GithubWriteApi;
  readonly now: () => Date;
  readonly out: (input: { readonly line: string }) => void;
  /** The GitHub token resolver (env, then the secrets file, then `gh auth token`), injectable so a test never shells the real `gh` CLI. */
  readonly token: (input: { readonly home: string }) => string | undefined;
}

/**
 * The production edges.
 *
 * @returns the real Git primitives, ancestry check, API factory, clock and output sink
 */
function productionGithubStackSyncDeps(): GithubStackSyncDeps {
  return {
    git: productionGithubPushDeps(),
    isAncestor: stackIsAncestor,
    makeApi: ({ home, token }) => makeGithubWriteApi({ privacy: githubWritePrivacy({ home }), token }),
    now: () => new Date(),
    out: logger.out,
    token: ({ home }) => githubToken({ home }),
  };
}

/** The fact context sync walks with: its API also reads the whole stack, which the shared fact gatherer never does. */
type SyncFactContext = StackFactContext & { readonly api: Pick<GithubWriteApi, "getPr" | "getStack"> };

/** One resolved stack's entries, turned into facts sync can plan from. */
async function factsForStack({
  context,
  worktrees,
}: {
  context: SyncFactContext;
  worktrees: ReturnType<typeof stackWorktreeList>;
}): Promise<{ readonly facts: readonly GithubStackSyncEntryFact[]; readonly residue: readonly string[] }> {
  const stack = await context.api.getStack({
    owner: context.owner,
    repo: context.repo,
    stackNumber: context.stackNumber,
  });
  if (stack.isErr()) {
    return {
      facts: [],
      residue: [`could not read stack #${String(context.stackNumber)}: ${stack.error.message}`],
    };
  }
  return stackFactsForEntries({ context, entries: stack.value.entries, firstPosition: 1, worktrees });
}

/**
 * Discover every stack fact sync needs to plan from — scoped to LOCAL stack state, never to every native
 * stack the operator happens to be part of. Only a PR `stack push` or `stack adopt` registered into
 * `stackLedger.ts` is ever a starting point for discovery; a native stack that happens to include one of
 * this operator's PRs, but which nothing here registered, is never silently pulled into scope.
 */
async function discoverFacts({
  base,
  home,
}: {
  base: Omit<SyncFactContext, "stackNumber" | "registeredNumbers">;
  home: string;
}): Promise<{ readonly facts: readonly GithubStackSyncEntryFact[]; readonly residue: readonly string[] }> {
  const { api, owner, repo, repoRoot, git } = base;
  const registeredNumbers = new Set(listRegisteredStackMembers({ home, owner, repo }));
  const residue: string[] = [];
  const stackNumbers = new Set<number>();
  for (const number of registeredNumbers) {
    const pr = await api.getPr({ number, owner, repo });
    if (pr.isErr()) {
      residue.push(`could not read PR #${String(number)}: ${pr.error.message}`);
      continue;
    }
    if (pr.value.stack === undefined) {
      residue.push(`PR #${String(number)} is registered but is not part of a native GitHub stack`);
      continue;
    }
    stackNumbers.add(pr.value.stack.number);
  }
  const worktrees = stackWorktreeList({ git, repoRoot });
  const facts: GithubStackSyncEntryFact[] = [];
  for (const stackNumber of stackNumbers) {
    const result = await factsForStack({ context: { ...base, registeredNumbers, stackNumber }, worktrees });
    facts.push(...result.facts);
    residue.push(...result.residue);
  }
  return { facts, residue };
}

/** What resolving args and the plan produced. */
type ResolvedStackSync = Result<
  {
    readonly args: GithubStackSyncArgs;
    readonly plan: GithubStackSyncPlan;
    readonly cwd: string;
    readonly repo: string;
  },
  number
>;

/** Parse → read local facts → discover → plan, reporting any refusal as it goes. */
async function resolveStackSyncPlan({
  argv,
  deps,
}: {
  argv: readonly string[];
  deps: GithubStackSyncDeps;
}): Promise<ResolvedStackSync> {
  const parsed = parseGithubStackSyncArgs({ argv: argv.slice(VERB_ARG_OFFSET) });
  if (parsed.isErr()) {
    for (const line of githubVerbErrorLines({ error: parsed.error })) deps.out({ line });
    return err(EXIT_USAGE);
  }
  const args = parsed.value;
  const cwd = invocationDir({ cwd: args.cwd });
  let repoRoot: string;
  let repo: string;
  let defaultBranch: string;
  try {
    const local = stackLocalFacts({ cwd, git: deps.git, remote: args.remote });
    repoRoot = local.repoRoot;
    repo = local.repo;
    defaultBranch = stackRemoteDefaultBranch({ git: deps.git, remote: args.remote, repoRoot });
  } catch (error: unknown) {
    deps.out({ line: `refused: ${error instanceof Error ? error.message : String(error)}` });
    return err(EXIT_ERROR);
  }
  const home = resolveHome({ named: args.home });
  const token = deps.token({ home });
  if (token === undefined) {
    deps.out({ line: "refused: no GitHub token resolved ($SLOPWEAVER_HOME/secrets/github-token, or gh auth token)" });
    return err(EXIT_ERROR);
  }
  const api = deps.makeApi({ home, token });
  const [owner] = repo.split("/");
  const discovered = await discoverFacts({
    base: {
      api,
      defaultBranch,
      git: deps.git,
      isAncestor: deps.isAncestor,
      owner: owner!,
      remote: args.remote,
      repo: repo.split("/")[1]!,
      repoRoot,
    },
    home,
  });
  const plan = githubStackSyncPlan({ entries: discovered.facts });
  const fullPlan: GithubStackSyncPlan = { residue: [...discovered.residue, ...plan.residue], steps: plan.steps };
  return ok({ args, cwd: repoRoot, plan: fullPlan, repo });
}

/**
 * Run one governed stack sync.
 *
 * @param argv the full process argv; this verb's arguments begin after node, CLI, noun, "stack" and "sync"
 * @param deps injectable Git, ancestry-check, API and output edges
 * @returns the process exit code
 */
export async function runGithubStackSync({
  argv,
  deps = productionGithubStackSyncDeps(),
}: {
  argv: readonly string[];
  deps?: GithubStackSyncDeps;
}): Promise<number> {
  const resolved = await resolveStackSyncPlan({ argv, deps });
  if (resolved.isErr()) {
    return resolved.error;
  }
  const { args, plan } = resolved.value;
  for (const line of githubStackSyncReportLines({ plan })) {
    deps.out({ line });
  }
  if (args.dryRun) {
    deps.out({ line: "dry run: no rebase, no door record, no push." });
    return EXIT_OK;
  }
  if (plan.steps.length === 0) {
    return EXIT_OK;
  }
  const home = resolveHome({ named: args.home });
  // Lower-cased: GitHub owner/repo names are case-insensitive, but the lock hashes this key verbatim, so a
  // differently-cased remote for the SAME repository would otherwise contend on a different lock entirely —
  // letting a concurrent stack operation on that repository race this one instead of waiting for it.
  const lockKey = resolved.value.repo.toLowerCase();
  const lock = acquireOperationLock({ home, key: lockKey, nowIso: deps.now().toISOString() });
  if (!lock.isOk()) {
    deps.out({ line: `refused: another stack operation is in progress on ${lockKey} (${lock.error})` });
    return EXIT_ERROR;
  }
  try {
    const routed = await throughDoor({
      gates: DEFAULT_GATES,
      home,
      ledger: deps.git.doorLedger,
      perform: () =>
        Promise.resolve(executeStackSteps({ git: deps.git, home, remote: args.remote, steps: plan.steps })),
      request: githubStackSyncDoorRequest({ home, plan }),
    });
    if (!routed.performed) {
      for (const line of notPerformedLines({ command: "slopweaver github stack sync", through: routed })) {
        deps.out({ line });
      }
      return EXIT_ERROR;
    }
    for (const line of stackStepOutcomeLines({ landedWord: "synced", outcomes: routed.result, prefix: "" })) {
      deps.out({ line });
    }
    return stackStepsFullyLanded({ outcomes: routed.result, steps: plan.steps }) ? EXIT_OK : EXIT_ERROR;
  } finally {
    lock.value.release();
  }
}
