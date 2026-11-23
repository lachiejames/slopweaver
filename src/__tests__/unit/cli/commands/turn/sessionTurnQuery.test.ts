/**
 * `sessionTurnQuery` — the query seam `turn answer` runs: the answer the session already composed, returned as
 * is, with the ONE phase line naming how it was grounded. No world model is loaded; the seam reads nothing.
 */
import { describe, expect, it } from "vitest";

import { sessionTurnQuery } from "../../../../../cli/commands/turn/postAnswer.js";
import type { AnswerFormAnswer } from "../../../../../outbound/assistant/answerForm.js";

const ANSWER: AnswerFormAnswer = {
  body: [],
  citations: [],
  documents: [],
  grounding: {
    evidence: {
      consultedEmpty: [],
      couldNotSee: { blindSpots: [], reason: "nothing else to check" },
      premiseChecks: [],
      read: [],
      substitutedForReal: [],
    },
    kind: "conversation",
    provenance: { model: "claude-opus-5", skillsLoaded: [], verbsLoaded: [] },
    reason: "context and judgement alone answer this",
  },
  images: [],
  index: [],
  kind: "answer",
  lead: "You have 3 open PRs.",
  measurements: [],
};

describe("sessionTurnQuery", () => {
  it("returns the composed answer and reports exactly one phase naming its grounding", async () => {
    const phases: string[] = [];
    const outcome = await sessionTurnQuery({ answer: ANSWER })({
      onPhase: async ({ detail }) => {
        phases.push(detail);
      },
      question: "how many open PRs do I have",
    });
    const detail = "answered from context and judgement — context and judgement alone answer this";
    expect(phases).toEqual([detail]);
    expect(outcome).toEqual({ answer: ANSWER, completionDetail: detail });
  });
});
