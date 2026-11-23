/** A handler that throws does not end the listener: it is counted, and the loop keeps taking frames. */
import { describe, expect, it } from "vitest";

import { createDedupeState } from "../../../../../live/listen/dedupe.js";
import type { MentionHandler } from "../../../../../live/listen/mention.js";
import { consumeMentions } from "../../../../../live/listen/socket.js";
import { mentionFrame, SELF_USER } from "./fixtures.js";
import { ADMITS_U0HUMAN, fakeConnection, noRefusal, recordingLog } from "./harness.js";

describe("consumeMentions", () => {
  it("survives a handler that throws, counts it, and keeps taking frames", async () => {
    const fake = fakeConnection({
      texts: [
        mentionFrame({ envelopeId: "e-1", eventId: "Ev1" }),
        mentionFrame({ envelopeId: "e-2", eventId: "Ev2", ts: "1785114400.000100" }),
      ],
    });
    const handled: string[] = [];
    const handler: MentionHandler = async (mention) => {
      handled.push(mention.messageTs);
      throw new Error("the turn blew up");
    };
    const logger = recordingLog();

    const result = await consumeMentions({
      connection: fake.connection,
      handler,
      log: logger.log,
      refuseResponder: noRefusal,
      responderHatchOpen: () => false,
      responderWhitelist: () => ADMITS_U0HUMAN,
      selfUserId: SELF_USER,
      seen: createDedupeState(),
    });

    expect(handled).toEqual(["1785114398.557099", "1785114400.000100"]);
    expect(result.outcome.failed).toBe(2);
    expect(result.outcome.handled).toBe(0);
    expect(logger.lines.filter((line) => line.startsWith("the handler threw")).length).toBe(2);
  });
});
