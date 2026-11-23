/**
 * FILTERED dropped-tag recovery — the per-pass tally: every exclusion counted, a zero reported rather than omitted,
 * and a fresh tally for each pass.
 */
import { describe, expect, it } from "vitest";

import { recoveryReport } from "../../../../../live/listen/recover.js";
import { zeroExclusionCounts } from "../../../../../live/listen/recoverExclusionCounts.js";
import {
  BOT,
  CARD_EVENT_TYPE,
  NO_IGNORED_CONVERSATIONS,
  NO_IGNORES,
  NO_LIFECYCLES,
  NO_TERMINAL,
  SINCE,
  UNANSWERED,
} from "./fixtures.js";

describe("recoveryReport", () => {
  it("tallies each exclusion and returns only the recoverable ones", () => {
    const report = recoveryReport({
      allowedChannels: ["C_BOT"],
      botUserId: BOT,
      cardEventType: CARD_EVENT_TYPE,
      candidates: [
        UNANSWERED,
        {
          ...UNANSWERED,
          messageTs: "2",
          threadAnswers: [
            { channel: UNANSWERED.channel, messageTs: "2", quality: "exact", threadTs: UNANSWERED.threadTs },
          ],
        },
        { ...UNANSWERED, channel: "C_OTHER2", messageTs: "3" },
      ],
      ignored: NO_IGNORES,
      ignoredConversations: NO_IGNORED_CONVERSATIONS,
      lifecycles: NO_LIFECYCLES,
      since: SINCE,
      terminalByAsk: NO_TERMINAL,
    });

    expect(report.recoverable.length).toBe(1);
    expect(report.excludedBy).toEqual({
      "already-answered": 1,
      "already-resolved": 0,
      "already-worked": 0,
      "answered-in-thread": 0,
      "deliberately-ignored": 0,
      "deliberately-ignored-conversation": 0,
      "blocked-on-human": 0,
      "in-flight": 0,
      "not-addressed": 0,
      "terminal-lifecycle": 0,
      "too-old": 0,
      "wrong-place": 1,
    });
  });

  it("reports zero for an exclusion nothing tripped, rather than omitting it", () => {
    const report = recoveryReport({
      allowedChannels: ["C_BOT"],
      botUserId: BOT,
      cardEventType: CARD_EVENT_TYPE,
      candidates: [],
      ignored: NO_IGNORES,
      ignoredConversations: NO_IGNORED_CONVERSATIONS,
      lifecycles: NO_LIFECYCLES,
      since: SINCE,
      terminalByAsk: NO_TERMINAL,
    });

    expect(report.excludedBy["too-old"]).toBe(0);
    expect(report.verdicts).toEqual([]);
  });
});

describe("zeroExclusionCounts", () => {
  it("opens with every exclusion present at zero, so a missing key is never read as a zero count", () => {
    expect(zeroExclusionCounts()).toEqual({
      "already-answered": 0,
      "already-resolved": 0,
      "already-worked": 0,
      "answered-in-thread": 0,
      "blocked-on-human": 0,
      "deliberately-ignored": 0,
      "deliberately-ignored-conversation": 0,
      "in-flight": 0,
      "not-addressed": 0,
      "terminal-lifecycle": 0,
      "too-old": 0,
      "wrong-place": 0,
    });
  });

  it("hands back a fresh tally each call, so one pass's counts never leak into the next", () => {
    const first = zeroExclusionCounts();
    first["too-old"] += 1;

    expect(zeroExclusionCounts()["too-old"]).toBe(0);
    expect(first["too-old"]).toBe(1);
  });
});
