import { describe, expect, it } from "vitest";

import { type BrowserReapOutcome, emptyBrowserReapExecution } from "../../../../browser/sessionReapReport.js";
import type { DevServerPlan } from "../../../../live/machine/devServers.js";
import { parseElapsedRows, parseTopCpuRows } from "../../../../live/machine/fleetLoad.js";
import { ownAncestry, reapPlan, renderReapLines, stillTheSameProcess } from "../../../../live/machine/reap.js";
import type { RunawaySearch } from "../../../../live/machine/runawaySearch.js";
import {
  BUSY_SEAT,
  DEAD_SEAT,
  INCIDENT_ETIME_TEXT,
  INCIDENT_PROCESSES,
  INCIDENT_TOP_CPU_TEXT,
} from "./fleetLoadFixtures.js";
import { RUNAWAY_SESSION_ID } from "./runawaySearchFixtures.js";

/** No dev server stood in the incident snapshot, so this class is empty across every line below. */
const EMPTY_DEV_SERVERS: DevServerPlan = { left: [], stray: [] };
const NO_BROWSER: BrowserReapOutcome = { execution: emptyBrowserReapExecution(), verdicts: [] };

/** A machine with no orphans, for the runaway-search lines. */
const CLEAN_PLAN = reapPlan({ cpuRows: [], elapsedRows: [], processes: [], selfPid: 999 });

/** The incident's hottest search, as `./runawaySearch.ts` selects it. */
const SEARCH: RunawaySearch = {
  argvByPid: { "511": "ugrep -G x" },
  binary: "ugrep",
  cpuPct: 52.3,
  elapsedSeconds: 3480,
  pid: 511,
  sessionId: RUNAWAY_SESSION_ID,
  shellPid: 510,
  treePids: [511],
};

/** The reap decision every assertion below is taken from, run as an unrelated process (pid 999). */
const plan = reapPlan({
  cpuRows: parseTopCpuRows({ text: INCIDENT_TOP_CPU_TEXT }),
  elapsedRows: parseElapsedRows({ text: INCIDENT_ETIME_TEXT }),
  processes: INCIDENT_PROCESSES,
  selfPid: 999,
});

describe("reapPlan", () => {
  it("takes every orphaned shell whose seat is dead, and its whole tree", () => {
    expect(plan.targets.map((target) => target.shellPid)).toEqual([300, 301]);
    expect(plan.targets[0]!.snapshot).toBe(DEAD_SEAT);
    expect(plan.processCount).toBe(3);
  });

  it("orders each tree DEEPEST FIRST, so a parent cannot fork a replacement between signals", () => {
    expect(plan.targets[0]!.treePids).toEqual([302, 300]);
  });

  it("carries the CPU a target gives back and how long it has been running", () => {
    expect(plan.targets[0]!.cpuPct).toBe(31);
    expect(plan.targets[0]!.elapsedSeconds).toBe(93_600);
    expect(plan.cpuPct).toBe(43);
  });

  it("leaves an orphan alone, WITH a reason, when its seat still has a live shell", () => {
    expect(plan.skipped).toEqual([
      { shellPid: 310, snapshot: BUSY_SEAT, why: "its seat still has a live shell on this snapshot" },
    ]);
  });

  it("never signals a pid in its OWN parent chain, however dead the seat looks", () => {
    const suicidal = reapPlan({
      cpuRows: [],
      elapsedRows: [],
      processes: INCIDENT_PROCESSES,
      selfPid: 302,
    });
    expect(suicidal.targets.map((target) => target.shellPid)).toEqual([301]);
    expect(suicidal.skipped.map((skip) => skip.why)).toContain("this process's own parent chain runs through it");
  });

  it("says CPU was unmeasured rather than reporting a reap that gives back zero", () => {
    const blind = reapPlan({ cpuRows: [], elapsedRows: [], processes: INCIDENT_PROCESSES, selfPid: 999 });
    expect(blind.cpuPct).toBeUndefined();
    expect(blind.targets[0]!.cpuPct).toBeUndefined();
  });

  it("plans nothing at all on a machine with no orphans", () => {
    const clean = reapPlan({
      cpuRows: [],
      elapsedRows: [],
      processes: INCIDENT_PROCESSES.filter((row) => row.ppid !== 1),
      selfPid: 999,
    });
    expect(clean.targets).toEqual([]);
    expect(clean.processCount).toBe(0);
  });
});

describe("stillTheSameProcess", () => {
  /** The first target's tree: the orphan shell 300 and its child 302. */
  const target = plan.targets[0]!;

  it("records what every pid in the tree was RUNNING, so a signal has something to re-check", () => {
    expect(Object.keys(target.argvByPid).toSorted()).toEqual(["300", "302"]);
    expect(target.argvByPid["302"]).toContain("vitest run");
  });

  it("allows a pid whose argv is unchanged", () => {
    const current = new Map(INCIDENT_PROCESSES.map((row) => [row.pid, row.argv]));
    expect(stillTheSameProcess({ current, pid: 302, target })).toBe(true);
  });

  it("REFUSES a pid the kernel recycled onto a different process", () => {
    const current = new Map<number, string>([
      [302, "/bin/zsh -c source /a/.claude/shell-snapshots/snapshot-zsh-9-new.sh"],
    ]);
    expect(stillTheSameProcess({ current, pid: 302, target })).toBe(false);
  });

  it("REFUSES a pid that is simply gone", () => {
    expect(stillTheSameProcess({ current: new Map(), pid: 302, target })).toBe(false);
  });

  it("REFUSES a pid this plan never selected", () => {
    const current = new Map(INCIDENT_PROCESSES.map((row) => [row.pid, row.argv]));
    expect(stillTheSameProcess({ current, pid: 100, target })).toBe(false);
  });
});

describe("ownAncestry", () => {
  it("walks itself and every parent up to launchd", () => {
    expect([...ownAncestry({ processes: INCIDENT_PROCESSES, selfPid: 302 })].toSorted((a, b) => a - b)).toEqual([
      1, 300, 302,
    ]);
  });

  it("is just the caller when the snapshot does not carry it", () => {
    expect([...ownAncestry({ processes: INCIDENT_PROCESSES, selfPid: 7777 })]).toEqual([7777]);
  });
});

describe("renderReapLines", () => {
  it("names every pid it killed, what it left alone and why, and summarises last", () => {
    const lines = renderReapLines({
      outcome: {
        browser: NO_BROWSER,
        devServers: EMPTY_DEV_SERVERS,
        dryRun: false,
        failed: [],
        killed: [302, 300, 301],
        plan,
        searches: [],
      },
    });
    expect(lines[0]).toContain("REAPED shell 300 + 1 descendant(s)");
    expect(lines[0]).toContain("31% cpu");
    expect(lines[2]).toBe("left shell 310 alone: its seat still has a live shell on this snapshot");
    expect(lines.at(-1)).toBe(
      "machine reap: reaped 2 orphaned fleet shell(s), 3 process(es), 43% cpu, 0 stray dev server(s) and 0 runaway search(es) — 1 left alone, 0 signal(s) failed",
    );
  });

  it("says WOULD REAP on a dry run, so a plan is never mistaken for an act", () => {
    const lines = renderReapLines({
      outcome: {
        browser: NO_BROWSER,
        devServers: EMPTY_DEV_SERVERS,
        dryRun: true,
        failed: [],
        killed: [],
        plan,
        searches: [],
      },
    });
    expect(lines[0]).toContain("WOULD REAP shell 300");
    expect(lines.at(-1)).toContain("machine reap: would reap 2 orphaned fleet shell(s)");
  });

  it("reports a signal that failed rather than counting it as killed", () => {
    const lines = renderReapLines({
      outcome: {
        browser: NO_BROWSER,
        devServers: EMPTY_DEV_SERVERS,
        dryRun: false,
        failed: [{ pid: 302, why: "ESRCH" }],
        killed: [300, 301],
        plan,
        searches: [],
      },
    });
    expect(lines).toContain("could not signal 302: ESRCH");
    expect(lines.at(-1)).toContain("1 signal(s) failed");
  });

  it("names each runaway search it killed and that its seat lives on, and counts them in the summary", () => {
    const lines = renderReapLines({
      outcome: {
        browser: NO_BROWSER,
        devServers: EMPTY_DEV_SERVERS,
        dryRun: false,
        failed: [],
        killed: [511],
        plan: CLEAN_PLAN,
        searches: [SEARCH],
      },
    });
    expect(lines[0]).toBe(
      `REAPED runaway search 511 (ugrep) · 52.3% cpu · 58m old · shell 510 in session ${RUNAWAY_SESSION_ID} — the seat is left running`,
    );
    expect(lines.at(-1)).toBe(
      "machine reap: reaped 0 orphaned fleet shell(s), 0 process(es), cpu unmeasured, 0 stray dev server(s) and 1 runaway search(es) — 0 left alone, 0 signal(s) failed",
    );
  });

  it("names a search whose signal FAILED only by its failure, never as REAPED", () => {
    const lines = renderReapLines({
      outcome: {
        browser: NO_BROWSER,
        devServers: EMPTY_DEV_SERVERS,
        dryRun: false,
        failed: [{ pid: 511, why: "ESRCH" }],
        killed: [],
        plan: CLEAN_PLAN,
        searches: [SEARCH],
      },
    });
    expect(lines.filter((line) => line.includes("runaway search 511"))).toEqual([]);
    expect(lines).toContain("could not signal 511: ESRCH");
  });
});
