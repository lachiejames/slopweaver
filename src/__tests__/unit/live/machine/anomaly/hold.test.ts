/*
 * `machineAnomaly` on a capacity HOLD — the pure verdict `machine watch` dispatches on and `loadDispatchGate.ts`
 * refuses a tick over: which holds fire, which clear themselves, how a hold is signed so
 * the backoff engages, and which culprit it names, an orphan group included. It moved here when `anomaly.test.ts`
 * was split by behaviour.
 */
import { describe, expect, it } from "vitest";

import { machineAnomaly } from "../../../../../live/machine/anomaly.js";
import { PEER, report, SESSION, session } from "./harness.js";

describe("machineAnomaly", () => {
  it("is clear when nothing crossed a line", () => {
    expect(machineAnomaly({ report: report() })).toStrictEqual({ kind: "clear" });
  });

  it("fires on a hold alone — a capacity-hold nobody acted on", () => {
    const held = report({
      culprit: {
        endedBy: "seat",
        kill: "kill 100",
        subject: `session ${SESSION}`,
        why: "a PreToolUse hook stalled 17m",
      },
      fleet: {
        cpuAttributed: true,
        orphanCount: 0,
        orphanCpuPct: 0,
        orphans: [],
        // The stalled session is a MINORITY of fleet cpu, so only the stall arm can name it.
        sessions: [session({ cpuPct: 400, pid: 200, sessionId: PEER }), session({ hookStallSeconds: 1020 })],
      },
      hold: true,
      holdSubjects: ["cpu"],
      hookStallHoldSeconds: 600,
      verdict: "machine capacity: HOLD on cpu",
    });
    const verdict = machineAnomaly({ report: held });

    expect(verdict.kind).toBe("anomalous");
    expect(verdict).toMatchObject({
      signature: `hold|session ${SESSION}|${SESSION}`,
      subject: { kill: "kill 100", label: `session ${SESSION}`, sessionId: SESSION },
      triggers: ["hold"],
    });
  });

  it("stays clear on a hold on recent boots alone — a burst that clears itself, and investigating it is a boot", () => {
    const held = report({
      fleet: { cpuAttributed: true, orphanCount: 0, orphanCpuPct: 0, orphans: [], sessions: [session()] },
      hold: true,
      holdSubjects: ["boots"],
      verdict: "machine capacity: HOLD on boots (3 sessions booted in the last 3m, hold at 3)",
    });

    expect(machineAnomaly({ report: held })).toStrictEqual({ kind: "clear" });
  });

  it("stays clear on a hold on the disk floor alone — worktree prune clears it, and an investigation would not", () => {
    const held = report({
      fleet: { cpuAttributed: true, orphanCount: 0, orphanCpuPct: 0, orphans: [], sessions: [session()] },
      hold: true,
      holdSubjects: ["disk"],
      verdict:
        "machine capacity: HOLD on disk (disk 24.0 GB free (df, Finder shows at least this), hold below 40 GB — " +
        "the owner's floor, room for a 5.6 GB seat tree each for the 6-seat boots burst and the next)",
    });

    expect(machineAnomaly({ report: held })).toStrictEqual({ kind: "clear" });
  });

  it("signs a cpu hold the same whether or not recent boots also held, so the backoff still engages", () => {
    const fleet = { cpuAttributed: true, orphanCount: 0, orphanCpuPct: 0, orphans: [], sessions: [session()] };
    const cpuOnly = machineAnomaly({ report: report({ fleet, hold: true, holdSubjects: ["cpu"] }) });
    const withBoots = machineAnomaly({ report: report({ fleet, hold: true, holdSubjects: ["cpu", "boots"] }) });

    expect(withBoots).toMatchObject({ signature: "hold|hold on cpu|foreign", triggers: ["hold"] });
    expect(withBoots).toStrictEqual(cpuOnly);
  });

  it("names the machine, not the top of the list, when a hold's culprit stops one second short of the stall", () => {
    const held = report({
      culprit: {
        endedBy: "seat",
        kill: "kill 100",
        subject: `session ${SESSION}`,
        why: "a PreToolUse hook stalled 10m",
      },
      fleet: {
        cpuAttributed: true,
        orphanCount: 0,
        orphanCpuPct: 0,
        orphans: [],
        sessions: [session({ cpuPct: 400, pid: 200, sessionId: PEER }), session({ hookStallSeconds: 599 })],
      },
      hold: true,
      holdSubjects: ["cpu"],
      hookStallHoldSeconds: 600,
      verdict: "machine capacity: HOLD on cpu",
    });
    const verdict = machineAnomaly({ report: held });

    expect(verdict).toMatchObject({
      signature: "hold|hold on cpu|foreign",
      subject: { kill: undefined, label: "hold on cpu", sessionId: undefined },
    });
  });

  it("names the heaviest tree when a hold blames nobody at all, and says the machine's busy cpu was unread", () => {
    const held = report({
      fleet: { cpuAttributed: true, orphanCount: 0, orphanCpuPct: 0, orphans: [], sessions: [session()] },
      hold: true,
      holdSubjects: ["memory", "cpu"],
      verdict: "machine capacity: HOLD on memory and cpu",
    });
    const verdict = machineAnomaly({ report: held });

    expect(verdict).toMatchObject({
      signature: "hold|hold on memory and cpu|foreign",
      subject: {
        kill: undefined,
        label: "hold on memory and cpu",
        tree: [{ cpuPct: 276.9, elapsedSeconds: 60, label: "node", pid: 101 }],
        why:
          "HOLD on memory and cpu — 1 live session(s) at 276.9% cpu between them, heaviest 276.9%, but the " +
          "machine's busy cpu was UNREAD, so no session can be measured as its majority. This is the machine, " +
          "not one session, so there is nothing here to kill; read it with `slopweaver machine capacity`",
      },
    });
  });

  it("still names an ORPHAN group, whose remedy costs no workstream and whose label does not rotate", () => {
    const orphaned = report({
      culprit: {
        endedBy: "seat",
        kill: "slopweaver machine reap",
        subject: "12 orphaned fleet shell(s), 2 dead seat(s), top seat zsh-1758-ab12",
        why: "148% cpu with no session left to read them, oldest 3h",
      },
      fleet: {
        cpuAttributed: true,
        orphanCount: 12,
        orphanCpuPct: 148,
        orphans: [
          {
            cpuPct: 148,
            oldestSeconds: 10800,
            pids: [901, 902],
            seatLive: false,
            snapshot: "/Users/x/.claude/shell-snapshots/snapshot-zsh-1758-ab12.sh",
            tree: [{ cpuPct: 148, elapsedSeconds: 10800, label: "zsh", pid: 901 }],
          },
        ],
        sessions: [session()],
      },
      hold: true,
      holdSubjects: ["cpu"],
      verdict: "machine capacity: HOLD on cpu",
    });
    const verdict = machineAnomaly({ report: orphaned });

    expect(verdict).toMatchObject({
      signature: "hold|12 orphaned fleet shell(s), 2 dead seat(s), top seat zsh-1758-ab12|foreign",
      subject: {
        kill: "slopweaver machine reap",
        sessionId: undefined,
        tree: [{ cpuPct: 148, elapsedSeconds: 10800, label: "zsh", pid: 901 }],
      },
    });
  });
});
