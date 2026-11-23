/*
 * One event frame, judged directly through `handleEvent`: an accepted mention is acknowledged before the handler
 * runs and is handed over once, a second event for the same message is acknowledged and dropped, and an event
 * that is not an address is acknowledged and ignored by name.
 */
import { describe, expect, it } from "vitest";

import { createDedupeState } from "../../../../live/listen/dedupe.js";
import type { SocketEventFrame } from "../../../../live/listen/frames.js";
import type { Mention, MentionHandler } from "../../../../live/listen/mention.js";
import { UNSCOPED } from "../../../../live/listen/scope.js";
import type { LoopState } from "../../../../live/listen/socket.js";
import { type EventPolicy, handleEvent } from "../../../../live/listen/socketEvent.js";
import { NO_THREAD_REPLIES } from "../../../../live/listen/threadReply.js";
import { SELF_USER } from "./socket/fixtures.js";
import { ADMITS_U0HUMAN, fakeConnection, recordingLog, recordingRefusal } from "./socket/harness.js";

/** A fresh connection's tallies, before any frame. */
function freshState(): LoopState {
  return {
    connectionRefusal: undefined,
    disconnectReason: undefined,
    dropped: 0,
    failed: 0,
    handled: 0,
    helloPermitted: false,
    ignored: 0,
    refused: 0,
    seen: createDedupeState(),
    stop: false,
    threadReplies: NO_THREAD_REPLIES,
    wonAddressConcluded: false,
  };
}

/** An `events_api` delivery of one event, already parsed to the frame `handleEvent` takes. */
function eventFrame({
  envelopeId,
  eventId,
  eventType = "app_mention",
}: {
  envelopeId: string;
  eventId: string;
  eventType?: string;
}): SocketEventFrame {
  return {
    envelopeId,
    event: {
      channel: "C0LISTEN",
      text: `<@${SELF_USER}> status?`,
      ts: "1785114398.557099",
      type: eventType,
      user: "U0HUMAN",
    },
    eventId,
    eventType,
    kind: "event",
    retryAttempt: 0,
    retryReason: undefined,
  };
}

/** The policy every case shares: an admitting whitelist, this install's own user id, every conversation. */
function policyWith({
  handler,
  refuseResponder,
}: {
  handler: MentionHandler;
  refuseResponder: EventPolicy["refuseResponder"];
}): EventPolicy {
  return {
    addressStart: () => true,
    handler,
    refuseResponder,
    responderHatchOpen: () => false,
    responderWhitelist: () => ADMITS_U0HUMAN,
    scope: UNSCOPED,
    selfBotId: undefined,
    selfUserId: SELF_USER,
    threadReplyChannels: [],
  };
}

describe("handleEvent", () => {
  it("acknowledges an accepted mention before its handler runs, hands it over once and records the win", async () => {
    const fake = fakeConnection({ texts: [] });
    const logger = recordingLog();
    const refusals = recordingRefusal();
    const ackedWhenHandled: number[] = [];
    const seen: Mention[] = [];
    const handler: MentionHandler = async (mention) => {
      ackedWhenHandled.push(fake.acked.length);
      seen.push(mention);
    };
    const state = freshState();

    await handleEvent({
      connection: fake.connection,
      frame: eventFrame({ envelopeId: "e-1", eventId: "Ev1" }),
      log: logger.log,
      policy: policyWith({ handler, refuseResponder: refusals.refuseResponder }),
      state,
    });

    expect(fake.acked).toEqual(["e-1"]);
    expect(ackedWhenHandled).toEqual([1]);
    expect(seen.map((mention) => mention.messageTs)).toEqual(["1785114398.557099"]);
    expect(state.handled).toBe(1);
    expect(state.wonAddressConcluded).toBe(true);
    expect(refusals.calls).toEqual([]);
    expect(logger.lines).toEqual(["mention from U0HUMAN in C0LISTEN (thread 1785114398.557099)"]);
  });

  it("acknowledges and drops a second event for the same message without a second handler call", async () => {
    const fake = fakeConnection({ texts: [] });
    const logger = recordingLog();
    const refusals = recordingRefusal();
    const seen: Mention[] = [];
    const handler: MentionHandler = async (mention) => {
      seen.push(mention);
    };
    const policy = policyWith({ handler, refuseResponder: refusals.refuseResponder });
    const state = freshState();

    await handleEvent({
      connection: fake.connection,
      frame: eventFrame({ envelopeId: "e-1", eventId: "Ev1" }),
      log: logger.log,
      policy,
      state,
    });
    await handleEvent({
      connection: fake.connection,
      frame: eventFrame({ envelopeId: "e-2", eventId: "Ev2" }),
      log: logger.log,
      policy,
      state,
    });

    expect(fake.acked).toEqual(["e-1", "e-2"]);
    expect(seen.length).toBe(1);
    expect(state.handled).toBe(1);
    expect(state.dropped).toBe(1);
    expect(logger.lines.at(-1)).toBe(
      "dropped another event for an already-seen message (event=Ev2 message=C0LISTEN/1785114398.557099) — already seen, so no second effect",
    );
  });

  it("acknowledges and ignores an event that is neither a tag nor a direct message, naming its type", async () => {
    const fake = fakeConnection({ texts: [] });
    const logger = recordingLog();
    const refusals = recordingRefusal();
    const seen: Mention[] = [];
    const handler: MentionHandler = async (mention) => {
      seen.push(mention);
    };
    const state = freshState();

    await handleEvent({
      connection: fake.connection,
      frame: eventFrame({ envelopeId: "e-1", eventId: "Ev1", eventType: "reaction_added" }),
      log: logger.log,
      policy: policyWith({ handler, refuseResponder: refusals.refuseResponder }),
      state,
    });

    expect(fake.acked).toEqual(["e-1"]);
    expect(state.ignored).toBe(1);
    expect(state.handled).toBe(0);
    expect(seen).toEqual([]);
    expect(refusals.calls).toEqual([]);
    expect(logger.lines).toEqual([
      "ignored a reaction_added event — this listener answers a channel tag or a direct message",
    ]);
  });
});
