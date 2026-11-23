/**
 * The BOUNDED PROOF for H6: two asks sharing one thread stay distinct all the way through capture, the
 * brief round trip, the door request, a V2 answer's metadata, and the completion it settles into.
 *
 * Deliberately narrow. This does NOT call `judgeRouting` and does NOT assert anything about recovery
 * classification (H5's offline eval and H9's future classifier are both out of scope) — it proves only that
 * the exact identity survives the pipeline unaltered, never reconstructed from the thread it happens to
 * share with another ask.
 */
import { describe, expect, it } from "vitest";

import { mentionFromBrief } from "../../../../cli/commands/turn/run.js";
import { unwrap } from "../../../../lib/result.js";
import { askIdentityOf, exactRecordedAskIdentity, sameAskIdentity } from "../../../../live/ask/identity.js";
import { parseAppMention } from "../../../../live/listen/mention.js";
import { buildTurnRoutingBrief, renderTurnRoutingBrief } from "../../../../live/turn/brief.js";
import { parseAnswerableBrief } from "../../../../live/turn/briefAnswerable.js";
import { defaultBriefPath } from "../../../../live/turn/briefStore.js";
import { turnCompletionFromOutcome } from "../../../../live/turn/envelope.js";
import type { RoutingJudgementInput } from "../../../../live/turn/judgement.js";
import { turnDoorRequest } from "../../../../live/turn/poster.js";
import type { AnswerFormAnswer } from "../../../../outbound/assistant/answerForm.js";
import { renderAssistantAnswer } from "../../../../outbound/assistant/answerMessage.js";
import type { SlackCardChrome } from "../../../../outbound/slack/types.js";

/** Neutral chrome — never a real operator's bot name; this repo is public. */
const CHROME: SlackCardChrome = {
  authorEmoji: ":robot_face:",
  authorLabel: "test-bot",
  bannerColor: "#ABCDEF",
  detailLabel: "*Details*",
  metadataEventType: "test_card_v1",
};

const ROUTING_INPUT: RoutingJudgementInput = {
  availableCapabilities: [],
  context: {
    controlPlane: { ownerAddressingText: "placeholder", structuralMetadata: [] },
    quotedEvidence: [],
  },
  execution: { mode: "single-turn", supervisorHost: "claude-code" },
};

/** Two real app_mention events, both threaded into the SAME root, at two different addressing timestamps. */
const FIRST_EVENT = {
  channel: "C_SHARED",
  text: "<@U0BOT> what did we decide about the renderer?",
  thread_ts: "1785000000.000100",
  ts: "1785000000.000200",
  type: "app_mention",
  user: "U_ASKER",
};

const SECOND_EVENT = {
  channel: "C_SHARED",
  text: "<@U0BOT> and what about the fallback?",
  thread_ts: "1785000000.000100",
  ts: "1785000000.000300",
  type: "app_mention",
  user: "U_ASKER",
};

/** A minimal valid answer, shared by both asks — content is not what this proof is about. */
function answer(): AnswerFormAnswer {
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
    lead: "You have 3 open PRs.",
    measurements: [],
  };
}

describe("two asks in one thread stay distinct through the whole pipeline", () => {
  it("captures two distinct mentions from the same thread, differing only in messageTs", () => {
    const first = unwrap(parseAppMention({ event: FIRST_EVENT, selfBotId: undefined }));
    const second = unwrap(parseAppMention({ event: SECOND_EVENT, selfBotId: undefined }));

    expect(first.threadTs).toBe(second.threadTs);
    expect(first.messageTs).not.toBe(second.messageTs);
  });

  it("briefs each ask to its own file path, keyed by the addressing message rather than the shared thread", () => {
    const first = unwrap(parseAppMention({ event: FIRST_EVENT, selfBotId: undefined }));
    const second = unwrap(parseAppMention({ event: SECOND_EVENT, selfBotId: undefined }));

    const firstPath = defaultBriefPath({ askIdentity: askIdentityOf({ source: first }), home: "/state" });
    const secondPath = defaultBriefPath({ askIdentity: askIdentityOf({ source: second }), home: "/state" });

    expect(firstPath).not.toBe(secondPath);
  });

  it("round-trips each brief through disk, rebuilding a mention with the SAME exact identity it started with", () => {
    for (const event of [FIRST_EVENT, SECOND_EVENT]) {
      const mention = unwrap(parseAppMention({ event, selfBotId: undefined }));
      const written = buildTurnRoutingBrief({
        channel: mention.channel,
        messageTs: mention.messageTs,
        question: mention.text,
        routingInput: ROUTING_INPUT,
        surface: mention.surface,
        threadTs: mention.threadTs,
        unavailableCapabilities: [],
        userId: mention.userId,
      });

      const read = unwrap(parseAnswerableBrief({ raw: JSON.parse(JSON.stringify(written)) }));
      const rebuilt = mentionFromBrief({ brief: read });

      expect(
        sameAskIdentity({ left: askIdentityOf({ source: rebuilt }), right: askIdentityOf({ source: mention }) }),
      ).toBe(true);
    }
  });

  it("never lets one ask's brief round-trip to the OTHER ask's identity, despite sharing a thread", () => {
    const first = unwrap(parseAppMention({ event: FIRST_EVENT, selfBotId: undefined }));
    const second = unwrap(parseAppMention({ event: SECOND_EVENT, selfBotId: undefined }));
    const written = buildTurnRoutingBrief({
      channel: first.channel,
      messageTs: first.messageTs,
      question: first.text,
      routingInput: ROUTING_INPUT,
      surface: first.surface,
      threadTs: first.threadTs,
      unavailableCapabilities: [],
      userId: first.userId,
    });
    const rebuilt = mentionFromBrief({
      brief: unwrap(parseAnswerableBrief({ raw: JSON.parse(JSON.stringify(written)) })),
    });

    expect(
      sameAskIdentity({ left: askIdentityOf({ source: rebuilt }), right: askIdentityOf({ source: second }) }),
    ).toBe(false);
  });

  it("renders the brief itself carrying the addressing message separately from the shared thread", () => {
    const first = unwrap(parseAppMention({ event: FIRST_EVENT, selfBotId: undefined }));
    const brief = buildTurnRoutingBrief({
      channel: first.channel,
      messageTs: first.messageTs,
      question: first.text,
      routingInput: ROUTING_INPUT,
      surface: first.surface,
      threadTs: first.threadTs,
      unavailableCapabilities: [],
      userId: first.userId,
    });
    const text = renderTurnRoutingBrief({
      brief,
      briefPath: "/tmp/b.json",
      tagTree: [],
    }).join("\n");

    expect(text).toContain(`addressing message: ${first.messageTs}`);
    expect(text).toContain(`thread: ${first.threadTs}`);
  });

  it("carries each ask's exact identity into its own door request, never the other ask's", () => {
    const first = unwrap(parseAppMention({ event: FIRST_EVENT, selfBotId: undefined }));
    const second = unwrap(parseAppMention({ event: SECOND_EVENT, selfBotId: undefined }));

    const firstRequest = turnDoorRequest({
      askIdentity: askIdentityOf({ source: first }),
      home: "/state",
      turnId: "turn-1",
      verb: "answer",
    });
    const secondRequest = turnDoorRequest({
      askIdentity: askIdentityOf({ source: second }),
      home: "/state",
      turnId: "turn-2",
      verb: "answer",
    });

    expect(firstRequest.artifact["askIdentity"]).toEqual(askIdentityOf({ source: first }));
    expect(secondRequest.artifact["askIdentity"]).toEqual(askIdentityOf({ source: second }));
    expect(firstRequest.artifact["askIdentity"]).not.toEqual(secondRequest.artifact["askIdentity"]);
  });

  it("stamps each ask's OWN askIdentity into its V2 answer metadata, distinguishable despite the shared thread", () => {
    const first = unwrap(parseAppMention({ event: FIRST_EVENT, selfBotId: undefined }));
    const second = unwrap(parseAppMention({ event: SECOND_EVENT, selfBotId: undefined }));

    const firstPayload = renderAssistantAnswer({
      answer: answer(),
      askIdentity: exactRecordedAskIdentity({ askIdentity: askIdentityOf({ source: first }) }),
      chrome: CHROME,
      mentions: { groups: new Map(), people: new Map() },
    });
    const secondPayload = renderAssistantAnswer({
      answer: answer(),
      askIdentity: exactRecordedAskIdentity({ askIdentity: askIdentityOf({ source: second }) }),
      chrome: CHROME,
      mentions: { groups: new Map(), people: new Map() },
    });

    expect(firstPayload.metadata.event_payload.askIdentity).toEqual({
      ...askIdentityOf({ source: first }),
      quality: "exact",
    });
    expect(secondPayload.metadata.event_payload.askIdentity).toEqual({
      ...askIdentityOf({ source: second }),
      quality: "exact",
    });
    expect(firstPayload.metadata.event_payload.askIdentity).not.toEqual(
      secondPayload.metadata.event_payload.askIdentity,
    );
  });

  it("folds each ask into its OWN completion, carrying its own askIdentity through to the durable record", () => {
    const first = unwrap(parseAppMention({ event: FIRST_EVENT, selfBotId: undefined }));
    const second = unwrap(parseAppMention({ event: SECOND_EVENT, selfBotId: undefined }));

    const firstCompletion = turnCompletionFromOutcome({
      askIdentity: askIdentityOf({ source: first }),
      outcome: { answered: true, answerTs: "1785000000.000400", workingTs: "1785000000.000250" },
      provenance: { modelId: "claude-sonnet-5" },
      turnId: "turn-1",
    });
    const secondCompletion = turnCompletionFromOutcome({
      askIdentity: askIdentityOf({ source: second }),
      outcome: { answered: true, answerTs: "1785000000.000500", workingTs: "1785000000.000350" },
      provenance: { modelId: "claude-sonnet-5" },
      turnId: "turn-2",
    });

    expect(firstCompletion.isOk()).toBe(true);
    expect(secondCompletion.isOk()).toBe(true);
    expect(firstCompletion.isOk() ? firstCompletion.value.askIdentity : "not folded").toEqual(
      askIdentityOf({ source: first }),
    );
    expect(secondCompletion.isOk() ? secondCompletion.value.askIdentity : "not folded").toEqual(
      askIdentityOf({ source: second }),
    );
    expect(
      firstCompletion.isOk() && secondCompletion.isOk()
        ? sameAskIdentity({ left: firstCompletion.value.askIdentity, right: secondCompletion.value.askIdentity })
        : "not folded",
    ).toBe(false);
  });
});
