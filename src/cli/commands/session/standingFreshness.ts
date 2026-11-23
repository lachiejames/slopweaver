/**
 * Assembling one standing session's freshness for a CLI verb — the join between the live-state readers each
 * standing session already has and `live/standing/`'s measurement.
 *
 * Shared by `session standing` and `listen status` on purpose: the doc that
 * commissioned this asked all three to report the same thing, and three call sites deriving "which trees is
 * this session on" separately is exactly how two of them end up answering differently about the same session.
 *
 * Whether each session is ALIVE is `../../../live/standing/sessionLiveness.ts`; this joins that to the
 * measurement of which commit it runs.
 */
import { KEEP_ALIVE_CHAIN_PATHS, KEEP_ALIVE_SESSION } from "../../../claude/watchSession.js";
import { logger } from "../../../lib/logger.js";
import type { StandingSessionFreshness } from "../../../live/standing/freshness.js";
import {
  checkoutIdentityOnDisk,
  measureStandingFreshness,
  type StandingInspectDeps,
  type StandingTreeTarget,
  standingTreeTargets,
  supervisorTreeTargets,
} from "../../../live/standing/inspect.js";
import { type ClaudeWatchProcess, pluginDirAmong } from "../../../live/standing/processes.js";
import { loopUnmeasuredCause, type UnmeasuredCause } from "../../../live/standing/respawn.js";
import { readPendingLoopRespawn } from "../../../live/standing/respawnStore.js";
import type { LoopLiveness } from "../../../live/standing/sessionLiveness.js";
import { SUPERVISOR_CHAIN_PATHS, SUPERVISOR_SESSION } from "../../../live/standing/supervisor.js";

/** The standing session, named once so a label, an event and a respawn verb cannot disagree. */
export const LOOP_SESSION = "loop";
// The credential keep-alive loop's name, `KEEP_ALIVE_SESSION`, is declared in `claude/watchSession.ts`
// beside the record it grades, for the same reason the supervisor's is declared under `live/standing/`.
// The third standing session's name — the owner's single intake chat, and the main checkout it runs its CLI
// out of — is declared in `live/standing/supervisor.ts` rather than beside the two above, because
// `live/standing/streamEvents.ts` needs it to pick the right remedy and `live/` never imports out of `cli/`.

/** One standing session's freshness, plus everything that could not be read while measuring it. */
export interface StandingFreshnessResult {
  readonly freshness: StandingSessionFreshness | undefined;
  readonly problems: readonly string[];
}

/**
 * Measure the loop's two trees, anchored on its listener pid.
 *
 * @param deps the git/process read seams
 * @param pid the armed listener's pid, or `undefined` when nothing is armed
 * @param fallbackBin the ledger's recorded worktree, used for `bin` only when the pid names none
 * @returns the graded freshness, or `undefined` with a problem when there is no pid to anchor on
 */
export function loopFreshness({
  deps,
  pid,
  fallbackBin,
  pluginDirPids = [],
}: {
  readonly deps: StandingInspectDeps;
  readonly pid: number | undefined;
  readonly fallbackBin: string | undefined;
  readonly pluginDirPids?: readonly number[];
}): StandingFreshnessResult {
  const processes = deps.processes();
  const targets = standingTreeTargets({
    fallbackBin,
    pid,
    pluginDir: pluginDirAmong({ pids: pluginDirPids, processes }),
    processes,
  });
  if (targets.length === 0) {
    return {
      freshness: undefined,
      problems: [
        "loop freshness: nothing to measure — no armed listener pid and no recorded worktree, so which commit " +
          "the loop is running is UNKNOWN rather than current",
      ],
    };
  }
  return measureStandingFreshness({ deps, session: LOOP_SESSION, targets });
}

/**
 * The loop's freshness as `session respawn loop` reads it: {@link loopFreshness}, plus why it came back empty.
 *
 * The pending-respawn record is read only when the grade is empty. An unreadable one is reported rather than
 * swallowed, and the cause is then judged from the listener evidence alone — the sentence a clean "no listener
 * is running" prints claims nothing about the record.
 *
 * @param deps the git/process read seams
 * @param home the resolved state home, whose pending-respawn record explains a loop between arms
 * @param liveness the loop's liveness, read once by the caller and shared with its other gates
 * @param successor the successor this invocation names, the only one a pending record may speak for
 * @returns the freshness and its problems, with the cause `respawnVerdict` names when the grade is empty
 */
export function loopRespawnFreshness({
  deps,
  home,
  liveness,
  successor,
}: {
  readonly deps: StandingInspectDeps;
  readonly home: string;
  readonly liveness: LoopLiveness;
  readonly successor: string | undefined;
}): StandingFreshnessResult & { readonly unmeasured: UnmeasuredCause | undefined } {
  const fresh = loopFreshness({ deps, fallbackBin: undefined, pid: liveness.pid });
  if (fresh.freshness !== undefined) {
    return { ...fresh, unmeasured: undefined };
  }
  const pending = readPendingLoopRespawn({ home });
  const unmeasured = loopUnmeasuredCause({
    listenerLive: liveness.live,
    livenessProblems: liveness.problems,
    pending: pending.isOk() ? pending.value : undefined,
    successor,
  });
  const problems = pending.isErr() ? pending.error.map((line) => `pending respawn: ${line}`) : [];
  return { ...fresh, problems: [...fresh.problems, ...problems], unmeasured };
}

/**
 * One running watch's physical checkout: the device and inode of git's top level — not a spelling, since
 * `realpath` kept macOS firmlink spellings apart for one directory.
 */
function watchCheckoutIdentity({
  candidate,
  deps,
}: {
  candidate: ClaudeWatchProcess;
  deps: StandingInspectDeps;
}): string {
  const top = deps.git({ args: ["rev-parse", "--show-toplevel"], cwd: candidate.cwd });
  if (top === undefined) {
    // Git could not answer (a timeout, say): the cwd's own device and inode still identify the checkout.
    return checkoutIdentityOnDisk({ path: candidate.cwd });
  }
  return checkoutIdentityOnDisk({ path: top });
}

/**
 * Measure the checkout of every RUNNING keep-alive watch.
 *
 * Each watch has ONE tree, not two, and that is a property of the session rather than a gap in the
 * measurement: it runs `slopweaver claude watch` and follows no skill prose at all, so there is no
 * `--plugin-dir` to be stale — a keep-alive started inside a Claude Code session inherits that session's
 * flag, and walking up to it would grade a tree the loop does not read. The `bin` is
 * the checkout each candidate's own argv runs, which is exactly the code it runs.
 *
 * **Every candidate is measured, each distinct checkout once, and the worst grade wins.** A duplicate watch
 * on a stale tree is still rotating credentials with stale code, so grading only the recorded one would let
 * a clean record hide it. And a record whose process is gone names NO tree: the checkout a dead run was
 * started from is not one anything is running, so it is never measured as though it were.
 *
 * Its sensitivity list is its OWN. The loop chain's paths grade the Slack loop, and grading this session
 * against them would produce a check that cannot fire in the direction that matters — a fix landing in
 * `src/claude/` is precisely what this session must pick up, and `loopChainPaths.ts` does not name it.
 *
 * @param candidates the running watches, from the same snapshot the liveness verdict read
 * @param deps the git read seam
 * @returns the graded freshness, or `undefined` with a problem when no watch is running
 */
export function keepAliveFreshness({
  candidates,
  deps,
}: {
  readonly candidates: readonly ClaudeWatchProcess[];
  readonly deps: StandingInspectDeps;
}): StandingFreshnessResult {
  // One measurement per physical checkout, not per spelling, under the first-seen spelling. Lexical
  // normalisation cannot see a filesystem alias — on macOS `/var/…` IS `/private/var/…` — so the identity is git's own physical top level, falling back to the filesystem's real path
  // when git cannot answer (a timeout, say), and to the normalised spelling only when neither can.
  const seen = new Set<string>();
  const targets = candidates.flatMap((candidate): StandingTreeTarget[] => {
    const identity = watchCheckoutIdentity({ candidate, deps });
    if (seen.has(identity)) {
      return [];
    }
    seen.add(identity);
    return [{ path: candidate.cwd, role: "bin" }];
  });
  if (targets.length === 0) {
    return {
      freshness: undefined,
      problems: [
        "keep-alive freshness: nothing to measure — no `claude watch` is running, so there is no checkout " +
          "whose commit could be graded",
      ],
    };
  }
  return measureStandingFreshness({
    deps,
    sensitivePaths: KEEP_ALIVE_CHAIN_PATHS,
    session: KEEP_ALIVE_SESSION,
    targets,
  });
}

/**
 * Measure the supervisor's trees: the main checkout its absolute-path CLI lives in, and the plugin-dir the
 * live supervisor session is following.
 *
 * Unlike the loop's, neither target is derived from a pid — `../../../live/standing/supervisor.ts`
 * says why. An absent plugin-dir costs one tree and is reported by the caller as the plain fact it is; an
 * absent bin means the CLI every session reads through went UNMEASURED, which is a configuration fault and is
 * reported as a problem here.
 *
 * @param deps the git/process read seams
 * @param binPath the declared main checkout carrying the CLI, or `undefined` when it did not resolve
 * @param pluginDir the live supervisor session's `--plugin-dir`, or `undefined` when none is open
 * @returns the graded freshness, or `undefined` with a problem when there was nothing at all to measure
 */
export function supervisorFreshness({
  deps,
  binPath,
  pluginDir,
}: {
  readonly deps: StandingInspectDeps;
  readonly binPath: string | undefined;
  readonly pluginDir: string | undefined;
}): StandingFreshnessResult {
  const targets = supervisorTreeTargets({ binPath, pluginDir });
  if (targets.length === 0) {
    return {
      freshness: undefined,
      problems: [
        "supervisor freshness: nothing to measure — neither a declared main checkout carrying the CLI nor a " +
          "live supervisor session resolved, so which commit the supervisor runs is UNKNOWN rather than current",
      ],
    };
  }
  return measureStandingFreshness({
    deps,
    sensitivePaths: SUPERVISOR_CHAIN_PATHS,
    session: SUPERVISOR_SESSION,
    targets,
  });
}

/**
 * The supervisor's main checkout as `session standing` prints it.
 *
 * @param supervisor the supervisor's standing, whose `binPath` is the declared main checkout carrying the CLI
 * @returns that checkout, or `UNRESOLVED` when none resolved — which the freshness problems already explain
 */
export function mainCheckoutWords({ supervisor }: { supervisor: { readonly binPath: string | undefined } }): string {
  const binPath = supervisor.binPath;
  if (binPath === undefined) {
    return "UNRESOLVED";
  }
  return binPath;
}

/**
 * Print every problem a measurement recorded, so an unmeasurable tree is loud rather than absent.
 *
 * @param prefix the verb's own name, for the line
 * @param problems the accumulated problems
 */
export function reportProblems({
  prefix,
  problems,
}: {
  readonly prefix: string;
  readonly problems: readonly string[];
}): void {
  for (const problem of problems) {
    logger.error({ msg: `${prefix}: ${problem}` });
  }
}
