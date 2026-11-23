/**
 * The turn's own progress record — the append-only file behind a live card that actually shows work.
 *
 * ## Why this file exists at all
 *
 * Two independent needs, measured on real turns, and one file answers both.
 *
 * **A finished step must keep what it learned.** `../../cli/commands/turn/status.ts` used to render
 * `completed: 1` with the worker's line riding as the ONE in-flight detail, replaced on every call. So a
 * card that had been told "thread read (47 msgs, 12 PRs named)" three minutes ago showed no trace of it —
 * the reader got one rotating sentence and no answer to "what have you got". Stages are appended here
 * instead, and every one of them is still on the card when the turn ends.
 *
 * **A card write must be auditable after the fact.** `turn answer` DELETES the working card
 * (`./posterChecklistDelete.ts`'s `deleteWorkingImpl`), and Slack exposes no edit history even before that, so once
 * a turn answers there is no provider-side record of what its card ever said. Reconstructing three real
 * turns took reading the workers' own session transcripts. Every write is recorded here as it happens, which
 * is what lets {@link progressGapsExceeding} judge staleness at all — a probe cannot measure gaps in a
 * history nothing kept.
 *
 * ## One file, every event kind, and why they are not several files
 *
 * A stage and a write are interleaved facts about the same card, and the question both exist to answer is
 * "what did the reader see, and when". Splitting them would make that question a join, and a join between
 * two append-only files written by two different processes (the worker's `turn status`, the ticker's own
 * tick) is exactly where an ordering bug hides. One file, appended by both, folded in file order.
 *
 * The planning loop the card draws (the owner asked for a better illustration of the dynamic planning loop)
 * joins the same file for the same reason: a declared PLAN, a review ROUND opening and the
 * writing session on each stage are what `./progressLoop.ts` derives the meter, outline and loop phases from,
 * and six writers render the card — each already reads this file and nothing else.
 */

import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { appendLines } from "#lib/appendSeparator.js";
import { err, ok, type Result } from "#lib/result.js";
import { isRecord } from "../../lib/parsers.js";
import { stateHomePaths } from "../../stateHome.js";
import { type AskIdentity, sameAskIdentity } from "../ask/identity.js";
import { decodeLoopRecord, decodeStageRecord } from "./progressLogLoopDecode.js";
import { decodeReachRecord, type ProgressReachEvent } from "./progressReach.js";
import { withoutTurnClock } from "./turnClock.js";
import { type TurnError, TurnErrors } from "./turnErrors.js";

/**
 * The current progress-log schema version — bumped if these event shapes ever change incompatibly.
 *
 * @internal
 */
export const PROGRESS_LOG_SCHEMA_VERSION = 1;

/**
 * A STAGE the worker declared — one line of what it is doing, which becomes one step on the card and stays
 * there. The text is the finding: `turn status` has no separate title/finding pair, deliberately, because a
 * worker asked for two strings writes the same string twice.
 */
export interface ProgressStageEvent {
  readonly kind: "stage";
  readonly tsIso: string;
  readonly text: string;
  /** The 1-based step of the plan standing when it was written (`turn status --step`), when the worker named one. */
  readonly step?: number | undefined;
  /**
   * The visible session that wrote it. A stage whose writer differs from the last one that carried a writer is
   * a HANDOVER — a fresh worker picking up a dead or re-dispatched one's work — which is how the card shows the
   * loop's worker generations without a second writer or a second file. A stage written before this field
   * existed carries none and belongs to the generation before it.
   */
  readonly worker?: string | undefined;
}

/**
 * A PLAN the worker declared (`turn status --plan`) — the ordered steps the card's outline and progress meter
 * are drawn from. A later plan is a RE-PLAN: the outline follows the newest, and the loop section below the
 * fold keeps every one.
 */
export interface ProgressPlanEvent {
  readonly kind: "plan";
  readonly tsIso: string;
  readonly steps: readonly string[];
}

/**
 * An independent review ROUND that opened (`turn review`), appended once its reviewer is actually up. The
 * review store keeps only the CURRENT round, so this line is what lets the loop section show round 1 after
 * round 2 has replaced it.
 */
export interface ProgressReviewEvent {
  readonly kind: "review";
  readonly tsIso: string;
  readonly round: number;
}

/** One event the card's loop is drawn from — every kind but a card write or a warn, in file order. */
export type ProgressTimelineEvent = ProgressStageEvent | ProgressPlanEvent | ProgressReviewEvent;

/**
 * A CARD WRITE that actually reached Slack — what the in-flight step said at that instant, and how many
 * stages stood behind it. Appended by whichever writer made the edit, after it succeeded: a write recorded
 * before the fact would let a failed `chat.update` masquerade as a fresh card in the staleness probe.
 */
export interface ProgressWriteEvent {
  readonly kind: "card-write";
  readonly tsIso: string;
  readonly detail: string;
  readonly stageCount: number;
}

/**
 * A WARN raised on this turn's budget by the loop's own sweep — a fact the worker plans against, never an
 * instruction and never an ending (`./budgetMarks.ts` carries the ruling).
 *
 * `clock` is the sweep noticing the warn mark was crossed; `witness` is the loop session judging the turn's
 * evidence and raising it, with the one note that is its whole output. `dispatchedIso` and `leaseExpiresAt`
 * together bind the warn to ONE dispatch generation: this file is keyed by the ask, so a re-dispatch shares
 * it, and a warn raised on the generation before must not greet a fresh worker as its own.
 */
export type ProgressWarnEvent =
  | {
      readonly kind: "warn";
      readonly source: "clock";
      readonly tsIso: string;
      readonly dispatchedIso: string;
      readonly leaseExpiresAt: string;
    }
  | {
      readonly kind: "warn";
      readonly source: "witness";
      readonly tsIso: string;
      readonly dispatchedIso: string;
      readonly leaseExpiresAt: string;
      readonly note: string;
    };

/**
 * One line of a turn's progress log.
 *
 * @internal
 */
export type ProgressLogEvent = ProgressTimelineEvent | ProgressWriteEvent | ProgressWarnEvent | ProgressReachEvent;

/**
 * A turn's progress log, folded: its stages in order, every write that reached Slack, every warn raised, and
 * the TIMELINE — stages, plans and review rounds interleaved in FILE order, which is the order the card's loop
 * is drawn in. File order rather than timestamp order because two processes append here and their clocks
 * disagree (see `gapBetween`).
 */
export interface ProgressLog {
  readonly stages: readonly ProgressStageEvent[];
  readonly timeline: readonly ProgressTimelineEvent[];
  readonly writes: readonly ProgressWriteEvent[];
  readonly warns: readonly ProgressWarnEvent[];
}

/**
 * An empty log — what a turn that has never written a stage or a card folds to.
 *
 * @internal
 */
export const EMPTY_PROGRESS_LOG: ProgressLog = { stages: [], timeline: [], warns: [], writes: [] };

/**
 * The file one turn's progress log lives in.
 *
 * Keyed `(channel, messageTs)` like `dispatches/` and `reviews/`, never the thread root, so two asks in one
 * thread never share a log.
 *
 * @param askIdentity the ask whose log this is
 * @param home the resolved state home
 * @returns the absolute path
 */
export function progressLogPath({ askIdentity, home }: { askIdentity: AskIdentity; home: string }): string {
  return join(stateHomePaths({ home }).live.slack.progress, `${askIdentity.channel}-${askIdentity.messageTs}.jsonl`);
}

/**
 * Decode one log line. Total — an unreadable or foreign line yields `undefined` rather than throwing, so one
 * corrupt append can never make a live turn's card unrenderable.
 *
 * @param line the raw JSONL line
 * @returns the event, or `undefined` when the line is not one
 */
export function decodeProgressLogLine({ line }: { line: string }): ProgressLogEvent | undefined {
  const trimmed = line.trim();
  if (trimmed.length === 0) {
    return undefined;
  }
  let value: unknown;
  try {
    value = JSON.parse(trimmed);
  } catch {
    return undefined;
  }
  if (!isRecord(value)) {
    return undefined;
  }
  const record = value;
  const tsIso = record["tsIso"];
  if (typeof tsIso !== "string" || tsIso.length === 0) {
    return undefined;
  }
  if (record["kind"] === "stage" && typeof record["text"] === "string") {
    return decodeStageRecord({ record, text: record["text"], tsIso });
  }
  if (record["kind"] === "card-write" && typeof record["detail"] === "string") {
    const stageCount = record["stageCount"];
    return {
      detail: record["detail"],
      kind: "card-write",
      stageCount: typeof stageCount === "number" ? stageCount : 0,
      tsIso,
    };
  }
  if (record["kind"] === "plan" || record["kind"] === "review") {
    return decodeLoopRecord({ record, tsIso });
  }
  if (record["kind"] === "reach") {
    return decodeReachRecord({ record, tsIso });
  }
  return decodeWarnRecord({ record, tsIso });
}

/**
 * Every reach receipt one turn's log carries FOR THAT ASK — none when the turn has no log yet, or when it will not
 * read, since a missing receipt only ever REFUSES an answer and never lets one through. A receipt naming another ask
 * is dropped: two identities can share one file name (`C-A` + `B` and `C` + `A-B`, or one ts in two threads).
 *
 * @param askIdentity the ask whose log to read
 * @param home the resolved state home
 * @returns the receipts, in file order
 */
export function readReachReceipts({
  askIdentity,
  home,
}: {
  askIdentity: AskIdentity;
  home: string;
}): readonly ProgressReachEvent[] {
  try {
    return readFileSync(progressLogPath({ askIdentity, home }), "utf8")
      .split("\n")
      .map((line) => decodeProgressLogLine({ line }))
      .filter(
        (event): event is ProgressReachEvent =>
          event?.kind === "reach" && sameAskIdentity({ left: event.askIdentity, right: askIdentity }),
      );
  } catch {
    return [];
  }
}

/**
 * Decode a `warn` line — split from {@link decodeProgressLogLine} to keep that function under the branch cap.
 * A warn missing either generation field is unreadable, never a warn for every generation: binding is those
 * fields' whole job. A witness warn with no note is unreadable too, since the note is the witness's output.
 *
 * @param record the decoded JSON object
 * @param tsIso its already-validated instant
 * @returns the warn, or `undefined` when the line is not a well-formed one
 */
function decodeWarnRecord({
  record,
  tsIso,
}: {
  record: Record<string, unknown>;
  tsIso: string;
}): ProgressWarnEvent | undefined {
  const { dispatchedIso, leaseExpiresAt, note, source } = record;
  if (record["kind"] !== "warn" || typeof dispatchedIso !== "string" || typeof leaseExpiresAt !== "string") {
    return undefined;
  }
  if (dispatchedIso.length === 0 || leaseExpiresAt.length === 0) {
    return undefined;
  }
  if (source === "clock") {
    return { dispatchedIso, kind: "warn", leaseExpiresAt, source, tsIso };
  }
  if (source === "witness" && typeof note === "string" && note.trim().length > 0) {
    return { dispatchedIso, kind: "warn", leaseExpiresAt, note, source, tsIso };
  }
  return undefined;
}

/**
 * Fold a whole log's text into its stages and writes. Pure — no clock, no filesystem.
 *
 * @param text the log file's contents
 * @returns the folded log, in file order
 */
export function foldProgressLog({ text }: { text: string }): ProgressLog {
  const stages: ProgressStageEvent[] = [];
  const timeline: ProgressTimelineEvent[] = [];
  const writes: ProgressWriteEvent[] = [];
  const warns: ProgressWarnEvent[] = [];
  for (const line of text.split("\n")) {
    const event = decodeProgressLogLine({ line });
    if (event?.kind === "stage") {
      stages.push(event);
    }
    if (event?.kind === "stage" || event?.kind === "plan" || event?.kind === "review") {
      timeline.push(event);
    }
    if (event?.kind === "card-write") {
      writes.push(event);
    }
    if (event?.kind === "warn") {
      warns.push(event);
    }
  }
  return { stages, timeline, warns, writes };
}

/**
 * Read and fold one turn's progress log. A missing file is an EMPTY log, never an error: every turn has no
 * log until its first stage, and a reader that treats that as a failure cannot render the first frame.
 *
 * @param askIdentity the ask whose log to read
 * @param home the resolved state home
 * @returns the folded log
 */
export function readProgressLog({ askIdentity, home }: { askIdentity: AskIdentity; home: string }): ProgressLog {
  try {
    return foldProgressLog({ text: readFileSync(progressLogPath({ askIdentity, home }), "utf8") });
  } catch {
    return EMPTY_PROGRESS_LOG;
  }
}

/**
 * Read and fold one turn's progress log for a caller about to DECIDE something from it — a missing file is
 * still an empty log, but any other read failure is an error rather than an empty log.
 *
 * {@link readProgressLog} is right for a renderer, and wrong for the sweep deciding whether a warn already
 * stands: an unreadable file folded to "no warns" would be read as permission to append another one.
 *
 * @param askIdentity the ask whose log to read
 * @param home the resolved state home
 * @returns the folded log, or the reason it could not be read
 */
export function readProgressLogStrict({
  askIdentity,
  home,
}: {
  askIdentity: AskIdentity;
  home: string;
}): Result<ProgressLog, TurnError> {
  const path = progressLogPath({ askIdentity, home });
  try {
    return ok(foldProgressLog({ text: readFileSync(path, "utf8") }));
  } catch (error) {
    if (isRecord(error) && error["code"] === "ENOENT") {
      return ok(EMPTY_PROGRESS_LOG);
    }
    return err(
      TurnErrors.progressLogUnreadable({ cause: error instanceof Error ? error.message : String(error), path }),
    );
  }
}

/**
 * Append one event to a turn's progress log.
 *
 * An append (`appendLines`) rather than a read-modify-write: two processes write this file (the worker's `turn
 * status` and the ticker's own tick), and an append is the one operation that cannot lose the other's line.
 *
 * @param askIdentity the ask whose log this is
 * @param event the event to append
 * @param home the resolved state home
 */
export function appendProgressLogEvent({
  askIdentity,
  event,
  home,
}: {
  askIdentity: AskIdentity;
  event: ProgressLogEvent;
  home: string;
}): void {
  const path = progressLogPath({ askIdentity, home });
  mkdirSync(dirname(path), { recursive: true });
  appendLines({ path, text: `${JSON.stringify({ ...event, schemaVersion: PROGRESS_LOG_SCHEMA_VERSION })}\n` });
}

/**
 * One stretch of time in which the card did not change, in the units a reader complains in.
 *
 * @internal
 */
export interface ProgressGap {
  readonly fromIso: string;
  readonly toIso: string;
  readonly minutes: number;
}

/**
 * One stretch between two marks, or `undefined` when the pair does not describe a real forward stretch.
 *
 * Total by design. Two writers append this log — the worker's `turn status` and the ticker's own tick — so a
 * later line can carry an EARLIER timestamp than the one above it; a `-0.03m` step was measured
 * between two lines two seconds apart. A non-forward pair is skipped rather than scored, which is
 * also what keeps an unparseable timestamp from reading as an infinite gap.
 *
 * @param fromIso when the stretch opened
 * @param toIso when it closed
 * @returns the gap, or `undefined` when either instant is unreadable or the pair does not move forward
 */
function gapBetween({ fromIso, toIso }: { fromIso: string; toIso: string }): ProgressGap | undefined {
  const from = Date.parse(fromIso);
  const to = Date.parse(toIso);
  if (Number.isNaN(from) || Number.isNaN(to) || to <= from) {
    return undefined;
  }
  const minutes = (to - from) / 60_000;
  return { fromIso, minutes: Math.round(minutes * 10) / 10, toIso };
}

/**
 * The writes that actually CHANGED what a reader sees — every write whose detail differs from the one the
 * card was already showing. Pure.
 *
 * **A rewrite is not a change, and the probe is about the reader.** A writer that re-sends the same detail
 * on a clock leaves a card that is frozen in every sense a person in the thread can perceive, while
 * resetting a staleness clock measured in WRITES. Two real writers produce that exactly: the sweep's own
 * fallback (`../../cli/commands/turn/dispatchSweep.ts`'s screen scrape, which on a real ask
 * pushed the identical detail `─` four times in twenty minutes), and `turn watch` against a worker whose transcript it cannot read — a Codex
 * worker records none (`./workerLog.ts`'s stated limit), so `nowLine` returns the constant
 * `now: still working — 0 tool calls so far` every ninety seconds, forever. Count the first class:
 *
 * ```bash
 * cut -d, -f1 "$SLOPWEAVER_HOME/live/slack/progress/C0SYN000009-1789344513.735589.jsonl" | uniq -c | sort -rn | head
 * ```
 *
 * The comparison is against the last KEPT write rather than the immediately preceding one, so a run of
 * three identical details collapses to its first — the instant the card last said something new.
 *
 * **The turn clock is not a change.** `still working, 23m` is derived from the ask's own timestamp and moves
 * every minute whatever the worker does, so details are compared with it stripped (`./turnClock.ts`) — else
 * the constant Codex-worker card above would read fresh forever. The recorded detail keeps it, byte for byte.
 *
 * @param writes every write that reached Slack, in file order
 * @returns the subset a reader would have seen change
 */
export function changingWrites({ writes }: { writes: readonly ProgressWriteEvent[] }): readonly ProgressWriteEvent[] {
  const kept: ProgressWriteEvent[] = [];
  for (const write of writes) {
    const last = kept[kept.length - 1];
    if (
      last === undefined ||
      withoutTurnClock({ detail: last.detail }) !== withoutTurnClock({ detail: write.detail })
    ) {
      kept.push(write);
    }
  }
  return kept;
}

/**
 * Every mark a gap can run between: the turn's start, each write that CHANGED the card, and the closing
 * instant.
 *
 * The turn's own start is the FIRST boundary, not the first write: a card posted at capture and left
 * untouched for twenty minutes is exactly the failure being measured, and a probe that only looked between
 * writes would score a turn that never wrote at all as perfect. {@link changingWrites} is the other half of
 * the same idea — a card rewritten with the bytes it already carried is equally untouched.
 *
 * @param log the folded progress log
 * @param nowIso the instant that closes the final stretch
 * @param startedIso when the card was first posted
 * @returns the marks, in file order, start first and `nowIso` last
 */
function progressMarks({
  log,
  nowIso,
  startedIso,
}: {
  log: ProgressLog;
  nowIso: string;
  startedIso: string;
}): readonly string[] {
  return [startedIso, ...changingWrites({ writes: log.writes }).map((write) => write.tsIso), nowIso];
}

/**
 * Every stretch between consecutive card writes longer than a bound — the turn's whole staleness HISTORY,
 * pure and clock-injected so it can be run over a finished turn's log or a live one.
 *
 * **This is history, not health.** A gap that closed forty minutes ago is still in this array, and that is
 * the point: it is what an after-the-fact audit of a turn reads. A LIVE alarm must not read it — see
 * {@link openProgressGap} for the one gap that describes the card right now, and the header of
 * `../../cli/commands/turn/dispatchSweep.ts`'s `cardStaleSweepLine` for what reading the wrong one cost.
 *
 * `nowIso` closes the last gap, so a live turn whose card has gone quiet is caught while it is still quiet
 * rather than only in hindsight. Pass the turn's end for a finished one.
 *
 * @param boundMinutes how long the card may go unchanged before it counts
 * @param log the folded progress log
 * @param nowIso the instant that closes the final gap
 * @param startedIso when the card was first posted — the first boundary
 * @returns every gap over the bound, in order
 */
export function progressGapsExceeding({
  boundMinutes,
  log,
  nowIso,
  startedIso,
}: {
  boundMinutes: number;
  log: ProgressLog;
  nowIso: string;
  startedIso: string;
}): readonly ProgressGap[] {
  const marks = progressMarks({ log, nowIso, startedIso });
  const gaps: ProgressGap[] = [];
  for (let index = 1; index < marks.length; index++) {
    const gap = gapBetween({ fromIso: marks[index - 1]!, toIso: marks[index]! });
    if (gap !== undefined && gap.minutes > boundMinutes) {
      gaps.push(gap);
    }
  }
  return gaps;
}

/**
 * The one gap that is still OPEN at `nowIso` — the stretch since the last mark — when it exceeds the bound.
 *
 * This is the only gap that can honestly be described in the present tense, and the distinction is not
 * academic. MEASURED over two live tags
 * (reproduce by folding their files under `$SLOPWEAVER_HOME/live/slack/progress/`): the first card had taken
 * 64 writes, the last of them 0.4m before the sweep ran, and the sweep still announced it had "not changed
 * for 5.1m" — off a gap that had closed 48 minutes earlier. The second, with identical present-tense
 * freshness and no such historical gap, drew no alarm at all. One brief stall in a turn's first five minutes made the alarm fire
 * for the rest of that turn's working life.
 *
 * Chosen POSITIONALLY, as the final mark pair, never by matching `toIso` against `nowIso`: a write appended
 * at exactly the closing instant would make a CLOSED gap's `toIso` compare equal, which is the same class of
 * mistake in a new place.
 *
 * @param boundMinutes how long the card may go unchanged before it counts
 * @param log the folded progress log
 * @param nowIso the instant the gap is judged at
 * @param startedIso when the card was first posted — the first boundary
 * @returns the open gap when it exceeds the bound, or `undefined` while the card is keeping up
 */
export function openProgressGap({
  boundMinutes,
  log,
  nowIso,
  startedIso,
}: {
  boundMinutes: number;
  log: ProgressLog;
  nowIso: string;
  startedIso: string;
}): ProgressGap | undefined {
  const marks = progressMarks({ log, nowIso, startedIso });
  const gap = gapBetween({ fromIso: marks[marks.length - 2]!, toIso: marks[marks.length - 1]! });
  if (gap === undefined || gap.minutes <= boundMinutes) {
    return undefined;
  }
  return gap;
}

/**
 * The longest of a turn's gaps — the one a reader means by "worst".
 *
 * `progressGapsExceeding` returns its gaps in TIME order, so the last element is the most recent, not the
 * longest. Taking it under the name `worst` is what under-reported one real turn's 9.2m stall as
 * the 5.1m one that happened later, and it will under-report whenever a smaller qualifying gap comes after a
 * bigger one. Ties keep the earlier gap, so the reading is stable rather than order-dependent.
 *
 * @param gaps the gaps to rank, in any order
 * @returns the longest gap, or `undefined` when there are none
 */
export function worstProgressGap({ gaps }: { gaps: readonly ProgressGap[] }): ProgressGap | undefined {
  return gaps.reduce<ProgressGap | undefined>((worst, gap) => {
    if (worst === undefined || gap.minutes > worst.minutes) {
      return gap;
    }
    return worst;
  }, undefined);
}
