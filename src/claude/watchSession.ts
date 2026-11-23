/**
 * The record `claude watch` writes about ITSELF, and the one pure function that turns it into a liveness
 * verdict. Pure: the caller reads the file and asks the process table, this decides what the two mean.
 *
 * ## Why the keep-alive loop needs a record of its own
 *
 * Every other artifact this loop writes is about the STORES — `keep-alive.json` says when each was last
 * touched, `rotation-state.json` says which plan was last selected. Neither names a pid, and neither can
 * distinguish "the loop is running and nothing was due" from "no loop has run since Friday". MEASURED
 * over several days on the owner's machine, that is not a hypothetical: `keep-alive.json` sat
 * untouched, three plans expired eight hours after their sign-ins, and
 * every gauge the fleet had went on reporting the stores rather than the absence of the loop: the keep-alive
 * loop was correct and landed, but nothing was RUNNING it.
 *
 * So this is the artifact that makes the loop's own absence VISIBLE, which is what lets
 * `session standing` grade it beside the Slack loop and the recipe scheduler.
 *
 * ## The check has to be able to fail
 *
 * `../live/listen/supervise/liveness.ts` carries the incident this discipline came from — a `pgrep` whose
 * pattern matched the monitor's own command line and reported a dead bot alive twice. The test it leaves
 * behind is the one applied here: **would this emit if the loop were dead right now?** Every verdict below
 * is reachable from a plain unit test with no process on the machine at all, because both observations —
 * whether the pid is in the table, and what instant it is — are parameters rather than calls.
 *
 * ## It is stamped at the START of a tick, not the end
 *
 * A tick refreshes up to one store per configured plan, each through an `execFileSync` bounded at 60
 * seconds, so a legitimate tick can run for minutes. Stamping at the end would make a slow-but-healthy
 * tick indistinguishable from a stopped one for as long as it ran. Stamping at the start says "the loop
 * reached this tick", which is the claim liveness actually needs, and a loop that hangs INSIDE a tick
 * still goes stale on the next deadline because no later tick starts.
 *
 * ## Nothing here is a credential, an account or a path into a keychain
 *
 * The record carries a pid, an instant, an interval and the worktree the loop runs from — every one of
 * them safe to print into an event or a sidebar row. There is deliberately no field that could hold a
 * store directory or an organisation id, for the same structural reason `checkoutIdentity.ts` keeps those
 * out of every renderable type.
 */
import { resolve } from "node:path";

import { isRecord } from "../lib/parsers.js";
import { err, ok, type Result } from "../lib/result.js";
import type { ProcessSnapshot } from "../live/standing/inspect.js";
import { type ClaudeWatchProcess, type ProcessRow, standingWatchProcesses } from "../live/standing/processes.js";
import { type ClaudeError, ClaudeErrors } from "./claudeErrors.js";

/**
 * This standing session's name, declared here rather than beside `loop` and `scheduler` in
 * `cli/commands/session/standingFreshness.ts`, for the same reason `SUPERVISOR_SESSION` is declared in
 * `live/standing/supervisor.ts`: `live/standing/streamEvents.ts` needs it to pick the right remedy, and
 * `live/` never imports out of `cli/`.
 */
export const KEEP_ALIVE_SESSION = "keep-alive";

/** Where the loop's own record lives, relative to the Slopweaver home. */
export const WATCH_SESSION_FILE = "claude-accounts/watch-session.json";

/**
 * The path prefixes whose change makes a RUNNING keep-alive loop stale rather than merely behind.
 *
 * Its own list, not the loop chain's. `lib/loopChainPaths.ts` grades the Slack loop and names none of the
 * code this session actually runs, so grading the keep-alive against it would be a check that cannot fire
 * in the one direction that matters: a fix to the active-plan resolution or the touch schedule lands under
 * `src/claude/`, and a keep-alive session missing it would grade `behind` and alert nobody. That is
 * exactly the failure `live/standing/freshness.ts` records for the supervisor's own list — the commit
 * that started the finding was on neither the loop's list nor near it.
 *
 * Three entries, each the tree of one thing this session runs: the decision code, the verb shell around
 * it, and the `bin/slopweaver` launcher that resolves which checkout either comes from.
 */
export const KEEP_ALIVE_CHAIN_PATHS: readonly string[] = ["bin", "src/claude", "src/cli/commands/claude"];

/**
 * How many tick intervals may pass with no new tick before the loop is graded stopped.
 *
 * Two rather than one, matching `keepAlive.ts`'s own reasoning about the touch schedule: a machine asleep
 * or a tick that overran should not be reported as a death, while two consecutive misses is a loop that
 * has genuinely stopped advancing. At the default five-minute interval that is a ten-minute deadline,
 * three orders of magnitude inside the eight-hour token lifetime it protects.
 */
export const WATCH_TICK_GRACE_INTERVALS = 2;

/**
 * The floor on that deadline, in milliseconds.
 *
 * `--interval` may be as low as one minute, and one tick's own work can exceed two of those on its own: a
 * tick probes every store and the active slot, then refreshes each due store through an `execFileSync`
 * bounded at 60 seconds. Grading a loop mid-touch as stopped would be a false alarm produced by the loop
 * working, so the deadline never falls below the time one honest tick can take.
 */
export const WATCH_TICK_GRACE_FLOOR_MS = 5 * 60 * 1000;

/** The durable record one running `claude watch` writes about itself, rewritten at the start of each tick. */
export interface ClaudeWatchSession {
  /** This run's own id, so two records are distinguishable in a report even at the same pid. */
  readonly watchId: string;
  /** The loop process's pid — the observation that makes a death detectable without any log. */
  readonly pid: number;
  /**
   * The checkout whose CLI entrypoint it runs, spelled as its own argv spells it — the token `ps` prints, so
   * the gauge can match the record to its process. Not `process.cwd()`: a watch started from another
   * directory would name a tree it does not run (`live/standing/processes.ts`'s `launchedCheckout`).
   */
  readonly cwd: string;
  /** When this run began, ISO-8601. */
  readonly startedAtIso: string;
  /** When its most recent tick BEGAN, ISO-8601 — see this module's header on why it is the start. */
  readonly lastTickStartedAtIso: string;
  /** How far apart its ticks are, milliseconds, which is what sets the staleness deadline. */
  readonly intervalMs: number;
}

/**
 * Read the loop's own record, separating ABSENT from MALFORMED.
 *
 * Those two are different facts with different remedies and this deliberately does not collapse them.
 * Absent means no standing session has ever run here, and the fix is to start one. Malformed means
 * something wrote a record this code cannot read — a partial write, a shape from another version, a
 * truncated file — and the fix is to look at the file. Reporting the second as the first would send an
 * operator to start a loop that may already be running, and would hide a real defect behind a routine
 * caption. Every other reader in this feature is deliberately tolerant, because there the repair is one
 * needless API call; here the repair is a person reading a file, so the failure has to survive.
 *
 * A `ClaudeError` (`./claudeErrors.ts`) rather than a list: the record is refused at its FIRST bad field, so
 * each failure is one message, and `field` names which part of the file to look at.
 *
 * @param value the decoded contents of the record file, or undefined when there is none
 * @returns the record, `undefined` inside an `ok` when there is genuinely no record, or every problem
 */
export function parseWatchSession({ value }: { value: unknown }): Result<ClaudeWatchSession | undefined, ClaudeError> {
  // `undefined` alone is absence. A literal `null` DECODED from the file is not: the file exists and
  // holds valid JSON that is simply not a record, which is a record to look at rather than a loop to
  // start. It falls through to the refusal below.
  if (value === undefined) {
    return ok(undefined);
  }
  if (!isRecord(value)) {
    return err(ClaudeErrors.watchSessionInvalid({ field: "record" }));
  }
  // Field by field, refusing at the first bad one, exactly as `parseListenerArm` does for the listener's
  // arm record. A machine wrote this file, so the first thing wrong with it is the thing to look at, and
  // narrowing as it goes is what lets the returned record be proven rather than asserted.
  const watchId = value["watchId"];
  if (typeof watchId !== "string" || watchId.length === 0) {
    return err(ClaudeErrors.watchSessionInvalid({ field: "watchId" }));
  }
  const pid = value["pid"];
  if (typeof pid !== "number" || !Number.isSafeInteger(pid) || pid <= 0) {
    return err(ClaudeErrors.watchSessionInvalid({ field: "pid" }));
  }
  const cwd = value["cwd"];
  if (typeof cwd !== "string" || cwd.length === 0) {
    return err(ClaudeErrors.watchSessionInvalid({ field: "cwd" }));
  }
  const startedAtIso = value["startedAtIso"];
  if (typeof startedAtIso !== "string" || !Number.isFinite(Date.parse(startedAtIso))) {
    return err(ClaudeErrors.watchSessionInvalid({ field: "startedAtIso" }));
  }
  const lastTickStartedAtIso = value["lastTickStartedAtIso"];
  if (typeof lastTickStartedAtIso !== "string" || !Number.isFinite(Date.parse(lastTickStartedAtIso))) {
    return err(ClaudeErrors.watchSessionInvalid({ field: "lastTickStartedAtIso" }));
  }
  const intervalMs = value["intervalMs"];
  if (typeof intervalMs !== "number" || !Number.isFinite(intervalMs) || intervalMs <= 0) {
    return err(ClaudeErrors.watchSessionInvalid({ field: "intervalMs" }));
  }
  return ok({ cwd, intervalMs, lastTickStartedAtIso, pid, startedAtIso, watchId });
}

/**
 * Every `claude watch` one snapshot of the process table holds, partitioned — structural evidence that
 * travels with every verdict, so no state name can hide a second writer.
 */
export interface ClaudeWatchLiveSet {
  /**
   * Every running, non-queued watch. The record's own process comes FIRST when it is running, so
   * `candidates[0]` is the one a tick-freshness verdict describes. Empty means the keep-alive is ABSENT —
   * which is decided by this, never by `live`: a `ticks-stopped` loop is not live and is still running.
   */
  readonly candidates: readonly ClaudeWatchProcess[];
  /** `candidates` after the first — each a second credential writer beside the one being graded. */
  readonly duplicates: readonly ClaudeWatchProcess[];
  /** Watches started with `--wait` that are not the recorded owner: successors, not writers. */
  readonly queued: readonly ClaudeWatchProcess[];
}

/**
 * The record names a run whose process is not a running watch — the two ways that happens.
 *
 * @internal — a member of {@link ClaudeWatchLiveness}, exported so that union's arms can be named.
 */
export type RecordedClaudeWatchFailure =
  /** A record stands and its process is gone from the table. The shape the keep-alive outage actually had. */
  | { readonly state: "process-dead"; readonly watchId: string; readonly pid: number; readonly cwd: string }
  /**
   * The recorded pid is in the table but is NOT this watcher. A pid is reused, so its mere existence
   * proves nothing; the argv has to name this loop, running out of the tree the record claims.
   */
  | { readonly state: "process-foreign"; readonly watchId: string; readonly pid: number; readonly cwd: string };

/**
 * What a caller concluded about the keep-alive loop: one state, plus the live set it was read against.
 * `watching` and `unrecorded` mean a store is being kept alive; see {@link isWatchLive}.
 */
export type ClaudeWatchLiveness = ClaudeWatchLiveSet &
  (
    | /** A record exists and cannot be read. A different fact from absence, with a different remedy. */
      { readonly state: "invalid"; readonly problems: readonly string[] }
      /** The process table could not be read, so nothing about any watch is established. Never "empty". */
    | { readonly state: "unmeasured"; readonly problem: string }
    /** No record and no running watch — no `claude watch` has run here, and every idle store is on its own clock. */
    | { readonly state: "never-started" }
    /**
     * A watch IS running and the record does not name it — a run that has not stamped yet, or one whose
     * record another run overwrote. `recorded` says what became of the run the record does name.
     */
    | { readonly state: "unrecorded"; readonly recorded?: RecordedClaudeWatchFailure }
    | RecordedClaudeWatchFailure
    /** The recorded process is running and has not begun a tick since well past its own deadline. */
    | {
        readonly state: "ticks-stopped";
        readonly watchId: string;
        readonly pid: number;
        readonly cwd: string;
        readonly sinceTickMs: number;
      }
    /** The recorded process is running, a tick begun inside its deadline: idle stores are being refreshed. */
    | {
        readonly state: "watching";
        readonly watchId: string;
        readonly pid: number;
        readonly cwd: string;
        readonly sinceTickMs: number;
      }
  );

/**
 * How long a loop may go without beginning a tick before it is graded stopped.
 *
 * @param intervalMs the loop's own configured tick interval
 * @returns the deadline in milliseconds, never below {@link WATCH_TICK_GRACE_FLOOR_MS}
 */
export function watchTickDeadlineMs({ intervalMs }: { intervalMs: number }): number {
  return Math.max(intervalMs * WATCH_TICK_GRACE_INTERVALS, WATCH_TICK_GRACE_FLOOR_MS);
}

/**
 * How the verdict and the admission check decide that a recorded checkout and a running watch's checkout
 * are one tree. Injected so the pure verdict stays pure: production passes an on-disk comparison.
 */
export type CheckoutComparator = (sides: { readonly left: string; readonly right: string }) => boolean;

/**
 * The pure default: two spellings that normalise to one path — `/repo/bin/..` and `/repo`. It cannot see a
 * filesystem alias, which is why production callers pass `sameCheckoutOnDisk` instead.
 *
 * @param left one path
 * @param right the other
 * @returns true when both normalise to the same absolute path
 */
export function lexicallySameCheckout({ left, right }: { readonly left: string; readonly right: string }): boolean {
  return resolve(left) === resolve(right);
}

/** The live set a verdict carries when the process table could not be read — nothing, rather than a guess. */
const NO_LIVE_SET: ClaudeWatchLiveSet = { candidates: [], duplicates: [], queued: [] };

/**
 * Judge the keep-alive loop by RECONCILING the record on disk against one snapshot of the process table.
 *
 * ## Why the record alone is not an answer
 *
 * The record names ONE run, and every watch rewrites it. MEASURED: a second watch —
 * started by a mistyped flag the verb then ignored — took the record over, and when it was killed the gauge
 * said "keep-alive: NOT running" while the first watch was still ticking. So the table is read for EVERY
 * running watch, the record picks which one a tick-freshness verdict describes, and the rest are reported
 * structurally rather than folded away: a second writer is `duplicates`, a successor started with `--wait`
 * is `queued`, and a running watch the record does not name is `unrecorded` — live, not absent.
 *
 * ## The precedence, which is the contract
 *
 * 1. A record that cannot be parsed is `invalid` — nothing it says can be trusted.
 * 2. A table that cannot be read is `unmeasured` — never an empty table, which would read as absence.
 * 3. No record: a running watch is `unrecorded`, none is `never-started`.
 * 4. The record's OWNER is the DECODED watch at the record's pid running from the record's checkout —
 *    compared physically in production — even one carrying `--wait`. A reused pid running an unrelated
 *    `sleep` never decodes, and one running a watch from another tree is not the owner.
 * 5. An owner is `watching` or `ticks-stopped` by its last tick. Process death outranks tick staleness,
 *    because a record's timestamp can outlive its writer by a whole deadline.
 * 6. No owner but another watch running: `unrecorded`, carrying what became of the recorded run.
 * 7. No owner and nothing running: the recorded run is `process-dead` or `process-foreign`.
 *
 * The live set is populated whenever the table was readable, `invalid` included — a state never
 * suppresses the evidence of a second writer.
 *
 * @param nowMs the current instant, epoch milliseconds — injected, never read from a hidden clock
 * @param problems why the record could not be read, when it could not
 * @param session the record on disk, or undefined when there is none
 * @param snapshot one reading of the process table, shared with every other keep-alive measurement
 * @returns the verdict and the live set it was reconciled against
 */
export function watchSessionLiveness({
  nowMs,
  problems,
  sameCheckout = lexicallySameCheckout,
  session,
  snapshot,
}: {
  readonly nowMs: number;
  readonly problems?: readonly string[];
  readonly sameCheckout?: CheckoutComparator;
  readonly session: ClaudeWatchSession | undefined;
  readonly snapshot: ProcessSnapshot;
}): ClaudeWatchLiveness {
  const { liveSet, owner } = reconcileLiveSet({ sameCheckout, session, snapshot });
  const running = liveSet.candidates.length > 0;
  if (problems !== undefined && problems.length > 0) {
    return { ...liveSet, problems, state: "invalid" };
  }
  if (snapshot.kind === "unreadable") {
    return { ...NO_LIVE_SET, problem: snapshot.problem, state: "unmeasured" };
  }
  if (session === undefined) {
    return running ? { ...liveSet, state: "unrecorded" } : { ...liveSet, state: "never-started" };
  }
  if (owner !== undefined) {
    return ownerVerdict({ liveSet, nowMs, session });
  }
  const recorded = recordedRunFailure({ rows: snapshot.rows, session });
  return running ? { ...liveSet, recorded, state: "unrecorded" } : { ...liveSet, ...recorded };
}

/**
 * Partition one snapshot's running watches against the record — steps 4 and 5's structure, with no verdict.
 *
 * The owner is located BEFORE the waiters are partitioned out, because a released `--wait` successor
 * keeps that flag in its argv for life and would otherwise be filed as queued while it is the one ticking.
 *
 * @param session the record on disk, or undefined when there is none
 * @param snapshot one reading of the process table; an unreadable one yields an empty set
 * @returns the recorded owner when it is running, and the live set with that owner first
 */
function reconcileLiveSet({
  sameCheckout,
  session,
  snapshot,
}: {
  readonly sameCheckout: CheckoutComparator;
  readonly session: ClaudeWatchSession | undefined;
  readonly snapshot: ProcessSnapshot;
}): { readonly owner: ClaudeWatchProcess | undefined; readonly liveSet: ClaudeWatchLiveSet } {
  const watchers = snapshot.kind === "rows" ? standingWatchProcesses({ processes: snapshot.rows }) : [];
  // The decoded watch at the recorded pid AND the recorded checkout, compared by the injected comparator —
  // on disk in production (`live/standing/inspect.ts`'s `sameCheckoutOnDisk`). A pid alone credited a reused
  // pid running a queued watch from another tree (false live); a spelling let an alias hide the owner.
  const owner = watchers.find(
    (watcher) =>
      session !== undefined && watcher.pid === session.pid && sameCheckout({ left: watcher.cwd, right: session.cwd }),
  );
  const others = watchers.filter((watcher) => watcher !== owner);
  const running = others.filter((watcher) => !watcher.waiting);
  const candidates = owner === undefined ? running : [owner, ...running];
  return {
    liveSet: { candidates, duplicates: candidates.slice(1), queued: others.filter((watcher) => watcher.waiting) },
    owner,
  };
}

/**
 * Step 5: a running owner is `watching` or `ticks-stopped` by when its last tick began.
 *
 * @param liveSet the reconciled live set, owner first
 * @param nowMs the current instant, epoch milliseconds
 * @param session the record, whose process is running
 * @returns the verdict
 */
function ownerVerdict({
  liveSet,
  nowMs,
  session,
}: {
  readonly liveSet: ClaudeWatchLiveSet;
  readonly nowMs: number;
  readonly session: ClaudeWatchSession;
}): ClaudeWatchLiveness {
  const { cwd, pid, watchId } = session;
  const sinceTickMs = nowMs - Date.parse(session.lastTickStartedAtIso);
  const state = sinceTickMs > watchTickDeadlineMs({ intervalMs: session.intervalMs }) ? "ticks-stopped" : "watching";
  return { ...liveSet, cwd, pid, sinceTickMs, state, watchId };
}

/**
 * What became of a recorded run whose process is not a running watch: gone from the table, or its pid
 * now running something else.
 *
 * @param rows the readable process table
 * @param session the record
 * @returns `process-dead` or `process-foreign`
 */
function recordedRunFailure({
  rows,
  session,
}: {
  readonly rows: readonly ProcessRow[];
  readonly session: ClaudeWatchSession;
}): RecordedClaudeWatchFailure {
  const { cwd, pid, watchId } = session;
  return rows.some((row) => row.pid === pid)
    ? { cwd, pid, state: "process-foreign", watchId }
    : { cwd, pid, state: "process-dead", watchId };
}

/**
 * Whether a verdict means idle credential stores are currently being kept alive.
 *
 * `unrecorded` counts: a watch is running, which is the fact an earlier gauge got wrong. Whether a SECOND
 * one is running beside it is a separate question the live set answers, and `session standing` refuses an
 * all-clear on it independently.
 *
 * @param liveness the verdict to judge
 * @returns true for `watching` and `unrecorded`
 */
export function isWatchLive({ liveness }: { readonly liveness: ClaudeWatchLiveness }): boolean {
  return liveness.state === "watching" || liveness.state === "unrecorded";
}

/**
 * The one sentence a report prints for a verdict — what is true, and what it costs when it is not.
 *
 * Rule 7 shapes it: the outcome first, the evidence after, and never a wall. A caller that needs the
 * remedy renders it separately, because the remedy differs by surface.
 *
 * @param liveness the verdict
 * @returns the sentence
 */
export function watchLivenessLine({ liveness }: { readonly liveness: ClaudeWatchLiveness }): string {
  return `${watchStateSentence({ liveness })}${liveSetClause({ liveness })}`;
}

/**
 * The pids of a set of watchers, for a line.
 *
 * @param watchers the watchers to name
 * @returns `pid a, pid b`
 */
function pidList({ watchers }: { readonly watchers: readonly ClaudeWatchProcess[] }): string {
  return watchers.map((watcher) => `pid ${String(watcher.pid)}`).join(", ");
}

/**
 * What the live set adds to a verdict's sentence: a second writer, and any queued successor.
 *
 * @param liveness the verdict carrying the live set
 * @returns the clause, empty when there is nothing beside the graded watch
 */
function liveSetClause({ liveness }: { readonly liveness: ClaudeWatchLiveness }): string {
  const duplicates =
    liveness.duplicates.length === 0
      ? ""
      : ` — DUPLICATE: ${String(liveness.duplicates.length)} more running beside it (${pidList({ watchers: liveness.duplicates })}), ` +
        "each a second credential writer; interrupt all but one";
  const queued =
    liveness.queued.length === 0
      ? ""
      : `; ${String(liveness.queued.length)} queued with --wait (${pidList({ watchers: liveness.queued })})`;
  return `${duplicates}${queued}`;
}

/**
 * What became of the run a record names, for an `unrecorded` verdict's sentence.
 *
 * @param recorded the recorded run's failure, when there was a record at all
 * @returns the clause
 */
function recordedRunClause({ recorded }: { readonly recorded: RecordedClaudeWatchFailure | undefined }): string {
  if (recorded === undefined) {
    return "no record names it";
  }
  const run = `the record names run ${recorded.watchId} (pid ${String(recorded.pid)})`;
  return recorded.state === "process-dead" ? `${run}, which is gone` : `${run}, whose pid now runs something else`;
}

/**
 * The state half of {@link watchLivenessLine}.
 *
 * @param liveness the verdict
 * @returns the sentence, without the live-set clause
 */
function watchStateSentence({ liveness }: { readonly liveness: ClaudeWatchLiveness }): string {
  if (liveness.state === "unmeasured") {
    return (
      "keep-alive: UNKNOWN — the process table could not be read, so whether a loop is running is not " +
      `established (${liveness.problem})`
    );
  }
  if (liveness.state === "unrecorded") {
    const first = liveness.candidates[0]!;
    return (
      `keep-alive: live — \`claude watch\` pid ${String(first.pid)} from ${first.cwd} is running, but ` +
      `${recordedRunClause({ recorded: liveness.recorded })}, so its tick freshness is not established`
    );
  }
  if (liveness.state === "never-started") {
    return (
      "keep-alive: NOT running — no `claude watch` has recorded a tick here, so every store no session is " +
      "pinned to expires on its own eight-hour clock"
    );
  }
  if (liveness.state === "invalid") {
    return (
      "keep-alive: UNKNOWN — a record exists and could not be read, so whether the loop is running is not " +
      `established. Read the file: ${liveness.problems.join("; ")}`
    );
  }
  if (liveness.state === "process-foreign") {
    return (
      `keep-alive: NOT running — pid ${String(liveness.pid)} from run ${liveness.watchId} is in the process ` +
      "table but is not this loop, so the pid was reused and nothing is refreshing an idle store"
    );
  }
  if (liveness.state === "process-dead") {
    return (
      `keep-alive: NOT running — its last run (${liveness.watchId}, pid ${String(liveness.pid)}, from ` +
      `${liveness.cwd}) is gone from the process table, so idle stores are on their own clock`
    );
  }
  const seconds = Math.round(liveness.sinceTickMs / 1000);
  if (liveness.state === "ticks-stopped") {
    return (
      `keep-alive: NOT running — ${liveness.watchId} (pid ${String(liveness.pid)}) is alive but has begun no ` +
      `tick for ${String(seconds)}s, past its own deadline, so nothing is refreshing an idle store`
    );
  }
  return `keep-alive: live (${liveness.watchId}, pid ${String(liveness.pid)}), last tick ${String(seconds)}s ago`;
}
