/*
 * `machineAnomaly` on a watched daemon — `fseventsd` over its footprint line, read from the watched list alone,
 * signed by itself beside every co-trigger so the backoff holds, and relieved by the owner's one root hand step rather
 * than a kill. It moved here when `anomaly.test.ts` was split by behaviour.
 */
import { describe, expect, it } from "vitest";

import { machineAnomaly } from "../../../../../live/machine/anomaly.js";
import type { RankedProcess } from "../../../../../live/machine/capacityRank.js";
import type { DispatchRow } from "../../../../../live/machine/dispatchRow.js";
import { watchDecision } from "../../../../../live/machine/watchDecision.js";
import { hog, report, session, unwrapSignature, unwrapSubject } from "./harness.js";

/** One process ranked by footprint, foreign unless a case says otherwise. */
function ranked({ footprintGb = 0.1, ...over }: Partial<RankedProcess> = {}): RankedProcess {
  return {
    classification: "foreign",
    footprintBytes: footprintGb * 1024 ** 3,
    footprintGb,
    label: "WindowServer",
    pid: 416,
    session: undefined,
    ...over,
  };
}

describe("machineAnomaly on a watched daemon", () => {
  it("dispatches on fseventsd over its line, naming the daemon and the root hand step rather than a kill", () => {
    const bloated = report({ watchedProcesses: [ranked({ footprintGb: 24, label: "fseventsd", pid: 345 })] });
    const verdict = machineAnomaly({ report: bloated });

    expect(verdict).toStrictEqual({
      kind: "anomalous",
      signature: "daemon-footprint|fseventsd|foreign",
      subject: {
        kill: undefined,
        label: "fseventsd",
        sessionId: undefined,
        tree: [],
        why:
          "fseventsd (pid 345, root) holds 24 GB, line at 1 GB — investigate which file churn or slow client drove " +
          "it; relief is the owner's one hand step `sudo killall fseventsd`",
      },
      triggers: ["daemon-footprint"],
    });
  });

  it("judges the line on exact bytes: one byte over fires, exactly on it stays clear", () => {
    const gib = 1024 ** 3;
    const on = report({ watchedProcesses: [ranked({ footprintBytes: gib, footprintGb: 1, label: "fseventsd" })] });
    const over = report({
      watchedProcesses: [ranked({ footprintBytes: gib + 1, footprintGb: 1, label: "fseventsd" })],
    });

    expect(machineAnomaly({ report: on })).toStrictEqual({ kind: "clear" });
    expect(machineAnomaly({ report: over })).toMatchObject({ triggers: ["daemon-footprint"] });
  });

  it("stays clear when no watched daemon was read", () => {
    expect(machineAnomaly({ report: report({ watchedProcesses: [] }) })).toStrictEqual({ kind: "clear" });
  });

  it("reads the watched list, never the ranked one, so rank cannot hide a daemon or invent one", () => {
    const rankedOnly = report({ processes: [ranked({ footprintGb: 24, label: "fseventsd" })] });

    expect(machineAnomaly({ report: rankedOnly })).toStrictEqual({ kind: "clear" });
  });

  it("stays clear on a watched row whose label names no watched daemon", () => {
    const stranger = report({
      watchedProcesses: [ranked({ footprintGb: 24, label: "com.apple.Virtualization.VirtualMachine" })],
    });

    expect(machineAnomaly({ report: stranger })).toStrictEqual({ kind: "clear" });
  });

  /**
   * `./classify.ts`'s argv heuristic calls anything naming this tool fleet, and a daemon whose
   * arguments did would have been hidden. A watched row was read by exact binary path, so it is not re-judged.
   */
  it("fires on a watched daemon whatever its argv classified it as", () => {
    const misread = report({
      watchedProcesses: [ranked({ classification: "fleet", footprintGb: 24, label: "fseventsd" })],
    });

    expect(machineAnomaly({ report: misread })).toMatchObject({
      signature: "daemon-footprint|fseventsd|foreign",
      triggers: ["daemon-footprint"],
    });
  });

  /**
   * A daemon stands for days while a hog, a session and the hold come and go, so any of them in its
   * signature would read as novel to the backoff, and a lasting hog ahead of it would keep it from ever being
   * the subject. Every co-trigger is still listed.
   */
  it("names the daemon and signs it alone beside every co-trigger, listing each line that fired", () => {
    const watchedProcesses = [ranked({ footprintGb: 24, label: "fseventsd" })];
    const overgrown = {
      cpuAttributed: true,
      orphanCount: 0,
      orphanCpuPct: 0,
      orphans: [],
      sessions: [session({ nonHookProcessCount: 60 })],
    };
    const readings = [
      report({ watchedProcesses }),
      report({ hold: true, holdSubjects: ["cpu"], watchedProcesses }),
      report({ cpuHogs: { cpuAttributed: true, hogs: [hog()] }, watchedProcesses }),
      report({ fleet: overgrown, watchedProcesses }),
      report({
        cpuHogs: { cpuAttributed: true, hogs: [hog()] },
        fleet: overgrown,
        hold: true,
        holdSubjects: ["cpu"],
        watchedProcesses,
      }),
    ];

    expect(readings.map((reading) => machineAnomaly({ report: reading }))).toMatchObject([
      { signature: "daemon-footprint|fseventsd|foreign", subject: { kill: undefined, label: "fseventsd" } },
      { signature: "daemon-footprint|fseventsd|foreign", triggers: ["hold", "daemon-footprint"] },
      { signature: "daemon-footprint|fseventsd|foreign", triggers: ["single-process", "daemon-footprint"] },
      { signature: "daemon-footprint|fseventsd|foreign", triggers: ["process-count", "daemon-footprint"] },
      {
        signature: "daemon-footprint|fseventsd|foreign",
        subject: { kill: undefined, label: "fseventsd" },
        triggers: ["hold", "single-process", "process-count", "daemon-footprint"],
      },
    ]);
  });

  it("holds a daemon's backoff when a hog joins it, rather than seating a second investigation as novel", () => {
    const watchedProcesses = [ranked({ footprintGb: 24, label: "fseventsd" })];
    const first = machineAnomaly({ report: report({ watchedProcesses }) });
    const withHog = machineAnomaly({
      report: report({ cpuHogs: { cpuAttributed: true, hogs: [hog()] }, watchedProcesses }),
    });
    const earlier: DispatchRow = {
      id: "d1",
      load1: 3.1,
      observedIso: "2026-09-27T10:00:00.000Z",
      seated: { kind: "seated", slug: "machine-load-fseventsd", workspace: "workspace:9" },
      settled: undefined,
      signature: unwrapSignature({ verdict: first }),
      subject: unwrapSubject({ verdict: first }),
      triggers: ["daemon-footprint"],
    };
    const decision = watchDecision({
      anomaly: withHog,
      liveSignatures: new Set(),
      nowIso: "2026-09-27T10:01:00.000Z",
      rows: [earlier],
    });

    expect(decision).toStrictEqual({
      anomaly: withHog,
      kind: "dispatch",
      seat: {
        kind: "skip",
        seated: {
          kind: "none",
          why:
            "backoff: 1 unsettled dispatch(es) on this signature, 300s window, " +
            "next seat at 2026-09-27T10:05:00.000Z",
        },
      },
    });
  });

  it("honours a caller's own daemon line", () => {
    const modest = report({ watchedProcesses: [ranked({ footprintGb: 0.5, label: "fseventsd" })] });

    expect(machineAnomaly({ report: modest })).toStrictEqual({ kind: "clear" });
    expect(machineAnomaly({ daemonFootprintGb: 0.25, report: modest })).toMatchObject({
      triggers: ["daemon-footprint"],
    });
  });
});
