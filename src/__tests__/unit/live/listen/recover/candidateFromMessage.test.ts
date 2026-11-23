/**
 * Dropped-tag recovery's readers — a raw history message into a candidate, a channel's metadata into its surface,
 * and a Slack `ts` into an instant. Pure, so every case is a plain call with no Slack in sight.
 */
import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../../../lib/result.js";
import { candidateFromMessage, tsToIso, UNREAD_THREAD } from "../../../../../live/listen/recover.js";
import { candidateSurfaceFromChannel } from "../../../../../live/listen/recoverScan.js";

describe("candidateFromMessage", () => {
  it("reads a raw history message into a candidate", () => {
    const candidate = candidateFromMessage({
      channel: "C1",
      evidence: {
        answers: [{ channel: "C1", messageTs: "1785000000.000100", quality: "exact", threadTs: "1785000000.000100" }],
        marks: [],
      },
      message: { text: "hi", ts: "1785000000.000100", user: "U1" },
      selfBotId: undefined,
      surface: "channel",
    });

    expect(candidate).toEqual({
      channel: "C1",
      messageTs: "1785000000.000100",
      rawText: "hi",
      selfAuthored: false,
      surface: "channel",
      threadAnswers: [
        { channel: "C1", messageTs: "1785000000.000100", quality: "exact", threadTs: "1785000000.000100" },
      ],
      threadMarks: [],
      threadTs: "1785000000.000100",
      tsIso: "2026-07-25T17:20:00.000Z",
      userId: "U1",
    });
  });

  it("threads on thread_ts when the message was already in a thread", () => {
    const candidate = candidateFromMessage({
      channel: "C1",
      evidence: UNREAD_THREAD,
      message: { thread_ts: "1785000000.000001", ts: "1785000000.000100", user: "U1" },
      selfBotId: undefined,
      surface: "channel",
    });

    expect(candidate!.threadTs).toBe("1785000000.000001");
  });

  it("retains subtype, when the raw message carries one", () => {
    const candidate = candidateFromMessage({
      channel: "C1",
      evidence: UNREAD_THREAD,
      message: { subtype: "channel_join", ts: "1785000000.000100", user: "U1" },
      selfBotId: undefined,
      surface: "channel",
    });

    expect(candidate!.subtype).toBe("channel_join");
  });

  it("omits subtype entirely for an ordinary message that carries none", () => {
    const candidate = candidateFromMessage({
      channel: "C1",
      evidence: UNREAD_THREAD,
      message: { text: "hi", ts: "1785000000.000100", user: "U1" },
      selfBotId: undefined,
      surface: "channel",
    });

    expect("subtype" in candidate!).toBe(false);
  });

  it("flags app_id as self-authored when self-identity is unknown, not just bot_id", () => {
    const candidate = candidateFromMessage({
      channel: "C1",
      evidence: UNREAD_THREAD,
      message: { app_id: "A1", ts: "1785000000.000100", user: "U1" },
      selfBotId: undefined,
      surface: "channel",
    });

    expect(candidate!.selfAuthored).toBe(true);
  });

  it("falls back to a shape-valid bot_id as userId when user is absent — a peer bot's tag", () => {
    const candidate = candidateFromMessage({
      channel: "C1",
      evidence: UNREAD_THREAD,
      message: { bot_id: "BPEER0123456", ts: "1785000000.000100" },
      selfBotId: "BSELF0999999",
      surface: "channel",
    });

    expect(candidate!.userId).toBe("BPEER0123456");
    expect(candidate!.selfAuthored).toBe(false);
  });

  it("marks selfAuthored when the message's bot_id matches this install's own", () => {
    const candidate = candidateFromMessage({
      channel: "C1",
      evidence: UNREAD_THREAD,
      message: { bot_id: "BSELF0999999", ts: "1785000000.000100" },
      selfBotId: "BSELF0999999",
      surface: "channel",
    });

    expect(candidate!.selfAuthored).toBe(true);
  });

  it("fails closed to selfAuthored when self-identity was never resolved", () => {
    const candidate = candidateFromMessage({
      channel: "C1",
      evidence: UNREAD_THREAD,
      message: { bot_id: "BPEER0123456", ts: "1785000000.000100" },
      selfBotId: undefined,
      surface: "channel",
    });

    expect(candidate!.selfAuthored).toBe(true);
  });

  it("returns undefined for a message with no user and no shape-valid bot_id, rather than inventing a fifth exclusion", () => {
    expect(
      candidateFromMessage({
        channel: "C1",
        evidence: UNREAD_THREAD,
        message: { ts: "1785000000.000100" },
        selfBotId: undefined,
        surface: "channel",
      }),
    ).toBe(undefined);
  });

  it("returns undefined for a non-object", () => {
    expect(
      candidateFromMessage({
        channel: "C1",
        evidence: UNREAD_THREAD,
        message: "nope",
        selfBotId: undefined,
        surface: "channel",
      }),
    ).toBe(undefined);
  });
});

describe("candidateSurfaceFromChannel", () => {
  it("reads an ordinary public/private channel as `channel`", () => {
    expect(unwrap(candidateSurfaceFromChannel({ channel: { id: "C1" } }))).toBe("channel");
  });

  it("reads isIm as a DM", () => {
    expect(unwrap(candidateSurfaceFromChannel({ channel: { id: "D1", isIm: true } }))).toBe("dm");
  });

  it("reads isMpim as a group", () => {
    expect(unwrap(candidateSurfaceFromChannel({ channel: { id: "G1", isMpim: true } }))).toBe("group");
  });

  it("never infers a surface from the id's own leading letter — a `D…` id with no isIm reads as an ordinary channel", () => {
    expect(unwrap(candidateSurfaceFromChannel({ channel: { id: "D1" } }))).toBe("channel");
  });

  it("refuses contradictory metadata rather than guessing which one wins", () => {
    const result = candidateSurfaceFromChannel({ channel: { id: "C1", isIm: true, isMpim: true } });

    expect(unwrapErr(result)).toEqual([
      "channel C1 reports both isIm and isMpim — contradictory metadata, refusing to guess",
    ]);
  });
});

describe("tsToIso", () => {
  it("converts a Slack decimal ts", () => {
    expect(tsToIso({ ts: "1785000000.000100" })).toBe("2026-07-25T17:20:00.000Z");
  });

  it("returns undefined for something that is not a ts", () => {
    expect(tsToIso({ ts: "not-a-ts" })).toBe(undefined);
  });
});
