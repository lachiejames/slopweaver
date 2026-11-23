/**
 * The governed push itself: the plan shape every push-shaped caller builds, and `pushAndVerify` — the one
 * gate-then-push-then-read-back ordering that `github push`, `stack push`/`adopt`/`sync`, the carry gate and a
 * worktree salvage all send through. One of its gates is the old-history guard (`./pushRootGate.ts`): once the
 * state home records a fresh root for the target repository, a commit with any other root is refused here, so
 * `home` is a required input rather than an ambient read.
 *
 * It lives in the admit layer rather than beside a verb because a salvage in `src/worktree/` pushes through it
 * too, and product code never imports the CLI tree. The verbs' own wiring — the production edges, the plan
 * inspection, base freshness — stays in `cli/commands/github/pushPrimitives.ts`, whose `GithubPushDeps`
 * extends {@link GithubPushEdges}.
 */
import { err, ok, type Result } from "../lib/result.js";
import { type GithubPushDoorError, GithubPushDoorErrors } from "./githubPushErrors.js";
import { refuseProofPathHead } from "./pushProofPathGate.js";
import { pushUrlsOf, refuseOldHistoryPush } from "./pushRootGate.js";
import { refuseDirtyWorkingTree } from "./pushWorkingTreeGate.js";

/** The live Git facts a caller measured before building a plan. */
export interface GithubPushFacts {
  readonly repoRoot: string;
  readonly repo: string;
  readonly branch: string;
  readonly defaultBranch: string;
  readonly localSha: string;
  readonly remoteBranchSha: string | undefined;
}

/** The one safe push shape a governed push can execute. */
export interface GithubPushPlan extends GithubPushFacts {
  /**
   * What the pushed branch is FOR. Required, never defaulted, so a forgotten field cannot become a bypass:
   * a pull-request head is refused when it carries proof output (`./pushProofPathGate.ts`), while a worktree
   * salvage branch preserves whatever work was there and opens no pull request.
   */
  readonly purpose: "pull-request-head" | "worktree-salvage";
  readonly remote: string;
  readonly forceWithLease: boolean;
  readonly gitArgs: readonly string[];
}

/** What the gate needs to run the hook exactly as git would have. */
export interface PrePushGateRequest {
  /** The repository root, which is the directory git runs its hooks from. */
  readonly cwd: string;
  /** The remote's configured name, the hook's first argv. */
  readonly remote: string;
  /** The `<local ref> <local sha> <remote ref> <remote sha>` line git feeds the hook on stdin. */
  readonly stdin: string;
}

/** Whether a hook was there to run; `hook` is the path consulted either way, so the report can name it. */
export type PrePushGateOutcome =
  { readonly kind: "ran"; readonly hook: string } | { readonly kind: "no-hook"; readonly hook: string };

/** The Git process and output edges a governed push reads, writes and reports through. */
export interface GithubPushEdges {
  readonly readGit: (args: { cwd: string; args: readonly string[] }) => string;
  readonly writeGit: (args: { cwd: string; args: readonly string[] }) => Result<void, string>;
  readonly out: (args: { line: string }) => void;
  /**
   * Run the repository's own `pre-push` hook — as git would, with the same argv and stdin — BEFORE the push
   * opens a transport. Present, `pushAndVerify` runs it and then pushes `--no-verify`, so git does not run the
   * hook a second time inside an open connection. Absent, git orders the two itself: a fake without it has its
   * pushes unchanged, and is never silently exempted from a gate — the gate simply runs inside git instead.
   */
  readonly prePushGate?:
    ((args: PrePushGateRequest) => Result<PrePushGateOutcome, { readonly message: string }>) | undefined;
}

/** What git writes for a ref that does not exist on the other side, in the pre-push hook's stdin line. */
const ABSENT_REF_SHA = "0".repeat(40);

/**
 * The stdin line git would feed the repository's `pre-push` hook for this plan, so the gate can run BEFORE
 * the transport opens and still see exactly what git would have shown it.
 *
 * Measured against `git push --set-upstream origin <sha>^{commit}:refs/heads/<branch>` in a scratch
 * repository: the local ref is the source refspec AS TYPED (`<sha>^{commit}`, not
 * `refs/heads/<branch>`), the remote SHA is forty zeros when the remote branch does not yet exist, and the
 * hook's argv is `<remote name> <remote url>`. Reproduce with a `pre-push` hook that runs `echo "$*"; cat`.
 *
 * @param plan the exact push plan whose refspec the hook is told about
 * @returns one `<local ref> <local sha> <remote ref> <remote sha>` line, newline-terminated
 */
export function prePushHookStdin({ plan }: { plan: GithubPushPlan }): string {
  const source = `${plan.localSha}^{commit}`;
  return `${source} ${plan.localSha} refs/heads/${plan.branch} ${hookRemoteSha({ plan })}\n`;
}

/** The remote SHA the hook is told about: git's forty zeros for a branch the remote does not have yet. */
function hookRemoteSha({ plan }: { plan: GithubPushPlan }): string {
  const remoteSha = plan.remoteBranchSha;
  if (remoteSha === undefined) {
    return ABSENT_REF_SHA;
  }
  return remoteSha;
}

/**
 * Where the `push` subcommand sits in an argv that may open with git's own global options.
 *
 * Git takes options BEFORE the subcommand, and a caller that has to disable hooks says so there:
 * `-c core.hooksPath=/dev/null -c core.fsmonitor=false push …`. Scanning for the subcommand rather than
 * reading position zero is what lets those two callers share one transport.
 *
 * Only the option forms git itself accepts before a subcommand are skipped, and `-c`/`-C` consume the
 * value that follows them, so a repository named `push` passed as `git -C push push …` cannot be mistaken
 * for the subcommand.
 *
 * @param gitArgs the whole argv handed to `git`
 * @returns the index of the `push` subcommand, or `null` when this argv does not run one
 */
function pushVerbIndex({ gitArgs }: { gitArgs: readonly string[] }): number | null {
  let at = 0;
  while (at < gitArgs.length) {
    const token = gitArgs[at]!;
    if (token === "-c" || token === "-C") {
      at += 2;
      continue;
    }
    if (token.startsWith("-")) {
      at += 1;
      continue;
    }
    if (token === "push") {
      return at;
    }
    return null;
  }
  return null;
}

/**
 * The push argv to run once the repository's `pre-push` hook has ALREADY been run by the verb.
 *
 * `--no-verify` is inserted right after `push`, and only after the hook has run: git otherwise opens the
 * transport to discover the remote's refs, runs the hook, and sends the pack afterwards — and GitHub resets
 * an ssh session that sits idle for the eight to ten minutes this repository's hook takes (measured twice,
 * `Connection reset by peer` then `SIGPIPE`, with client keepalives in place). The gate's green
 * is not thrown away when the verb runs the hook first and tells git not to run it again.
 *
 * **Right after `push`, not at position one.** The salvage push in `worktree prune` prefixes git's own
 * `-c core.hooksPath=/dev/null -c core.fsmonitor=false`, because a capture reading a worktree it is about to
 * delete must run no hook of that repository's. Inserting at position one put `--no-verify` where git reads
 * a global option, and requiring position zero refused the argv outright: MEASURED against
 * `~/dev/acme-admin`, where the salvage of `sdlc-backfill-within-graphql-budget` printed
 * `not a push argv: -c core.hooksPath=/dev/null …` and kept the worktree. Only repositories with an
 * executable `.husky/_/pre-push` reach this function at all, which is why the first tree of that same run
 * pushed and the second did not.
 *
 * @param gitArgs the plan's push argv, whose `push` may sit behind git's global options
 * @returns the same argv with `--no-verify` inserted directly after the `push` subcommand
 */
export function hookSatisfiedPushArgs({ gitArgs }: { gitArgs: readonly string[] }): readonly string[] {
  const at = pushVerbIndex({ gitArgs });
  if (at === null) {
    throw new Error(`not a push argv: ${gitArgs.join(" ")}`);
  }
  return [...gitArgs.slice(0, at + 1), "--no-verify", ...gitArgs.slice(at + 1)];
}

/**
 * Turn an unknown Git failure into one bounded refusal line.
 *
 * @param error whatever a Git edge threw
 * @returns the caught value's message, or its string form when it is not an `Error`
 */
export function gitFailureLine({ error }: { error: unknown }): string {
  return error instanceof Error ? error.message : String(error);
}

/** How a governed push ended: sent and read back as the same SHA, refused before or during, or unprovable. */
export type PushAndVerifyOutcome =
  { readonly kind: "pushed" } | { readonly kind: "failed" | "unconfirmed"; readonly reason: string };

/**
 * The push argv to send, once the repository's gate has had its turn.
 *
 * With a gate edge, the hook runs now — before any transport — and the push carries `--no-verify` so git does
 * not run it again inside an open connection. Without one, the plan's argv goes as it stands and git runs the
 * hook itself.
 */
function gatedPushArgs({
  plan,
  deps,
}: {
  plan: GithubPushPlan;
  deps: GithubPushEdges;
}): Result<readonly string[], GithubPushDoorError> {
  if (deps.prePushGate === undefined) {
    return ok(plan.gitArgs);
  }
  const gate = deps.prePushGate({ cwd: plan.repoRoot, remote: plan.remote, stdin: prePushHookStdin({ plan }) });
  if (gate.isErr()) {
    return err(GithubPushDoorErrors.pushGateRefused({ cause: gate.error.message }));
  }
  if (gate.value.kind === "no-hook") {
    deps.out({ line: `pre-push gate: no executable hook at ${gate.value.hook}; git pushes as it stands` });
    return ok(plan.gitArgs);
  }
  deps.out({ line: `pre-push gate: ${gate.value.hook} passed before the transport opened; pushing with --no-verify` });
  return ok(hookSatisfiedPushArgs({ gitArgs: plan.gitArgs }));
}

/**
 * Why nothing may be sent, judged before any transport opens: a dirty working tree, a commit of the history a
 * re-cut left behind, or a pull-request head that adds a proof path.
 *
 * @param plan the exact push plan
 * @param deps the Git edges
 * @param home the state home whose push-root register judges the target
 * @returns the refusal line, or undefined when the push may go
 */
function preSendRefusal({
  plan,
  deps,
  home,
}: {
  plan: GithubPushPlan;
  deps: GithubPushEdges;
  home: string;
}): string | undefined {
  const subject = refuseDirtyWorkingTree({ readGit: deps.readGit, repoRoot: plan.repoRoot });
  if (subject.isErr()) {
    return `${subject.error.message}; nothing was sent`;
  }
  const history = refuseOldHistoryPush({
    env: process.env,
    home,
    localShas: [plan.localSha],
    pushUrls: () => pushUrlsOf({ readGit: deps.readGit, remote: plan.remote, repoRoot: plan.repoRoot }),
    readGit: deps.readGit,
    repoRoot: plan.repoRoot,
  });
  if (history.isErr()) {
    return history.error.message;
  }
  if (plan.purpose !== "pull-request-head") {
    return undefined;
  }
  const proof = refuseProofPathHead({
    env: process.env,
    localSha: plan.localSha,
    readGit: deps.readGit,
    repoRoot: plan.repoRoot,
  });
  if (proof.isErr()) {
    return proof.error.message;
  }
  return undefined;
}

/**
 * Whether the remote now reports EXACTLY the commit that was sent, never git's own exit code.
 *
 * @param plan the push plan that was sent
 * @param deps the Git edges
 * @returns pushed, or why the push is unconfirmed
 */
function remoteReadBack({ plan, deps }: { plan: GithubPushPlan; deps: GithubPushEdges }): PushAndVerifyOutcome {
  try {
    const text = deps.readGit({
      args: ["ls-remote", plan.remote, `refs/heads/${plan.branch}`],
      cwd: plan.repoRoot,
    });
    if (text.length === 0) {
      return { kind: "unconfirmed", reason: `remote reported no SHA, expected ${plan.localSha}` };
    }
    // A non-empty string always splits into at least one element.
    const actual = text.split(/\s+/)[0]!;
    return actual === plan.localSha
      ? { kind: "pushed" }
      : { kind: "unconfirmed", reason: `remote reported ${actual}, expected ${plan.localSha}` };
  } catch (error: unknown) {
    return { kind: "unconfirmed", reason: gitFailureLine({ error }) };
  }
}

/**
 * Run the repository's pre-push gate, then the push, then read the remote ref back — in that order, so the
 * transport opens only once the gate is green and stays open for seconds rather than minutes.
 *
 * Every push in this repository goes through here: `github push`, the `stack push`/`adopt`/`sync` verbs that
 * build the same plan, and a worktree salvage. Success is the remote reporting EXACTLY the commit that was
 * sent, never git's own exit code.
 *
 * The old-history guard (`./pushRootGate.ts`) runs here directly, never only inside the hook: a salvage push
 * disables hooks, and a repository with no hook runs none. `home` is required for that reason — an optional one
 * would make the register's own omission a way past it.
 *
 * @param plan the exact push plan to perform
 * @param deps the Git edges, including the optional gate
 * @param home the state home whose push-root register judges the target
 * @returns pushed, or why it was not
 */
export function pushAndVerify({
  plan,
  deps,
  home,
}: {
  plan: GithubPushPlan;
  deps: GithubPushEdges;
  home: string;
}): PushAndVerifyOutcome {
  const refused = preSendRefusal({ deps, home, plan });
  if (refused !== undefined) {
    return { kind: "failed", reason: refused };
  }
  if (deps.prePushGate !== undefined) {
    deps.out({ line: "pre-push gate: running the repository's hook before any transport opens" });
  }
  const args = gatedPushArgs({ deps, plan });
  if (args.isErr()) {
    return { kind: "failed", reason: args.error.message };
  }
  const pushed = deps.writeGit({ args: args.value, cwd: plan.repoRoot });
  if (!pushed.isOk()) {
    return { kind: "failed", reason: pushed.error };
  }
  return remoteReadBack({ deps, plan });
}
