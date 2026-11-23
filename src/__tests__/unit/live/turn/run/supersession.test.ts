import { describe, expect, it } from "vitest";

import { TurnQueryFailure, type TurnSupersession } from "../../../../../live/turn/run.js";
import type { AnswerFormAnswer } from "../../../../../outbound/assistant/answerForm.js";
import { ANSWER, MENTION } from "./fixtures.js";
import { drive, fakeQuery, recordingPoster } from "./harness.js";

/**
 * The correction turn's own wiring: what `runTurn` hands the supersession seam, when it refuses to hand it
 * anything at all, and where a failed delete lands on the durable completion.
 *
 * The decision itself belongs to `supersession/eligibility.ts` and is tested there. What is only provable
 * HERE is the relation between the answer and the delete — and the relation is the whole safety property,
 * because every check downstream of it assumes an answer already replaced the message it is about to remove.
 */
describe("runTurn settles a declared supersession", () => {
  const TARGET = "1790054484.916599";
  const CORRECTION: AnswerFormAnswer = { ...ANSWER, supersedes: TARGET };

  /** A seam that records what it was handed and reports whatever `report` says. */
  function recordingSupersession({
    calls,
    report = { outcome: "not-declared" },
  }: {
    calls: Parameters<TurnSupersession>[0][];
    report?: Awaited<ReturnType<TurnSupersession>>;
  }): TurnSupersession {
    return async (input) => {
      calls.push(input);
      return report;
    };
  }

  it("hands it the form's own `supersedes`, the ask, the turn, and the answer that just posted", async () => {
    const calls: Parameters<TurnSupersession>[0][] = [];

    await drive({
      mention: MENTION,
      poster: recordingPoster({ log: [] }),
      query: fakeQuery({ answer: CORRECTION, phases: [] }),
      supersession: recordingSupersession({ calls }),
    });

    expect(calls).toEqual([
      {
        askIdentity: { channel: "C1", messageTs: "1712345678.000200", threadTs: "1712345678.000100" },
        declaredTs: TARGET,
        // The FORM, not just its `supersedes`. The seam digests it to bind the reviewer's warrant to the
        // bytes that actually went out, so handing over the declaration alone would leave a verdict issued
        // against an abandoned draft able to authorise this delete.
        postedAnswer: CORRECTION,
        // The poster's own posted `ts`. A seam cannot be handed a timestamp that does not exist yet, so
        // this field IS the proof that the replacement landed before the delete was ever considered.
        postedAnswerTs: "1712345678.000400",
        turnId: "turn-test",
      },
    ]);
  });

  it("hands an ADDITIVE turn no declaration, rather than skipping the seam", async () => {
    const calls: Parameters<TurnSupersession>[0][] = [];

    await drive({
      mention: MENTION,
      poster: recordingPoster({ log: [] }),
      query: fakeQuery({ phases: [] }),
      supersession: recordingSupersession({ calls }),
    });

    expect(calls.length).toBe(1);
    expect(calls[0]!.declaredTs).toBe(undefined);
  });

  /**
   * The one that matters most. A withheld turn put nothing in the thread, so deleting the answer it meant to
   * replace would leave the ask carrying NEITHER — strictly worse than the stale answer this whole mechanism
   * exists to remove.
   */
  it("never reaches the seam at all when the door WITHHELD the correction", async () => {
    const calls: Parameters<TurnSupersession>[0][] = [];

    const completion = await drive({
      mention: MENTION,
      poster: recordingPoster({ log: [], withhold: { code: "ANSWER_UNREVIEWED", reason: "nobody read it" } }),
      query: fakeQuery({ answer: CORRECTION, phases: [] }),
      supersession: recordingSupersession({ calls }),
    });

    expect(completion.primary.kind).toBe("withheld");
    expect(calls).toEqual([]);
  });

  it("never reaches the seam when the turn BROKE before it had an answer", async () => {
    const calls: Parameters<TurnSupersession>[0][] = [];

    const completion = await drive({
      mention: MENTION,
      poster: recordingPoster({ log: [] }),
      query: async () => {
        throw new TurnQueryFailure({ message: "the world model was unreachable" });
      },
      supersession: recordingSupersession({ calls }),
    });

    expect(completion.primary.kind).toBe("failed");
    expect(calls).toEqual([]);
  });

  it("reports a refused delete as a secondary diagnostic while the turn still ANSWERED", async () => {
    const completion = await drive({
      mention: MENTION,
      poster: recordingPoster({ log: [] }),
      query: fakeQuery({ answer: CORRECTION, phases: [] }),
      supersession: recordingSupersession({
        calls: [],
        report: {
          code: "NOT_WARRANTED",
          detail: "the reviewer read both and called the follow-up additive",
          outcome: "refused",
          targetTs: TARGET,
        },
      }),
    });

    expect(completion.primary.kind).toBe("answered");
    const diagnostic = completion.secondaryFailures.find((failure) => failure.kind === "supersession")!;
    expect(diagnostic.reason).toContain(TARGET);
    expect(diagnostic.reason).toContain("NOT_WARRANTED");
  });

  it("says a delete it could not confirm MAY have landed, rather than telling an operator to remove it", async () => {
    const completion = await drive({
      mention: MENTION,
      poster: recordingPoster({ log: [] }),
      query: fakeQuery({ answer: CORRECTION, phases: [] }),
      supersession: recordingSupersession({
        calls: [],
        report: { code: "DELETE_UNCONFIRMED", detail: "socket hang up", outcome: "unconfirmed", targetTs: TARGET },
      }),
    });

    const diagnostic = completion.secondaryFailures.find((failure) => failure.kind === "supersession")!;
    expect(diagnostic.reason).toContain("may or may not have come down");
    expect(diagnostic.reason).not.toContain("is still standing");
  });

  it("leaves NO diagnostic on a clean delete, so only what a reader must act on is recorded", async () => {
    const completion = await drive({
      mention: MENTION,
      poster: recordingPoster({ log: [] }),
      query: fakeQuery({ answer: CORRECTION, phases: [] }),
      supersession: recordingSupersession({
        calls: [],
        report: { outcome: "deleted", targetTs: TARGET },
      }),
    });

    expect(completion.secondaryFailures.filter((failure) => failure.kind === "supersession")).toEqual([]);
    expect(completion.primary.kind).toBe("answered");
  });

  /**
   * A delete that WORKED and a journal row that did not is the one removal worth a diagnostic, and the
   * outcome alone cannot tell it from the clean case above — which is how it went unreported: the r3 review
   * reproduced a successful delete whose result append hit ENOSPC and left no trace anywhere at all.
   */
  it("reports a removal whose journal row did not land, rather than dropping it as a clean delete", async () => {
    const completion = await drive({
      mention: MENTION,
      poster: recordingPoster({ log: [] }),
      query: fakeQuery({ answer: CORRECTION, phases: [] }),
      supersession: recordingSupersession({
        calls: [],
        report: {
          code: "JOURNAL_UNWRITABLE",
          detail: "the journal row recording this supersession could not be written: ENOSPC",
          outcome: "deleted",
          targetTs: TARGET,
        },
      }),
    });

    const diagnostic = completion.secondaryFailures.find((failure) => failure.kind === "supersession")!;
    expect(diagnostic.reason).toContain("came down, and something around the delete did not");
    expect(diagnostic.reason).toContain("JOURNAL_UNWRITABLE");
    expect(diagnostic.reason).not.toContain("is still standing");
  });
});
