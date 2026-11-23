/**
 * `machine capacity --wait` over a scripted machine and a clock that only moves when the verb sleeps: the hold
 * prints once while it stands, the report prints when it clears, and a hold that outlives the timeout exits 4
 * — with the stream seeing the first and the last reading, never one row per re-read.
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { runMachineCapacityWithDeps } from "../../../../../cli/commands/machine/capacity.js";
import { EXIT_DEFERRED, EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import type { MachineCapacityDeps } from "../../../../../live/machine/read.js";
import { DEFAULT_THRESHOLDS } from "../../../../../plans/thresholds.js";
import { stateHomePaths } from "../../../../../stateHome.js";
import type { WaitClock } from "../../../../../wait/loop.js";

const OK_COMPRESSOR_TEXT = "vm.compressor.segment.total: 182761\nvm.compressor.segment.limit: 1234946\n";
/** A panic log's own compressor line: 100% of the segments limit. */
const HOLD_COMPRESSOR_TEXT = "vm.compressor.segment.total: 1234946\nvm.compressor.segment.limit: 1234946\n";

/** A machine whose compressor holds for the first `holdReads` readings, then clears. */
function machineHoldingFor({ holdReads }: { holdReads: number }): () => MachineCapacityDeps {
  let reads = 0;
  return () => ({
    chairSessionId: () => undefined,
    comms: () => [{ comm: "/opt/some/daemon", pid: 100 }],
    compressorSysctl: () => {
      reads += 1;
      return reads <= holdReads ? HOLD_COMPRESSOR_TEXT : OK_COMPRESSOR_TEXT;
    },
    cpuCount: () => 15,
    cpuSample: () => undefined,
    disk: () => undefined,
    elapsed: () => [],
    processes: () => [{ argv: "/opt/some/daemon", pid: 100, ppid: 1 }],
    sessions: () => [],
    statRows: () => [],
    swapUsage: () => "vm.swapusage: total = 4096.00M  used = 512.00M  free = 3584.00M",
    swapfileCount: () => 3,
    topReport: () => "Load Avg: 1.0, 1.0, 1.0 \nPID    MEM  \n100    500M \n",
    watchedTopReport: () => undefined,
  });
}

/** A clock that advances only when the verb sleeps. */
function fakeClock(): WaitClock {
  let now = 0;
  return {
    nowMs: () => now,
    sleep: ({ ms }) => {
      now += ms;
      return Promise.resolve();
    },
  };
}

/** Run `machine capacity <tail>` and capture both streams. */
async function run({
  tail,
  depsFor,
}: {
  tail: readonly string[];
  depsFor: () => MachineCapacityDeps;
}): Promise<{ exit: number; out: string[]; errs: string[]; planReads: number }> {
  const out: string[] = [];
  const errs: string[] = [];
  let planReads = 0;
  const exit = await runMachineCapacityWithDeps({
    argv: ["node", "slopweaver", "machine", "capacity", ...tail],
    clock: fakeClock(),
    depsFor,
    log: {
      error: ({ msg }) => {
        errs.push(msg);
      },
      out: ({ line }) => {
        out.push(line);
      },
    },
    nowIso: "2026-09-16T00:00:00.000Z",
    readPlans: () => {
      planReads += 1;
      return Promise.resolve({
        claude: [],
        claudeThresholds: DEFAULT_THRESHOLDS.claude,
        codex: [],
        codexRoutedAlias: null,
        problems: [],
      });
    },
  });
  return { errs, exit, out, planReads };
}

/** The kinds of every event the verb published, in order. */
function streamKinds({ home }: { home: string }): readonly string[] {
  return readFileSync(stateHomePaths({ home }).live.events.streamJsonl, "utf8")
    .trim()
    .split("\n")
    .map((line) => (JSON.parse(line) as { kind: string }).kind);
}

let home = "";
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "slopweaver-capacity-wait-"));
});
afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

describe("machine capacity --wait", () => {
  it("prints the hold once while it stands, then the cleared report, and exits ok", async () => {
    const { exit, out, planReads } = await run({
      depsFor: machineHoldingFor({ holdReads: 3 }),
      tail: ["--home", home, "--wait"],
    });
    expect(exit).toBe(EXIT_OK);
    // A machine read per poll, ONE plan read — after the reading the wait ended on, never inside the poll.
    expect(planReads).toBe(1);
    expect(out.filter((line) => line.includes("waiting for it to clear"))).toEqual([
      "machine capacity: HOLD on memory — waiting for it to clear",
    ]);
    expect(out.at(-1)).toContain("machine capacity: ok on memory and cpu");
    expect(streamKinds({ home })).toEqual(["capacity-hold"]);
  });

  it("exits EXIT_DEFERRED naming the subject when the hold outlives the timeout", async () => {
    const { exit, out } = await run({
      depsFor: machineHoldingFor({ holdReads: 99 }),
      tail: ["--home", home, "--wait", "--timeout-seconds", "10"],
    });
    expect(exit).toBe(EXIT_DEFERRED);
    expect(out.at(-1)).toBe("WAIT-TIMEOUT machine capacity HOLD on memory still on after 10s");
    expect(streamKinds({ home })).toEqual(["capacity-hold", "capacity-hold"]);
  });

  it("keeps stdout to the one JSON document under --json, sending the wait's status lines to stderr", async () => {
    const { exit, out, errs } = await run({
      depsFor: machineHoldingFor({ holdReads: 99 }),
      tail: ["--home", home, "--json", "--wait", "--timeout-seconds", "10"],
    });
    expect(exit).toBe(EXIT_DEFERRED);
    expect(out).toHaveLength(1);
    const document = JSON.parse(out[0]!) as { hold: boolean; ceilings: { lowest: string | null } };
    expect(document.hold).toBe(true);
    expect(document.ceilings.lowest).toBe("machine");
    expect(errs).toEqual([
      "machine capacity: HOLD on memory — waiting for it to clear",
      "WAIT-TIMEOUT machine capacity HOLD on memory still on after 10s",
    ]);
  });

  it("refuses --timeout-seconds without --wait", async () => {
    const { exit, errs } = await run({
      depsFor: machineHoldingFor({ holdReads: 0 }),
      tail: ["--timeout-seconds", "10"],
    });
    expect(exit).toBe(EXIT_USAGE);
    expect(errs[0]).toBe("--timeout-seconds only means something with --wait");
  });
});
