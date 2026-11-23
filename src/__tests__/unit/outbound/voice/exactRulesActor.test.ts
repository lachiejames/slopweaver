/**
 * The actor split, the `at-least-one` kind, and how a rule is NAMED — the three parts of `exactRules.ts`
 * that the admit-door voice gate leans on and nothing tested before it existed.
 *
 * `at-least-one` is the one kind whose polarity is inverted, so it is tested from BOTH ends: a region
 * carrying a marker must produce nothing, and a region carrying none must produce a finding. A test written
 * only against the second half passes for a matcher that always fires.
 */
import { describe, expect, it } from "vitest";

import {
  type ExactVoiceRule,
  exactVoiceRuleFindings,
  exactVoiceRuleSchema,
  rulesForActor,
  VOICE_ACTORS,
  voiceRuleLabel,
  voiceRuleSubject,
} from "../../../../outbound/voice/exactRules.js";

const BOTH: ExactVoiceRule = { kind: "literal", value: "—" };
const ME_ONLY: ExactVoiceRule = { actors: ["me"], kind: "word", value: "delve" };
const BOT_ONLY: ExactVoiceRule = { actors: ["bot"], kind: "phrase", value: "happy to help" };
const EITHER: ExactVoiceRule = { actors: ["me", "bot"], kind: "literal", value: "…" };

describe("rulesForActor", () => {
  it("gives the me lane the unscoped rule, its own, and the both-scoped one", () => {
    expect(rulesForActor({ actor: "me", rules: [BOTH, ME_ONLY, BOT_ONLY, EITHER] })).toStrictEqual([
      BOTH,
      ME_ONLY,
      EITHER,
    ]);
  });

  it("gives the bot lane the unscoped rule, its own, and the both-scoped one", () => {
    expect(rulesForActor({ actor: "bot", rules: [BOTH, ME_ONLY, BOT_ONLY, EITHER] })).toStrictEqual([
      BOTH,
      BOT_ONLY,
      EITHER,
    ]);
  });

  it("keeps input order rather than grouping by scope", () => {
    expect(rulesForActor({ actor: "bot", rules: [BOT_ONLY, BOTH] })).toStrictEqual([BOT_ONLY, BOTH]);
  });

  it("gives every lane an empty list when there are no rules", () => {
    expect(VOICE_ACTORS.map((actor) => rulesForActor({ actor, rules: [] }))).toStrictEqual([[], []]);
  });
});

describe("the at-least-one rule kind", () => {
  const HEDGE: ExactVoiceRule = { anyOf: ["i think", "probably", "maybe"], kind: "at-least-one" };

  it("finds nothing when the prose carries one of the markers", () => {
    expect(
      exactVoiceRuleFindings({ prose: [{ path: "lead", text: "I think it landed" }], rules: [HEDGE] }),
    ).toStrictEqual([]);
  });

  it("reports the region when the prose carries none of them", () => {
    expect(exactVoiceRuleFindings({ prose: [{ path: "lead", text: "it landed" }], rules: [HEDGE] })).toStrictEqual([
      { path: "lead", rule: HEDGE },
    ]);
  });

  it("needs a lexical boundary, so a marker inside a longer word does not count", () => {
    expect(
      exactVoiceRuleFindings({ prose: [{ path: "lead", text: "the maybelline shade" }], rules: [HEDGE] }),
    ).toStrictEqual([{ path: "lead", rule: HEDGE }]);
  });

  it("judges each region on its own, so one hedged line does not cover an unhedged one", () => {
    const prose = [
      { path: "lead", text: "I think it landed" },
      { path: "body", text: "the pool is exhausted" },
    ];
    expect(exactVoiceRuleFindings({ prose, rules: [HEDGE] })).toStrictEqual([{ path: "body", rule: HEDGE }]);
  });

  it("parses with an actors scope and refuses an empty anyOf", () => {
    expect(exactVoiceRuleSchema.parse({ actors: ["me"], anyOf: ["i think"], kind: "at-least-one" })).toStrictEqual({
      actors: ["me"],
      anyOf: ["i think"],
      kind: "at-least-one",
    });
    expect(exactVoiceRuleSchema.safeParse({ anyOf: [], kind: "at-least-one" }).success).toBe(false);
  });
});

describe("voiceRuleLabel and voiceRuleSubject", () => {
  it("names an at-least-one rule by its whole marker set, never by a value it does not have", () => {
    expect(voiceRuleSubject({ rule: { anyOf: ["i think", "maybe"], kind: "at-least-one" } })).toBe(
      '["i think","maybe"]',
    );
    expect(voiceRuleLabel({ rule: { anyOf: ["i think"], kind: "at-least-one" } })).toBe(
      'carries none of the configured at-least-one voice markers ["i think"]',
    );
  });

  it("names a literal rule by its kind and its quoted value, so a trailing space is visible", () => {
    expect(voiceRuleLabel({ rule: { kind: "literal", value: " — " } })).toBe(
      'matches the configured literal voice rule " — "',
    );
  });

  it("names a word rule by its own kind rather than a shared one", () => {
    expect(voiceRuleLabel({ rule: ME_ONLY })).toBe('matches the configured word voice rule "delve"');
  });
});
