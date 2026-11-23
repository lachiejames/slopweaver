import { describe, expect, it } from "vitest";

import { answerDigestOf } from "../../../../../live/turn/answerDigest.js";
import type { AnswerFormAnswer } from "../../../../../outbound/assistant/answerForm.js";
import { ANSWER, MENTION } from "./fixtures.js";
import { drive, fakeQuery, type Recorded, recordingPoster } from "./harness.js";

/*
 * A FIRST answer — a form declaring `followThrough` — posts and leaves the turn running: the plan
 * that a worker posted before opening its pull requests. Each case pairs it with the same answer undeclared.
 */
describe("runTurn delivering a FIRST answer", () => {
  const PLAN: AnswerFormAnswer = {
    ...ANSWER,
    followThrough: { owes: "pull-requests", what: "open the two pull requests the plan names" },
  };
  const ENDING_KINDS = new Set(["delete-working", "finalize", "settle-reaction", "reap", "post-notice"]);

  it("folds a first-answered completion carrying the posted digest and what is still owed", async () => {
    const completion = await drive({
      mention: MENTION,
      poster: recordingPoster({ log: [] }),
      query: fakeQuery({ answer: PLAN, phases: ["loaded"] }),
    });

    expect(completion.primary).toEqual({
      answerDigest: answerDigestOf({ answer: PLAN }),
      answerTs: "1712345678.000400",
      followThrough: { owes: "pull-requests", what: "open the two pull requests the plan names" },
      kind: "first-answered",
    });
  });

  it("ends the thinking status and notes the plan under the running step, settling nothing that claims an end", async () => {
    const log: Recorded[] = [];
    await drive({
      mention: MENTION,
      poster: recordingPoster({ log }),
      query: fakeQuery({ answer: PLAN, phases: ["loaded"] }),
    });
    const afterPost = log.slice(log.findIndex((entry) => entry.kind === "post-answer") + 1);

    expect(afterPost.map((entry) => entry.kind)).toEqual(["stop-status-reasserting", "end-status", "advance"]);
    // The query ticked every step done before the post; the plan re-opens the last one rather than leaving a
    // card that reads finished over a worker still building.
    expect(afterPost[2]!.states).toEqual(["done", "running"]);
    expect(afterPost[2]!.details!.at(-1)).toBe("first answer posted, now: open the two pull requests the plan names");
    expect(log.filter((entry) => ENDING_KINDS.has(entry.kind))).toEqual([]);
  });

  it("is the pair: the same answer without followThrough replaces the working message and settles the turn", async () => {
    const log: Recorded[] = [];
    const completion = await drive({
      mention: MENTION,
      poster: recordingPoster({ log }),
      query: fakeQuery({ phases: ["loaded"] }),
    });

    expect(completion.primary.kind).toBe("answered");
    expect(log.some((entry) => entry.kind === "delete-working")).toBe(true);
    expect(log.some((entry) => entry.kind === "settle-reaction")).toBe(true);
  });
});
