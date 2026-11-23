import { describe, expect, it } from "vitest";

import {
  exactVoiceFindings,
  headcountFraming,
  hedgeProjections,
  noExclamation,
  scaffoldTells,
} from "../../../../../outbound/proposal/lint/voice.js";
import type { ExactVoiceRule } from "../../../../../outbound/voice/exactRules.js";

/** A scaffold-tell finding with the given message. */
const tell = ({ message }: { message: string }): { message: string; rule: string; severity: string } => ({
  message,
  rule: "ai-scaffold-tell",
  severity: "warning",
});

describe("scaffoldTells", () => {
  it("reports each of the five tells once, in tell order, quoting the first match", () => {
    const markdown = [
      "Great question, and a good point.",
      "Good thread too.",
      "The play: ship it.",
      "This is not a tool, it's a habit.",
      "One angle here, another angle there.",
      "It's worth noting the rest.",
    ].join("\n");
    expect(scaffoldTells({ markdown })).toEqual([
      tell({ message: 'negative parallelism ("not X, it\'s Y"): "not a tool, it\'s"' }),
      tell({ message: 'performative opener: "Great question"' }),
      tell({ message: 'two-word-label-colon opener: "The play:"' }),
      tell({ message: 'bucket abstraction: "angle"' }),
      tell({ message: 'throat-clearing hedge: "It\'s worth noting"' }),
    ]);
  });

  it("finds nothing inside a fenced block or an inline code span", () => {
    const markdown = ["```", "Great question", "The play: x", "```", "Use the `angle` flag."].join("\n");
    expect(scaffoldTells({ markdown })).toEqual([]);
  });
});

describe("noExclamation", () => {
  it("refuses a real exclamation mark and accepts image markup and an exclamation inside code", () => {
    expect(noExclamation({ markdown: "Ship it!" })).toEqual({
      message: "exclamation mark in a broadcast document. Full stops only.",
      rule: "exclamation-in-broadcast",
      severity: "warning",
    });
    expect(noExclamation({ markdown: "See ![chart](a.png) and `run!` here." })).toBeUndefined();
  });
});

describe("headcountFraming", () => {
  /** The finding for one quoted match. */
  const framing = ({ quoted }: { quoted: string }): { message: string; rule: string; severity: string } => ({
    message: `headcount/10x framing ${quoted}. Reframe it as doing more with the people already here.`,
    rule: "headcount-framing",
    severity: "warning",
  });

  it("reports each of the four headcount framings with the matched text", () => {
    expect(headcountFraming({ markdown: "A 10x win." })).toEqual(framing({ quoted: '"10x"' }));
    expect(headcountFraming({ markdown: "We could reduce  headcount." })).toEqual(
      framing({ quoted: '"reduce  headcount"' }),
    );
    expect(headcountFraming({ markdown: "It will replace the support team." })).toEqual(
      framing({ quoted: '"replace the support team"' }),
    );
    expect(headcountFraming({ markdown: "It can do the work of 5 analysts." })).toEqual(
      framing({ quoted: '"do the work of 5"' }),
    );
  });

  it("accepts assist framing and a 10x inside a code span", () => {
    expect(headcountFraming({ markdown: "It helps the team we have. Run `10x` mode." })).toBeUndefined();
  });
});

describe("hedgeProjections", () => {
  const UNHEDGED = {
    message:
      "a projected figure is stated as measured. Soften it, or say plainly that it is an estimate; a " +
      "projection asserted as a measurement is the claim a reviewer will pull the whole document apart over.",
    rule: "unhedged-projection",
    severity: "warning",
  };

  it("refuses a counterfactual percentage and an 'n of m' figure with no hedge in their own sentence", () => {
    expect(hedgeProjections({ markdown: "It would save 30% of reviews." })).toEqual(UNHEDGED);
    expect(hedgeProjections({ markdown: "We will fix 3 of 5 of them." })).toEqual(UNHEDGED);
    expect(hedgeProjections({ markdown: "Probably fine. It would save 30% of reviews." })).toEqual(UNHEDGED);
  });

  it("accepts a hedged projection, a counterfactual with no figure, and a measured figure", () => {
    expect(hedgeProjections({ markdown: "It would probably save 30% of reviews." })).toBeUndefined();
    expect(hedgeProjections({ markdown: "It would save time." })).toBeUndefined();
    expect(hedgeProjections({ markdown: "It saved 30% of reviews." })).toBeUndefined();
  });
});

describe("exactVoiceFindings", () => {
  it("finds nothing when no rule is configured", () => {
    expect(exactVoiceFindings({ markdown: "We want synergy.", rules: [] })).toEqual([]);
  });

  it("reports each matching rule per authored line as a blocker, and nothing in code or a welded word", () => {
    const rules: readonly ExactVoiceRule[] = [
      { kind: "word", value: "synergy" },
      { kind: "literal", value: "~~" },
    ];
    const markdown = ["We want synergy ~~ now.", "```", "synergy ~~", "```", "synergyx only."].join("\n");
    expect(exactVoiceFindings({ markdown, rules })).toEqual([
      {
        message:
          'body.line[0] matches the configured word voice rule "synergy". Rewrite the prose; the rule list is yours, in profile.json.',
        rule: "voice-rule",
        severity: "blocker",
      },
      {
        message:
          'body.line[0] matches the configured literal voice rule "~~". Rewrite the prose; the rule list is yours, in profile.json.',
        rule: "voice-rule",
        severity: "blocker",
      },
    ]);
  });
});
