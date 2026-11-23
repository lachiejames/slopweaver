/**
 * The `queue-screen-reading` step's judgement of one ask: a Queue that redrew under the ask is said, never judged, and
 * otherwise the answer must be the Queue the reads saw.
 */
import { describe, expect, it } from "vitest";

import { queueScreenJudged } from "../../../../../cli/commands/desktop/e2eQueueScreen.js";

const SERVED = {
  kind: "served",
  snapshot: JSON.stringify({
    cards: { rows: [{ key: "ABC-1" }, { key: "ABC-2" }] },
    drawnKeys: ["ABC-1"],
    path: "/queue",
  }),
};

describe("queueScreenJudged", () => {
  it("passes an answer that is the Queue both reads saw", () => {
    expect(queueScreenJudged({ after: ["ABC-1"], answer: SERVED, before: ["ABC-1"] })).toBe(undefined);
  });

  it("says the Queue moved, and judges nothing, when the reads disagree", () => {
    expect(queueScreenJudged({ after: ["ABC-1", "ABC-2"], answer: SERVED, before: ["ABC-1"] })!.code).toBe(
      "QUEUE_SCREEN_MOVED",
    );
  });

  it("names every break of an answer that is not the Queue on screen", () => {
    const block = queueScreenJudged({ after: ["ABC-2"], answer: SERVED, before: ["ABC-2"] });
    expect(block).toEqual({
      breaks: ["the snapshot says the Queue drew [ABC-1] where its rows carry [ABC-2]"],
      code: "QUEUE_SCREEN_NOT_HIS",
      message:
        "the voice's window was not handed the Queue on screen: " +
        "the snapshot says the Queue drew [ABC-1] where its rows carry [ABC-2]",
    });
  });
});
