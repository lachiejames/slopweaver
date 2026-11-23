/**
 * The seat backoff: how long the fleet waits before opening a SECOND investigation on a signature nobody has
 * settled. The property under test is the one `backoff.ts`'s header names — it gates the seat and never the
 * row — so every case here asks only whether a seat is allowed, and what window decided it.
 */
import { describe, expect, it } from "vitest";

import { BASE_BACKOFF_SECONDS, backoffFor, MAX_DOUBLINGS } from "../../../../live/machine/backoff.js";
import type { DispatchRow } from "../../../../live/machine/dispatchRow.js";

const SIGNATURE = "hold|bfs|foreign";

const MACHINE_SIGNATURE = "hold|hold on cpu|foreign";

/** One row carrying only what the backoff reads: when it was observed, and whether it was settled. */
function row(over: Partial<DispatchRow> = {}): DispatchRow {
  return {
    id: "d1",
    load1: 45.9,
    observedIso: "2026-09-19T09:00:00.000Z",
    seated: { kind: "seated", slug: "investigate-bfs", workspace: "workspace:9" },
    settled: undefined,
    signature: SIGNATURE,
    subject: { kill: "kill 4242", label: "bfs", sessionId: undefined, tree: [], why: "bfs at 301% cpu" },
    triggers: ["hold"],
    ...over,
  };
}

/**
 * A row whose subject is the MACHINE — `anomaly.ts#machineSubject`'s shape, and the only one in the tree
 * that carries no `kill`, because there is nothing a settler could have removed.
 */
function machineRow(over: Partial<DispatchRow> = {}): DispatchRow {
  return row({
    signature: MACHINE_SIGNATURE,
    subject: {
      kill: undefined,
      label: "hold on cpu",
      sessionId: undefined,
      tree: [],
      why: "HOLD on cpu — no single process or session is an outlier",
    },
    ...over,
  });
}

describe("backoffFor", () => {
  it("allows a seat when no dispatch has ever fired on the signature", () => {
    const verdict = backoffFor({ nowIso: "2026-09-19T09:00:00.000Z", rows: [] });

    expect(verdict.maySeat).toBe(true);
    expect(verdict.consecutive).toBe(0);
    expect(verdict.windowSeconds).toBe(BASE_BACKOFF_SECONDS);
    expect(verdict.nextSeatIso).toBe(undefined);
  });

  it("refuses a seat inside the base window and says exactly when it reopens", () => {
    const verdict = backoffFor({ nowIso: "2026-09-19T09:04:00.000Z", rows: [row()] });

    expect(verdict.maySeat).toBe(false);
    expect(verdict.consecutive).toBe(1);
    expect(verdict.windowSeconds).toBe(300);
    expect(verdict.nextSeatIso).toBe("2026-09-19T09:05:00.000Z");
  });

  it("allows a seat the instant the window elapses", () => {
    const verdict = backoffFor({ nowIso: "2026-09-19T09:05:00.000Z", rows: [row()] });

    expect(verdict.maySeat).toBe(true);
    expect(verdict.nextSeatIso).toBe(undefined);
  });

  it("doubles the window for each consecutive unsettled dispatch", () => {
    const rows = [
      row({ id: "d3", observedIso: "2026-09-19T09:20:00.000Z" }),
      row({ id: "d2", observedIso: "2026-09-19T09:10:00.000Z" }),
      row({ id: "d1", observedIso: "2026-09-19T09:00:00.000Z" }),
    ];
    const verdict = backoffFor({ nowIso: "2026-09-19T09:25:00.000Z", rows });

    expect(verdict.consecutive).toBe(3);
    expect(verdict.windowSeconds).toBe(1200);
    expect(verdict.maySeat).toBe(false);
    expect(verdict.nextSeatIso).toBe("2026-09-19T09:40:00.000Z");
  });

  it("caps the doubling, so a signature can never become permanently un-investigable", () => {
    const rows = Array.from({ length: 40 }, (_unused, index) =>
      row({ id: `d${String(index)}`, observedIso: "2026-09-19T09:00:00.000Z" }),
    );
    const verdict = backoffFor({ nowIso: "2026-09-19T09:00:01.000Z", rows });

    expect(verdict.consecutive).toBe(40);
    expect(verdict.windowSeconds).toBe(BASE_BACKOFF_SECONDS * 2 ** MAX_DOUBLINGS);
  });

  it("starts again from the base window once a row on the signature is settled", () => {
    const rows = [
      row({ id: "d2", observedIso: "2026-09-19T09:10:00.000Z" }),
      row({
        id: "d1",
        observedIso: "2026-09-19T09:00:00.000Z",
        settled: { atIso: "2026-09-19T09:05:00.000Z", witness: "killed the bfs, load back to 3.1" },
      }),
    ];
    const verdict = backoffFor({ nowIso: "2026-09-19T09:11:00.000Z", rows });

    expect(verdict.consecutive).toBe(1);
    expect(verdict.windowSeconds).toBe(BASE_BACKOFF_SECONDS);
  });

  it("counts nothing when the newest row is itself settled", () => {
    const settled = row({ settled: { atIso: "2026-09-19T09:05:00.000Z", witness: "the nx daemons were reaped" } });
    const verdict = backoffFor({ nowIso: "2026-09-19T09:00:30.000Z", rows: [settled] });

    expect(verdict.consecutive).toBe(0);
    expect(verdict.maySeat).toBe(true);
  });

  it("keeps the doubling when the settled row named NOTHING to remove", () => {
    const rows = [
      machineRow({ id: "d2", observedIso: "2026-09-19T09:10:00.000Z" }),
      machineRow({
        id: "d1",
        observedIso: "2026-09-19T09:00:00.000Z",
        settled: { atIso: "2026-09-19T09:05:00.000Z", witness: "the hold is foreign; 2.8 of 12.0 busy cores" },
      }),
    ];
    const verdict = backoffFor({ nowIso: "2026-09-19T09:11:00.000Z", rows });

    expect(verdict.consecutive).toBe(2);
    expect(verdict.windowSeconds).toBe(600);
    expect(verdict.maySeat).toBe(false);
    expect(verdict.nextSeatIso).toBe("2026-09-19T09:20:00.000Z");
  });

  it("counts a settled machine row even when it is the newest, so no seat reopens on the next sample", () => {
    const settled = machineRow({
      settled: { atIso: "2026-09-19T09:05:00.000Z", witness: "nothing to kill — read `slopweaver machine capacity`" },
    });
    const verdict = backoffFor({ nowIso: "2026-09-19T09:00:30.000Z", rows: [settled] });

    expect(verdict.consecutive).toBe(1);
    expect(verdict.windowSeconds).toBe(BASE_BACKOFF_SECONDS);
    expect(verdict.maySeat).toBe(false);
    expect(verdict.nextSeatIso).toBe("2026-09-19T09:05:00.000Z");
  });

  it("refuses the seat rather than licensing one when the newest row's instant is unreadable", () => {
    const verdict = backoffFor({ nowIso: "2026-09-19T09:00:00.000Z", rows: [row({ observedIso: "not an instant" })] });

    expect(verdict.maySeat).toBe(false);
    expect(verdict.nextSeatIso).toBe(undefined);
  });
});
