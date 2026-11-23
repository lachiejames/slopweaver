/**
 * The permanent-ignore exclusions for one recovery candidate, exercised directly — the ask's own registry
 * entry first, then its whole conversation, in that order.
 */
import { describe, expect, it } from "vitest";

import { type IgnoredAsk, ignoredAskKey } from "../../../../live/ask/ignore.js";
import type { IgnoredConversation } from "../../../../live/ask/ignoredConversation.js";
import type { RecoveryCandidate } from "../../../../live/listen/recover.js";
import { ignoreExclusions } from "../../../../live/listen/recoverIgnores.js";

const SINCE = "2026-08-01T00:00:00.000Z";

const CANDIDATE: RecoveryCandidate = {
  channel: "C_BOT",
  messageTs: "1785000000.000100",
  rawText: "<@U_BOT> are the payment logs kept anywhere?",
  selfAuthored: false,
  surface: "channel",
  threadAnswers: [],
  threadMarks: [],
  threadTs: "1785000000.000100",
  tsIso: "2026-08-05T13:26:00.000Z",
  userId: "U_ASKER",
};

const ASK_ENTRY: IgnoredAsk = {
  channel: CANDIDATE.channel,
  ignoredAtIso: SINCE,
  messageTs: CANDIDATE.messageTs,
  reason: "n/a",
  schemaVersion: 1,
};

const CONVERSATION_ENTRY: IgnoredConversation = {
  channel: CANDIDATE.channel,
  ignoredAtIso: SINCE,
  kind: "ignore",
  reason: "n/a",
  schemaVersion: 1,
};

describe("ignoreExclusions", () => {
  it("returns nothing when neither registry names the candidate", () => {
    const result = ignoreExclusions({ candidate: CANDIDATE, ignored: new Map(), ignoredConversations: new Map() });
    expect(result).toEqual({ exclusions: [], why: [] });
  });

  it("names the exact ask when its own registry entry exists", () => {
    const ignored: ReadonlyMap<string, IgnoredAsk> = new Map([[ignoredAskKey({ askIdentity: ASK_ENTRY }), ASK_ENTRY]]);
    const result = ignoreExclusions({ candidate: CANDIDATE, ignored, ignoredConversations: new Map() });
    expect(result).toEqual({
      exclusions: ["deliberately-ignored"],
      why: ["`slopweaver turn ignore` was run for exactly this ask (C_BOT, 1785000000.000100)"],
    });
  });

  it("names the whole conversation when its channel is ignored", () => {
    const ignoredConversations: ReadonlyMap<string, IgnoredConversation> = new Map([
      [CANDIDATE.channel, CONVERSATION_ENTRY],
    ]);
    const result = ignoreExclusions({ candidate: CANDIDATE, ignored: new Map(), ignoredConversations });
    expect(result).toEqual({
      exclusions: ["deliberately-ignored-conversation"],
      why: ["`slopweaver turn ignore-conversation` was run for this whole conversation (C_BOT)"],
    });
  });

  it("reports the ask first and the conversation second when both apply", () => {
    const ignored: ReadonlyMap<string, IgnoredAsk> = new Map([[ignoredAskKey({ askIdentity: ASK_ENTRY }), ASK_ENTRY]]);
    const ignoredConversations: ReadonlyMap<string, IgnoredConversation> = new Map([
      [CANDIDATE.channel, CONVERSATION_ENTRY],
    ]);
    const result = ignoreExclusions({ candidate: CANDIDATE, ignored, ignoredConversations });
    expect(result.exclusions).toEqual(["deliberately-ignored", "deliberately-ignored-conversation"]);
  });
});
