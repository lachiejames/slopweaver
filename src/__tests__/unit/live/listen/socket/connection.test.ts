/**
 * The listener loop's reading of the connection itself: Slack's disconnect reason, the connection count on
 * hello, the refusal of a second connection and its override.
 */
import { describe, expect, it } from "vitest";

import { createDedupeState } from "../../../../../live/listen/dedupe.js";
import { consumeMentions } from "../../../../../live/listen/socket.js";
import { mentionFrame, SELF_USER } from "./fixtures.js";
import { ADMITS_U0HUMAN, fakeConnection, noRefusal, recordingHandler, recordingLog } from "./harness.js";

describe("consumeMentions", () => {
  it("records Slack's disconnect reason rather than treating it as a failure", async () => {
    const fake = fakeConnection({ texts: [JSON.stringify({ reason: "warning", type: "disconnect" })] });
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

    expect(result.outcome.disconnectReason).toBe("warning");
    expect(logger.lines).toContain("Slack asked this socket to disconnect (reason: warning); reconnecting");
  });

  it("connects cleanly and proceeds when Slack reports one connection or none", async () => {
    for (const helloText of [
      JSON.stringify({ type: "hello" }),
      JSON.stringify({ num_connections: 1, type: "hello" }),
      JSON.stringify({ num_connections: 0, type: "hello" }),
    ]) {
      const fake = fakeConnection({ texts: [helloText] });
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
      expect(logger.lines).toEqual(["connected to Slack over Socket Mode"]);
      expect(result.outcome.connectionRefusal).toBe(undefined);
      expect(result.outcome.helloPermitted).toBe(true);
      expect(fake.cancelled).toEqual([]);
    }
  });

  it("refuses and cancels the connection when Slack reports a second one, with no override", async () => {
    const mention = mentionFrame({ envelopeId: "e-1", eventId: "Ev1" });
    const fake = fakeConnection({ texts: [JSON.stringify({ num_connections: 2, type: "hello" }), mention] });
    const logger = recordingLog();
    const recorder = recordingHandler();

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

    expect(logger.lines).toEqual([
      "REFUSED: Slack reports 2 connections for this app — a tag can be delivered to either one, and only " +
        "one of them will answer. Stop the other listener and retry.",
      "1 frame(s) arrived after the connection closed and were thrown away — if one was a tag, it was never " +
        "acknowledged and Slack cannot redeliver it to a closed socket. Recover it with `slopweaver listen " +
        "recover`.",
    ]);
    expect(fake.cancelled).toEqual(["multiple Socket Mode connections"]);
    expect(result.outcome.connectionRefusal).toEqual({
      connections: 2,
      kind: "multiple-connections",
      message:
        "Slack reports 2 connections for this app — a tag can be delivered to either one, and only one of " +
        "them will answer. Stop the other listener and retry.",
    });
    expect(result.outcome.abandoned).toBe(1);
    expect(result.outcome.helloPermitted).toBe(false);
    // The buffered mention frame after the refused hello was never handled — cancellation discarded it.
    expect(recorder.seen).toEqual([]);
  });

  it("does not claim a permitted hello for a connection that ended before Slack sent one", async () => {
    const fake = fakeConnection({ texts: [JSON.stringify({ reason: "warning", type: "disconnect" })] });

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

    expect(result.outcome.disconnectReason).toBe("warning");
    expect(result.outcome.helloPermitted).toBe(false);
  });

  it("REPORTS the connection count on hello — including on the refusal, the reading worth keeping most", async () => {
    const fake = fakeConnection({ texts: [JSON.stringify({ num_connections: 10, type: "hello" })] });
    const counts: number[] = [];

    await consumeMentions({
      connection: fake.connection,
      handler: recordingHandler().handler,
      log: recordingLog().log,
      onHello: ({ connections }) => {
        counts.push(connections);
      },
      refuseResponder: noRefusal,
      responderHatchOpen: () => false,
      responderWhitelist: () => ADMITS_U0HUMAN,
      selfUserId: SELF_USER,
      seen: createDedupeState(),
    });

    expect(counts).toEqual([10]);
    expect(fake.cancelled).toEqual(["multiple Socket Mode connections"]);
  });

  it("reports the count on a HEALTHY single connection too", async () => {
    const fake = fakeConnection({ texts: [JSON.stringify({ num_connections: 1, type: "hello" })] });
    const counts: number[] = [];

    await consumeMentions({
      connection: fake.connection,
      handler: recordingHandler().handler,
      log: recordingLog().log,
      onHello: ({ connections }) => {
        counts.push(connections);
      },
      refuseResponder: noRefusal,
      responderHatchOpen: () => false,
      responderWhitelist: () => ADMITS_U0HUMAN,
      selfUserId: SELF_USER,
      seen: createDedupeState(),
    });

    expect(counts).toEqual([1]);
  });

  it("reports NOTHING when hello carried no count, rather than a fabricated zero", async () => {
    const fake = fakeConnection({ texts: [JSON.stringify({ type: "hello" })] });
    const counts: number[] = [];

    await consumeMentions({
      connection: fake.connection,
      handler: recordingHandler().handler,
      log: recordingLog().log,
      onHello: ({ connections }) => {
        counts.push(connections);
      },
      refuseResponder: noRefusal,
      responderHatchOpen: () => false,
      responderWhitelist: () => ADMITS_U0HUMAN,
      selfUserId: SELF_USER,
      seen: createDedupeState(),
    });

    expect(counts).toEqual([]);
  });

  it("proceeds loudly on a second connection when the override is set", async () => {
    const fake = fakeConnection({ texts: [JSON.stringify({ num_connections: 2, type: "hello" })] });
    const logger = recordingLog();

    const result = await consumeMentions({
      allowMultipleConnections: true,
      connection: fake.connection,
      handler: recordingHandler().handler,
      log: logger.log,
      refuseResponder: noRefusal,
      responderHatchOpen: () => false,
      responderWhitelist: () => ADMITS_U0HUMAN,
      selfUserId: SELF_USER,
      seen: createDedupeState(),
    });

    expect(logger.lines).toEqual([
      "connected to Slack over Socket Mode — Slack reports 2 connections for this app — a tag can be " +
        "delivered to either one, and only one of them will answer. Stop the other listener and retry. " +
        "OVERRIDDEN by SLOPWEAVER_ALLOW_MULTIPLE_SOCKET_CONNECTIONS=1",
    ]);
    expect(fake.cancelled).toEqual([]);
    expect(result.outcome.connectionRefusal).toBe(undefined);
    expect(result.outcome.helloPermitted).toBe(true);
  });
});
