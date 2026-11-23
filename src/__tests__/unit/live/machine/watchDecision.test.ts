/**
 * What one sample of `machine watch` should do. The rule under test is the one that keeps the supervisor
 * unwedged: **a row is written for every anomalous reading, and only the SEAT is rate-limited.** Suppressing
 * the row would leave the hold true, the gate refusing, and the operator's own way past the refusal
 * suppressed too — which is why every anomalous case below asserts a `dispatch`, seated or not.
 */
import { describe, expect, it } from "vitest";

import type { MachineAnomaly } from "../../../../live/machine/anomaly.js";
import type { DispatchRow } from "../../../../live/machine/dispatchRow.js";
import { watchDecision } from "../../../../live/machine/watchDecision.js";

const SIGNATURE = "hold+single-process|bfs|foreign";

/** The anomalous verdict every case here starts from. */
const ANOMALOUS: MachineAnomaly & { kind: "anomalous" } = {
  kind: "anomalous",
  signature: SIGNATURE,
  subject: { kill: "kill 4242", label: "bfs", sessionId: undefined, tree: [], why: "bfs at 301.2% cpu for 15m" },
  triggers: ["hold", "single-process"],
};

/** One row already in the register, with only what a case varies overridden. */
function row(over: Partial<DispatchRow> = {}): DispatchRow {
  return {
    id: "d1",
    load1: 45.9,
    observedIso: "2026-09-19T09:00:00.000Z",
    seated: { kind: "seated", slug: "investigate-bfs", workspace: "workspace:9" },
    settled: undefined,
    signature: SIGNATURE,
    subject: ANOMALOUS.subject,
    triggers: ["hold"],
    ...over,
  };
}

describe("watchDecision", () => {
  it("does nothing at all on a clear reading", () => {
    const decision = watchDecision({
      anomaly: { kind: "clear" },
      liveSignatures: new Set(),
      nowIso: "2026-09-19T09:00:00.000Z",
      rows: [],
    });

    expect(decision).toStrictEqual({ kind: "nothing" });
  });

  it("dispatches and seats when nobody is on the signature and no window is in force", () => {
    const decision = watchDecision({
      anomaly: ANOMALOUS,
      liveSignatures: new Set(),
      nowIso: "2026-09-19T09:00:00.000Z",
      rows: [],
    });

    expect(decision).toStrictEqual({ anomaly: ANOMALOUS, kind: "dispatch", seat: { kind: "open" } });
  });

  it("dispatches WITHOUT a seat when an investigation is already live on the signature", () => {
    const decision = watchDecision({
      anomaly: ANOMALOUS,
      liveSignatures: new Set([SIGNATURE]),
      nowIso: "2026-09-19T09:00:00.000Z",
      rows: [],
    });

    expect(decision).toStrictEqual({
      anomaly: ANOMALOUS,
      kind: "dispatch",
      seat: { kind: "skip", seated: { kind: "none", why: `an investigation is already live on ${SIGNATURE}` } },
    });
  });

  it("checks liveness BEFORE the backoff, so a running investigation never doubles the window", () => {
    const decision = watchDecision({
      anomaly: ANOMALOUS,
      liveSignatures: new Set([SIGNATURE]),
      nowIso: "2026-09-19T09:01:00.000Z",
      rows: [row(), row({ id: "d2" })],
    });

    expect(decision).toMatchObject({
      seat: { seated: { why: `an investigation is already live on ${SIGNATURE}` } },
    });
  });

  it("dispatches WITHOUT a seat inside the backoff window, naming the window and when it reopens", () => {
    const decision = watchDecision({
      anomaly: ANOMALOUS,
      liveSignatures: new Set(),
      nowIso: "2026-09-19T09:01:00.000Z",
      rows: [row()],
    });

    expect(decision).toStrictEqual({
      anomaly: ANOMALOUS,
      kind: "dispatch",
      seat: {
        kind: "skip",
        seated: {
          kind: "none",
          why:
            "backoff: 1 unsettled dispatch(es) on this signature, 300s window, " +
            "next seat at 2026-09-19T09:05:00.000Z",
        },
      },
    });
  });

  it("seats again once the window has elapsed", () => {
    const decision = watchDecision({
      anomaly: ANOMALOUS,
      liveSignatures: new Set(),
      nowIso: "2026-09-19T09:06:00.000Z",
      rows: [row()],
    });

    expect(decision).toStrictEqual({ anomaly: ANOMALOUS, kind: "dispatch", seat: { kind: "open" } });
  });

  it("ignores rows carrying a different signature", () => {
    const other = row({ id: "d9", signature: "process-count|session abc|abc" });
    const decision = watchDecision({
      anomaly: ANOMALOUS,
      liveSignatures: new Set(),
      nowIso: "2026-09-19T09:00:30.000Z",
      rows: [other],
    });

    expect(decision).toStrictEqual({ anomaly: ANOMALOUS, kind: "dispatch", seat: { kind: "open" } });
  });

  it("says so in words when the newest row's instant is unreadable, rather than seating on a guess", () => {
    const decision = watchDecision({
      anomaly: ANOMALOUS,
      liveSignatures: new Set(),
      nowIso: "2026-09-19T09:00:30.000Z",
      rows: [row({ observedIso: "" })],
    });

    expect(decision).toMatchObject({
      seat: {
        seated: {
          why:
            "backoff: 1 unsettled dispatch(es) on this signature, 300s window, " +
            "next seat at an unreadable instant on the newest row",
        },
      },
    });
  });
});
