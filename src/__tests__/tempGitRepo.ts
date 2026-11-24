/**
 * The ONLY sanctioned way for a test to run git.
 *
 * ## The incident this exists for
 *
 * Git exports `GIT_DIR` and `GIT_WORK_TREE` into hook processes, and **those override `cwd`**. A test doing
 * `execFileSync("git", ["checkout", "-b", "some-branch"], { cwd: tempDir })` therefore ignores `tempDir`
 * when the suite runs under a hook. The `pre-push` hook no longer runs the suite (it runs
 * `yarn validate:local`, which has no test lane), so that is now a hand-run `yarn validate` — still real.
 *
 * That is not hypothetical. That exact line once ran against the real repository: it created a
 * branch called `some-branch`, moved the active worktree onto it, and left 35 fixture commits named `seed`,
 * `work` and `attrs` on the PR branch. The rebase failed trying to apply a commit called `seed`, which is
 * how anyone found out.
 *
 * `src/codex/gitDiff.ts` had stripped the environment for precisely this reason since before the incident,
 * and recorded that it was found the same way. Test code simply bypassed it.
 *
 * ## Two layers, because remembering is not a mechanism
 *
 *  1. **The environment is stripped**, so `cwd` decides which repository is read — the same guarantee
 *     `src/codex/gitRun.ts` gives production code.
 *  2. **The target is asserted to live under the OS temp directory** before any command runs. This is the
 *     layer that actually matters: it holds even if layer 1 is defeated by something nobody predicted, and
 *     it converts "wrote to the real repo" from a silent catastrophe into a thrown error naming the path.
 *
 * A `devLint` check (`git-in-tests`) refuses any other way of invoking git from a test, so this cannot be
 * quietly routed around by the next person in a hurry.
 *
 * Deliberately ONLY the git door. Creating the directory and writing fixture files stay in each suite: a
 * helper that also owned those would be a second fixture framework, and the hazard here is git specifically.
 */

import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { stripGitEnv } from "../codex/gitRun.js";

/**
 * The environment with every `GIT_*` variable removed, then the operator's global and system git config switched
 * off, so a fixture is built the same on every machine. Computed once; `process.env` does not change here.
 *
 * The two pins go AFTER the strip, which would otherwise remove them. MEASURED on a Mac whose `~/.gitconfig` sets
 * `core.autocrlf input`: `pruneBranchSafety.test.ts`'s line-ending case committed its trunk's `y\r\n` as `y\n`, so
 * branch and trunk held one blob and it failed every run, 28/29 alone and 29/29 with `HOME` pointed at an empty
 * directory. Reproduce: `git config --global core.autocrlf input`, then run that file with this pin removed.
 *
 * Automatic maintenance and `gc --auto` are switched off too. A `git commit` hands them to a DETACHED process that
 * takes and drops a lock under `.git/objects` after the commit has returned, so a seeded template copied straight
 * after its commit can lose a file under `cpSync`: on hosted CI `checkoutLandingFloor.test.ts` failed once with
 * ENOENT on its copy's `.git/objects`, in a shard that passed unchanged the run before. A fixture needs neither job.
 */
const CLEAN_ENV = {
  ...stripGitEnv({ env: process.env }),
  GIT_CONFIG_COUNT: "2",
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_KEY_0: "maintenance.auto",
  GIT_CONFIG_KEY_1: "gc.auto",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_CONFIG_VALUE_0: "false",
  GIT_CONFIG_VALUE_1: "0",
};

/**
 * Refuse to run git anywhere but a temporary directory.
 *
 * `realpathSync` on both sides because macOS reports `/var/folders/...` while `os.tmpdir()` returns the
 * `/private/var/...` it symlinks to; comparing the raw strings would reject every legitimate temp path and
 * teach the next reader to delete this check.
 */
function assertTemporary({ cwd }: { cwd: string }): void {
  const target = realpathSync(resolve(cwd));
  const temp = realpathSync(tmpdir());
  if (!target.startsWith(`${temp}/`) && target !== temp) {
    throw new Error(
      `refusing to run git outside the temp directory: ${target} is not under ${temp}. ` +
        "A test must never touch a real repository — see src/__tests__/tempGitRepo.ts.",
    );
  }
}

/**
 * The timeout every suite that shells out to real `git` runs under.
 *
 * A single test here spawns a dozen git processes — `init`, three `config`s, `add`, `commit`, `checkout`,
 * then the capture's own four or five invocations — and each one is a process launch, not a function call.
 * That comfortably exceeds vitest's 5s default whenever the machine is busy, which under `yarn validate`
 * (3,000 tests plus coverage instrumentation) it always is.
 *
 * Measured rather than guessed: these suites flaked on FOUR separate full-gate runs, every time as
 * `Test timed out in 5000ms`, on a different test each time, while passing 29/29 in isolation. That
 * signature — different victim each run, green when run alone — is load, not a defect in the code.
 *
 * Lives here rather than in each file so a suite added later cannot forget it, and applied at `describe`
 * level so a new test inside an existing suite cannot either.
 *
 * **It must never sit BELOW the subprocess lane's own `testTimeout`, and it did.** This constant predates
 * that lane default and was written to RAISE a 5s budget; once `config/vitest/subprocess.ts` set 60s for
 * every file, a `describe` applying 30_000 silently HALVED the ceiling for the handful of suites that name
 * it — the opposite of what it exists for. MEASURED: a pre-push gate on this machine at load
 * average 21.7 failed `stackSquash.test.ts` with `Test timed out in 30000ms`, in a lane whose own default
 * was 60s and whose docstring already records this exact class ("a different victim each run is the
 * signature of the lane starving itself, not a hang"). So the two are now the same number, and raising the
 * lane's default without raising this one would re-open the same gap.
 *
 * **And naming it does not buy a suite the lane it belongs in.** MEASURED on a clean
 * tree: two suites naming this constant from the UNIT lane died anyway on `Test timed out in 60000ms`, four
 * of those failures in `stackSubmitRealGit.test.ts` alone — its "pushes every branch in order and confirms
 * each one on the remote" at 69,597ms and its "refuses a branch whose lease no longer holds" at 88,421ms,
 * that one file spending 313s of test time — while both files pass standalone in seconds (2 files, 12 tests,
 * 9.00s wall at load average 7.56). The budget was never the missing piece:
 * `config/vitest/subprocess.ts` ALSO caps `maxWorkers` at 4 off CI and grants `retry: 1`, and
 * `config/vitest/unit.ts` has neither, so a real-git suite parked on the unit lane gets this constant and
 * none of the contention remedies it was measured beside. Both files now sit in
 * `src/__tests__/subprocess/cli/commands/github/`. What is left is ranked, not cleared — reproduce with
 * `for f in $(grep -rln gitInTemp src/__tests__/unit/); do echo "$(grep -c 'gitInTemp(' $f) $f"; done | sort -rn`
 * — and the tail's suites are unmeasured rather than known good. The `src/__tests__/unit/worktree/` family is
 * the one exception that stays, and {@link REAL_GIT_SUITE} says why and what it runs under instead.
 */
export const REAL_GIT_TIMEOUT_MS = 60_000;

/** Vitest's whole timeout message for a test or a hook at {@link REAL_GIT_TIMEOUT_MS}, anchored at both ends. */
const REAL_GIT_TIMED_OUT = new RegExp(
  `^(?:Test timed out in ${String(REAL_GIT_TIMEOUT_MS)}ms\\.\\nIf this is a long-running test, pass a timeout value as the last argument or configure it globally with "testTimeout"\\.|Hook timed out in ${String(REAL_GIT_TIMEOUT_MS)}ms\\.\\nIf this is a long-running hook, pass a timeout value as the last argument or configure it globally with "hookTimeout"\\.)$`,
  "u",
);

/**
 * What a real-git suite still on the UNIT lane runs under: this file's 60s budget, and one retry that fires on a
 * TIMEOUT alone — so an assertion that fails stays red on its first attempt, exactly as it would without this.
 * A `describe` passes it as its options; a hook that spawns git passes {@link REAL_GIT_TIMEOUT_MS} as its own
 * timeout, because a suite's `timeout` never reaches a hook.
 *
 * **The 60s is vitest's budget, so it is a classification made when the work RETURNS, not a wall-clock bound.**
 * Vitest's timer cannot fire while a synchronous git child runs: a 75s call is called timed out only once it
 * returns, and a wedged child holds the worker exactly as it did under the lane's 20s. That is what the measured
 * stall needs, because every one returned. Bounding the child itself is `gitInTemp`'s business, and it reaches every
 * real-git unit file in the lane rather than this family (a Codex pre-mortem's finding). So is the rest
 * of that lane: a file outside this directory still runs on 20s, so a green family is no proof the whole lap is.
 *
 * **Why these suites stay on the unit lane rather than moving to `src/__tests__/subprocess/`**, which the
 * paragraph above names as their home: the coverage floor is read from the UNIT lane alone, and the 21 real-git
 * files under `src/__tests__/unit/worktree/` carry 614 of `src/worktree`'s 2,996 statements. MEASURED:
 * `yarn vitest run --config config/vitest/unit.ts src/__tests__/unit/worktree/ --coverage
 * --coverage.include='src/worktree/**' --coverage.reporter=json-summary` gives 90.35% with every file and 69.85%
 * with those 21 excluded, against the directory's 84.12 floor in `coverage-baseline.json`. Moving them means
 * lowering that floor, which the pull request doing the move may not decide (`src/devLint/baselineRegistry.ts`).
 * The worker cap the subprocess lane adds is already on every local lap, which runs each unit shard with
 * `--maxWorkers=4`, and is deliberately absent on CI for that lane too.
 *
 * **The failure it answers.** On a loaded local lap, the FIRST real-git test of a file absorbed a
 * window in which every spawn was slow, and the file then ran at normal speed: `reclaimTrash.test.ts`'s first
 * removal took 26,230ms and 26,234ms on the two runs of one shard, the next test 12-14s and every later one
 * 0.3-1.4s, while `pruneBranchSafety.test.ts` and `pruneReclaim/detachedTree.test.ts` failed the same way at
 * 20.6s and 23.4s. Each passes standalone in 1-3s. In a seat, two runs of this directory alone at the default
 * worker count failed three tests and then one — `pruneReclaim/dropDeps.test.ts`, a fourth victim — which is
 * this file's own "different victim each run" signature, so the remedy covers the whole family rather than
 * the files caught so far. `src/__tests__/unit/worktree/realGitSuites.test.ts` refuses a real-git suite in that
 * directory that does not name this constant.
 *
 * **The condition is vitest's WHOLE timeout message, anchored at both ends**, because vitest throws a timeout as a
 * plain `Error` and a RegExp condition tests nothing but its `message` (`makeTimeoutError` and
 * `passesRetryCondition` in `@vitest/runner`). Unanchored, `expect.fail("Test timed out in 60000ms")` was retried
 * (the r1 Codex review). A FUNCTION condition reading the error's `name` would also refuse an assertion spelling
 * the whole text (the r2 review), but vitest 4.1.12 drops a function condition from `describe` options and then
 * retries EVERYTHING — MEASURED, a `describe(…, { retry: { condition: fn, count: 1 } }, …)` case
 * printing `JSON.stringify(task.retry)` read `{"count":1}` and its `expect.fail` ran twice. So the residue is a
 * failure spelling both lines verbatim: it is retried once. A deterministic one fails again; only a test that
 * changes its own behaviour between attempts can be retried into a pass that way (the r3 Codex review).
 */
export const REAL_GIT_SUITE: {
  readonly retry: { readonly count: number; readonly condition: RegExp };
  readonly timeout: number;
} = {
  retry: { condition: REAL_GIT_TIMED_OUT, count: 1 },
  timeout: REAL_GIT_TIMEOUT_MS,
};

/**
 * The ONE sanctioned door for running git in a test.
 *
 * @param cwd the fixture directory — asserted to be under the OS temp dir before anything runs, so a
 *   mistyped path cannot reach the real repository
 * @param args the git argv
 * @param input what to write to the command's stdin, for the verbs that read their work from there
 *   (`update-index --index-info`, `cat-file --batch`) and refuse to take it any other way. A `Buffer` is
 *   accepted because a git PATHNAME is bytes and need not be valid UTF-8 — stdin is the only channel that
 *   can carry such a name, since Node encodes argv as UTF-8
 * @returns the command's trimmed stdout
 */
export function gitInTemp({
  cwd,
  args,
  input = "",
}: {
  cwd: string;
  args: readonly string[];
  input?: string | Buffer;
}): string {
  assertTemporary({ cwd });
  return execFileSync("git", [...args], { cwd, encoding: "utf8", env: CLEAN_ENV, input }).trim();
}
