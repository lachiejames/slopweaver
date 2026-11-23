/** The gate that refuses to send an answer missing the artifact its question asked for. */
import { describe, expect, it } from "vitest";

import { coreDeliverableFindings, coreDeliverableGate } from "../../../admit/coreDeliverableGate.js";
import { admitDoor } from "../../../admit/door.js";
import type { DoorRequest } from "../../../admit/types.js";
import type { AnswerFormAnswer } from "../../../outbound/assistant/answerForm.js";

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

function codes({ findings }: { findings: readonly { readonly code: string }[] }): readonly string[] {
  return findings.map((finding) => finding.code);
}

const REQUEST: DoorRequest = {
  action: { kind: "verb", noun: "slack", verb: "post" },
  artifact: {},
  meta: { createsWorkItem: false, effect: "external-write", home: null, requiresApproval: false },
};

describe("coreDeliverableFindings", () => {
  it("REFUSES the measured failure: monitor ids in prose, no link, no screenshots", () => {
    const findings = coreDeliverableFindings({
      answer: answer({
        body: [{ runs: [{ text: "monitors 987840 and 987845 are deployed", type: "text" }], type: "paragraph" }],
      }),
      question: DEPLOY_ASK,
    });

    expect(codes({ findings })).toEqual([
      "ANSWER_MISSING_DELIVERABLE_DEPLOY_LINK",
      "ANSWER_MISSING_DELIVERABLE_SCREENSHOTS",
    ]);
  });

  it("reports BOTH at once, so one refusal fixes the answer rather than two rounds", () => {
    const findings = coreDeliverableFindings({ answer: answer(), question: DEPLOY_ASK });

    expect(findings).toHaveLength(2);
  });

  it("passes once the link and the screenshots are both handed back", () => {
    const findings = coreDeliverableFindings({
      answer: answer({
        images: ["/tmp/backtest.png"],
        index: [[{ label: "monitor 987840", type: "link", url: "https://example.test/m/987840" }]],
      }),
      question: DEPLOY_ASK,
    });

    expect(findings).toEqual([]);
  });

  it("has nothing to say about a question that asked for no artifact class", () => {
    expect(coreDeliverableFindings({ answer: answer(), question: "why did the pool exhaust?" })).toEqual([]);
  });

  it("makes every refusal self-correctable — a warn with an override and the correction spelled out", () => {
    const findings = coreDeliverableFindings({ answer: answer(), question: DEPLOY_ASK });

    expect(findings.every((finding) => finding.severity === "warn")).toBe(true);
    expect(findings[0]!.correction).toContain("`link` run");
  });
});

describe("coreDeliverableGate", () => {
  it("composes into the real door, and a deploy answer with no link comes back WARN", () => {
    const decision = admitDoor({
      env: {},
      gates: [coreDeliverableGate({ answer: answer({ images: ["/tmp/shot.png"] }), question: DEPLOY_ASK })],
      request: REQUEST,
    });

    expect(decision.status).toBe("warn");
    expect(codes({ findings: decision.findings })).toEqual(["ANSWER_MISSING_DELIVERABLE_DEPLOY_LINK"]);
  });

  it("is waivable by its own override token, and the door RECORDS the waiver", () => {
    const decision = admitDoor({
      env: { SLOPWEAVER_DOOR_OVERRIDE: "answer.deliverable:v1" },
      gates: [coreDeliverableGate({ answer: answer({ images: ["/tmp/shot.png"] }), question: DEPLOY_ASK })],
      request: REQUEST,
    });

    expect(decision.status).toBe("pass");
    expect(codes({ findings: decision.overridden })).toEqual(["ANSWER_MISSING_DELIVERABLE_DEPLOY_LINK"]);
  });
});
