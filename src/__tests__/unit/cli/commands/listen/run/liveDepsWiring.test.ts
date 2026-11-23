/** `liveDeps` forwards the supervision beat's callbacks and the hello count into the loop's seams. */
import { describe, expect, it } from "vitest";

import { liveDeps } from "../../../../../../cli/commands/listen/liveListenDeps.js";
import { UNSCOPED } from "../../../../../../live/listen/scope.js";
import type { ListenerSocketState } from "../../../../../../live/listen/supervise/heartbeat.js";
import { ADMITS_U0HUMAN, noRefusal } from "./harness.js";

describe("liveDeps wiring", () => {
  const wiringArgs = {
    allowMultipleConnections: false,
    handler: async () => undefined,
    log: () => undefined,
    onHello: () => undefined,
    refuseResponder: noRefusal,
    responderHatchOpen: () => false,
    scope: UNSCOPED,
    threadReplyChannels: [],
    responderWhitelist: () => ADMITS_U0HUMAN,
    self: { botId: undefined, userId: undefined },
  };

  it("FORWARDS the beat's callbacks — the wiring that was silently dropped by a conditional spread", () => {
    const states: string[] = [];
    let frames = 0;
    const beat = {
      beatNow: () => undefined,
      noteFrame: () => {
        frames += 1;
      },
      noteSocketState: ({ state }: { state: ListenerSocketState }) => {
        states.push(state);
      },
      stop: () => undefined,
    };

    const deps = liveDeps({ ...wiringArgs, beat });
    deps.onSocketState?.({ state: "connected" });
    deps.onSocketFrame?.();

    expect(states).toEqual(["connected"]);
    expect(frames).toBe(1);
  });

  it("leaves both callbacks absent when no beat is supervising, so an unsupervised listener costs nothing", () => {
    const deps = liveDeps({ ...wiringArgs, beat: undefined });

    expect(deps.onSocketState).toBe(undefined);
    expect(deps.onSocketFrame).toBe(undefined);
  });

  it("FORWARDS onHello even with no beat — the connection count is about the app, not about one arm", () => {
    const counts: number[] = [];
    const deps = liveDeps({
      ...wiringArgs,
      beat: undefined,
      onHello: ({ connections }) => {
        counts.push(connections);
      },
    });

    deps.onHello?.({ connections: 10 });

    expect(counts).toEqual([10]);
  });
});
