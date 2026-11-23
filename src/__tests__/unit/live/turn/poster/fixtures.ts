/*
 * The pure fixtures every `liveTurnPoster` test file shares: the chrome, the provenance, the mentions and reply
 * an ask carries, the one shipped judgement, the smallest valid answer form with a verdict bound to it, and the
 * reader of a WARN-tier door refusal.
 */
import { expect } from "vitest";

import { type ReplyContext, whitelistJudgement } from "../../../../../admit/withhold.js";
import type { PostedMessage, UploadReadiness } from "../../../../../corpus/slack/writeTransport.js";
import type { Mention } from "../../../../../live/listen/mention.js";
import { answerDigestOf } from "../../../../../live/turn/poster.js";
import type { PostAnswerOutcome, TurnProvenance } from "../../../../../live/turn/run.js";
import type { AnswerFormAnswer } from "../../../../../outbound/assistant/answerForm.js";
import type { SlackCardChrome, TurnChrome } from "../../../../../outbound/slack/types.js";
import type { IdentityRosterSnapshot } from "../../../../../silver/identityRoster.js";

/**
 * What a WARN-tier door refusal said, off the outcome `postAnswer` now RESOLVES with rather than throws.
 *
 * Every gate exercised below fires at `warn` severity — a bar the answer has not cleared yet, each finding
 * carrying an override token and a correction — so the send comes back as the `retryable-refusal` arm, which
 * is what leaves the ask's dispatch record intact for a corrected second offer (`runContract.ts`'s
 * `AnswerSendRefusal`). A `hold` still throws, and so does this helper on any other arm, which is what keeps
 * an assertion over its message falsifiable. Its own `expect` pins the refusal CODE on all five paths.
 *
 * @param offered the in-flight send
 * @returns the refusal's own message, findings and corrections included
 */
export async function warnRefusal({ offered }: { offered: Promise<PostAnswerOutcome> }): Promise<string> {
  const outcome = await offered;
  if (outcome.kind !== "retryable-refusal") {
    throw new Error(`expected a warn-tier refusal, got ${outcome.kind}`);
  }
  // The CODE as well as the prose, on every path below: it is what `turn answer` branches on to exit the
  // retryable status rather than finalise the turn, so a message assertion alone would not hold it down.
  expect(outcome.refusal.code).toBe("ANSWER_SEND_WARN_REFUSED");
  return outcome.refusal.message;
}

export const CHROME: TurnChrome = {
  authorEmoji: ":robot_face:",
  authorLabel: "test-bot",
  bannerColor: "#8B5CF6",
  detailLabel: "*Details*",
  metadataEventType: "test_turn_v1",
};
const BANNER_COLOR = "#ABCDEF";
/** The card's full chrome — distinct from {@link CHROME} above, which is the narrower turn-message shape. */
export const CARD_CHROME: SlackCardChrome = {
  authorEmoji: ":robot_face:",
  authorLabel: "test-bot",
  bannerColor: BANNER_COLOR,
  detailLabel: "*Details*",
  metadataEventType: "test_card_v1",
};
export const PROVENANCE: TurnProvenance = { modelId: "claude -p" };
/** No roster row, so the card's asker names fall back to the Slack ids. */
export const NO_ROW: IdentityRosterSnapshot = { records: [], retiredFile: undefined, revision: null };
export const POSTED: PostedMessage = { channel: "C1", ts: "1700000000.000100" };
export const READY: UploadReadiness = { waitForFile: async () => ({ kind: "ready", polls: 1, waitedMs: 0 }) };

export const CHANNEL_MENTION: Mention = {
  channel: "C1",
  messageTs: "1700000000.000050",
  surface: "channel",
  text: "what changed?",
  threadTs: "1700000000.000000",
  userId: "U_ASKER",
};
export const DM_MENTION: Mention = { ...CHANNEL_MENTION, channel: "D1", surface: "dm" };
export const REPLY: ReplyContext = {
  askedBy: "U_ASKER",
  channel: "D1",
  draftTldr: "You have 3 open PRs.",
  question: "what changed?",
  surface: "dm",
};
/** The one shipped judgement, whitelisting exactly the asker every happy-path test uses. */
export const judge = whitelistJudgement({ openOverride: false, whitelist: { identities: ["U_ASKER"], kind: "list" } });

/**
 * The smallest valid answer form — content is not what the identity-guard tests below are about.
 *
 * @returns a fresh answer form leading with "You have 3 open PRs." and carrying nothing else
 */
export function minimalAnswer(): AnswerFormAnswer {
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

/**
 * A verdict that passes the reviewer gate for `minimalAnswer()`.
 *
 * Bound to the REAL digest via the exported helper rather than a literal: a fixed string would be refused
 * as stale the moment the answer fixture changed, and these tests are about the poster's other behaviours,
 * not about the gate. The gate's own refusals are covered in `admit/answerQualityGate.test.ts`.
 */
export const CLEAN_VERDICT = {
  answerDigest: answerDigestOf({ answer: minimalAnswer() }),
  authorSession: "worker-session",
  claims: [{ evidence: "the cited thread", impact: "high", support: "supported", text: "a checked claim" }],
  outcome: "clean",
  reviewerSession: "reviewer-session",
  schemaVersion: 1,
  // A reviewer that read the answer's authored fields against the operator's rules and found nothing. An
  // ABSENT `voice` is its own finding, so leaving it off here would make every case below assert two codes
  // while testing one; the voice half's own refusals live in `admit/answerQualityGate.test.ts`.
  voice: { pathsChecked: ["lead", "body"], rulesChecked: 3, violations: [] },
} as const;
