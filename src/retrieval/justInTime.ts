/**
 * The JUST-IN-TIME gate — whether this question must wait for a bronze refresh before it is answered.
 *
 * ## The rule, in the owner's own frame
 *
 * If the question being asked could have its answer changed with some significance by something that happened
 * within the last few hours, wait for the just-in-time refresh to finish first. The half that keeps that from
 * making everything wait is that *could* is evaluated rather than assumed, and the two-part test the owner
 * adopted is what evaluates it:
 *
 *  - **(i) Is the question about a MOVING TARGET?** Either it carries a recency marker — today, latest,
 *    current, still, since — or it asks STATE rather than HISTORY. "What is the status of" and "who owns"
 *    ask what is true now; "why did we" and "what did we decide" ask what was true then, and a decision
 *    made in June does not change because Notion moved this afternoon.
 *  - **(ii) Is a source that is actually BEHIND one this question's retrieval actually DRAWS ON?** This is
 *    free: the lexical ranking has already run by the time a slice exists, so the sources of the slice are
 *    observed rather than guessed. A question answered entirely from GitHub never waits for Notion,
 *    however recency-marked it is.
 *
 * Both must hold. Otherwise the answer goes out now and the coverage line names what was not refreshed —
 * `../cli/commands/store/shell.ts` already prints it.
 *
 * ## Why retrieval is the right judge, and the hole that leaves
 *
 * Any other relevance test is a guess about what a question is "about". Retrieval is not a guess: it is the
 * same ranking that will produce the answer, so a source contributing nothing to the slice cannot change
 * what gets said.
 *
 * **The hole, named here rather than discovered later:** a source that is behind AND would have contributed
 * had it been fresh is invisible to this test, because retrieval cannot rank records that are not there. It
 * is not closeable from inside a query — closing it would mean fetching the thing whose relevance is being
 * decided. What bounds it is the SCHEDULED slot (`refresh --if-stale`, the cron-safe entry point in
 * `../cli/commands/refresh/core.ts`), which keeps every source current whether or not a question asked for
 * it; this gate is the second line, not the first. {@link ../live/turn/freshnessCard} puts that sentence on
 * the card, because a caveat only the source carries is one the reader never sees.
 *
 * ## What this module is NOT
 *
 * It never refreshes, never reads a clock and never touches disk — the caller supplies `nowIso`, the
 * coverage manifest it already has, and the slice it already ranked. The waiting itself belongs to a
 * visible session (doctrine rule 2), which is why the output of a WAIT is card copy and a command rather
 * than a spawned refresh.
 */

import type { InFlightRefresh } from "../corpus/refreshSlot.js";
import type { CorpusSource } from "../corpus/types.js";
import { type CoverageLeg, type CoverageManifest, legObservationAgeDays, refreshableLegSource } from "./coverage.js";

/**
 * How far behind a source's stored cursor may be before this gate calls it BEHIND. Four hours, in minutes.
 *
 * It is the owner's own "something that happened within the last few hours", and it is uniform across
 * sources on purpose. A source's SCHEDULED window (`corpus/freshnessPolicy.ts`) is a background cadence and
 * may be wider — notion eight hours, gmail twelve, calendar and fathom a day — so a
 * recency question can arrive while the schedule is legitimately behind it. That is this gate's job, not a
 * contradiction of the schedule: the slower cadence is cheap precisely because this second line catches
 * the question that cannot wait.
 *
 * Nothing here shares the query path's own thresholds and that is the point: `STALE_AFTER_DAYS` (7) is a
 * reporting fact and `REFUSE_AFTER_DAYS` (14) is a policy about a corpus that has gone dark. Both are
 * measured in days; a question about this afternoon is not.
 */
export const BEHIND_AFTER_MINUTES = 4 * 60;

/**
 * What one source's refresh COSTS, in seconds, at the floor — a refresh that finds little or nothing.
 *
 * MEASURED on the owner's own home; reproduce one with
 * `time slopweaver refresh --source <source>` against a corpus that is already current, which is the run
 * this floor describes. They are FLOORS rather than expectations: a source with a real backlog to fetch
 * takes longer, never less, so an estimate built from them is a lower bound and says so.
 *
 * Notion's entry is the one that is not a measurement of a completed run — it did not finish a fourteen-hour
 * gap inside forty minutes — so it is carried as `unbounded` and rendered "at least", never "about".
 */
export const REFRESH_FLOOR_SECONDS: Partial<
  Record<CorpusSource, { readonly seconds: number; readonly unbounded: boolean }>
> = {
  github: { seconds: 57, unbounded: false },
  gmail: { seconds: 8, unbounded: false },
  linear: { seconds: 366, unbounded: false },
  notion: { seconds: 2400, unbounded: true },
  slack: { seconds: 1054, unbounded: false },
};

/**
 * The floor used for a source the measurement above does not name.
 *
 * It is the largest measured floor, marked unbounded, rather than a small default: an unmeasured source
 * quoted optimistically is exactly the invented estimate the owner asked not to be given, and a wait that
 * turns out shorter than "at least 40 min" disappoints nobody. `calendar` and `outlook-calendar` are the
 * refreshable sources that reach it today — the measurement timed neither, and borrowing gmail's eight seconds
 * because each is one person's diary would be a guess wearing a measurement's clothes.
 */
const UNMEASURED_FLOOR = { seconds: 2400, unbounded: true } as const;

/** A recency marker — a word that says the asker means NOW, whatever the rest of the question asks about. */
const RECENCY_MARKERS: readonly RegExp[] = [
  /\btoday\b/,
  /\btonight\b/,
  /\bthis (?:morning|afternoon|evening|week|sprint|cycle|month)\b/,
  /\byesterday\b/,
  /\blatest\b/,
  /\bcurrent(?:ly)?\b/,
  /\bright now\b/,
  /\bat the moment\b/,
  /\bstill\b/,
  /\bso far\b/,
  /\bsince\b/,
  /\brecent(?:ly)?\b/,
  /\blately\b/,
  /\bup to date\b/,
  /\bas of now\b/,
  /\bjust (?:now|landed|merged|shipped)\b/,
];

/**
 * A question opener that asks what is TRUE NOW. Matched anywhere in the question, not only at its start —
 * a Slack tag routinely buries the question inside a sentence of context.
 */
const STATE_PHRASES: readonly RegExp[] = [
  /\bwhat(?:'s| is| are)? the (?:status|state)\b/,
  /\bwho owns\b/,
  /\bwho(?:'s| is) (?:on|working on|looking at)\b/,
  /\bwhere (?:are we|is it|are we up to)\b/,
  /\bwhat(?:'s| is) (?:blocking|left|outstanding|open|next)\b/,
  /\bhow many .{0,40}(?:are|remain|open)\b/,
  /\bis (?:it|this|that|there) still\b/,
  /\bare (?:we|they) still\b/,
  /\bwhat needs\b/,
  /\bwaiting on\b/,
];

/**
 * A question opener that asks what was TRUE THEN. It suppresses {@link STATE_PHRASES} — and only those, never
 * a recency marker: "what did we decide about the current sprint" carries both, and the marker wins because
 * the asker put a now-word in a question about a moving thing. The second gate is what stops that reading
 * from costing a wait when it is wrong.
 */
const HISTORY_PHRASES: readonly RegExp[] = [
  /\bwhy did\b/,
  /\bwhy (?:do|does|was|were|is) .{0,30}\b(?:chosen|decided|picked|built|done)\b/,
  /\bwhat did we (?:decide|choose|agree|say)\b/,
  /\bwhen did\b/,
  /\bwho decided\b/,
  /\bhow did we\b/,
  /\bwhat was the (?:reason|thinking|rationale)\b/,
];

/**
 * Whether the question is about a MOVING TARGET, and the phrase that decided it.
 *
 * @internal
 */
export interface MovingTargetVerdict {
  readonly moving: boolean;
  /** The reader-facing reason — never empty, so a verdict always says what decided it. */
  readonly because: string;
}

/** One source the corpus is behind on, with the age of its stored cursor when the gate judged it. */
export interface BehindSource {
  readonly source: CorpusSource;
  readonly behindMinutes: number;
  /** The stored resume cursor the age was measured from — the instant this source was last OBSERVED. */
  readonly cursorIso: string;
}

/** How long a wait is expected to take, and whether that number is a floor or a bound. */
export interface WaitEstimate {
  /** Seconds, summed across the sources being waited on — they refresh in one sequential run. */
  readonly seconds: number;
  /** True when at least one source's cost is a lower bound with no measured upper one (notion). */
  readonly unbounded: boolean;
  /** The words a person waiting reads: `about 18 min`, `at least 40 min`, `under a minute`. */
  readonly words: string;
}

/** The gate's verdict: answer from what is here, or wait for named sources to catch up first. */
export type JustInTimeVerdict =
  | { readonly decision: "answer-now"; readonly because: string }
  | {
      readonly decision: "wait";
      readonly because: string;
      readonly waitOn: readonly BehindSource[];
      readonly alreadyRunning: readonly InFlightRefresh[];
      readonly estimate: WaitEstimate;
    };

/** The WAIT arm of {@link JustInTimeVerdict}, named so a consumer that only handles waiting can say so. */
export type JustInTimeWait = Extract<JustInTimeVerdict, { readonly decision: "wait" }>;

/**
 * Whether a question is about a moving target — gate (i). Pure, and case-insensitive.
 *
 * @param question the asker's own words, addressing and all
 * @returns the verdict, carrying the marker or phrase that decided it
 */
export function isMovingTarget({ question }: { question: string }): MovingTargetVerdict {
  const text = question.toLowerCase();
  const marker = RECENCY_MARKERS.find((pattern) => pattern.test(text));
  if (marker !== undefined) {
    // The marker just tested true on this same text and carries no `g`/`y` flag, so `exec` matches it again.
    const matched = marker.exec(text)![0];
    return { because: `the question carries a recency marker ("${matched}")`, moving: true };
  }
  const history = HISTORY_PHRASES.find((pattern) => pattern.test(text));
  if (history !== undefined) {
    return { because: "the question asks what was decided, not what is true now", moving: false };
  }
  const state = STATE_PHRASES.find((pattern) => pattern.test(text));
  if (state !== undefined) {
    // The phrase just tested true on this same text and carries no `g`/`y` flag, so `exec` matches it again.
    const matched = state.exec(text)![0];
    return { because: `the question asks state rather than history ("${matched}")`, moving: true };
  }
  return { because: "the question carries no recency marker and does not ask for current state", moving: false };
}

/**
 * The sources whose stored cursor is further behind than `behindAfterMinutes` — gate (ii)'s first half. Pure.
 *
 * Judges the leg's stored resume CURSOR, never `newestIso`, for the reason
 * {@link ./coverage.CoverageLeg.cursorIso} sets out at length: age policy is a claim about whether the world
 * was looked at, and only the cursor makes that claim. A leg `refresh` does not keep current — `gold`, the
 * flat corpus root, `self` — is excluded by {@link ./coverage.isRefreshableLeg}, so a gate verdict never
 * names a command that would not have helped.
 *
 * @param manifest the coverage manifest the query already produced
 * @param nowIso the reference "now"
 * @param behindAfterMinutes how stale a cursor must be to count
 * @returns the behind sources, in manifest order
 */
export function sourcesBehind({
  manifest,
  nowIso,
  behindAfterMinutes = BEHIND_AFTER_MINUTES,
}: {
  manifest: CoverageManifest;
  nowIso: string;
  behindAfterMinutes?: number;
}): readonly BehindSource[] {
  return manifest.legs.flatMap((leg: CoverageLeg): readonly BehindSource[] => {
    const source = refreshableLegSource({ leg });
    const ageDays = legObservationAgeDays({ leg, nowIso });
    const cursorIso = leg.cursorIso;
    if (source === undefined || ageDays === undefined || cursorIso === undefined) {
      return [];
    }
    const behindMinutes = ageDays * 24 * 60;
    return behindMinutes > behindAfterMinutes ? [{ behindMinutes, cursorIso, source }] : [];
  });
}

/**
 * How long waiting on these sources is expected to take. Pure.
 *
 * Sums rather than maximises, because the remedy is one sequential `refresh --source a --source b` run. A
 * source already being refreshed by another process still contributes its floor: that run started before
 * this one asked, so its remaining time is unknown from here and assuming it is nearly done is the invented
 * estimate this whole function exists to avoid.
 *
 * @param sources the sources being waited on
 * @returns the estimate, with the words a person waiting reads
 */
export function waitEstimate({ sources }: { sources: readonly BehindSource[] }): WaitEstimate {
  let seconds = 0;
  let unbounded = false;
  for (const { source } of sources) {
    const { [source]: floor = UNMEASURED_FLOOR } = REFRESH_FLOOR_SECONDS;
    seconds += floor.seconds;
    unbounded = unbounded || floor.unbounded;
  }
  return { seconds, unbounded, words: estimateWords({ seconds, unbounded }) };
}

/**
 * The estimate in the words a person waiting actually uses — whole minutes, and never a false precision.
 *
 * @param seconds the summed floor
 * @param unbounded whether any source's floor has no measured upper bound
 * @returns e.g. `about 18 min`, `at least 40 min`, `under a minute`
 */
export function estimateWords({ seconds, unbounded }: { seconds: number; unbounded: boolean }): string {
  if (seconds < 60) {
    return unbounded ? "at least a minute" : "under a minute";
  }
  const minutes = Math.round(seconds / 60);
  return `${unbounded ? "at least" : "about"} ${String(minutes)} min`;
}

/**
 * The whole gate: both halves, evaluated over what the query already has. Pure.
 *
 * @param question the asker's own words
 * @param manifest the coverage manifest of the load this query ran over
 * @param sliceSources the sources of the records the ranking actually returned — observed, never guessed
 * @param nowIso the reference "now"
 * @param inFlight refreshes already running on this machine, so the card never proposes a second one
 * @param behindAfterMinutes how stale a cursor must be to count
 * @returns the verdict, carrying the card's own reason either way
 */
export function justInTimeVerdict({
  question,
  manifest,
  sliceSources,
  nowIso,
  inFlight = [],
  behindAfterMinutes = BEHIND_AFTER_MINUTES,
}: {
  question: string;
  manifest: CoverageManifest;
  sliceSources: readonly CorpusSource[];
  nowIso: string;
  inFlight?: readonly InFlightRefresh[];
  behindAfterMinutes?: number;
}): JustInTimeVerdict {
  const moving = isMovingTarget({ question });
  if (!moving.moving) {
    return { because: `answering from what is here: ${moving.because}`, decision: "answer-now" };
  }
  const behind = sourcesBehind({ behindAfterMinutes, manifest, nowIso });
  const drawnOn = new Set(sliceSources);
  const waitOn = behind.filter(({ source }) => drawnOn.has(source));
  if (waitOn.length === 0) {
    const named = behind.map(({ source }) => source).join(", ");
    const tail =
      behind.length === 0
        ? "every source this question reads is current"
        : `nothing this question reads is behind (${named} ${behind.length === 1 ? "is" : "are"} behind and contributed nothing)`;
    return { because: `answering from what is here: ${tail}`, decision: "answer-now" };
  }
  const waiting = new Set(waitOn.map(({ source }) => source));
  return {
    alreadyRunning: inFlight.filter(({ source }) => waiting.has(source)),
    because: `${moving.because}, and this question reads ${waitOn.map(({ source }) => source).join(", ")}`,
    decision: "wait",
    estimate: waitEstimate({ sources: waitOn }),
    waitOn,
  };
}

/**
 * The refresh command that clears a wait — the whole remedy, in one line a session can run.
 *
 * Carries no `--since`, deliberately and for the reason `docs/freshness-contract/consumers.md` gives: an explicit
 * `--since` overrides the stored cursor, so a window pinned past a HELD cursor would step over the exact
 * interval the wait is reporting and then advance past it. A bare `--source` resumes from the cursor.
 *
 * `--jit` is what takes the per-source refresh slot (`../corpus/refreshSlot.ts`), so two turns waiting on
 * the same source start one backfill rather than two.
 *
 * @param sources the sources being waited on
 * @returns the command line
 */
export function waitRefreshCommand({ sources }: { sources: readonly BehindSource[] }): string {
  const flags = sources.map(({ source }) => `--source ${source}`).join(" ");
  return `slopweaver refresh --jit ${flags}`;
}

/**
 * The refusal the freshness gate prints when the gate says WAIT — why, what to run, and what the card must say
 * first. Pure; the shell prints the lines and returns the code.
 *
 * It is a REFUSAL rather than a warning for the reason `docs/freshness-contract/rules-and-stamps.md`'s rule 3 gives: "warn
 * and proceed" is removed for anything that affects what gets sent, and a brief handed to a session over a
 * corpus the gate has just judged too old is exactly that. The brief is not written — the session refreshes,
 * then asks again, and the second brief is the one it answers from.
 *
 * The card lines are passed IN rather than composed here, because they belong to the turn
 * (`../live/turn/freshnessCard.ts`) and this module knows nothing about a card's width.
 *
 * @param wait the gate's wait verdict
 * @param cardLines the stage lines the turn posts before it starts waiting
 * @returns the refusal lines, in print order
 */
export function justInTimeRefusalLines({
  wait,
  cardLines,
}: {
  wait: JustInTimeWait;
  cardLines: readonly string[];
}): readonly string[] {
  return [
    `refusing to answer yet: ${wait.because} — answering now would describe an afternoon this corpus has not seen`,
    ...wait.waitOn.map(
      ({ source, behindMinutes, cursorIso }) =>
        `  behind: ${source} — last observed ${cursorIso} (${(behindMinutes / 60).toFixed(1)}h ago)`,
    ),
    `  wait: \`${waitRefreshCommand({ sources: wait.waitOn })}\` (${wait.estimate.words}), then re-run this brief`,
    ...wait.alreadyRunning.map(
      ({ source, pid, startedAtIso }) =>
        `  already running: a just-in-time refresh of ${source} holds the slot (pid ${String(pid)}, since ${startedAtIso}) — that command will skip it and say so`,
    ),
    "  say this on the card FIRST, so a wait is never silence:",
    ...cardLines.map((line) => `    · ${line}`),
    "or pass `--stale-ok` when the question is deliberately about the past — never to get past a wait you have not read",
  ];
}
