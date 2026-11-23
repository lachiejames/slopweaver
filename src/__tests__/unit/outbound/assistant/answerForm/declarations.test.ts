/*
 * The two optional declarations an answer may make about itself, `supersedes` and `followThrough`: each parses
 * only in its own shape and is left off entirely when undeclared.
 */
import { describe, expect, it } from "vitest";

import { answerDigestOf } from "../../../../../live/turn/answerDigest.js";
import { FOLLOW_THROUGH_WHAT_MAX } from "../../../../../outbound/assistant/answerArm.js";
import { type AnswerFormAnswer, answerFormSchema } from "../../../../../outbound/assistant/answerForm.js";
import { VALID_ANSWER_CONVERSATION } from "./fixtures.js";

/**
 * The composer's HALF of a supersession — what this form may declare, and what it can never make true.
 *
 * The field is only ever a claim: `live/turn/supersession/eligibility.ts` still has to find the timestamp
 * recorded as this install's own answer in this thread, and the reviewer still has to name the same one.
 * What the schema owes is the shape, and the shape check that earns its place is the timestamp — a target
 * that is not Slack-shaped can only ever name a message that does not exist.
 */
describe("the answer form's `supersedes` declaration", () => {
  const TARGET = "1790054484.916599";

  /** The parsed ANSWER arm, or `undefined` — narrowing lives here so no assertion below carries a branch. */
  function answerArm({ value }: { value: unknown }): AnswerFormAnswer | undefined {
    const parsed = answerFormSchema.safeParse(value);
    if (!parsed.success || parsed.data.kind !== "answer") {
      return undefined;
    }
    return parsed.data;
  }

  it("accepts a Slack message timestamp and carries it through unchanged", () => {
    const answer = answerArm({ value: { ...VALID_ANSWER_CONVERSATION, supersedes: TARGET } });

    expect(answer!.supersedes).toBe(TARGET);
  });

  it("leaves the key off entirely on the ordinary ADDITIVE answer", () => {
    const parsed = answerFormSchema.safeParse(VALID_ANSWER_CONVERSATION);

    expect(parsed.success).toBe(true);
    expect(Object.hasOwn(parsed.data!, "supersedes")).toBe(false);
  });

  it("REFUSES a target that is not a Slack message timestamp", () => {
    const parsed = answerFormSchema.safeParse({ ...VALID_ANSWER_CONVERSATION, supersedes: "the earlier one" });

    expect(parsed.success).toBe(false);
    expect(JSON.stringify(parsed.error!.issues)).toContain("supersedes must be a Slack message timestamp");
  });

  it("REFUSES an empty declaration rather than reading it as an additive answer", () => {
    expect(answerFormSchema.safeParse({ ...VALID_ANSWER_CONVERSATION, supersedes: "" }).success).toBe(false);
  });
});

/*
 * `followThrough` marks a FIRST answer — a plan the same worker keeps building after. It sits on the form so
 * the reviewed digest binds it, and it is never defaulted so every answer without it keeps the digest it had.
 */
describe("the answer form's `followThrough` declaration", () => {
  const FOLLOW_THROUGH = { owes: "pull-requests", what: "open the two pull requests the plan names" } as const;

  it("carries a declared follow-through through unchanged", () => {
    const parsed = answerFormSchema.safeParse({ ...VALID_ANSWER_CONVERSATION, followThrough: FOLLOW_THROUGH });

    expect(parsed.success).toBe(true);
    expect((parsed.data as AnswerFormAnswer).followThrough).toEqual(FOLLOW_THROUGH);
  });

  it("leaves the key off an ordinary answer, so that answer's digest is the one it always had", () => {
    const parsed = answerFormSchema.safeParse(VALID_ANSWER_CONVERSATION);

    expect(parsed.success).toBe(true);
    expect(Object.hasOwn(parsed.data!, "followThrough")).toBe(false);
  });

  it("binds the declaration into the reviewed digest, so a verdict cannot be reused across it", () => {
    const plain = answerFormSchema.parse(VALID_ANSWER_CONVERSATION);
    const declared = answerFormSchema.parse({
      ...VALID_ANSWER_CONVERSATION,
      followThrough: FOLLOW_THROUGH,
    });

    expect(answerDigestOf({ answer: declared })).not.toBe(answerDigestOf({ answer: plain }));
    expect(answerDigestOf({ answer: declared })).toBe(answerDigestOf({ answer: { ...declared } }));
  });

  it("REFUSES an owes value outside the closed set, an empty what, and a what past its cap", () => {
    const refused = [
      { ...FOLLOW_THROUGH, owes: "progress-posts" },
      { ...FOLLOW_THROUGH, what: "  " },
      { ...FOLLOW_THROUGH, what: "x".repeat(FOLLOW_THROUGH_WHAT_MAX + 1) },
    ].map((followThrough) => answerFormSchema.safeParse({ ...VALID_ANSWER_CONVERSATION, followThrough }).success);

    expect(refused).toEqual([false, false, false]);
  });

  it("REFUSES an unknown key inside the declaration", () => {
    expect(
      answerFormSchema.safeParse({ ...VALID_ANSWER_CONVERSATION, followThrough: { ...FOLLOW_THROUGH, eta: "soon" } })
        .success,
    ).toBe(false);
  });
});
