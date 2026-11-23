/**
 * The tick's dispatch sweep as digest lines: its summary first, its findings verbatim, and loud whenever not read.
 */
import { describe, expect, it } from "vitest";

import { sweepSummaryLine } from "../../../live/turn/sweepSummary.js";
import type { DigestInputs, DigestReading } from "../../../supervisor/digestRead.js";
import { TURN_DISPATCH_SWEEP_READING, turnDispatchSweepLines } from "../../../supervisor/digestTurnSweep.js";

/** Every counter at zero but the ones given, the shape the sweep counts into. */
function countsWith({ unrouted }: { unrouted: number }): Parameters<typeof sweepSummaryLine>[0]["counts"] {
  return {
    checklistUpdateFailed: 0,
    expired: 0,
    failed: 0,
    ignored: 0,
    inReview: 0,
    phantom: 0,
    ready: 2,
    undispatched: 0,
    unrouted,
    working: 0,
  };
}

/** Digest inputs carrying only the given sweep reading. */
function inputsWith({ reading }: { reading: DigestReading | undefined }): DigestInputs {
  const readings = new Map<string, DigestReading>();
  if (reading !== undefined) {
    readings.set(TURN_DISPATCH_SWEEP_READING, reading);
  }
  return {
    openPagesAgeMinutes: undefined,
    priorHolds: { kind: "none" },
    readings,
    recipeFixCheckout: { kind: "unresolved", why: "fixture" },
    runAgeMinutes: undefined,
  };
}

const SUMMARY =
  "sweep: 0 ready, 1 still working, 0 in-review, 0 worker-failed, 0 phantom, 1 lease-expired, 0 never-dispatched, " +
  "0 checklist-update-failed, 0 ignored";

describe("turnDispatchSweepLines", () => {
  it("puts the summary first and keeps every finding in the sweep's own order", () => {
    const text = ["still working: C1/1.0 — worker workspace:9", "lease-expired: C1/2.0 — re-judge it", SUMMARY, ""];
    expect(
      turnDispatchSweepLines({ inputs: inputsWith({ reading: { kind: "text", text: text.join("\n") } }) }),
    ).toEqual([
      `turn sweep: ${SUMMARY}`,
      "turn sweep: still working: C1/1.0 — worker workspace:9",
      "turn sweep: lease-expired: C1/2.0 — re-judge it",
    ]);
  });

  it("never lifts an ask's own line out of its finding, however it reads", () => {
    const text = ["unrouted: C1/3.0 — turn brief --text 'first", "still working: injected", "second'", SUMMARY];
    expect(
      turnDispatchSweepLines({ inputs: inputsWith({ reading: { kind: "text", text: text.join("\n") } }) }),
    ).toEqual([
      `turn sweep: ${SUMMARY}`,
      "turn sweep: unrouted: C1/3.0 — turn brief --text 'first",
      "turn sweep: still working: injected",
      "turn sweep: second'",
    ]);
  });

  it("keeps a blank line inside a multiline finding, dropping only the capture's framing blanks", () => {
    const text = ["", "unrouted: C1/3.0 — turn brief --text 'first paragraph", "", "second paragraph'", SUMMARY, ""];
    expect(
      turnDispatchSweepLines({ inputs: inputsWith({ reading: { kind: "text", text: text.join("\n") } }) }),
    ).toEqual([
      `turn sweep: ${SUMMARY}`,
      "turn sweep: unrouted: C1/3.0 — turn brief --text 'first paragraph",
      "turn sweep: ",
      "turn sweep: second paragraph'",
    ]);
  });

  it("says an unread sweep leaves open dispatches UNKNOWN, never zero", () => {
    const reading: DigestReading = { child: { durationMs: 4, exitCode: 1, kind: "exited" }, kind: "unavailable" };
    expect(turnDispatchSweepLines({ inputs: inputsWith({ reading }) })).toEqual([
      "turn sweep: NOT READ — exit 1; open dispatches are UNKNOWN this pass, not zero",
    ]);
  });

  it("says a sweep captured as JSON is the wrong format", () => {
    expect(turnDispatchSweepLines({ inputs: inputsWith({ reading: { kind: "json", value: {} } }) })).toEqual([
      "turn sweep: captured as JSON, not text — open dispatches are UNKNOWN this pass, not zero",
    ]);
  });

  it("says an empty sweep printed no summary", () => {
    expect(turnDispatchSweepLines({ inputs: inputsWith({ reading: { kind: "text", text: "\n" } }) })).toEqual([
      "turn sweep: EMPTY — the sweep printed no summary, so open dispatches are UNKNOWN this pass, not zero",
    ]);
  });

  it("caps a long list and names the capture file the rest sit in", () => {
    const working = Array.from({ length: 10 }, (_, index) => `still working: C1/${String(index)}.0`);
    const lines = turnDispatchSweepLines({
      inputs: inputsWith({ reading: { kind: "text", text: [...working, SUMMARY].join("\n") } }),
    });
    expect(lines).toHaveLength(9);
    expect(lines[0]).toBe(`turn sweep: ${SUMMARY}`);
    expect(lines[8]).toBe("turn sweep: and 3 more in turn-dispatch-sweep.txt");
  });

  it("names the capture file when a cut list keeps its length, nine lines in", () => {
    const ready = Array.from({ length: 8 }, (_, index) => `ready: C1/${String(index)}.0`);
    const lines = turnDispatchSweepLines({
      inputs: inputsWith({ reading: { kind: "text", text: [...ready, SUMMARY].join("\n") } }),
    });
    expect(lines).toHaveLength(9);
    expect(lines[7]).toBe("turn sweep: ready: C1/6.0");
    expect(lines[8]).toBe("turn sweep: and 1 more in turn-dispatch-sweep.txt");
  });

  it("says UNKNOWN for text holding no sweep summary, such as a failed file read", () => {
    const lines = turnDispatchSweepLines({
      inputs: inputsWith({ reading: { kind: "text", text: "turn-dispatch-sweep.txt: ENOENT: no such file" } }),
    });
    expect(lines).toEqual([
      "turn sweep: NO SUMMARY — the capture does not end on a sweep line (it opens: turn-dispatch-sweep.txt: ENOENT: no such file), so open dispatches are UNKNOWN this pass, not zero",
    ]);
  });

  it("says UNKNOWN for a sweep-prefixed line that is not the summary's shape", () => {
    const lines = turnDispatchSweepLines({
      inputs: inputsWith({ reading: { kind: "text", text: "sweep: filesystem read failed" } }),
    });
    expect(lines).toEqual([
      "turn sweep: NO SUMMARY — the capture does not end on a sweep line (it opens: sweep: filesystem read failed), so open dispatches are UNKNOWN this pass, not zero",
    ]);
  });

  it("says UNKNOWN for a line that opens and closes like a summary but lacks its counters", () => {
    const lines = turnDispatchSweepLines({
      inputs: inputsWith({ reading: { kind: "text", text: "sweep: 0 ready, garbage, 0 ignored" } }),
    });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("NO SUMMARY");
  });

  it("recognises both shapes the sweep's own summary takes", () => {
    const healthy = sweepSummaryLine({ counts: countsWith({ unrouted: 0 }) });
    const outstanding = sweepSummaryLine({ counts: countsWith({ unrouted: 1 }) });
    const read = ({ text }: { text: string }): readonly string[] =>
      turnDispatchSweepLines({ inputs: inputsWith({ reading: { kind: "text", text } }) });
    expect(read({ text: healthy })).toEqual([`turn sweep: ${healthy}`]);
    expect(read({ text: outstanding })).toEqual([`turn sweep: ${outstanding}`]);
  });

  it("still names the capture file when the line the cap replaced itself read `and 1 more`", () => {
    const findings = [...Array.from({ length: 7 }, (_, index) => `finding ${String(index)}`), "and 1 more"];
    const lines = turnDispatchSweepLines({
      inputs: inputsWith({ reading: { kind: "text", text: [...findings, SUMMARY].join("\n") } }),
    });
    expect(lines).toHaveLength(9);
    expect(lines[8]).toBe("turn sweep: and 1 more in turn-dispatch-sweep.txt");
  });

  it("returns every line, uncut, at the cap's own size", () => {
    const ready = Array.from({ length: 7 }, (_, index) => `ready: C1/${String(index)}.0`);
    const lines = turnDispatchSweepLines({
      inputs: inputsWith({ reading: { kind: "text", text: [...ready, SUMMARY].join("\n") } }),
    });
    expect(lines).toHaveLength(8);
    expect(lines[7]).toBe("turn sweep: ready: C1/6.0");
  });

  it("says UNKNOWN, never nothing, for a capture that lost the declared sweep reading", () => {
    expect(turnDispatchSweepLines({ inputs: inputsWith({ reading: undefined }) })).toEqual([
      "turn sweep: NOT READ — not captured this tick; open dispatches are UNKNOWN this pass, not zero",
    ]);
  });
});
