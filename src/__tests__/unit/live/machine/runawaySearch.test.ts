/**
 * The runaway-search criterion: which search processes inside a LIVE seat `machine reap` ends without ending
 * the seat — the incident where six of one seat's greps held the owner's machine at 0% idle for an hour.
 */
import { describe, expect, it } from "vitest";

import { parseElapsedRows, parseTopCpuRows } from "../../../../live/machine/fleetLoad.js";
import {
  RUNAWAY_SEARCH_AGE_SECONDS,
  RUNAWAY_SEARCH_CPU_FLOOR_PCT,
  runawaySearches,
  runawaySearchLabel,
  searchBinaryOf,
  stillUnderLiveSeat,
} from "../../../../live/machine/runawaySearch.js";
import {
  RUNAWAY_ETIME_TEXT,
  RUNAWAY_PROCESSES,
  RUNAWAY_SESSION_ID,
  RUNAWAY_TOP_CPU_TEXT,
} from "./runawaySearchFixtures.js";

/** The incident snapshot's two tables, decoded the way `machine reap` decodes them. */
const cpuRows = parseTopCpuRows({ text: RUNAWAY_TOP_CPU_TEXT });
const elapsedRows = parseElapsedRows({ text: RUNAWAY_ETIME_TEXT });

/** The selection every case below reads, with the reaper's own ancestor (pid 900) protected. */
const selected = runawaySearches({
  cpuRows,
  elapsedRows,
  processes: RUNAWAY_PROCESSES,
  protectedPids: new Set([900, 890, 500]),
});

describe("searchBinaryOf", () => {
  it.each([
    { argv: "ugrep -G --ignore-files --hidden -I x f", binary: "ugrep" },
    { argv: "/usr/bin/grep -c x f", binary: "grep" },
    { argv: "  egrep x f", binary: "egrep" },
    { argv: "/opt/homebrew/bin/rg x", binary: "rg" },
    { argv: "ggrep -P x f", binary: "ggrep" },
  ])("names $binary in $argv", ({ argv, binary }) => {
    expect(searchBinaryOf({ argv })).toBe(binary);
  });

  it.each(["tail -F log", "node grep.js", "/bin/zsh -c grep x f", "grepx f", ""])("names no search in %j", (argv) => {
    expect(searchBinaryOf({ argv })).toBeUndefined();
  });
});

describe("runawaySearches", () => {
  it("selects the old, hot searches under a live seat's tool shells, hottest first", () => {
    expect(selected.map((search) => search.pid)).toEqual([511, 521]);
  });

  it("carries the shell, the session, the cost and the age of each", () => {
    const first = selected[0]!;
    expect(first.binary).toBe("ugrep");
    expect(first.cpuPct).toBe(52.3);
    expect(first.elapsedSeconds).toBe(3480);
    expect(first.shellPid).toBe(510);
    expect(first.sessionId).toBe(RUNAWAY_SESSION_ID);
  });

  it("targets the search pid ALONE, never its shell or its seat, and records its argv for the re-check", () => {
    const first = selected[0]!;
    expect(first.treePids).toEqual([511]);
    expect(Object.keys(first.argvByPid)).toEqual(["511"]);
    expect(first.argvByPid["511"]).toContain("ugrep -G --ignore-files");
  });

  it("leaves an idle stream filter, a young search and a cold one alone", () => {
    const pids = selected.map((search) => search.pid);
    expect(pids).not.toContain(531);
    expect(pids).not.toContain(541);
    expect(pids).not.toContain(551);
  });

  it("leaves a search with no tool shell above it — the owner's terminal's, or the session's direct child", () => {
    const pids = selected.map((search) => search.pid);
    expect(pids).not.toContain(601);
    expect(pids).not.toContain(560);
  });

  it("leaves a dead seat's search to the orphan reaper", () => {
    expect(selected.map((search) => search.pid)).not.toContain(701);
  });

  it("never selects a protected pid, however hot", () => {
    expect(selected.map((search) => search.pid)).not.toContain(900);
    const unprotected = runawaySearches({
      cpuRows,
      elapsedRows,
      processes: RUNAWAY_PROCESSES,
      protectedPids: new Set(),
    });
    expect(unprotected.map((search) => search.pid)).toEqual([511, 521, 900]);
  });

  it("reads both lines on both sides of the boundary", () => {
    const at = runawaySearches({
      ageSeconds: 599,
      cpuFloorPct: 19.9,
      cpuRows,
      elapsedRows,
      processes: RUNAWAY_PROCESSES,
      protectedPids: new Set([900]),
    });
    expect(at.map((search) => search.pid)).toEqual([541, 511, 521, 551]);
    expect(RUNAWAY_SEARCH_AGE_SECONDS).toBe(600);
    expect(RUNAWAY_SEARCH_CPU_FLOOR_PCT).toBe(20);
  });

  it("selects nothing from an unmeasured sample, or with no elapsed rows", () => {
    expect(
      runawaySearches({ cpuRows: [], elapsedRows, processes: RUNAWAY_PROCESSES, protectedPids: new Set() }),
    ).toEqual([]);
    expect(
      runawaySearches({ cpuRows, elapsedRows: [], processes: RUNAWAY_PROCESSES, protectedPids: new Set() }),
    ).toEqual([]);
  });

  it("stops climbing at a pid that is its own parent", () => {
    const cycle = [
      {
        argv: "/bin/zsh -c source /a/.claude/shell-snapshots/snapshot-zsh-1-a.sh && eval 'grep x f'",
        pid: 20,
        ppid: 20,
      },
      { argv: "grep x f", pid: 21, ppid: 20 },
    ];
    expect(
      runawaySearches({
        cpuRows: [{ cpuPct: 90, pid: 21 }],
        elapsedRows: [{ pid: 21, seconds: 9999 }],
        processes: cycle,
        protectedPids: new Set(),
      }),
    ).toEqual([]);
  });

  it("breaks a cpu tie by the lower pid", () => {
    const tied = runawaySearches({
      cpuRows: [
        { cpuPct: 50, pid: 521 },
        { cpuPct: 50, pid: 511 },
      ],
      elapsedRows,
      processes: RUNAWAY_PROCESSES,
      protectedPids: new Set(),
    });
    expect(tied.map((search) => search.pid)).toEqual([511, 521]);
  });

  it("takes a seat only from a claude process and a shell only from `<shell> -c source <snapshot>`", () => {
    const counterfeit = ({
      ancestors,
    }: {
      ancestors: readonly { argv: string; pid: number; ppid: number }[];
    }): readonly number[] =>
      runawaySearches({
        cpuRows: [{ cpuPct: 30, pid: 300 }],
        elapsedRows: [{ pid: 300, seconds: 700 }],
        processes: [...ancestors, { argv: "/usr/bin/grep needle /tmp/file", pid: 300, ppid: 200 }],
        protectedPids: new Set(),
      }).map((search) => search.pid);
    const realSeat = { argv: "/Users/a/.local/bin/claude --session-id deadbeef-0000", pid: 100, ppid: 1 };
    const realShell = {
      argv: "/bin/zsh -c source /a/.claude/shell-snapshots/snapshot-zsh-1-a.sh",
      pid: 200,
      ppid: 100,
    };
    expect(counterfeit({ ancestors: [realSeat, realShell] })).toEqual([300]);
    expect(counterfeit({ ancestors: [{ ...realSeat, argv: "sleep --session-id deadbeef-0000" }, realShell] })).toEqual(
      [],
    );
    const fakeShell = { ...realShell, argv: "python worker.py /a/.claude/shell-snapshots/snapshot-fake.sh" };
    expect(counterfeit({ ancestors: [realSeat, fakeShell] })).toEqual([]);
    // A shell-shaped command sourcing a snapshot outside ~/.claude is not a Claude Code tool shell.
    const foreignSnapshot = { ...realShell, argv: "/bin/zsh -c source /tmp/shell-snapshots/snapshot-fake.sh" };
    expect(counterfeit({ ancestors: [realSeat, foreignSnapshot] })).toEqual([]);
    // The sourced word must END at `.sh`, not merely start with a snapshot name.
    const suffixed = { ...realShell, argv: "/bin/zsh -c source /a/.claude/shell-snapshots/snapshot-x.sh.evil" };
    expect(counterfeit({ ancestors: [realSeat, suffixed] })).toEqual([]);
  });
});

describe("stillUnderLiveSeat", () => {
  it("holds while the same seat is still above the search", () => {
    expect(stillUnderLiveSeat({ processes: RUNAWAY_PROCESSES, search: selected[0]! })).toBe(true);
  });

  it("fails once the seat ended and the search was reparented to launchd", () => {
    const orphaned = RUNAWAY_PROCESSES.filter((row) => row.pid !== 500 && row.pid !== 510).map((row) =>
      row.pid === 511 ? { ...row, ppid: 1 } : row,
    );
    expect(stillUnderLiveSeat({ processes: orphaned, search: selected[0]! })).toBe(false);
  });

  it("fails when a DIFFERENT session now sits above the shell", () => {
    const swapped = RUNAWAY_PROCESSES.map((row) =>
      row.pid === 500
        ? { ...row, argv: row.argv.replace(RUNAWAY_SESSION_ID, "00000000-0000-0000-0000-000000000000") }
        : row,
    );
    expect(stillUnderLiveSeat({ processes: swapped, search: selected[0]! })).toBe(false);
  });

  it("fails when the pid was reused under ANOTHER tool shell of the same seat", () => {
    const shell = RUNAWAY_PROCESSES.find((row) => row.pid === 510)!;
    const reused = [
      ...RUNAWAY_PROCESSES.filter((row) => row.pid !== 510).map((row) =>
        row.pid === 511 ? { ...row, ppid: 520 } : row,
      ),
      { ...shell, pid: 520 },
    ];
    expect(stillUnderLiveSeat({ processes: reused, search: selected[0]! })).toBe(false);
  });
});

describe("runawaySearchLabel", () => {
  it("names the pid, program, cost, age, shell and session — never the pattern", () => {
    const label = runawaySearchLabel({ search: selected[0]! });
    expect(label).toBe(`runaway search 511 (ugrep) · 52.3% cpu · 58m old · shell 510 in session ${RUNAWAY_SESSION_ID}`);
    expect(label).not.toContain("escalate_triage");
  });
});
