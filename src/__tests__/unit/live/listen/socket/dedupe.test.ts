/**
 * The listener loop's dedupe window: a redelivered event — or a second event naming the same message —
 * produces one turn and a printed drop, a second message in the same channel is still admitted, and the
 * window carries across connections.
 */
import { describe, expect, it } from "vitest";

import { createDedupeState } from "../../../../../live/listen/dedupe.js";
import { consumeMentions } from "../../../../../live/listen/socket.js";
import { mentionFrame, SELF_USER } from "./fixtures.js";
import { ADMITS_U0HUMAN, fakeConnection, noRefusal, recordingHandler, recordingLog } from "./harness.js";

describe("consumeMentions", () => {
  it("drops a redelivered event id: one turn, one printed drop, both envelopes acknowledged", async () => {
    const fake = fakeConnection({
      texts: [
        mentionFrame({ envelopeId: "e-1", eventId: "Ev1" }),
        mentionFrame({ envelopeId: "e-2", eventId: "Ev1", retryAttempt: 1 }),
      ],
    });
    const recorder = recordingHandler();
    const logger = recordingLog();

    const result = await consumeMentions({
      connection: fake.connection,
      handler: recorder.handler,
      log: logger.log,
      refuseResponder: noRefusal,
      responderHatchOpen: () => false,
      responderWhitelist: () => ADMITS_U0HUMAN,
      selfUserId: SELF_USER,
      seen: createDedupeState(),
    });

    expect(recorder.seen.length).toBe(1);
    expect(result.outcome.dropped).toBe(1);
    expect(fake.acked).toEqual(["e-1", "e-2"]);
    expect(logger.lines).toContain(
      "dropped a redelivered mention (event=Ev1 message=C0LISTEN/1785114398.557099 retry_attempt=1) — already seen, so no second effect",
    );
  });

  it("drops a SECOND event id for the same message — one tag, one turn, and the drop is not called a redelivery", async () => {
    // The incident's shape: one post made as the owner that tagged the bot reached the listener as two
    // subtype-less app_mentions with different event ids, and both were handed to the handler.
    const fake = fakeConnection({
      texts: [mentionFrame({ envelopeId: "e-1", eventId: "Ev1" }), mentionFrame({ envelopeId: "e-2", eventId: "Ev2" })],
    });
    const recorder = recordingHandler();
    const logger = recordingLog();

    const result = await consumeMentions({
      connection: fake.connection,
      handler: recorder.handler,
      log: logger.log,
      refuseResponder: noRefusal,
      responderHatchOpen: () => false,
      responderWhitelist: () => ADMITS_U0HUMAN,
      selfUserId: SELF_USER,
      seen: createDedupeState(),
    });

    expect(recorder.seen.map((mention) => mention.messageTs)).toEqual(["1785114398.557099"]);
    expect(result.outcome.handled).toBe(1);
    expect(result.outcome.dropped).toBe(1);
    expect(fake.acked).toEqual(["e-1", "e-2"]);
    expect(logger.lines).toContain(
      "dropped another event for an already-seen message (event=Ev2 message=C0LISTEN/1785114398.557099) — already seen, so no second effect",
    );
  });

  it("still admits a second message in the same channel, so the message key never merges two asks", async () => {
    const fake = fakeConnection({
      texts: [
        mentionFrame({ envelopeId: "e-1", eventId: "Ev1" }),
        mentionFrame({ envelopeId: "e-2", eventId: "Ev2", ts: "1785114400.000100" }),
      ],
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
    });

    expect(recorder.seen.map((mention) => mention.messageTs)).toEqual(["1785114398.557099", "1785114400.000100"]);
    expect(result.outcome.dropped).toBe(0);
  });

  it("names an absent event id as unstated rather than printing nothing", async () => {
    const withoutEventId = JSON.stringify({
      envelope_id: "e-2",
      payload: {
        event: {
          channel: "C0LISTEN",
          text: "<@U0BOT> status?",
          ts: "1785114398.557099",
          type: "app_mention",
          user: "U0HUMAN",
        },
        type: "event_callback",
      },
      type: "events_api",
    });
    const fake = fakeConnection({ texts: [mentionFrame({ envelopeId: "e-1", eventId: "Ev1" }), withoutEventId] });
    const logger = recordingLog();

    const result = await consumeMentions({
      connection: fake.connection,
      handler: recordingHandler().handler,
      log: logger.log,
      refuseResponder: noRefusal,
      responderHatchOpen: () => false,
      responderWhitelist: () => ADMITS_U0HUMAN,
      selfUserId: SELF_USER,
      seen: createDedupeState(),
    });

    expect(result.outcome.dropped).toBe(1);
    expect(logger.lines).toContain(
      "dropped another event for an already-seen message (event=unstated message=C0LISTEN/1785114398.557099) — already seen, so no second effect",
    );
  });

  it("carries the dedupe window across connections, which is when a redelivery actually arrives", async () => {
    const first = fakeConnection({ texts: [mentionFrame({ envelopeId: "e-1", eventId: "Ev1" })] });
    const carried = await consumeMentions({
      connection: first.connection,
      handler: recordingHandler().handler,
      log: recordingLog().log,
      refuseResponder: noRefusal,
      responderHatchOpen: () => false,
      responderWhitelist: () => ADMITS_U0HUMAN,
      selfUserId: SELF_USER,
      seen: createDedupeState(),
    });
    const second = fakeConnection({ texts: [mentionFrame({ envelopeId: "e-9", eventId: "Ev1", retryAttempt: 1 })] });
    const recorder = recordingHandler();

    const result = await consumeMentions({
      connection: second.connection,
      handler: recorder.handler,
      log: recordingLog().log,
      refuseResponder: noRefusal,
      responderHatchOpen: () => false,
      responderWhitelist: () => ADMITS_U0HUMAN,
      selfUserId: SELF_USER,
      seen: carried.seen,
    });

    expect(recorder.seen).toEqual([]);
    expect(result.outcome.dropped).toBe(1);
  });
});
