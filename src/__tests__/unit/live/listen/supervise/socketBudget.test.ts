import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../../../lib/result.js";
import {
  armConnectionLines,
  parseSocketConnectionObservation,
  SLACK_SOCKET_CONNECTION_CAP,
  type SocketConnectionObservation,
} from "../../../../../live/listen/supervise/socketBudget.js";

const NOW_MS = Date.parse("2026-09-09T18:00:00.000Z");

const observation = (over: Partial<SocketConnectionObservation> = {}): SocketConnectionObservation => ({
  armId: "613dcc8e",
  connections: 1,
  observedAtIso: "2026-09-09T17:55:00.000Z",
  pid: 15770,
  ...over,
});

describe("parseSocketConnectionObservation", () => {
  it("round-trips a whole reading", () => {
    const parsed = unwrap(parseSocketConnectionObservation({ raw: observation({ connections: 10 }) }));

    expect(parsed.connections).toBe(10);
    expect(parsed.observedAtIso).toBe("2026-09-09T17:55:00.000Z");
    expect(parsed.armId).toBe("613dcc8e");
    expect(parsed.pid).toBe(15770);
  });

  it("accepts a reading with no arm — a hand-typed listener still observed the app's own count", () => {
    const parsed = unwrap(
      parseSocketConnectionObservation({ raw: { connections: 2, observedAtIso: "2026-09-09T17:55:00.000Z", pid: 91 } }),
    );

    expect(parsed.armId).toBe(undefined);
    expect(parsed.connections).toBe(2);
  });

  it("refuses a zero-length arm id rather than recording a reading nothing can be traced back to", () => {
    const failed = unwrapErr(parseSocketConnectionObservation({ raw: observation({ armId: "" }) }));

    expect(failed.code).toBe("LISTENER_STATE_INVALID");
    expect(failed.message).toContain("armId");
  });

  it("refuses a fractional count — `num_connections` is a whole number of sockets", () => {
    const failed = unwrapErr(parseSocketConnectionObservation({ raw: observation({ connections: 1.5 }) }));

    expect(failed.message).toContain("connections");
  });

  it("refuses a negative count", () => {
    const failed = unwrapErr(parseSocketConnectionObservation({ raw: observation({ connections: -1 }) }));

    expect(failed.message).toContain("connections");
  });

  it("refuses an unparseable instant, because the whole value of a reading is knowing how old it is", () => {
    const failed = unwrapErr(parseSocketConnectionObservation({ raw: observation({ observedAtIso: "yesterday" }) }));

    expect(failed.message).toContain("observedAtIso");
  });

  it("refuses a value that is not an object at all", () => {
    const failed = unwrapErr(parseSocketConnectionObservation({ raw: "10" }));

    expect(failed.message).toContain("socketConnections");
  });
});

describe("armConnectionLines", () => {
  it("says an arm opens BLIND when nothing has ever been observed, rather than printing nothing", () => {
    const lines = armConnectionLines({ nowMs: NOW_MS, observation: undefined });

    expect(lines.length).toBe(1);
    expect(lines[0]).toContain("no Socket Mode connection count has ever been observed");
    expect(lines[0]).toContain("opens blind");
    expect(lines[0]).toContain("10");
  });

  it("renders the count, the cap, the AGE and the author — never two instants to subtract", () => {
    const lines = armConnectionLines({ nowMs: NOW_MS, observation: observation({ connections: 10 }) });

    expect(lines[0]).toBe(
      "Slack last reported 10 of 10 Socket Mode connections for this app, 5m ago (arm 613dcc8e, pid 15770)",
    );
  });

  it("always names the reading a FLOOR, because a closed socket keeps counting", () => {
    const lines = armConnectionLines({ nowMs: NOW_MS, observation: observation() });

    expect(lines[1]).toContain("FLOOR, not a live count");
    expect(lines[1]).toContain("tens of minutes");
  });

  it("warns that an over-one reading may be refused while the arm waits for Slack's count to drain", () => {
    const lines = armConnectionLines({ nowMs: NOW_MS, observation: observation({ connections: 2 }) });

    expect(lines.length).toBe(3);
    expect(lines[2]).toBe(
      "more than one connection was open at that reading, so this arm is likely to be REFUSED at `hello` and " +
        "retry for up to 2m while Slack's count drains, exiting only if it still reports more than one — nothing " +
        "local frees a slot",
    );
  });

  it("stays silent about a refusal on a healthy single connection", () => {
    const lines = armConnectionLines({ nowMs: NOW_MS, observation: observation({ connections: 1 }) });

    expect(lines.length).toBe(2);
  });

  it("names the pid alone when the reading carries no arm", () => {
    const lines = armConnectionLines({
      nowMs: NOW_MS,
      observation: { connections: 1, observedAtIso: "2026-09-09T17:55:00.000Z", pid: 91 },
    });

    expect(lines[0]).toBe("Slack last reported 1 of 10 Socket Mode connections for this app, 5m ago (pid 91)");
  });

  it("renders a future-stamped reading as 0s rather than a negative age — two clocks, one home", () => {
    const lines = armConnectionLines({
      nowMs: NOW_MS,
      observation: observation({ observedAtIso: "2026-09-09T18:30:00.000Z" }),
    });

    expect(lines[0]).toContain("0s ago");
  });

  it("caps at Slack's own ten, reported as context rather than as this repo's threshold", () => {
    expect(SLACK_SOCKET_CONNECTION_CAP).toBe(10);
  });
});
