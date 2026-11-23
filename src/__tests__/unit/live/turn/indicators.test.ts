import { describe, expect, it } from "vitest";
import { err, ok } from "../../../../lib/result.js";
import {
  finaliseIndicators,
  type IndicatorOutcome,
  indicatorPlanFor,
  type TerminalChecklist,
  type TerminalReaction,
  type TurnIndicatorSeams,
  type TurnTerminalKind,
  terminalChecklistProgress,
  terminalReaderReasonFor,
  terminalReasonFor,
} from "../../../../live/turn/indicators.js";

/**
 * The exact door refusal the owner hit —`verb:turn.answer` on `D0SYN000001`/
 * `1787485240.339229`, refused at 13:07:28.170Z with `ANSWER_UNREVIEWED`. It is the fixture for this whole
 * file because it is the measured instance the seam exists for: a REAL refusal, a working gate, and every
 * indicator left standing behind it.
 */
const REFUSAL_REASON =
  "the admit door refused to post the turn's answer — ANSWER_UNREVIEWED: no review verdict accompanies " +
  "this answer, so nothing but its author has read it — have a reviewing session bind a verdict to it";

/**
 * Every terminal kind, EXHAUSTIVE BY CONSTRUCTION rather than by hand.
 *
 * The hand-written list this replaces claimed to be every kind and was not: `ignored` was added to
 * `TurnTerminalKind` and never added here, so three tests that read as whole-vocabulary coverage silently
 * stopped covering it, and `triaged` would have slipped past them the same way. `satisfies Record<...>`
 * makes a missing kind a COMPILE error, and `Object.values` needs no assertion to come back typed.
 *
 * Alphabetical, so the key order a reader checks the expectations against is the one obvious ordering
 * rather than a remembered lifecycle sequence.
 */
const EVERY_KIND: readonly TurnTerminalKind[] = Object.values({
  abandoned: "abandoned",
  answered: "answered",
  failed: "failed",
  ignored: "ignored",
  "left-for-a-human": "left-for-a-human",
  refused: "refused",
  satisfied: "satisfied",
  triaged: "triaged",
  withheld: "withheld",
} satisfies Record<TurnTerminalKind, TurnTerminalKind>);

/** One recorded seam call. Not a mock — a plain object of closures over `log`. */
interface Recorded {
  readonly seam: "end-status" | "settle-checklist" | "settle-reaction";
  readonly checklist?: TerminalChecklist;
  readonly reaction?: TerminalReaction;
}

/** Recording seams whose three failure modes are each independently switchable. */
function recordingSeams({
  log,
  statusRefusal,
  checklistFails,
  reactionRefusal,
}: {
  log: Recorded[];
  statusRefusal?: string;
  checklistFails?: boolean;
  reactionRefusal?: string;
}): TurnIndicatorSeams {
  return {
    endStatus: async (): Promise<IndicatorOutcome> => {
      log.push({ seam: "end-status" });
      return statusRefusal === undefined ? ok(undefined) : err(statusRefusal);
    },
    settleChecklist: async ({ checklist }) => {
      log.push({ checklist, seam: "settle-checklist" });
      return checklistFails !== true;
    },
    settleReaction: async ({ reaction }): Promise<IndicatorOutcome> => {
      log.push({ reaction, seam: "settle-reaction" });
      return reactionRefusal === undefined ? ok(undefined) : err(reactionRefusal);
    },
  };
}

describe("indicatorPlanFor", () => {
  it("clears the status for every terminal kind — no ending leaves the bot claiming to think", () => {
    const cleared = EVERY_KIND.map(
      (kind) => indicatorPlanFor({ state: { kind, readerReason: "r", reason: "r" } }).clearStatus,
    );

    expect(cleared).toEqual([true, true, true, true, true, true, true, true, true]);
  });

  it("settles a reaction for every terminal kind — :eyes: never stands over a finished turn", () => {
    const reactions = EVERY_KIND.map(
      (kind) => indicatorPlanFor({ state: { kind, readerReason: "r", reason: "r" } }).reaction,
    );

    expect(reactions).toEqual([
      "stopped",
      "completion",
      "stopped",
      "stopped",
      // `left-for-a-human` is its OWN ending, never `acknowledged`: a reply is owed, by a person.
      "for-a-human",
      "stopped",
      // `satisfied` is the SECOND `completion` in this list and the whole point of the kind: the asker's
      // answer is standing in the thread, it simply belongs to a different ask.
      "completion",
      "acknowledged",
      "stopped",
    ]);
  });

  it("ticks the checklist done exactly when an answer stands in the thread, whosever ask it answers", () => {
    const kinds = EVERY_KIND.map(
      (kind) => indicatorPlanFor({ state: { kind, readerReason: "r", reason: "r" } }).checklist.kind,
    );

    expect(kinds).toEqual(["failed", "done", "failed", "failed", "failed", "failed", "done", "failed", "failed"]);
  });

  it("carries the door's own refusal reason onto the card, prefixed with what kind of ending it was", () => {
    const plan = indicatorPlanFor({ state: { kind: "refused", readerReason: REFUSAL_REASON, reason: REFUSAL_REASON } });

    expect(plan.checklist).toEqual({
      kind: "failed",
      reason: `refused by the admit door, nothing sent — ${REFUSAL_REASON}`,
    });
  });

  /**
   * The measured defect: a worker's own `--failed "<reason>"` report is operator prose written
   * for the next session, not the channel, so the checklist must never render `state.reason` for a `failed`
   * ending — only `state.readerReason`, which the two fields let diverge on purpose.
   */
  it("never renders the operator's own reason onto a failed card when it differs from the reader-facing one", () => {
    const plan = indicatorPlanFor({
      state: {
        kind: "failed",
        readerReason: "no answer is coming — the composed answer was over the size cap",
        reason: "this is over the count/aggregate cap — run slopweaver hatch open truncated-send to post it truncated",
      },
    });

    expect(plan.checklist).toEqual({
      kind: "failed",
      reason: "this turn failed — no answer is coming — the composed answer was over the size cap",
    });
  });
});

describe("terminalReasonFor", () => {
  it("names the ENDING, not just the reason, so three different next moves read differently", () => {
    const clauses = EVERY_KIND.map((kind) =>
      terminalReasonFor({ state: { kind, readerReason: "irrelevant here", reason: "the pool exhausted" } }),
    );

    expect(clauses).toEqual([
      "this turn was abandoned — the pool exhausted",
      "the pool exhausted",
      "this turn failed — the pool exhausted",
      "this ask is being permanently ignored — the pool exhausted",
      "read and judged, left for a person to answer — the pool exhausted",
      "refused by the admit door, nothing sent — the pool exhausted",
      "already answered in this thread — the pool exhausted",
      "read and judged, no reply owed — the pool exhausted",
      "held for review, nothing sent — the pool exhausted",
    ]);
  });

  /**
   * `turnFailureForm`'s own header (`./failureForm.ts`) documents its `reason` parameter as "FOLD only", and the
   * owner's ruling behind `failureIndex` in the same file leaves the fold deliberately technical — this
   * function is what that card's fold is built from, so it stays on {@link TurnTerminalState.reason}, never
   * the reader-facing sentence, even when the two diverge.
   */
  it("renders the operator detail, never the reader-facing sentence, when the two diverge", () => {
    const clause = terminalReasonFor({
      state: {
        kind: "failed",
        readerReason: "no answer is coming — the composed answer was over the size cap",
        reason: "body: this is over the count/aggregate cap — run slopweaver hatch open truncated-send",
      },
    });

    expect(clause).toBe(
      "this turn failed — body: this is over the count/aggregate cap — run slopweaver hatch open truncated-send",
    );
  });
});

describe("terminalReaderReasonFor", () => {
  it("names the ENDING, not just the reader-facing reason, so three different next moves read differently", () => {
    const clauses = EVERY_KIND.map((kind) =>
      terminalReaderReasonFor({ state: { kind, readerReason: "the pool exhausted", reason: "irrelevant here" } }),
    );

    expect(clauses).toEqual([
      "this turn was abandoned — the pool exhausted",
      "the pool exhausted",
      "this turn failed — the pool exhausted",
      "this ask is being permanently ignored — the pool exhausted",
      "read and judged, left for a person to answer — the pool exhausted",
      "refused by the admit door, nothing sent — the pool exhausted",
      "already answered in this thread — the pool exhausted",
      "read and judged, no reply owed — the pool exhausted",
      "held for review, nothing sent — the pool exhausted",
    ]);
  });

  /**
   * The measured defect, from the real-world tagging dogfood: a worker's own
   * `turn resume --failed "<reason>"` report is operator prose written for the next session, not the
   * channel — this is the one function safe to render onto a surface with no fold, precisely because it
   * never reaches {@link TurnTerminalState.reason}.
   */
  it("renders the reader-facing sentence, never the operator detail, when the two diverge", () => {
    const clause = terminalReaderReasonFor({
      state: {
        kind: "failed",
        readerReason: "no answer is coming — the composed answer was over the size cap",
        reason: "body: this is over the count/aggregate cap — run slopweaver hatch open truncated-send",
      },
    });

    expect(clause).toBe("this turn failed — no answer is coming — the composed answer was over the size cap");
  });
});

describe("terminalChecklistProgress", () => {
  it("jumps a done checklist to every step and writes the detail on the last one", () => {
    const progress = terminalChecklistProgress({
      checklist: { detail: "answered from 12 pinned records", kind: "done" },
      completed: 1,
      details: ['"why did staging exhaust?"'],
      stepCount: 3,
    });

    expect(progress.completed).toBe(3);
    expect(progress.details).toEqual(['"why did staging exhaust?"', undefined, "answered from 12 pinned records"]);
  });

  /**
   * The edge that would have re-created the defect one layer down: `turnChecklist` renders `failure` on the
   * step AT `completed`, so a turn whose query fired one `onPhase` per step reaches `completed === stepCount`
   * — an index no step occupies. Without the pin, the reason renders NOWHERE and every step shows ticked
   * green over a turn that never answered.
   */
  it("pins a failed checklist to a real step, so the reason can never render on no step at all", () => {
    const progress = terminalChecklistProgress({
      checklist: { kind: "failed", reason: REFUSAL_REASON },
      completed: 2,
      details: ["a", "b"],
      stepCount: 2,
    });

    expect(progress.completed).toBe(1);
    expect(progress.failure).toBe(REFUSAL_REASON);
  });

  it("keeps a failed checklist where the turn actually got to when it stopped short", () => {
    const progress = terminalChecklistProgress({
      checklist: { kind: "failed", reason: "the corpus is unreadable" },
      completed: 1,
      details: ["a"],
      stepCount: 4,
    });

    expect(progress.completed).toBe(1);
    expect(progress.failure).toBe("the corpus is unreadable");
  });
});

describe("finaliseIndicators", () => {
  it("settles the status FIRST, then the card, then the reaction — the timer stops before anything else", async () => {
    const log: Recorded[] = [];
    await finaliseIndicators({
      seams: recordingSeams({ log }),
      state: { kind: "refused", readerReason: REFUSAL_REASON, reason: REFUSAL_REASON },
    });

    expect(log.map((entry) => entry.seam)).toEqual(["end-status", "settle-checklist", "settle-reaction"]);
  });

  it("settles all three for a REFUSED turn — the measured case where it settled none", async () => {
    const log: Recorded[] = [];
    const finalisation = await finaliseIndicators({
      seams: recordingSeams({ log }),
      state: { kind: "refused", readerReason: REFUSAL_REASON, reason: REFUSAL_REASON },
    });

    expect(finalisation.failures).toEqual([]);
    expect(finalisation.checklistSettled).toBe(true);
    expect(log[1]!.checklist).toEqual({
      kind: "failed",
      reason: `refused by the admit door, nothing sent — ${REFUSAL_REASON}`,
    });
    expect(log[2]!.reaction).toBe("stopped");
  });

  it("settles all three for an ABANDONED turn, which nothing inside that turn is alive to do", async () => {
    const log: Recorded[] = [];
    const finalisation = await finaliseIndicators({
      seams: recordingSeams({ log }),
      state: {
        kind: "abandoned",
        readerReason: "its lease ran out at 2026-08-23T15:07:08.831Z",
        reason: "its lease ran out at 2026-08-23T15:07:08.831Z",
      },
    });

    expect(finalisation.failures).toEqual([]);
    expect(log[1]!.checklist).toEqual({
      kind: "failed",
      reason: "this turn was abandoned — its lease ran out at 2026-08-23T15:07:08.831Z",
    });
    expect(log[2]!.reaction).toBe("stopped");
  });

  it("settles all three for an ANSWERED turn, with the completion reaction and a fully ticked card", async () => {
    const log: Recorded[] = [];
    const finalisation = await finaliseIndicators({
      seams: recordingSeams({ log }),
      state: {
        kind: "answered",
        readerReason: "answered from 12 pinned records",
        reason: "answered from 12 pinned records",
      },
    });

    expect(finalisation.failures).toEqual([]);
    expect(log[1]!.checklist).toEqual({ detail: "answered from 12 pinned records", kind: "done" });
    expect(log[2]!.reaction).toBe("completion");
  });

  /**
   * An early return on the first refusal would leave the card and the reaction standing over a turn that had
   * merely failed to clear its status — trading one stuck indicator for three. Every seam is attempted.
   */
  it("attempts every seam even after one refuses, so one loss never becomes three", async () => {
    const log: Recorded[] = [];
    const finalisation = await finaliseIndicators({
      seams: recordingSeams({ log, statusRefusal: "channel_not_found" }),
      state: { kind: "failed", readerReason: "the corpus is unreadable", reason: "the corpus is unreadable" },
    });

    expect(log.map((entry) => entry.seam)).toEqual(["end-status", "settle-checklist", "settle-reaction"]);
    expect(finalisation.failures).toEqual(["the thinking indicator was not cleared — channel_not_found"]);
  });

  it("reports a stuck card on its own field, not in the failure list, because it names a message to delete", async () => {
    const log: Recorded[] = [];
    const finalisation = await finaliseIndicators({
      seams: recordingSeams({ checklistFails: true, log }),
      state: { kind: "failed", readerReason: "the corpus is unreadable", reason: "the corpus is unreadable" },
    });

    expect(finalisation.checklistSettled).toBe(false);
    expect(finalisation.failures).toEqual([]);
  });

  it("reports an unsettled reaction, naming the emoji it could not leave standing", async () => {
    const log: Recorded[] = [];
    const finalisation = await finaliseIndicators({
      seams: recordingSeams({ log, reactionRefusal: "message_not_found" }),
      state: { kind: "refused", readerReason: REFUSAL_REASON, reason: REFUSAL_REASON },
    });

    expect(finalisation.failures).toEqual(["the tag's reaction was not settled to :stopped: — message_not_found"]);
  });

  /**
   * Idempotence is by construction — every step is a set-to-a-value, and the plan is a pure function of the
   * state — and it has to hold because the callers are plural: the turn's own terminal path, a crash handler
   * above it, and a sweep finding a dispatched ask whose session never came back.
   */
  it("converges on the same end state when called twice, because every step is a set-to-a-value", async () => {
    const log: Recorded[] = [];
    const seams = recordingSeams({ log });
    const state = { kind: "abandoned" as const, readerReason: "its lease ran out", reason: "its lease ran out" };

    const first = await finaliseIndicators({ seams, state });
    const second = await finaliseIndicators({ seams, state });

    expect(second).toEqual(first);
    expect(log.slice(3)).toEqual(log.slice(0, 3));
  });
});
