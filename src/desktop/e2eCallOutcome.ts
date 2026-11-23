/**
 * Whether one call scenario of `slopweaver desktop e2e --call` passed, from what its drive saw, and the structured
 * evidence `report.json` keeps for it. Pure.
 *
 * A scenario fails for the first of these it shows, in this order — the order is how far each one is from the call
 * merely being slow: its cleanup could not prove its calls ended; it could not be driven; a call that was not its own
 * appeared, or more calls opened than it placed; its call never went live; the call dropped before judgement; the page
 * threw; the crash evidence is missing; the owner's turn never reached the transcript; the voice never answered; the
 * voice opened by introducing itself; the heap grew without bound; the long task never ran long; no call holds the
 * card-read witness; a call moved the owner off the card they said they were still reading, or none held; a reopened
 * call did not hold the owner's reopen ruling; a card stayed up after the owner asked for the next one, or none was
 * taken down. Which of the last eleven a scenario is judged on is
 * `./e2eCallRequirements.ts`'s `callRequirementsOf`.
 */
import type { CardFidelityObservation } from "./cardFidelity.js";
import type { E2eDesktopEvent, E2ePlanCallLogEvent } from "./e2eCallEvidence.js";
import type { E2eCallStepId } from "./e2eCallPlan.js";
import type { E2eQueueSearchAnswer, E2eQueueSearchObserved } from "./e2eCallQueueSearch.js";
import type { E2eReopenWitness } from "./e2eCallReopen.js";
import { callRequirementsOf, type E2eCallRequirements } from "./e2eCallRequirements.js";
import { type E2eCallOpening, greetingVerdict } from "./e2eGreetingJudge.js";
import type { E2eHeapSample, E2eHeapVerdict } from "./e2eHeapTrend.js";
import { type E2eVerdict, failed } from "./e2eOutcome.js";

/** What `report.json` keeps for one call scenario. */
export interface E2eCallEvidence {
  /** The plan calls this scenario opened, from each successful `/api/talk/offer` answer, in order. */
  readonly planCallIds: readonly string[];
  /** The transcript calls its pages wrote to, from each `/api/talk/transcript` batch, in order. */
  readonly transcriptCallIds: readonly string[];
  /** The lease ids that went live while it ran. */
  readonly leaseIds: readonly string[];
  readonly heapSamples: readonly E2eHeapSample[];
  readonly heapVerdict: E2eHeapVerdict | undefined;
  /** The desktop log's entries appended while it ran; the judges keep only those naming its calls. */
  readonly desktopEvents: readonly E2eDesktopEvent[];
  /** The console's plan-call lines appended while it ran. */
  readonly planEvents: readonly E2ePlanCallLogEvent[];
  /** Uncaught errors the voice page threw while it ran. */
  readonly pageErrors: readonly string[];
  /** Its transcript calls whose record holds a successful `talk find-card` run; read for `queue-search` only. */
  readonly queueSearchToolCallIds: readonly string[];
  /**
   * Its transcript calls whose record holds `card-read`'s whole ordered witness (`./e2eCallCardRead.ts`), each judged
   * alone; read for `card-read` and `card-read-typed` only.
   */
  readonly cardReadWitnessCallIds: readonly string[];
  /**
   * `card-reading-hold`'s witness over each of its calls (`./e2eCallCardReadingHold.ts`): the calls that held — the card
   * up, the owner's "let me just keep reading", and a whole window with nothing moving the owner — and, for each that
   * did not, the line that moved the owner. Read for `card-reading-hold` only.
   */
  readonly readingHold: { readonly heldCallIds: readonly string[]; readonly moves: readonly string[] };
  /**
   * `card-next`'s witness over each of its calls (`./e2eCallCardNext.ts`): each line that took the card down after the
   * owner's "next card please", naming the path that moved it, and each call where the card stayed up past the window. Read for
   * `card-next` only.
   */
  readonly cardNext: { readonly moves: readonly string[]; readonly stuck: readonly string[] };
  /**
   * Whether each of its calls gave a faithful account of the card (`./cardFidelity.ts`): REPORTED, never part of the
   * verdict, so a misread card is a finding in the sweep's table rather than a scenario that failed to run.
   */
  readonly cardFidelity: readonly CardFidelityObservation[];
  /**
   * What the voice opened each of its calls with — its first FINAL segment — and what in it introduced the voice
   * rather than greeting the owner (`./e2eGreetingJudge.ts`). Read for `call-live` only.
   */
  readonly openings: readonly E2eCallOpening[];
  /**
   * `call-reopen`'s witness over its three calls (`./e2eCallReopen.ts`): B's measured handing, C's giving way, and the
   * first way they fall short of the ruling. Read for `call-reopen` only; `undefined` on every other scenario.
   */
  readonly reopen: E2eReopenWitness | undefined;
}

/** The evidence of a scenario that never launched. */
export const NO_CALL_EVIDENCE: E2eCallEvidence = {
  cardFidelity: [],
  cardNext: { moves: [], stuck: [] },
  cardReadWitnessCallIds: [],
  desktopEvents: [],
  heapSamples: [],
  heapVerdict: undefined,
  leaseIds: [],
  openings: [],
  pageErrors: [],
  planCallIds: [],
  planEvents: [],
  queueSearchToolCallIds: [],
  readingHold: { heldCallIds: [], moves: [] },
  reopen: undefined,
  transcriptCallIds: [],
};

/** What a scenario's drive saw, beside its evidence. */
export interface E2eCallObserved {
  /** Why the drive could not take a step it needed, such as a control that never showed. */
  readonly blocked: string | undefined;
  /** Why its cleanup could not prove every call it opened ended; fatal to the leg. */
  readonly cleanup: string | undefined;
  /** A live lease this scenario did not open, or a call count past what it placed. */
  readonly overlap: string | undefined;
  /** The first call showed its mute control. */
  readonly live: boolean;
  /** When the call dropped before judgement, in words; `undefined` while it held. */
  readonly dropped: string | undefined;
  /** A new final row of the owner's reached the transcript (for typing, one carrying the typed nonce). */
  readonly ownerTurn: boolean;
  /** A final voice row followed the owner's. */
  readonly voiceAnswer: boolean;
  /** The crash judgement (`./e2eCallCrash.ts`), `undefined` for a scenario with no crash. */
  readonly crash: E2eVerdict | undefined;
  /** How long real work was seen in flight on the session-details tray. */
  readonly longTaskMs: number | undefined;
  /** What `queue-search` saw of its search: the voice's terminal word and the calls that ran it. */
  readonly queueSearch: E2eQueueSearchObserved;
  readonly evidence: E2eCallEvidence;
}

/** What a scenario's drive reported, before its evidence was read. */
export interface E2eCallDriveSeen {
  readonly blocked: string | undefined;
  readonly overlap: string | undefined;
  /** A call the scenario could not prove ended mid-drive, which stops the leg as a cleanup failure does. */
  readonly stuck: string | undefined;
  readonly live: boolean;
  readonly dropped: string | undefined;
  readonly ownerTurn: boolean;
  readonly voiceAnswer: boolean;
  readonly longTaskMs: number | undefined;
  /** The terminal word of the voice's last row, for `queue-search`; `undefined` when it said none. */
  readonly queueSearchAnswer: E2eQueueSearchAnswer | undefined;
  /** The crash judgement, made over the evidence read AFTER cleanup, when every end line is in. */
  readonly crash: ((options: { readonly evidence: E2eCallEvidence }) => E2eVerdict) | undefined;
}

/**
 * The first problem of several, in the order they were given.
 *
 * @param problems each one, `undefined` where there was none
 * @returns the first, `undefined` when there was none
 */
function firstProblem(...problems: readonly (string | undefined)[]): string | undefined {
  return problems.find((one) => one !== undefined);
}

/**
 * Every problem of several, joined in the order given, so a later one never hides an earlier one.
 *
 * @param problems each one, `undefined` where there was none
 * @returns them joined, `undefined` when there was none
 */
function everyProblem(...problems: readonly (string | undefined)[]): string | undefined {
  const present = problems.filter((one) => one !== undefined);
  return present.length === 0 ? undefined : present.join("; ");
}

/**
 * What a scenario showed, from what its drive reported and what was read after its session closed. Where two problems
 * fill one field, the one that outranks the other wins: a call stuck mid-drive over a close that failed, the drive's
 * own overlap over the console's count. A blocked drive and unreadable logs are BOTH kept, unreadable logs first,
 * because a drive's block can name a conversation of the owner's it ended.
 *
 * @param seen what the drive reported
 * @param evidence what was read after cleanup
 * @param unread why the logs could not be read, when they could not
 * @param closed why closing the session could not prove its calls ended, when it could not
 * @param counted more plan calls than the scenario may open, in words, when there were
 * @returns what the judge reads
 */
export function observedOf({
  seen,
  evidence,
  unread,
  closed,
  counted,
}: {
  seen: E2eCallDriveSeen;
  evidence: E2eCallEvidence;
  unread: string | undefined;
  closed: string | undefined;
  counted: string | undefined;
}): E2eCallObserved {
  return {
    blocked: everyProblem(unread, seen.blocked),
    cleanup: firstProblem(seen.stuck, closed),
    crash: seen.crash?.({ evidence }),
    dropped: seen.dropped,
    evidence,
    ownerTurn: seen.ownerTurn,
    live: seen.live,
    longTaskMs: seen.longTaskMs,
    overlap: firstProblem(seen.overlap, counted),
    queueSearch: { answer: seen.queueSearchAnswer, toolCallIds: evidence.queueSearchToolCallIds },
    voiceAnswer: seen.voiceAnswer,
  };
}

/** The least real work the long-task scenario must show in flight. */
const LONG_TASK_MIN_MS = 10_000;

/** One trailing check's inputs. */
interface TrailingInput {
  readonly observed: E2eCallObserved;
  readonly needs: E2eCallRequirements;
}

/**
 * The crash check: its judge ran, and passed.
 *
 * @param observed what the drive saw
 * @param needs which checks apply
 * @returns `undefined` when it holds or does not apply, else the failure
 */
function crashCheck({ observed, needs }: TrailingInput): E2eVerdict | undefined {
  if (!needs.crash) {
    return undefined;
  }
  if (observed.crash === undefined) {
    return failed({ detail: "the crash was never judged", kind: "evidence-missing" });
  }
  return observed.crash.passed ? undefined : observed.crash;
}

/**
 * The turn checks: a final row of the owner's, then a voice answer after it.
 *
 * @param observed what the drive saw
 * @param needs which checks apply
 * @returns `undefined` when they hold or do not apply, else the first failure
 */
function turnCheck({ observed, needs }: TrailingInput): E2eVerdict | undefined {
  if (needs.ownerTurn && !observed.ownerTurn) {
    return failed({ detail: "no final row of the owner's reached the transcript", kind: "transcript-missing" });
  }
  if (needs.voiceAnswer && !observed.voiceAnswer) {
    return failed({ detail: "no final voice row followed the owner's", kind: "answer-missing" });
  }
  return undefined;
}

/**
 * The greeting check, `./e2eGreetingJudge.ts`'s {@link greetingVerdict}. It follows the turn checks, so a call the
 * voice never answered is named as that first.
 *
 * @param observed what the drive saw
 * @param needs which checks apply
 * @returns `undefined` when it holds or does not apply, else the failure
 */
function greetingCheck({ observed, needs }: TrailingInput): E2eVerdict | undefined {
  if (!needs.greeting) {
    return undefined;
  }
  return greetingVerdict({ openings: observed.evidence.openings });
}

/**
 * The queue-search check: the voice's last row said FOUND or NONE, and this call's record holds a successful
 * `talk find-card` run — the word proves the search answered, the entry proves the voice searched.
 *
 * @param observed what the drive saw
 * @param needs which checks apply
 * @returns `undefined` when it holds or does not apply, else the failure
 */
function queueSearchCheck({ observed, needs }: TrailingInput): E2eVerdict | undefined {
  if (!needs.queueSearch) {
    return undefined;
  }
  const { answer, toolCallIds } = observed.queueSearch;
  if (answer === "FAILED") {
    return failed({ detail: "the voice said the Queue search FAILED", kind: "queue-search-failed" });
  }
  if (answer === undefined) {
    return failed({
      detail: "the voice's last row after the typed question was not the one word FOUND or NONE",
      kind: "queue-search-failed",
    });
  }
  if (toolCallIds.length === 0) {
    return failed({
      detail: `the voice said ${answer} with no successful talk find-card run on its call`,
      kind: "queue-search-failed",
    });
  }
  return undefined;
}

/**
 * The heap check: the held call's samples were judged, and held flat.
 *
 * @param observed what the drive saw
 * @param needs which checks apply
 * @returns `undefined` when it holds or does not apply, else the failure
 */
function heapCheck({ observed, needs }: TrailingInput): E2eVerdict | undefined {
  if (!needs.heap) {
    return undefined;
  }
  const heap = observed.evidence.heapVerdict;
  if (heap === undefined) {
    return failed({ detail: "no heap samples were judged", kind: "heap-growth" });
  }
  return heap.passed ? undefined : failed({ detail: heap.detail, kind: "heap-growth" });
}

/**
 * The long-task check: real work was seen in flight for at least {@link LONG_TASK_MIN_MS}.
 *
 * @param observed what the drive saw
 * @param needs which checks apply
 * @returns `undefined` when it holds or does not apply, else the failure
 */
function longTaskCheck({ observed, needs }: TrailingInput): E2eVerdict | undefined {
  const exercised = observed.longTaskMs !== undefined && observed.longTaskMs >= LONG_TASK_MIN_MS;
  if (!needs.longTask || exercised) {
    return undefined;
  }
  return failed({
    detail: `did not exercise a long task: ${String(observed.longTaskMs)} ms of real work seen in flight, ${String(LONG_TASK_MIN_MS)} needed`,
    kind: "long-task-missing",
  });
}

/**
 * The card-read check: one of this instance's calls holds the whole ordered witness — the named card read or opened,
 * an answer, the typed challenge, the same card read or opened again, an answer. It follows the turn checks, so a missing
 * challenged answer is named as that first.
 *
 * @param observed what the drive saw
 * @param needs which checks apply
 * @returns `undefined` when it holds or does not apply, else the failure
 */
function cardReadCheck({ observed, needs }: TrailingInput): E2eVerdict | undefined {
  if (!needs.cardRead || observed.evidence.cardReadWitnessCallIds.length > 0) {
    return undefined;
  }
  return failed({
    detail:
      "no call of this scenario holds the named card read or opened, an answer, the typed challenge, the card read " +
      "or opened again and an answer, in that order",
    kind: "evidence-missing",
  });
}

/**
 * The reading-hold check: no call moved the owner off the card once they said they were still reading, and one held
 * through the whole window. A move outranks a missing hold, since it is the regression the scenario exists to catch.
 *
 * @param observed what the drive saw
 * @param needs which checks apply
 * @returns `undefined` when it holds or does not apply, else the failure
 */
function readingHoldCheck({ observed, needs }: TrailingInput): E2eVerdict | undefined {
  if (!needs.readingHold) {
    return undefined;
  }
  const { heldCallIds, moves } = observed.evidence.readingHold;
  if (moves.length > 0) {
    return failed({
      detail: `moved the owner off the card they were reading: ${moves.join("; ")}`,
      kind: "moved-off-card",
    });
  }
  if (heldCallIds.length > 0) {
    return undefined;
  }
  return failed({
    detail:
      "no call of this scenario holds the named card up while the owner keeps reading through a whole quiet window",
    kind: "evidence-missing",
  });
}

/**
 * The reopen check: the three calls hold the owner's reopen ruling (`./e2eCallReopen.ts`).
 *
 * @param observed what the drive saw
 * @param needs which checks apply
 * @returns `undefined` when it holds or does not apply, else the failure
 */
function reopenCheck({ observed, needs }: TrailingInput): E2eVerdict | undefined {
  if (!needs.reopen) {
    return undefined;
  }
  const { reopen } = observed.evidence;
  if (reopen === undefined) {
    return failed({ detail: "the three calls' reopen steps were never read", kind: "evidence-missing" });
  }
  if (!reopen.held) {
    return failed({ detail: reopen.problem, kind: "reopen-not-held" });
  }
  return undefined;
}

/**
 * The card-next check: a call's card stayed up past the window after the owner's ask fails it, the regression
 * the scenario exists to catch; else one call took it down.
 *
 * @param observed what the drive saw
 * @param needs which checks apply
 * @returns `undefined` when it holds or does not apply, else the failure
 */
function cardNextCheck({ observed, needs }: TrailingInput): E2eVerdict | undefined {
  if (!needs.cardNext) {
    return undefined;
  }
  const { moves, stuck } = observed.evidence.cardNext;
  if (stuck.length > 0) {
    return failed({
      detail: `the card stayed up after they asked for the next one: ${stuck.join("; ")}`,
      kind: "card-stuck",
    });
  }
  if (moves.length > 0) {
    return undefined;
  }
  return failed({
    detail: `no call of this scenario holds the named card up, the owner's "next card please" and the card taken down after it`,
    kind: "evidence-missing",
  });
}

/**
 * The trailing checks, in order.
 *
 * @returns `undefined` when all hold, else the first failure
 */
function trailing(input: TrailingInput): E2eVerdict | undefined {
  for (const check of [
    crashCheck,
    turnCheck,
    greetingCheck,
    queueSearchCheck,
    heapCheck,
    longTaskCheck,
    cardReadCheck,
    readingHoldCheck,
    reopenCheck,
    cardNextCheck,
  ]) {
    const verdict = check(input);
    if (verdict !== undefined) {
      return verdict;
    }
  }
  return undefined;
}

/**
 * Judge one call scenario.
 *
 * @param id the scenario
 * @param observed what its drive saw
 * @returns passed, or the first failure in the order above with its evidence
 */
export function judgeCallScenario({ id, observed }: { id: E2eCallStepId; observed: E2eCallObserved }): E2eVerdict {
  if (observed.cleanup !== undefined) {
    // A block kept beside the failed cleanup, since it may name a conversation of the owner's the drive ended.
    return failed({ detail: everyProblem(observed.cleanup, observed.blocked)!, kind: "cleanup-failed" });
  }
  if (observed.blocked !== undefined) {
    return failed({ detail: observed.blocked, kind: "blocked" });
  }
  if (observed.overlap !== undefined) {
    return failed({ detail: observed.overlap, kind: "overlapping-calls" });
  }
  if (!observed.live) {
    return failed({ detail: "the call never showed its mute control", kind: "call-not-live" });
  }
  if (observed.dropped !== undefined) {
    return failed({ detail: observed.dropped, kind: "call-dropped" });
  }
  const [pageError] = observed.evidence.pageErrors;
  if (pageError !== undefined) {
    return failed({ detail: pageError, kind: "page-error" });
  }
  const after = trailing({ needs: callRequirementsOf({ id }), observed });
  if (after === undefined) {
    return { passed: true };
  }
  // `draft-read-back`'s answer is a quoted draft, so a voice row with none is not "no voice row".
  if (id === "draft-read-back" && !after.passed && after.kind === "answer-missing") {
    return failed({
      detail: "the voice quoted no draft carrying both asked words after the owner's last turn",
      kind: "answer-missing",
    });
  }
  return after;
}
