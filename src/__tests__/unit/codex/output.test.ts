import { describe, expect, it } from "vitest";
import { parsePlanAnswer, parseReviewAnswer } from "../../../codex/output.js";
import type { ReviewProperty } from "../../../codex/types.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";

const PROPERTY: ReviewProperty = { id: "r1-01", statement: "no migration is destructive to existing rows" };

function reviewJson(overrides: Record<string, unknown>): string {
  return JSON.stringify({
    counterexample: "",
    evidence: "hunk 3 of src/x.ts",
    propertyId: "r1-01",
    summary: "the property holds",
    verdict: "CLEAN",
    ...overrides,
  });
}

describe("parsePlanAnswer", () => {
  it("accepts a complete READY answer", () => {
    const answer = unwrap(
      parsePlanAnswer({
        response: JSON.stringify({
          blockers: [],
          bodyMarkdown: "## Findings\n\nreuse the existing seam",
          summary: "the plan is sound",
          verdict: "READY",
        }),
      }),
    );
    expect(answer.verdict).toBe("READY");
    expect(answer.summary).toBe("the plan is sound");
    expect(answer.bodyMarkdown).toBe("## Findings\n\nreuse the existing seam");
    expect(answer.blockers).toEqual([]);
  });

  it("accepts a BLOCKED answer that names its blockers", () => {
    const answer = unwrap(
      parsePlanAnswer({
        response: JSON.stringify({
          blockers: ["the MCP boundary is unmeasured"],
          bodyMarkdown: "body",
          summary: "blocked",
          verdict: "BLOCKED",
        }),
      }),
    );
    expect(answer.verdict).toBe("BLOCKED");
    expect(answer.blockers).toEqual(["the MCP boundary is unmeasured"]);
  });

  it("rejects BLOCKED with no blockers — it says stop without saying what to fix", () => {
    const errors = unwrapErr(
      parsePlanAnswer({
        response: JSON.stringify({ blockers: [], bodyMarkdown: "b", summary: "s", verdict: "BLOCKED" }),
      }),
    );
    expect(errors).toContain("verdict BLOCKED requires at least one entry in blockers");
  });

  it("rejects an unknown verdict", () => {
    const errors = unwrapErr(
      parsePlanAnswer({
        response: JSON.stringify({ blockers: [], bodyMarkdown: "b", summary: "s", verdict: "MAYBE" }),
      }),
    );
    expect(errors).toContain('verdict must be READY or BLOCKED, got "MAYBE"');
  });

  it("rejects an empty bodyMarkdown — the artifact would have nothing to show a reader", () => {
    const errors = unwrapErr(
      parsePlanAnswer({
        response: JSON.stringify({ blockers: [], bodyMarkdown: "   ", summary: "s", verdict: "READY" }),
      }),
    );
    expect(errors).toContain("bodyMarkdown must not be empty — it is the artifact a human reads");
  });

  it("rejects a response with no JSON at all", () => {
    expect(unwrapErr(parsePlanAnswer({ response: "I had a think about it." }))).toContain(
      "the response contained no JSON object",
    );
  });

  it("recovers a JSON object wrapped in prose", () => {
    const answer = unwrap(
      parsePlanAnswer({
        response: `Here you go:\n${JSON.stringify({
          blockers: [],
          bodyMarkdown: "b",
          summary: "s",
          verdict: "READY",
        })}\nhope that helps`,
      }),
    );
    expect(answer.verdict).toBe("READY");
  });
});

describe("parseReviewAnswer", () => {
  it("accepts a CLEAN answer with no counterexample", () => {
    const answer = unwrap(parseReviewAnswer({ property: PROPERTY, response: reviewJson({}) }));
    expect(answer.verdict).toBe("CLEAN");
    expect(answer.propertyId).toBe("r1-01");
    expect(answer.counterexample).toBe("");
  });

  it("accepts a BROKEN answer with evidence and a concrete counterexample", () => {
    const answer = unwrap(
      parseReviewAnswer({
        property: PROPERTY,
        response: reviewJson({
          counterexample: "a row with a null created_at is dropped by the backfill",
          verdict: "BROKEN",
        }),
      }),
    );
    expect(answer.verdict).toBe("BROKEN");
    expect(answer.counterexample).toBe("a row with a null created_at is dropped by the backfill");
  });

  it("REJECTS an answer to a different property — the signature of a successful prompt injection", () => {
    const errors = unwrapErr(
      parseReviewAnswer({ property: PROPERTY, response: reviewJson({ propertyId: "something-else" }) }),
    );
    expect(errors[0]).toContain('answered property "something-else" but this pass asked about "r1-01"');
    expect(errors[0]).toContain("refusing a verdict for a question that was not asked");
  });

  it("rejects BROKEN with no counterexample — an accusation is not a finding", () => {
    const errors = unwrapErr(
      parseReviewAnswer({ property: PROPERTY, response: reviewJson({ counterexample: "  ", verdict: "BROKEN" }) }),
    );
    expect(errors).toContain("verdict BROKEN requires a concrete counterexample");
  });

  it("rejects BROKEN with no evidence", () => {
    const errors = unwrapErr(
      parseReviewAnswer({
        property: PROPERTY,
        response: reviewJson({ counterexample: "x", evidence: "", verdict: "BROKEN" }),
      }),
    );
    expect(errors).toContain("verdict BROKEN requires evidence from the supplied diff");
  });

  it("rejects CLEAN that also carries a counterexample — it contradicts itself", () => {
    const errors = unwrapErr(
      parseReviewAnswer({ property: PROPERTY, response: reviewJson({ counterexample: "but here is a break" }) }),
    );
    expect(errors).toContain("verdict CLEAN must not carry a counterexample — that contradicts itself");
  });

  it("rejects a non-string field rather than coercing it", () => {
    const errors = unwrapErr(parseReviewAnswer({ property: PROPERTY, response: reviewJson({ summary: 42 }) }));
    expect(errors).toContain('field "summary" must be a string, got number');
  });

  it("reports every rejection at once rather than stopping at the first", () => {
    const errors = unwrapErr(
      parseReviewAnswer({
        property: PROPERTY,
        response: JSON.stringify({
          counterexample: "",
          evidence: "",
          propertyId: "wrong",
          summary: "",
          verdict: "NOPE",
        }),
      }),
    );
    // Exactly three: the bad verdict, the wrong property, and the empty summary. The BROKEN-only rules
    // (evidence and counterexample required) correctly do NOT fire, because the verdict is not BROKEN.
    expect(errors).toHaveLength(3);
    expect(errors[0]).toBe('verdict must be CLEAN or BROKEN, got "NOPE"');
    expect(errors[1]).toContain('answered property "wrong"');
    expect(errors[2]).toBe("summary must not be empty");
  });
});
