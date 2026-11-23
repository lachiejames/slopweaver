/** The operator's own stop signal closes a connection, in ordinary and deadline mode alike. */
import { describe, expect, it } from "vitest";

import { type ListenDeps, runListenLoop } from "../../../../../../cli/commands/listen/loop.js";
import { EXIT_OK } from "../../../../../../cli/exitCodes.js";
import { ok } from "../../../../../../lib/result.js";
import { UNSCOPED } from "../../../../../../live/listen/scope.js";
import type { SocketConnection } from "../../../../../../live/listen/socket.js";
import { ADMITS_U0HUMAN, harness, mentionFrame, noRefusal } from "./harness.js";
import { controllableWait, flushMicrotasks, idleConnection } from "./seams.js";

describe("the operator's own stop signal", () => {
  const idleDeps = ({ connection }: { connection: SocketConnection }): ListenDeps => ({
    allowMultipleConnections: false,
    handler: async () => undefined,
    log: () => undefined,
    nowMs: () => 0,
    openConnection: async () => connection,
    openTicket: async () => ok("wss://fake"),
    refuseResponder: noRefusal,
    responderHatchOpen: () => false,
    responderWhitelist: () => ADMITS_U0HUMAN,
    scope: UNSCOPED,
    threadReplyChannels: [],
    wait: async () => "elapsed",
  });

  it("CLOSES an idle connection instead of leaving it to be torn down by the kill", async () => {
    const idle = idleConnection();
    const stop = new AbortController();

    const resultPromise = runListenLoop({
      appToken: "xapp-app",
      deps: idleDeps({ connection: idle.connection }),
      once: false,
      stopSignal: stop.signal,
    });
    await flushMicrotasks();
    stop.abort("the operator stopped this listener (SIGTERM)");
    const result = await resultPromise;

    expect(idle.cancelled).toEqual(["the operator stopped this listener (SIGTERM)"]);
    expect(result).toEqual({ code: EXIT_OK, kind: "exit" });
  });

  it("closes the connection in DEADLINE mode too — a signal outranks the race", async () => {
    const idle = idleConnection();
    const stop = new AbortController();
    const control = controllableWait();

    const resultPromise = runListenLoop({
      appToken: "xapp-app",
      deadlineMs: 5_000,
      deps: { ...idleDeps({ connection: idle.connection }), wait: control.wait },
      once: true,
      stopSignal: stop.signal,
    });
    await flushMicrotasks();
    stop.abort("the operator stopped this listener (SIGINT)");
    const result = await resultPromise;

    expect(idle.cancelled).toEqual(["the operator stopped this listener (SIGINT)"]);
    expect(result).toEqual({ code: EXIT_OK, kind: "exit" });
  });

  it("leaves a connection alone when nothing ever fires — the default signal has no controller at all", async () => {
    const fixture = harness({ script: [[mentionFrame({ envelopeId: "e-1", eventId: "Ev1" })]] });

    const result = await runListenLoop({ appToken: "xapp-app", deps: fixture.deps, once: true });

    expect(result).toEqual({ code: EXIT_OK, kind: "exit" });
    expect(fixture.handled).toEqual(["1785114398.557099"]);
  });
});
