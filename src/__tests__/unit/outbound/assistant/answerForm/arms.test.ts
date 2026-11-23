/*
 * The form as a shape: each fixture parses exactly, the lead is refused past its cap, an unknown key is refused
 * with the nearest field named, and any `kind` but `answer` is refused.
 *
 * deleted-with-code: planArmSchema, dripArmSchema, asMeArmSchema
 */
import { describe, expect, it } from "vitest";

import { answerFormSchema } from "../../../../../outbound/assistant/answerForm.js";
import { TLDR_VISIBLE_MAX } from "../../../../../outbound/assistant/contentLimits.js";
import { FORM_FIXTURES, VALID_ANSWER_CONVERSATION } from "./fixtures.js";

describe("answerFormSchema — each fixture parses exactly", () => {
  it.each(FORM_FIXTURES)("$name", ({ value }) => {
    const parsed = answerFormSchema.safeParse(value);

    expect(parsed.success).toBe(true);
    expect(parsed.data).toEqual(value);
  });
});

describe("answerFormSchema — the lead is REFUSED past its cap, never truncated", () => {
  it("accepts a lead exactly at the cap", () => {
    const atCap = { ...VALID_ANSWER_CONVERSATION, lead: "x".repeat(TLDR_VISIBLE_MAX) };

    const parsed = answerFormSchema.safeParse(atCap);

    expect(parsed.success).toBe(true);
    expect(parsed.data).toEqual(atCap);
  });

  it("refuses a lead one character over the cap, and names the measurement", () => {
    const overCap = { ...VALID_ANSWER_CONVERSATION, lead: "x".repeat(TLDR_VISIBLE_MAX + 1) };

    const parsed = answerFormSchema.safeParse(overCap);

    expect(parsed.success).toBe(false);
    const messages = parsed.error!.issues.map((issue) => issue.message).join("\n");
    expect(messages).toContain(
      `lead is ${String(TLDR_VISIBLE_MAX + 1)} visible chars, over the ${String(TLDR_VISIBLE_MAX)} cap`,
    );
  });

  it("refuses an empty lead", () => {
    expect(answerFormSchema.safeParse({ ...VALID_ANSWER_CONVERSATION, lead: "" }).success).toBe(false);
  });
});

describe("answerFormSchema — unknown keys are REFUSED and the nearest field is named", () => {
  it("the answer arm names the nearest field for a typo'd top-level key", () => {
    const withTypo = { ...VALID_ANSWER_CONVERSATION, leads: "typo" };

    const parsed = answerFormSchema.safeParse(withTypo);

    expect(parsed.success).toBe(false);
    const messages = parsed.error!.issues.map((issue) => issue.message).join("\n");
    expect(messages).toContain('Did you mean "lead"?');
  });
});

describe("answerFormSchema — `answer` is the only kind, and any other is refused on `kind`", () => {
  it.each(["plan", "drip", "as-me"])("refuses an otherwise valid answer declaring kind %s", (kind) => {
    const parsed = answerFormSchema.safeParse({ ...VALID_ANSWER_CONVERSATION, kind });

    expect(parsed.success).toBe(false);
    expect(parsed.error!.issues.map((issue) => issue.path.join("."))).toEqual(["kind"]);
    expect(parsed.error!.issues[0]!.message).toContain('"answer"');
  });
});
