/**
 * `slopweaver session compaction` — what auto-compaction is costing the fleet, what a different window
 * would have cost over the same week, and whether the cost has got worse since anybody last looked.
 *
 * ## The question it exists to answer
 *
 * Compaction is lossy: a quality regression has to be NOTICED, and whether 300k or 400k or 600k performs best per
 * dollar and per hour has to be known. A one-off script could measure a week once and never be run again by
 * anything but a person remembering it existed. The measurement lives in the store
 * (`slopweaver store authored-show --ref handover-evidence/auto-compact-at-300k/compaction.mjs --out <file>`).
 * This is that measurement as a verb, with the sharper re-read definition a boundary's own
 * `preservedMessages.uuids` makes possible.
 *
 * ## Three exit codes, and each is a different answer
 *
 * Without `--check` it always reports and exits 0. With `--check` it is a SIGNAL: `3`
 * ({@link EXIT_EXPECTED_EMPTY}, the channel that file documents for a legitimate non-success status, so
 * `verb || alert` fires) when the dropped-re-read rate has risen past tolerance, and `4`
 * ({@link EXIT_DEFERRED}) when it could not tell — no baseline yet, or too few boundaries. A `0` from
 * `--check` means the comparison ran and held, and nothing else.
 *
 * ## `--alert` is the same verdict for a SCHEDULED row, where those codes mean something else
 *
 * `../recipe/rowRunners.ts` reads a verb-run's `3` as "ran, nothing to do" and its `4` as "deferred, still
 * due" — so a standing row running `--check` would grade a regression a quiet week, and on an unmeasurable
 * one re-walk the whole transcript corpus every tick. `--alert` maps `regressed` to {@link EXIT_ERROR}, the
 * failed-row channel every standing row already reports through, and everything else to {@link EXIT_OK} so
 * the row stamps. The weekly `context-cost-weekly` row (`../../../live/automation/standingMeasurementRows.ts`) runs it.
 *
 * Effectful edge only. The fold is `sessions/compactionFold.ts`, the replay `sessions/compactionWindow.ts`,
 * the document `sessions/compactionReport.ts`, the verdict `sessions/compactionSignal.ts`, and all four are
 * pure.
 */
import { homedir } from "node:os";
import { join } from "node:path";

import { logger } from "../../../lib/logger.js";
import { lastReading, recordReading } from "../../../readings/store.js";
import { renderCompactionReport } from "../../../sessions/compactionRender.js";
import { type CompactionReport, compactionReport } from "../../../sessions/compactionReport.js";
import {
  baselineOf,
  type CompactionBaseline,
  type CompactionSignal,
  compactionVerdict,
} from "../../../sessions/compactionSignal.js";
import { scanCompactions } from "../../../sessions/compactionStore.js";
import { DEFAULT_CANDIDATE_WINDOWS } from "../../../sessions/compactionWindow.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_DEFERRED, EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import type { ParsedFlags } from "../../parseFlags.js";
import { boolFlag, numberFlag, parseSessionArgs, sessionUsage, stringFlag, VERB_ARG_OFFSET } from "./core.js";

/** The verb line this measurement is recorded and looked up under in the readings ledger. */
export const COMPACTION_PRODUCER = "session compaction";

/** How many days back the pass reaches when the caller names none — one week, as the first pass measured. */
export const DEFAULT_COMPACTION_DAYS = 7;

/** Milliseconds in a day, for turning `--days` into the instant the inventory is filtered on. */
const DAY_MS = 86_400_000;

/**
 * The candidate windows a run prices, from `--windows` or the declared default.
 *
 * @param raw the comma-separated list the caller passed, or `undefined`
 * @returns the windows, or the one usage problem
 */
function candidateWindows({
  raw,
}: {
  raw: string | undefined;
}): { readonly windows: readonly number[] } | { readonly error: string } {
  if (raw === undefined) {
    return { windows: DEFAULT_CANDIDATE_WINDOWS };
  }
  const windows = raw.split(",").map((entry) => Number(entry.trim()));
  if (windows.some((entry) => !Number.isInteger(entry) || entry <= 0)) {
    return { error: `--windows must be a comma-separated list of whole token counts, got ${JSON.stringify(raw)}` };
  }
  return { windows };
}

/**
 * The baseline the verdict compares against, or `undefined` with the reason said out loud.
 *
 * A ledger that cannot be read is reported rather than swallowed: silently treating it as "no baseline"
 * would turn a broken ledger into a permanent, quiet `unmeasurable`.
 */
function readBaseline({ home }: { home: string | undefined }): CompactionBaseline | undefined {
  const read = lastReading({ producer: COMPACTION_PRODUCER, ...(home === undefined ? {} : { home }) });
  if (read.isErr()) {
    if (read.error.code !== "NO_READING") {
      logger.error({ msg: `session compaction: the readings ledger could not be read — ${read.error.message}` });
    }
    return undefined;
  }
  const baseline = baselineOf({ document: read.value.document });
  if (!baseline.known) {
    logger.error({ msg: `session compaction: the last reading is not usable as a baseline — ${baseline.why}` });
    return undefined;
  }
  return baseline.value;
}

/** Append this document to the readings ledger, so the next run has something to compare against. */
function record({
  by,
  document,
  report,
  home,
}: {
  by: string;
  document: string;
  report: CompactionReport;
  home: string | undefined;
}): void {
  const written = recordReading({
    by,
    document,
    nowIso: new Date().toISOString(),
    observedAtIso: report.observedAtIso,
    producer: COMPACTION_PRODUCER,
    ...(home === undefined ? {} : { home }),
  });
  if (written.isErr()) {
    logger.error({ msg: `session compaction: the reading was NOT recorded — ${written.error.message}` });
    return;
  }
  logger.error({ msg: `session compaction: reading recorded as ${by} (${written.value.record.readingId})` });
}

/** The exit code one verdict earns under `--check` or `--alert`. Without either, the verb only ever reports. */
function exitFor({ check, alert, signal }: { check: boolean; alert: boolean; signal: CompactionSignal }): number {
  if (alert) {
    if (signal.verdict === "regressed") {
      return EXIT_ERROR;
    }
    return EXIT_OK;
  }
  if (!check) {
    return EXIT_OK;
  }
  if (signal.verdict === "regressed") {
    return EXIT_EXPECTED_EMPTY;
  }
  if (signal.verdict === "unmeasurable") {
    return EXIT_DEFERRED;
  }
  return EXIT_OK;
}

/** How many days back the pass reaches — what `--days` asked for, or the declared default. */
function reachOf({ days }: { days: number | undefined }): number {
  if (days === undefined) {
    return DEFAULT_COMPACTION_DAYS;
  }
  return days;
}

/**
 * Which transcript corpus to walk — the live one, or a directory the caller named.
 *
 * The seam exists so a test can point the shipped runner at a fixture instead of the operator's own
 * `~/.claude/projects`, which is both enormous and different on every machine. It is also the way to
 * measure a corpus copied off another host.
 */
function projectsDirOf({ parsed }: { parsed: ParsedFlags }): string {
  const named = stringFlag({ name: "projects-dir", parsed });
  if (named !== undefined) {
    return named;
  }
  return join(homedir(), ".claude", "projects");
}

/** Build the document and its verdict, or the reason the corpus could not be read. */
function measure({
  parsed,
}: {
  parsed: ParsedFlags;
}): { readonly report: CompactionReport; readonly signal: CompactionSignal } | { readonly error: string } {
  const days = numberFlag({ name: "days", parsed });
  if ("error" in days) {
    return { error: days.error };
  }
  const windows = candidateWindows({ raw: stringFlag({ name: "windows", parsed }) });
  if ("error" in windows) {
    return { error: windows.error };
  }
  const tolerance = stringFlag({ name: "tolerance", parsed });
  if (tolerance !== undefined && !Number.isFinite(Number(tolerance))) {
    return { error: `--tolerance must be a rate between 0 and 1, got ${JSON.stringify(tolerance)}` };
  }
  const reach = reachOf({ days: days.value });
  const sinceMs = Date.now() - reach * DAY_MS;
  const scanned = scanCompactions({ projectsDir: projectsDirOf({ parsed }), sinceMs });
  if (scanned.isErr()) {
    return { error: scanned.error.message };
  }
  scanned.value.problems.forEach((problem) => {
    logger.error({ msg: `session compaction: ${problem} — this pass is INCOMPLETE` });
  });
  const report = compactionReport({
    days: reach,
    observedAtIso: new Date().toISOString(),
    sinceIso: new Date(scanned.value.oldestWriteMs).toISOString(),
    transcripts: scanned.value.transcripts,
    windows: windows.windows,
  });
  const home = stringFlag({ name: "home", parsed });
  return {
    report,
    signal: compactionVerdict({
      baseline: readBaseline({ home }),
      current: report,
      ...(tolerance === undefined ? {} : { tolerance: Number(tolerance) }),
    }),
  };
}

/**
 * Run `session compaction`.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export function runSessionCompaction(argv: readonly string[]): number {
  const rest = argv.slice(VERB_ARG_OFFSET);
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: sessionUsage({ verb: "compaction" }) });
    return EXIT_OK;
  }
  const parsed = parseSessionArgs({ rest, verb: "compaction" });
  if (parsed.isErr()) {
    parsed.error.forEach((error) => {
      logger.error({ msg: error });
    });
    logger.error({ msg: sessionUsage({ verb: "compaction" }) });
    return EXIT_USAGE;
  }
  const check = boolFlag({ name: "check", parsed: parsed.value });
  const alert = boolFlag({ name: "alert", parsed: parsed.value });
  if (check && alert) {
    logger.error({
      msg: "session compaction: --check and --alert answer the same verdict in two exit-code dialects — pass one",
    });
    return EXIT_USAGE;
  }
  const measured = measure({ parsed: parsed.value });
  if ("error" in measured) {
    logger.error({ msg: `session compaction: ${measured.error}` });
    return EXIT_ERROR;
  }
  const { report, signal } = measured;
  const document = JSON.stringify({ ...report, verdict: signal.verdict, verdictBecause: signal.because });
  const by = stringFlag({ name: "record-reading", parsed: parsed.value });
  if (by !== undefined) {
    record({ by, document, home: stringFlag({ name: "home", parsed: parsed.value }), report });
  }
  if (boolFlag({ name: "json", parsed: parsed.value })) {
    logger.out({ line: document });
    return exitFor({ alert, check, signal });
  }
  renderCompactionReport({ report, signal }).forEach((line) => {
    logger.out({ line });
  });
  return exitFor({ alert, check, signal });
}

export const sessionCompactionCommand = defineCommand({ run: runSessionCompaction });
