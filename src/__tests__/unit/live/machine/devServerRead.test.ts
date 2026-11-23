/**
 * Reading the docs-site run records and the session registry off disk — criterion 1's second half, end to
 * end over real files rather than over its own pure core.
 *
 * MEASURED: a live seat working in a worktree it does not LIVE in started a docs server nine
 * times in one morning, because `machine reap` killed the one it was reading each tick. The record is what
 * closes that, so the round trip is what has to be proven: a file `scripts/docs-site.sh` wrote, a registry
 * row Claude Code wrote, and the one set of root pids a reap must leave alone.
 *
 * Two readings, two failure directions, and they are opposite answers: a machine that has never served the
 * docs site is a MEASURED empty set (nothing was recorded, so nothing is protected), while a registry that
 * could not be read is `undefined` — the criterion switched off, never "no session is live".
 *
 * The records live under the cache root; a server started before they moved there recorded itself under the
 * home, and is still protected.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { cachePaths } from "../../../../cacheHome.js";
import { readLiveStarterRootPids } from "../../../../live/machine/devServerRead.js";
import { parseProcessRows } from "../../../../live/standing/processes.js";

/** The starter session's own pid, and the wrapper pid of the server it started. */
const STARTER_PID = 4242;
const ROOT_PID = 200;
const SESSION_ID = "eb775ba4-4667-4979-8f4c-2b8c1e9a0c11";

/** A snapshot in which the starter session is still running — what makes a registry row LIVE. */
const PROCESSES = parseProcessRows({
  text: `  ${String(STARTER_PID)}     1 claude --session-id ${SESSION_ID}`,
});

const made: string[] = [];

/** One throwaway directory, remembered so the file cleans up after its own tests. */
const tempDir = ({ prefix }: { prefix: string }): string => {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  made.push(dir);
  return dir;
};

/** An empty state home and cache root. */
const emptyMachine = (): { home: string; cacheRoot: string } => ({
  cacheRoot: tempDir({ prefix: "slopweaver-cache-" }),
  home: tempDir({ prefix: "slopweaver-home-" }),
});

/**
 * A machine carrying one run record, written as `scripts/docs-site.sh` writes it — under the cache root, or under the
 * home where a server started before the move recorded itself.
 */
const machineWithRecord = ({
  record,
  under = "cache",
}: {
  record: Record<string, unknown>;
  under?: "cache" | "legacy-home";
}): { home: string; cacheRoot: string } => {
  const machine = emptyMachine();
  let dir = cachePaths({ root: machine.cacheRoot }).docsSite;
  if (under === "legacy-home") {
    dir = join(machine.home, "docs-site");
  }
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "alpha.json"), JSON.stringify(record), "utf8");
  return machine;
};

/** A session registry directory holding one row, named for the pid the way Claude Code names it. */
const registryWith = ({ pid, sessionId }: { pid: number; sessionId: string }): string => {
  const dir = tempDir({ prefix: "slopweaver-registry-" });
  writeFileSync(join(dir, `${String(pid)}.json`), JSON.stringify({ pid, sessionId }), "utf8");
  return dir;
};

afterEach(() => {
  for (const dir of made.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

describe("readLiveStarterRootPids", () => {
  it("protects the recorded root pid when the session that started it is still live", () => {
    const machine = machineWithRecord({
      record: { pid: ROOT_PID, port: 3001, starterPid: STARTER_PID, starterSessionId: SESSION_ID },
    });
    const sessionsDir = registryWith({ pid: STARTER_PID, sessionId: SESSION_ID });

    expect([...readLiveStarterRootPids({ ...machine, processes: PROCESSES, sessionsDir })!]).toEqual([ROOT_PID]);
  });

  it("protects a server a pre-move docs-site.sh recorded under the home", () => {
    const machine = machineWithRecord({
      record: { pid: ROOT_PID, port: 3001, starterPid: STARTER_PID, starterSessionId: SESSION_ID },
      under: "legacy-home",
    });
    const sessionsDir = registryWith({ pid: STARTER_PID, sessionId: SESSION_ID });

    expect([...readLiveStarterRootPids({ ...machine, processes: PROCESSES, sessionsDir })!]).toEqual([ROOT_PID]);
  });

  it("protects nothing when the registry row at that pid names a DIFFERENT session — a recycled pid", () => {
    const machine = machineWithRecord({
      record: { pid: ROOT_PID, starterPid: STARTER_PID, starterSessionId: SESSION_ID },
    });
    const sessionsDir = registryWith({ pid: STARTER_PID, sessionId: "a-different-session" });

    expect([...readLiveStarterRootPids({ ...machine, processes: PROCESSES, sessionsDir })!]).toEqual([]);
  });

  it("protects nothing from a record an older docs-site.sh wrote, which named no starter at all", () => {
    const machine = machineWithRecord({ record: { pid: ROOT_PID, port: 3001 } });
    const sessionsDir = registryWith({ pid: STARTER_PID, sessionId: SESSION_ID });

    expect([...readLiveStarterRootPids({ ...machine, processes: PROCESSES, sessionsDir })!]).toEqual([]);
  });

  it("answers a MEASURED empty set for a machine that has never served the docs site", () => {
    const sessionsDir = registryWith({ pid: STARTER_PID, sessionId: SESSION_ID });

    expect([...readLiveStarterRootPids({ ...emptyMachine(), processes: PROCESSES, sessionsDir })!]).toEqual([]);
  });

  it("answers undefined when the session registry could not be read, which switches the criterion OFF", () => {
    const machine = machineWithRecord({
      record: { pid: ROOT_PID, starterPid: STARTER_PID, starterSessionId: SESSION_ID },
    });

    expect(
      readLiveStarterRootPids({ ...machine, processes: PROCESSES, sessionsDir: join(machine.home, "no-registry") }),
    ).toBeUndefined();
  });

  it("does not protect a record whose starter session is no longer in the snapshot", () => {
    const machine = machineWithRecord({
      record: { pid: ROOT_PID, starterPid: STARTER_PID, starterSessionId: SESSION_ID },
    });
    const sessionsDir = registryWith({ pid: STARTER_PID, sessionId: SESSION_ID });

    expect([...readLiveStarterRootPids({ ...machine, processes: [], sessionsDir })!]).toEqual([]);
  });
});
