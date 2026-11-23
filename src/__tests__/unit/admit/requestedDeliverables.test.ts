/**
 * What an ask literally asked to be HANDED — the detection, the satisfaction check against a composed
 * answer's own bytes, and the two guidance renderers the worker and the reviewer read.
 */
import { describe, expect, it } from "vitest";

import {
  answerCarries,
  coreDeliverablePreflightLines,
  coreDeliverableReviewLines,
  missingDeliverables,
  requestedDeliverablesOf,
} from "../../../admit/requestedDeliverables.js";
import type { AnswerFormAnswer } from "../../../outbound/assistant/answerForm.js";

/** The incident ask, as asked. */
const DEPLOY_ASK =
  "can you deploy these two monitors locally, run a 7 day backtest and send me screenshots of the results";

function answer(over: Partial<AnswerFormAnswer> = {}): AnswerFormAnswer {
  return {
    body: [],
    citations: [],
    documents: [],
    grounding: {
      evidence: {
        consultedEmpty: [],
        couldNotSee: { blindSpots: [] },
        premiseChecks: [],
        read: [],
        substitutedForReal: [],
      },
      kind: "conversation",
      provenance: {
        model: "the dispatched worker in workspace:1 (Claude Code, in-turn)",
        skillsLoaded: [],
        verbsLoaded: [],
      },
      reason: "answered from the thread",
    },
    images: [],
    index: [],
    kind: "answer",
    lead: "both monitors are up",
    measurements: [],
    ...over,
  };
}

describe("requestedDeliverablesOf", () => {
  it("reads both deliverables out of the real incident ask", () => {
    expect(requestedDeliverablesOf({ question: DEPLOY_ASK }).map((deliverable) => deliverable.id)).toEqual([
      "deploy-link",
      "screenshots",
    ]);
  });

  it("is case-insensitive and matches inflections through the stem", () => {
    expect(requestedDeliverablesOf({ question: "DEPLOYED yet?" }).map((d) => d.id)).toEqual(["deploy-link"]);
    expect(requestedDeliverablesOf({ question: "grab a Screenshot" }).map((d) => d.id)).toEqual(["screenshots"]);
  });

  it("requests nothing for an ordinary question — the table is two proven rows, not a keyword sweep", () => {
    expect(requestedDeliverablesOf({ question: "why did the staging pool exhaust last night?" })).toEqual([]);
  });
});

describe("answerCarries", () => {
  it("counts a link run in the index — above the fold, where a deliverable belongs", () => {
    const carried = answerCarries({
      answer: answer({ index: [[{ label: "monitor 987840", type: "link", url: "https://example.test/m/987840" }]] }),
      evidence: "clickable-link",
    });

    expect(carried).toBe(true);
  });

  it("counts a link run nested in a body table cell", () => {
    const carried = answerCarries({
      answer: answer({
        body: [
          {
            columns: ["monitor"],
            rows: [[[{ label: "987845", type: "link", url: "https://example.test/m/987845" }]]],
            type: "table",
          },
        ],
      }),
      evidence: "clickable-link",
    });

    expect(carried).toBe(true);
  });

  it("does NOT count a citation — a `[n]` chip is provenance for a claim, not the artifact asked for", () => {
    // Counting citations would pass the exact answer this gate was built from, which is a gate that never
    // fires. Stated here so a later "surely a citation is clickable" change fails a test rather than a send.
    const carried = answerCarries({
      answer: answer({
        body: [{ runs: [{ text: "deployed both", type: "text" }], type: "paragraph" }],
        citations: [{ id: "1", label: "monitor 987840", url: "https://example.test/m/987840" }],
      }),
      evidence: "clickable-link",
    });

    expect(carried).toBe(false);
  });

  it("counts an attached image and refuses an empty images array", () => {
    expect(answerCarries({ answer: answer({ images: ["/tmp/shot.png"] }), evidence: "attached-image" })).toBe(true);
    expect(answerCarries({ answer: answer(), evidence: "attached-image" })).toBe(false);
  });
});

describe("missingDeliverables", () => {
  it("names both when the answer describes the ids in prose and hands back neither artifact", () => {
    // The measured failure, reconstructed: monitor ids and a narrative, no URL, no images.
    const missing = missingDeliverables({
      answer: answer({
        body: [{ runs: [{ text: "monitors 987840 and 987845 are deployed", type: "text" }], type: "paragraph" }],
      }),
      question: DEPLOY_ASK,
    });

    expect(missing.map((deliverable) => deliverable.id)).toEqual(["deploy-link", "screenshots"]);
  });

  it("is empty once the link and the screenshots are both there", () => {
    const missing = missingDeliverables({
      answer: answer({
        images: ["/tmp/backtest.png"],
        index: [[{ label: "monitor 987840", type: "link", url: "https://example.test/m/987840" }]],
      }),
      question: DEPLOY_ASK,
    });

    expect(missing).toEqual([]);
  });

  it("is empty for a question that asked for no artifact class, however bare the answer", () => {
    expect(missingDeliverables({ answer: answer(), question: "what did we decide about retries?" })).toEqual([]);
  });
});

describe("coreDeliverablePreflightLines", () => {
  it("leads with the order of work, and states that rigour does not move", () => {
    const lines = coreDeliverablePreflightLines({ question: "what did we decide about retries?" }).join("\n");

    expect(lines).toContain("CORE DELIVERABLE FIRST");
    expect(lines).toContain("Do NOT self-assign scope");
    expect(lines).toContain("Rigour is unchanged");
  });

  it("names the concrete artifacts, and that the door refuses an answer without them", () => {
    const lines = coreDeliverablePreflightLines({ question: DEPLOY_ASK }).join("\n");

    expect(lines).toContain("the send door REFUSES an answer that omits them");
    expect(lines).toContain("a labelled `link` run");
    expect(lines).toContain("the images themselves in `images`, as absolute paths");
  });
});

describe("coreDeliverableReviewLines", () => {
  it("is section 1 and says to check it first", () => {
    const lines = coreDeliverableReviewLines({ question: DEPLOY_ASK });

    expect(lines[0]).toBe("## 1. What the question literally asked for — CHECK THIS FIRST");
  });

  it("makes a missing artifact `broken`, outranking every fine-detail nit", () => {
    const lines = coreDeliverableReviewLines({ question: DEPLOY_ASK }).join("\n");

    expect(lines).toContain("A missing one is `broken`");
    expect(lines).toContain("outranks every fine-detail correctness nit");
  });

  it("REFUSES the other half too: unrequested scope is never grounds for another round", () => {
    const lines = coreDeliverableReviewLines({ question: "why did the staging pool exhaust?" }).join("\n");

    expect(lines).toContain("Analysis the question did NOT request is not grounds for `broken` or");
    expect(lines).toContain("no artifact class here is decidable from the question alone");
  });
});
