/**
 * Deadline mode: `addressStart` decides the race before the handler runs, and the winning address cancels
 * rather than closes, awaiting the teardown it races on and nothing else.
 */
import { describe, expect, it } from "vitest";

import { createDedupeState } from "../../../../../live/listen/dedupe.js";
import type { Mention, MentionHandler } from "../../../../../live/listen/mention.js";
import { consumeMentions, type SocketConnection } from "../../../../../live/listen/socket.js";
import type { ResponderWhitelist } from "../../../../../live/listen/whitelist.js";
import { mentionFrame, SELF_USER } from "./fixtures.js";
import {
  ADMITS_U0HUMAN,
  fakeConnection,
  noRefusal,
  recordingHandler,
  recordingLog,
  recordingRefusal,
} from "./harness.js";

describe("consumeMentions — deadline mode (addressStart, discardBufferedAfterFirst)", () => {
  it("calls addressStart for an admitted mention before the handler runs, and it wins by default", async () => {
    const fake = fakeConnection({ texts: [mentionFrame({ envelopeId: "e-1", eventId: "Ev1" })] });
    const recorder = recordingHandler();
    const calls: Mention[] = [];

    const result = await consumeMentions({
      addressStart: ({ mention }) => {
        calls.push(mention);
        return true;
      },
      connection: fake.connection,
      discardBufferedAfterFirst: true,
      handler: recorder.handler,
      log: recordingLog().log,
      refuseResponder: noRefusal,
      responderHatchOpen: () => false,
      responderWhitelist: () => ADMITS_U0HUMAN,
      selfUserId: SELF_USER,
      seen: createDedupeState(),
      stopAfterFirst: true,
    });

    expect(calls.length).toBe(1);
    expect(calls[0]!.userId).toBe("U0HUMAN");
    expect(recorder.seen.length).toBe(1);
    expect(result.outcome.handled).toBe(1);
  });

  it("a rejected addressStart runs no handler and no capture effect", async () => {
    const fake = fakeConnection({ texts: [mentionFrame({ envelopeId: "e-1", eventId: "Ev1" })] });
    const recorder = recordingHandler();
    const logger = recordingLog();

    const result = await consumeMentions({
      addressStart: () => false,
      connection: fake.connection,
      discardBufferedAfterFirst: true,
      handler: recorder.handler,
      log: logger.log,
      refuseResponder: noRefusal,
      responderHatchOpen: () => false,
      responderWhitelist: () => ADMITS_U0HUMAN,
      selfUserId: SELF_USER,
      seen: createDedupeState(),
      stopAfterFirst: true,
    });

    expect(recorder.seen).toEqual([]);
    expect(result.outcome.handled).toBe(0);
    expect(logger.lines.some((line) => line.includes("already won"))).toBe(true);
  });

  it("discardBufferedAfterFirst: true CANCELS on the winning address, never closes", async () => {
    const fake = fakeConnection({
      texts: [
        mentionFrame({ envelopeId: "e-1", eventId: "Ev1" }),
        mentionFrame({ envelopeId: "e-2", eventId: "Ev2", ts: "1785114400.000100" }),
      ],
    });

    const result = await consumeMentions({
      connection: fake.connection,
      discardBufferedAfterFirst: true,
      handler: recordingHandler().handler,
      log: recordingLog().log,
      refuseResponder: noRefusal,
      responderHatchOpen: () => false,
      responderWhitelist: () => ADMITS_U0HUMAN,
      selfUserId: SELF_USER,
      seen: createDedupeState(),
      stopAfterFirst: true,
    });

    expect(fake.cancelled).toEqual(["deadline mode resolved one address"]);
    expect(fake.closed).toEqual([]);
    expect(result.outcome.handled).toBe(1);
  });

  /**
   * The exact R1 finding a Codex review pass caught: `closeIfSatisfied` used to call `connection.cancel`
   * without awaiting its returned promise, so `consumeMentions` could resolve before the real transport
   * teardown the promise represents had actually settled. A connection whose `cancel` deliberately resolves
   * late proves the fix — this test fails if `consumeMentions` ever resolves before `cancel`'s own promise
   * does, since `resolvedBeforeCancelSettled` would be `false` instead of `undefined`.
   */
  it("awaits the connection's own teardown promise before resolving — never races ahead of it", async () => {
    const texts = [mentionFrame({ envelopeId: "e-1", eventId: "Ev1" })];
    let ended: string | undefined;
    // First reason wins: a later cancel or close never rewrites why the connection ended.
    const endWith = ({ why }: { why: string }): void => {
      if (ended !== undefined) {
        return;
      }
      ended = why;
    };
    let cancelSettled = false;
    const connection: SocketConnection = {
      acknowledge: () => undefined,
      cancel: async ({ why }) => {
        endWith({ why });
        await new Promise<void>((resolve) => {
          setTimeout(resolve, 20);
        });
        cancelSettled = true;
      },
      close: async ({ why }) => {
        endWith({ why });
      },
      discarded: () => 0,
      endedBecause: () => ended,
      frames: async function* frames() {
        for (const text of texts) {
          if (ended !== undefined) {
            continue;
          }
          yield text;
        }
      },
    };

    const result = await consumeMentions({
      connection,
      discardBufferedAfterFirst: true,
      handler: recordingHandler().handler,
      log: recordingLog().log,
      refuseResponder: noRefusal,
      responderHatchOpen: () => false,
      responderWhitelist: () => ADMITS_U0HUMAN,
      selfUserId: SELF_USER,
      seen: createDedupeState(),
      stopAfterFirst: true,
    });
    const resolvedBeforeCancelSettled = !cancelSettled;

    expect(result.outcome.handled).toBe(1);
    expect(resolvedBeforeCancelSettled).toBe(false);
    expect(cancelSettled).toBe(true);
  });

  it("default discardBufferedAfterFirst (false) keeps closing gracefully, unchanged", async () => {
    const fake = fakeConnection({ texts: [mentionFrame({ envelopeId: "e-1", eventId: "Ev1" })] });

    await consumeMentions({
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

    expect(fake.closed).toEqual(["--once resolved one address"]);
    expect(fake.cancelled).toEqual([]);
  });

  /**
   * The exact R2 finding a Codex review pass caught in the FIRST fix for the above: awaiting `close`'s
   * returned promise unconditionally (the way `cancel` correctly is, in deadline mode) traded "the deadline
   * race can misreport its winner" for "a peer whose close handshake never settles and never errors hangs an
   * ordinary `--once` run forever" — a real regression, since fire-and-forget was the pre-existing, correct
   * shape here. `close` below never resolves; this test fails (times out) if `consumeMentions` ever awaits it.
   */
  it("does not wait for close to settle in the ordinary (non-deadline) path — nothing here is racing on it", async () => {
    const texts = [mentionFrame({ envelopeId: "e-1", eventId: "Ev1" })];
    let ended: string | undefined;
    // First reason wins: a later cancel or close never rewrites why the connection ended.
    const endWith = ({ why }: { why: string }): void => {
      if (ended !== undefined) {
        return;
      }
      ended = why;
    };
    const connection: SocketConnection = {
      acknowledge: () => undefined,
      cancel: async ({ why }) => {
        endWith({ why });
      },
      close: ({ why }): Promise<void> => {
        endWith({ why });
        return new Promise<void>(() => undefined);
      },
      discarded: () => 0,
      endedBecause: () => ended,
      frames: async function* frames() {
        for (const text of texts) {
          if (ended !== undefined) {
            continue;
          }
          yield text;
        }
      },
    };

    const result = await consumeMentions({
      connection,
      handler: recordingHandler().handler,
      log: recordingLog().log,
      refuseResponder: noRefusal,
      responderHatchOpen: () => false,
      responderWhitelist: () => ADMITS_U0HUMAN,
      selfUserId: SELF_USER,
      seen: createDedupeState(),
      stopAfterFirst: true,
    });

    expect(result.outcome.handled).toBe(1);
    expect(ended).toBe("--once resolved one address");
  });

  /**
   * The exact P3 finding this fixes: `closeIfSatisfied` used to treat a refusal as satisfying deadline
   * mode's close too, which either broke the exactly-one-event contract or locked an eligible Slack address
   * out for the rest of the wait. In deadline mode, ONLY an admitted handler starting may close anything.
   */
  it("a refusal alone does NOT cancel the connection in deadline mode — the wait must continue", async () => {
    const closedWhitelist: ResponderWhitelist = { identities: [], kind: "list" };
    const fake = fakeConnection({ texts: [mentionFrame({ envelopeId: "e-1", eventId: "Ev1" })] });
    const refusal = recordingRefusal();

    const result = await consumeMentions({
      connection: fake.connection,
      discardBufferedAfterFirst: true,
      handler: recordingHandler().handler,
      log: recordingLog().log,
      refuseResponder: refusal.refuseResponder,
      responderHatchOpen: () => false,
      responderWhitelist: () => closedWhitelist,
      selfUserId: SELF_USER,
      seen: createDedupeState(),
      stopAfterFirst: true,
    });

    expect(result.outcome.refused).toBe(1);
    expect(fake.cancelled).toEqual([]);
    expect(fake.closed).toEqual([]);
  });

  /**
   * The reasoning this REVERSES, stated so the reversal is legible rather than silent: an earlier version
   * gated deadline mode's close on `handled` alone, deliberately NOT closing after a thrown handler — hoping
   * a LATER admitted address might still arrive and succeed, since `AddressStart`'s latch only excludes the
   * clock, never a second Slack address. Two review passes converged on the failure mode that reasoning
   * missed: `AddressStart` admitting ANY address already disables the clock permanently, so if no second
   * address ever arrives, the connection waits forever with nothing left to end it — hanging silently rather
   * than reporting the judgeable "no JSON, non-zero exit" `skills/loop/SKILL.md`'s own protocol already knows how
   * to handle. Closing on a concluded failure, not just a concluded success, is the fix.
   */
  it("a throwing handler DOES cancel the connection in deadline mode — nothing is left to end it otherwise", async () => {
    const fake = fakeConnection({ texts: [mentionFrame({ envelopeId: "e-1", eventId: "Ev1" })] });
    const throwingHandler: MentionHandler = async () => {
      throw new Error("appendQueueLine threw");
    };

    const result = await consumeMentions({
      connection: fake.connection,
      discardBufferedAfterFirst: true,
      handler: throwingHandler,
      log: recordingLog().log,
      refuseResponder: noRefusal,
      responderHatchOpen: () => false,
      responderWhitelist: () => ADMITS_U0HUMAN,
      selfUserId: SELF_USER,
      seen: createDedupeState(),
      stopAfterFirst: true,
    });

    expect(result.outcome.failed).toBe(1);
    expect(result.outcome.handled).toBe(0);
    expect(fake.cancelled).toEqual(["deadline mode resolved one address"]);
    expect(fake.closed).toEqual([]);
  });
});
