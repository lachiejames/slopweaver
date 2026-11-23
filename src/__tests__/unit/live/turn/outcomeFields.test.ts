import { describe, expect, it } from "vitest";

import type { AskIdentity } from "../../../../live/ask/identity.js";
import type { TurnHandlerOutcome } from "../../../../live/turn/envelope.js";
import {
  checklistOutcomeFields,
  reapOutcomeFields,
  statusOutcomeFields,
  supersessionOutcomeFields,
} from "../../../../live/turn/outcomeFields.js";
import type { PostedRef, TurnPoster, TurnSupersession } from "../../../../live/turn/runContract.js";
import type { SupersessionReport } from "../../../../live/turn/supersession/run.js";
import type { AnswerFormAnswer } from "../../../../outbound/assistant/answerForm.js";

const CHANNEL = "C_THREAD";
const WORKING = "1790050000.000100";
const ANSWER = "1790050000.000900";

const ASK: AskIdentity = { channel: CHANNEL, messageTs: "1790049000.000001", threadTs: "1790049000.000001" };

const POSTED_ANSWER: AnswerFormAnswer = {
  body: [{ runs: [{ text: "the corrected claim", type: "text" }], type: "paragraph" }],
  citations: [],
  documents: [],
  grounding: {
    capability: { command: ["fleet", "status"], id: "fleet-status", what: "the affected versions" },
    evidence: {
      consultedEmpty: [],
      couldNotSee: { blindSpots: [], reason: "nothing else was needed" },
      premiseChecks: [],
      read: [],
      substitutedForReal: [],
    },
    kind: "verb",
    provenance: { model: "claude-opus-5", skillsLoaded: ["loop-bot"], verbsLoaded: [] },
    result: "scripted",
  },
  images: [],
  index: [],
  kind: "answer",
  lead: "Correcting the claim.",
  measurements: [],
};

const ANSWERED: TurnHandlerOutcome = { answerTs: ANSWER, answered: true, workingTs: WORKING };

const EARLIER: readonly PostedRef[] = [
  { channel: CHANNEL, ts: "1790040000.000001" },
  { channel: CHANNEL, ts: "1790040000.000002" },
  { channel: CHANNEL, ts: "1790040000.000003" },
];

/** A reap seam that records every card it was handed and refuses the ones named in `refuse`. */
function recordingPoster({ refuse }: { refuse: ReadonlySet<string> }): {
  readonly calls: PostedRef[];
  readonly poster: Pick<TurnPoster, "reapEarlierCard">;
} {
  const calls: PostedRef[] = [];
  const reapEarlierCard: TurnPoster["reapEarlierCard"] = async ({ posted }) => {
    calls.push(posted);
    return !refuse.has(posted.ts);
  };
  return { calls, poster: { reapEarlierCard } };
}

/** A supersession seam that records every input and answers one fixed report. */
function recordingSettle({ report }: { report: SupersessionReport }): {
  readonly calls: Parameters<TurnSupersession>[0][];
  readonly settle: TurnSupersession;
} {
  const calls: Parameters<TurnSupersession>[0][] = [];
  const settle: TurnSupersession = async (input) => {
    calls.push(input);
    return report;
  };
  return { calls, settle };
}

describe("checklistOutcomeFields", () => {
  it("reports nothing when the checklist resolved", () => {
    expect(checklistOutcomeFields({ posted: { channel: CHANNEL, ts: WORKING }, resolved: true })).toEqual({});
  });

  it("names the stuck checklist's channel and timestamp when it did not", () => {
    expect(checklistOutcomeFields({ posted: { channel: CHANNEL, ts: WORKING }, resolved: false })).toEqual({
      checklistFailure:
        "the working checklist in C_THREAD (ts 1790050000.000100) could not be resolved — it may still show unfinished steps above the posted answer; delete it by hand",
    });
  });
});

describe("statusOutcomeFields", () => {
  it("reports nothing when no indicator failed", () => {
    expect(statusOutcomeFields({ failures: [] })).toEqual({});
  });

  it("carries every failure in order", () => {
    expect(statusOutcomeFields({ failures: ["set refused: ratelimited", "clear refused: not_in_channel"] })).toEqual({
      statusFailure: ["set refused: ratelimited", "clear refused: not_in_channel"],
    });
  });
});

describe("reapOutcomeFields", () => {
  it("reaps nothing and reports nothing when no answer posted, for every card", async () => {
    const unanswered = recordingPoster({ refuse: new Set() });
    const noTs = recordingPoster({ refuse: new Set() });

    expect(
      await reapOutcomeFields({
        cards: EARLIER,
        outcome: { answerTs: ANSWER, answered: false },
        poster: unanswered.poster,
        workingTs: WORKING,
      }),
    ).toEqual({});
    expect(
      await reapOutcomeFields({ cards: EARLIER, outcome: { answered: true }, poster: noTs.poster, workingTs: WORKING }),
    ).toEqual({});
    expect(unanswered.calls).toEqual([]);
    expect(noTs.calls).toEqual([]);
  });

  it("reaps every earlier card once an answer posted and reports nothing when all went", async () => {
    const recorded = recordingPoster({ refuse: new Set() });

    expect(
      await reapOutcomeFields({ cards: EARLIER, outcome: ANSWERED, poster: recorded.poster, workingTs: WORKING }),
    ).toEqual({});
    expect(recorded.calls).toEqual(EARLIER);
  });

  it("names each card that would not delete, and never hands its own working message or answer to the seam", async () => {
    const recorded = recordingPoster({ refuse: new Set(["1790040000.000002"]) });

    const fields = await reapOutcomeFields({
      cards: [...EARLIER, { channel: CHANNEL, ts: WORKING }, { channel: CHANNEL, ts: ANSWER }],
      outcome: ANSWERED,
      poster: recorded.poster,
      workingTs: WORKING,
    });

    expect(fields).toEqual({
      reapFailure: [
        "an earlier card on this ask in C_THREAD (ts 1790040000.000002) could not be deleted after the answer posted — it still stands above the answer; delete it by hand",
      ],
    });
    expect(recorded.calls).toEqual(EARLIER);
  });
});

describe("supersessionOutcomeFields", () => {
  const removed: SupersessionReport = { outcome: "deleted", targetTs: "1790040000.000001" };

  it("never settles when the turn did not answer, had no answer timestamp, or composed no answer", async () => {
    const recorded = recordingSettle({ report: removed });
    const base = { askIdentity: ASK, declaredTs: "1790040000.000001", settle: recorded.settle, turnId: "turn-1" };

    expect(
      await supersessionOutcomeFields({
        ...base,
        outcome: { answerTs: ANSWER, answered: false },
        postedAnswer: POSTED_ANSWER,
      }),
    ).toEqual({});
    expect(
      await supersessionOutcomeFields({ ...base, outcome: { answered: true }, postedAnswer: POSTED_ANSWER }),
    ).toEqual({});
    expect(await supersessionOutcomeFields({ ...base, outcome: ANSWERED, postedAnswer: undefined })).toEqual({});
    expect(recorded.calls).toEqual([]);
  });

  it("hands the seam the posted answer and its timestamp, and reports nothing on a clean delete", async () => {
    const recorded = recordingSettle({ report: removed });

    expect(
      await supersessionOutcomeFields({
        askIdentity: ASK,
        declaredTs: "1790040000.000001",
        outcome: ANSWERED,
        postedAnswer: POSTED_ANSWER,
        settle: recorded.settle,
        turnId: "turn-1",
      }),
    ).toEqual({});
    expect(recorded.calls).toEqual([
      {
        askIdentity: ASK,
        declaredTs: "1790040000.000001",
        postedAnswer: POSTED_ANSWER,
        postedAnswerTs: ANSWER,
        turnId: "turn-1",
      },
    ]);
  });

  /** Settle one report through an answered turn and return the fragment. */
  async function fieldsFor({ report }: { report: SupersessionReport }): Promise<{
    readonly supersessionFailure?: string;
  }> {
    return supersessionOutcomeFields({
      askIdentity: ASK,
      declaredTs: report.targetTs,
      outcome: ANSWERED,
      postedAnswer: POSTED_ANSWER,
      settle: recordingSettle({ report }).settle,
      turnId: "turn-1",
    });
  }

  it("reports nothing on an additive turn and on an already-gone target with no code", async () => {
    expect(await fieldsFor({ report: { outcome: "not-declared" } })).toEqual({});
    expect(await fieldsFor({ report: { outcome: "already-gone", targetTs: "1790040000.000001" } })).toEqual({});
  });

  it("says a deleted target came down when a code rides on the removal", async () => {
    expect(
      await fieldsFor({
        report: {
          code: "JOURNAL_APPEND_FAILED",
          detail: "the settled row did not land",
          outcome: "deleted",
          targetTs: "1790040000.000001",
        },
      }),
    ).toEqual({
      supersessionFailure:
        "the answer this turn superseded in C_THREAD (ts 1790040000.000001) came down, and something around the delete did not — JOURNAL_APPEND_FAILED: the settled row did not land",
    });
  });

  it("says an already-gone target came down when a code rides on the removal", async () => {
    expect(
      await fieldsFor({
        report: { code: "JOURNAL_APPEND_FAILED", detail: "no row", outcome: "already-gone", targetTs: "17.1" },
      }),
    ).toEqual({
      supersessionFailure:
        "the answer this turn superseded in C_THREAD (ts 17.1) came down, and something around the delete did not — JOURNAL_APPEND_FAILED: no row",
    });
  });

  it("says an unconfirmed delete may or may not have come down", async () => {
    expect(
      await fieldsFor({
        report: {
          code: "DELETE_UNCONFIRMED",
          detail: "the call timed out",
          outcome: "unconfirmed",
          targetTs: "1790040000.000001",
        },
      }),
    ).toEqual({
      supersessionFailure:
        "the answer this turn superseded in C_THREAD (ts 1790040000.000001) may or may not have come down — the delete was sent and never confirmed (DELETE_UNCONFIRMED: the call timed out); check the thread before deleting it by hand",
    });
  });

  it("says a refused target is still standing", async () => {
    expect(
      await fieldsFor({
        report: { code: "NOT_OURS", detail: "a human posted that", outcome: "refused", targetTs: "1790040000.000001" },
      }),
    ).toEqual({
      supersessionFailure:
        "the answer this turn superseded in C_THREAD (ts 1790040000.000001) is still standing — NOT_OURS: a human posted that",
    });
  });

  it("names each missing report field in place when a refusal carries none of them", async () => {
    expect(await fieldsFor({ report: { outcome: "refused" } })).toEqual({
      supersessionFailure:
        "the answer this turn superseded in C_THREAD (ts (no timestamp on the report)) is still standing — (no code on the report): (no detail on the report)",
    });
  });
});
