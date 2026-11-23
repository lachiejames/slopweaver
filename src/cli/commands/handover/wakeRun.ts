/**
 * `slopweaver handover wake` — reseat every parked seat whose wake is due, by a visible `cmux spawn`.
 *
 * The other half of `handover park --wake-at|--wake-on-checks` (`../../../handover/parkWake.ts` carries the
 * owner's ruling). A seat waiting on a clock or on CI closes itself and journals what it waits on;
 * this verb, a supervisor-tick reading placed right after `session close-done`, judges each such checkpoint and
 * spawns the due ones back. No seat stays open to wait, and nothing reasons headless: the spawn is a cmux
 * workspace the owner can see and interrupt (rule 2), launched through the same bounded `spawnSync` child the tick
 * already uses.
 *
 * **It runs once a tick**, as the tick's own reading; the chair runs it again only as the `--retry <nonce>` a
 * backoff deferral prints, which waits for the backoff to open and judges that one park (`./wakeRetry.ts`). Two
 * wakes on the machine still share one memory, the wake journal (`./wakeReseat.ts`): a park re-parked on the very
 * condition its reseat acted on is held until a new one, and a park another wake is reseating right now is
 * `reseat-in-flight`.
 *
 * Four properties are the design:
 *
 * - **UNKNOWN never wakes.** A provider read that fails, or a checks page too long to prove done, leaves the seat
 *   parked and says UNKNOWN; the next tick reads again. So does a read cut at its limit, or one the run's judging
 *   window closed before it started (`./wakeJudge.ts`).
 * - **Wake order, inside the boot window's share** (`../../../handover/wakeOrder.ts`, `./wakeBootBudget.ts`): work
 *   still to land before a park whose pull request ended, a doc naming no `repo:` last, each group the longest since
 *   its last attempt (or since due) first, so a reseated seat that parks again waits behind every older park. A run
 *   attempts at most half the 180-second boot window's hold less the boots already in flight, so the chair's fill
 *   after it is never starved, and a due row past the budget is `due-deferred` for the next tick. The budget counts
 *   attempts, not successes, so a failing spawn cannot hold the tick open. A spawn the fleet-wide backoff defers
 *   (exit 4) is `spawn-deferred`, not a failure: the park stays due, and every later due row this run is
 *   `due-deferred` rather than spawned into a window already shut. A merged pull request's park the real `handover
 *   finish` closes spends no attempt at all (`./wakeFinish.ts`); one finish did not close goes on to that reseat.
 * - **A park spawn would refuse forever is cleared, never attempted** — a settled ask, a finished or shipped run,
 *   a terminal row (`./wakeRows.ts`). A paused row is skipped and kept.
 * - **A spawn is believed only off the journal.** `cmux spawn` writes `dispatched` once its seat booted and does
 *   not fail when that append does, so an exit 0 is `spawned` only when a re-read finds the park cleared and the
 *   FIRST line to clear it is `dispatched` — a park an `abandoned` or `finished` cleared first proves no seat came
 *   up, whatever lands after it.
 */

import { randomUUID } from "node:crypto";
import { join } from "node:path";

import { quietLauncherEnv } from "#lib/launcherEnv.js";
import { logger } from "#lib/logger.js";
import { installedTreeRoot } from "#lib/pluginRoot.js";
import { err, ok, type Result } from "#lib/result.js";

import { currentBranch } from "../../../codex/gitDiff.js";
import { originRepositoryOf } from "../../../config.js";
import { type WakeCandidate, wakeCandidates } from "../../../handover/wakeCandidates.js";
import { DEFAULT_TOP_N } from "../../../live/machine/capacity.js";
import { productionMachineCapacityDeps } from "../../../live/machine/read.js";
import { recentBoots } from "../../../live/machine/recentBoots.js";
import { spawnWindow } from "../../../live/machine/spawnBackoff.js";
import { readSpawnBackoffState } from "../../../live/machine/spawnBackoffStore.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_DEFERRED, EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { resolveHome } from "../../optionParsers.js";
import { booleanFlagsOf, type FlagSpec, parseFlags, stringFlagsOf } from "../../parseFlags.js";
import { runBoundedChild, runBoundedChildWithStderr } from "../supervisor/scratchChild.js";
import { rerunAllowedBy } from "./finishedCycleGate.js";
import { WAKE_BRANCH_READ_TIMEOUT_MS, WAKE_FINISH_STDERR_MAX_BYTES, wakeFinishEnv } from "./wakeFinish.js";
import { productionReadChecks } from "./wakeJudge.js";
import { productionMergeProof, productionProbeTree } from "./wakeMergeProof.js";
import { productionClose, productionReadPrHead } from "./wakeReconcile.js";
import { printReport, type WakeReport, wakeReport } from "./wakeReport.js";
import { retryTarget, type WakeRetry, wakeJournalFault } from "./wakeRetry.js";
import { type HandoverWakeDeps, type WakeRowReport, wakeRows } from "./wakeRows.js";
import { readWorktreeCommit } from "./wakeWorktreeCommit.js";

/** How many argv entries precede a verb's own arguments. Four: `[node, cli, noun, verb, …]`. */
const VERB_ARG_OFFSET = 4;

/** The flags `handover wake` accepts. */
const WAKE_FLAGS: FlagSpec = {
  boolean: ["dry-run", "json", "settle-only"],
  string: ["home", "retry"],
};

/** `--`-prefixed, for the help-truth ratchet. */
export const HANDOVER_WAKE_FLAG_NAMES: readonly string[] = [
  ...stringFlagsOf({ spec: WAKE_FLAGS }),
  ...booleanFlagsOf({ spec: WAKE_FLAGS }),
]
  .map((name) => `--${name}`)
  .toSorted();

export const HANDOVER_WAKE_USAGE =
  "usage: slopweaver handover wake [--retry <nonce> | --settle-only] [--dry-run] [--home <dir>] [--json]\n" +
  "\n" +
  "--settle-only reconciles every due park whose pull request merged or closed and reseats nothing: a park on the\n" +
  "              run's own branch that merged, with no question and no drafts, is finished and closed; every\n" +
  "              other one is reported by name with why it is still owed.";

/**
 * Parse `handover wake`'s own flags, exported so the help-truth gate exercises the REAL parser.
 *
 * @param rest the verb's own arguments, with the noun and verb already stripped
 * @returns the parsed flags, or the reasons the parse failed
 */
export function parseHandoverWakeArgs({ rest }: { rest: readonly string[] }): ReturnType<typeof parseFlags> {
  return parseFlags({ args: rest, spec: WAKE_FLAGS });
}

/**
 * Clear every park spawn would refuse forever, judge the rest, finish a merged park with nothing else left, and
 * reseat the due ones longest-due first, inside the wake's share of the boot window.
 *
 * @param deps the clock, provider read, spawn and output channels
 * @param rest the verb's own arguments
 * @returns 0 when a spawn was attempted, a park cleared or a merged park finished (or would be, on a dry run) and
 *   nothing failed, 3 when none of those — no row due, every due park already moved or held, or only paused rows — 4 when the spawn backoff
 *   deferred any reseat or another wake is mid-reseat on one, whatever else failed, 1 on a scan, journal, spawn or
 *   clear failure otherwise, 2 on usage; `--retry` adds its own stops (`./wakeRetry.ts`), and exits 4 where a
 *   plain wake would exit 3, since its park still stands
 */
export async function runHandoverWake({
  deps,
  rest,
}: {
  deps: HandoverWakeDeps;
  rest: readonly string[];
}): Promise<number> {
  const flags = wakeFlags({ deps, rest });
  if (flags.kind === "stop") {
    return flags.exit;
  }
  const { dryRun, home, json, retryNonce, settleOnly } = flags;
  const scanned = wakeCandidates({ home, rerunAllowed: deps.rerunAllowed });
  if (scanned.isErr()) {
    deps.writeDiagnostic(`handover wake: the board did not read — ${scanned.error.message}`);
    return EXIT_ERROR;
  }
  const { duplicateSlugs, unreadable } = scanned.value;
  let candidates: readonly WakeCandidate[] = scanned.value.candidates;
  let retry: WakeRetry | undefined;
  if (retryNonce !== undefined) {
    const target = await retryTarget({ deps, dryRun, home, nonce: retryNonce });
    if (target.kind === "stop") {
      return target.exit;
    }
    ({ candidates, retry } = target);
  } else if (wakeJournalFault({ deps, home, required: candidates.length > 0 })) {
    return EXIT_ERROR;
  }
  const now = deps.now();
  const waking = retry === undefined ? scanned.value.candidates : undefined;
  const pass = await wakeRows({ candidates, deps, dryRun, home, now, settleOnly, waking });
  const report = wakeReport({ dryRun, duplicateSlugs, now, pass, retry, settleOnly, unreadable });
  printReport({ deps, json, report });
  return wakeExit({ report });
}

/** The wake's own flags, read once, or the exit a help, usage or flag-combination stop ends on. */
type WakeFlags =
  | { readonly kind: "stop"; readonly exit: number }
  | {
      readonly kind: "run";
      readonly dryRun: boolean;
      readonly home: string;
      readonly json: boolean;
      readonly retryNonce: string | undefined;
      readonly settleOnly: boolean;
    };

/**
 * Read the wake's flags, printing usage on `--help` and on a refused or contradictory combination.
 *
 * @returns the flags to run with, or the exit `--help` (0) or a usage error (2) ends on
 */
function wakeFlags({ deps, rest }: { deps: HandoverWakeDeps; rest: readonly string[] }): WakeFlags {
  if (rest.includes("--help") || rest.includes("-h")) {
    deps.writeOut(HANDOVER_WAKE_USAGE);
    return { exit: EXIT_OK, kind: "stop" };
  }
  const parsed = parseHandoverWakeArgs({ rest });
  if (parsed.isErr()) {
    parsed.error.forEach((line) => {
      deps.writeDiagnostic(line);
    });
    deps.writeDiagnostic(HANDOVER_WAKE_USAGE);
    return { exit: EXIT_USAGE, kind: "stop" };
  }
  const { values } = parsed.value;
  // The home resolves before the flag-combination check, as it always has: a home that cannot resolve throws first.
  const home = resolveHome({ named: typeof values["home"] === "string" ? values["home"] : undefined });
  const retryNonce = typeof values["retry"] === "string" ? values["retry"] : undefined;
  const settleOnly = values["settle-only"] === true;
  if (settleOnly && retryNonce !== undefined) {
    deps.writeDiagnostic("handover wake: --settle-only reseats nothing, so it cannot retry a deferred reseat");
    deps.writeDiagnostic(HANDOVER_WAKE_USAGE);
    return { exit: EXIT_USAGE, kind: "stop" };
  }
  return {
    dryRun: values["dry-run"] === true,
    home,
    json: values["json"] === true,
    kind: "run",
    retryNonce,
    settleOnly,
  };
}

/**
 * The exit a wake that judged its rows ends on.
 *
 * @returns 4 on any deferred or in-flight reseat, else 1 on any failed row, else 4 on a retry that reseated and
 *   cleared nothing or was a dry run, else 4 when nothing was done and a due row waits on the boot window, else 3
 *   when nothing was attempted, cleared, finished or suspended, else 0
 */
function wakeExit({ report }: { report: WakeReport }): number {
  const { attempted, cleared, dryRun, finished, retry, rows, suspended } = report;
  // Any deferred reseat is NOT YET for the run, whatever else came up — a failed row included, which its own line
  // still reports: a scheduler stamping the run would leave that park undue until its next firing.
  // A park another wake is mid-reseat on is NOT YET too: that spawn may still fail and leave it owed.
  if (rows.some((row) => NOT_YET_ACTIONS.has(row.action))) {
    return EXIT_DEFERRED;
  }
  // A landed row whose close did not write still stands as AWAITING SHIP, which is the defect the reconcile closes.
  if (rows.some((row) => FAILED_ACTIONS.has(row.action) || row.closeOutcome === "close-failed")) {
    return EXIT_ERROR;
  }
  // A suspended wake settled its row this tick: the park is owed nothing until the owner answers.
  const idle = attempted === 0 && cleared === 0 && finished === 0 && suspended === 0;
  // A retry reaches here only over its park still standing, so spawning and clearing nothing — a check read that
  // failed, a hold, anything — leaves that reseat possibly owed: NOT YET, never done. A dry run never
  // reseats, so its retry is NOT YET whatever it would have done. Stated residue: a park another
  // seat clears between the rescan and the row's own re-read also lands here, and reads NOT YET rather than nothing to
  // retry. That errs safe — a second retry finds the park gone and exits 3, never spawns — and telling the two apart
  // would need the row to report WHY it moved, which `parkMoved` does not carry today.
  if (retry !== undefined && (dryRun || idle)) {
    return EXIT_DEFERRED;
  }
  // Due parks the boot window left no room for are owed, not absent: NOT YET, never nothing to do.
  if (idle && rows.some((row) => row.action === "due-deferred")) {
    return EXIT_DEFERRED;
  }
  return idle ? EXIT_EXPECTED_EMPTY : EXIT_OK;
}

/** The actions that make a run exit 4: a reseat the backoff deferred, or one another wake still holds. */
const NOT_YET_ACTIONS: ReadonlySet<WakeRowReport["action"]> = new Set(["spawn-deferred", "reseat-in-flight"]);

/** The actions that make a run exit 1: a reseat that did not come up, or a clear that did not write. */
const FAILED_ACTIONS: ReadonlySet<WakeRowReport["action"]> = new Set([
  "spawn-failed",
  "park-clear-failed",
  "wake-journal-failed",
]);

/**
 * When the fleet spawn backoff opens, read off its shared state. The boot-burst hatch is not consulted: a window
 * that hatch would open reads closed here, so a retry waits longer than it had to, never less.
 *
 * @param nowIso the instant the window is judged at
 * @returns the window's closing instant, `nowIso` when it already reads open, or why the state did not read
 */
export function productionRetryAfter({ home, nowIso }: { home: string; nowIso: string }): Result<string> {
  const state = readSpawnBackoffState({ home });
  if (state.isErr()) {
    return err([state.error.message]);
  }
  const window = spawnWindow({ bootsBypassed: false, nowIso, state: state.value });
  return ok(window.kind === "closed" ? window.untilIso : nowIso);
}

/** One finish ask's `handover finish` argv: bound to the park and its proof, a dry run and `--beside-question` when asked. */
function finishChildArgv({
  besideQuestion,
  dryRun,
  home,
  parkIndex,
  parkedAtIso,
  probedRepo,
  probedTree,
  slug,
}: Parameters<HandoverWakeDeps["finish"]>[0]): string[] {
  return [
    "handover",
    "finish",
    slug,
    "--home",
    home,
    "--park-index",
    String(parkIndex),
    "--parked-at",
    parkedAtIso,
    "--probed-repo",
    probedRepo,
    "--probed-tree",
    probedTree,
    ...(dryRun ? ["--dry-run"] : []),
    ...(besideQuestion ? ["--beside-question"] : []),
  ];
}

/**
 * The production effects: the wall clock, the GitHub read, and a bounded child of the installed launcher.
 *
 * @returns the deps `handover wake` runs on outside a test
 */
export function productionWakeDeps(): HandoverWakeDeps {
  const bin = join(installedTreeRoot({ importMetaUrl: import.meta.url }), "bin", "slopweaver");
  return {
    nonce: () => randomUUID(),
    now: () => new Date(),
    readChecks: productionReadChecks,
    rerunAllowed: rerunAllowedBy({ env: process.env }),
    reseat: ({ home, slug, timeoutMs }) =>
      runBoundedChild({ argv: ["cmux", "spawn", slug, "--model", "opus", "--home", home], bin, timeoutMs }),
    finish: (args) =>
      runBoundedChildWithStderr({
        argv: finishChildArgv(args),
        bin,
        cwd: args.cwd,
        env: wakeFinishEnv({ allowNoLessons: args.allowNoLessons, env: quietLauncherEnv() }),
        stderrMaxBytes: WAKE_FINISH_STDERR_MAX_BYTES,
        timeoutMs: args.timeoutMs,
      }),
    readPrHead: productionReadPrHead,
    readBranch: ({ cwd }) => currentBranch({ cwd, timeoutMs: WAKE_BRANCH_READ_TIMEOUT_MS }),
    readOrigin: originRepositoryOf,
    readWorktreeCommit: ({ cwd }) => readWorktreeCommit({ cwd, timeoutMs: WAKE_BRANCH_READ_TIMEOUT_MS }),
    close: productionClose,
    mergeProof: productionMergeProof,
    probeTreeOf: productionProbeTree,
    bootsInFlight: ({ home }) => {
      const capacity = productionMachineCapacityDeps({ home, topN: DEFAULT_TOP_N });
      return recentBoots({ elapsedRows: capacity.elapsed(), sessions: capacity.sessions() }).boots.length;
    },
    retryAfter: productionRetryAfter,
    sleep: ({ ms }) =>
      new Promise((resolve) => {
        setTimeout(resolve, ms);
      }),
    writeDiagnostic: (line) => {
      logger.error({ msg: line });
    },
    writeOut: (line) => {
      logger.out({ line });
    },
  };
}

export const handoverWakeCommand = defineCommand({
  run: (argv) => runHandoverWake({ deps: productionWakeDeps(), rest: argv.slice(VERB_ARG_OFFSET) }),
});
