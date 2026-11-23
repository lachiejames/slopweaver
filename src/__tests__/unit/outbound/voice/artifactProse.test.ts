/**
 * Which fields of a BOT send the voice rules are handed — the coverage half of the measured em-dash leak.
 *
 * Every fixture here is shaped on one of the three strings the harvest actually found in the owner's own
 * Slack history, and each is fed in at the field class it leaked from: an attachment/dashboard title (a
 * card's TL;DR), a link LABEL, and a bulleted round-up line. `exactRules.ts`'s own stripping is untouched
 * and all three survive it intact, so a finding here is proof the walker reached the field — the defect was
 * never the matcher.
 */
import { describe, expect, it } from "vitest";

import type { SlackBotArtifact } from "../../../../outbound/artifact/types.js";
import type { AnswerFormAnswer } from "../../../../outbound/assistant/answerForm.js";
import { answerProse, botArtifactProse, channelProse } from "../../../../outbound/voice/artifactProse.js";
import { type ExactVoiceRule, exactVoiceRuleFindings } from "../../../../outbound/voice/exactRules.js";

const EM_DASH: ExactVoiceRule = { kind: "literal", value: "—" };

/** The measured leaks' shapes, each re-worded with invented content: the em dash and its field class kept. */
const LEAKED_TITLE = "Throughput — Merged by Squad (PR #101)";
const LEAKED_LABEL = "the bot — status page";
const LEAKED_BULLET = "• Web Portal — slow endpoints p95 by route";

/** Which field paths a rule fires on, for one artifact. */
function brokenPaths({ artifact }: { artifact: SlackBotArtifact }): readonly string[] {
  return exactVoiceRuleFindings({ prose: botArtifactProse({ artifact }), rules: [EM_DASH] }).map(
    (finding) => finding.path,
  );
}

const EMPTY_CARD = {
  citations: [],
  detail: [],
  index: [],
  kind: "update",
  media: [],
  tldr: "shipped it",
} as const satisfies SlackBotArtifact;

describe("botArtifactProse over a card", () => {
  it("catches the dashboard title the harvest found, in the TL;DR", () => {
    expect(brokenPaths({ artifact: { ...EMPTY_CARD, tldr: LEAKED_TITLE } })).toStrictEqual(["tldr"]);
  });

  it("catches a link LABEL in the above-the-fold index, which no walker read before", () => {
    const artifact: SlackBotArtifact = {
      ...EMPTY_CARD,
      index: [[{ label: LEAKED_LABEL, type: "link", url: "https://example.com/board" }]],
    };
    expect(brokenPaths({ artifact })).toStrictEqual(["index[0].runs[0].label"]);
  });

  it("never reads the link's URL, so an em dash in an href is not a finding", () => {
    const artifact: SlackBotArtifact = {
      ...EMPTY_CARD,
      index: [[{ label: "live board", type: "link", url: "https://example.com/a—b" }]],
    };
    expect(brokenPaths({ artifact })).toStrictEqual([]);
  });

  it("catches a bulleted round-up line below the fold", () => {
    const artifact: SlackBotArtifact = {
      ...EMPTY_CARD,
      detail: [{ items: [[{ text: LEAKED_BULLET, type: "text" }]], type: "bullets" }],
    };
    expect(brokenPaths({ artifact })).toStrictEqual(["detail.runs[0]"]);
  });

  it("catches the day-one intro, which sits outside every above-the-fold cap", () => {
    expect(brokenPaths({ artifact: { ...EMPTY_CARD, intro: ["a trial — posting weekly"] } })).toStrictEqual([
      "intro[0]",
    ]);
  });

  it("leaves a quoted run alone, because somebody else's title is not the author's voice", () => {
    const artifact: SlackBotArtifact = {
      ...EMPTY_CARD,
      detail: [{ runs: [{ quoted: true, text: LEAKED_TITLE, type: "text" }], type: "paragraph" }],
    };
    expect(brokenPaths({ artifact })).toStrictEqual([]);
  });

  it("finds nothing at all in a card that breaks no rule", () => {
    expect(brokenPaths({ artifact: EMPTY_CARD })).toStrictEqual([]);
  });
});

describe("botArtifactProse over a no-fold message", () => {
  it("walks the lead, the bullets and the trailing lines, in render order", () => {
    const artifact: SlackBotArtifact = {
      bullets: [[{ text: LEAKED_BULLET, type: "text" }]],
      kind: "no-fold",
      lead: [{ text: LEAKED_TITLE, type: "text" }],
      trailing: [[{ text: "and that — is all", type: "text" }]],
    };
    expect(brokenPaths({ artifact })).toStrictEqual(["no-fold[0].runs[0]", "no-fold[1].runs[0]", "no-fold[2].runs[0]"]);
  });
});

describe("answerProse", () => {
  // The grounding is a union by `kind`, and every case below overrides one of its fields — so the fixture is
  // narrowed to the arm it is on. Spread from the union instead and each override is checked against the
  // `verb` arm, which has no `reason` at all.
  type ConversationGrounding = Extract<AnswerFormAnswer["grounding"], { kind: "conversation" }>;

  const GROUNDING: ConversationGrounding = {
    evidence: {
      consultedEmpty: [],
      couldNotSee: { blindSpots: [], reason: "nothing was out of reach" },
      premiseChecks: [],
      read: [],
      substitutedForReal: [],
    },
    kind: "conversation",
    provenance: { model: "claude-opus-5", skillsLoaded: [], verbsLoaded: [] },
    reason: "answered from the thread",
  };

  // Typed as the real arm rather than left to `as const` inference: a literal-typed fixture makes each
  // override a type error rather than a variation.
  const ANSWER: AnswerFormAnswer = {
    body: [{ runs: [{ text: "the pool refilled", type: "text" }], type: "paragraph" }],
    citations: [],
    documents: [],
    grounding: GROUNDING,
    images: [],
    index: [],
    kind: "answer",
    lead: "it refilled",
    measurements: [],
  };

  /** Which field paths a rule fires on, for one answer arm. */
  function answerPaths({ answer }: { answer: AnswerFormAnswer }): readonly string[] {
    return exactVoiceRuleFindings({ prose: answerProse({ answer }), rules: [EM_DASH] }).map((finding) => finding.path);
  }

  it("catches the lead and the body", () => {
    const answer: AnswerFormAnswer = {
      ...ANSWER,
      body: [{ runs: [{ text: LEAKED_BULLET, type: "text" }], type: "paragraph" }],
      lead: LEAKED_TITLE,
    };
    expect(answerPaths({ answer })).toStrictEqual(["lead", "body.runs[0]"]);
  });

  it("catches the grounding's own prose, where five of eight measured violations were", () => {
    const answer: AnswerFormAnswer = {
      ...ANSWER,
      grounding: { ...GROUNDING, reason: "answered from the thread — nothing else was read" },
    };
    expect(answerPaths({ answer })).toStrictEqual(["grounding.reason"]);
  });

  it("catches an evidence label that carries its own url, which renders as the link's text", () => {
    const answer: AnswerFormAnswer = {
      ...ANSWER,
      grounding: {
        ...GROUNDING,
        evidence: {
          ...GROUNDING.evidence,
          read: [{ label: LEAKED_LABEL, url: "https://example.com/board" }],
        },
      },
    };
    expect(answerPaths({ answer })).toStrictEqual(["grounding.evidence.read.0.label"]);
  });

  it("finds nothing in an answer that breaks no rule", () => {
    expect(answerPaths({ answer: ANSWER })).toStrictEqual([]);
  });
});

/**
 * `channelProse` walks the two strings a channel create authors and nothing else.
 *
 * The NAME is the falsifiable half: it carries the banned character in every case below, so a walker that
 * quietly widened to include it would redden these rather than pass them silently. A slug is constrained to
 * lowercase, digits and hyphens and is already judged by `judgeChannelName`; a vocabulary rule over one
 * would warn on text the author had no freedom to word differently.
 */
describe("channelProse", () => {
  it("walks the purpose and the topic, in that order", () => {
    const findings = exactVoiceRuleFindings({
      prose: channelProse({ purpose: LEAKED_TITLE, topic: LEAKED_LABEL }),
      rules: [EM_DASH],
    });

    expect(findings.map((finding) => finding.path)).toEqual(["purpose", "topic"]);
  });

  it("walks neither when a create sets neither", () => {
    expect(channelProse({ purpose: undefined, topic: undefined })).toEqual([]);
  });

  it("walks the topic alone when there is no purpose, rather than shifting its path", () => {
    const findings = exactVoiceRuleFindings({
      prose: channelProse({ purpose: undefined, topic: LEAKED_LABEL }),
      rules: [EM_DASH],
    });

    expect(findings.map((finding) => finding.path)).toEqual(["topic"]);
  });
});
