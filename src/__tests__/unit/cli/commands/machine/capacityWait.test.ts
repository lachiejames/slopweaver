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
import {
  MACHINE_CAPACITY_PRODUCER,
  RECORD_READING_NEEDS_JSON,
  type RecordCapacityReading,
} from "../../../../../cli/commands/machine/capacityReading.js";
import { EXIT_DEFERRED, EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import { err, unwrap, unwrapErr } from "../../../../../lib/result.js";
import type { MachineCapacityDeps } from "../../../../../live/machine/read.js";
import { DEFAULT_THRESHOLDS } from "../../../../../plans/thresholds.js";
import { ReadingsErrors } from "../../../../../readings/errors.js";
import type { PrintedReadingAppend } from "../../../../../readings/printedReading.js";
import { lastReading, recordReading as recordReadingInStore } from "../../../../../readings/store.js";
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
  recordReading,
}: {
  tail: readonly string[];
  depsFor: () => MachineCapacityDeps;
  /** The ledger append; absent, the real store under the test's own `--home`. */
  recordReading?: RecordCapacityReading;
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
    ...(recordReading === undefined ? {} : { recordReading }),
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

  it("records once, the reading the wait ended on, never a held poll", async () => {
    const appended: PrintedReadingAppend[] = [];
    const { exit, out, errs } = await run({
      depsFor: machineHoldingFor({ holdReads: 3 }),
      recordReading: (input) => {
        appended.push(input);
        return recordReadingInStore({ ...input });
      },
      tail: ["--home", home, "--json", "--wait", "--record-reading", "tick-12"],
    });
    expect(exit).toBe(EXIT_OK);
    // The wait polled through three held readings (its status line), yet stdout carries one document and one append.
    expect(errs).toEqual(["machine capacity: HOLD on memory — waiting for it to clear"]);
    expect(out).toHaveLength(1);
    expect(appended).toHaveLength(1);
    expect(appended.map((input) => [input.by, input.document])).toEqual([["tick-12", out[0]]]);
    expect((JSON.parse(out[0]!) as { hold: boolean }).hold).toBe(false);
  });

  it("exits EXIT_ERROR, not EXIT_DEFERRED, when a timed-out wait's append is refused", async () => {
    const refusal = ReadingsErrors.ledgerBusy({ why: "held by pid 4242" });
    const { exit, errs } = await run({
      depsFor: machineHoldingFor({ holdReads: 99 }),
      recordReading: () => err(refusal),
      tail: ["--home", home, "--json", "--wait", "--timeout-seconds", "10", "--record-reading", "tick-12"],
    });
    expect(exit).toBe(EXIT_ERROR);
    expect(errs).toEqual([
      "machine capacity: HOLD on memory — waiting for it to clear",
      "WAIT-TIMEOUT machine capacity HOLD on memory still on after 10s",
      `machine capacity: the reading was not recorded — ${refusal.message}`,
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

describe("machine capacity --record-reading", () => {
  it("refuses --record-reading without --json before reading anything", async () => {
    const { exit, errs, out, planReads } = await run({
      depsFor: machineHoldingFor({ holdReads: 0 }),
      tail: ["--home", home, "--record-reading", "tick-12"],
    });
    expect([exit, errs, out, planReads]).toEqual([EXIT_USAGE, [RECORD_READING_NEEDS_JSON], [], 0]);
  });

  it("appends exactly the printed document under --json, observed at the reading's instant, by the flag's value", async () => {
    const { exit, out } = await run({
      depsFor: machineHoldingFor({ holdReads: 0 }),
      tail: ["--home", home, "--json", "--record-reading", "tick-12"],
    });
    const { record, document } = unwrap(lastReading({ home, producer: MACHINE_CAPACITY_PRODUCER }));
    expect([exit, record.by, record.observedAtIso, JSON.stringify(document)]).toEqual([
      EXIT_OK,
      "tick-12",
      "2026-09-16T00:00:00.000Z",
      out[0],
    ]);
  });

  it("prints the brief document under --brief but appends the full one, off one plan read", async () => {
    const brief = await run({
      depsFor: machineHoldingFor({ holdReads: 0 }),
      tail: ["--home", home, "--brief", "--json", "--record-reading", "tick-12"],
    });
    const full = await run({ depsFor: machineHoldingFor({ holdReads: 0 }), tail: ["--home", home, "--json"] });
    const stored = JSON.stringify(unwrap(lastReading({ home, producer: MACHINE_CAPACITY_PRODUCER })).document);
    expect([brief.planReads, stored === brief.out[0], stored]).toEqual([1, false, full.out[0]]);
  });

  it("records nothing without the flag", async () => {
    await run({ depsFor: machineHoldingFor({ holdReads: 0 }), tail: ["--home", home, "--json"] });
    expect(unwrapErr(lastReading({ home, producer: MACHINE_CAPACITY_PRODUCER })).code).toBe("NO_READING");
  });

  it("exits 1 naming the refusal when the append is refused, after the document already printed", async () => {
    const refusal = ReadingsErrors.ledgerBusy({ why: "held by pid 4242" });
    const { exit, out, errs } = await run({
      depsFor: machineHoldingFor({ holdReads: 0 }),
      recordReading: () => err(refusal),
      tail: ["--home", home, "--json", "--record-reading", "tick-12"],
    });
    expect([exit, out.length, errs.at(-1)]).toEqual([
      EXIT_ERROR,
      1,
      `machine capacity: the reading was not recorded — ${refusal.message}`,
    ]);
  });
});
