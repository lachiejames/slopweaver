/**
 * `slopweaver checkout sync` — fast-forward each declared main checkout onto its own upstream, and install
 * when that pull made `node_modules` wrong.
 *
 * This is the "post-pull install, by construction" half: the pull and the install are ONE operation, because
 * a remembered second step is a step that gets skipped, and the skip shows up somewhere else entirely. Every
 * run prints one line saying whether it installed and why — including when it did not, so a silent absence
 * is never mistaken for a decision.
 *
 * A checkout serving the production console (`scripts/docs-site.sh --serve`) is then asked to rebuild onto
 * the new HEAD — the owner's "can't we just use a hook for doing that automatically when main moves?" —
 * and the `console:` line says whether it did, was already current, or had one running already.
 *
 * It fast-forwards ONLY. A branch that cannot fast-forward, a dirty tree, or a checkout tracking nothing is
 * reported and left alone: rebasing a long-lived branch without a human is explicitly out of scope. A FAILED
 * `--ff-only` is re-measured before it is named: only a branch both ahead of and behind its upstream is
 * "diverged"; one still a clean fast-forward failed on something transient (a lock) and is retried.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

import { absentAsEmpty, absentAsNumber } from "#lib/absent.js";
import { sleepSync } from "#lib/sleepSync.js";
import {
  type CheckoutFreshness,
  INSTALL_FIX_COMMAND,
  parseNameOnly,
  renderCheckoutFreshness,
} from "../../../checkouts/freshness.js";
import {
  type CheckoutInspectDeps,
  changedPathsBetween,
  driftAgainst,
  inspectCheckout,
  type MainCheckoutConfig,
  productionInspectDeps,
} from "../../../checkouts/inspect.js";
import { runImmutableInstall, unshareExecInodes } from "../../../checkouts/install.js";
import { recordInstallVerified } from "../../../checkouts/installMark.js";
import { classifyFailedFastForward, installDecision, syncPreflightRefusal } from "../../../checkouts/sync.js";
import { logger } from "../../../lib/logger.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { checkoutUsage, parseCheckoutArgs, selectCheckouts, stringFlag, VERB_ARG_OFFSET } from "./core.js";
import { declaredCheckouts, NOTHING_DECLARED } from "./statusRun.js";
import { type CheckoutSyncError, CheckoutSyncErrors } from "./syncErrors.js";

/** One checkout's sync result, so the caller can report every checkout and still exit non-zero on any failure. */
interface SyncOutcome {
  readonly ok: boolean;
  readonly lines: readonly string[];
}

/** The commit a checkout's HEAD currently points at, or undefined when it cannot be read. */
function headSha({ cwd, deps }: { cwd: string; deps: CheckoutInspectDeps }): string | undefined {
  return deps.git({ args: ["rev-parse", "HEAD"], cwd });
}

/**
 * How many times a fast-forward is attempted while the branch stays a clean fast-forward of its upstream.
 * The failure this absorbs is a lock another git process holds for milliseconds (`classifyFailedFastForward`).
 */
const FAST_FORWARD_ATTEMPTS = 3;

/** The pause between two attempts. Unmeasured as an optimum; named so a later measurement can move it. */
const FAST_FORWARD_RETRY_MS = 100;

/**
 * Run `git merge --ff-only` until it lands, the refs show it no longer needs to, or the refs show a reason it
 * cannot — re-measuring after every failure, because the exit alone cannot tell a lock from a divergence.
 */
function mergeUntilSettled({
  config,
  upstream,
  deps,
  wait,
}: {
  config: MainCheckoutConfig;
  upstream: string;
  deps: CheckoutInspectDeps;
  wait: (args: { ms: number }) => void;
}): Result<true, CheckoutSyncError> {
  for (let attempt = 1; attempt <= FAST_FORWARD_ATTEMPTS; attempt += 1) {
    if (deps.git({ args: ["merge", "--ff-only", upstream], cwd: config.path }) !== undefined) {
      return ok(true);
    }
    const state = classifyFailedFastForward({
      drift: driftAgainst({ cwd: config.path, deps, ref: upstream }),
    });
    if (state === "upstream-contained") {
      return ok(true);
    }
    if (state === "diverged") {
      return err(CheckoutSyncErrors.diverged({ upstream }));
    }
    if (state === "unmeasurable") {
      return err(CheckoutSyncErrors.driftUnreadable({ upstream }));
    }
    if (attempt < FAST_FORWARD_ATTEMPTS) {
      wait({ ms: FAST_FORWARD_RETRY_MS });
    }
  }
  return err(CheckoutSyncErrors.fastForwardBusy({ attempts: FAST_FORWARD_ATTEMPTS, upstream }));
}

/** Fast-forward one checkout onto its upstream, returning the paths the pull changed, or the failure. */
function fastForward({
  config,
  upstream,
  deps,
  wait,
}: {
  config: MainCheckoutConfig;
  upstream: string;
  deps: CheckoutInspectDeps;
  wait: (args: { ms: number }) => void;
}): Result<readonly string[], CheckoutSyncError> {
  const before = headSha({ cwd: config.path, deps });
  if (before === undefined) {
    return err(CheckoutSyncErrors.headUnreadable({ when: "before" }));
  }
  const merged = mergeUntilSettled({ config, deps, upstream, wait });
  if (merged.isErr()) {
    return err(merged.error);
  }
  // Read after, never assumed: when another process completed the same fast-forward, HEAD still moved and
  // the paths it brought in still decide the install below.
  const after = headSha({ cwd: config.path, deps });
  if (after === undefined) {
    return err(CheckoutSyncErrors.headUnreadable({ when: "after" }));
  }
  const diff = deps.git({ args: ["diff", "--name-only", before, after], cwd: config.path });
  return ok(diff === undefined ? [] : parseNameOnly({ text: diff }));
}

/** The install half of one sync: decide, run (unless `--dry-run`), and say what happened either way. */
function installStep({
  config,
  changedPaths,
  before,
  dryRun,
}: {
  config: MainCheckoutConfig;
  changedPaths: readonly string[];
  before: CheckoutFreshness;
  dryRun: boolean;
}): SyncOutcome {
  const decision = installDecision({ changedPaths, installBefore: before.install });
  if (!decision.install) {
    return { lines: [`  install: skipped — ${decision.why}`], ok: true };
  }
  if (dryRun) {
    return { lines: [`  install: WOULD run \`${INSTALL_FIX_COMMAND}\` — ${decision.why}`], ok: true };
  }
  const failure = runImmutableInstall({ cwd: config.path });
  if (failure !== undefined) {
    return {
      lines: [`  install: \`${INSTALL_FIX_COMMAND}\` FAILED — ${decision.why}`, `    ${failure}`],
      ok: false,
    };
  }
  // The install that just succeeded is the only thing that knows it ran: yarn writes nothing when the tree
  // already matched, so the re-measured verdict below reads this mark rather than a yarn file that never
  // moved. Without it the sync reports STALE immediately after its own successful install, and asks for the
  // install it just ran — MEASURED, `../../../checkouts/installMark.ts` carries the reproduction.
  const unmarked = recordInstallVerified({ nowIso: new Date().toISOString(), root: config.path });
  const markLines =
    unmarked === undefined
      ? []
      : [`  install: mark NOT WRITTEN — the verdict below may read STALE despite this install: ${unmarked}`];
  return {
    lines: [
      `  install: ran \`${INSTALL_FIX_COMMAND}\` — ${decision.why}`,
      ...markLines,
      `  ${unshareExecInodes({ root: config.path })}`,
    ],
    ok: unmarked === undefined,
  };
}

/** The script that owns the console server's lifecycle, relative to a checkout. */
const DOCS_SITE_SCRIPT = join("scripts", "docs-site.sh");

/** The prefix every `docs-site.sh` line opens with, dropped because the sync's own `console:` label replaces it. */
const DOCS_SITE_PREFIX = "docs-site: ";

/**
 * The one `console:` line a sync prints, from whatever the console refresh printed.
 *
 * The refresh's LAST line is its verdict — not serving here, already current, already rebuilding, or
 * rebuilding now in the background — so that is the line carried. A refresh that printed nothing is named
 * as such rather than rendered as a blank label.
 *
 * @param printed everything `docs-site.sh --refresh --background` wrote to stdout
 * @param status its exit code, `null` when it never ran to an exit
 * @returns the line, indented under the checkout's own
 */
export function consoleRefreshLine({ printed, status }: { printed: string; status: number | null }): string {
  const last = printed.trim().split("\n").at(-1)!.trim();
  if (last === "") {
    return `  console: the refresh printed nothing and exited ${String(status)}`;
  }
  const verdict = last.startsWith(DOCS_SITE_PREFIX) ? last.slice(DOCS_SITE_PREFIX.length) : last;
  if (status !== 0) {
    return `  console: refresh FAILED (exit ${String(status)}) — ${verdict}`;
  }
  return `  console: ${verdict}`;
}

/**
 * Ask a checkout's production console to come onto the HEAD the fast-forward just moved it to.
 *
 * The rebuild itself runs in the background inside the script, so this returns in well under a second. The
 * post-merge hook the fast-forward fired asks for the same refresh; whichever arrives second is told one is
 * already running, which is the line this prints then. A checkout with no `docs-site.sh` — any repository
 * that is not this one — has no console to refresh, and says so.
 *
 * @param cwd the checkout that moved
 * @returns the `console:` line
 */
function refreshConsole({ cwd }: { cwd: string }): string {
  const script = join(cwd, DOCS_SITE_SCRIPT);
  if (!existsSync(script)) {
    return `  console: no ${DOCS_SITE_SCRIPT} in this checkout — nothing to rebuild`;
  }
  const run = spawnSync("bash", [script, "--refresh", "--background"], { cwd, encoding: "utf8" });
  return consoleRefreshLine({ printed: `${run.stdout}${run.stderr}`, status: run.status });
}

/**
 * Sync one checkout: measure, refuse or fast-forward, install if the pull made the tree wrong, bring its
 * console onto the new HEAD, re-measure.
 *
 * @param config the checkout to sync
 * @param deps the git/stat read seams
 * @param dryRun whether to report the decisions without performing them
 * @param nowMs the current wall-clock, for the re-measured report's fetch-age line
 * @param refresh the console refresh seam — the real `docs-site.sh --refresh --background` in production, a
 *   plain fake in a unit test
 * @param wait the pause between fast-forward attempts — a real `sleepSync` in production, a recorder in a test
 * @returns the outcome and the lines to print
 */
export function syncOneCheckout({
  config,
  deps,
  dryRun,
  nowMs,
  refresh = refreshConsole,
  wait = sleepSync,
}: {
  config: MainCheckoutConfig;
  deps: CheckoutInspectDeps;
  dryRun: boolean;
  nowMs: number;
  refresh?: (args: { cwd: string }) => string;
  wait?: (args: { ms: number }) => void;
}): SyncOutcome {
  // `current`, not `thorough`: a sync needs fresh refs and a working-tree read before it changes anything,
  // and has no use for the 90-second reference scan.
  const before = inspectCheckout({ config, deps, depth: "current" });
  const refusal = syncPreflightRefusal({ freshness: before });
  if (refusal !== undefined) {
    return { lines: [`${config.path}: REFUSED — ${refusal}`], ok: false };
  }
  const upstream = before.upstream;
  if (upstream === undefined) {
    return { lines: [`${config.path}: REFUSED — no upstream to fast-forward onto`], ok: false };
  }
  // A dry run still READS what the fast-forward would bring in. Reporting the install decision against an
  // empty change list would print "the pull touched no dependency file" without having looked, which is the
  // false-report class this whole feature exists to close.
  const pulled = dryRun
    ? ok<readonly string[], string>(
        absentAsEmpty({ value: changedPathsBetween({ cwd: config.path, deps, from: "HEAD", to: upstream }) }),
      )
    : fastForward({ config, deps, upstream, wait });
  if (pulled.isErr()) {
    return { lines: [`${config.path}: REFUSED — ${pulled.error.message}`], ok: false };
  }
  const pullLine = dryRun
    ? `${config.path}: WOULD fast-forward ${String(absentAsNumber({ value: before.drift?.behind, whenAbsent: 0 }))} commit(s) onto ${upstream}`
    : `${config.path}: fast-forwarded onto ${upstream} (${String(pulled.value.length)} file(s) changed)`;
  const install = installStep({ before, changedPaths: pulled.value, config, dryRun });
  // After the install, never before: a build against a node_modules that does not match the lockfile builds
  // nothing useful — the same order lefthook's post-merge runs its three commands in.
  const consoleLine = dryRun
    ? "  console: not asked — a dry run moves no HEAD for it to rebuild onto"
    : refresh({ cwd: config.path });
  const after = inspectCheckout({ config, deps, depth: "cheap" });
  return {
    lines: [pullLine, ...install.lines, consoleLine, ...renderCheckoutFreshness({ freshness: after, nowMs })],
    ok: install.ok,
  };
}

/**
 * `checkout sync` — fast-forward each declared main checkout and install when the pull requires it.
 *
 * @param argv the full process argv
 * @returns the process exit code — non-zero when any checkout refused or failed to install
 */
export function runCheckoutSync(argv: readonly string[]): number {
  const rest = argv.slice(VERB_ARG_OFFSET);
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: checkoutUsage({ verb: "sync" }) });
    return EXIT_OK;
  }
  const parsed = parseCheckoutArgs({ rest, verb: "sync" });
  if (parsed.isErr()) {
    parsed.error.forEach((error) => {
      logger.error({ msg: error });
    });
    logger.error({ msg: checkoutUsage({ verb: "sync" }) });
    return EXIT_USAGE;
  }
  const home = stringFlag({ name: "home", parsed: parsed.value });
  const path = stringFlag({ name: "path", parsed: parsed.value });
  const configs = selectCheckouts({ configs: declaredCheckouts({ home }), path });
  if (configs.length === 0) {
    logger.error({
      msg: path === undefined ? NOTHING_DECLARED : `checkout sync: no declared main checkout at ${path}`,
    });
    return path === undefined ? EXIT_OK : EXIT_USAGE;
  }
  const deps = productionInspectDeps();
  const dryRun = parsed.value.values["dry-run"] === true;
  const nowMs = Date.now();
  const outcomes = configs.map((config) => syncOneCheckout({ config, deps, dryRun, nowMs }));
  for (const line of outcomes.flatMap((outcome) => outcome.lines)) {
    logger.out({ line });
  }
  return outcomes.every((outcome) => outcome.ok) ? EXIT_OK : EXIT_ERROR;
}

export const checkoutSyncCommand = defineCommand({ run: runCheckoutSync });
