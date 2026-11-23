/*
 * The answer's grounding and evidence: the three grounding kinds, the dated premise checks a proposal states,
 * and the `couldNotSee` union that either names blind spots or says why there are none.
 */
import { describe, expect, it } from "vitest";

import { couldNotSeeSchema } from "../../../../../outbound/assistant/answerEvidence.js";
import { answerFormSchema } from "../../../../../outbound/assistant/answerForm.js";
import { BULLETS_MAX_ITEMS } from "../../../../../outbound/assistant/contentLimits.js";
import { VALID_ANSWER_CONVERSATION, VALID_ANSWER_VERB } from "./fixtures.js";

describe("grounding — no live route ever loads a corpus, so all three kinds are session-authored alike", () => {
  it("`conversation`, `verb` and `unreachable` all carry an `evidence` field, and share one provenance schema", () => {
    const swapped = {
      ...VALID_ANSWER_VERB,
      grounding: { ...VALID_ANSWER_VERB.grounding, provenance: VALID_ANSWER_CONVERSATION.grounding.provenance },
    };

    expect(answerFormSchema.safeParse(swapped).success).toBe(true);
  });

  it("REFUSES `conversation` grounding with no `reason`", () => {
    const { reason: _reason, ...withoutReason } = VALID_ANSWER_CONVERSATION.grounding;
    const form = { ...VALID_ANSWER_CONVERSATION, grounding: withoutReason };

    expect(answerFormSchema.safeParse(form).success).toBe(false);
  });

  it("`verb`/`unreachable` read/consultedEmpty lines have an OPTIONAL url — a whole surface may have no address", () => {
    const form = {
      ...VALID_ANSWER_VERB,
      grounding: {
        ...VALID_ANSWER_VERB.grounding,
        evidence: { ...VALID_ANSWER_VERB.grounding.evidence, read: [{ label: "the working checkout" }] },
      },
    };

    expect(answerFormSchema.safeParse(form).success).toBe(true);
  });

  it("REFUSES a grounding kind that names none of the three routes", () => {
    const form = { ...VALID_ANSWER_CONVERSATION, grounding: { kind: "mystery", why: "invented" } };

    expect(answerFormSchema.safeParse(form).success).toBe(false);
  });
});

describe("premiseChecks — the present-state check a proposal answer has to state", () => {
  /** The conversation fixture with its evidence replaced wholesale — the shape under test is the evidence. */
  const withEvidence = ({ evidence }: { evidence: unknown }): unknown => ({
    ...VALID_ANSWER_CONVERSATION,
    grounding: { ...VALID_ANSWER_CONVERSATION.grounding, evidence },
  });

  it("defaults to empty, so no existing answer shape changes", () => {
    const { premiseChecks, ...withoutIt } = VALID_ANSWER_CONVERSATION.grounding.evidence;
    const parsed = answerFormSchema.safeParse(withEvidence({ evidence: withoutIt }));

    expect(parsed.success).toBe(true);
    expect(parsed.data).toMatchObject({ grounding: { evidence: { premiseChecks: [] } } });
  });

  it("parses a check carrying what was looked for, what was found and when", () => {
    const parsed = answerFormSchema.safeParse(
      withEvidence({
        evidence: {
          ...VALID_ANSWER_CONVERSATION.grounding.evidence,
          premiseChecks: [
            {
              checkedAtIso: "2026-08-29T13:58:54.016Z",
              finding: "exists",
              how: "searched the org for it through the door",
              subject: "the repository being proposed",
              url: "https://github.com/example/repo",
            },
          ],
        },
      }),
    );

    expect(parsed.success).toBe(true);
  });

  it("REFUSES an instant that is not a real timestamp — an undated check is the claim it exists to replace", () => {
    const parsed = answerFormSchema.safeParse(
      withEvidence({
        evidence: {
          ...VALID_ANSWER_CONVERSATION.grounding.evidence,
          premiseChecks: [{ checkedAtIso: "yesterday", finding: "absent", how: "looked", subject: "the thing" }],
        },
      }),
    );

    expect(parsed.success).toBe(false);
  });

  it("REFUSES a finding outside exists/absent/inconclusive", () => {
    const parsed = answerFormSchema.safeParse(
      withEvidence({
        evidence: {
          ...VALID_ANSWER_CONVERSATION.grounding.evidence,
          premiseChecks: [
            {
              checkedAtIso: "2026-08-29T13:58:54.016Z",
              finding: "probably not",
              how: "looked",
              subject: "the thing",
            },
          ],
        },
      }),
    );

    expect(parsed.success).toBe(false);
  });

  it("REFUSES an unknown key on a check, same as everywhere else in this form", () => {
    const parsed = answerFormSchema.safeParse(
      withEvidence({
        evidence: {
          ...VALID_ANSWER_CONVERSATION.grounding.evidence,
          premiseChecks: [
            {
              checkedAtIso: "2026-08-29T13:58:54.016Z",
              note: "an extra field nobody declared",
              finding: "absent",
              how: "looked",
              subject: "the thing",
            },
          ],
        },
      }),
    );

    expect(parsed.success).toBe(false);
  });
});

describe("couldNotSeeSchema — the structural union the owner ruled for", () => {
  it("accepts a non-empty list of blind spots", () => {
    const parsed = couldNotSeeSchema.safeParse({ blindSpots: ["private Slack DMs"] });

    expect(parsed.success).toBe(true);
    expect(parsed.data).toEqual({ blindSpots: ["private Slack DMs"] });
  });

  it("accepts an empty list accompanied by a non-blank reason", () => {
    const value = { blindSpots: [], reason: "every relevant source was public and searched" };

    const parsed = couldNotSeeSchema.safeParse(value);

    expect(parsed.success).toBe(true);
    expect(parsed.data).toEqual(value);
  });

  it("REFUSES an empty list with no reason at all", () => {
    expect(couldNotSeeSchema.safeParse({ blindSpots: [] }).success).toBe(false);
  });

  it("REFUSES an empty list with a blank reason", () => {
    expect(couldNotSeeSchema.safeParse({ blindSpots: [], reason: "" }).success).toBe(false);
  });

  it("names the blind-spot cap on an over-long list, rather than a bare `Invalid input`", () => {
    const blindSpots = Array.from({ length: BULLETS_MAX_ITEMS + 1 }, (_, i) => `source ${String(i)}`);

    const parsed = couldNotSeeSchema.safeParse({ blindSpots });

    expect(parsed.error!.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`)).toEqual([
      `blindSpots: \`couldNotSee\` names at most ${String(BULLETS_MAX_ITEMS)} blind spots; keep the ones that change the answer.`,
    ]);
  });

  it("names the stray `reason` when a populated list carries one, rather than a bare `Invalid input`", () => {
    const parsed = couldNotSeeSchema.safeParse({ blindSpots: ["source A"], reason: "everything else was checked" });

    expect(parsed.error!.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`)).toEqual([
      ': unknown field "reason" — REFUSED, not ignored. No field here is close to it, so it is probably a field ' +
        "from another schema.\nthis form's fields are: blindSpots",
    ]);
  });
});
