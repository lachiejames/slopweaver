import { describe, expect, it } from "vitest";
import { DEFAULT_DAEMON_FOOTPRINT_GB, machineAnomaly } from "../../../../../live/machine/anomaly.js";
import {
  buildMachineCapacityReport,
  DEFAULT_FOREIGN_FOOTPRINT_ALERT_GB,
} from "../../../../../live/machine/capacity.js";
import { daemonCulprit } from "../../../../../live/machine/daemonCulprit.js";
import { WATCHED_DAEMONS } from "../../../../../live/machine/daemonWatch.js";
import { HEALTHY_GAUGES, INCIDENT_COMMS, INCIDENT_SESSION } from "./fixtures.js";

const FSEVENTSD_COMM = WATCHED_DAEMONS.find((daemon) => daemon.label === "fseventsd")!.comm;

/** `top -l 2 -s 1 -stats pid,cpu`, reduced: the session at 12% in the final sample, the first reading zero. */
const SESSION_CPU_SAMPLE = [
  "Processes: 3 total",
  "PID    %CPU",
  "88556  0.0",
  "Processes: 3 total",
  "PID    %CPU",
  "88556  12.0",
  "",
].join("\n");

/**
 * The bloated-daemon shape, ids synthetic: a memory HOLD on 14 swapfiles (hold at 12), fseventsd at 32 GB as
 * the heaviest foreign process, and one live session whose `claude` holds 1 GB. The verdict named the session
 * and `kill <its pid>`, which frees none of the 32 GB.
 */
function balloonReading({
  fseventsdMem,
  extraTop = "",
  foreignAlertGb = 8,
  sessionMem = "1024M",
}: {
  fseventsdMem: string;
  extraTop?: string;
  foreignAlertGb?: number;
  sessionMem?: string;
}): Parameters<typeof buildMachineCapacityReport>[0] {
  return {
    ...HEALTHY_GAUGES,
    comms: [...INCIDENT_COMMS, { comm: FSEVENTSD_COMM, pid: 345 }, { comm: "/opt/synthetic/vm", pid: 700 }],
    // The session's cpu is MEASURED, so the fleet can name it on cpu actually used when the daemon does not win.
    cpuSampleText: SESSION_CPU_SAMPLE,
    foreignAlertGb,
    processes: [
      {
        argv: `/opt/synthetic/.local/bin/claude --session-id ${INCIDENT_SESSION.sessionId} --settings {}`,
        pid: INCIDENT_SESSION.pid,
        ppid: 1,
      },
      { argv: FSEVENTSD_COMM, pid: 345, ppid: 1 },
      { argv: "/opt/synthetic/vm", pid: 700, ppid: 1 },
    ],
    sessions: [INCIDENT_SESSION],
    swapText: undefined,
    swapfileCount: 14,
    topText: `Load Avg: 9.0, 9.0, 9.0 \nPID    MEM  \n${extraTop}345    ${fseventsdMem}\n88556  ${sessionMem}\n`,
    watchedTopText: `PID    MEM  \n345    ${fseventsdMem}\n`,
  };
}

describe("a memory hold a ballooned watched daemon holds", () => {
  const report = buildMachineCapacityReport(balloonReading({ fseventsdMem: "32G" }));

  it("names the daemon and its relief as the owner's hand step, never a session kill", () => {
    expect(report.holdSubjects).toEqual(["memory"]);
    expect(report.culprit).toEqual({
      endedBy: "owner",
      kill: "sudo killall fseventsd",
      subject: "fseventsd",
      why: "fseventsd (pid 345, root) holds 32 GB, the heaviest foreign process on the machine, so no session kill frees this memory",
    });
    expect(report.verdict).toContain(
      "SUBJECT fseventsd — fseventsd (pid 345, root) holds 32 GB, the heaviest foreign process on the machine, so no session kill frees this memory; relief is the owner's one hand step `sudo killall fseventsd`, never during a call",
    );
    expect(report.verdict).not.toContain("kill 88556");
  });

  it("still names the session when the daemon is under the foreign-footprint line", () => {
    const under = buildMachineCapacityReport(balloonReading({ fseventsdMem: "2G" }));
    expect(under.holdSubjects).toEqual(["memory"]);
    expect(under.culprit!.subject).toBe(`session ${INCIDENT_SESSION.sessionId}`);
    expect(under.culprit!.endedBy).toBe("seat");
    expect(under.verdict).toContain("end it with `kill 88556`");
  });

  it("leaves the subject to the fleet when a heavier foreign process outweighs the daemon", () => {
    const heavier = buildMachineCapacityReport(balloonReading({ extraTop: "700    40G\n", fseventsdMem: "32G" }));
    expect(heavier.topForeign!.label).toBe("vm");
    expect(heavier.culprit!.subject).toBe(`session ${INCIDENT_SESSION.sessionId}`);
  });

  // A ranked list cut at topN above a row heavier than the daemon may hide a heavier foreign process.
  it("leaves the subject to the fleet when the ranked read was cut above a row heavier than the daemon", () => {
    const cut = buildMachineCapacityReport({
      ...balloonReading({ fseventsdMem: "32G" }),
      topN: 1,
      topText: "Load Avg: 9.0, 9.0, 9.0 \nPID    MEM  \n88556  40G\n700    35G\n345    32G\n",
    });
    expect(cut.processes.map((process) => process.pid)).toEqual([88556]);
    expect(cut.culprit!.subject).toBe(`session ${INCIDENT_SESSION.sessionId}`);
    expect(cut.culprit!.endedBy).toBe("seat");
  });

  // The watched read follows the ranked one, so a balloon between them must not outrank a heavier row.
  it("judges the daemon by its lesser footprint when the two snapshots disagree", () => {
    const raced = buildMachineCapacityReport({
      ...balloonReading({ fseventsdMem: "32G" }),
      topText: "Load Avg: 9.0, 9.0, 9.0 \nPID    MEM  \n700    20G\n345    1G\n88556  1024M\n",
    });
    expect(raced.watchedProcesses.map((process) => process.footprintGb)).toEqual([32]);
    expect(raced.culprit!.subject).toBe(`session ${INCIDENT_SESSION.sessionId}`);
  });

  it("still names the daemon when the cut list's lightest row is no heavier than the daemon", () => {
    const cut = buildMachineCapacityReport({ ...balloonReading({ fseventsdMem: "32G" }), topN: 1 });
    expect(cut.processes.map((process) => process.pid)).toEqual([345]);
    expect(cut.culprit!.subject).toBe("fseventsd");
  });
});

describe("the anomaly over a daemon-held hold", () => {
  it("carries the relief in prose with no kill, so the backoff keeps doubling", () => {
    // Under the anomaly's own 1 GiB daemon line, so the subject comes from the culprit rather than its daemon arm;
    // the session lighter still, so the daemon outweighs every ranked row.
    const report = buildMachineCapacityReport(
      balloonReading({ foreignAlertGb: 0.5, fseventsdMem: "900M", sessionMem: "500M" }),
    );
    const anomaly = machineAnomaly({ report });
    expect(anomaly).toMatchObject({
      kind: "anomalous",
      signature: "hold|fseventsd|foreign",
      subject: {
        kill: undefined,
        label: "fseventsd",
        sessionId: undefined,
        why: "fseventsd (pid 345, root) holds 0.9 GB, the heaviest foreign process on the machine, so no session kill frees this memory; relief is the owner's one hand step `sudo killall fseventsd`",
      },
    });
  });

  // The hold arm above sits BELOW a sustained hog in the anomaly's subject order, so a daemon culprit under the
  // anomaly's own daemon line would lose to a hog's `kill`. With the shipped defaults that cannot happen: a daemon
  // over the foreign line is over the daemon line too, and the daemon arm outranks the hog.
  it("puts the shipped foreign line at or above the anomaly's daemon line, so a daemon culprit always reaches the daemon arm", () => {
    expect(DEFAULT_FOREIGN_FOOTPRINT_ALERT_GB).toBeGreaterThanOrEqual(DEFAULT_DAEMON_FOOTPRINT_GB);
  });
});

describe("daemonCulprit", () => {
  const fseventsd = {
    classification: "foreign" as const,
    footprintBytes: 32 * 1024 ** 3,
    footprintGb: 32,
    label: "fseventsd",
    pid: 345,
    session: undefined,
  };

  const session = {
    classification: "fleet" as const,
    footprintBytes: 1024 ** 3,
    footprintGb: 1,
    label: "claude",
    pid: 88556,
    session: undefined,
  };

  it("names nobody on a reading that did not fire on memory", () => {
    expect(daemonCulprit({ foreignAlertGb: 8, memoryHeld: false, ranked: [fseventsd], watched: [fseventsd] })).toBe(
      undefined,
    );
  });

  it("names nobody when no watched daemon was read", () => {
    expect(daemonCulprit({ foreignAlertGb: 8, memoryHeld: true, ranked: [session], watched: [] })).toBe(undefined);
  });

  it("names the daemon when the memory-ranked read printed it above every other row", () => {
    expect(
      daemonCulprit({ foreignAlertGb: 8, memoryHeld: true, ranked: [fseventsd, session], watched: [fseventsd] })!.kill,
    ).toBe("sudo killall fseventsd");
  });

  // Left out of the cut, it weighed at most the lightest kept row then, so a balloon between reads is not it.
  it("names nobody when the ranked cut left the daemon out, however heavy its own later read", () => {
    const heavySession = { ...session, footprintBytes: 20 * 1024 ** 3, footprintGb: 20 };
    expect(daemonCulprit({ foreignAlertGb: 8, memoryHeld: true, ranked: [heavySession], watched: [fseventsd] })).toBe(
      undefined,
    );
  });

  it("names nobody when the ranked read is empty, since an empty read proves nothing about what outweighs it", () => {
    expect(daemonCulprit({ foreignAlertGb: 8, memoryHeld: true, ranked: [], watched: [fseventsd] })).toBe(undefined);
  });

  // A stale session record on a reused pid marks a foreign process fleet, so classification is not trusted.
  it("names nobody when any ranked row outweighs the daemon, whatever its classification", () => {
    const heavyFleet = { ...session, footprintBytes: 40 * 1024 ** 3, footprintGb: 40, pid: 700 };
    expect(
      daemonCulprit({ foreignAlertGb: 8, memoryHeld: true, ranked: [heavyFleet, fseventsd], watched: [fseventsd] }),
    ).toBe(undefined);
  });

  // Picking the heaviest by the watched snapshot alone let pid 101's shrunken ranked row mask pid 102.
  it("judges every watched pid by its lesser footprint before picking the heaviest", () => {
    const daemonAt = ({ gb, pid }: { gb: number; pid: number }): typeof fseventsd => ({
      ...fseventsd,
      footprintBytes: gb * 1024 ** 3,
      footprintGb: gb,
      pid,
    });
    const watched = [daemonAt({ gb: 32, pid: 101 }), daemonAt({ gb: 20, pid: 102 })];
    const ranked = [daemonAt({ gb: 1, pid: 101 }), daemonAt({ gb: 20, pid: 102 }), session];
    expect(daemonCulprit({ foreignAlertGb: 8, memoryHeld: true, ranked, watched })!.why).toContain("(pid 102, root)");
  });
});
