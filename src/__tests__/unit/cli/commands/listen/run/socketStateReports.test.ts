/** The socket-state and frame reports the supervision heartbeat reads, across opened and failed connections. */
import { describe, expect, it } from "vitest";

import { runListenLoop } from "../../../../../../cli/commands/listen/loop.js";
import { EIGHT_FAILURES, harness, mentionFrame } from "./harness.js";

describe("the socket-state and frame reports the supervision heartbeat depends on", () => {
  it("reports connecting then connected then disconnected across one whole connection", async () => {
    const fixture = harness({ script: [[mentionFrame({ envelopeId: "e-1", eventId: "Ev1" })]] });

    await runListenLoop({ appToken: "xapp-1", deps: fixture.deps, once: true });

    expect(fixture.socketStates).toEqual(["connecting", "connected", "disconnected"]);
  });

  it("reports connecting then disconnected when the ticket never opens, and never claims connected", async () => {
    const fixture = harness({ script: ["no-ticket", [mentionFrame({ envelopeId: "e-1", eventId: "Ev1" })]] });

    await runListenLoop({ appToken: "xapp-1", deps: fixture.deps, once: true });

    expect(fixture.socketStates.slice(0, 2)).toEqual(["connecting", "disconnected"]);
  });

  it("reports connecting then disconnected when the websocket itself never opens", async () => {
    const fixture = harness({ script: ["no-socket", [mentionFrame({ envelopeId: "e-1", eventId: "Ev1" })]] });

    await runListenLoop({ appToken: "xapp-1", deps: fixture.deps, once: true });

    expect(fixture.socketStates.slice(0, 2)).toEqual(["connecting", "disconnected"]);
  });

  it("counts EVERY frame, including one it goes on to ignore — the question is whether Slack is still talking", async () => {
    const fixture = harness({
      script: [['{"type":"hello"}', mentionFrame({ envelopeId: "e-1", eventId: "Ev1" })]],
    });

    await runListenLoop({ appToken: "xapp-1", deps: fixture.deps, once: true });

    expect(fixture.frames()).toBe(2);
  });

  it("reports no frames at all when no connection ever opens, so a beat cannot claim a live socket", async () => {
    const fixture = harness({ script: EIGHT_FAILURES });

    await runListenLoop({ appToken: "xapp-1", deps: fixture.deps, once: true });

    expect(fixture.frames()).toBe(0);
    expect(fixture.socketStates).not.toContain("connected");
  });
});
