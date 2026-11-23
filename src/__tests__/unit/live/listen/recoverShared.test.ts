/**
 * The scoring both sweep phases share — the permanent-exclusion verdict, reply-row conversion and the
 * checkpoint arithmetic after a read. Pure, so every case is a plain call.
 */
import { describe, expect, it } from "vitest";

import { exactRecordedAskIdentity } from "../../../../live/ask/identity.js";
import { UNREAD_THREAD } from "../../../../live/listen/recover.js";
import {
  checkpointAfterRead,
  goneThread,
  permanentExclusion,
  repliesToCandidates,
} from "../../../../live/listen/recoverShared.js";
import { SlackPageErrors } from "../../../../live/slack/errors.js";

describe("permanentExclusion", () => {
  it("calls a not_in_channel thread read a standing membership fact, never a coverage failure", () => {
    const exclusion = permanentExclusion({ channel: "C1", error: SlackPageErrors.notInChannel({ channel: "C1" }) });

    expect(exclusion).toEqual({ channel: "C1", reason: "not-a-member" });
  });

  it("calls a channel_not_found read a gone channel", () => {
    const error = SlackPageErrors.channelNotFound({ channel: "C1", reason: "history" });

    expect(permanentExclusion({ channel: "C1", error })).toEqual({ channel: "C1", reason: "gone" });
  });

  it("leaves a retryable failure unexcluded, so the sweep reports itself incomplete", () => {
    const error = SlackPageErrors.pageFetchFailed({ cause: new Error("rate limited"), context: "history C1" });

    expect(permanentExclusion({ channel: "C1", error })).toBe(undefined);
  });

  it("leaves a deleted thread to goneThread — the channel it sits in still reads", () => {
    const error = SlackPageErrors.threadNotFound({ channel: "C1", threadTs: "1790136092.273509" });

    expect(permanentExclusion({ channel: "C1", error })).toBe(undefined);
  });
});

describe("goneThread", () => {
  it("calls a thread_not_found read a gone thread, scoped to that one root", () => {
    const error = SlackPageErrors.threadNotFound({ channel: "C0SYN000004", threadTs: "1790136092.273509" });

    expect(goneThread({ channel: "C0SYN000004", error, threadTs: "1790136092.273509" })).toEqual({
      channel: "C0SYN000004",
      threadTs: "1790136092.273509",
    });
  });

  it("leaves a channel-level answer to permanentExclusion", () => {
    const error = SlackPageErrors.notInChannel({ channel: "C1" });

    expect(goneThread({ channel: "C1", error, threadTs: "1790136092.273509" })).toBe(undefined);
  });

  it("leaves a retryable failure a failure", () => {
    const error = SlackPageErrors.pageFetchFailed({ cause: new Error("rate limited"), context: "reading thread" });

    expect(goneThread({ channel: "C1", error, threadTs: "1790136092.273509" })).toBe(undefined);
  });
});

describe("checkpointAfterRead", () => {
  it("advances the cursor to the newest reply ts the read saw", () => {
    const checkpoint = checkpointAfterRead({
      checkedAtIso: "2026-09-21T02:00:00.000Z",
      currentCursorTs: "1789000000.000100",
      rows: [{ ts: "1789000000.000200" }, { ts: "1789000000.000300" }],
    });

    expect(checkpoint).toEqual({ cursorTs: "1789000000.000300", lastCheckedAtIso: "2026-09-21T02:00:00.000Z" });
  });

  it("normalises the never-checked `0` sentinel to a well-formed Slack ts when a read finds nothing", () => {
    const checkpoint = checkpointAfterRead({
      checkedAtIso: "2026-09-21T02:00:00.000Z",
      currentCursorTs: "0",
      rows: [],
    });

    expect(checkpoint).toEqual({ cursorTs: "0.000000", lastCheckedAtIso: "2026-09-21T02:00:00.000Z" });
  });

  it("never moves the cursor backwards for an out-of-order row", () => {
    const checkpoint = checkpointAfterRead({
      checkedAtIso: "2026-09-21T02:00:00.000Z",
      currentCursorTs: "1789000000.000500",
      rows: [{ ts: "1789000000.000200" }],
    });

    expect(checkpoint.cursorTs).toBe("1789000000.000500");
  });

  it("ignores a row that is not a record carrying a string ts", () => {
    const checkpoint = checkpointAfterRead({
      checkedAtIso: "2026-09-21T02:00:00.000Z",
      currentCursorTs: "1789000000.000100",
      rows: ["not a record", { ts: 17890000 }, { text: "no ts" }],
    });

    expect(checkpoint.cursorTs).toBe("1789000000.000100");
  });
});

describe("repliesToCandidates", () => {
  it("turns a reply tagging the bot into a candidate carrying its own channel and ts", () => {
    const candidates = repliesToCandidates({
      channel: "C1",
      replyRows: [{ text: "<@U_BOT> hello", thread_ts: "1789000000.000100", ts: "1789000000.000200", user: "U_ASKER" }],
      selfBotId: undefined,
      surface: "channel",
      evidence: UNREAD_THREAD,
    });

    expect(candidates.length).toBe(1);
    expect(candidates[0]!.channel).toBe("C1");
    expect(candidates[0]!.messageTs).toBe("1789000000.000200");
  });

  it("drops a row that produces no candidate at all, keeping the rows' own order for the rest", () => {
    const candidates = repliesToCandidates({
      channel: "C1",
      replyRows: [
        "not a record",
        { text: "<@U_BOT> first", thread_ts: "1789000000.000100", ts: "1789000000.000200", user: "U_ASKER" },
        { text: "<@U_BOT> second", thread_ts: "1789000000.000100", ts: "1789000000.000300", user: "U_ASKER" },
      ],
      selfBotId: undefined,
      surface: "channel",
      evidence: UNREAD_THREAD,
    });

    expect(candidates.map((candidate) => candidate.messageTs)).toEqual(["1789000000.000200", "1789000000.000300"]);
  });

  it("returns nothing for no rows", () => {
    expect(
      repliesToCandidates({
        channel: "C1",
        replyRows: [],
        selfBotId: undefined,
        surface: "channel",
        evidence: UNREAD_THREAD,
      }),
    ).toEqual([]);
  });

  it("carries BOTH halves of the one thread read's evidence onto every candidate it produces", () => {
    const evidence = {
      answers: [
        exactRecordedAskIdentity({
          askIdentity: { channel: "C1", messageTs: "1789000000.000050", threadTs: "1789000000.000100" },
        }),
      ],
      marks: [
        {
          hasSubtype: false,
          metadataEventType: undefined,
          selfAuthoredReason: undefined,
          text: "<@U_BOT> hello",
          ts: "1789000000.000200",
          userId: "U_ASKER",
        },
      ],
    };

    const candidates = repliesToCandidates({
      channel: "C1",
      evidence,
      replyRows: [
        { text: "<@U_BOT> first", thread_ts: "1789000000.000100", ts: "1789000000.000200", user: "U_ASKER" },
        { text: "<@U_BOT> second", thread_ts: "1789000000.000100", ts: "1789000000.000300", user: "U_ASKER" },
      ],
      selfBotId: undefined,
      surface: "channel",
    });

    expect(candidates.map((candidate) => candidate.threadAnswers)).toEqual([evidence.answers, evidence.answers]);
    expect(candidates.map((candidate) => candidate.threadMarks)).toEqual([evidence.marks, evidence.marks]);
  });
});
