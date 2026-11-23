/**
 * `slopweaver session watch` — the supervisor's SECOND prong, beside the 20-minute sweep.
 *
 * A supervisor that only reads screens to track progress can miss events higher up the screen, yet needs to know
 * what its people are doing. A multi-pronged approach that mixes these tools is best: screen scraping gets a lot
 * but misses a lot, so the 20-minute sweep stays.
 *
 * So this deliberately does NOT replace the sweep. It answers the half a screen read is worst at — did
 * something CHANGE, and is anyone waiting on the owner — from cmux's own hook stream, and it says nothing at
 * all about the half the sweep still owns: what a session actually decided, which lives only in its prose.
 *
 * The cursor AND the fold are persisted, together, as one row in the local store (`cmux/eventState/port.ts`), so
 * a supervisor that restarts RESUMES rather than replaying or skipping. The cursor alone only says where to resume
 * reading; an attention raised in an earlier run, before the cursor it wrote, would otherwise be unreachable on
 * restart. One row written by one compare-and-set means a crash can never leave the fold ahead of its cursor or
 * behind it, and a second watcher racing this one loses visibly and stops, rather than overwriting it. The
 * `--follow` subscription itself is `./watchFollow.ts`.
 *
 * A plain drain ALWAYS reports, or exits non-zero with the socket's reason: cmux hanging up mid-replay once
 * ended it silently with exit 0, and `cmux/resumingDrain.ts` carries that measurement.
 */

import type { CmuxEventStateError } from "../../../cmux/eventState/errors.js";
import { type CmuxEventStatePort, cmuxEventStatePort, type SessionWatchState } from "../../../cmux/eventState/port.js";
import { sessionWatchStart } from "../../../cmux/eventState/start.js";
import { SUPERVISION_EVENT_NAMES } from "../../../cmux/events.js";
import { drainResuming } from "../../../cmux/resumingDrain.js";
import { foldSessionActivity, type SessionActivity } from "../../../cmux/sessionActivity.js";
import { logger } from "../../../lib/logger.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { activityFor } from "../../../sessions/liveSessionStore.js";
import {
  renderSessionWatchRow,
  renderSuppressedSessionWatchRows,
  reportedSessionWatchRows,
  type SessionWatchReport,
  STALE_UNMAPPED_AFTER_MS,
  sessionWatchReportDocument,
  withSessionTitles,
} from "../../../sessions/watchReport.js";
import { claudeProjectsDir } from "../../../transcripts/source.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { resolveHome } from "../../optionParsers.js";
import type { ParsedFlags } from "../../parseFlags.js";
import { numberFlag, numberFlagOr, parseSessionArgs, sessionUsage, stringFlag, VERB_ARG_OFFSET } from "./core.js";
import { watchInventory } from "./seatWallScan.js";
import { DRAIN_QUIET_MS, followEvents, type WatchBatch } from "./watchFollow.js";

/**
 * The hard bound on one non-`--follow` drain, however busy the fleet is, every resumed round included.
 *
 * The quiet timer alone is NOT a bound: on a fleet where something fires every few hundred milliseconds it
 * re-arms forever. `--follow` is how a caller asks to stay subscribed; a plain drain must terminate.
 */
const DRAIN_DEADLINE_MS = 30_000;

/**
 * The most subscriptions one plain drain opens when cmux keeps hanging up mid-replay. A bound, not a
 * measurement: every round must fold at least one event to earn the next, so this caps a stream that trickles.
 */
const DRAIN_MAX_ROUNDS = 20;

/** How long a session must have been silent to count as idle, unless `--idle-minutes` says otherwise. */
export const DEFAULT_IDLE_MINUTES = 10;

/** What a drain says when its cursor had already aged out — printed, and carried in `--json-report`. */
const MISSED_EVENTS_DIAGNOSTIC =
  "the recorded cursor had already aged out of cmux's retained buffer — some events were MISSED, so this batch is not a complete picture";

/** What a drain says when cmux never answered it at all, and it ended on its own deadline. */
const UNANSWERED_DIAGNOSTIC =
  "cmux answered this drain with neither an acknowledgement nor an event before its deadline, so this report read no fleet rather than a quiet one";

/** What a drain says when cmux kept hanging up mid-replay and the resumed rounds could not reach the live edge. */
const TRUNCATED_DIAGNOSTIC =
  "cmux closed the subscription before its replay reached the live edge and resuming did not finish it, so this batch is not a complete picture — the cursor advanced to the last event folded";

/** What the text form prints when there is no row to show, so an empty reading is never an empty file. */
const NO_ROWS_LINE = "session watch: no session rows to report";

/**
 * Write one report to the two output channels.
 *
 * Under `--json` the DATA channel stays the row array it has always been, so a caller joining it to `cmux
 * list --json` keeps working, and the collapsed count goes to stderr instead of being dropped — a gauge
 * quietly declining to show something is the defect this whole windowing exists to fix, so it is never
 * silent about what it withheld. Under `--json-report` the data channel is one document carrying the rows,
 * the count and the instant together (`sessionWatchReportDocument`), for a caller that records the reading.
 * The text form prints {@link NO_ROWS_LINE} when it has nothing else, so stdout is never empty on success.
 *
 * @param report the rows to render and what was collapsed out of them
 * @param asJson whether the caller asked for the machine-readable row array
 * @param asJsonReport whether the caller asked for the whole report as one document
 * @param observedAtIso the instant the rows were judged at
 * @param diagnostics what this drain could not see — carried in the document, printed either way
 */
function emitReport({
  report,
  asJson,
  asJsonReport,
  observedAtIso,
  diagnostics,
}: {
  report: SessionWatchReport;
  asJson: boolean;
  asJsonReport: boolean;
  observedAtIso: string;
  diagnostics: readonly string[];
}): void {
  if (asJsonReport) {
    logger.out({ line: JSON.stringify(sessionWatchReportDocument({ diagnostics, observedAtIso, report })) });
    return;
  }
  const suppressed = renderSuppressedSessionWatchRows({ report });
  if (asJson) {
    logger.out({ line: JSON.stringify(report.rows) });
    if (suppressed !== undefined) {
      logger.warn({ msg: suppressed });
    }
    return;
  }
  for (const row of report.rows) {
    logger.out({ line: renderSessionWatchRow({ row }) });
  }
  if (suppressed !== undefined) {
    logger.out({ line: suppressed });
    return;
  }
  if (report.rows.length === 0) {
    logger.out({ line: NO_ROWS_LINE });
  }
}

/**
 * The report with each Claude Code row's own session title, when it is the `--json-report` document. Only that
 * document carries titles — the tick runs a plain watch beside it, which would read every transcript twice — and
 * only the rows it keeps, each off a bounded tail of its own transcript.
 */
function titledWhenReported({
  asJsonReport,
  report,
}: {
  asJsonReport: boolean;
  report: SessionWatchReport;
}): SessionWatchReport {
  if (!asJsonReport) {
    return report;
  }
  const projectsDir = claudeProjectsDir();
  return {
    ...report,
    rows: withSessionTitles({
      rows: report.rows,
      titleOf: (transcriptId) => activityFor({ projectsDir, sessionId: transcriptId }).title,
    }),
  };
}

/**
 * What a batch could not see, in the order the document carries them.
 *
 * @returns the drain's own diagnostics, before the inventory's
 */
function drainDiagnostics({ batch }: { batch: WatchBatch }): readonly string[] {
  return [
    ...(batch.gap ? [MISSED_EVENTS_DIAGNOSTIC] : []),
    ...(batch.answered ? [] : [UNANSWERED_DIAGNOSTIC]),
    ...(batch.truncated ? [TRUNCATED_DIAGNOSTIC] : []),
  ];
}

/**
 * Fold one batch into the state it started from and commit the fold and its cursor together, in one revision.
 *
 * Committed BEFORE anything is reported: a report printed from a fold the store then refused would describe
 * state no later run can see. A refusal — another watcher committed first, the store is down — leaves the stored
 * row exactly as the winner wrote it, so the events this batch carried are still after its cursor.
 *
 * @param batch the events just drained
 * @param state the stored state this watcher holds: the fold, its cursor and the revision a write pins to
 * @param port where the state is committed
 * @param home the Slopweaver home whose store is written
 * @param nowIso the instant to stamp
 * @returns the committed state, carrying the new revision, or the refusal
 */
export async function foldAndCommit({
  batch,
  state,
  port,
  home,
  nowIso,
}: {
  batch: Pick<WatchBatch, "events" | "highestSeq">;
  state: SessionWatchState;
  port: CmuxEventStatePort;
  home: string;
  nowIso: string;
}): Promise<Result<SessionWatchState, CmuxEventStateError>> {
  const activities = foldSessionActivity({ events: batch.events, prior: state.activities });
  return port.writeSessionWatch({
    activities,
    cursorSeq: batch.highestSeq,
    expectedRevision: state.revision,
    home,
    nowIso,
  });
}

/**
 * Report one batch's already-committed fold.
 *
 * Split out of {@link runSessionWatchOver} so the verb's own body stays the argument handling and the drain's
 * wiring: this is the reporting, and it is the only part that grows when a new output mode is added.
 *
 * @param batch the events just drained and what the drain could not see
 * @param activities the fold, committed, that the report reads
 * @param idleAfterMs how long a quiet session must have been quiet to count as idle
 * @param includeStale whether the caller asked to see the collapsed rows anyway
 * @param asJson whether the caller asked for the machine-readable row array
 * @param asJsonReport whether the caller asked for the whole report as one document
 * @param home the state home whose recorded supervisor pin the screen scan skips
 */
async function reportBatch({
  batch,
  activities,
  idleAfterMs,
  includeStale,
  asJson,
  asJsonReport,
  home,
}: {
  batch: WatchBatch;
  activities: Readonly<Record<string, SessionActivity>>;
  idleAfterMs: number;
  includeStale: boolean;
  asJson: boolean;
  asJsonReport: boolean;
  home: string;
}): Promise<void> {
  const diagnostics = drainDiagnostics({ batch });
  for (const diagnostic of diagnostics) {
    logger.error({ msg: `session watch: ${diagnostic}` });
  }
  const judgedAtIso = new Date().toISOString();
  const inventoried = await watchInventory({ activities, home, idleAfterMs, nowIso: judgedAtIso });
  const reported = reportedSessionWatchRows({
    includeStale,
    inventoryRead: inventoried.read,
    rows: inventoried.rows,
    staleAfterMs: STALE_UNMAPPED_AFTER_MS,
  });
  const report = titledWhenReported({ asJsonReport, report: reported });
  emitReport({
    asJson,
    asJsonReport,
    diagnostics: [...diagnostics, ...inventoried.problems],
    observedAtIso: judgedAtIso,
    report,
  });
}

/**
 * The numeric and state flags `session watch` reads, or why the argv is unusable — `--reset-state` needs
 * `--since`, since a discarded fold has to be told where the fresh one starts.
 *
 * @param parsed the verb's parsed flags
 * @returns the flag values, or the usage problem
 */
function watchFlags({
  parsed,
}: {
  parsed: ParsedFlags;
}): Result<{ idleMinutes: number; resetState: boolean; since: number | undefined }> {
  const since = numberFlag({ name: "since", parsed });
  if ("error" in since) {
    return err([since.error]);
  }
  const idleMinutes = numberFlagOr({ fallback: DEFAULT_IDLE_MINUTES, name: "idle-minutes", parsed });
  if ("error" in idleMinutes) {
    return err([idleMinutes.error]);
  }
  const resetState = parsed.values["reset-state"] === true;
  if (resetState && since.value === undefined) {
    return err(["--reset-state discards the stored fold, so it needs --since <seq> to say where the fresh one starts"]);
  }
  return ok({ idleMinutes: idleMinutes.value, resetState, since: since.value });
}

/**
 * The state a run starts from: a fresh fold at `--since` under `--reset-state`, else the stored state as
 * `--since` may resume it.
 *
 * @param home the Slopweaver home whose store is read
 * @param port where the state lives
 * @param resetState whether the caller asked to discard the stored fold
 * @param since the `--since` value, when one was passed
 * @returns the state to fold on from, or the refusal
 */
async function startingState({
  home,
  port,
  resetState,
  since,
}: {
  home: string;
  port: CmuxEventStatePort;
  resetState: boolean;
  since: number | undefined;
}): Promise<Result<SessionWatchState, CmuxEventStateError>> {
  if (resetState && since !== undefined) {
    return port.resetSessionWatch({ cursorSeq: since, home, nowIso: new Date().toISOString() });
  }
  const stored = await port.readSessionWatch({ home });
  if (stored.isErr()) {
    return err(stored.error);
  }
  return sessionWatchStart({ since, state: stored.value });
}

/**
 * Run `session watch` against this install's store.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export async function runSessionWatch(argv: readonly string[]): Promise<number> {
  return runSessionWatchOver({ argv, port: cmuxEventStatePort() });
}

/**
 * Run `session watch` over whichever state port it is handed — the store in production, an in-memory row in a test.
 *
 * @param argv the full process argv
 * @param port where the cursor and fold are read and committed
 * @returns the process exit code
 */
export async function runSessionWatchOver({
  argv,
  port,
}: {
  argv: readonly string[];
  port: CmuxEventStatePort;
}): Promise<number> {
  const rest = argv.slice(VERB_ARG_OFFSET);
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: sessionUsage({ verb: "watch" }) });
    return EXIT_OK;
  }
  const parsed = parseSessionArgs({ rest, verb: "watch" });
  if (parsed.isErr()) {
    parsed.error.forEach((error) => {
      logger.error({ msg: error });
    });
    logger.error({ msg: sessionUsage({ verb: "watch" }) });
    return EXIT_USAGE;
  }
  const home = resolveHome({ named: stringFlag({ name: "home", parsed: parsed.value }) });
  const flags = watchFlags({ parsed: parsed.value });
  if (flags.isErr()) {
    logger.error({ msg: `session watch: ${flags.error.join("; ")}` });
    return EXIT_USAGE;
  }
  const { idleMinutes, resetState, since } = flags.value;
  const started = await startingState({ home, port, resetState, since });
  if (started.isErr()) {
    logger.error({ msg: `session watch: ${started.error.message}` });
    return EXIT_ERROR;
  }
  let state = started.value;
  const report = async ({ batch }: { batch: WatchBatch }): Promise<void> => {
    const committed = await foldAndCommit({ batch, home, nowIso: new Date().toISOString(), port, state });
    if (committed.isErr()) {
      throw new Error(committed.error.message);
    }
    state = committed.value;
    await reportBatch({
      activities: state.activities,
      asJson: parsed.value.values["json"] === true,
      asJsonReport: parsed.value.values["json-report"] === true,
      batch,
      home,
      idleAfterMs: idleMinutes * 60_000,
      includeStale: parsed.value.values["include-stale"] === true,
    });
  };
  if (parsed.value.values["follow"] === true) {
    return followEvents({ afterSeq: state.cursorSeq, onBatch: report });
  }
  return drainOnce({ afterSeq: state.cursorSeq, onBatch: report });
}

/**
 * One plain drain, to the live edge or its bound, then exactly one report — or the socket's reason and a
 * non-zero exit. There is no path between the two that prints nothing.
 *
 * @returns the process exit code
 */
async function drainOnce({
  afterSeq,
  onBatch,
}: {
  afterSeq: number | undefined;
  onBatch: (options: { batch: WatchBatch }) => Promise<void>;
}): Promise<number> {
  const drained = await drainResuming({
    afterSeq,
    deadlineMs: DRAIN_DEADLINE_MS,
    maxRounds: DRAIN_MAX_ROUNDS,
    names: SUPERVISION_EVENT_NAMES,
    quietMs: DRAIN_QUIET_MS,
  });
  if (drained.kind === "failed") {
    logger.error({ msg: `session watch: ${drained.error.message}` });
    return EXIT_ERROR;
  }
  try {
    await onBatch({ batch: drained });
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : "it rejected with a value that is not an Error";
    logger.error({ msg: `session watch: ${reason}` });
    return EXIT_ERROR;
  }
  return EXIT_OK;
}

export const sessionWatchCommand = defineCommand({ run: runSessionWatch });
