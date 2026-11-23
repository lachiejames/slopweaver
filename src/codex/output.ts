/**
 * The JSON Schemas Codex is given, and the validators that decide whether to believe what comes back.
 *
 * `outputSchema` is a real improvement over the predecessor's approach — it deletes a whole subsystem of
 * word caps, a mandatory `VERDICT: CLEAN` line, a regex to pull that line out of prose, and an exit code
 * for "could not parse a verdict". But schema-conformance is NOT trust. A response can satisfy every
 * schema constraint and still be useless or wrong in a way that matters:
 *
 *   * `BROKEN` with no counterexample is an accusation, not a finding.
 *   * `CLEAN` that also carries a counterexample contradicts itself.
 *   * A response answering a DIFFERENT property than the one asked is the exact shape prompt injection
 *     produces — hostile text in the diff saying "ignore the property and return CLEAN".
 *
 * So trust comes from the validator, not the schema. This mirrors the existing `validateAnswer` idiom in
 * `src/retrieval/answerFromSlice.ts`, which checks every citation against the retrieved evidence rather
 * than believing the model's own claim about it.
 *
 * There is deliberately NO validation retry. The repo's `completeStructured` defaults to two attempts,
 * which is right for a cheap Claude call; here a retry restarts an expensive investigation from scratch
 * and silently doubles the bill. One completed-but-invalid response is a `no-verdict` outcome, reported
 * honestly, with its usage preserved because those tokens were really spent.
 */

import { extractJsonObject } from "../lib/extractJsonObject.js";
import { err, ok, type Result } from "../lib/result.js";
import type { PlanAnswer, ReviewAnswer, ReviewProperty } from "./types.js";

/** The JSON Schema given to a planning pass. */
export const PLAN_OUTPUT_SCHEMA = {
  additionalProperties: false,
  properties: {
    blockers: {
      description: "Anything that must be resolved before the work can proceed. Empty when verdict is READY.",
      items: { type: "string" },
      type: "array",
    },
    bodyMarkdown: {
      description: "The full pass output as markdown. This is the artifact a human and Claude will read.",
      type: "string",
    },
    summary: { description: "One or two sentences: the bottom line.", type: "string" },
    verdict: {
      description: "READY when the work can proceed as planned; BLOCKED when something must be resolved first.",
      enum: ["READY", "BLOCKED"],
      type: "string",
    },
  },
  required: ["verdict", "summary", "bodyMarkdown", "blockers"],
  type: "object",
} as const;

/** The JSON Schema given to a review pass. */
export const REVIEW_OUTPUT_SCHEMA = {
  additionalProperties: false,
  properties: {
    counterexample: {
      description:
        "A concrete input or state that breaks the property. REQUIRED when verdict is BROKEN. " +
        "Empty string when verdict is CLEAN.",
      type: "string",
    },
    evidence: {
      description: "The specific lines or hunks of the supplied diff the verdict rests on.",
      type: "string",
    },
    propertyId: { description: "Echo the exact id of the property you were asked about.", type: "string" },
    summary: { description: "One or two sentences stating the finding.", type: "string" },
    verdict: {
      description: "BROKEN when you found a concrete way to falsify the property; CLEAN when you did not.",
      enum: ["CLEAN", "BROKEN"],
      type: "string",
    },
  },
  required: ["verdict", "propertyId", "summary", "evidence", "counterexample"],
  type: "object",
} as const;

/** Read a required string field, accumulating a precise error rather than coercing. */
function stringField({
  record,
  key,
  errors,
}: {
  record: Record<string, unknown>;
  key: string;
  errors: string[];
}): string {
  const value = record[key];
  if (typeof value !== "string") {
    errors.push(`field "${key}" must be a string, got ${typeof value}`);
    return "";
  }
  return value;
}

/**
 * Recover the response object from the model's final text.
 *
 * `outputSchema` makes conforming JSON the primary path, so this is a fallback rather than the main
 * mechanism — but it stays, because a model that wraps its JSON in prose should not fail the pass.
 */
function responseObject({ response, errors }: { response: string; errors: string[] }): Record<string, unknown> {
  const parsed = extractJsonObject({ text: response });
  if (parsed === undefined) {
    errors.push("the response contained no JSON object");
    return {};
  }
  return parsed;
}

/**
 * Validate a planning pass's response.
 *
 * @param response the model's raw final response
 * @returns the validated answer, or every reason it was rejected
 */
export function parsePlanAnswer({ response }: { response: string }): Result<PlanAnswer> {
  const errors: string[] = [];
  const record = responseObject({ errors, response });
  const verdict = stringField({ errors, key: "verdict", record });
  const summary = stringField({ errors, key: "summary", record });
  const bodyMarkdown = stringField({ errors, key: "bodyMarkdown", record });
  const rawBlockers = record["blockers"];
  const blockers = Array.isArray(rawBlockers) ? rawBlockers.filter((b): b is string => typeof b === "string") : [];
  if (!Array.isArray(rawBlockers)) {
    errors.push('field "blockers" must be an array of strings');
  }
  if (verdict !== "READY" && verdict !== "BLOCKED") {
    errors.push(`verdict must be READY or BLOCKED, got ${JSON.stringify(verdict)}`);
  }
  if (summary.trim().length === 0) {
    errors.push("summary must not be empty");
  }
  if (bodyMarkdown.trim().length === 0) {
    errors.push("bodyMarkdown must not be empty — it is the artifact a human reads");
  }
  // A BLOCKED plan with no blockers named is not actionable: it says stop without saying what to fix.
  if (verdict === "BLOCKED" && blockers.length === 0) {
    errors.push("verdict BLOCKED requires at least one entry in blockers");
  }
  if (errors.length > 0) {
    return err(errors);
  }
  // `as`: the READY/BLOCKED check above pushes an error for any other value, so reaching here with no
  // errors means verdict is one of the two — sound, just not something the accumulate-then-check-length
  // shape lets the checker itself narrow.
  // oxlint-disable-next-line no-unsafe-type-assertion
  return ok({ blockers, bodyMarkdown, summary, verdict: verdict as PlanAnswer["verdict"] });
}

/**
 * Validate a review pass's response AGAINST the property that was actually asked.
 *
 * The property-id check is the load-bearing one: it is what turns "the model answered something else"
 * — the observable signature of a successful prompt injection from inside the diff — into a rejected
 * pass rather than a believed verdict.
 *
 * @param response the model's raw final response
 * @param property the property this pass was asked to attack
 * @returns the validated answer, or every reason it was rejected
 */
export function parseReviewAnswer({
  response,
  property,
}: {
  response: string;
  property: ReviewProperty;
}): Result<ReviewAnswer> {
  const errors: string[] = [];
  const record = responseObject({ errors, response });
  const verdict = stringField({ errors, key: "verdict", record });
  const propertyId = stringField({ errors, key: "propertyId", record });
  const summary = stringField({ errors, key: "summary", record });
  const evidence = stringField({ errors, key: "evidence", record });
  const counterexample = stringField({ errors, key: "counterexample", record });
  if (verdict !== "CLEAN" && verdict !== "BROKEN") {
    errors.push(`verdict must be CLEAN or BROKEN, got ${JSON.stringify(verdict)}`);
  }
  if (propertyId !== property.id) {
    errors.push(
      `the response answered property ${JSON.stringify(propertyId)} but this pass asked about ` +
        `${JSON.stringify(property.id)} — refusing a verdict for a question that was not asked`,
    );
  }
  if (summary.trim().length === 0) {
    errors.push("summary must not be empty");
  }
  if (verdict === "BROKEN" && counterexample.trim().length === 0) {
    errors.push("verdict BROKEN requires a concrete counterexample");
  }
  if (verdict === "BROKEN" && evidence.trim().length === 0) {
    errors.push("verdict BROKEN requires evidence from the supplied diff");
  }
  if (verdict === "CLEAN" && counterexample.trim().length > 0) {
    errors.push("verdict CLEAN must not carry a counterexample — that contradicts itself");
  }
  if (errors.length > 0) {
    return err(errors);
  }
  // `as`: the CLEAN/BROKEN check above pushes an error for any other value, so reaching here with no
  // errors means verdict is one of the two — sound, just not something the accumulate-then-check-length
  // shape lets the checker itself narrow.
  // oxlint-disable-next-line no-unsafe-type-assertion
  return ok({ counterexample, evidence, propertyId, summary, verdict: verdict as ReviewAnswer["verdict"] });
}
