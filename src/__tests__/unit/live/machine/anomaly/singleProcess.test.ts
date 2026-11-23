/*
 * `machineAnomaly` on a single heavy process — it fires only when the process is SUSTAINED over the line, because
 * the sample is a one-second window and a compile burst is not an incident, and a caller may move both lines. It
 * moved here when `anomaly.test.ts` was split by behaviour.
 */
import { describe, expect, it } from "vitest";

import {
  DEFAULT_SINGLE_PROCESS_CORES,
  DEFAULT_SUSTAINED_SECONDS,
  machineAnomaly,
} from "../../../../../live/machine/anomaly.js";
import { hog, report, SESSION, session } from "./harness.js";

describe("machineAnomaly", () => {
  it("fires on a single process over the line that has been over it long enough — a bfs walking the root", () => {
    const verdict = machineAnomaly({ report: report({ cpuHogs: { cpuAttributed: true, hogs: [hog()] } }) });

    expect(verdict).toMatchObject({
      signature: "single-process|bfs|foreign",
      subject: {
        kill: "kill 4242",
        label: "bfs",
        why: "bfs (pid 4242) at 301.2% cpu for 15m — foreign, no session owns it",
      },
      triggers: ["single-process"],
    });
  });

  it("does NOT fire on a one-second burst, whatever it read", () => {
    const burst = report({ cpuHogs: { cpuAttributed: true, hogs: [hog({ cpuPct: 780, elapsedSeconds: 3 })] } });

    expect(machineAnomaly({ report: burst })).toStrictEqual({ kind: "clear" });
  });

  it("does NOT fire on a sustained process under the line", () => {
    const under = report({ cpuHogs: { cpuAttributed: true, hogs: [hog({ cpuPct: 289 })] } });

    expect(machineAnomaly({ report: under })).toStrictEqual({ kind: "clear" });
  });

  it("does NOT fire when the process age could not be read, rather than assuming it is sustained", () => {
    const ageless = report({ cpuHogs: { cpuAttributed: true, hogs: [hog({ elapsedSeconds: undefined })] } });

    expect(machineAnomaly({ report: ageless })).toStrictEqual({ kind: "clear" });
  });

  it("fires exactly at the line, on both cores and seconds", () => {
    const atLine = report({
      cpuHogs: {
        cpuAttributed: true,
        hogs: [hog({ cpuPct: DEFAULT_SINGLE_PROCESS_CORES * 100, elapsedSeconds: DEFAULT_SUSTAINED_SECONDS })],
      },
    });

    expect(machineAnomaly({ report: atLine }).kind).toBe("anomalous");
  });

  it("carries the owning session's tree behind a hog the fleet does own", () => {
    const owned = report({
      cpuHogs: { cpuAttributed: true, hogs: [hog({ classification: "fleet", sessionId: SESSION })] },
      fleet: { cpuAttributed: true, orphanCount: 0, orphanCpuPct: 0, orphans: [], sessions: [session()] },
    });
    const verdict = machineAnomaly({ report: owned });

    expect(verdict).toMatchObject({
      signature: `single-process|bfs|${SESSION}`,
      subject: { sessionId: SESSION, tree: [{ cpuPct: 276.9, elapsedSeconds: 60, label: "node", pid: 101 }] },
    });
  });

  it("honours a caller's own lines, so a re-measurement does not need a code change to prove", () => {
    const modest = report({ cpuHogs: { cpuAttributed: true, hogs: [hog({ cpuPct: 150, elapsedSeconds: 30 })] } });
    const verdict = machineAnomaly({ report: modest, singleProcessCores: 1, sustainedSeconds: 10 });

    expect(verdict).toMatchObject({ triggers: ["single-process"] });
  });
});
