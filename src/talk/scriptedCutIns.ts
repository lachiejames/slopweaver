/**
 * When what reads as the console's own progress line cut into an answer the voice was already giving — the pure half
 * of `slopweaver talk cut-ins`, and what the Alignment page's cut-ins chart draws.
 *
 * The owner's report, from a console call: the voice started saying one thing, cut off halfway through and gave a
 * completely different answer. The owner asked whether it is a bug in the Codex API or in this setup, said it should be
 * reported whenever it is heard, and asked for it to be tracked over time so it can be seen going away. It was not
 * for fixing then; the count is the deliverable.
 *
 * **The mechanism, measured on that call's file: most likely ours, not the realtime API.** The delegated Codex turn
 * started, so `site/lib/talkPlanCall.ts` was due to write its 30s progress line ("Sorry, this one's slow. I'm
 * writing some of it up.") through `thread/realtime/appendSpeech` about 30s later — inferred from that start, since
 * the call file logs no such write; the turn completed 0.87s after that, its answer already being spoken.
 * `appendSpeech` has no cancel, so the line most likely landed mid-answer — "…Next
 * card is Sorry, this one's slow. I'm writing some of it up. Park this one until its full wording's available?" — and
 * the voice carried on from it rather than from its answer.
 *
 * **What counts.** A final voice segment holding a progress line AFTER words of the voice's own, while a delegated
 * Codex turn of the same call could have had the console say it. A segment that merely OPENS on one is the line said
 * in a silence, as designed. The line matches on its opener followed by one of the console's own clauses, ending
 * there: an opener alone ("Still with you") or with any other "I'm …" ("This one's slow. I'm reluctant to optimise")
 * is ordinary speech; the clause's "it" may be heard as "that" or "this" ("some of that up"). The transcript
 * cannot say who spoke the words, so the call's own Codex turn lines stand in for that: the console says a
 * progress line only once its delegated work — one turn, or overlapping turns on its one timer — has run
 * `PROGRESS_FIRST_MS_MIRROR` (`PROGRESS_FIRST_BEFORE_MS` for a stretch before `PROGRESS_FIRST_FROM_ISO`), never
 * before. The console stopped speaking the line on the owner's word and plays a sound instead,
 * so a stretch from `PROGRESS_SPEECH_RETIRED_ISO` on counts nothing: this reads history. The retired apology prefix
 * ("Sorry, this one's slow.") still matches, so the history stays drawn. The unit is the ANSWER cut into, what the
 * owner hears broken: a segment holding two progress lines after words of its own counts once.
 *
 * **What is not counted, on purpose.** The look and find hand-offs are spoken when the voice itself calls a tool, so
 * one after the voice's words is the design rather than this race. The "on it" acknowledgement is written only while
 * the voice has said nothing since the hand-off, so only an answer starting inside the second it takes to be spoken
 * could race it; its words are not matched here. The owner's nudge speaks no fixed line at all.
 *
 * **The residue, named.** The call file never records the console speaking a progress line (`planWiring*.ts` write
 * none), so the voice saying those exact words itself inside a qualifying turn's window is counted too. Nor does it
 * record when the line was due: commentary voiced mid-turn re-armed the timer, and commentary is a voice segment like
 * any other, so the window opens at the EARLIEST a line can be due from the start of its stretch of running turns, and
 * a re-armed timer's line may be counted before it was due. A retried batch's duplicate turn line is folded to its
 * later copy's place, so when it shares its millisecond with another turn's line, which came first is lost and file
 * order decides it. A count is evidence, never proof of who spoke; the voice's claim carries one hedge for that
 * (`./candourLines.ts`).
 *
 * Repro over every call on the install: `slopweaver talk cut-ins --since <iso-instant>`.
 */
import type { CallRecord } from "./callRecord.js";
import {
  CALL_LIFETIME_MS_MIRROR,
  cutInOf,
  PROGRESS_FIRST_BEFORE_MS,
  PROGRESS_FIRST_FROM_ISO,
  PROGRESS_FIRST_MS_MIRROR,
  PROGRESS_SPEECH_RETIRED_ISO,
} from "./progressLine.js";

/**
 * How long after its turn ended a segment can still hold that turn's progress line: the segment's time is when its
 * transcript FINISHED. Measured over eight recorded cut-ins, each against the turn it most likely came from: from 2.4s
 * before that turn ended to 45.9s after, the reported one 13.9s. Six of
 * those eight turns ended 30.5–32.3s after they started, just past when their line was due — what reads as the race
 * itself, inferred from the turn times since no call file records the line's write. Repro: `slopweaver talk cut-ins
 * --since 60d --json` names each `likelyTurnId`; its `turn <id> completed` line in the call file is the end.
 */
const AFTER_TURN_MS = 60_000;

/** What reads as one progress line spoken inside an answer of the voice's own. */
export interface ScriptedCutIn {
  readonly callId: string;
  /** `talk-call:<call>#<segment>`, the anchor every other reader of a call turn uses. */
  readonly anchor: string;
  readonly atIso: string;
  /** The progress line's words as the transcript has them, from its opener to the end of its clause. */
  readonly line: string;
  /** The words before the line in the same segment, read as the voice's own. */
  readonly before: string;
  /** The delegated Codex turn whose progress line it most likely was: inferred from timing, never recorded. */
  readonly likelyTurnId: string;
}

/** One delegated Codex turn's start, from the call's own lines. */
interface DelegatedTurn {
  readonly turnId: string;
  readonly startMs: number;
}

/**
 * A stretch with at least one delegated turn running. The console keeps ONE progress timer for every running turn
 * (`HandOffSpeech` arms it once while `runningTurns` is non-empty, and a completion that empties it cancels it), so a
 * line is due into the stretch, not into each turn.
 */
interface BusySpan {
  readonly startMs: number;
  /** `undefined` when a turn in it has no recorded end: the call dropped while it ran. */
  endMs: number | undefined;
  /** Its turns, in the order they started. */
  readonly turns: DelegatedTurn[];
}

/**
 * A Codex turn's lines as `site/components/voice/planWiringLines.ts`'s `codexTurnLine` writes them: `turn <id> started`, or
 * `turn <id> <completed|interrupted|failed>` with ` — <failure>` after it when one is carried. The id is opaque and may
 * hold a space or a status word, so the format alone cannot say where an end line's id stops; an end is read
 * against the turns then running instead, the longest id that fits winning, and only a line that ends none is read as a
 * start. A failed turn's line is marked `refused` and a start never is, so a refused line is never read as a start, even
 * for a turn not running whose failure ends in "started". What no field tells apart is residue rather than
 * something a parse could recover: two running ids where one is the other plus a status word and ` — `, and a completed
 * or interrupted line, for a turn not running, carrying a failure that ends in "started".
 */
const STARTED_LINE = /^turn (.+) started$/su;
const END_STATUSES: readonly string[] = ["completed", "interrupted", "failed"];

/** The running turn a line ends, if any: the longest id the line reads as ending. */
function endedTurn({ detail, running }: { detail: string; running: ReadonlySet<string> }): string | undefined {
  return [...running]
    .filter((turnId) =>
      END_STATUSES.some((status) => {
        const head = `turn ${turnId} ${status}`;
        return detail === head || detail.startsWith(`${head} — `);
      }),
    )
    .toSorted((left, right) => right.length - left.length)[0];
}

/**
 * A call's busy stretches, replayed from its turn lines as the console's running set moved: by instant, since a retried
 * batch's duplicate line is folded to where its LATER copy sits (`callRecord.ts`'s `foldTool`), and in file order
 * within one millisecond, where the console appended them in the order it saw them. A turn id started
 * again after it completed opens a stretch of its own, as its re-add to that set does.
 */
function busySpans({ call }: { call: CallRecord }): readonly BusySpan[] {
  const spans: BusySpan[] = [];
  const running = new Set<string>();
  const lines = call.notes.flatMap((note) => turnLineOf({ note })).toSorted((left, right) => left.atMs - right.atMs);
  for (const line of lines) {
    const ended = endedTurn({ detail: line.detail, running });
    if (ended !== undefined) {
      running.delete(ended);
      if (running.size === 0) {
        spans.at(-1)!.endMs = line.atMs;
      }
    } else if (!line.refused) {
      startTurn({ atMs: line.atMs, detail: line.detail, running, spans });
    }
  }
  return spans;
}

/** A start line's turn added to the running set, opening a stretch when none was running; anything else, nothing. */
function startTurn({
  atMs,
  detail,
  running,
  spans,
}: {
  atMs: number;
  detail: string;
  running: Set<string>;
  spans: BusySpan[];
}): void {
  const turnId = STARTED_LINE.exec(detail)?.[1];
  if (turnId === undefined || running.has(turnId)) {
    return;
  }
  if (running.size === 0) {
    spans.push({ endMs: undefined, startMs: atMs, turns: [] });
  }
  running.add(turnId);
  spans.at(-1)!.turns.push({ startMs: atMs, turnId });
}

/** A note as a Codex tool line, or nothing when it is not one. */
function turnLineOf({
  note,
}: {
  note: CallRecord["notes"][number];
}): readonly { detail: string; atMs: number; refused: boolean }[] {
  if (note.kind !== "tool" || note.name !== "codex") {
    return [];
  }
  return [{ atMs: Date.parse(note.atIso), detail: note.detail, refused: note.refused }];
}

/**
 * The turn whose progress line a segment finishing at `atIso` most likely holds: the latest started by then, in a
 * stretch that ran at least the progress interval, whose interval from the stretch's start had passed (the earliest a
 * line can be due; see the residue above), and that ended no more than {@link AFTER_TURN_MS} before. A stretch with no
 * recorded end is held to the call's own lifetime from its start, which no call outlives: without that bound
 * one left open would count a match hours later. A stretch starting at or after {@link PROGRESS_SPEECH_RETIRED_ISO}
 * never qualifies: the console spoke no line by then. `undefined` when no stretch could have had the console speak.
 */
function turnSpeakingAt({ atIso, spans }: { atIso: string; spans: readonly BusySpan[] }): DelegatedTurn | undefined {
  const atMs = Date.parse(atIso);
  const span = spans.find((one) => {
    // The console stopped speaking the line: a stretch starting after that had no line to cut in.
    if (one.startMs >= Date.parse(PROGRESS_SPEECH_RETIRED_ISO)) {
      return false;
    }
    let firstMs = PROGRESS_FIRST_MS_MIRROR;
    if (one.startMs < Date.parse(PROGRESS_FIRST_FROM_ISO)) {
      firstMs = PROGRESS_FIRST_BEFORE_MS;
    }
    const firstLineMs = one.startMs + firstMs;
    if (atMs < firstLineMs) {
      return false;
    }
    if (one.endMs === undefined) {
      return atMs <= one.startMs + CALL_LIFETIME_MS_MIRROR;
    }
    return one.endMs >= firstLineMs && atMs <= one.endMs + AFTER_TURN_MS;
  });
  return span?.turns.findLast((turn) => turn.startMs <= atMs);
}

/**
 * Every cut-in across some calls, oldest first.
 *
 * @param calls the calls read
 * @param sinceIso count only segments at or after this instant
 * @returns the cut-ins
 */
export function scriptedCutIns({
  calls,
  sinceIso,
}: {
  calls: readonly CallRecord[];
  sinceIso: string;
}): readonly ScriptedCutIn[] {
  // Instants, never strings: a call file's timestamp may carry an offset rather than `Z`.
  const sinceMs = Date.parse(sinceIso);
  return calls
    .flatMap((call) => cutInsOfCall({ call, sinceMs }))
    .toSorted((left, right) => Date.parse(left.atIso) - Date.parse(right.atIso));
}

/** One call's cut-ins, in segment order: none in a typed conversation. */
function cutInsOfCall({ call, sinceMs }: { call: CallRecord; sinceMs: number }): readonly ScriptedCutIn[] {
  // A typed conversation never spoke a progress line (the console spoke one only on a voice), so the words in one are
  // the model's own, never this race.
  if (call.surface !== "voice") {
    return [];
  }
  const spans = busySpans({ call });
  return call.segments.flatMap((segment) => {
    const counted = segment.who === "voice" && segment.final && Date.parse(segment.atIso) >= sinceMs;
    const cut = counted ? cutInOf({ text: segment.text }) : undefined;
    if (cut === undefined) {
      return [];
    }
    const turn = turnSpeakingAt({ atIso: segment.atIso, spans });
    if (turn === undefined) {
      return [];
    }
    return [
      {
        anchor: `talk-call:${call.callId}#${segment.id}`,
        atIso: segment.atIso,
        before: cut.before,
        callId: call.callId,
        line: cut.line,
        likelyTurnId: turn.turnId,
      },
    ];
  });
}
