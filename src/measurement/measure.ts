/**
 * Measuring a workstream — the read-only shell every field on the pane comes from.
 *
 * Nothing here writes and nothing here caches. Each function shells one read-only command and turns both the
 * answer and the FAILURE into a {@link ./status.Measured} value, so a `gh` that is not authenticated
 * prints "NOT MEASURED — …" on the pane rather than vanishing from it.
 *
 * That mapping is the entire reason this file exists rather than the callers doing it: a `catch` that returns a
 * zero or a `false` is how a board starts lying, and it is the exact shape the derived-status design was built
 * to remove. Every catch below produces a REASON.
 */

import { execFileSync } from "node:child_process";

import { absentAs } from "#lib/absent.js";
import { gitEnv } from "../lib/gitRepo.js";
import { isRecord } from "../lib/parsers.js";
import { type CheckRollup, type GitFacts, type Measured, measured, type PrFacts, unmeasurable } from "./status.js";

/** Plenty for a branch listing or a PR view, and a bound rather than an unbounded pipe. */
const MAX_BUFFER = 4 * 1024 * 1024;

/** How long any one measurement may block. A pane that hangs is a pane nobody opens. */
const MEASURE_TIMEOUT_MS = 20_000;

/**
 * Run a read-only command, returning its stdout or the reason it produced none.
 *
 * Exported so the console's own collectors shell out the same way this module does — same timeout, same
 * buffer bound, same `gitEnv`, and the same failure sentence naming the command that failed. A second
 * hand-rolled runner would drift on exactly those four things, and the reason string is what the pane prints
 * when a measurement does not happen.
 *
 * @param command the executable to run
 * @param args its arguments
 * @param cwd the directory to run it from
 * @param extraEnv variables layered over the inherited environment, for a per-invocation credential
 * @returns the trimmed stdout, or the reason there is none
 */
export function readCommand({
  command,
  args,
  cwd,
  extraEnv,
}: {
  command: string;
  args: readonly string[];
  cwd: string;
  extraEnv?: Readonly<Record<string, string>>;
}): Measured<string> {
  try {
    return measured({
      value: execFileSync(command, [...args], {
        cwd,
        encoding: "utf8",
        // Layered rather than replacing: the console queries two repositories that need two DIFFERENT GitHub
        // accounts, and `gh auth switch` is global state a long-running server must not mutate under other
        // sessions. A per-invocation `GH_TOKEN` scopes the credential to one call.
        env: { ...gitEnv(), ...extraEnv },
        maxBuffer: MAX_BUFFER,
        stdio: ["ignore", "pipe", "pipe"],
        timeout: MEASURE_TIMEOUT_MS,
      }).trim(),
    });
  } catch (error: unknown) {
    return unmeasurable({ why: commandFailure({ args, command, error }) });
  }
}

/** How a collector runs one read-only command: {@link readCommand} in production, a plain fake in a unit test. */
export type CommandReader = (call: Parameters<typeof readCommand>[0]) => Measured<string>;

/** One sentence naming the command and what it said, so the pane's reason is actionable. */
function commandFailure({
  command,
  args,
  error,
}: {
  command: string;
  args: readonly string[];
  error: unknown;
}): string {
  const stderr = isRecord(error) ? error["stderr"] : undefined;
  const detail = typeof stderr === "string" && stderr.trim().length > 0 ? stderr.trim().split("\n")[0] : undefined;
  const called = `${command} ${args.join(" ")}`;
  return detail === undefined ? `\`${called}\` failed` : `\`${called}\` failed: ${detail.slice(0, 160)}`;
}

/**
 * What git says about one workstream's worktree.
 *
 * The BRANCH is read from the worktree rather than taken from the doc, deliberately. The doc's `branch:` is
 * what the author intended; `git branch --show-current` is what the agent is actually committing to, and the
 * pane's whole job is to report the second.
 *
 * @param worktree the directory the agent works in
 * @param base the branch commits are counted against, or `undefined` to resolve this repository's own trunk
 * @returns the measured git facts, or the reason there are none
 */
export function measureGit({ worktree, base }: { worktree: string; base: string | undefined }): Measured<GitFacts> {
  const branch = readCommand({ args: ["branch", "--show-current"], command: "git", cwd: worktree });
  if (!branch.known) {
    return unmeasurable({ why: branch.why });
  }
  if (branch.value.length === 0) {
    return unmeasurable({ why: `${worktree} is not on a branch (detached HEAD), so nothing can be counted` });
  }
  const trunk = base === undefined ? resolveTrunk({ worktree }) : measured({ value: base });
  if (!trunk.known) {
    return unmeasurable({ why: trunk.why });
  }
  const ahead = readCommand({
    args: ["rev-list", "--count", `${trunk.value}..HEAD`],
    command: "git",
    cwd: worktree,
  });
  if (!ahead.known) {
    return unmeasurable({ why: ahead.why });
  }
  const dirty = readCommand({ args: ["status", "--porcelain"], command: "git", cwd: worktree });
  if (!dirty.known) {
    return unmeasurable({ why: dirty.why });
  }
  return measured({
    value: {
      branch: branch.value,
      commitsAhead: countOf({ text: ahead.value }),
      dirtyFiles: dirty.value.length === 0 ? 0 : dirty.value.split("\n").length,
      // `ls-remote` rather than a local `origin/<branch>` ref: a stale remote-tracking ref reports a branch as
      // pushed for as long as nobody fetches, and "is it on the remote" is a completion condition.
      onRemote: remoteHasBranch({ branch: branch.value, worktree }),
      tree: worktree,
    },
  });
}

/**
 * A repository's own trunk, read from the remote's recorded default branch.
 *
 * ## Why this is not a constant
 *
 * `main` was hard-coded as the base for every doc on the board, and the board spans more than one
 * repository. Measured: a repository whose trunk is not `main` had its ENTIRE git and pull-request
 * half reported as `NOT MEASURED — 'main..HEAD': unknown revision`, for a run whose pull requests were
 * already merged. One global `--base` cannot describe two trunks at once.
 *
 * ## It is a LOCAL read, deliberately
 *
 * `refs/remotes/origin/HEAD` is a ref this clone already holds, so this adds no network call to a path that
 * measures local facts first. Asking the remote would turn a locally answerable question — how far ahead is
 * this branch — into one that fails offline.
 *
 * The ref is not guaranteed to exist: it is written at clone time and can be absent on a repository that was
 * initialised locally or fetched narrowly. That case reports the reason and names the fix, rather than
 * guessing a trunk and silently counting commits against the wrong one.
 *
 * @param worktree the directory to resolve the trunk for
 * @returns the trunk's branch name, or the reason it could not be established
 */
export function resolveTrunk({ worktree }: { worktree: string }): Measured<string> {
  // NOT `--short`. Its shortening is itself ambiguity-sensitive: with a `refs/tags/origin/main` present it
  // renders `refs/remotes/origin/main` as `remotes/origin/main`, which then reads as a branch of that name.
  // The full form is stable whatever else the repository holds.
  const head = readCommand({
    args: ["symbolic-ref", "refs/remotes/origin/HEAD"],
    command: "git",
    cwd: worktree,
  });
  if (!head.known) {
    return unmeasurable({
      why:
        `this repository's trunk could not be read (${head.why.trim()}) — ` +
        "`git remote set-head origin --auto` records it, or pass `--base <branch>`",
    });
  }
  // `refs/remotes/origin/main` → `main`, so the range reads against LOCAL history, which is what an
  // ahead-count is asking about. An exact prefix match only: anything else is not a branch of that remote.
  const prefix = "refs/remotes/origin/";
  if (!head.value.startsWith(prefix)) {
    return unmeasurable({
      why: `\`refs/remotes/origin/HEAD\` in ${worktree} points at ${head.value}, which is not a branch of origin`,
    });
  }
  const short = head.value.slice(prefix.length);
  if (short.length === 0) {
    return unmeasurable({ why: `\`refs/remotes/origin/HEAD\` in ${worktree} resolved to an empty branch name` });
  }
  return qualify({ short, worktree });
}

/**
 * The trunk as a FULLY QUALIFIED ref.
 *
 * A bare `staging` is ambiguous: git resolves `refs/tags/staging` ahead of `refs/heads/staging`, so a tag
 * sharing the trunk's name silently counts against the wrong commit. Git prints a warning and these callers
 * do not read stderr, so the wrong number arrives looking measured — found by an adversarial review pass
 * before this shipped.
 *
 * The local branch is preferred and the remote-tracking ref is the fallback, for a narrow clone that never
 * created a local trunk branch. Neither existing is reported rather than guessed.
 *
 * @param short the unqualified branch name
 * @param worktree the directory to resolve against
 * @returns the qualified ref, or the reason neither candidate exists
 */
function qualify({ short, worktree }: { short: string; worktree: string }): Measured<string> {
  const candidates = [`refs/heads/${short}`, `refs/remotes/origin/${short}`];
  for (const ref of candidates) {
    const found = readCommand({ args: ["rev-parse", "--verify", "--quiet", ref], command: "git", cwd: worktree });
    if (found.known && found.value.length > 0) {
      return measured({ value: ref });
    }
  }
  return unmeasurable({
    why: `this repository names its trunk "${short}", but neither ${candidates.join(" nor ")} exists in ${worktree}`,
  });
}

/** A `--count` line as a number, or 0 when git said something unparseable. */
function countOf({ text }: { text: string }): number {
  const parsed = Number.parseInt(text, 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Whether the remote carries this branch. A failed lookup answers false, and the caller states why. */
function remoteHasBranch({ worktree, branch }: { worktree: string; branch: string }): boolean {
  const listed = readCommand({
    args: ["ls-remote", "--heads", "origin", `refs/heads/${branch}`],
    command: "git",
    cwd: worktree,
  });
  return listed.known && listed.value.length > 0;
}

/**
 * What the pull request for a branch says, including its check rollup.
 *
 * A branch with no PR is a KNOWN `null`, not a failure — it is the normal state of work in progress, and
 * conflating it with "gh could not answer" would hide an auth problem behind an ordinary fact.
 *
 * @param worktree the directory to run `gh` from, which is what resolves the repository
 * @param branch the head branch to look up
 * @returns the PR facts, `null` when there is none, or the reason nothing could be asked
 */
export function measurePr({ worktree, branch }: { worktree: string; branch: string }): Measured<PrFacts | null> {
  const viewed = readCommand({
    args: ["pr", "view", branch, "--json", "number,isDraft,state,statusCheckRollup"],
    command: "gh",
    cwd: worktree,
  });
  if (!viewed.known) {
    // `gh pr view` exits non-zero for "no pull requests found", which is a fact rather than a fault. It is
    // distinguished on the message because that is the only signal gh gives; every other failure keeps its
    // reason, so an unauthenticated gh can never masquerade as "no PR yet".
    return /no pull requests found|no open pull requests/i.test(viewed.why)
      ? measured({ value: null })
      : unmeasurable({ why: viewed.why });
  }
  return prFactsOf({ json: viewed.value });
}

/** Decode `gh pr view --json`, keeping a shape surprise as a reason rather than a crash. */
function prFactsOf({ json }: { json: string }): Measured<PrFacts | null> {
  let payload: unknown;
  try {
    payload = JSON.parse(json);
  } catch {
    return unmeasurable({ why: "`gh pr view --json` returned output that is not JSON" });
  }
  if (!isRecord(payload)) {
    return unmeasurable({ why: "`gh pr view --json` returned no object" });
  }
  const record = payload;
  const number = record["number"];
  if (typeof number !== "number") {
    return unmeasurable({ why: "`gh pr view --json` returned no pull-request number" });
  }
  if (record["state"] !== "OPEN") {
    // A closed or merged PR is not the drive's PR any more. Reported as "none open" so a completion check
    // cannot be satisfied by a pull request somebody closed.
    return measured({ value: null });
  }
  const rollup = checkRollupOf({ value: record["statusCheckRollup"] });
  return measured({
    value: { failing: rollup.failing, isDraft: record["isDraft"] === true, number, rollup: rollup.state },
  });
}

/** The conclusions `gh` reports for a check that has finished and did not pass. */
const FAILED_CONCLUSIONS: ReadonlySet<string> = new Set(["FAILURE", "TIMED_OUT", "CANCELLED", "ACTION_REQUIRED"]);

/**
 * Fold `statusCheckRollup` into one verdict plus the names that failed.
 *
 * `pending` outranks `green` and `failing` outranks everything: a rollup with one red check is failing however
 * many passed, and a rollup still running is not yet green however good it looks. Both directions matter,
 * because this verdict is a completion condition — and it is the condition that would have caught the pull
 * request whose unit tests went red on the very commit its agent reported as done.
 *
 * Exported and pure so a test asserts the folding exactly, without a network or a `gh`.
 *
 * @param value the raw `statusCheckRollup` field as `gh` produced it
 * @returns the verdict plus the names of the checks that failed
 */
export function checkRollupOf({ value }: { value: unknown }): {
  state: CheckRollup;
  failing: readonly string[];
} {
  if (!Array.isArray(value)) {
    return { failing: [], state: "unknown" };
  }
  if (value.length === 0) {
    return { failing: [], state: "none" };
  }
  const checks = value.filter(
    (entry: unknown): entry is Record<string, unknown> => entry !== null && typeof entry === "object",
  );
  const failing = checks.filter((check) => FAILED_CONCLUSIONS.has(field({ check, key: "conclusion" }))).map(nameOf);
  // A check with no `status` at all is treated as FINISHED, because that is what `gh` reports for the legacy
  // commit-status shape. It is a real decision rather than a default: reading an absent status as still-running
  // would leave a rollup of legacy statuses permanently `pending`, and `pending` blocks completion.
  const pending = checks.filter((check) => statusOf({ check }) !== "COMPLETED").length;
  if (failing.length > 0) {
    return { failing, state: "failing" };
  }
  return { failing: [], state: pending > 0 ? "pending" : "green" };
}

/** One string field of a check, or the empty string — `gh` is JSON, so a non-string here is shape drift. */
function field({ check, key }: { check: Record<string, unknown>; key: string }): string {
  const value = check[key];
  return typeof value === "string" ? value : "";
}

/** A check's run status, defaulting to finished for the legacy commit-status shape that carries none. */
function statusOf({ check }: { check: Record<string, unknown> }): string {
  const value = check["status"];
  return typeof value === "string" ? value : "COMPLETED";
}

/** A check's display name, falling back to something printable rather than to nothing. */
function nameOf(check: Record<string, unknown>): string {
  const named = ["name", "context", "workflowName"]
    .map((key) => field({ check, key }))
    .find((value) => value.length > 0);
  return absentAs({ value: named, whenAbsent: "(unnamed check)" });
}

/**
 * Whether an agent process is still running.
 *
 * `process.kill(pid, 0)` sends no signal and only asks. EPERM is treated as ALIVE, which is the honest
 * reading: the process exists and belongs to somebody else, so "gone" would be a wrong answer.
 *
 * @param pid the process id recorded at launch
 * @returns true when the process exists
 */
export function isAlive({ pid }: { pid: number }): boolean {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (error: unknown) {
    return isRecord(error) && error["code"] === "EPERM";
  }
}
