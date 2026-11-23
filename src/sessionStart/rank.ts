/**
 * The ranking — rules over a scored item, never a model call.
 *
 * Three reasons it is rules, and each one is a constraint rather than a preference. It has to be
 * explainable in one clause per row, because a rank the owner cannot argue with is a rank they cannot correct. It
 * has to be reproducible, or "this moved since yesterday" means nothing. And it has to run inside the
 * seconds-long budget the scan already sets, which no model call does.
 *
 * ## The gates come first, and they are not signals
 *
 * Two rules decide whether an item is scored at all, and neither is a weight that a strong score can
 * outvote. {@link ../silver/ruleZero.applyRuleZero} removes what is somebody else's move until it has been
 * silent long enough to chase. {@link ../silver/traceBeforeRanking.traceBeforeRanking} removes what nobody
 * has actually read, and turns finished work into a close proposal rather than a task. An item that fails
 * either gate has no score, because scoring it would be answering a question that was never asked.
 *
 * ## The six signals, and which part of this is the owner's
 *
 * The signals and their ORDER are the owner's, from the reactions that built this list. The magnitudes are
 * not the owner's and are not measured, so they are the smallest whole numbers that preserve their order and nothing
 * more — see {@link SIGNAL_CAPS}. Stating that plainly matters: a reader who mistakes these for tuned
 * weights will try to tune them, and there is nothing here to tune yet.
 *
 * The caps are what make the sum meaningful. Uncapped, one detector that fires generously silently becomes
 * the ranking, and the row the owner most needs to see drops below a pile of near-duplicates.
 *
 * ## The tiebreak is the north star
 *
 * Wrapping up in-flight work rather than chasing new shiny things. Where two items score the same, the
 * one that finishes something already started wins. That single sentence is why cycle hygiene and an
 * overdue project update rank above a well-formed new request.
 *
 * Pure — no I/O, no clock. The caller supplies every measurement, including `nowIso`.
 */

import type { RuleZeroDecision } from "../silver/ruleZero.js";
import { isOnTheList } from "../silver/ruleZero.js";
import type { TraceDecision } from "../silver/traceBeforeRanking.js";
import { isRankable } from "../silver/traceBeforeRanking.js";
import type { Item } from "./item.js";
import type { Standing } from "./standing.js";

/**
 * The most each signal may contribute.
 *
 * Ordered exactly as the owner ordered them. `stoppedOnOwner` is highest because the cost of ignoring it is
 * somebody else's idle time as well as the owner's own. `drift` is second because the owner added it, and because
 * nothing else in the system surfaces a cycle that has quietly stopped matching reality — it degrades every
 * other signal that reads those systems. `age` is last and small, deliberately: an old item is a weak
 * signal on its own, and the strong version of age already lives in rule zero's silence threshold.
 *
 * These are one table in one file so changing the order costs an edit rather than a redesign.
 */
export const SIGNAL_CAPS = {
  age: 2,
  directness: 3,
  distanceToDone: 3,
  drift: 4,
  explicitPriority: 2,
  stoppedOnOwner: 5,
} as const;

/** The name of one ranking signal. */
export type SignalName = keyof typeof SIGNAL_CAPS;

/**
 * Every signal, in the owner's own order of importance.
 *
 * The order is load-bearing rather than cosmetic: {@link rankWhy} names the largest contributor, and where
 * two tie it takes the first, so a row explains itself with the signal the owner considers the more important of
 * the two.
 *
 * @internal exported for its own tests until a consumer outside this module reads it.
 */
export const SIGNAL_NAMES: readonly SignalName[] = [
  "stoppedOnOwner",
  "drift",
  "distanceToDone",
  "directness",
  "explicitPriority",
  "age",
];

/**
 * What each signal measured for one item, before capping.
 *
 * A detector reports what it saw and never what it is worth. Keeping the two apart is what lets the caps
 * above be the only place a magnitude is decided.
 */
export type SignalReadings = Readonly<Record<SignalName, number>>;

/**
 * Everything the ranker needs about one item that the item itself does not carry.
 *
 * `unverified` is separate from the readings because it is a statement about what could be measured rather
 * than about the item. Its effect is narrow on purpose: age stops counting, and the row says so. Letting it
 * suppress the item instead would hide real work behind a stale cursor, which is the failure the owner
 * named: a stale list defeats the purpose.
 */
export interface RankInput {
  readonly item: Item;
  readonly readings: SignalReadings;
  readonly ruleZero: RuleZeroDecision;
  readonly trace: TraceDecision;
  /** Whether the item finishes something already in flight. The tiebreak, and only the tiebreak. */
  readonly finishesInFlight: boolean;
  /** Whether the source's own cursor predates the item, so its freshness could not be established. */
  readonly unverified: boolean;
}

/** One item's place on the list, with the arithmetic that put it there. */
export interface RankedItem {
  readonly item: Item;
  readonly score: number;
  /** Each signal's capped contribution, so a row can show its own arithmetic. */
  readonly contributions: Readonly<Record<SignalName, number>>;
  /** One clause, plain words, naming the largest contributor and any gate that spoke. */
  readonly why: string;
  readonly finishesInFlight: boolean;
  readonly unverified: boolean;
  /**
   * What the trace decided, carried whole rather than reduced to a flag.
   *
   * A `propose-close` row is a different KIND of row — the action on it is to close something, not to do
   * it — and a reader who cannot tell the two apart is back to the rows the owner cannot argue
   * with. The decision travels with its `carried` evidence for the same reason: a close has to arrive with
   * the facts that closed it.
   */
  readonly trace: TraceDecision;
  /**
   * Where the row already stood before it ranked — ruled, in flight, stacked or untouched.
   *
   * Absent until {@link ./standing.applyStandings} has run; the ranker itself never reads it, because a
   * standing is applied AFTER the score exactly as a lock-in resolution is: what the owner said, or what a session
   * is already doing, is not a weight another row's score can outvote.
   */
  readonly standing?: Standing;
}

/** Why an item never reached the list. Carried so a detector's yield can be explained rather than guessed. */
export interface DroppedItem {
  readonly item: Item;
  readonly reason: string;
  /** Where the row already stood, once {@link ./standing.applyStandings} has run. */
  readonly standing?: Standing;
}

/**
 * The whole ranking pass: what made the list, and what did not, with a reason each.
 *
 * @internal the public contract for the session-start verb, exported ahead of the consumer that reads it.
 */
export interface Ranking {
  readonly ranked: readonly RankedItem[];
  readonly dropped: readonly DroppedItem[];
}

/**
 * Clamp one reading to its cap, and to zero below.
 *
 * A negative reading is a detector bug rather than a demotion, so it contributes nothing instead of
 * subtracting from the other signals.
 *
 * @param name which signal this is
 * @param reading what the detector measured
 * @returns the contribution, between zero and the signal's cap
 */
export function contribution({ name, reading }: { name: SignalName; reading: number }): number {
  if (!Number.isFinite(reading) || reading <= 0) {
    return 0;
  }
  return Math.min(reading, SIGNAL_CAPS[name]);
}

/**
 * Every signal's capped contribution for one set of readings.
 *
 * `age` is zeroed for an unverified item, because a cursor older than the item cannot establish that it has
 * been sitting. Scoring it as old would reward the very staleness the owner rejected.
 *
 * @param readings what each detector measured
 * @param unverified whether the source's cursor predates the item
 * @returns each signal's contribution
 */
export function contributions({
  readings,
  unverified,
}: {
  readings: SignalReadings;
  unverified: boolean;
}): Readonly<Record<SignalName, number>> {
  const at = ({ name }: { name: SignalName }): number => contribution({ name, reading: readings[name] });
  return {
    age: unverified ? 0 : at({ name: "age" }),
    directness: at({ name: "directness" }),
    distanceToDone: at({ name: "distanceToDone" }),
    drift: at({ name: "drift" }),
    explicitPriority: at({ name: "explicitPriority" }),
    stoppedOnOwner: at({ name: "stoppedOnOwner" }),
  };
}

/**
 * The plain words each signal puts on a row. No term here needs looking up, which is the owner's rule.
 *
 * `distanceToDone` says what the signal MEASURES rather than what a high reading feels like, and that is a
 * correction the first live run of the cycle leg bought. Both legs set it high for the same reason — one
 * answer unblocks a stopped run, one word closes a ticket, one word posts a drafted update — so the earlier
 * wording, "it is close to finished", put *"Vulnerability management has never had a status update … it is
 * close to finished"* in front of the owner. The arithmetic was right and the sentence was false, which is
 * the precise shape of a row the owner cannot argue with.
 */
const REASON_BY_SIGNAL: Readonly<Record<SignalName, string>> = {
  age: "it has been sitting a while",
  directness: "it was aimed at you directly",
  distanceToDone: "one reply finishes it",
  drift: "what the system says about this stopped matching what is true",
  explicitPriority: "its own source marks it urgent",
  stoppedOnOwner: "somebody is stopped waiting on you",
};

/**
 * The clause a row shows, naming the signal that actually carried it.
 *
 * A chase says so first, because the action on a chase row is different in kind from every other row and
 * burying that under a score is how "approve and merge" reached the owner's list in the first place.
 *
 * @param contributionsByName each signal's capped contribution
 * @param ruleZero what rule zero decided, whose reason is used verbatim on a chase
 * @param unverified whether the item's freshness could not be established
 * @returns one clause, plain words
 */
export function rankWhy({
  contributionsByName,
  ruleZero,
  unverified,
}: {
  contributionsByName: Readonly<Record<SignalName, number>>;
  ruleZero: RuleZeroDecision;
  unverified: boolean;
}): string {
  const suffix = unverified ? ", and its source has not been read since" : "";
  if (ruleZero.verdict === "chase") {
    return `${ruleZero.reason}${suffix}`;
  }
  const top = SIGNAL_NAMES.reduce((best, name) =>
    contributionsByName[name] > contributionsByName[best] ? name : best,
  );
  if (contributionsByName[top] === 0) {
    return `nothing ranked this above anything else${suffix}`;
  }
  return `${REASON_BY_SIGNAL[top]}${suffix}`;
}

/**
 * Score one item, or say why it was dropped.
 *
 * @param input the item, its readings, and what both gates decided
 * @returns the ranked item, or the drop with its reason
 */
export function rankOne({ input }: { input: RankInput }): RankedItem | DroppedItem {
  if (!isOnTheList({ decision: input.ruleZero })) {
    return { item: input.item, reason: input.ruleZero.reason };
  }
  if (!isRankable({ decision: input.trace })) {
    return { item: input.item, reason: input.trace.reason };
  }
  const contributionsByName = contributions({ readings: input.readings, unverified: input.unverified });
  const score = Object.values(contributionsByName).reduce((sum, value) => sum + value, 0);
  return {
    contributions: contributionsByName,
    finishesInFlight: input.finishesInFlight,
    item: input.item,
    score,
    trace: input.trace,
    unverified: input.unverified,
    why: rankWhy({ contributionsByName, ruleZero: input.ruleZero, unverified: input.unverified }),
  };
}

/**
 * Whether a `rankOne` result is a drop rather than a ranked row.
 *
 * Positional because TypeScript refuses a type predicate over a destructured binding (TS1230), which is the
 * compiler's decision rather than this repo's.
 */
function isDropped(result: RankedItem | DroppedItem): result is DroppedItem {
  return "reason" in result;
}

/**
 * Rank a whole candidate set, highest first.
 *
 * Ties break on the north star — the item that finishes something already in flight wins — and then on the
 * item's identity, so two runs over an unchanged world produce the same order. An unstable tail would make
 * every reconciliation report movement that did not happen.
 *
 * @param inputs every candidate, with its readings and both gate decisions
 * @returns what made the list, ranked, and what did not, with a reason each
 */
export function rankAll({ inputs }: { inputs: readonly RankInput[] }): Ranking {
  const results = inputs.map((input) => rankOne({ input }));
  const dropped = results.filter((result): result is DroppedItem => isDropped(result));
  const ranked = results.filter((result): result is RankedItem => !isDropped(result));
  const sorted = ranked.toSorted((left, right) => {
    if (left.score !== right.score) {
      return right.score - left.score;
    }
    if (left.finishesInFlight !== right.finishesInFlight) {
      return left.finishesInFlight ? -1 : 1;
    }
    return `${left.item.source}:${left.item.nativeId}`.localeCompare(`${right.item.source}:${right.item.nativeId}`);
  });
  return { dropped, ranked: sorted };
}
