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
 * `--follow` subscription itself is `./watchFollow.ts`, and reporting one committed batch is `./watchBatchReport.ts`.
 *
 * A plain drain ALWAYS reports, or exits non-zero with the socket's reason: cmux hanging up mid-replay once
 * ended it silently with exit 0, and `cmux/resumingDrain.ts` carries that measurement.
 */

import type { CmuxEventStateError } from "../../../cmux/eventState/errors.js";
import { type CmuxEventStatePort, cmuxEventStatePort, type SessionWatchState } from "../../../cmux/eventState/port.js";
import { sessionWatchStart } from "../../../cmux/eventState/start.js";
import { SUPERVISION_EVENT_NAMES } from "../../../cmux/events.js";
import { drainResuming } from "../../../cmux/resumingDrain.js";
import { foldSessionActivity } from "../../../cmux/sessionActivity.js";
import { logger } from "../../../lib/logger.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { resolveHome } from "../../optionParsers.js";
import type { ParsedFlags } from "../../parseFlags.js";
import { numberFlag, numberFlagOr, parseSessionArgs, sessionUsage, stringFlag, VERB_ARG_OFFSET } from "./core.js";
import { reportBatch } from "./watchBatchReport.js";
import { DRAIN_QUIET_MS, followEvents, type WatchBatch } from "./watchFollow.js";
import { commitThenReport, recordReadingRefusal } from "./watchReadingRecord.js";

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
 * The numeric and state flags `session watch` reads, or why the argv is unusable — `--reset-state` needs
 * `--since`, since a discarded fold has to be told where the fresh one starts, and `--record-reading` needs a plain
 * `--json-report` drain (`./watchReadingRecord.ts`).
 *
 * @param parsed the verb's parsed flags
 * @returns the flag values, or the usage problem
 */
function watchFlags({ parsed }: { parsed: ParsedFlags }): Result<{
  idleMinutes: number;
  recordReadingBy: string | undefined;
  resetState: boolean;
  since: number | undefined;
}> {
  const recordReadingBy = stringFlag({ name: "record-reading", parsed });
  const recordRefusal = recordReadingRefusal({
    by: recordReadingBy,
    follow: parsed.values["follow"] === true,
    jsonReport: parsed.values["json-report"] === true,
  });
  if (recordRefusal !== undefined) {
    return err([recordRefusal]);
  }
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
  return ok({ idleMinutes: idleMinutes.value, recordReadingBy, resetState, since: since.value });
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
 * The per-batch step: commit the fold and cursor, then report from the committed state (`commitThenReport`), each
 * batch folding on from the last one this watcher committed. A drain that lost the compare-and-set throws before the
 * report, so it never reaches `--record-reading`'s append: the winner's reading is the only one recorded.
 *
 * @param started the state the run starts from
 * @param parsed the verb's parsed flags, read for the output modes
 * @param port where the state is committed
 * @param home the Slopweaver home whose store is written and whose readings ledger takes the document
 * @param idleMinutes how long a quiet session must have been quiet to count as idle
 * @param recordReadingBy who takes the `--json-report` document as a reading, `undefined` when nobody does
 * @returns the step a drain or a subscription calls once per batch
 */
function committingReporter({
  started,
  parsed,
  port,
  home,
  idleMinutes,
  recordReadingBy,
}: {
  started: SessionWatchState;
  parsed: ParsedFlags;
  port: CmuxEventStatePort;
  home: string;
  idleMinutes: number;
  recordReadingBy: string | undefined;
}): (options: { batch: WatchBatch }) => Promise<number> {
  let state = started;
  return async ({ batch }) =>
    commitThenReport({
      commit: () => foldAndCommit({ batch, home, nowIso: new Date().toISOString(), port, state }),
      report: (committed) => {
        state = committed;
        return reportBatch({
          activities: committed.activities,
          asJson: parsed.values["json"] === true,
          asJsonReport: parsed.values["json-report"] === true,
          batch,
          home,
          idleAfterMs: idleMinutes * 60_000,
          includeStale: parsed.values["include-stale"] === true,
          recordReadingBy,
        });
      },
    });
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
  const { idleMinutes, recordReadingBy, resetState, since } = flags.value;
  const started = await startingState({ home, port, resetState, since });
  if (started.isErr()) {
    logger.error({ msg: `session watch: ${started.error.message}` });
    return EXIT_ERROR;
  }
  const report = committingReporter({
    home,
    idleMinutes,
    parsed: parsed.value,
    port,
    recordReadingBy,
    started: started.value,
  });
  if (parsed.value.values["follow"] === true) {
    return followEvents({
      afterSeq: started.value.cursorSeq,
      onBatch: async ({ batch }) => {
        await report({ batch });
      },
    });
  }
  return drainOnce({ afterSeq: started.value.cursorSeq, onBatch: report });
}

/**
 * One plain drain, to the live edge or its bound, then exactly one report — or the socket's reason and a
 * non-zero exit. There is no path between the two that prints nothing.
 *
 * @returns the process exit code: the report's own, or non-zero when the drain or the report failed
 */
async function drainOnce({
  afterSeq,
  onBatch,
}: {
  afterSeq: number | undefined;
  onBatch: (options: { batch: WatchBatch }) => Promise<number>;
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
    return await onBatch({ batch: drained });
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : "it rejected with a value that is not an Error";
    logger.error({ msg: `session watch: ${reason}` });
    return EXIT_ERROR;
  }
}

export const sessionWatchCommand = defineCommand({ run: runSessionWatch });
