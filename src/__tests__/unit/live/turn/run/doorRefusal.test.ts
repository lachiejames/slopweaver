import { describe, expect, it } from "vitest";

import { DoorRefusedError, type TurnPoster, TurnRefusedError } from "../../../../../live/turn/run.js";
import { answered, failureReason, MENTION, statusFailures } from "./fixtures.js";
import { drive, failureDetail, fakeQuery, type Recorded, recordingPoster } from "./harness.js";

/**
 * The measured case this whole seam exists for.
 *
 * Tag `D0SYN000001`/`1787485240.339229`: the admit door refused `verb:turn.answer` with
 * `ANSWER_UNREVIEWED` — a real refusal, a working gate — and `DoorRefusedError` escaped `runTurn` entirely.
 * The thinking indicator stayed set (and its re-assert timer kept re-raising it), the card sat half-ticked,
 * `:eyes:` stood on the tag, and no completion was folded — so no terminal lifecycle event was appended and
 * `turn dispatch --sweep` still counted the ask as "1 still working" 33 minutes later.
 *
 * Every assertion below is one of those five indicators.
 */
describe("runTurn when the admit door REFUSES the answer", () => {
  const REFUSAL =
    "the admit door refused to post the turn's answer — ANSWER_UNREVIEWED: no review verdict accompanies " +
    "this answer, so nothing but its author has read it";

  /** The poster, refusing the send exactly as the live door does — by throwing, not by withholding. */
  function refusingPoster({ log }: { log: Recorded[] }): TurnPoster {
    return recordingPoster({ log, postAnswerThrows: new DoorRefusedError(REFUSAL) });
  }

  it("resolves with a durable completion rather than throwing, so a terminal event is recorded at all", async () => {
    const log: Recorded[] = [];
    const outcome = await drive({
      mention: MENTION,
      poster: refusingPoster({ log }),
      query: fakeQuery({ phases: ["loaded", "ranked"] }),
    });

    expect(answered(outcome)).toBe(false);
    expect(failureReason(outcome)).toBe(REFUSAL);
  });

  it("clears the thinking indicator, which is also what stops its re-assert timer", async () => {
    const log: Recorded[] = [];
    await drive({
      mention: MENTION,
      poster: refusingPoster({ log }),
      query: fakeQuery({ phases: ["loaded", "ranked"] }),
    });

    expect(log.filter((entry) => entry.kind === "end-status")).toHaveLength(1);
  });

  it("marks the card failed, carrying the door's own words, instead of leaving it half-ticked", async () => {
    const log: Recorded[] = [];
    await drive({
      mention: MENTION,
      poster: refusingPoster({ log }),
      query: fakeQuery({ phases: ["loaded", "ranked"] }),
    });

    const finalized = log.findLast((entry) => entry.kind === "finalize")!;
    expect(finalized.states).toEqual(["done", "failed"]);
  });

  it("settles the tag's reaction to the STOPPED one, so :eyes: never stands over a refused turn", async () => {
    const log: Recorded[] = [];
    await drive({
      mention: MENTION,
      poster: refusingPoster({ log }),
      query: fakeQuery({ phases: ["loaded", "ranked"] }),
    });

    expect(log.findLast((entry) => entry.kind === "settle-reaction")!.reaction).toBe("stopped");
  });

  it("posts a card that says why nothing was sent, rather than leaving the thread silent", async () => {
    const log: Recorded[] = [];
    await drive({
      mention: MENTION,
      poster: refusingPoster({ log }),
      query: fakeQuery({ phases: ["loaded", "ranked"] }),
    });

    expect(log.filter((entry) => entry.kind === "post-notice")).toHaveLength(1);
  });

  it("settles every indicator even when the failure card itself cannot be posted", async () => {
    const log: Recorded[] = [];
    const poster: TurnPoster = {
      ...refusingPoster({ log }),
      postNotice: async () => {
        throw new Error("the door refused the notice too");
      },
    };

    const outcome = await drive({ mention: MENTION, poster, query: fakeQuery({ phases: ["loaded", "ranked"] }) });

    expect(log.map((entry) => entry.kind)).toContain("end-status");
    expect(log.findLast((entry) => entry.kind === "settle-reaction")!.reaction).toBe("stopped");
    expect(statusFailures(outcome)).toContain("the failure card was not posted — the door refused the notice too");
  });

  /**
   * A DIFFERENT ending from a refusal, and the card has to say so. A refusal is a working gate declining to
   * send; a break is the turn falling over. Telling a reader "this turn failed" when the door simply said no
   * sends them hunting a bug that is not there.
   */
  it("tells a genuine break apart from a refusal on the card, because they call for different next moves", async () => {
    const refusedLog: Recorded[] = [];
    const brokenLog: Recorded[] = [];
    await drive({
      mention: MENTION,
      poster: refusingPoster({ log: refusedLog }),
      query: fakeQuery({ phases: ["loaded"] }),
    });
    await drive({
      mention: MENTION,
      poster: recordingPoster({ log: brokenLog, postAnswerThrows: new Error("socket closed") }),
      query: fakeQuery({ phases: ["loaded"] }),
    });

    expect(failureDetail({ log: refusedLog })).toContain("refused by the admit door, nothing sent");
    expect(failureDetail({ log: brokenLog })).toContain("this turn failed — socket closed");
  });

  it("tells the thread the quality bar held, and tags the owner, rather than reading as a malfunction", async () => {
    const log: Recorded[] = [];
    await drive({
      mention: MENTION,
      poster: refusingPoster({ log }),
      query: fakeQuery({ phases: ["loaded"] }),
    });

    const card = log.findLast((entry) => entry.kind === "post-notice")!.card!.artifact;
    expect(card.tldr).toBe(
      'I had an answer to "what did we decide about the renderer?" but it did not clear the bar to post.',
    );
    expect(card.index[1]).toEqual([
      { person: "owner", type: "mention" },
      { text: " is tagged in to sort out what was missing and get you the answer.", type: "text" },
    ]);
  });

  /**
   * The reason the door refusal is its own error CLASS rather than any `TurnRefusedError`.
   *
   * `poster.ts` also raises the base class for this repo refusing its OWN work — an answer form that fails
   * its own schema, a poster handed an ask it was not built for. Neither is a gate decision, and putting
   * "the bar was not met" over one would be a confident lie about a bug in this codebase.
   */
  it("does NOT claim a bar was applied when the turn refused its own malformed work", async () => {
    const log: Recorded[] = [];
    await drive({
      mention: MENTION,
      poster: recordingPoster({
        log,
        postAnswerThrows: new TurnRefusedError("the turn built a message its own schema refuses — tldr: too long"),
      }),
      query: fakeQuery({ phases: ["loaded"] }),
    });

    const card = log.findLast((entry) => entry.kind === "post-notice")!.card!.artifact;
    expect(card.tldr).toBe(
      'Something broke while I was answering "what did we decide about the renderer?". Nothing was posted.',
    );
    expect(failureDetail({ log })).toContain("this turn failed — the turn built a message its own schema refuses");
  });
});
