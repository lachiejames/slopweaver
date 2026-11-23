/**
 * The connect → drain → reconnect loop with no deadline: it comes back after a routine rotation, it backs off on
 * a failure, it drops a redelivery that arrives on a LATER connection, and it gives up rather than spinning
 * forever.
 */
import { describe, expect, it } from "vitest";

import { type ListenDeps, runListenLoop } from "../../../../../../cli/commands/listen/loop.js";
import { EXIT_ERROR, EXIT_OK } from "../../../../../../cli/exitCodes.js";
import { RECONNECT_MAX_FAILURES } from "../../../../../../live/listen/reconnect.js";
import {
  advancingClock,
  EIGHT_FAILURES,
  exitCodeOf,
  HELLO_ONE,
  HELLO_TWO,
  harness,
  mentionFrame,
  STOP_FRAME,
} from "./harness.js";

describe("runListenLoop", () => {
  it("handles one mention and exits under --once", async () => {
    const fixture = harness({ script: [[mentionFrame({ envelopeId: "e-1", eventId: "Ev1" })]] });

    const result = await runListenLoop({ appToken: "xapp-app", deps: fixture.deps, once: true });
    const code = exitCodeOf({ result });

    expect(code).toBe(EXIT_OK);
    expect(fixture.handled).toEqual(["1785114398.557099"]);
    expect(fixture.waits).toEqual([]);
  });

  it("retries a refused hello under --once, never handling what it buffered, and answers once the count drains", async () => {
    const fixture = harness({
      script: [
        [HELLO_TWO, mentionFrame({ envelopeId: "e-1", eventId: "Ev1" })],
        [HELLO_ONE, mentionFrame({ envelopeId: "e-2", eventId: "Ev2" })],
      ],
    });

    const result = await runListenLoop({ appToken: "xapp-app", deps: fixture.deps, once: true });
    const code = exitCodeOf({ result });

    expect(code).toBe(EXIT_OK);
    expect(fixture.waits).toEqual([1_000]);
    expect(fixture.handled).toEqual(["1785114398.557099"]);
    expect(fixture.lines).toContain(
      "REFUSED: Slack reports 2 connections for this app — a tag can be delivered to either one, and only " +
        "one of them will answer. Stop the other listener and retry.",
    );
    expect(fixture.lines).toContain(
      "retrying in 1000ms — Slack may still be counting a socket this listener lost (0ms into a 120000ms " +
        "grace window)",
    );
  });

  it("survives an arm's death: a live socket errors, and the reconnect is told 2 by its own ghost", async () => {
    const fixture = harness({
      script: [
        // Two failures before the socket went live — what that arm carried for 22 minutes into its error.
        "no-ticket",
        "no-ticket",
        [HELLO_ONE],
        [HELLO_TWO],
        [HELLO_ONE, mentionFrame({ envelopeId: "e-2", eventId: "Ev2" })],
      ],
    });

    const result = await runListenLoop({ appToken: "xapp-app", deps: fixture.deps, once: false });
    const code = exitCodeOf({ result });

    // Ends on the script's own link_disabled, never on the refusal.
    expect(code).toBe(EXIT_ERROR);
    // The live socket reset the count: its ending waits 1s, not the 4s the incident's log shows, and the
    // refusal after it opens its own schedule at 1s.
    expect(fixture.waits).toEqual([1_000, 2_000, 1_000, 1_000, 1_000]);
    expect(fixture.handled).toEqual(["1785114398.557099"]);
    expect(fixture.lines.filter((line) => line.includes("re-enable Socket Mode")).length).toBe(1);
  });

  it("exits on the first refused hello past the grace window, with the failure budget never cutting it short", async () => {
    const fixture = harness({ script: Array.from({ length: 12 }, () => [HELLO_TWO]) });

    const result = await runListenLoop({
      appToken: "xapp-app",
      deps: advancingClock({ deps: fixture.deps }),
      once: false,
    });
    const code = exitCodeOf({ result });

    expect(code).toBe(EXIT_ERROR);
    expect(fixture.waits).toEqual([1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000, 30_000]);
    expect(fixture.lines.filter((line) => line.startsWith("REFUSED:")).length).toBe(9);
    expect(fixture.lines).toContain(
      "stopping: Slack still reports 2 connections 121000ms after the first refused hello, past the 120000ms " +
        "grace for a socket this listener lost to drain — another listener holds this app. Stop it and retry.",
    );
  });

  it("a refused hello never spends the failure budget, so a ticket failing after eight refusals is still retried", async () => {
    const fixture = harness({
      script: [
        ...Array.from({ length: RECONNECT_MAX_FAILURES }, () => [HELLO_TWO]),
        "no-ticket",
        [HELLO_ONE, mentionFrame({ envelopeId: "e-1", eventId: "Ev1" })],
      ],
    });

    const result = await runListenLoop({
      appToken: "xapp-app",
      deps: advancingClock({ deps: fixture.deps }),
      once: true,
    });

    expect(exitCodeOf({ result })).toBe(EXIT_OK);
    // The refusals keep their own schedule; the ticket failure after them starts the budget's at 1s.
    expect(fixture.waits).toEqual([1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000, 30_000, 1_000]);
    expect(fixture.handled).toEqual(["1785114398.557099"]);
  });

  it("a permitted hello resets the consecutive-failure count, so a long-lived arm's old failures stop counting", async () => {
    const fixture = harness({
      script: [
        "no-ticket",
        "no-ticket",
        [HELLO_ONE],
        "no-ticket",
        [mentionFrame({ envelopeId: "e-1", eventId: "Ev1" })],
      ],
    });

    const result = await runListenLoop({ appToken: "xapp-app", deps: fixture.deps, once: true });

    expect(exitCodeOf({ result })).toBe(EXIT_OK);
    expect(fixture.waits).toEqual([1_000, 2_000, 1_000, 2_000]);
  });

  it("a permitted hello closes the refusal streak, so a later refusal opens a fresh window", async () => {
    const instants = [0, 500_000];
    const fixture = harness({
      script: [[HELLO_TWO], [HELLO_ONE], [HELLO_TWO], [HELLO_ONE, mentionFrame({ envelopeId: "e-1", eventId: "Ev1" })]],
    });
    const deps: ListenDeps = { ...fixture.deps, nowMs: () => instants.shift()! };

    const result = await runListenLoop({ appToken: "xapp-app", deps, once: true });

    // A streak still open from instant 0 would refuse at 500000ms; a closed one retries, its backoff fresh too.
    expect(exitCodeOf({ result })).toBe(EXIT_OK);
    expect(fixture.waits).toEqual([1_000, 1_000, 1_000]);
    expect(instants).toEqual([]);
  });

  it("reconnects with no delay after Slack's routine rotation, and does not spend the failure budget", async () => {
    const fixture = harness({
      script: [
        [JSON.stringify({ reason: "warning", type: "disconnect" })],
        [mentionFrame({ envelopeId: "e-2", eventId: "Ev2" })],
      ],
    });

    const result = await runListenLoop({ appToken: "xapp-app", deps: fixture.deps, once: true });
    const code = exitCodeOf({ result });

    expect(code).toBe(EXIT_OK);
    expect(fixture.waits).toEqual([0]);
    expect(fixture.handled).toEqual(["1785114398.557099"]);
  });

  it("backs off before retrying a ticket that Slack refused, and prints Slack's reason", async () => {
    const fixture = harness({ script: ["no-ticket", [mentionFrame({ envelopeId: "e-1", eventId: "Ev1" })]] });

    await runListenLoop({ appToken: "xapp-app", deps: fixture.deps, once: true });

    expect(fixture.waits).toEqual([1_000]);
    expect(fixture.lines).toContain(
      "could not open a Socket Mode ticket: Slack refused apps.connections.open: invalid_auth",
    );
  });

  it("backs off when the websocket itself never opens", async () => {
    const fixture = harness({ script: ["no-socket", [mentionFrame({ envelopeId: "e-1", eventId: "Ev1" })]] });

    await runListenLoop({ appToken: "xapp-app", deps: fixture.deps, once: true });

    expect(fixture.waits).toEqual([1_000]);
    expect(fixture.lines).toContain("the websocket did not open");
  });

  it("gives up after the consecutive-failure budget rather than looping forever", async () => {
    const fixture = harness({ script: EIGHT_FAILURES });

    const result = await runListenLoop({
      appToken: "xapp-app",
      deps: fixture.deps,
      once: false,
    });
    const code = exitCodeOf({ result });

    expect(code).toBe(EXIT_ERROR);
    expect(fixture.waits).toEqual([1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000, 30_000]);
  });

  it("stops immediately when Slack says the Socket Mode link is disabled", async () => {
    const fixture = harness({ script: [[STOP_FRAME]] });

    const result = await runListenLoop({
      appToken: "xapp-app",
      deps: fixture.deps,
      once: false,
    });
    const code = exitCodeOf({ result });

    expect(code).toBe(EXIT_ERROR);
    expect(fixture.waits).toEqual([]);
    expect(fixture.lines.filter((line) => line.includes("re-enable Socket Mode")).length).toBe(1);
  });

  it("drops a redelivery that arrives on a LATER connection, which is when one actually shows up", async () => {
    const fixture = harness({
      script: [
        [mentionFrame({ envelopeId: "e-1", eventId: "Ev1" })],
        [mentionFrame({ envelopeId: "e-2", eventId: "Ev1", retryAttempt: 1 })],
      ],
    });

    await runListenLoop({ appToken: "xapp-app", deps: fixture.deps, once: false });

    expect(fixture.handled).toEqual(["1785114398.557099"]);
    expect(fixture.lines.filter((line) => line.startsWith("dropped a redelivered mention")).length).toBe(1);
  });

  it("summarises each connection so a long session can be read without the whole log", async () => {
    const fixture = harness({ script: [[mentionFrame({ envelopeId: "e-1", eventId: "Ev1" })]] });

    await runListenLoop({ appToken: "xapp-app", deps: fixture.deps, once: true });

    expect(fixture.lines).toContain(
      "connection ended — 1 handled, 0 redelivered-and-dropped, 0 ignored, 0 refused by the responder " +
        "whitelist, 0 failed, 0 abandoned-at-close",
    );
  });

  it("closes under --once on a refusal too, with zero handled and no capture effect", async () => {
    const fixture = harness({ script: [[mentionFrame({ envelopeId: "e-1", eventId: "Ev1" })]] });
    const deps: ListenDeps = { ...fixture.deps, responderWhitelist: () => ({ identities: [], kind: "list" }) };

    const result = await runListenLoop({ appToken: "xapp-app", deps, once: true });
    const code = exitCodeOf({ result });

    expect(code).toBe(EXIT_OK);
    expect(fixture.handled).toEqual([]);
    expect(fixture.lines).toContain(
      "connection ended — 0 handled, 0 redelivered-and-dropped, 0 ignored, 1 refused by the responder " +
        "whitelist, 0 failed, 0 abandoned-at-close",
    );
  });
});
