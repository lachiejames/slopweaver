/**
 * `--once`: the listener closes after one handled mention, and a tag abandoned at that close is counted and
 * named in the log rather than lost silently.
 */
import { describe, expect, it } from "vitest";

import { createDedupeState } from "../../../../../live/listen/dedupe.js";
import { consumeMentions } from "../../../../../live/listen/socket.js";
import { mentionFrame, SELF_USER } from "./fixtures.js";
import { ADMITS_U0HUMAN, fakeConnection, noRefusal, recordingHandler, recordingLog } from "./harness.js";

describe("consumeMentions", () => {
  it("closes the connection after one handled mention when --once is set", async () => {
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
      stopAfterFirst: true,
    });

    expect(recorder.seen.length).toBe(1);
    expect(result.outcome.handled).toBe(1);
    expect(fake.closed).toEqual(["--once resolved one address"]);
  });

  /**
   * The `--once` silent drop, now a number on the outcome.
   *
   * The second tag arrives after the close and is thrown away. That was always true; what was missing was
   * any evidence of it — none of `handled`, `dropped`, `ignored` or `failed` counts a frame abandoned at
   * close, so the loss produced no number and no log line. It is the same defect class as every other entry
   * in this repo's silent-failure ledger, and this is the assertion that keeps it closed.
   */
  it("COUNTS the tag abandoned when --once closes the connection under it", async () => {
    const fake = fakeConnection({
      texts: [
        mentionFrame({ envelopeId: "e-1", eventId: "Ev1" }),
        mentionFrame({ envelopeId: "e-2", eventId: "Ev2", ts: "1785114400.000100" }),
      ],
    });

    const result = await consumeMentions({
      connection: fake.connection,
      handler: recordingHandler().handler,
      log: recordingLog().log,
      refuseResponder: noRefusal,
      responderHatchOpen: () => false,
      responderWhitelist: () => ADMITS_U0HUMAN,
      selfUserId: SELF_USER,
      seen: createDedupeState(),
      stopAfterFirst: true,
    });

    expect(result.outcome.abandoned).toBe(1);
  });

  it("says so in the log, and names the verb that recovers it", async () => {
    const fake = fakeConnection({
      texts: [
        mentionFrame({ envelopeId: "e-1", eventId: "Ev1" }),
        mentionFrame({ envelopeId: "e-2", eventId: "Ev2", ts: "1785114400.000100" }),
      ],
    });
    const logged = recordingLog();

    await consumeMentions({
      connection: fake.connection,
      handler: recordingHandler().handler,
      log: logged.log,
      refuseResponder: noRefusal,
      responderHatchOpen: () => false,
      responderWhitelist: () => ADMITS_U0HUMAN,
      selfUserId: SELF_USER,
      seen: createDedupeState(),
      stopAfterFirst: true,
    });

    expect(logged.lines.some((line) => line.includes("slopweaver listen recover"))).toBe(true);
  });

  it("reports zero abandoned on an ordinary drain, so a non-zero count always means real loss", async () => {
    const fake = fakeConnection({ texts: [mentionFrame({ envelopeId: "e-1", eventId: "Ev1" })] });

    const result = await consumeMentions({
      connection: fake.connection,
      handler: recordingHandler().handler,
      log: recordingLog().log,
      refuseResponder: noRefusal,
      responderHatchOpen: () => false,
      responderWhitelist: () => ADMITS_U0HUMAN,
      selfUserId: SELF_USER,
      seen: createDedupeState(),
    });

    expect(result.outcome.abandoned).toBe(0);
  });
});
