/** The event stream's pure half: frames handed to their handlers, and how a stopped stream ends. */
import { describe, expect, it } from "vitest";

import type { CmuxEventHandlers } from "../../../cmux/eventStream.js";
import { dispatchFrames, endingOf, refusedError } from "../../../cmux/eventStreamEnding.js";

const SOCKET = "/tmp/cmux-test.sock";
const TOKEN = "v1.sentinel-capability-not-a-real-token";
const REFUSAL = "ERROR: Access denied - only processes started inside cmux can connect";

const ACK = JSON.stringify({
  boot_id: "B1",
  filters: { categories: [], names: [] },
  heartbeat_interval_seconds: 15,
  protocol: "cmux-events",
  replay_count: 0,
  resume: { after_seq: 1, gap: false, latest_seq: 1, next_seq: 2, oldest_seq: 1 },
  subscription_id: "S1",
  type: "ack",
  version: 1,
});

const EVENT = JSON.stringify({
  boot_id: "B1",
  category: "agent",
  id: "B1-2",
  name: "agent.hook.Stop",
  occurred_at: "2026-09-24T00:00:00.000Z",
  payload: { hook_event_name: "Stop" },
  seq: 2,
  surface_id: null,
  type: "event",
  version: 1,
  workspace_id: "W-1",
});

/** Handlers that write down what they were handed, in order. */
function recording(): { handlers: CmuxEventHandlers; seen: string[] } {
  const seen: string[] = [];
  return {
    handlers: {
      onAck: ({ ack }) => seen.push(`ack ${ack.subscriptionId}`),
      onEnd: () => seen.push("end"),
      onEvent: ({ event }) => seen.push(`event ${event.name}`),
    },
    seen,
  };
}

describe("dispatchFrames", () => {
  it("hands an ack and an event to their handlers and reports no refusal", () => {
    const { handlers, seen } = recording();

    expect(dispatchFrames({ capability: TOKEN, frames: [ACK, "keepalive", EVENT], handlers })).toBe(undefined);
    expect(seen).toEqual(["ack S1", "event agent.hook.Stop"]);
  });

  it("hands on an event with the presented capability already redacted out of it", () => {
    const cwds: (string | undefined)[] = [];
    const handlers: CmuxEventHandlers = {
      onAck: () => undefined,
      onEnd: () => undefined,
      onEvent: ({ event }) => cwds.push(event.cwd),
    };
    const echoed = EVENT.replace('"Stop"}', `"Stop","cwd":"/tmp/${TOKEN}"}`);

    dispatchFrames({ capability: TOKEN, frames: [echoed], handlers });
    expect(cwds).toEqual(["/tmp/<capability>"]);
  });

  it("stops at a refusal, handing on nothing after it", () => {
    const { handlers, seen } = recording();

    expect(dispatchFrames({ capability: TOKEN, frames: [REFUSAL, EVENT], handlers })).toBe(
      "Access denied - only processes started inside cmux can connect",
    );
    expect(seen).toEqual([]);
  });
});

describe("endingOf", () => {
  it("lets a buffered refusal outrank the reset that followed it", () => {
    const ending = endingOf({ buffer: REFUSAL, capability: TOKEN, cause: new Error("ECONNRESET"), socketPath: SOCKET });

    expect(ending!.code).toBe("SOCKET_UNAVAILABLE");
    expect(ending!.message).toContain("cmux refused the connection: Access denied");
  });

  it("types the buffered cmuxOnly refusal as access-denied", () => {
    const ending = endingOf({ buffer: REFUSAL, capability: TOKEN, cause: undefined, socketPath: SOCKET });

    expect(ending).toEqual({
      code: "SOCKET_UNAVAILABLE",
      message: `cmux control socket unavailable at ${SOCKET}: cmux refused the connection: Access denied - only processes started inside cmux can connect`,
      reason: "access-denied",
      socketPath: SOCKET,
    });
  });

  it("reports the socket's own error when nothing was refused", () => {
    const ending = endingOf({ buffer: "", capability: TOKEN, cause: new Error("ECONNRESET"), socketPath: SOCKET });

    expect(ending!.message).toBe(`cmux control socket unavailable at ${SOCKET}: ECONNRESET`);
  });

  it("reads a clean close with nothing buffered as a clean end", () => {
    expect(endingOf({ buffer: "", capability: TOKEN, cause: undefined, socketPath: SOCKET })).toBe(undefined);
  });
});

describe("refusedError", () => {
  it("carries cmux's words under SOCKET_UNAVAILABLE", () => {
    expect(refusedError({ refusal: "Access denied", socketPath: SOCKET }).message).toBe(
      `cmux control socket unavailable at ${SOCKET}: cmux refused the connection: Access denied`,
    );
  });
});
