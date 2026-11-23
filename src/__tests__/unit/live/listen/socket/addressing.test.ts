/**
 * The listener loop, driven by a fake connection — a plain async generator, not a mock.
 *
 * What counts as an address: the envelope is acknowledged BEFORE the handler runs, a tag outside the scope is
 * dropped before the whitelist, a plain DM DOES wake it while the bot's own DM, a group DM and an untagged
 * channel message do not.
 */
import { describe, expect, it } from "vitest";

import { createDedupeState } from "../../../../../live/listen/dedupe.js";
import type { MentionHandler } from "../../../../../live/listen/mention.js";
import { consumeMentions } from "../../../../../live/listen/socket.js";
import { mentionFrame, messageFrame, SELF_USER } from "./fixtures.js";
import {
  ADMITS_U0HUMAN,
  fakeConnection,
  noRefusal,
  recordingHandler,
  recordingLog,
  recordingRefusal,
} from "./harness.js";

describe("consumeMentions", () => {
  it("acknowledges the envelope before the handler runs, and hands over a typed mention", async () => {
    const fake = fakeConnection({ texts: [mentionFrame({ envelopeId: "e-1", eventId: "Ev1" })] });
    const ackedWhenHandled: (readonly string[])[] = [];
    const handler: MentionHandler = async () => {
      ackedWhenHandled.push([...fake.acked]);
    };

    const result = await consumeMentions({
      connection: fake.connection,
      handler,
      log: recordingLog().log,
      refuseResponder: noRefusal,
      responderHatchOpen: () => false,
      responderWhitelist: () => ADMITS_U0HUMAN,
      selfUserId: SELF_USER,
      seen: createDedupeState(),
    });

    expect(ackedWhenHandled).toEqual([["e-1"]]);
    expect(result.outcome.handled).toBe(1);
  });

  it("drops a tag outside the scope BEFORE the whitelist — no handler, no refusal reply — and still acks it", async () => {
    const fake = fakeConnection({
      texts: [mentionFrame({ envelopeId: "e-1", event: { user: "U0SYNSTRANGER" }, eventId: "Ev1" })],
    });
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
      scope: { kind: "dm-only" },
      selfUserId: SELF_USER,
      seen: createDedupeState(),
    });

    expect(fake.acked).toEqual(["e-1"]);
    expect(recorder.seen).toEqual([]);
    expect(refusal.calls).toEqual([]);
    expect([result.outcome.handled, result.outcome.refused, result.outcome.ignored]).toEqual([0, 0, 1]);
    expect(logger.lines.filter((line) => line.includes("outside this listener's scope")).length).toBe(1);
    expect(logger.lines.join("\n")).toContain(
      "from U0SYNSTRANGER in C0LISTEN — outside this listener's scope, 1:1 direct messages only (--dm-only)",
    );
  });

  it("does not let an out-of-scope tag satisfy --once: the in-scope DM behind it is still handled", async () => {
    const fake = fakeConnection({
      texts: [mentionFrame({ envelopeId: "e-1", eventId: "Ev1" }), messageFrame({ envelopeId: "e-2", eventId: "Ev2" })],
    });
    const recorder = recordingHandler();

    await consumeMentions({
      connection: fake.connection,
      handler: recorder.handler,
      log: recordingLog().log,
      refuseResponder: noRefusal,
      responderHatchOpen: () => false,
      responderWhitelist: () => ADMITS_U0HUMAN,
      scope: { channels: ["D0OWNER"], kind: "channels" },
      selfUserId: SELF_USER,
      seen: createDedupeState(),
      stopAfterFirst: true,
    });

    expect(recorder.seen.map((mention) => mention.channel)).toEqual(["D0OWNER"]);
  });

  it("passes the parsed mention through, tag normalised and thread resolved", async () => {
    const fake = fakeConnection({ texts: [mentionFrame({ envelopeId: "e-1", eventId: "Ev1" })] });
    const recorder = recordingHandler();

    await consumeMentions({
      connection: fake.connection,
      handler: recorder.handler,
      log: recordingLog().log,
      refuseResponder: noRefusal,
      responderHatchOpen: () => false,
      responderWhitelist: () => ADMITS_U0HUMAN,
      selfUserId: SELF_USER,
      seen: createDedupeState(),
    });

    expect(recorder.seen).toEqual([
      {
        channel: "C0LISTEN",
        messageTs: "1785114398.557099",
        surface: "channel",
        text: "@(U0BOT) status?",
        threadTs: "1785114398.557099",
        userId: "U0HUMAN",
      },
    ]);
  });

  it("wakes on a DM that tags the bot, and marks it as the dm surface", async () => {
    const fake = fakeConnection({ texts: [messageFrame({ envelopeId: "e-dm", eventId: "EvDm" })] });
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

    expect(recorder.seen).toEqual([
      {
        channel: "D0OWNER",
        messageTs: "1785998605.523229",
        surface: "dm",
        text: `@(${SELF_USER}) status?`,
        threadTs: "1785998605.523229",
        userId: "U0HUMAN",
      },
    ]);
    expect(result.outcome.handled).toBe(1);
    expect(logger.lines).toContain("direct message from U0HUMAN in D0OWNER (thread 1785998605.523229)");
  });

  it("does NOT wake on the bot's own reply landing in the same DM — the loop this change could introduce", async () => {
    const fake = fakeConnection({
      texts: [messageFrame({ envelopeId: "e-self", event: { bot_id: "B0SELF", user: "U0BOT" }, eventId: "EvSelf" })],
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

    expect(recorder.seen).toEqual([]);
    expect(result.outcome.handled).toBe(0);
    expect(result.outcome.ignored).toBe(1);
    expect(fake.acked).toEqual(["e-self"]);
    expect(logger.lines[0]).toContain("posted by a bot");
  });

  it("does NOT wake on a group DM, so a subscribed message.mpim cannot leak the owner's lens", async () => {
    const fake = fakeConnection({
      texts: [messageFrame({ envelopeId: "e-g", event: { channel: "G0GROUP", channel_type: "mpim" }, eventId: "EvG" })],
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

    expect(recorder.seen).toEqual([]);
    expect(result.outcome.ignored).toBe(1);
    expect(logger.lines[0]).toContain("only a 1:1 DM counts as addressing the bot");
  });

  it("does NOT wake on an untagged CHANNEL message, so channels stay tag-only", async () => {
    const fake = fakeConnection({
      texts: [
        messageFrame({ envelopeId: "e-c", event: { channel: "C0OPEN", channel_type: "channel" }, eventId: "EvC" }),
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

    expect(recorder.seen).toEqual([]);
    expect(result.outcome.ignored).toBe(1);
  });
});
