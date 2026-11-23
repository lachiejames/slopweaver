/**
 * `handover start`'s write, held under the row's closing lock (`./closingLock.ts`) — the lock `handover settle` holds
 * from its precondition to its row write. Without it an automatic settle (`sweep board --settle-ended`, or the closure
 * half of `github landing --register`) could read the journal as never started, a seat append `started`, and the
 * settle then write the row: the card a seat had just picked up left the Queue while the seat worked it
 * (`closureSettlePrecondition` in `../../../review/closureRowState.ts`).
 *
 * Under the lock the doc and the journal are READ AGAIN, because a settle that won wrote the row after `resolve` read
 * it: the start's own refusals then see a settled ask and refuse with their existing message.
 *
 * A held lock is a REFUSAL, `EXIT_DEFERRED`, never a retry. The holder is not momentary in wall-clock terms — a
 * settle reads a pull request's body live and mirrors the row inside it — so any bound would be a guess, and a wait
 * would need a sleep in a path that is synchronous end to end. Running `start` again unchanged is exactly right
 * whichever closer won: a settle that wrote leaves a settled ask the rerun refuses, one that held leaves a row the
 * rerun opens.
 */
import { readFileSync } from "node:fs";

import { parseHandoverDoc } from "../../../handover/doc.js";
import { runStateOf } from "../../../handover/ledger.js";
import { applyRowEvent } from "../../../handover/rowEvent.js";
import { docHash, readRunJournal } from "../../../handover/runStore.js";
import { logger } from "../../../lib/logger.js";
import type { SupervisorHost } from "../../../supervisor/session.js";
import { EXIT_DEFERRED, EXIT_ERROR, EXIT_OK } from "../../exitCodes.js";
import { acquireClosingLock } from "./closingLock.js";
import { type RunContext } from "./runContextTypes.js";
import { openRunProbeGapLines } from "./startGates.js";
import { startOpenedLines } from "./startRecap.js";

/** Who is opening the run, or `undefined` when the session cannot be named. */
export type StartWriter =
  { sessionId: string; host: SupervisorHost; pid: number | undefined; worktree: string | undefined } | undefined;

/**
 * Ask the start's refusals of the row as resolved, take the row's closing lock, re-read the row under it, ask the
 * refusals again of THAT reading, and append `started` — then the writer and the opened brief.
 *
 * @param context the run as `resolve` read it, before the lock; its probe results are kept, its doc and journal re-read
 * @param home the state home the closing lock lives under
 * @param branch the branch this run's commits will land on
 * @param refused the start's refusals, asked of the resolved row and again of the row under the lock; true when they
 *   printed why
 * @param writer who is opening the run, recorded so the stop gate can tell this run from a neighbour's
 * @returns the process exit code — `EXIT_DEFERRED` when another closer holds the lock
 */
export function startUnderClosingLock({
  context,
  home,
  runsDir,
  branch,
  nowIso,
  refused,
  writer,
}: {
  context: RunContext;
  home: string;
  runsDir: string;
  branch: string;
  nowIso: string;
  refused: (current: RunContext) => boolean;
  writer: StartWriter;
}): number {
  // Asked first of the row as `resolve` read it, so a row start would refuse anyway refuses with its own message
  // and exit code even while a closer holds the lock; asked again under the lock, below.
  if (refused(context)) {
    return EXIT_ERROR;
  }
  const slug = context.doc.slug;
  const lock = acquireClosingLock({ home, nowIso, slug });
  if (lock.isErr()) {
    logger.error({
      msg:
        `handover start: a settle, finish, close or page publish of ${slug} holds its closing lock, so no run was ` +
        `opened — run handover start ${slug} again: a settle that wrote leaves a settled ask it refuses, one that ` +
        `held leaves the row open to start (${lock.error})`,
    });
    return EXIT_DEFERRED;
  }
  try {
    const current = reread({ context, runsDir });
    if (typeof current === "string") {
      logger.error({ msg: `handover start: ${current}` });
      return EXIT_ERROR;
    }
    if (refused(current)) {
      return EXIT_ERROR;
    }
    return appendStarted({ branch, context: current, nowIso, runsDir, writer });
  } finally {
    lock.value.release();
  }
}

/**
 * The run as it reads NOW: the doc at the path `resolve` found and the journal, read again; probes as they were.
 *
 * @param context the run as `resolve` read it
 * @param runsDir where the row's journal lives
 * @returns the re-read context, or why the row would not read again
 */
function reread({ context, runsDir }: { context: RunContext; runsDir: string }): RunContext | string {
  const { path, slug } = context.doc;
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return `${path} would not read again under the closing lock, so ${slug} was not started — a settle may have moved it`;
  }
  const doc = parseHandoverDoc({ path, text });
  if (doc.slug !== slug) {
    return `${path} names ${doc.slug} under the closing lock, not ${slug}, so nothing was started`;
  }
  const journal = readRunJournal({ runsDir, slug });
  if (journal.isErr()) {
    return journal.error.message;
  }
  return {
    ...context,
    doc,
    events: journal.value.events,
    run: runStateOf({ events: journal.value.events }),
    text,
    unknownKind: journal.value.unknownKind,
    unreadable: journal.value.unreadable,
  };
}

/**
 * Append `started`, record the writer, and print the opened brief and the probe gap.
 *
 * @param context the run as it reads under the lock
 * @returns the process exit code
 */
function appendStarted({
  branch,
  context,
  nowIso,
  runsDir,
  writer,
}: {
  branch: string;
  context: RunContext;
  nowIso: string;
  runsDir: string;
  writer: StartWriter;
}): number {
  const appended = applyRowEvent({
    event: { atIso: nowIso, branch, docHash: docHash({ text: context.text }), kind: "started" },
    runsDir,
    slug: context.doc.slug,
  });
  if (appended.isErr()) {
    logger.error({ msg: `handover start: ${appended.error.message}` });
    return EXIT_ERROR;
  }
  recordWriter({ nowIso, runsDir, slug: context.doc.slug, writer });
  startOpenedLines({
    branch,
    doc: context.doc,
    inheritedQuestion: appended.value.state.openQuestion,
    journalPath: appended.value.path,
    results: context.results,
  }).forEach((line) => {
    logger.out({ line });
  });
  // LAST, so it is the final thing the session reads rather than something the brief scrolls past. The run
  // is already open by this point on purpose: this warns, and a warning that changed whether the work
  // started would be a refusal wearing a different word.
  openRunProbeGapLines({ doc: context.doc }).forEach((msg) => {
    logger.error({ msg });
  });
  return EXIT_OK;
}

/**
 * Record which session opened the run, so the stop gate can tell it from a neighbour's.
 *
 * A SECOND entry rather than a field on `started`, and the same `launched` shape the owner's fleet driver already
 * writes — so there is one kind meaning "a session took this run" instead of two spellings of it. It is skipped
 * when the session cannot be named: a run with no recorded writer reads as `unowned`, which keeps the gate's
 * original behaviour rather than inventing an identity that would compare unequal to every real one.
 *
 * Its failure is swallowed. The run is already open by this point, and refusing to report that because a second
 * append failed would lose the more important fact.
 */
function recordWriter({
  runsDir,
  slug,
  nowIso,
  writer,
}: {
  runsDir: string;
  slug: string;
  nowIso: string;
  writer: StartWriter;
}): void {
  if (writer === undefined) {
    return;
  }
  void applyRowEvent({
    event: {
      atIso: nowIso,
      host: writer.host,
      kind: "launched",
      pid: writer.pid,
      sessionId: writer.sessionId,
      worktree: writer.worktree,
    },
    runsDir,
    slug,
  });
}
