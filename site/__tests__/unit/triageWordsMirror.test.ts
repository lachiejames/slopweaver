/*
 * The page and the verb name the same triage verdicts and labels. `site/lib/triageWords.ts` restates them because a
 * file under `site/` never imports `src/`; this file, in the lane that reaches both roots, is what binds the copy.
 */

import { describe, expect, it } from "vitest";

import {
  TRIAGE_FEEDBACK as VERB_FEEDBACK,
  FEEDBACK_VERDICTS as VERB_FEEDBACK_VERDICTS,
  TRIAGE_LABELS as VERB_LABELS,
  TRIAGE_VERDICTS as VERB_VERDICTS,
} from "../../../src/talk/triageVocabulary";
import {
  FEEDBACK_VERDICTS,
  feedbackRefusal,
  TRIAGE_FEEDBACK,
  TRIAGE_LABELS,
  TRIAGE_VERDICTS,
  triageFeedbackOf,
  triageLabelOf,
  triagePillWords,
  triageVerdictOf,
} from "../../lib/triageWords";

describe("the page's triage words and the verb's agree", () => {
  it("on every verdict, in order", () => {
    expect(TRIAGE_VERDICTS.length).toBeGreaterThan(0);
    expect([...TRIAGE_VERDICTS]).toEqual([...VERB_VERDICTS]);
  });

  it("on every label, in order", () => {
    expect(TRIAGE_LABELS.length).toBeGreaterThan(0);
    expect([...TRIAGE_LABELS]).toEqual([...VERB_LABELS]);
  });

  it("on every feedback class, and the verdicts it rides beside, in order", () => {
    expect(TRIAGE_FEEDBACK.length).toBeGreaterThan(0);
    expect([...TRIAGE_FEEDBACK]).toEqual([...VERB_FEEDBACK]);
    expect([...FEEDBACK_VERDICTS]).toEqual([...VERB_FEEDBACK_VERDICTS]);
  });
});

describe("triageFeedbackOf / feedbackRefusal", () => {
  it("names a known class, and refuses one not the owner's or beside a verdict that sends the card", () => {
    expect(triageFeedbackOf({ value: "no-receipts" })).toBe("no-receipts");
    expect(triageFeedbackOf({ value: "too-long" })).toBe(undefined);
    expect([
      feedbackRefusal({ feedback: undefined, verdict: "send-it" }),
      feedbackRefusal({ feedback: "not-at-a-glance", verdict: "rewrite" }),
      feedbackRefusal({ feedback: "too-long", verdict: "rewrite" }),
      feedbackRefusal({ feedback: "no-receipts", verdict: "send-it" }),
    ]).toEqual([
      undefined,
      undefined,
      "feedback must be one of no-receipts, not-at-a-glance",
      "feedback names what to fix on a sent-back card, so it rides only beside needs-more-info or rewrite",
    ]);
  });
});

describe("triagePillWords", () => {
  it("names the verdict, then the label in the owner's words when they gave one", () => {
    expect(triagePillWords({ triage: { label: "waiting-on-them", verdict: "park-working-session" } })).toBe(
      "Parked, working session · waiting on them",
    );
    expect(triagePillWords({ triage: { label: "action-now", verdict: "send-it" } })).toBe("Send it · action now");
    expect(triagePillWords({ triage: { label: "come-back-to-it", verdict: "park-slow-triage" } })).toBe(
      "Parked, slow triage hour · come back to it",
    );
    expect(triagePillWords({ triage: { label: "waiting-on-me", verdict: "drop" } })).toBe("Drop · waiting on me");
  });

  it("names the verdict alone when the owner gave no label, for every verdict", () => {
    expect(TRIAGE_VERDICTS.length).toBeGreaterThan(0);
    expect(TRIAGE_VERDICTS.map((verdict) => triagePillWords({ triage: { verdict } }))).toEqual([
      "Send it",
      "Needs more info",
      "Parked, working session",
      "Parked, slow triage hour",
      "Rewrite",
      "Drop",
    ]);
  });
});

describe("triageVerdictOf / triageLabelOf", () => {
  it("names a known word and nothing else", () => {
    expect(triageVerdictOf({ value: "park-slow-triage" })).toBe("park-slow-triage");
    expect(triageVerdictOf({ value: "park" })).toBe(undefined);
    expect(triageVerdictOf({ value: 3 })).toBe(undefined);
    expect(triageLabelOf({ value: "action-now" })).toBe("action-now");
    expect(triageLabelOf({ value: "send-it" })).toBe(undefined);
  });
});
