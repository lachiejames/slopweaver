import { describe, expect, it } from "vitest";
import { machineAnomaly } from "../../../../../live/machine/anomaly.js";
import { buildMachineCapacityReport } from "../../../../../live/machine/capacity.js";
import { HEALTHY_GAUGES } from "./fixtures.js";

/**
 * The daemon trigger: the ranked read keeps only `topN` rows, so a watched daemon ranked below them
 * was invisible. It is read by pid beside that list, and joined to the same `ps` tables.
 */
describe("a watched daemon outside the ranked rows", () => {
  const report = buildMachineCapacityReport({
    ...HEALTHY_GAUGES,
    comms: [
      { comm: "/System/Library/CoreServices/WindowServer", pid: 416 },
      { comm: "/usr/sbin/fseventsd", pid: 345 },
    ],
    processes: [
      { argv: "/System/Library/CoreServices/WindowServer -daemon", pid: 416, ppid: 1 },
      { argv: "/usr/sbin/fseventsd", pid: 345, ppid: 1 },
    ],
    swapText: undefined,
    topN: 1,
    topText: "Load Avg: 1.0, 1.0, 1.0 \nPID    MEM  \n416    30G  \n345    2G   \n",
    watchedTopText: "Load Avg: 1.0, 1.0, 1.0 \nPID    MEM  \n345    2G   \n",
  });

  it("is carried whole in watchedProcesses while the ranked list stays bounded", () => {
    expect(report.processes.map((process) => process.label)).toStrictEqual(["WindowServer"]);
    expect(report.watchedProcesses).toStrictEqual([
      {
        classification: "foreign",
        footprintBytes: 2 * 1024 ** 3,
        footprintGb: 2,
        label: "fseventsd",
        pid: 345,
        session: undefined,
      },
    ]);
  });

  it("is empty when no watched read was taken", () => {
    const unread = buildMachineCapacityReport({
      ...HEALTHY_GAUGES,
      comms: [],
      processes: [],
      swapText: undefined,
      topText: undefined,
    });

    expect(unread.watchedProcesses).toStrictEqual([]);
  });
});

describe("a watched daemon on a pid a stale session record still names", () => {
  it("stays foreign, since the session registry matches by pid and a daemon is nobody's child", () => {
    const report = buildMachineCapacityReport({
      ...HEALTHY_GAUGES,
      comms: [{ comm: "/usr/sbin/fseventsd", pid: 345 }],
      processes: [{ argv: "/usr/sbin/fseventsd", pid: 345, ppid: 1 }],
      sessions: [{ cwd: "/opt/synthetic/worktrees/stale", pid: 345, sessionId: "stale-session" }],
      swapText: undefined,
      topText: undefined,
      watchedTopText: "PID    MEM  \n345    2G   \n",
    });

    expect(report.watchedProcesses.map((process) => process.classification)).toStrictEqual(["foreign"]);
  });
});

/**
 * The daemon line judged on what `top` really prints — whole MiB — through the real parser, rather than on
 * bytes a test constructs. One MiB over fires; `1024M` is ON the line and stays clear.
 */
describe("the daemon line through top's own resolution", () => {
  const judged = ({ mem }: { mem: string }): ReturnType<typeof machineAnomaly> =>
    machineAnomaly({
      report: buildMachineCapacityReport({
        ...HEALTHY_GAUGES,
        comms: [{ comm: "/usr/sbin/fseventsd", pid: 345 }],
        processes: [{ argv: "/usr/sbin/fseventsd", pid: 345, ppid: 1 }],
        swapText: undefined,
        topText: undefined,
        watchedTopText: `PID    MEM  \n345    ${mem}   \n`,
      }),
    });

  it("fires one MiB over the line and stays clear on it", () => {
    expect(judged({ mem: "1025M" })).toMatchObject({ signature: "daemon-footprint|fseventsd|foreign" });
    expect(judged({ mem: "1024M" })).toStrictEqual({ kind: "clear" });
  });
});
