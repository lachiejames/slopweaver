/**
 * `slopweaver worktree prune` — what may be deleted, what may not, and why, before anything is.
 *
 * ## Why this verb exists at all
 *
 * Nothing removes a worktree when its session ends. One-off cleanups each left the same gap: closing a
 * session does not remove its worktree, and the two blessed worktree homes once held 336 registrations
 * between them. This verb is the recurring mechanism those passes kept deferring, and its default is a PLAN
 * so that running it is never the risky choice.
 *
 * ## The rails, in one place
 *
 * The safety rules live in `worktree/pruneClassify.ts` and the deletions in `worktree/pruneApply.ts`; this
 * file only reads the world and hands it over. Four rails belong here because they are about the RUN rather
 * than about any one worktree:
 *
 *  - **Unreadable live state refuses `--apply` outright, naming the register.** The session ledger, the
 *    workspace list, every live process's cwd and the owner's open pull requests are the four registers that say a
 *    tree is in use (`./pruneLiveState.ts`), and a socket, an `lsof` or a GitHub read that failed to answer
 *    is not an empty register. A plan still prints, with each unreadable register named on stderr, because
 *    a plan deletes nothing. A register that only did not answer in time exits `EXIT_DEFERRED` rather than 1,
 *    so the hourly row is retried instead of held (`applyRefusal`, `./pruneLiveState.ts`).
 *  - **Disk is measured after classification, for candidates only.** `du` over three hundred checkouts costs
 *    minutes; over the candidates it costs seconds, and a verb that is slow enough to dread is a verb that
 *    goes back to being run once a fortnight by hand.
 *  - **An `--apply` stops ITSELF at `--budget`, and it stops between removals.** A caller that bounds this
 *    verb with a subprocess timeout kills it wherever it happens to be, and a `git worktree remove` cut in
 *    half leaves a gutted tree git then refuses forever. See `worktree/pruneOptions.ts`'s
 *    `DEFAULT_APPLY_BUDGET` for the slots that measured this.
 *  - **`--budget` is counted from the moment the SCAN ENDS, and the scan has a bound of its own.** For two
 *    weeks it was counted from process start, so on 756 + 90 registered worktrees the scan spent the whole
 *    allowance and the removal loop's first condition check was already false: the nightly run planned 55 GB
 *    of removals and performed none of them, twice in a row, exiting 0 both times. The measurement, the two
 *    slot records and the rule are in `worktree/pruneSweep.ts`'s header.
 *  - **Every repository is swept ROUND-ROBIN, planning and applying alike.** Sweeping them in order means a
 *    bound that runs out spends the whole run inside whichever repository the profile lists first, and the
 *    second one is never reached at all — measured on a nightly slot, where acme-admin's
 *    sixteen candidates went untouched across two full passes. The scan is now round-robin for the same
 *    reason, and it SAYS what it did not reach, because a partial census that stays quiet reads as a whole
 *    one.
 */

import { setTimeout as setTimeoutPromise } from "node:timers/promises";

import { acquireOperationLockDetailed } from "../../../admit/operationLock.js";
import { slopweaverHome } from "../../../config.js";
import { logger } from "../../../lib/logger.js";
import { fseventsdBalloonHold, readFseventsdRss } from "../../../worktree/fseventsdBalloon.js";
import {
  DEFAULT_APPLY_BUDGET,
  DEFAULT_NUKE_AFTER,
  DEFAULT_OLDER_THAN,
  DEFAULT_SCAN_BUDGET,
  parseApplyBudget,
  parseNukeAfter,
  parseOlderThan,
  parseScanBudget,
  renderPrunePlan,
  salvageWaiverMs,
  totalPrunePlan,
} from "../../../worktree/pruneOptions.js";
import { memoryKey, type RepoPlan } from "../../../worktree/pruneOrder.js";
import { scanWasComplete } from "../../../worktree/pruneProgress.js";
import {
  APPLY_LEASE_MS,
  applyDeadlineMs,
  applyLeaseRefusal,
  type RepoShortfall,
  unreachedLine,
} from "../../../worktree/pruneSweep.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import type { ParsedFlags } from "../../parseFlags.js";
import { parseWorktreeArgs, stringFlag, VERB_ARG_OFFSET, worktreeUsage } from "./core.js";
import { acquirePruneApplyLock } from "./pruneApplyLock.js";
import { applyPlans } from "./pruneApplyPass.js";
import { applyRefusal, readLiveState } from "./pruneLiveState.js";
import { measurePlans, type RepoQueue, selectRepos } from "./pruneScanPass.js";
import { scanPhase } from "./pruneScanPhase.js";

/** Parse `prune`'s flags, printing help/errors as it goes. Returns the exit code to stop on, or the flags. */
function parsePruneVerb({ argv }: { argv: readonly string[] }): ParsedFlags | number {
  const rest = argv.slice(VERB_ARG_OFFSET);
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: worktreeUsage({ verb: "prune" }) });
    return EXIT_OK;
  }
  const parsed = parseWorktreeArgs({ rest, verb: "prune" });
  if (parsed.isErr()) {
    parsed.error.forEach((error) => {
      logger.error({ msg: error });
    });
    logger.error({ msg: worktreeUsage({ verb: "prune" }) });
    return EXIT_USAGE;
  }
  return parsed.value;
}

/** The machine-readable shape `--json` prints: the same verdicts, minus the rendering. */
function jsonReport({ plans, olderThanMs }: { plans: readonly RepoPlan[]; olderThanMs: number }): string {
  const verdicts = plans.flatMap((plan) => plan.verdicts.map((verdict) => ({ ...verdict, repo: plan.repoRoot })));
  return JSON.stringify({ olderThanMs, totals: totalPrunePlan({ verdicts }), worktrees: verdicts }, null, 2);
}

/** What a parsed, validated invocation resolved to — or the exit code the caller should stop on. */
interface PruneOptions {
  readonly apply: boolean;
  readonly budgetMs: number;
  /** Step aside for another apply rather than wait for it — the automatic triggers (`./pruneApplyLock.ts`). */
  readonly ifIdle: boolean;
  readonly json: boolean;
  readonly mergedOnly: boolean;
  /** No tree is salvaged, so nothing is pushed: `nukeAfterMs` is then infinite (`salvageWaiverMs`). */
  readonly noSalvage: boolean;
  readonly nukeAfterMs: number;
  readonly olderThanMs: number;
  readonly repos: readonly string[];
  readonly scanBudgetMs: number;
}

/**
 * One duration flag's raw text, or its documented default when the caller did not pass it.
 *
 * Named rather than written as `??` at three call sites: a missing flag is the ordinary case and the
 * default it resolves to is part of this verb's contract, so the substitution is stated out loud.
 *
 * @param parsed the parsed flags
 * @param name the flag to read
 * @param fallback the default this verb documents for it
 * @returns the caller's value, or the default
 */
function flagOr({ parsed, name, fallback }: { parsed: ParsedFlags; name: string; fallback: string }): string {
  const value = stringFlag({ name, parsed });
  if (value === undefined) {
    return fallback;
  }
  return value;
}

/** The four durations `prune` takes, once every one of them has parsed. */
interface PruneDurations {
  readonly budgetMs: number;
  readonly nukeAfterMs: number;
  readonly olderThanMs: number;
  readonly scanBudgetMs: number;
}

/**
 * Parse all four duration flags, reporting EVERY one that failed rather than only the first.
 *
 * A caller who mistyped two of them should learn both in one run. That is also why the coherence check
 * between them lives here: it can only be made once all four have values, and it is the one rule about the
 * flags as a SET rather than about any of them alone.
 *
 * @param parsed the already-parsed flag table
 * @returns the four durations, or `null` when at least one was refused and the reasons are printed
 */
function resolveDurations({ parsed }: { parsed: ParsedFlags }): PruneDurations | null {
  const olderThan = parseOlderThan({ value: flagOr({ fallback: DEFAULT_OLDER_THAN, name: "older-than", parsed }) });
  const nukeAfter = parseNukeAfter({ value: flagOr({ fallback: DEFAULT_NUKE_AFTER, name: "nuke-after", parsed }) });
  const budget = parseApplyBudget({ value: flagOr({ fallback: DEFAULT_APPLY_BUDGET, name: "budget", parsed }) });
  const scanBudget = parseScanBudget({
    value: flagOr({ fallback: DEFAULT_SCAN_BUDGET, name: "scan-budget", parsed }),
  });
  if (olderThan.isErr() || nukeAfter.isErr() || budget.isErr() || scanBudget.isErr()) {
    [
      ...(olderThan.isErr() ? olderThan.error : []),
      ...(nukeAfter.isErr() ? nukeAfter.error : []),
      ...(budget.isErr() ? budget.error : []),
      ...(scanBudget.isErr() ? scanBudget.error : []),
    ].forEach((error) => {
      logger.error({ msg: error });
    });
    return null;
  }
  // A waiver SHORTER than the eligibility age would mean a tree became nukeable before it became cold,
  // which is not a stricter reading of either rule but an incoherent one. Refused rather than reordered,
  // because either flag could be the one the caller mistyped and this verb cannot know which.
  if (nukeAfter.value < olderThan.value) {
    logger.error({
      msg: `worktree prune: --nuke-after must not be shorter than --older-than (got ${String(nukeAfter.value)}ms against ${String(olderThan.value)}ms)`,
    });
    return null;
  }
  return {
    budgetMs: budget.value,
    nukeAfterMs: nukeAfter.value,
    olderThanMs: olderThan.value,
    scanBudgetMs: scanBudget.value,
  };
}

/** Resolve `prune`'s flags into options, printing every usage error. Returns the exit code to stop on. */
function resolveOptions({ argv }: { argv: readonly string[] }): PruneOptions | number {
  const parsed = parsePruneVerb({ argv });
  if (typeof parsed === "number") {
    return parsed;
  }
  const durations = resolveDurations({ parsed });
  if (durations === null) {
    return EXIT_USAGE;
  }
  const noSalvage = parsed.values["no-salvage"] === true;
  // A waiver age and "never waive" are two answers to one question; taking both would silently drop one.
  if (noSalvage && stringFlag({ name: "nuke-after", parsed }) !== undefined) {
    logger.error({
      msg: "worktree prune: --no-salvage means no tree is ever salvaged, so --nuke-after has nothing to set",
    });
    return EXIT_USAGE;
  }
  const selection = selectRepos({ noSalvage, repo: stringFlag({ name: "repo", parsed }) });
  if (selection.kind === "refused") {
    logger.error({ msg: selection.line });
    return EXIT_USAGE;
  }
  const apply = parsed.values["apply"] === true;
  const ifIdle = parsed.values["if-idle"] === true;
  if (ifIdle && !apply) {
    logger.error({ msg: "worktree prune: --if-idle only decides how an --apply meets another one; pass --apply too" });
    return EXIT_USAGE;
  }
  return {
    apply,
    ifIdle,
    json: parsed.values["json"] === true,
    mergedOnly: parsed.values["merged-only"] === true,
    noSalvage,
    repos: selection.repos,
    ...durations,
    nukeAfterMs: salvageWaiverMs({ noSalvage, nukeAfterMs: durations.nukeAfterMs }),
  };
}

/** Print the plan, as the rendered classes or as the machine-readable report. */
function printPlan({ plans, options }: { plans: readonly RepoPlan[]; options: PruneOptions }): void {
  if (options.json) {
    logger.out({ line: jsonReport({ olderThanMs: options.olderThanMs, plans }) });
    return;
  }
  const verdicts = plans.flatMap((plan) => plan.verdicts);
  renderPrunePlan({ measured: !options.apply, totals: totalPrunePlan({ verdicts }), verdicts }).forEach((line) => {
    logger.out({ line });
  });
}

/**
 * Say what the scan budget never looked at, so a partial census cannot read as a whole one.
 *
 * Onto stderr under `--json` for the same reason the dry-run notice is: a caller piping stdout into `jq`
 * gets one document and not a document with a sentence after it.
 *
 * @param shortfalls every repository's scanned and unreached counts
 * @param json whether stdout is carrying a machine-readable document
 */
function reportShortfall({ shortfalls, json }: { shortfalls: readonly RepoShortfall[]; json: boolean }): void {
  const line = unreachedLine({ shortfalls });
  if (line === undefined) {
    return;
  }
  if (json) {
    logger.error({ msg: `worktree prune: ${line}` });
    return;
  }
  logger.out({ line });
}

/** The operation lock one `--apply` holds under `$SLOPWEAVER_HOME` for its whole run — the slot and a manual drain share it. */
const APPLY_LOCK_KEY = "worktree-prune-apply";

/**
 * The `memoryKey` of every worktree the queued repositories register, scanned this run or not.
 *
 * @param queues the repositories whose worktree list this run read
 * @returns one key per registered tree
 */
function registeredKeys({ queues }: { queues: readonly RepoQueue[] }): ReadonlySet<string> {
  return new Set(
    queues.flatMap((queue) =>
      queue.entries.map((entry) => memoryKey({ path: entry.worktree.path, repoRoot: queue.repoRoot })),
    ),
  );
}

/**
 * Say a dry run deleted nothing — never onto stdout under `--json`: a caller piping this into `jq` gets one
 * document, not a document with a sentence after it. Measured on a live run, where exactly that broke the
 * first parse.
 */
function printDryRunNotice({ json }: { json: boolean }): void {
  const notice = "worktree prune: dry run — nothing was deleted; pass --apply to act on the safe class";
  if (json) {
    logger.error({ msg: notice });
    return;
  }
  logger.out({ line: notice.replace("worktree prune: ", "") });
}

/**
 * Say that salvage was off, so a held tree carrying work no remote has reads as kept on purpose rather than as a
 * waiver that failed. Onto stderr under `--json`, as {@link printDryRunNotice} is.
 */
function printNoSalvageNotice({ json }: { json: boolean }): void {
  const notice =
    "worktree prune: salvage off (--no-salvage) — a tree carrying work no remote has is held, never pushed";
  if (json) {
    logger.error({ msg: notice });
    return;
  }
  logger.out({ line: notice.replace("worktree prune: ", "") });
}

/**
 * Scan, plan and — on `--apply` — act, under options already resolved.
 *
 * @param options the resolved flags
 * @param lockHeld whether this run still holds the apply lock — always true for a dry run, which removes and
 *   writes nothing so takes no lock and has none to lose
 * @returns the process exit code — non-zero on a repository that could not be read, or a removal that failed
 *   part-way; the hourly row runs again at its next slot either way
 */
async function prune({ options, lockHeld }: { options: PruneOptions; lockHeld: () => boolean }): Promise<number> {
  const live = await readLiveState();
  const refused = applyRefusal({ apply: options.apply, live, verb: "worktree prune" });
  if (refused !== null) {
    logger.error({ msg: refused.line });
    return refused.exitCode;
  }
  const scanned = scanPhase({ ...options, home: slopweaverHome(), live, lockHeld });
  // The lock went mid-scan, so the run holding it now does the work: nothing is left for this one.
  if (scanned === null) {
    return EXIT_EXPECTED_EMPTY;
  }
  const { pass, queues } = scanned;
  // A dry run has to measure up front — the number IS its output. An apply does not: it reads free space
  // from the filesystem either side of the whole run, which is both cheaper and the truer figure.
  const plans = options.apply ? pass.plans : measurePlans({ plans: pass.plans });
  printPlan({ options, plans });
  reportShortfall({ json: options.json, shortfalls: pass.shortfalls });
  if (options.noSalvage) {
    printNoSalvageNotice({ json: options.json });
  }
  // THE fix for this verb's two-week silent failure: the removals get their own budget, counted from the
  // instant the scan ended rather than from process start. See `worktree/pruneSweep.ts`'s header.
  const deadlineMs = applyDeadlineMs({ budgetMs: options.budgetMs, scanEndedMs: pass.endedMs });
  const complete = queues.length === options.repos.length;
  if (!options.apply) {
    printDryRunNotice({ json: options.json });
    return complete ? EXIT_OK : EXIT_ERROR;
  }
  const applied = await applyPlans({
    deadlineMs,
    listed: new Set(queues.map((queue) => queue.repoRoot)),
    lockHeld,
    mergedOnly: options.mergedOnly,
    olderThanMs: options.olderThanMs,
    plans,
    registered: registeredKeys({ queues }),
    repos: options.repos,
    scanComplete: scanWasComplete({
      asked: options.repos.length,
      read: queues.length,
      unreached: pass.shortfalls.map((shortfall) => shortfall.unreached),
    }),
  });
  return complete && applied.failed === 0 ? EXIT_OK : EXIT_ERROR;
}

/**
 * `worktree prune` — plan, and on `--apply`, remove the stale worktrees the safety rules clear.
 *
 * One `--apply` per `$SLOPWEAVER_HOME` at a time — the hourly slot and a manual drain run under the same home, and a
 * second home declares its own main checkouts. The row fires hourly (`live/automation/standingRows.ts`) and a long manual drain
 * outlives an hour, so a second apply would scan the same trees and race the first one's removals. An
 * `--if-idle` run (the hourly row, the threshold trigger) steps aside at once, exiting `EXIT_EXPECTED_EMPTY`
 * because the holder is already doing its work; any other WAITS for the holder, up to its own scan and
 * removal budgets, so an asked-for drain is never lost to an automatic run (`./pruneApplyLock.ts`). A dead holder's lock is taken over at once — unless its
 * pid was already reused, which signal 0 cannot tell from the holder, so the lease decides — and a live
 * one's after `APPLY_LEASE_MS`, so a holder wedged on something no bound covers cannot hold it for good (a
 * salvage push is stopped at fifty minutes by `writeGit`); an apply whose budgets could outlast that lease is refused before it starts.
 *
 * @param argv the full process argv
 * @returns the process exit code — non-zero on a usage error or a repository that could not be read
 */
export async function runWorktreePrune(argv: readonly string[]): Promise<number> {
  const options = resolveOptions({ argv });
  if (typeof options === "number") {
    return options;
  }
  if (!options.apply) {
    return prune({ lockHeld: () => true, options });
  }
  const outlasts = applyLeaseRefusal({ budgetMs: options.budgetMs, scanBudgetMs: options.scanBudgetMs });
  if (outlasts !== null) {
    logger.error({ msg: outlasts });
    return EXIT_USAGE;
  }
  // Before the lock and the scan, not just before a delete: a ballooned fseventsd's swap is what holds the disk
  // under the floor, so every ten minutes the threshold trigger would otherwise spend a full scan for nothing.
  const balloon = fseventsdBalloonHold({ rss: readFseventsdRss() });
  if (balloon !== null) {
    // stderr, so a `--json` caller's stdout stays one document or nothing.
    logger.error({ msg: balloon });
    return EXIT_EXPECTED_EMPTY;
  }
  const home = slopweaverHome();
  const lock = await acquirePruneApplyLock({
    deps: {
      // A retry never ages a live holder out (`./pruneApplyLock.ts`); a finite maximum rather than infinity, which
      // the lock reads as a never-stale lease with rules of its own (`../../../admit/lockHolder.ts`).
      acquire: ({ retry }) =>
        acquireOperationLockDetailed({
          home,
          key: APPLY_LOCK_KEY,
          nowIso: new Date().toISOString(),
          staleAfterMs: retry ? Number.MAX_SAFE_INTEGER : APPLY_LEASE_MS,
        }),
      announce: ({ line }) => {
        logger.error({ msg: line });
      },
      nowMs: () => Date.now(),
      wait: ({ ms }) => setTimeoutPromise(ms),
    },
    ifIdle: options.ifIdle,
    waitBudgetMs: options.scanBudgetMs + options.budgetMs,
  });
  if (lock.kind === "refused") {
    logger.error({
      msg: `worktree prune: the apply lock could not be taken, so nothing was removed — ${lock.message}`,
    });
    return EXIT_ERROR;
  }
  if (lock.kind === "contended") {
    logger.error({
      msg: `worktree prune: another --apply is already running, so this one removed nothing — ${lock.message}`,
    });
    return EXIT_EXPECTED_EMPTY;
  }
  try {
    return await prune({ lockHeld: lock.handle.stillHeld, options });
  } finally {
    lock.handle.release();
  }
}

export const worktreePruneCommand = defineCommand({ run: runWorktreePrune });
