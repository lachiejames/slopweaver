/*
 * One connection's whole lifecycle, driven by plain fakes: a ticket that fails, a socket that never opens, a
 * signal that fired before the ticket came back, an idle socket torn down by an abort, and a drained connection
 * that satisfies `--once`.
 */
import { describe, expect, it } from "vitest";

import { oneConnection } from "../../../../../cli/commands/listen/oneConnection.js";
import { EXIT_OK } from "../../../../../cli/exitCodes.js";
import { createDedupeState } from "../../../../../live/listen/dedupe.js";
import { NO_THREAD_REPLIES } from "../../../../../live/listen/threadReply.js";
import { harness, mentionFrame } from "./run/harness.js";
import { flushMicrotasks, idleConnection } from "./run/seams.js";

describe("oneConnection", () => {
  it("names a refused ticket as the reason the connection ended, never reporting connected", async () => {
    const { deps, lines, socketStates } = harness({ script: ["no-ticket"] });
    const seen = createDedupeState();
    const step = await oneConnection({
      addressStart: () => true,
      appToken: "app-token",
      deps,
      discardBufferedAfterFirst: false,
      once: false,
      seen,
      signal: new AbortController().signal,
      threadReplies: NO_THREAD_REPLIES,
    });
    expect(step).toEqual({
      connectionRefusal: undefined,
      helloPermitted: false,
      kind: "ended",
      reason: "ticket-open-failed",
      seen,
      threadReplies: NO_THREAD_REPLIES,
    });
    expect(lines).toEqual(["could not open a Socket Mode ticket: Slack refused apps.connections.open: invalid_auth"]);
    expect(socketStates).toEqual(["connecting", "disconnected"]);
  });

  it("names a socket that never opened", async () => {
    const { deps, lines, socketStates } = harness({ script: ["no-socket"] });
    const seen = createDedupeState();
    const step = await oneConnection({
      addressStart: () => true,
      appToken: "app-token",
      deps,
      discardBufferedAfterFirst: false,
      once: false,
      seen,
      signal: new AbortController().signal,
      threadReplies: NO_THREAD_REPLIES,
    });
    expect(step).toEqual({
      connectionRefusal: undefined,
      helloPermitted: false,
      kind: "ended",
      reason: "socket-open-failed",
      seen,
      threadReplies: NO_THREAD_REPLIES,
    });
    expect(lines).toEqual(["the websocket did not open"]);
    expect(socketStates).toEqual(["connecting", "disconnected"]);
  });

  it("reports aborted, logging nothing, when the signal fired before the ticket came back", async () => {
    const { deps, lines, socketStates } = harness({ script: ["no-ticket"] });
    const controller = new AbortController();
    controller.abort("the deadline expired");
    const seen = createDedupeState();
    const step = await oneConnection({
      addressStart: () => true,
      appToken: "app-token",
      deps,
      discardBufferedAfterFirst: true,
      once: true,
      seen,
      signal: controller.signal,
      threadReplies: NO_THREAD_REPLIES,
    });
    expect(step).toEqual({ kind: "aborted", seen, threadReplies: NO_THREAD_REPLIES });
    expect(lines).toEqual([]);
    expect(socketStates).toEqual(["connecting", "disconnected"]);
  });

  it("cancels an idle open socket with the reason the aborting signal carries", async () => {
    const idle = idleConnection();
    const base = harness({ script: [] });
    const controller = new AbortController();
    const pending = oneConnection({
      addressStart: () => true,
      appToken: "app-token",
      deps: { ...base.deps, openConnection: async () => idle.connection },
      discardBufferedAfterFirst: true,
      once: true,
      seen: createDedupeState(),
      signal: controller.signal,
      threadReplies: NO_THREAD_REPLIES,
    });
    await flushMicrotasks();
    controller.abort("the operator stopped the listener");
    const step = await pending;
    expect(step.kind).toBe("aborted");
    expect(idle.cancelled).toEqual(["the operator stopped the listener"]);
    expect(base.socketStates).toEqual(["connecting", "connected", "disconnected"]);
  });

  it("cancels with a neutral reason when the aborting signal names none", async () => {
    const idle = idleConnection();
    const base = harness({ script: [] });
    const controller = new AbortController();
    const pending = oneConnection({
      addressStart: () => true,
      appToken: "app-token",
      deps: { ...base.deps, openConnection: async () => idle.connection },
      discardBufferedAfterFirst: true,
      once: true,
      seen: createDedupeState(),
      signal: controller.signal,
      threadReplies: NO_THREAD_REPLIES,
    });
    await flushMicrotasks();
    controller.abort("");
    await pending;
    expect(idle.cancelled).toEqual(["the connection was aborted"]);
  });

  it("exits once a single admitted address is handled under --once, and summarises the connection", async () => {
    const { deps, frames, handled, lines, socketStates } = harness({
      script: [[mentionFrame({ envelopeId: "E1", eventId: "Ev1" })]],
    });
    const step = await oneConnection({
      addressStart: () => true,
      appToken: "app-token",
      deps,
      discardBufferedAfterFirst: false,
      once: true,
      seen: createDedupeState(),
      signal: new AbortController().signal,
      threadReplies: NO_THREAD_REPLIES,
    });
    expect(step).toMatchObject({ code: EXIT_OK, kind: "exit", threadReplies: NO_THREAD_REPLIES });
    expect(handled).toEqual(["1785114398.557099"]);
    expect(frames()).toBe(1);
    expect(socketStates).toEqual(["connecting", "connected", "disconnected"]);
    expect(lines.at(-1)).toBe(
      "connection ended — 1 handled, 0 redelivered-and-dropped, 0 ignored, 0 refused by the responder whitelist, " +
        "0 failed, 0 abandoned-at-close",
    );
  });
});
