/**
 * `slopweaver codex watch` — the foreground burn watch: sample Codex's own rate-limit log, judge the pace,
 * and open ONE visible investigation when it is genuinely anomalous.
 *
 * ## It is FOREGROUND, and that is rule 2 rather than a limitation
 *
 * A timer in this process, in a session the owner can see and Ctrl-C. Nothing detaches, nothing is resident,
 * and there is no daemon mode to add later — a watch they cannot interrupt is exactly the shape rule 2 bans.
 * What it may OPEN is likewise a visible `cmux spawn`, pinned to Opus.
 *
 * ## Three modes, and only one can open anything
 *
 * | flags | reads | journals | spawns |
 * | --- | --- | --- | --- |
 * | `--once --dry-run` | yes | no | no |
 * | `--once` | yes | yes | no |
 * | (recurring) | yes | yes | yes |
 *
 * `--once --dry-run` is the one to run before trusting any of this: it prints the verdict and the trigger
 * count over the real rollout history without writing a byte, which is the replay the plan asks for before
 * recurring spawning is enabled.
 *
 * ## The timer polls for EVENTS, not for new samples
 *
 * Codex writes a `token_count` event when it feels like it — five in a busy minute, none on an idle night —
 * so a tick that finds nothing new is the ordinary case and journals nothing. Deduplication is by source
 * event id (`../../../codex/drawdownJournal.ts`), so re-reading the same bounded tail on every tick cannot
 * make one event contribute to the baseline twice.
 */

import { spawnCodexDrawdownInvestigation } from "../../../codex/drawdownInvestigation.js";
import {
  appendCodexDrawdownJournal,
  claimCodexDrawdownEpisode,
  readCodexDrawdownJournal,
} from "../../../codex/drawdownJournalStore.js";
import {
  type CodexDrawdownTickMode,
  type CodexDrawdownTickOutcome,
  processCodexDrawdownTick,
} from "../../../codex/drawdownTick.js";
import { scanCodexGaugeSeries } from "../../../codex/gaugeSeries.js";
import { currentBranch } from "../../../codex/gitDiff.js";
import { resolveCodexHome } from "../../../codex/quotaLog.js";
import type { IngestError } from "../../../lib/ingestError.js";
import { logger } from "../../../lib/logger.js";
import type { Result } from "../../../lib/result.js";
import { safeJsonStringify } from "../../../lib/safeJson.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { resolveHome } from "../../optionParsers.js";
import { type FlagSpec, type ParsedFlags, parseFlags } from "../../parseFlags.js";
import { codexRepoRoot } from "./repoScope.js";

/** How many argv entries precede a verb's own flags (`node`, `slopweaver`, `codex`, `watch`). */
const VERB_ARG_OFFSET = 4;

/** The default poll interval, in seconds. Codex writes an event per turn, so a minute is already generous. */
const DEFAULT_INTERVAL_SECONDS = 300;

/** The shortest interval the verb accepts — below this it is re-reading the same tail for nothing. */
const MINIMUM_INTERVAL_SECONDS = 30;

/** Milliseconds in a second. */
const MS_PER_SECOND = 1000;

/** The flags `codex watch` accepts. Names omit the leading `--`, which is what `parseFlags` expects. */
const WATCH_FLAGS = {
  boolean: ["once", "dry-run", "json"],
  string: ["home", "codex-home", "repo", "interval-seconds"],
} as const satisfies FlagSpec;

/**
 * The same flags, `--`-prefixed, for the help-truth ratchet — derived rather than retyped, for the reason
 * `./statusRun.ts` gives.
 */
export const CODEX_WATCH_FLAG_NAMES: readonly string[] = [...WATCH_FLAGS.string, ...WATCH_FLAGS.boolean]
  .map((name) => `--${name}`)
  .toSorted();

/**
 * Parse `codex watch` flags. Exported so the help-truth ratchet probes the REAL parser.
 *
 * @param rest the verb's argument tail
 * @returns the parsed flags, or the errors
 */
export function parseCodexWatchArgs({ rest }: { rest: readonly string[] }): Result<ParsedFlags> {
  return parseFlags({ args: rest, spec: WATCH_FLAGS });
}

/** One declared string flag, or `undefined`. */
function stringFlag({ parsed, name }: { parsed: ParsedFlags; name: string }): string | undefined {
  const value = parsed.values[name];
  return typeof value === "string" ? value : undefined;
}

/** The Codex home watched: `--codex-home`, else this machine's own — the caller not caring is a real answer. */
function watchedCodexHome({ codexHomeFlag }: { codexHomeFlag: string | undefined }): string {
  if (codexHomeFlag === undefined) {
    return resolveCodexHome();
  }
  return codexHomeFlag;
}

/** Usage for `codex watch`, kept beside the verb so `--help` and the parser share one string. */
const WATCH_USAGE =
  "usage: slopweaver codex watch [--once] [--dry-run] [--interval-seconds <n>] [--repo <dir>]\n" +
  "                             [--home <dir>] [--codex-home <dir>] [--json]\n" +
  "\n" +
  "Samples Codex's own rate-limit log, judges the pace against this account's measured normal, and opens ONE\n" +
  "visible Opus session when it is genuinely anomalous. Foreground only — Ctrl-C stops it.\n" +
  "\n" +
  "  --once      run a single pass. It records what it has not seen and NEVER opens an investigation.\n" +
  "  --dry-run   read and report, writing nothing and opening nothing. Implies a single pass.\n" +
  "\n" +
  "A quiet report is never a claim that consumption is ordinary: WARMING and INSUFFICIENT-COVERAGE are\n" +
  "verdicts in their own right, and only ANOMALY can open anything.";

/**
 * Which mode the flags select.
 *
 * `--dry-run` wins over everything: a caller who asked to write nothing gets a pass that writes nothing,
 * whatever else they typed.
 *
 * @param dryRun whether `--dry-run` was given
 * @param once whether `--once` was given
 * @returns the mode
 */
function modeFor({ dryRun, once }: { dryRun: boolean; once: boolean }): CodexDrawdownTickMode {
  if (dryRun) {
    return "dry-run";
  }
  if (once) {
    return "sample-only";
  }
  return "watch";
}

/**
 * The poll interval in seconds, or the reason the flag was refused.
 *
 * @param raw the `--interval-seconds` value, or undefined when the flag was absent
 * @returns the interval, or an error message
 */
function intervalSeconds({ raw }: { raw: string | undefined }): number | string {
  if (raw === undefined) {
    return DEFAULT_INTERVAL_SECONDS;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) {
    return `--interval-seconds must be a whole number of seconds, got ${raw}`;
  }
  if (parsed < MINIMUM_INTERVAL_SECONDS) {
    return `--interval-seconds must be at least ${String(MINIMUM_INTERVAL_SECONDS)}, got ${String(parsed)}`;
  }
  return parsed;
}

/**
 * Watch Codex's budget burn.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export async function runCodexWatch(argv: readonly string[]): Promise<number> {
  const rest = argv.slice(VERB_ARG_OFFSET);
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: WATCH_USAGE });
    return EXIT_OK;
  }
  const parsed = parseCodexWatchArgs({ rest });
  if (parsed.isErr()) {
    parsed.error.forEach((problem) => {
      logger.error({ msg: problem });
    });
    logger.error({ msg: WATCH_USAGE });
    return EXIT_USAGE;
  }
  const interval = intervalSeconds({ raw: stringFlag({ name: "interval-seconds", parsed: parsed.value }) });
  if (typeof interval === "string") {
    logger.error({ msg: interval });
    logger.error({ msg: WATCH_USAGE });
    return EXIT_USAGE;
  }
  // An absent flag means this checkout, this install and this machine's Codex home. Each is a real default
  // rather than a value substituted for one that went missing, so each is a function that RETURNS it.
  const repoRoot = codexRepoRoot({ repo: stringFlag({ name: "repo", parsed: parsed.value }) });
  if (repoRoot.isErr()) {
    logger.error({ msg: `codex watch: ${repoRoot.error.message}` });
    return EXIT_ERROR;
  }
  const codexHomeFlag = stringFlag({ name: "codex-home", parsed: parsed.value });
  const homeFlag = stringFlag({ name: "home", parsed: parsed.value });
  const dryRun = parsed.value.values["dry-run"] === true;
  const mode = modeFor({ dryRun, once: parsed.value.values["once"] === true });
  return runLoop({
    codexHome: watchedCodexHome({ codexHomeFlag }),
    home: resolveHome({ named: homeFlag }),
    intervalMs: interval * MS_PER_SECOND,
    json: parsed.value.values["json"] === true,
    mode,
    repoRoot: repoRoot.value,
    single: dryRun || mode === "sample-only",
  });
}

/**
 * The branch an investigation's plan records.
 *
 * A detached HEAD is ordinary here, since a worktree mid-rebase is still worth watching, and so is a
 * checkout whose branch cannot be read at all. Both record the literal `HEAD`, which is what the tree is
 * actually on. Nothing about the investigation needs a branch NAME, so this is a real answer rather than a
 * stand-in for one that went missing.
 *
 * @param read what `currentBranch` resolved
 * @returns the branch, or the literal `HEAD`
 */
function branchToRecord({ read }: { read: Result<string | null, IngestError> }): string {
  if (read.isErr() || read.value === null) {
    return "HEAD";
  }
  return read.value;
}

/**
 * The foreground loop: one pass, then sleep, then another, until the process is interrupted.
 *
 * `single` runs exactly one pass and returns, which is what `--once` and `--dry-run` are for. The recurring
 * arm has no exit condition on purpose — it ends when the owner ends it, which is the visibility rule 2
 * requires and the reason there is no daemon here to add a shutdown protocol to.
 *
 * @param codexHome where Codex's rollout logs live
 * @param home the state home the journal and claims live under
 * @param intervalMs how long to wait between passes
 * @param json emit one machine-readable document per pass instead of rendered lines
 * @param mode what each pass may do
 * @param repoRoot the checkout an investigation would open in
 * @param single run exactly one pass
 * @returns the process exit code
 */
async function runLoop({
  codexHome,
  home,
  intervalMs,
  json,
  mode,
  repoRoot,
  single,
}: {
  codexHome: string;
  home: string;
  intervalMs: number;
  json: boolean;
  mode: CodexDrawdownTickMode;
  repoRoot: string;
  single: boolean;
}): Promise<number> {
  // A detached HEAD is ordinary here — a worktree mid-rebase is still worth watching — so the plan records
  // `HEAD` rather than refusing to start. Nothing about the investigation needs a branch name.
  const branchRead = currentBranch({ cwd: repoRoot });
  const branch = branchToRecord({ read: branchRead });
  let worst = EXIT_OK;
  for (;;) {
    const outcome = await onePass({ branch, codexHome, home, mode, repoRoot });
    report({ json, outcome });
    if (outcome.errors.length > 0) {
      worst = EXIT_ERROR;
    }
    if (single) {
      return worst;
    }
    await sleep({ ms: intervalMs });
  }
}

/**
 * One pass, with the production effects wired in.
 *
 * @param branch the checkout's branch, for an investigation's plan
 * @param codexHome where Codex's rollout logs live
 * @param home the state home
 * @param mode what this pass may do
 * @param repoRoot the checkout an investigation would open in
 * @returns what the pass did
 */
async function onePass({
  branch,
  codexHome,
  home,
  mode,
  repoRoot,
}: {
  branch: string;
  codexHome: string;
  home: string;
  mode: CodexDrawdownTickMode;
  repoRoot: string;
}): Promise<CodexDrawdownTickOutcome> {
  const series = scanCodexGaugeSeries({ codexHome });
  return processCodexDrawdownTick({
    deps: {
      appendJournal: appendCodexDrawdownJournal,
      claimEpisode: claimCodexDrawdownEpisode,
      openInvestigation: ({ episode, nowIso }) =>
        spawnCodexDrawdownInvestigation({ branch, episode, nowIso, repoRoot }),
      readJournal: readCodexDrawdownJournal,
    },
    gauges: series.gauges,
    home,
    mode,
    nowIso: new Date().toISOString(),
  });
}

/**
 * Print one pass.
 *
 * @param json emit one machine-readable document instead of rendered lines
 * @param outcome what the pass did
 * @returns nothing
 */
function report({ json, outcome }: { json: boolean; outcome: CodexDrawdownTickOutcome }): void {
  if (json) {
    logger.out({
      line: safeJsonStringify({
        label: "codex burn tick",
        value: {
          errors: outcome.errors,
          evaluation: outcome.evaluation,
          investigation: outcome.investigation,
          recorded: outcome.recorded,
        },
      }),
    });
    return;
  }
  for (const line of outcome.lines) {
    logger.out({ line });
  }
  if (outcome.recorded > 0) {
    logger.out({ line: `  recorded ${String(outcome.recorded)} new reading(s)` });
  }
  for (const problem of outcome.errors) {
    logger.error({ msg: `codex watch: ${problem}` });
  }
}

/** Wait, so the foreground loop does not spin. */
async function sleep({ ms }: { ms: number }): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

export const codexWatchCommand = defineCommand({ run: runCodexWatch });
