/*
 * `machineAnomaly` on a bare machine-wide hold — WHO it may name. A session id rotating between readings is the
 * same bug as a pid in the signature: four readings in 27 minutes named four innocent sessions and
 * the 300-second backoff never engaged. Only a STRICT majority of the machine's busy cpu is named. It moved here
 * when `anomaly.test.ts` was split by behaviour.
 */
import { describe, expect, it } from "vitest";

import { machineAnomaly } from "../../../../../live/machine/anomaly.js";
import type { MachineCapacityReport } from "../../../../../live/machine/capacity.js";
import { PEER, report, SESSION, session, unwrapSignature, unwrapSubject } from "./harness.js";

const ROTATED = "a0000089-1d4c-4f7a-9c3b-2a6f0e7d8b41";
const THIRD = "46a69e92-6c58-41d9-b0e2-7fd31c8a5b64";
const FOURTH = "a0000125-9e33-4b21-8d70-11c5a4e2f963";

/** A flat fleet: four sessions within a factor of two of each other, as the rotating readings were. */
function flatFleet({ topId, topCpu }: { topId: string; topCpu: number }): MachineCapacityReport["fleet"] {
  return {
    cpuAttributed: true,
    orphanCount: 0,
    orphanCpuPct: 0,
    orphans: [],
    sessions: [
      session({ cpuPct: topCpu, pid: 68483, sessionId: topId }),
      session({ cpuPct: 81.7, pid: 82759, sessionId: PEER }),
      session({ cpuPct: 60, pid: 46514, sessionId: THIRD }),
      session({ cpuPct: 52.8, pid: 3541, sessionId: FOURTH }),
    ],
  };
}

/**
 * A bare hold on cpu whose culprit is whichever session is top of a flat list — the reported defect — on a
 * machine `top`'s header read as `busyCores` busy (fifteen, unless a case varies it).
 */
function flatHold({
  topId,
  topCpu = 86.2,
  busyCores = 15,
}: {
  topId: string;
  topCpu?: number;
  busyCores?: number;
}): MachineCapacityReport {
  return report({
    culprit: {
      endedBy: "seat",
      kill: "kill 68483",
      subject: `session ${topId}`,
      why: `${String(topCpu)}% cpu across 30 processes`,
    },
    fleet: flatFleet({ topCpu, topId }),
    hiddenCpu: {
      busyCores,
      hiddenFromTop: [],
      idlePct: undefined,
      unattributedCores: undefined,
      visibleCores: undefined,
    },
    hold: true,
    holdSubjects: ["cpu"],
    verdict: "machine capacity: HOLD on cpu (1-min load 36.0, hold at 22)",
  });
}

describe("machineAnomaly", () => {
  it("names the MACHINE when the culprit is merely the top of a flat list — the rotation", () => {
    const verdict = machineAnomaly({ report: flatHold({ topId: SESSION }) });

    expect(verdict).toMatchObject({
      signature: "hold|hold on cpu|foreign",
      subject: {
        kill: undefined,
        label: "hold on cpu",
        sessionId: undefined,
        why:
          "HOLD on cpu — no session is a strict majority of the machine's 15 busy cores: 4 live session(s) at " +
          "280.7% cpu between them, heaviest 86.2%. This is the machine, not one session, so there is nothing " +
          "here to kill; read it with `slopweaver machine capacity`",
      },
      triggers: ["hold"],
    });
    expect(unwrapSubject({ verdict }).why).not.toContain(SESSION);
  });

  it("names the MACHINE for a transient that beats the rest of the FLEET but not the machine", () => {
    // A dispatch: 97% (92.5% of it one 16-second-old node) over a quiet fleet, 15 cores busy.
    const quiet = flatHold({ topCpu: 97, topId: SESSION });
    const transient = report({
      ...quiet,
      fleet: {
        ...quiet.fleet,
        sessions: [
          session({ cpuPct: 97, pid: 73794, sessionId: SESSION }),
          session({ cpuPct: 40, pid: 82759, sessionId: PEER }),
          session({ cpuPct: 30, pid: 46514, sessionId: THIRD }),
        ],
      },
    });
    const verdict = machineAnomaly({ report: transient });
    const [top, ...rest] = transient.fleet.sessions;

    // The witness that this fixture reproduces the defect: the old FLEET-majority arm would have named it.
    expect(top!.cpuPct).toBeGreaterThan(rest.reduce((sum, other) => sum + other.cpuPct, 0));
    expect(verdict).toMatchObject({
      signature: "hold|hold on cpu|foreign",
      subject: { kill: undefined, label: "hold on cpu", sessionId: undefined },
      triggers: ["hold"],
    });
  });

  it("names the MACHINE for a lone two-and-a-half-core tree on a fifteen-busy-core machine, keeping its tree", () => {
    const tree = [{ cpuPct: 250, elapsedSeconds: 600, label: "node", pid: 101 }];
    const lone = report({
      ...flatHold({ topCpu: 250, topId: SESSION }),
      fleet: {
        cpuAttributed: true,
        orphanCount: 0,
        orphanCpuPct: 0,
        orphans: [],
        sessions: [session({ cpuPct: 250, sessionId: SESSION, tree })],
      },
    });
    const verdict = machineAnomaly({ report: lone });

    expect(verdict).toMatchObject({
      signature: "hold|hold on cpu|foreign",
      subject: { kill: undefined, sessionId: undefined, tree },
    });
  });

  it("names nobody when the machine's busy cpu is UNREAD, even over a session that beats the rest of the fleet", () => {
    const unread = report({
      ...flatHold({ topCpu: 500, topId: SESSION }),
      hiddenCpu: {
        busyCores: undefined,
        hiddenFromTop: [],
        idlePct: undefined,
        unattributedCores: undefined,
        visibleCores: undefined,
      },
    });
    const verdict = machineAnomaly({ report: unread });

    expect(verdict).toMatchObject({
      signature: "hold|hold on cpu|foreign",
      subject: { kill: undefined, sessionId: undefined },
    });
  });

  it("signs two readings that named DIFFERENT top sessions identically, so the backoff engages", () => {
    const first = machineAnomaly({ report: flatHold({ topId: SESSION }) });
    const second = machineAnomaly({ report: flatHold({ topCpu: 86.2, topId: ROTATED }) });

    expect(unwrapSignature({ verdict: first })).toBe("hold|hold on cpu|foreign");
    expect(unwrapSignature({ verdict: second })).toBe(unwrapSignature({ verdict: first }));
  });

  it("still names a session that is a STRICT majority of the machine's busy cpu, with its kill", () => {
    const runaway = flatHold({ topCpu: 750.1, topId: SESSION });
    const verdict = machineAnomaly({ report: runaway });

    expect(verdict).toMatchObject({
      signature: `hold|session ${SESSION}|${SESSION}`,
      subject: { kill: "kill 68483", label: `session ${SESSION}`, sessionId: SESSION },
    });
  });

  it("does NOT name a session that exactly TIES the rest of the machine's busy cpu", () => {
    const tied = flatHold({ topCpu: 750, topId: SESSION });
    const verdict = machineAnomaly({ report: tied });

    expect(verdict).toMatchObject({
      signature: "hold|hold on cpu|foreign",
      subject: { kill: undefined, sessionId: undefined },
    });
  });

  it("says cpu was UNATTRIBUTED rather than reporting an idle fleet it never measured", () => {
    const unread = flatHold({ topId: SESSION });
    const blind = report({
      ...unread,
      fleet: {
        ...unread.fleet,
        cpuAttributed: false,
        sessions: unread.fleet.sessions.map((s) => ({ ...s, cpuPct: 0 })),
      },
    });
    const verdict = machineAnomaly({ report: blind });

    expect(unwrapSubject({ verdict }).why).toBe(
      "HOLD on cpu — 4 live session(s), cpu UNATTRIBUTED — nothing was measured to blame. This is the " +
        "machine, not one session, so there is nothing here to kill; read it with `slopweaver machine capacity`",
    );
  });
});
