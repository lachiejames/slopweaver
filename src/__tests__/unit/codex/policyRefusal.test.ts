import { describe, expect, it } from "vitest";
import { detectPolicyRefusal, transportFaultRefusal } from "../../../codex/policyRefusal.js";

/** OpenAI's own words, verbatim from a refused pass's rollout `task_complete.error.message`. */
const CYBER_POLICY =
  "This content was flagged for possible cybersecurity risk. If this seems wrong, try rephrasing your request. " +
  "To get authorized for security work, join the Trusted Access for Cyber program: https://chatgpt.com/cyber";

/** Codex's spend-cap sentence — a failure that is NOT a policy refusal and must never read as one. */
const SPEND_CAP =
  "You hit your spend cap set by the owner of your workspace. Ask an owner to increase your spend cap to continue.";

describe("detectPolicyRefusal", () => {
  it("classifies the captured cyber-policy sentence", () => {
    expect(detectPolicyRefusal({ text: CYBER_POLICY })).toBe("cyber-policy");
  });

  it("classifies it when the SDK wraps it in an exit message", () => {
    expect(detectPolicyRefusal({ text: `Codex Exec exited with code 1: ${CYBER_POLICY}` })).toBe("cyber-policy");
  });

  it("names nothing for a spend cap, a network fault or an empty string", () => {
    expect(detectPolicyRefusal({ text: SPEND_CAP })).toBe(null);
    expect(detectPolicyRefusal({ text: "stream disconnected before completion" })).toBe(null);
    expect(detectPolicyRefusal({ text: "" })).toBe(null);
  });

  it("names nothing for a near-miss that only mentions the risk, as a model quoting it would", () => {
    expect(detectPolicyRefusal({ text: "the pass was flagged for possible cybersecurity risk earlier" })).toBe(null);
  });
});

describe("transportFaultRefusal", () => {
  it("reads the refusal off a recorded cause's report — the shape all 31 historical records carry", () => {
    expect(transportFaultRefusal({ cause: { quota: null, reported: CYBER_POLICY, thrown: CYBER_POLICY } })).toBe(
      "cyber-policy",
    );
  });

  it("falls back to the thrown message when the stream reported nothing", () => {
    expect(transportFaultRefusal({ cause: { quota: null, reported: null, thrown: CYBER_POLICY } })).toBe(
      "cyber-policy",
    );
  });

  it("names nothing for a capped cause, an absent cause or a malformed one", () => {
    expect(transportFaultRefusal({ cause: { quota: "usage-limit", reported: SPEND_CAP, thrown: "x" } })).toBe(null);
    expect(transportFaultRefusal({ cause: undefined })).toBe(null);
    expect(transportFaultRefusal({ cause: { reported: 7 } })).toBe(null);
  });
});
