/** The gate that refuses to send an answer nobody else has checked. */
import { describe, expect, it } from "vitest";
import { answerQualityFindings, answerQualityGate } from "../../../admit/answerQualityGate.js";
import { admitDoor } from "../../../admit/door.js";
import type { ReviewVerdict } from "../../../admit/reviewVerdict.js";
import type { DoorRequest } from "../../../admit/types.js";

const DIGEST = `sha256:${"a".repeat(64)}`;
const OTHER_DIGEST = `sha256:${"b".repeat(64)}`;

function verdict(over: Partial<ReviewVerdict> = {}): ReviewVerdict {
  return {
    answerDigest: DIGEST,
    authorSession: "turn-session-1",
    claims: [{ evidence: "read the thread", impact: "high", support: "supported", text: "the pool exhausts nightly" }],
    outcome: "clean",
    reviewerSession: "reviewer-session-2",
    schemaVersion: 1,
    // A reviewer that checked voice and found nothing. Spelled in the shared fixture rather than per case
    // because an ABSENT `voice` is its own finding, so every other case here would otherwise be asserting
    // two codes while testing one.
    voice: { pathsChecked: ["lead", "body"], rulesChecked: 3, violations: [] },
    ...over,
  };
}

function codes({ findings }: { findings: readonly { readonly code: string }[] }): readonly string[] {
  return findings.map((finding) => finding.code);
}

describe("answerQualityFindings", () => {
  it("passes a clean verdict from a different session about these exact bytes", () => {
    expect(answerQualityFindings({ answerDigest: DIGEST, verdict: verdict() })).toEqual([]);
  });

  it("REFUSES an answer with no verdict at all — nothing but its author has read it", () => {
    const findings = answerQualityFindings({ answerDigest: DIGEST, verdict: undefined });

    expect(codes({ findings })).toEqual(["ANSWER_UNREVIEWED"]);
  });

  it("REFUSES a verdict about different bytes — reviewed, then edited", () => {
    // The failure this catches is the one that reads as diligence: a verdict for a previous draft looks
    // exactly like a verdict, and the answer it vouched for is not the answer being sent.
    const findings = answerQualityFindings({ answerDigest: OTHER_DIGEST, verdict: verdict() });

    expect(codes({ findings })).toEqual(["ANSWER_VERDICT_STALE"]);
  });

  it("REFUSES a verdict its own author issued", () => {
    const findings = answerQualityFindings({
      answerDigest: DIGEST,
      verdict: verdict({ authorSession: "same", reviewerSession: "same" }),
    });

    expect(codes({ findings })).toEqual(["ANSWER_VERDICT_SELF_ISSUED"]);
  });

  it("REFUSES a broken or incomplete outcome — the reviewer already said not to send it", () => {
    expect(
      codes({ findings: answerQualityFindings({ answerDigest: DIGEST, verdict: verdict({ outcome: "broken" }) }) }),
    ).toEqual(["ANSWER_VERDICT_NOT_CLEAN"]);
    expect(
      codes({ findings: answerQualityFindings({ answerDigest: DIGEST, verdict: verdict({ outcome: "incomplete" }) }) }),
    ).toEqual(["ANSWER_VERDICT_NOT_CLEAN"]);
  });

  it("REFUSES an empty claim list — checked nothing and found nothing to check look identical", () => {
    // Resolved against sending on purpose: the first of those two is exactly what this gate exists to catch.
    const findings = answerQualityFindings({ answerDigest: DIGEST, verdict: verdict({ claims: [] }) });

    expect(codes({ findings })).toEqual(["ANSWER_VERDICT_NO_CLAIMS"]);
  });

  it("REFUSES an unsupported HIGH-impact claim, and names it so the author can act", () => {
    const findings = answerQualityFindings({
      answerDigest: DIGEST,
      verdict: verdict({
        claims: [{ impact: "high", support: "unsupported", text: "the migration caused it" }],
      }),
    });

    expect(codes({ findings })).toEqual(["ANSWER_CLAIM_UNRESOLVED"]);
    expect(findings[0]!.summary).toContain("the migration caused it");
  });

  it("ALLOWS an unsupported LOW-impact claim — the bar is unresolved high impact, not perfection", () => {
    const findings = answerQualityFindings({
      answerDigest: DIGEST,
      verdict: verdict({
        claims: [
          { evidence: "read the thread", impact: "high", support: "supported", text: "the pool exhausts nightly" },
          { impact: "low", support: "unverifiable", text: "probably started in July" },
        ],
      }),
    });

    expect(findings).toEqual([]);
  });

  it("treats an UNVERIFIABLE high-impact claim as unresolved — honest, and still not sendable", () => {
    const findings = answerQualityFindings({
      answerDigest: DIGEST,
      verdict: verdict({ claims: [{ impact: "high", support: "unverifiable", text: "nobody can tell" }] }),
    });

    expect(codes({ findings })).toEqual(["ANSWER_CLAIM_UNRESOLVED"]);
  });

  it("REFUSES a claim marked supported with no evidence named — a bare yes is not a review", () => {
    const findings = answerQualityFindings({
      answerDigest: DIGEST,
      verdict: verdict({ claims: [{ impact: "high", support: "supported", text: "the pool exhausts nightly" }] }),
    });

    expect(codes({ findings })).toEqual(["ANSWER_CLAIM_UNEVIDENCED"]);
  });

  it("REFUSES a malformed digest rather than comparing it", () => {
    const findings = answerQualityFindings({ answerDigest: DIGEST, verdict: verdict({ answerDigest: "nope" }) });

    expect(codes({ findings })).toEqual(["ANSWER_VERDICT_DIGEST_MALFORMED"]);
  });

  it("reports EVERY standing reason at once, not the first — one round trip, not four", () => {
    const findings = answerQualityFindings({
      answerDigest: OTHER_DIGEST,
      verdict: verdict({
        authorSession: "same",
        claims: [{ impact: "high", support: "unsupported", text: "a guess" }],
        outcome: "broken",
        reviewerSession: "same",
      }),
    });

    expect(codes({ findings })).toEqual([
      "ANSWER_VERDICT_STALE",
      "ANSWER_VERDICT_SELF_ISSUED",
      "ANSWER_VERDICT_NOT_CLEAN",
      "ANSWER_CLAIM_UNRESOLVED",
    ]);
  });

  it("makes every refusal self-correctable — a warn with an override, never an unwaivable hold", () => {
    // House rule: block by default WITH a break-glass. A hold would make "I have looked at it, send it"
    // unrepresentable, and the door records every override it waives anyway.
    const findings = answerQualityFindings({ answerDigest: DIGEST, verdict: undefined });

    expect(findings.every((finding) => finding.severity === "warn")).toBe(true);
    expect(findings.every((finding) => finding.correction.length > 0)).toBe(true);
  });

  it("composes into the real door as a gate, and an unreviewed answer comes back WARN", () => {
    // The factory is what a caller actually wires, so it is exercised through `admitDoor` rather than
    // called directly — that also proves the finding survives the door's own fold into a status.
    const request: DoorRequest = {
      action: { kind: "verb", noun: "slack", verb: "post" },
      artifact: {},
      meta: { createsWorkItem: false, effect: "external-write", home: null, requiresApproval: false },
    };

    const decision = admitDoor({
      env: {},
      gates: [answerQualityGate({ answerDigest: DIGEST, verdict: undefined })],
      request,
    });

    expect(decision.status).toBe("warn");
    expect(codes({ findings: decision.findings })).toEqual(["ANSWER_UNREVIEWED"]);
  });

  it("is waivable by its own override token, and the door RECORDS the waiver", () => {
    // Block-by-default with a break-glass: releasing an unreviewed answer must be possible and must leave a
    // trace. A silent release and a refused one are both worse than a recorded one.
    const request: DoorRequest = {
      action: { kind: "verb", noun: "slack", verb: "post" },
      artifact: {},
      meta: { createsWorkItem: false, effect: "external-write", home: null, requiresApproval: false },
    };

    const decision = admitDoor({
      env: { SLOPWEAVER_DOOR_OVERRIDE: "answer.quality:v1" },
      gates: [answerQualityGate({ answerDigest: DIGEST, verdict: undefined })],
      request,
    });

    expect(decision.status).toBe("pass");
    expect(codes({ findings: decision.overridden })).toEqual(["ANSWER_UNREVIEWED"]);
  });
});

describe("the voice half of a verdict", () => {
  it("REFUSES a verdict that says nothing about voice — checked every rule and checked none look the same", () => {
    const { voice: _dropped, ...silent } = verdict();

    expect(codes({ findings: answerQualityFindings({ answerDigest: DIGEST, verdict: silent }) })).toEqual([
      "ANSWER_VOICE_UNCHECKED",
    ]);
  });

  it("REFUSES rules checked against no string at all — a field filled in without looking", () => {
    const findings = answerQualityFindings({
      answerDigest: DIGEST,
      verdict: verdict({ voice: { pathsChecked: [], rulesChecked: 4, violations: [] } }),
    });

    expect(codes({ findings })).toEqual(["ANSWER_VOICE_NO_PATHS_READ"]);
    expect(findings[0]!.summary).toContain("4 voice rule(s)");
  });

  it("ALLOWS zero rules checked against nothing — an install with no profile loaded", () => {
    const findings = answerQualityFindings({
      answerDigest: DIGEST,
      verdict: verdict({ voice: { pathsChecked: [], rulesChecked: 0, violations: [] } }),
    });

    expect(findings).toEqual([]);
  });

  it("REFUSES a recorded violation, naming the rule and the field but never the words", () => {
    const findings = answerQualityFindings({
      answerDigest: DIGEST,
      verdict: verdict({
        voice: {
          pathsChecked: ["lead", "grounding.evidence.read.0.label"],
          rulesChecked: 3,
          violations: [
            { path: "grounding.evidence.read.0.label", rule: "no em dash" },
            { path: "lead", rule: "no corporate filler" },
          ],
        },
      }),
    });

    expect(codes({ findings })).toEqual(["ANSWER_VOICE_BROKEN"]);
    expect(findings[0]!.summary).toBe(
      "2 voice rule violation(s): grounding.evidence.read.0.label breaks no em dash; lead breaks no corporate filler",
    );
  });

  it("is a warn carrying the answer-quality token, so no voice rule hard-blocks the send", () => {
    const { voice: _dropped, ...silent } = verdict();
    const decision = admitDoor({
      env: { SLOPWEAVER_DOOR_OVERRIDE: "answer.quality:v1" },
      gates: [answerQualityGate({ answerDigest: DIGEST, verdict: silent })],
      request: {
        action: { kind: "verb", noun: "slack", verb: "post" },
        artifact: {},
        meta: { createsWorkItem: false, effect: "external-write", home: null, requiresApproval: false },
      },
    });

    expect(decision.status).toBe("pass");
    expect(codes({ findings: decision.overridden })).toEqual(["ANSWER_VOICE_UNCHECKED"]);
  });

  it("reports the voice finding ALONGSIDE the others, never instead of them", () => {
    const { voice: _dropped, ...silent } = verdict({ outcome: "broken" });

    expect(codes({ findings: answerQualityFindings({ answerDigest: DIGEST, verdict: silent }) })).toEqual([
      "ANSWER_VERDICT_NOT_CLEAN",
      "ANSWER_VOICE_UNCHECKED",
    ]);
  });
});
