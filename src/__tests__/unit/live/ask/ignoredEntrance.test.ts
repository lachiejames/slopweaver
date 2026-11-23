/**
 * The combined ask/conversation ignore verdict every entrance now asks instead of checking two registries by
 * hand.
 */
import { describe, expect, it } from "vitest";

import { foldIgnoredAsks, type IgnoredAsk } from "../../../../live/ask/ignore.js";
import { foldIgnoredConversations, type IgnoredConversation } from "../../../../live/ask/ignoredConversation.js";
import { ignoredEntranceVerdict } from "../../../../live/ask/ignoredEntrance.js";

const ASK_IDENTITY = { channel: "C1", messageTs: "1785000000.000100" };

const IGNORED_ASK: IgnoredAsk = {
  channel: ASK_IDENTITY.channel,
  ignoredAtIso: "2026-08-12T00:00:00.000Z",
  messageTs: ASK_IDENTITY.messageTs,
  reason: "already resolved elsewhere",
  schemaVersion: 1,
};

const IGNORED_CONVERSATION: IgnoredConversation = {
  channel: ASK_IDENTITY.channel,
  ignoredAtIso: "2026-08-31T22:40:00.000Z",
  kind: "ignore",
  reason: "the owner said every tag in their own DM is ignorable",
  schemaVersion: 1,
};

const NO_ASKS: ReadonlyMap<string, IgnoredAsk> = new Map();
const NO_CONVERSATIONS: ReadonlyMap<string, IgnoredConversation> = new Map();

describe("ignoredEntranceVerdict", () => {
  it("reports undefined when neither registry names this ask", () => {
    expect(
      ignoredEntranceVerdict({
        askIdentity: ASK_IDENTITY,
        ignoredAsks: NO_ASKS,
        ignoredConversations: NO_CONVERSATIONS,
      }),
    ).toBeUndefined();
  });

  it("reports the ask-level entry when only the exact ask is ignored", () => {
    const verdict = ignoredEntranceVerdict({
      askIdentity: ASK_IDENTITY,
      ignoredAsks: foldIgnoredAsks({ entries: [IGNORED_ASK] }),
      ignoredConversations: NO_CONVERSATIONS,
    });

    expect(verdict).toEqual({ entry: IGNORED_ASK, kind: "ask" });
  });

  it("reports the conversation-level entry when only the channel is ignored", () => {
    const verdict = ignoredEntranceVerdict({
      askIdentity: ASK_IDENTITY,
      ignoredAsks: NO_ASKS,
      ignoredConversations: foldIgnoredConversations({ entries: [IGNORED_CONVERSATION] }),
    });

    expect(verdict).toEqual({ entry: IGNORED_CONVERSATION, kind: "conversation" });
  });

  it("prefers the ask-level entry when both registries would suppress it", () => {
    const verdict = ignoredEntranceVerdict({
      askIdentity: ASK_IDENTITY,
      ignoredAsks: foldIgnoredAsks({ entries: [IGNORED_ASK] }),
      ignoredConversations: foldIgnoredConversations({ entries: [IGNORED_CONVERSATION] }),
    });

    expect(verdict?.kind).toBe("ask");
  });

  it("a DIFFERENT ask in the same ignored conversation is still suppressed, by the conversation entry", () => {
    const otherAsk = { channel: ASK_IDENTITY.channel, messageTs: "9999999999.000000" };

    const verdict = ignoredEntranceVerdict({
      askIdentity: otherAsk,
      ignoredAsks: foldIgnoredAsks({ entries: [IGNORED_ASK] }),
      ignoredConversations: foldIgnoredConversations({ entries: [IGNORED_CONVERSATION] }),
    });

    expect(verdict).toEqual({ entry: IGNORED_CONVERSATION, kind: "conversation" });
  });

  it("a non-suppressed channel is untouched — the same ask in a DIFFERENT channel is not ignored", () => {
    const verdict = ignoredEntranceVerdict({
      askIdentity: { channel: "C_UNRELATED", messageTs: ASK_IDENTITY.messageTs },
      ignoredAsks: NO_ASKS,
      ignoredConversations: foldIgnoredConversations({ entries: [IGNORED_CONVERSATION] }),
    });

    expect(verdict).toBeUndefined();
  });

  it("an unignored conversation no longer suppresses a fresh ask in it", () => {
    const unignore: IgnoredConversation = { ...IGNORED_CONVERSATION, kind: "unignore" };

    const verdict = ignoredEntranceVerdict({
      askIdentity: ASK_IDENTITY,
      ignoredAsks: NO_ASKS,
      ignoredConversations: foldIgnoredConversations({ entries: [IGNORED_CONVERSATION, unignore] }),
    });

    expect(verdict).toBeUndefined();
  });
});
