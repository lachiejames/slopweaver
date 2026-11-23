import { describe, expect, it } from "vitest";
import { isRecord } from "../../../../lib/parsers.js";
import type { RecordedAskIdentity } from "../../../../live/ask/identity.js";
import type { UpdateArtifact } from "../../../../outbound/artifact/types.js";
import type { AnswerFormAnswer } from "../../../../outbound/assistant/answerForm.js";
import {
  renderAssistantAnswer,
  renderAssistantAskMessage,
  renderAssistantMessage,
} from "../../../../outbound/assistant/answerMessage.js";
import type { ResolvedMentions } from "../../../../outbound/slack/render.js";
import { renderUpdateCard } from "../../../../outbound/slack/render.js";
import type { SlackCardChrome } from "../../../../outbound/slack/types.js";

/** A colour distinct from any default, so a passing test proves the param was actually threaded through. */
const BANNER_COLOR = "#ABCDEF";

/** Neutral chrome, shared by every answer render AND the card comparisons — never a real operator's identity. */
const CHROME: SlackCardChrome = {
  authorEmoji: ":robot_face:",
  authorLabel: "test-bot",
  bannerColor: BANNER_COLOR,
  detailLabel: "*Details*",
  metadataEventType: "test_card_v1",
};

const MENTIONS: ResolvedMentions = { groups: new Map(), people: new Map([["ada", "U_fake_ada"]]) };

/**
 * An artifact exercising every block shape the shared renderers touch: a primary link, an above-the-fold
 * index (text + mention), a paragraph, a bullet list, a second paragraph, a table, and a citation. If the
 * message renderer reused the shared helpers rather than reimplementing them, every one of these survives
 * unchanged in the answer message.
 */
function richArtifact(): UpdateArtifact {
  return {
    citations: [{ id: "1", label: "[1]", sourceRef: { id: "rec-1", source: "corpus" }, url: "https://example.test/1" }],
    detail: [
      { runs: [{ text: "Paragraph one.", type: "text" }], type: "paragraph" },
      {
        items: [[{ text: "Bullet one.", type: "text" }], [{ citationId: "1", type: "citation" }]],
        type: "bullets",
      },
      { runs: [{ text: "Paragraph two.", type: "text" }], type: "paragraph" },
      {
        columns: ["A", "B"],
        rows: [[[{ text: "a1", type: "text" }], [{ text: "b1", type: "text" }]]],
        type: "table",
      },
    ],
    index: [[{ text: "First item", type: "text" }], [{ person: "ada", type: "mention" }]],
    kind: "update",
    media: [],
    primaryLink: { label: "PR #210", url: "https://example.test/pr/210" },
    tldr: "A short lead.",
  };
}

/** The smallest valid artifact — one paragraph of detail, no index, no primary link, no citations. */
function minimalArtifact(): UpdateArtifact {
  return {
    citations: [],
    detail: [{ runs: [{ text: "The detail.", type: "text" }], type: "paragraph" }],
    index: [],
    kind: "update",
    media: [],
    tldr: "A short lead.",
  };
}

/** Whether `value` (or anything nested inside it) carries an own `attachments` key. Pure, recursive. */
function hasAttachmentsKey({ value }: { value: unknown }): boolean {
  if (Array.isArray(value)) {
    return value.some((entry) => hasAttachmentsKey({ value: entry }));
  }
  if (!isRecord(value)) {
    return false;
  }
  if (Object.hasOwn(value, "attachments")) {
    return true;
  }
  return Object.values(value).some((entry) => hasAttachmentsKey({ value: entry }));
}

/** A verb-grounded answer with a primary link, a citation and a bullet — every block shape the renderer touches. */
function richAnswer(): AnswerFormAnswer {
  return {
    answering: { permalink: "https://example.test/p/1", quote: "what did we decide?" },
    body: [
      { runs: [{ text: "Paragraph one.", type: "text" }], type: "paragraph" },
      { items: [[{ citationId: "1", type: "citation" }]], type: "bullets" },
    ],
    citations: [{ id: "1", label: "[1]", url: "https://example.test/1" }],
    documents: [],
    grounding: {
      capability: { command: ["fleet", "status"], id: "fleet-status", what: "open pull requests" },
      evidence: {
        consultedEmpty: [],
        couldNotSee: { blindSpots: [], reason: "nothing else to check" },
        premiseChecks: [],
        read: [{ label: "slopweaver fleet status" }],
        substitutedForReal: [],
      },
      kind: "verb",
      provenance: { model: "claude-sonnet-5", skillsLoaded: [], verbsLoaded: ["fleet"] },
      result: "3 open PRs",
    },
    images: [],
    index: [],
    kind: "answer",
    measurements: [],
    lead: "You have 3 open PRs.",
  };
}

/** The smallest valid answer — no citations, no primary link, empty body. */
function minimalAnswer(): AnswerFormAnswer {
  return {
    body: [],
    citations: [],
    documents: [],
    grounding: {
      capability: { command: ["fleet", "status"], id: "fleet-status", what: "open pull requests" },
      evidence: {
        consultedEmpty: [],
        couldNotSee: { blindSpots: [], reason: "nothing else to check" },
        premiseChecks: [],
        read: [],
        substitutedForReal: [],
      },
      kind: "verb",
      provenance: { model: "claude-sonnet-5", skillsLoaded: [], verbsLoaded: [] },
      result: "3 open PRs",
    },
    images: [],
    index: [],
    kind: "answer",
    measurements: [],
    lead: "You have 3 open PRs.",
  };
}

/** A fresh turn's exact identity — has earned a real `messageTs`. */
const EXACT_ASK_IDENTITY: RecordedAskIdentity = { channel: "C1", messageTs: "2.2", quality: "exact", threadTs: "1.1" };

/** A queue row released from before exact identity existed — thread only, never an invented `messageTs`. */
const THREAD_ONLY_ASK_IDENTITY: RecordedAskIdentity = { channel: "C1", quality: "thread-only", threadTs: "1.1" };

describe("renderAssistantAnswer — the wrapper", () => {
  it("carries exactly one attachments wrapper, holding the accent colour and the lead as fallback", () => {
    const payload = renderAssistantAnswer({
      answer: minimalAnswer(),
      askIdentity: EXACT_ASK_IDENTITY,
      chrome: CHROME,
      mentions: MENTIONS,
    });

    expect(payload.attachments).toHaveLength(1);
    expect(payload.attachments[0].color).toBe(BANNER_COLOR);
    expect(payload.attachments[0].fallback).toBe("You have 3 open PRs.");
  });

  it("never nests a second attachments key inside the wrapper's own blocks", () => {
    const payload = renderAssistantAnswer({
      answer: richAnswer(),
      askIdentity: EXACT_ASK_IDENTITY,
      chrome: CHROME,
      mentions: MENTIONS,
    });

    expect(hasAttachmentsKey({ value: payload.attachments[0].blocks })).toBe(false);
  });

  it("has exactly the top-level fields the wrapped message needs", () => {
    const payload = renderAssistantAnswer({
      answer: minimalAnswer(),
      askIdentity: EXACT_ASK_IDENTITY,
      chrome: CHROME,
      mentions: MENTIONS,
    });

    expect(Object.keys(payload).toSorted()).toEqual([
      "attachments",
      "metadata",
      "text",
      "unfurl_links",
      "unfurl_media",
    ]);
  });

  it("sets the top-level text to the empty string, exactly like the card, to avoid a duplicate body", () => {
    const payload = renderAssistantAnswer({
      answer: minimalAnswer(),
      askIdentity: EXACT_ASK_IDENTITY,
      chrome: CHROME,
      mentions: MENTIONS,
    });

    expect(payload.text).toBe("");
  });

  it("suppresses both unfurls, like the card", () => {
    const payload = renderAssistantAnswer({
      answer: minimalAnswer(),
      askIdentity: EXACT_ASK_IDENTITY,
      chrome: CHROME,
      mentions: MENTIONS,
    });

    expect(payload.unfurl_links).toBe(false);
    expect(payload.unfurl_media).toBe(false);
  });

  it("stamps V2 metadata — every real answer, so a future sweep can tell it apart from a notice", () => {
    const payload = renderAssistantAnswer({
      answer: minimalAnswer(),
      askIdentity: EXACT_ASK_IDENTITY,
      chrome: CHROME,
      mentions: MENTIONS,
    });

    expect(payload.metadata.event_payload.renderer).toBe("slack-assistant-answer-v2");
    expect(payload.metadata.event_type).toBe("slopweaver_assistant_answer_v2");
  });

  it("carries the exact askIdentity it was given, unaltered, for a fresh turn", () => {
    const payload = renderAssistantAnswer({
      answer: minimalAnswer(),
      askIdentity: EXACT_ASK_IDENTITY,
      chrome: CHROME,
      mentions: MENTIONS,
    });

    expect(payload.metadata.event_payload.askIdentity).toEqual(EXACT_ASK_IDENTITY);
  });

  it("carries a thread-only askIdentity as thread-only, never inventing a messageTs it was not given", () => {
    const payload = renderAssistantAnswer({
      answer: minimalAnswer(),
      askIdentity: THREAD_ONLY_ASK_IDENTITY,
      chrome: CHROME,
      mentions: MENTIONS,
    });

    expect(payload.metadata.event_payload.askIdentity).toEqual(THREAD_ONLY_ASK_IDENTITY);
  });

  it("appends the evidence trail after the chrome and body blocks, inside the wrapper", () => {
    const answer = richAnswer();
    const payload = renderAssistantAnswer({
      answer,
      askIdentity: EXACT_ASK_IDENTITY,
      chrome: CHROME,
      mentions: MENTIONS,
    });

    // 5 fixed chrome blocks (author row, divider, lead, divider, detail label) + 1 body block (`renderDetail`
    // folds the paragraph and bullets together) + no fold padding (chrome alone already clears the fold) +
    // evidence trail's read block, couldNotSee block and provenance context.
    expect(payload.attachments[0].blocks).toHaveLength(9);
    expect(payload.attachments[0].blocks.at(-1)).toEqual({
      elements: [{ text: "claude-sonnet-5 · verbs: fleet · no skills loaded", type: "mrkdwn" }],
      type: "context",
    });
  });

  it("needs no fold padding even for the shortest possible reply, now that full chrome clears the fold alone", () => {
    // The exact shape that regressed live BEFORE the chrome reversal: a one-word reply with an empty body.
    // Back then the lead alone was 1 block, so without padding the evidence trail's couldNotSee/provenance
    // blocks sat at indices 1-2 — above Slack's fold, which cuts after FOLD_AFTER_BLOCKS (5). Full chrome's
    // own 5 fixed blocks now reach the fold on their own, so this shape needs no padding at all.
    const trivialAnswer: AnswerFormAnswer = { ...minimalAnswer(), body: [] };
    const payload = renderAssistantAnswer({
      answer: trivialAnswer,
      askIdentity: EXACT_ASK_IDENTITY,
      chrome: CHROME,
      mentions: MENTIONS,
    });

    const blocks = payload.attachments[0].blocks;
    // chrome(5) + no body + no padding + couldNotSee + provenance.
    expect(blocks).toHaveLength(7);
    expect(blocks.filter((block) => block.type === "divider")).toHaveLength(2);
    expect(blocks[5]).toEqual({
      elements: [
        {
          elements: [
            { style: { bold: true }, text: "What I could not see", type: "text" },
            { text: " — nothing: nothing else to check", type: "text" },
          ],
          type: "rich_text_section",
        },
      ],
      type: "rich_text",
    });
  });

  it("adds no padding once the reply is already long enough to land the evidence trail past the fold on its own", () => {
    const wideAnswer: AnswerFormAnswer = {
      ...minimalAnswer(),
      body: [
        { runs: [{ text: "Paragraph one.", type: "text" }], type: "paragraph" },
        {
          columns: ["A", "B"],
          rows: [[[{ text: "a1", type: "text" }], [{ text: "b1", type: "text" }]]],
          type: "table",
        },
        { runs: [{ text: "Paragraph two.", type: "text" }], type: "paragraph" },
        {
          columns: ["A", "B"],
          rows: [[[{ text: "a2", type: "text" }], [{ text: "b2", type: "text" }]]],
          type: "table",
        },
      ],
    };
    const payload = renderAssistantAnswer({
      answer: wideAnswer,
      askIdentity: EXACT_ASK_IDENTITY,
      chrome: CHROME,
      mentions: MENTIONS,
    });

    // The chrome's own 2 fixed dividers are still there; no EXTRA fold-padding dividers got added on top.
    expect(payload.attachments[0].blocks.filter((block) => block.type === "divider")).toHaveLength(2);
  });

  it("renders a conversation-grounded answer's own evidence, straight off the answer form", () => {
    const conversationAnswer: AnswerFormAnswer = {
      ...minimalAnswer(),
      grounding: {
        evidence: {
          consultedEmpty: [],
          couldNotSee: { blindSpots: [], reason: "nothing else to check" },
          premiseChecks: [],
          read: [],
          substitutedForReal: [],
        },
        kind: "conversation",
        provenance: { model: "claude-sonnet-5", skillsLoaded: [], verbsLoaded: [] },
        reason: "the question is about a past decision, already known from context",
      },
    };

    const payload = renderAssistantAnswer({
      answer: conversationAnswer,
      askIdentity: EXACT_ASK_IDENTITY,
      chrome: CHROME,
      mentions: MENTIONS,
    });

    expect(payload.attachments[0].color).toBe(BANNER_COLOR);
  });

  it("produces byte-identical output for the same answer rendered twice", () => {
    const first = renderAssistantAnswer({
      answer: richAnswer(),
      askIdentity: EXACT_ASK_IDENTITY,
      chrome: CHROME,
      mentions: MENTIONS,
    });
    const second = renderAssistantAnswer({
      answer: richAnswer(),
      askIdentity: EXACT_ASK_IDENTITY,
      chrome: CHROME,
      mentions: MENTIONS,
    });

    expect(first).toEqual(second);
  });
});

describe("renderAssistantAnswer — carries the operator card's own above-the-fold index", () => {
  it("renders a non-empty index with its own per-row citation chip, byte-identical to the card's own lead block", () => {
    const answer: AnswerFormAnswer = {
      ...minimalAnswer(),
      citations: [{ id: "1", label: "[1]", url: "https://example.test/1" }],
      index: [[{ text: "critical: 3", type: "text" }], [{ citationId: "1", type: "citation" }]],
      indexStyle: "plain",
    };
    const payload = renderAssistantAnswer({
      answer,
      askIdentity: EXACT_ASK_IDENTITY,
      chrome: CHROME,
      mentions: MENTIONS,
    });
    const card = renderUpdateCard({
      artifact: {
        citations: answer.citations,
        detail: [{ runs: [{ text: "placeholder", type: "text" }], type: "paragraph" }],
        index: answer.index,
        indexStyle: "plain",
        kind: "update",
        media: [],
        tldr: answer.lead,
      },
      artifactFingerprint: "fp-1",
      chrome: CHROME,
      mentions: MENTIONS,
    });

    // Both now render the SAME five fixed chrome blocks (author row, divider, lead, divider, detail label)
    // for the SAME index and citations — full chrome, not just the lead content.
    expect(payload.attachments[0].blocks.slice(0, 5)).toEqual(card.attachments[0].blocks.slice(0, 5));
  });

  it("renders an empty index exactly as before when an answer does not set one, matching the card's own empty-index lead", () => {
    const answer = minimalAnswer();
    const payload = renderAssistantAnswer({
      answer,
      askIdentity: EXACT_ASK_IDENTITY,
      chrome: CHROME,
      mentions: MENTIONS,
    });
    const card = renderUpdateCard({
      artifact: {
        citations: [],
        detail: [{ runs: [{ text: "placeholder", type: "text" }], type: "paragraph" }],
        index: [],
        kind: "update",
        media: [],
        tldr: answer.lead,
      },
      artifactFingerprint: "fp-1",
      chrome: CHROME,
      mentions: MENTIONS,
    });

    expect(payload.attachments[0].blocks.slice(0, 5)).toEqual(card.attachments[0].blocks.slice(0, 5));
  });
});

describe("renderAssistantMessage — the wrapper", () => {
  it("carries exactly one attachments wrapper, holding the accent colour and the tldr as fallback", () => {
    const payload = renderAssistantMessage({
      artifact: minimalArtifact(),
      chrome: CHROME,
      mentions: MENTIONS,
    });

    expect(payload.attachments).toHaveLength(1);
    expect(payload.attachments[0].color).toBe(BANNER_COLOR);
    expect(payload.attachments[0].fallback).toBe("A short lead.");
  });

  it("never nests a second attachments key inside the wrapper's own blocks", () => {
    const payload = renderAssistantMessage({ artifact: richArtifact(), chrome: CHROME, mentions: MENTIONS });

    expect(hasAttachmentsKey({ value: payload.attachments[0].blocks })).toBe(false);
  });

  it("has exactly the top-level fields the wrapped message needs", () => {
    const payload = renderAssistantMessage({
      artifact: minimalArtifact(),
      chrome: CHROME,
      mentions: MENTIONS,
    });

    expect(Object.keys(payload).toSorted()).toEqual([
      "attachments",
      "metadata",
      "text",
      "unfurl_links",
      "unfurl_media",
    ]);
  });

  it("sets the top-level text to the empty string, exactly like the card, to avoid a duplicate body", () => {
    const payload = renderAssistantMessage({
      artifact: minimalArtifact(),
      chrome: CHROME,
      mentions: MENTIONS,
    });

    expect(payload.text).toBe("");
  });

  it("suppresses both unfurls, like the card", () => {
    const payload = renderAssistantMessage({
      artifact: minimalArtifact(),
      chrome: CHROME,
      mentions: MENTIONS,
    });

    expect(payload.unfurl_links).toBe(false);
    expect(payload.unfurl_media).toBe(false);
  });

  it("stamps metadata with a renderer distinct from the card's slack-card-v1", () => {
    const payload = renderAssistantMessage({
      artifact: minimalArtifact(),
      chrome: CHROME,
      mentions: MENTIONS,
    });

    expect(payload.metadata.event_payload.renderer).not.toBe("slack-card-v1");
    expect(payload.metadata.event_payload.renderer).toBe("slack-assistant-answer-v1");
  });

  it("carries a distinct, non-empty event_type", () => {
    const payload = renderAssistantMessage({
      artifact: minimalArtifact(),
      chrome: CHROME,
      mentions: MENTIONS,
    });

    expect(payload.metadata.event_type).toBe("slopweaver_assistant_answer_v1");
  });

  it("produces byte-identical output for the same artifact rendered twice", () => {
    const first = renderAssistantMessage({ artifact: richArtifact(), chrome: CHROME, mentions: MENTIONS });
    const second = renderAssistantMessage({ artifact: richArtifact(), chrome: CHROME, mentions: MENTIONS });

    expect(first).toEqual(second);
  });
});

describe("renderAssistantAskMessage — a thread-only draft rendered as a V2 answer", () => {
  it("stamps V2 metadata, even though its content is the old plain-artifact shape", () => {
    const payload = renderAssistantAskMessage({
      artifact: minimalArtifact(),
      askIdentity: THREAD_ONLY_ASK_IDENTITY,
      chrome: CHROME,
      mentions: MENTIONS,
    });

    expect(payload.metadata.event_payload.renderer).toBe("slack-assistant-answer-v2");
    expect(payload.metadata.event_type).toBe("slopweaver_assistant_answer_v2");
  });

  it("carries the thread-only askIdentity it was released against, never an invented exact one", () => {
    const payload = renderAssistantAskMessage({
      artifact: minimalArtifact(),
      askIdentity: THREAD_ONLY_ASK_IDENTITY,
      chrome: CHROME,
      mentions: MENTIONS,
    });

    expect(payload.metadata.event_payload.askIdentity).toEqual(THREAD_ONLY_ASK_IDENTITY);
  });

  it("carries an exact askIdentity through unaltered too, for a fresh card release", () => {
    const payload = renderAssistantAskMessage({
      artifact: minimalArtifact(),
      askIdentity: EXACT_ASK_IDENTITY,
      chrome: CHROME,
      mentions: MENTIONS,
    });

    expect(payload.metadata.event_payload.askIdentity).toEqual(EXACT_ASK_IDENTITY);
  });
});

describe("renderAssistantMessage — content is a PORT, not a rewrite", () => {
  it("renders the same lead block (TL;DR, primary link, index) the card wraps in block 2", () => {
    const message = renderAssistantMessage({ artifact: richArtifact(), chrome: CHROME, mentions: MENTIONS });
    const card = renderUpdateCard({
      artifact: richArtifact(),
      artifactFingerprint: "fp-1",
      chrome: CHROME,
      mentions: MENTIONS,
    });

    // Block 2 of the card is the lead block; the message now carries the same 5-block chrome prefix, so its
    // own lead block lands at the SAME index 2, not index 0.
    expect(message.attachments[0].blocks[2]).toEqual(card.attachments[0].blocks[2]);
  });

  it("renders the same detail sequence the card places below its chrome", () => {
    const message = renderAssistantMessage({ artifact: richArtifact(), chrome: CHROME, mentions: MENTIONS });
    const card = renderUpdateCard({
      artifact: richArtifact(),
      artifactFingerprint: "fp-1",
      chrome: CHROME,
      mentions: MENTIONS,
    });

    // Blocks 0-4 are the fixed chrome (author row, divider, lead, divider, detail label), now identical on
    // both; everything from index 5 is the detail sequence, also identical on both.
    expect(message.attachments[0].blocks.slice(5)).toEqual(card.attachments[0].blocks.slice(5));
  });

  it("carries every block the card does: chrome plus detail, nothing dropped and nothing added", () => {
    const message = renderAssistantMessage({ artifact: richArtifact(), chrome: CHROME, mentions: MENTIONS });
    const card = renderUpdateCard({
      artifact: richArtifact(),
      artifactFingerprint: "fp-1",
      chrome: CHROME,
      mentions: MENTIONS,
    });

    // The message's wrapper now carries the SAME blocks as the card's, full stop — that is the reversal.
    expect(message.attachments[0].blocks).toEqual(card.attachments[0].blocks);
  });
});
