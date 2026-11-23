/**
 * The listener loop ignores, by name and still acknowledging it, a frame that is not an address: an event that
 * is neither a tag nor a DM, an unreadable frame, and a frame type it never subscribed to.
 */
import { describe, expect, it } from "vitest";

import { createDedupeState } from "../../../../../live/listen/dedupe.js";
import { consumeMentions } from "../../../../../live/listen/socket.js";
import { mentionFrame, SELF_USER } from "./fixtures.js";
import { ADMITS_U0HUMAN, fakeConnection, noRefusal, recordingHandler, recordingLog } from "./harness.js";

describe("consumeMentions", () => {
  it("ignores an app_home_opened event by name, because it is neither a tag nor a DM", async () => {
    const frame = JSON.stringify({
      envelope_id: "e-home",
      payload: { event: { channel: "D0OWNER", type: "app_home_opened", user: "U0HUMAN" }, event_id: "EvHome" },
      type: "events_api",
    });
    const fake = fakeConnection({ texts: [frame] });
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

    expect(result.outcome.ignored).toBe(1);
    expect(fake.acked).toEqual(["e-home"]);
    expect(logger.lines).toContain(
      "ignored a app_home_opened event — this listener answers a channel tag or a direct message",
    );
  });

  it("ignores an event that is not a tag, by name, and still acknowledges it", async () => {
    const frame = JSON.stringify({
      envelope_id: "e-7",
      payload: { event: { channel: "C1", ts: "1.1", type: "message", user: "U1" }, event_id: "Ev7" },
      type: "events_api",
    });
    const fake = fakeConnection({ texts: [frame] });
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

    expect(recorder.seen).toEqual([]);
    expect(result.outcome.ignored).toBe(1);
    expect(fake.acked).toEqual(["e-7"]);
    expect(logger.lines[0]).toContain("is not a direct message");
  });

  it("reports an unreadable frame instead of dying on it", async () => {
    const fake = fakeConnection({ texts: ["}{not json", mentionFrame({ envelopeId: "e-1", eventId: "Ev1" })] });
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

    expect(result.outcome.ignored).toBe(1);
    expect(recorder.seen.length).toBe(1);
    expect(logger.lines).toContain("could not read a frame: the frame was not JSON");
  });

  it("ignores a frame type it never subscribed to", async () => {
    const fake = fakeConnection({ texts: [JSON.stringify({ type: "slash_commands" })] });
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

    expect(result.outcome.ignored).toBe(1);
    expect(logger.lines).toContain("ignored a slash_commands frame — this listener reads events_api frames only");
  });
});
