/**
 * FILTERED dropped-tag recovery — who asked, where, when, and whether a real answer or a registry already settles it.
 *
 * Pure, so every case is a plain call with no Slack in sight. The two that matter most are the exact-identity
 * trap (a `thread-only` answer record, or an exact answer to a DIFFERENT ask sharing this thread, must NOT read as
 * "we answered THIS one") and the acceptance case: a real colleague's tag that nobody replied to must come
 * back as recoverable. The ask-lifecycle exclusions are in `classifyLifecycle.test.ts`.
 */
import { describe, expect, it } from "vitest";

import type { RecordedAskIdentity } from "../../../../../live/ask/identity.js";
import { type IgnoredAsk, ignoredAskKey } from "../../../../../live/ask/ignore.js";
import type { IgnoredConversation } from "../../../../../live/ask/ignoredConversation.js";
import { askLifecycleKey, type TerminalAskLifecycleEvent } from "../../../../../live/ask/lifecycle.js";
import { classifyCandidate } from "../../../../../live/listen/recover.js";
import {
  BOT,
  CARD_EVENT_TYPE,
  classify,
  EXACT_ANSWER,
  NO_IGNORED_CONVERSATIONS,
  NO_IGNORES,
  NO_LIFECYCLES,
  NO_TERMINAL,
  SINCE,
  UNANSWERED,
} from "./fixtures.js";

describe("classifyCandidate", () => {
  it("recovers a real unanswered tag from a colleague", () => {
    const verdict = classify({});

    expect(verdict.exclusions).toEqual([]);
    expect(verdict.mention).toEqual({
      channel: "C_BOT",
      messageTs: "1785000000.000100",
      started: undefined,
      surface: "channel",
      text: "@(U_BOT) are the payment logs kept anywhere, and how far back?",
      threadTs: "1785000000.000100",
      userId: "U_ASKER",
    });
  });

  it("copies the candidate's own started checklist onto the recovered mention", () => {
    const started = { turnId: "turn-1", workingTs: "1785000000.000200" };
    expect(classify({ over: { started } }).mention?.started).toEqual(started);
  });

  it("excludes when a real answer's metadata names exactly this candidate", () => {
    expect(classify({ over: { threadAnswers: [EXACT_ANSWER] } }).exclusions).toEqual(["already-answered"]);
  });

  /**
   * The exact-identity trap, and the reason it is the sharpest test here.
   *
   * A `thread-only` record names no `messageTs`, so it cannot prove which of several asks sharing a thread it
   * resolved — treating it as proof for THIS candidate would silently drop every candidate sharing that
   * thread with a genuinely answered one.
   */
  it("does NOT treat a thread-only answer identity as proof, since it names no messageTs", () => {
    const threadOnly: RecordedAskIdentity = {
      channel: UNANSWERED.channel,
      quality: "thread-only",
      threadTs: UNANSWERED.threadTs,
    };
    expect(classify({ over: { threadAnswers: [threadOnly] } }).exclusions).toEqual([]);
  });

  /**
   * Two asks can share one thread root. An exact answer to the FIRST must not make the SECOND read as
   * answered too — the trap the old thread-membership test could not avoid.
   */
  it("does NOT treat an exact answer to a DIFFERENT ask sharing this thread as proof", () => {
    const otherAsk: RecordedAskIdentity = { ...EXACT_ANSWER, messageTs: "1785000000.000999" };
    expect(classify({ over: { threadAnswers: [otherAsk] } }).exclusions).toEqual([]);
  });

  it("excludes a tag older than the cutoff", () => {
    expect(classify({ over: { tsIso: "2026-07-20T00:00:00.000Z" } }).exclusions).toEqual(["too-old"]);
  });

  it("excludes a channel the bot does not answer in", () => {
    expect(classify({ over: { channel: "C_OTHER" } }).exclusions).toEqual(["wrong-place"]);
  });

  it("excludes a channel message that never tagged the bot", () => {
    expect(classify({ over: { rawText: "the bot should know this" } }).exclusions).toEqual(["not-addressed"]);
  });

  it("excludes a tag of somebody ELSE, which is what exact-match identity means here", () => {
    expect(classify({ over: { rawText: "<@U_OTHER> can you look?" } }).exclusions).toEqual(["not-addressed"]);
  });

  it("accepts the `<@U|display>` tag form Slack also emits", () => {
    expect(classify({ over: { rawText: `<@${BOT}|display-name> still there?` } }).exclusions).toEqual([]);
  });

  /**
   * dmRequiresMention, on the RECOVERY side. A sweep that still admitted an untagged DM would re-flag hours
   * later exactly the drafts the live parser refuses in the moment, so the two surfaces have to agree — and
   * they do by construction: both call `taggedIn` from `../listen/mention.ts`.
   */
  it("dmRequiresMention: excludes an untagged 1:1 DM, the same as an untagged channel message", () => {
    expect(
      classifyCandidate({
        allowedChannels: ["D_DM"],
        botUserId: BOT,
        cardEventType: CARD_EVENT_TYPE,
        candidate: { ...UNANSWERED, channel: "D_DM", rawText: "DRAFT 1/6: no tag here", surface: "dm" },
        ignored: NO_IGNORES,
        ignoredConversations: NO_IGNORED_CONVERSATIONS,
        lifecycles: NO_LIFECYCLES,
        since: SINCE,
        terminalByAsk: NO_TERMINAL,
      }).why,
    ).toEqual(["no explicit tag of the bot, and a direct message is only address when it tags"]);
  });

  it("dmRequiresMention: ACCEPTS a 1:1 DM that tags the bot, exactly as before the ruling", () => {
    expect(
      classifyCandidate({
        allowedChannels: ["D_DM"],
        botUserId: BOT,
        cardEventType: CARD_EVENT_TYPE,
        candidate: { ...UNANSWERED, channel: "D_DM", rawText: `<@${BOT}> what shipped?`, surface: "dm" },
        ignored: NO_IGNORES,
        ignoredConversations: NO_IGNORED_CONVERSATIONS,
        lifecycles: NO_LIFECYCLES,
        since: SINCE,
        terminalByAsk: NO_TERMINAL,
      }).exclusions,
    ).toEqual([]);
  });

  it("refuses a group DM even when tagged, because the owner lens has an audience there", () => {
    expect(classify({ over: { surface: "group" } }).exclusions).toEqual(["not-addressed"]);
  });

  it("refuses a message this install's own app authored, so a recovery pass never answers our own card", () => {
    expect(classify({ over: { selfAuthored: true } }).exclusions).toEqual(["not-addressed"]);
  });

  /**
   * Matches the live parser's own rule (`../listen/mention.ts`): a person speaking sends a message with NO
   * subtype, so refusing the whole class (an edit, join, deletion, thread broadcast) is what closes the
   * channel-invite false positive the owner was burned by before.
   */
  it("refuses ANY subtype, even in a tagged 1:1 DM that would otherwise be address", () => {
    expect(classify({ over: { rawText: `<@${BOT}> hi`, subtype: "channel_join", surface: "dm" } }).exclusions).toEqual([
      "not-addressed",
    ]);
  });

  it("names the exact subtype in the exclusion's own sentence", () => {
    const verdict = classify({ over: { subtype: "message_changed" } });

    expect(verdict.why[0]).toContain("message_changed");
  });

  it("excludes an ask the ask-lifecycle log already has a terminal event for, with no Slack metadata needed", () => {
    const terminal: TerminalAskLifecycleEvent = {
      answerTs: "1785000030.000100",
      channel: UNANSWERED.channel,
      kind: "answered",
      messageTs: UNANSWERED.messageTs,
      threadTs: UNANSWERED.threadTs,
      tsIso: SINCE,
    };
    const terminalByAsk: ReadonlyMap<string, TerminalAskLifecycleEvent> = new Map([
      [askLifecycleKey({ askIdentity: UNANSWERED }), terminal],
    ]);

    expect(classify({ terminalByAsk }).exclusions).toEqual(["terminal-lifecycle"]);
  });

  it("never excludes a DIFFERENT ask that merely shares the terminal one's channel", () => {
    const terminal: TerminalAskLifecycleEvent = {
      answerTs: "1785000030.000100",
      channel: UNANSWERED.channel,
      kind: "answered",
      messageTs: "9999999999.000000",
      threadTs: UNANSWERED.threadTs,
      tsIso: SINCE,
    };
    const terminalByAsk: ReadonlyMap<string, TerminalAskLifecycleEvent> = new Map([
      [askLifecycleKey({ askIdentity: { ...UNANSWERED, messageTs: "9999999999.000000" } }), terminal],
    ]);

    expect(classify({ terminalByAsk }).exclusions).toEqual([]);
  });

  /**
   * Every applying exclusion is reported, not just the first.
   *
   * A tag excluded as "too old" that was ALSO already answered is a different situation from one that is
   * merely stale, and collapsing the two hides the thing an operator is checking.
   */
  it("reports every exclusion that applies, in test order", () => {
    const verdict = classify({
      over: {
        channel: "C_OTHER",
        rawText: "no tag",
        threadAnswers: [
          { channel: "C_OTHER", messageTs: UNANSWERED.messageTs, quality: "exact", threadTs: UNANSWERED.threadTs },
        ],
        tsIso: "2026-01-01T00:00:00.000Z",
      },
    });

    expect(verdict.exclusions).toEqual(["not-addressed", "wrong-place", "already-answered", "too-old"]);
    expect(verdict.why.length).toBe(4);
  });

  it("carries no mention when anything excluded it", () => {
    expect(classify({ over: { tsIso: "2020-01-01T00:00:00.000Z" } }).mention).toBe(undefined);
  });

  /**
   * `slopweaver turn ignore`'s own registry, checked the same way every other entrance checks it — never
   * confused with `already-answered`, which is about a REAL reply, not a standing "don't ask again".
   */
  it("excludes a candidate the permanent ignore registry names, by exact (channel, messageTs)", () => {
    const entry: IgnoredAsk = {
      channel: UNANSWERED.channel,
      ignoredAtIso: SINCE,
      messageTs: UNANSWERED.messageTs,
      reason: "n/a",
      schemaVersion: 1,
    };
    const ignored: ReadonlyMap<string, IgnoredAsk> = new Map([[ignoredAskKey({ askIdentity: entry }), entry]]);
    expect(classify({ ignored }).exclusions).toEqual(["deliberately-ignored"]);
  });

  it("never excludes a DIFFERENT ask that merely shares the ignored one's channel", () => {
    const entry: IgnoredAsk = {
      channel: UNANSWERED.channel,
      ignoredAtIso: SINCE,
      messageTs: "9999999999.000000",
      reason: "n/a",
      schemaVersion: 1,
    };
    const ignored: ReadonlyMap<string, IgnoredAsk> = new Map([[ignoredAskKey({ askIdentity: entry }), entry]]);
    expect(classify({ ignored }).exclusions).toEqual([]);
  });

  /**
   * `slopweaver turn ignore-conversation`'s registry — the channel-keyed sibling checked the same way as
   * `deliberately-ignored`, but suppressing EVERY message in the channel rather than one exact ts.
   */
  it("excludes a candidate a permanently-ignored CONVERSATION owns, even though this exact message was never named", () => {
    const ignoredConversations: ReadonlyMap<string, IgnoredConversation> = new Map([
      [
        UNANSWERED.channel,
        { channel: UNANSWERED.channel, ignoredAtIso: SINCE, kind: "ignore", reason: "n/a", schemaVersion: 1 },
      ],
    ]);
    expect(classify({ ignoredConversations }).exclusions).toEqual(["deliberately-ignored-conversation"]);
  });

  it("never excludes a candidate in a DIFFERENT, non-ignored channel", () => {
    const ignoredConversations: ReadonlyMap<string, IgnoredConversation> = new Map([
      ["C_UNRELATED", { channel: "C_UNRELATED", ignoredAtIso: SINCE, kind: "ignore", reason: "n/a", schemaVersion: 1 }],
    ]);
    expect(classify({ ignoredConversations }).exclusions).toEqual([]);
  });
});
