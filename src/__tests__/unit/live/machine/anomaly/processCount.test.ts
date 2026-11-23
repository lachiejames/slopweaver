/*
 * `machineAnomaly` on a session's process count — the NON-HOOK count, because ten PreToolUse entries times a
 * 28-reader fan-out is ~170 hook processes on completely correct work — and on every line firing at once. It moved
 * here when `anomaly.test.ts` was split by behaviour.
 */
import { describe, expect, it } from "vitest";

import { DEFAULT_SESSION_PROCESS_COUNT, machineAnomaly } from "../../../../../live/machine/anomaly.js";
import { hog, report, SESSION, session } from "./harness.js";

describe("machineAnomaly", () => {
  it("fires on a session's NON-HOOK process count, not its raw one", () => {
    const overgrown = report({
      fleet: {
        cpuAttributed: true,
        orphanCount: 0,
        orphanCpuPct: 0,
        orphans: [],
        sessions: [session({ nonHookProcessCount: DEFAULT_SESSION_PROCESS_COUNT, processCount: 210 })],
      },
    });
    const verdict = machineAnomaly({ report: overgrown });

    expect(verdict).toMatchObject({
      signature: `process-count|session ${SESSION}|${SESSION}`,
      subject: { kill: "kill 100", why: "40 non-hook processes (210 total) at 276.9% cpu" },
      triggers: ["process-count"],
    });
  });

  it("stays clear on the ~170-hook fan-out a correct bot turn produces", () => {
    const fanout = report({
      fleet: {
        cpuAttributed: true,
        orphanCount: 0,
        orphanCpuPct: 0,
        orphans: [],
        sessions: [session({ nonHookProcessCount: 24, processCount: 170 })],
      },
    });

    expect(machineAnomaly({ report: fanout })).toStrictEqual({ kind: "clear" });
  });

  it("lists every line that fired, and picks the most concrete subject of them", () => {
    const both = report({
      cpuHogs: { cpuAttributed: true, hogs: [hog()] },
      fleet: {
        cpuAttributed: true,
        orphanCount: 0,
        orphanCpuPct: 0,
        orphans: [],
        sessions: [session({ nonHookProcessCount: 60 })],
      },
      hold: true,
      holdSubjects: ["cpu"],
    });
    const verdict = machineAnomaly({ report: both });

    expect(verdict).toMatchObject({
      signature: "hold+single-process+process-count|bfs|foreign",
      subject: { label: "bfs" },
      triggers: ["hold", "single-process", "process-count"],
    });
  });
});
