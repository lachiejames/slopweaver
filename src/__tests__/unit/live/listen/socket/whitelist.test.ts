/** The responder whitelist: who the listener refuses, how a refusal is counted, and the break-glass override. */
import { describe, expect, it } from "vitest";

import { createDedupeState } from "../../../../../live/listen/dedupe.js";
import type { Mention } from "../../../../../live/listen/mention.js";
import { consumeMentions, type ResponderRefusalHandler } from "../../../../../live/listen/socket.js";
import type { ResponderWhitelist } from "../../../../../live/listen/whitelist.js";
import { mentionFrame, messageFrame, SELF_USER } from "./fixtures.js";
import {
  ADMITS_U0HUMAN,
  fakeConnection,
  noRefusal,
  recordingHandler,
  recordingLog,
  recordingRefusal,
} from "./harness.js";

describe("consumeMentions — responder whitelist", () => {
  const CLOSED_LIST: ResponderWhitelist = { identities: [], kind: "list" };
  const ABSENT_LIST: ResponderWhitelist = { kind: "absent" };
  const UNREADABLE_LIST: ResponderWhitelist = { kind: "unreadable", why: "responders.json is not valid JSON" };

  it("refuses a nonmember: zero handled, one refused, one refusal callback, no capture effect", async () => {
    const fake = fakeConnection({ texts: [mentionFrame({ envelopeId: "e-1", eventId: "Ev1" })] });
    const recorder = recordingHandler();
    const refusal = recordingRefusal();
    const logger = recordingLog();

    const result = await consumeMentions({
      connection: fake.connection,
      handler: recorder.handler,
      log: logger.log,
      refuseResponder: refusal.refuseResponder,
      responderHatchOpen: () => false,
      responderWhitelist: () => CLOSED_LIST,
      selfUserId: SELF_USER,
      seen: createDedupeState(),
    });

    expect(result.outcome.handled).toBe(0);
    expect(result.outcome.refused).toBe(1);
    expect(recorder.seen).toEqual([]);
    expect(refusal.calls.length).toBe(1);
    expect(refusal.calls[0]!.mention.userId).toBe("U0HUMAN");
    expect(logger.lines[0]).toContain("REFUSED a mention from U0HUMAN in C0LISTEN");
  });

  it("re-reads the list per mention, so an id added after a refusal is admitted on its next tag with no restart", async () => {
    const fake = fakeConnection({
      texts: [
        mentionFrame({ envelopeId: "e-1", eventId: "Ev1", ts: "1785114398.557099" }),
        mentionFrame({ envelopeId: "e-2", eventId: "Ev2", ts: "1785114458.557099" }),
      ],
    });
    const recorder = recordingHandler();
    const refused: string[] = [];
    let current: ResponderWhitelist = CLOSED_LIST;

    const result = await consumeMentions({
      connection: fake.connection,
      handler: recorder.handler,
      log: recordingLog().log,
      // The refusal is the moment `responders add` runs in the incident: the file changes under a live socket.
      refuseResponder: async ({ mention }) => {
        refused.push(mention.messageTs);
        current = ADMITS_U0HUMAN;
      },
      responderHatchOpen: () => false,
      responderWhitelist: () => current,
      selfUserId: SELF_USER,
      seen: createDedupeState(),
    });

    expect(result.outcome.refused).toBe(1);
    expect(result.outcome.handled).toBe(1);
    expect(refused).toEqual(["1785114398.557099"]);
    expect(recorder.seen.map((mention) => mention.messageTs)).toEqual(["1785114458.557099"]);
  });

  it.each([
    ["absent", ABSENT_LIST],
    ["empty", CLOSED_LIST],
    ["unreadable", UNREADABLE_LIST],
  ] as const)("refuses everyone when the list is %s", async (_label, whitelist) => {
    const fake = fakeConnection({ texts: [mentionFrame({ envelopeId: "e-1", eventId: "Ev1" })] });
    const refusal = recordingRefusal();

    const result = await consumeMentions({
      connection: fake.connection,
      handler: recordingHandler().handler,
      log: recordingLog().log,
      refuseResponder: refusal.refuseResponder,
      responderHatchOpen: () => false,
      responderWhitelist: () => whitelist,
      selfUserId: SELF_USER,
      seen: createDedupeState(),
    });

    expect(result.outcome.refused).toBe(1);
    expect(refusal.calls.length).toBe(1);
  });

  it("refuses a nonmember DM identically to a nonmember channel tag — the decision has no audience branch", async () => {
    const fake = fakeConnection({ texts: [messageFrame({ envelopeId: "e-dm", eventId: "EvDm" })] });
    const refusal = recordingRefusal();

    const result = await consumeMentions({
      connection: fake.connection,
      handler: recordingHandler().handler,
      log: recordingLog().log,
      refuseResponder: refusal.refuseResponder,
      responderHatchOpen: () => false,
      responderWhitelist: () => CLOSED_LIST,
      selfUserId: SELF_USER,
      seen: createDedupeState(),
    });

    expect(result.outcome.refused).toBe(1);
    expect(refusal.calls[0]!.mention.surface).toBe("dm");
  });

  it("admits a whitelisted DM exactly like a whitelisted channel tag", async () => {
    const fake = fakeConnection({ texts: [messageFrame({ envelopeId: "e-dm", eventId: "EvDm" })] });
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

    expect(result.outcome.handled).toBe(1);
    expect(recorder.seen.length).toBe(1);
  });

  it("redelivers a refused tag only once: one refusal callback, one dropped, both envelopes acknowledged", async () => {
    const fake = fakeConnection({
      texts: [
        mentionFrame({ envelopeId: "e-1", eventId: "Ev1" }),
        mentionFrame({ envelopeId: "e-2", eventId: "Ev1", retryAttempt: 1 }),
      ],
    });
    const refusal = recordingRefusal();

    const result = await consumeMentions({
      connection: fake.connection,
      handler: recordingHandler().handler,
      log: recordingLog().log,
      refuseResponder: refusal.refuseResponder,
      responderHatchOpen: () => false,
      responderWhitelist: () => CLOSED_LIST,
      selfUserId: SELF_USER,
      seen: createDedupeState(),
    });

    expect(refusal.calls.length).toBe(1);
    expect(result.outcome.refused).toBe(1);
    expect(result.outcome.dropped).toBe(1);
    expect(fake.acked).toEqual(["e-1", "e-2"]);
  });

  it("does not repeat a refusal across a carried reconnect, the same guarantee a redelivery gets", async () => {
    const first = fakeConnection({ texts: [mentionFrame({ envelopeId: "e-1", eventId: "Ev1" })] });
    const firstRefusal = recordingRefusal();
    const carried = await consumeMentions({
      connection: first.connection,
      handler: recordingHandler().handler,
      log: recordingLog().log,
      refuseResponder: firstRefusal.refuseResponder,
      responderHatchOpen: () => false,
      responderWhitelist: () => CLOSED_LIST,
      selfUserId: SELF_USER,
      seen: createDedupeState(),
    });
    const second = fakeConnection({ texts: [mentionFrame({ envelopeId: "e-9", eventId: "Ev1", retryAttempt: 1 })] });
    const secondRefusal = recordingRefusal();

    const result = await consumeMentions({
      connection: second.connection,
      handler: recordingHandler().handler,
      log: recordingLog().log,
      refuseResponder: secondRefusal.refuseResponder,
      responderHatchOpen: () => false,
      responderWhitelist: () => CLOSED_LIST,
      selfUserId: SELF_USER,
      seen: carried.seen,
    });

    expect(firstRefusal.calls.length).toBe(1);
    expect(secondRefusal.calls.length).toBe(0);
    expect(result.outcome.dropped).toBe(1);
  });

  it("counts a thrown refusal handler as failed, and never falls through to the mention handler", async () => {
    const fake = fakeConnection({ texts: [mentionFrame({ envelopeId: "e-1", eventId: "Ev1" })] });
    const recorder = recordingHandler();
    const throwingRefusal: ResponderRefusalHandler = async () => {
      throw new Error("the door threw");
    };
    const logger = recordingLog();

    const result = await consumeMentions({
      connection: fake.connection,
      handler: recorder.handler,
      log: logger.log,
      refuseResponder: throwingRefusal,
      responderHatchOpen: () => false,
      responderWhitelist: () => CLOSED_LIST,
      selfUserId: SELF_USER,
      seen: createDedupeState(),
    });

    expect(result.outcome.failed).toBe(1);
    expect(result.outcome.refused).toBe(1);
    expect(result.outcome.handled).toBe(0);
    expect(recorder.seen).toEqual([]);
    expect(logger.lines.some((line) => line.includes("responder refusal handler threw"))).toBe(true);
  });

  it("admits everyone via the break-glass override, even a nonmember against a closed list", async () => {
    const fake = fakeConnection({ texts: [mentionFrame({ envelopeId: "e-1", eventId: "Ev1" })] });
    const recorder = recordingHandler();

    const result = await consumeMentions({
      connection: fake.connection,
      handler: recorder.handler,
      log: recordingLog().log,
      refuseResponder: noRefusal,
      responderHatchOpen: () => true,
      responderWhitelist: () => ABSENT_LIST,
      selfUserId: SELF_USER,
      seen: createDedupeState(),
    });

    expect(result.outcome.handled).toBe(1);
    expect(result.outcome.refused).toBe(0);
    expect(recorder.seen.length).toBe(1);
  });

  it("asks the grant per address, so one opened after a refusal admits the next tag with no restart", async () => {
    const fake = fakeConnection({
      texts: [
        mentionFrame({ envelopeId: "e-1", eventId: "Ev1", ts: "1785114398.557099" }),
        mentionFrame({ envelopeId: "e-2", eventId: "Ev2", ts: "1785114458.557099" }),
      ],
    });
    const recorder = recordingHandler();
    const logger = recordingLog();
    let open = false;

    const result = await consumeMentions({
      connection: fake.connection,
      handler: recorder.handler,
      log: logger.log,
      // The refusal is the moment `hatch open responder-allow-open` runs: the grant appears under a live socket.
      refuseResponder: async () => {
        open = true;
      },
      responderHatchOpen: () => open,
      responderWhitelist: () => CLOSED_LIST,
      selfUserId: SELF_USER,
      seen: createDedupeState(),
    });

    expect(result.outcome.refused).toBe(1);
    expect(result.outcome.handled).toBe(1);
    expect(recorder.seen.map((mention) => mention.messageTs)).toEqual(["1785114458.557099"]);
    expect(logger.lines.filter((line) => line.includes("through the journalled responder-allow-open grant"))).toEqual([
      "admitted U0HUMAN, who is NOT on responders.json, through the journalled responder-allow-open grant",
    ]);
  });

  it("refuses again once the grant has closed, so a thirty-minute grant never outlives itself on a live socket", async () => {
    const fake = fakeConnection({
      texts: [
        mentionFrame({ envelopeId: "e-1", eventId: "Ev1", ts: "1785114398.557099" }),
        mentionFrame({ envelopeId: "e-2", eventId: "Ev2", ts: "1785114458.557099" }),
      ],
    });
    const recorder = recordingHandler();
    const refusal = recordingRefusal();
    const answers = [true, false];

    const result = await consumeMentions({
      connection: fake.connection,
      handler: recorder.handler,
      log: recordingLog().log,
      refuseResponder: refusal.refuseResponder,
      responderHatchOpen: () => answers.shift()!,
      responderWhitelist: () => CLOSED_LIST,
      selfUserId: SELF_USER,
      seen: createDedupeState(),
    });

    expect(result.outcome.handled).toBe(1);
    expect(result.outcome.refused).toBe(1);
    expect(recorder.seen.map((mention) => mention.messageTs)).toEqual(["1785114398.557099"]);
    expect(refusal.calls.map((call) => call.mention.messageTs)).toEqual(["1785114458.557099"]);
    expect(answers).toEqual([]);
  });

  it("closes the connection after one refusal when --once is set, so a refused-and-replied tag does not hang", async () => {
    const fake = fakeConnection({
      texts: [
        mentionFrame({ envelopeId: "e-1", eventId: "Ev1" }),
        mentionFrame({ envelopeId: "e-2", eventId: "Ev2", ts: "1785114400.000100" }),
      ],
    });
    const refusal = recordingRefusal();

    const result = await consumeMentions({
      connection: fake.connection,
      handler: recordingHandler().handler,
      log: recordingLog().log,
      refuseResponder: refusal.refuseResponder,
      responderHatchOpen: () => false,
      responderWhitelist: () => CLOSED_LIST,
      selfUserId: SELF_USER,
      seen: createDedupeState(),
      stopAfterFirst: true,
    });

    expect(refusal.calls.length).toBe(1);
    expect(result.outcome.refused).toBe(1);
    expect(fake.closed).toEqual(["--once resolved one address"]);
  });

  it("refuses a nonmember without ever calling addressStart — a refusal never enters the race", async () => {
    const fake = fakeConnection({ texts: [mentionFrame({ envelopeId: "e-1", eventId: "Ev1" })] });
    const calls: Mention[] = [];

    const result = await consumeMentions({
      addressStart: ({ mention }) => {
        calls.push(mention);
        return true;
      },
      connection: fake.connection,
      discardBufferedAfterFirst: true,
      handler: recordingHandler().handler,
      log: recordingLog().log,
      refuseResponder: noRefusal,
      responderHatchOpen: () => false,
      responderWhitelist: () => CLOSED_LIST,
      selfUserId: SELF_USER,
      seen: createDedupeState(),
      stopAfterFirst: true,
    });

    expect(result.outcome.refused).toBe(1);
    expect(calls).toEqual([]);
  });
});
