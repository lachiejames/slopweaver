/**
 * `slopweaver github push`'s production pre-push gate — running the repository's own `pre-push` hook exactly
 * as git would, BEFORE any transport exists.
 *
 * Its own module because the hook edge is a self-contained seam: `../../../admit/githubPush.ts`'s
 * `pushAndVerify` only ever holds the ORDER (gate, then push with `--no-verify`), and `./pushPrimitives.ts`
 * wires this function in as its `prePushGate`, while everything about how git invokes a hook lives here.
 */
import {
  type ExecFileSyncOptionsWithStringEncoding,
  execFileSync,
  type SpawnSyncReturns,
  spawnSync,
} from "node:child_process";
import { accessSync, constants } from "node:fs";
import { join, resolve } from "node:path";
import { outExact } from "#lib/logger.js";
import type { PrePushGateOutcome, PrePushGateRequest } from "../../../admit/githubPush.js";
import { killingSignalName } from "../../../admit/gitTransport.js";
import { stripGitEnv } from "../../../codex/gitRun.js";
import { isRecord } from "../../../lib/parsers.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { type GithubVerbError, GithubVerbErrors } from "./errors.js";

/**
 * How long the hook may run before it is stopped. The slowest this hook has ever been measured is the eight to
 * ten minutes `yarn validate` took (below), and a repository's hook is not this verb's to predict, so the bound
 * is three times that: a legitimate run never meets it, and a hook sat on a prompt nobody can answer (a
 * credential helper, an ssh passphrase on `/dev/tty`) ends instead of blocking the session — a synchronous
 * child blocks the event loop, so this bound is the only thing that can end one. SIGKILL, because a hook that
 * traps the default SIGTERM would outlive it.
 */
const HOOK_TIMEOUT_MS = 30 * 60_000;

/**
 * How long each local git read that locates the hook may take. Both are reads of `.git/config` and answer in
 * milliseconds; two minutes is a bound on a wedged repository (a FIFO config, a held lock), never on real work.
 */
const HOOK_LOCATE_TIMEOUT_MS = 2 * 60_000;

/**
 * The line lefthook's generated hook shim prints when no lefthook binary resolves — after which the shim exits 0,
 * the status of that `echo`, having run no gate at all. The template is lefthook's own, not this repository's,
 * and `.git/hooks` is shared by every worktree, so a worktree with no `node_modules` hits it. Reproduce: `git
 * worktree add <dir> origin/main`, commit anything there, then `slopweaver github push --cwd <dir>` — before this
 * check it printed this line, then "passed before the transport opened", and pushed `--no-verify`.
 */
const LEFTHOOK_RUNNER_MISSING_LINE = "Can't find lefthook in PATH";

/**
 * The most hook stdout the gate holds while the hook runs. It is captured, not inherited, so the runner-missing
 * line above can be read; a hook that overflows it is killed and REFUSED as unrunnable, never passed. A bound on a
 * runaway hook, not a measurement of a normal one: a repository's hook is not this verb's to predict, and Node's
 * own 1 MiB default would refuse a verbose but healthy gate.
 */
const HOOK_STDOUT_MAX_BYTES = 64 * 1024 * 1024;

/**
 * Whether the hook's stdout carries lefthook's runner-missing line as a whole line — never a substring, so a hook
 * that merely quotes the sentence is not refused.
 *
 * @param stdout everything the hook wrote to stdout
 * @returns true when a line is exactly the runner-missing line
 */
function hookReportedRunnerMissing({ stdout }: { readonly stdout: string }): boolean {
  return stdout.split(/\r?\n/).includes(LEFTHOOK_RUNNER_MISSING_LINE);
}

/**
 * Run the repository's `pre-push` hook exactly as git would — same argv, same stdin, same working directory,
 * stderr streamed to the visible session and stdout replayed to it once the hook ends — and nothing else. An exit
 * 0 is a pass only when stdout does not carry lefthook's runner-missing line: the shim exits 0 having run nothing.
 *
 * MEASURED: `git push` opens the ssh transport to DISCOVER the
 * remote's refs BEFORE it runs the pre-push hook, and sends the pack afterwards. A hook of
 * `yarn validate` takes eight to ten minutes; the lane `yarn validate:local` is narrowed to the five gates CI
 * cannot see the subject of and takes 43.5 s. A hook that long is far
 * longer than GitHub's idle timeout, so the
 * transport is dead by the time there is anything to send: `Connection to github.com closed by remote
 * host`, then `Connection reset by peer`, then SIGPIPE writing the pack — the second pair with client
 * keepalives (`ServerAliveInterval=30`) in place, which is why keepalives are no longer the fix. Running the
 * hook HERE, before any connection exists, and pushing `--no-verify` afterwards means a green gate is never
 * thrown away by the connection it was supposed to precede. The ordering survives the lane getting short:
 * 43.5 s is still longer than an idle transport is guaranteed, and the hook's cost is not this verb's to
 * predict.
 *
 * The hook is found the way git finds it — `git rev-parse --git-path hooks`, which honours `core.hooksPath`
 * and, in a linked worktree, resolves to the shared `.git/hooks` — and is skipped when git would skip it
 * (absent, or not executable). `GIT_*` is stripped rather than mirrored: git exports `GIT_DIR` to a hook it
 * runs itself, and that variable has overridden an explicit `cwd` in four recorded incidents in this tree
 * (`gitAncestry.ts`, `../../../admit/gitTransport.ts`'s `readGit`); the hook sees a clean environment and resolves the
 * repository from its working directory, which is the only thing it should have been doing anyway.
 *
 * @param cwd the repository root, which is the directory git runs a hook from
 * @param remote the remote's configured name, the hook's first argv
 * @param stdin the ref line git would feed the hook
 * @returns whether a hook was there to run — naming the path consulted either way — or why the attempt never
 *   reached a verdict
 */
export function runPrePushGate({
  cwd,
  remote,
  stdin,
}: {
  readonly cwd: PrePushGateRequest["cwd"];
  readonly remote: PrePushGateRequest["remote"];
  readonly stdin: PrePushGateRequest["stdin"];
}): Result<PrePushGateOutcome, GithubVerbError> {
  const env = stripGitEnv({ env: process.env });
  const locate = {
    cwd,
    encoding: "utf8",
    env,
    killSignal: "SIGKILL",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: HOOK_LOCATE_TIMEOUT_MS,
  } satisfies ExecFileSyncOptionsWithStringEncoding;
  let hook: string;
  let remoteUrl: string;
  try {
    hook = join(resolve(cwd, execFileSync("git", ["rev-parse", "--git-path", "hooks"], locate).trim()), "pre-push");
    // `--push`, because a plain `git push` hands its hook the PUSH url, and a `pushurl` that differs from the
    // fetch url is exactly where the old-history guard's `{2}` would otherwise judge the wrong repository.
    remoteUrl = execFileSync("git", ["remote", "get-url", "--push", remote], locate).trim();
  } catch (error: unknown) {
    return err(GithubVerbErrors.hookUnlocated({ cause: error instanceof Error ? error.message : String(error) }));
  }
  try {
    accessSync(hook, constants.X_OK);
  } catch {
    return ok({ hook, kind: "no-hook" });
  }
  return runLocatedHook({ argv: [remote, remoteUrl], cwd, env, hook, stdin });
}

/**
 * Run a hook already found executable and read its verdict. stdout is CAPTURED, so the runner-missing line can be
 * read, then replayed whole to the session; stderr stays live. A replay that throws (a closed stdout) never
 * escapes: a refusal stays that refusal, and a pass becomes a refusal, because output nobody saw is no pass.
 *
 * @param argv the hook's argv, `<remote name> <remote url>`
 * @param env the environment with every `GIT_*` selector stripped
 * @returns ran, only for an exit 0 that did not report lefthook missing; otherwise why it reached no pass
 */
function runLocatedHook({
  argv,
  cwd,
  env,
  hook,
  stdin,
}: {
  readonly argv: readonly string[];
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
  readonly hook: string;
  readonly stdin: string;
}): Result<PrePushGateOutcome, GithubVerbError> {
  const result = spawnSync(hook, argv, {
    cwd,
    encoding: "utf8",
    env,
    input: stdin,
    maxBuffer: HOOK_STDOUT_MAX_BYTES,
    stdio: ["pipe", "pipe", "inherit"],
    killSignal: "SIGKILL",
    timeout: HOOK_TIMEOUT_MS,
  });
  const verdict = hookVerdict({ hook, result });
  if (typeof result.stdout !== "string") {
    return verdict;
  }
  try {
    outExact({ text: result.stdout });
  } catch (error: unknown) {
    if (verdict.isErr()) {
      return verdict;
    }
    const cause = `its stdout could not be replayed: ${error instanceof Error ? error.message : String(error)}`;
    return err(GithubVerbErrors.hookUnrunnable({ cause, hook }));
  }
  return verdict;
}

/**
 * What one finished hook run means for the push.
 *
 * @param hook the hook path, named in every refusal
 * @param result what `spawnSync` returned, stdout captured as text
 * @returns ran, only for an exit 0 whose stdout does not report lefthook missing; otherwise why it is no pass
 */
function hookVerdict({
  hook,
  result,
}: {
  readonly hook: string;
  readonly result: SpawnSyncReturns<string>;
}): Result<PrePushGateOutcome, GithubVerbError> {
  // Node reports a child killed at its bound as `code: "ETIMEDOUT"` on `result.error`, ahead of the signal.
  if (isRecord(result.error) && result.error["code"] === "ETIMEDOUT") {
    return err(GithubVerbErrors.hookTimedOut({ hook, timeoutMs: HOOK_TIMEOUT_MS }));
  }
  if (result.error !== undefined) {
    return err(GithubVerbErrors.hookUnrunnable({ cause: result.error.message, hook }));
  }
  if (typeof result.stdout !== "string") {
    return err(GithubVerbErrors.hookUnrunnable({ cause: "its stdout was not captured", hook }));
  }
  if (result.status === 0 && hookReportedRunnerMissing({ stdout: result.stdout })) {
    return err(GithubVerbErrors.hookRunnerMissing({ hook }));
  }
  if (result.status === 0) {
    return ok({ hook, kind: "ran" });
  }
  if (result.status === null) {
    return err(GithubVerbErrors.hookKilled({ hook, signal: killingSignalName({ result }) }));
  }
  return err(GithubVerbErrors.hookExited({ hook, status: result.status }));
}
