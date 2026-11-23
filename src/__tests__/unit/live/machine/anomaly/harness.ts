/**
 * Builders for `src/live/machine/anomaly.ts`'s judgement: a capacity reading with only the fields a case varies
 * overridden, and the hog and session rows it is built from, plus the two session ids more than one file reads.
 * A plain module, not a `*.test.ts`, so no test registers twice. It moved here when `anomaly.test.ts` was split
 * by behaviour.
 */
import type { AnomalySubject, MachineAnomaly } from "../../../../../live/machine/anomaly.js";
import type { MachineCapacityReport } from "../../../../../live/machine/capacity.js";
import type { CpuHog } from "../../../../../live/machine/cpuHogs.js";
import type { SessionLoad } from "../../../../../live/machine/fleetLoad.js";

/** The session a default `session()` row belongs to. */
export const SESSION = "a0000036-0000-4000-8000-000000000039";
/** A second live session, beside the default one. */
export const PEER = "a0000103-02bb-4f5e-8a10-53c9d4e6f207";

/**
 * One heavy process, with only what a case varies overridden.
 *
 * @returns a foreign `bfs` at 301.2% cpu, fifteen minutes old, unless overridden
 */
export function hog(over: Partial<CpuHog> = {}): CpuHog {
  return {
    classification: "foreign",
    cpuPct: 301.2,
    elapsedSeconds: 900,
    label: "bfs",
    pid: 4242,
    sessionId: undefined,
    ...over,
  };
}

/**
 * One live session's load, with only what a case varies overridden.
 *
 * @returns a session at 276.9% cpu with four non-hook processes, unless overridden
 */
export function session(over: Partial<SessionLoad> = {}): SessionLoad {
  return {
    bootsInFlight: 0,
    cpuPct: 276.9,
    hookStallScript: undefined,
    hookStallSeconds: undefined,
    nonHookProcessCount: 4,
    parallelToolCalls: 1,
    pid: 100,
    processCount: 24,
    sessionId: SESSION,
    toolShellsInFlight: 0,
    tree: [{ cpuPct: 276.9, elapsedSeconds: 60, label: "node", pid: 101 }],
    ...over,
  };
}

/**
 * A capacity reading in the shape the judgement reads, with only the fields it touches varied.
 *
 * @returns a quiet machine — no hold, no hog, an empty fleet — unless overridden
 */
export function report(over: Partial<MachineCapacityReport> = {}): MachineCapacityReport {
  return {
    alert: false,
    compressor: undefined,
    cpuHogs: { cpuAttributed: true, hogs: [] },
    culprit: undefined,
    disk: undefined,
    diskHoldFreeGb: 28,
    fleet: { cpuAttributed: true, orphanCount: 0, orphanCpuPct: 0, orphans: [], sessions: [] },
    fleetChildAlert: false,
    foreignAlertGb: 8,
    graded: ["memory", "cpu"],
    hiddenCpu: {
      busyCores: undefined,
      hiddenFromTop: [],
      idlePct: undefined,
      unattributedCores: undefined,
      visibleCores: undefined,
    },
    hold: false,
    holdSubjects: [],
    hookStallHoldSeconds: 600,
    load: { load1: 3.1, load15: 3.1, load5: 3.1 },
    loadHold: 24,
    parallelCallAlert: 12,
    processes: [],
    recentBoots: { boots: [], hold: 3, windowSeconds: 180 },
    runawaySearches: [],
    segmentsHoldPct: 25,
    swap: undefined,
    swapAlertGb: 8,
    swapfileCount: 2,
    swapfileHoldCount: 5,
    topFleetChild: undefined,
    topForeign: undefined,
    ungraded: [],
    verdict: "machine capacity: ok",
    watchedProcesses: [],
    ...over,
  };
}

/**
 * The subject of a verdict the caller has already asserted is anomalous — no conditional in an assertion.
 *
 * @returns the anomalous verdict's subject; throws on a clear one
 */
export function unwrapSubject({ verdict }: { verdict: MachineAnomaly }): AnomalySubject {
  if (verdict.kind === "clear") {
    throw new Error("expected an anomalous verdict");
  }
  return verdict.subject;
}

/**
 * The signature of a verdict the caller has already asserted is anomalous.
 *
 * @returns the anomalous verdict's signature; throws on a clear one
 */
export function unwrapSignature({ verdict }: { verdict: MachineAnomaly }): string {
  if (verdict.kind === "clear") {
    throw new Error("expected an anomalous verdict");
  }
  return verdict.signature;
}
