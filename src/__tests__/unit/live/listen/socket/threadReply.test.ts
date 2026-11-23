/** A reply under one of the bot's own posts: answered only where switched on, once, and under a daily cap. */
import { describe, expect, it } from "vitest";

import { createDedupeState } from "../../../../../live/listen/dedupe.js";
import { consumeMentions } from "../../../../../live/listen/socket.js";
import { THREAD_REPLY_DAILY_CAP } from "../../../../../live/listen/threadReply.js";
import { mentionFrame, SELF_USER } from "./fixtures.js";
import {
  ADMITS_U0HUMAN,
  fakeConnection,
  noRefusal,
  recordingHandler,
  recordingLog,
  recordingRefusal,
} from "./harness.js";

describe("consumeMentions — a reply under one of the bot's own posts", () => {
  /** One human reply under a bot-rooted thread, its own `ts` distinct per reply so nothing dedupes. */
  function threadReplyFrame({ envelopeId, eventId, ts }: { envelopeId: string; eventId: string; ts: string }): string {
    return mentionFrame({
      envelopeId,
      event: {
        channel: "C0LISTEN",
        channel_type: "channel",
        parent_user_id: SELF_USER,
        text: "why did the staging pool exhaust?",
        thread_ts: "1789719065.541169",
        ts,
        type: "message",
        user: "U0HUMAN",
      },
      eventId,
      ts,
    });
  }

  it("hands one to the handler when its channel is switched on", async () => {
    const fake = fakeConnection({
      texts: [threadReplyFrame({ envelopeId: "e-1", eventId: "Ev1", ts: "1789719400.000100" })],
    });
    const recorder = recordingHandler();

    const result = await consumeMentions({
      connection: fake.connection,
      handler: recorder.handler,
      log: recordingLog().log,
      refuseResponder: noRefusal,
      responderHatchOpen: () => false,
      responderWhitelist: () => ADMITS_U0HUMAN,
      selfUserId: SELF_USER,
      seen: createDedupeState(),
      threadReplyChannels: ["C0LISTEN"],
    });

    expect(result.outcome.handled).toBe(1);
    expect(recorder.seen.map((mention) => mention.threadTs)).toEqual(["1789719065.541169"]);
  });

  it("answers a reply that ALSO tags the bot once, though it arrives as both a message and an app_mention", async () => {
    const ts = "1789719400.000100";
    const appMention = mentionFrame({
      envelopeId: "e-2",
      event: { text: `<@${SELF_USER}> why did the staging pool exhaust?`, thread_ts: "1789719065.541169" },
      eventId: "EvMention",
      ts,
    });
    const fake = fakeConnection({
      texts: [threadReplyFrame({ envelopeId: "e-1", eventId: "EvMessage", ts }), appMention],
    });
    const recorder = recordingHandler();

    const result = await consumeMentions({
      connection: fake.connection,
      handler: recorder.handler,
      log: recordingLog().log,
      refuseResponder: noRefusal,
      responderHatchOpen: () => false,
      responderWhitelist: () => ADMITS_U0HUMAN,
      selfUserId: SELF_USER,
      seen: createDedupeState(),
      threadReplyChannels: ["C0LISTEN"],
    });

    expect(recorder.seen.map((mention) => mention.messageTs)).toEqual([ts]);
    expect(result.outcome.handled).toBe(1);
    expect(result.outcome.dropped).toBe(1);
  });

  it("ignores the same reply when no channel is switched on — the default, and byte-for-byte the old behaviour", async () => {
    const fake = fakeConnection({
      texts: [threadReplyFrame({ envelopeId: "e-1", eventId: "Ev1", ts: "1789719400.000100" })],
    });
    const recorder = recordingHandler();
    const refusal = recordingRefusal();

    const result = await consumeMentions({
      connection: fake.connection,
      handler: recorder.handler,
      log: recordingLog().log,
      refuseResponder: refusal.refuseResponder,
      responderHatchOpen: () => false,
      responderWhitelist: () => ADMITS_U0HUMAN,
      selfUserId: SELF_USER,
      seen: createDedupeState(),
    });

    expect([result.outcome.handled, result.outcome.ignored]).toEqual([0, 1]);
    expect(recorder.seen).toEqual([]);
    expect(refusal.calls).toEqual([]);
  });

  it("stops at the daily cap, silently, and carries the spent budget out for the next connection", async () => {
    const texts = [1, 2, 3, 4, 5].map((n) =>
      threadReplyFrame({ envelopeId: `e-${String(n)}`, eventId: `Ev${String(n)}`, ts: `178971940${String(n)}.000100` }),
    );
    const fake = fakeConnection({ texts });
    const recorder = recordingHandler();
    const refusal = recordingRefusal();
    const logger = recordingLog();

    const result = await consumeMentions({
      connection: fake.connection,
      handler: recorder.handler,
      log: logger.log,
      refuseResponder: refusal.refuseResponder,
      responderHatchOpen: () => false,
      responderWhitelist: () => ADMITS_U0HUMAN,
      selfUserId: SELF_USER,
      seen: createDedupeState(),
      threadReplyChannels: ["C0LISTEN"],
    });

    expect(result.outcome.handled).toBe(THREAD_REPLY_DAILY_CAP);
    expect(recorder.seen.length).toBe(THREAD_REPLY_DAILY_CAP);
    expect(refusal.calls).toEqual([]);
    expect(logger.lines.filter((line) => line.includes("cap of 4")).length).toBe(1);
    expect([...result.threadReplies.values()]).toEqual([THREAD_REPLY_DAILY_CAP]);
  });

  it("refuses a stranger's reply on the whitelist before it can spend any budget", async () => {
    const fake = fakeConnection({
      texts: [
        mentionFrame({
          envelopeId: "e-1",
          event: {
            channel: "C0LISTEN",
            channel_type: "channel",
            parent_user_id: SELF_USER,
            text: "why?",
            thread_ts: "1789719065.541169",
            ts: "1789719400.000100",
            type: "message",
            user: "U0SYNSTRANGER",
          },
          eventId: "Ev1",
        }),
      ],
    });
    const refusal = recordingRefusal();

    const result = await consumeMentions({
      connection: fake.connection,
      handler: recordingHandler().handler,
      log: recordingLog().log,
      refuseResponder: refusal.refuseResponder,
      responderHatchOpen: () => false,
      responderWhitelist: () => ADMITS_U0HUMAN,
      selfUserId: SELF_USER,
      seen: createDedupeState(),
      threadReplyChannels: ["C0LISTEN"],
    });

    expect(result.outcome.refused).toBe(1);
    expect(refusal.calls.length).toBe(1);
    expect([...result.threadReplies.values()]).toEqual([]);
  });
});
