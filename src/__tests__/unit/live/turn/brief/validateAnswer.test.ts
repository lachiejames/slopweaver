/**
 * `validateAnswerForDispatch` — the answer's grounding checked against the brief and the routing decision
 * before dispatch: conversation, verb and unreachable groundings, and a proposal's present-state premise.
 */
import { describe, expect, it } from "vitest";

import { unwrapErr } from "../../../../../lib/result.js";
import { answerableProjectionOf, validateAnswerForDispatch } from "../../../../../live/turn/briefAnswerable.js";
import type { RoutingDecision } from "../../../../../live/turn/judgement.js";
import type { AnswerFormAnswer } from "../../../../../outbound/assistant/answerForm.js";
import { brief } from "./harness.js";

describe("validateAnswerForDispatch", () => {
  const answerableBrief = answerableProjectionOf({ brief: brief({ question: "what did we decide?" }) });
  const respondDecision: Extract<RoutingDecision, { response: "respond" }> = {
    confidence: "high",
    needs: [{ capabilityId: "github-vulnerability-report", reason: "list open vulns", requirement: "required" }],
    rationale: "a live verb answers this",
    response: "respond",
    truthMode: "current",
    schemaVersion: 1,
    tier: "inline",
  };

  const answerOf = (grounding: AnswerFormAnswer["grounding"]): AnswerFormAnswer =>
    ({ body: [], citations: [], grounding, images: [] }) as unknown as AnswerFormAnswer;

  const conversationAnswer = answerOf({
    evidence: {
      consultedEmpty: [],
      couldNotSee: { blindSpots: [], reason: "nothing else was needed" },
      premiseChecks: [],
      read: [],
      substitutedForReal: [],
    },
    kind: "conversation",
    provenance: { model: "m", skillsLoaded: [], verbsLoaded: [] },
    reason: "context alone answers this",
  });

  it("accepts a conversation grounding when the decision named no REQUIRED need", () => {
    const decision: Extract<RoutingDecision, { response: "respond" }> = {
      ...respondDecision,
      needs: [{ capabilityId: "github-vulnerability-report", reason: "nice to have", requirement: "optional" }],
    };
    expect(validateAnswerForDispatch({ answer: conversationAnswer, brief: answerableBrief, decision }).isOk()).toBe(
      true,
    );
  });

  it("refuses a conversation grounding when the decision named a REQUIRED live need — the exact contradiction this closes", () => {
    const error = unwrapErr(
      validateAnswerForDispatch({ answer: conversationAnswer, brief: answerableBrief, decision: respondDecision }),
    );
    expect(error.code).toBe("CONVERSATION_GROUNDING_INSUFFICIENT");
    expect(error.message).toContain("github-vulnerability-report");
  });

  it("accepts a verb grounding whose capability the decision actually named", () => {
    const answer = answerOf({
      capability: {
        command: ["private-cli", "github", "vulnerability-report"],
        id: "github-vulnerability-report",
        what: "open vulns",
      },
      evidence: {
        consultedEmpty: [],
        couldNotSee: { blindSpots: [], reason: "nothing else was needed" },
        premiseChecks: [],
        read: [],
        substitutedForReal: [],
      },
      kind: "verb",
      provenance: { model: "m", skillsLoaded: [], verbsLoaded: [] },
      result: "3 open vulnerabilities",
    });
    expect(validateAnswerForDispatch({ answer, brief: answerableBrief, decision: respondDecision }).isOk()).toBe(true);
  });

  it("refuses a verb grounding the decision never named", () => {
    const answer = answerOf({
      capability: { command: ["private-cli", "unrelated"], id: "unrelated-verb", what: "something else" },
      evidence: {
        consultedEmpty: [],
        couldNotSee: { blindSpots: [], reason: "nothing else was needed" },
        premiseChecks: [],
        read: [],
        substitutedForReal: [],
      },
      kind: "verb",
      provenance: { model: "m", skillsLoaded: [], verbsLoaded: [] },
      result: "n/a",
    });
    const error = unwrapErr(validateAnswerForDispatch({ answer, brief: answerableBrief, decision: respondDecision }));
    expect(error.code).toBe("VERB_GROUNDING_UNREQUESTED");
    expect(error.message).toContain("unrelated-verb");
  });

  it("refuses a thread-read grounding — the message names the allowed ids and says reading the thread is not grounding", () => {
    const answer = answerOf({
      capability: { command: ["private-cli", "slack", "read-thread"], id: "slack-read-thread", what: "the thread" },
      evidence: {
        consultedEmpty: [],
        couldNotSee: { blindSpots: [], reason: "nothing else was needed" },
        premiseChecks: [],
        read: [],
        substitutedForReal: [],
      },
      kind: "verb",
      provenance: { model: "m", skillsLoaded: [], verbsLoaded: [] },
      result: "read the thread",
    });
    const error = unwrapErr(validateAnswerForDispatch({ answer, brief: answerableBrief, decision: respondDecision }));
    expect(error.code).toBe("VERB_GROUNDING_UNREQUESTED");
    expect(error.message).toContain("slack-read-thread");
    expect(error.message).toContain("github-vulnerability-report");
    expect(error.message).toContain("investigation, never grounding");
  });

  it("accepts an unreachable grounding the brief itself already named unavailable", () => {
    const answer = answerOf({
      evidence: {
        consultedEmpty: [],
        couldNotSee: { blindSpots: ["could not see it"] },
        premiseChecks: [],
        read: [],
        substitutedForReal: [],
      },
      kind: "unreachable",
      provenance: { model: "m", skillsLoaded: [], verbsLoaded: [] },
      surface: { id: "production-logs", what: "production log records" },
      why: "no connector reaches it",
    });
    expect(validateAnswerForDispatch({ answer, brief: answerableBrief, decision: respondDecision }).isOk()).toBe(true);
  });

  it("refuses a PROPOSAL-shaped ask whose answer records no present-state check of its own premise", () => {
    // The measured answer was internally consistent — its grounding named a capability the decision
    // asked for, its evidence was real — and wrong from its first bullet, because the thing it was costing
    // already existed. Consistency was the property already satisfied when it failed, so this check runs
    // ahead of the other three and refuses whichever way the answer is grounded.
    const proposalBrief = answerableProjectionOf({
      brief: brief({ question: "what does standing this up cost the platform team" }),
    });
    const answer = answerOf({
      capability: {
        command: ["private-cli", "github", "vulnerability-report"],
        id: "github-vulnerability-report",
        what: "open vulns",
      },
      evidence: {
        consultedEmpty: [],
        couldNotSee: { blindSpots: [], reason: "nothing else was needed" },
        premiseChecks: [],
        read: [{ label: "the working checkout" }],
        substitutedForReal: [],
      },
      kind: "verb",
      provenance: { model: "m", skillsLoaded: [], verbsLoaded: [] },
      result: "costed it",
    });
    const error = unwrapErr(validateAnswerForDispatch({ answer, brief: proposalBrief, decision: respondDecision }));
    expect(error.code).toBe("PROPOSAL_PREMISE_UNCHECKED");
    expect(error.message).toContain("what does standing this up cost");
  });

  it("refuses a conversation-grounded proposal answer too — citing no present-state read at all is the worst case", () => {
    const proposalBrief = answerableProjectionOf({
      brief: brief({ question: "should we stand up a second review queue" }),
    });
    const error = unwrapErr(
      validateAnswerForDispatch({
        answer: conversationAnswer,
        brief: proposalBrief,
        decision: { ...respondDecision, needs: [] },
      }),
    );
    expect(error.code).toBe("PROPOSAL_PREMISE_UNCHECKED");
  });

  it("accepts a proposal answer that recorded what it looked for, what it found and when", () => {
    const proposalBrief = answerableProjectionOf({
      brief: brief({ question: "what does standing this up cost the platform team" }),
    });
    const answer = answerOf({
      capability: {
        command: ["private-cli", "github", "vulnerability-report"],
        id: "github-vulnerability-report",
        what: "open vulns",
      },
      evidence: {
        consultedEmpty: [],
        couldNotSee: { blindSpots: [], reason: "nothing else was needed" },
        premiseChecks: [
          {
            checkedAtIso: "2026-08-29T13:58:54.016Z",
            finding: "exists",
            how: "searched the org for the repository",
            subject: "the repository being proposed",
          },
        ],
        read: [{ label: "the working checkout" }],
        substitutedForReal: [],
      },
      kind: "verb",
      provenance: { model: "m", skillsLoaded: [], verbsLoaded: [] },
      result: "it is already there",
    });
    expect(validateAnswerForDispatch({ answer, brief: proposalBrief, decision: respondDecision }).isOk()).toBe(true);
  });

  it("leaves a NON-proposal ask alone — an empty premiseChecks is the ordinary shape", () => {
    expect(
      validateAnswerForDispatch({
        answer: conversationAnswer,
        brief: answerableBrief,
        decision: { ...respondDecision, needs: [] },
      }).isOk(),
    ).toBe(true);
  });

  it("refuses an unreachable grounding naming a surface neither the brief nor the decision ever named", () => {
    const answer = answerOf({
      evidence: {
        consultedEmpty: [],
        couldNotSee: { blindSpots: ["could not see it"] },
        premiseChecks: [],
        read: [],
        substitutedForReal: [],
      },
      kind: "unreachable",
      provenance: { model: "m", skillsLoaded: [], verbsLoaded: [] },
      surface: { id: "never-named-surface", what: "something else entirely" },
      why: "n/a",
    });
    const error = unwrapErr(validateAnswerForDispatch({ answer, brief: answerableBrief, decision: respondDecision }));
    expect(error.code).toBe("UNREACHABLE_GROUNDING_UNSUBSTANTIATED");
    expect(error.message).toContain("never-named-surface");
  });
});
