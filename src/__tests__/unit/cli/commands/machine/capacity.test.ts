/**
 * The `machine capacity` shell over a fake deps factory — a plain injected fake, never a `vi.mock`, per
 * `.claude/rules/testing.md`. The pure ranking/classification/verdict logic is covered directly in
 * `src/__tests__/unit/live/machine/capacity/`; this file covers the shell's own wiring: flag parsing,
 * `--json`, publishing an alert onto the supervisor stream (a real fixture round-trip, not a mock), and the
 * plan ceilings read beside the machine through a fixed-input `readPlans` seam, so no keychain, network or
 * Codex app-server is touched.
 *
 * The `cpuCount` seam is why the load hold reads 45 in every expectation here: `3 x 15`, the figure
 * `skills/supervisor/reference/fleet-capacity.md` carries for this 15-core device.
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PlanCeilingInputs } from "../../../../../capacity/ceilings.js";
import { runMachineCapacityWithDeps } from "../../../../../cli/commands/machine/capacity.js";
import { MACHINE_CAPACITY_USAGE } from "../../../../../cli/commands/machine/capacityUsage.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import type { Logger } from "../../../../../lib/logger.js";
import { parseProcessStatRows } from "../../../../../live/machine/hiddenCpu.js";
import type { MachineCapacityDeps } from "../../../../../live/machine/read.js";
import { DEFAULT_THRESHOLDS } from "../../../../../plans/thresholds.js";
import { stateHomePaths } from "../../../../../stateHome.js";
import { ENDPOINT_PS_STAT_TEXT, TWO_SAMPLE_TOP_CPU_TEXT } from "../../../live/machine/hiddenCpuFixtures.js";

/** A logger that records what the verb printed, by stream. */
function captureLogger(): { log: Pick<Logger, "error" | "out">; out: string[]; errs: string[] } {
  const out: string[] = [];
  const errs: string[] = [];
  return {
    errs,
    log: {
      error: ({ msg }) => {
        errs.push(msg);
      },
      out: ({ line }) => {
        out.push(line);
      },
    },
    out,
  };
}

const OK_TOP_TEXT = "Load Avg: 1.0, 1.0, 1.0 \nPID    MEM  \n100    500M \n";
const OK_SWAP_TEXT = "vm.swapusage: total = 4096.00M  used = 512.00M  free = 3584.00M";
const OK_PROCESSES = [{ argv: "/opt/some/daemon", pid: 100, ppid: 1 }];
const OK_COMMS = [{ comm: "/opt/some/daemon", pid: 100 }];
const OK_COMPRESSOR_TEXT = "vm.compressor.segment.total: 182761\nvm.compressor.segment.limit: 1234946\n";
const OK_SWAPFILE_COUNT = 3;
/** This device's own core count (`sysctl -n hw.ncpu`), which sizes the load hold at `3 x 15` = 45 (it was `floor(1.5 x 15)` = 22). */
const OK_CPU_COUNT = 15;

/**
 * A load over the 45 hold while every memory gauge is healthy. A reading that once read `ok` was
 * load 34.84 under the old hold of 22; the ruling doubled the hold, so the same shape is 46.5.
 */
const HOLD_LOAD_TOP_TEXT = "Load Avg: 46.5, 30.0, 25.0 \nPID    MEM  \n100    500M \n";

/** A panic log's own line: 100% of the segments limit, 49 swapfiles. */
const HOLD_COMPRESSOR_TEXT = "vm.compressor.segment.total: 1234946\nvm.compressor.segment.limit: 1234946\n";
const HOLD_SWAPFILE_COUNT = 49;

const ALERT_TOP_TEXT = "Load Avg: 1.0, 1.0, 1.0 \nPID    MEM  \n100    19700M\n";
const ALERT_PROCESSES = [{ argv: "/System/Library/mds", pid: 100, ppid: 1 }];
const ALERT_COMMS = [{ comm: "/System/Library/mds", pid: 100 }];

/** No plan configured on either provider — the machine alone. */
const NO_PLANS: PlanCeilingInputs = {
  claude: [],
  claudeThresholds: DEFAULT_THRESHOLDS.claude,
  codex: [],
  codexRoutedAlias: null,
  problems: [],
};

/** One open Claude plan at 22% of its five hours and 35% of its week — a plan-two reading. */
const OPEN_PLANS: PlanCeilingInputs = {
  claude: [
    {
      account: "plan-two@example.test",
      gauge: {
        alias: "plan-two",
        allowance: { kind: "weekly-window" },
        fiveHour: { resetAtIso: "2026-08-31T03:40:00.000Z", status: "allowed", utilization: 0.22 },
        observedAtIso: "2026-08-31T00:19:00.000Z",
        sevenDay: { resetAtIso: "2026-09-03T22:00:00.000Z", status: "allowed", utilization: 0.35 },
        usageLimitPercent: 100,
      },
      kind: "read",
    },
  ],
  claudeThresholds: DEFAULT_THRESHOLDS.claude,
  codex: [],
  codexRoutedAlias: null,
  problems: [],
};

/** A fake deps factory carrying fixed text — no subprocess, no mock. */
function fakeDepsFor({
  topText = OK_TOP_TEXT,
  swapText = OK_SWAP_TEXT,
  compressorText = OK_COMPRESSOR_TEXT,
  swapfileCount = OK_SWAPFILE_COUNT,
  cpuCount = OK_CPU_COUNT,
  processes = OK_PROCESSES,
  comms = OK_COMMS,
  sessions = [],
  cpuSample,
  statRows = [],
  disk,
}: {
  topText?: string;
  swapText?: string;
  compressorText?: string;
  swapfileCount?: number;
  cpuCount?: number;
  processes?: MachineCapacityDeps["processes"] extends () => infer R ? R : never;
  comms?: MachineCapacityDeps["comms"] extends () => infer R ? R : never;
  sessions?: MachineCapacityDeps["sessions"] extends () => infer R ? R : never;
  cpuSample?: string;
  statRows?: MachineCapacityDeps["statRows"] extends () => infer R ? R : never;
  disk?: MachineCapacityDeps["disk"] extends () => infer R ? R : never;
} = {}): () => MachineCapacityDeps {
  return () => ({
    chairSessionId: () => undefined,
    comms: () => comms,
    compressorSysctl: () => compressorText,
    cpuCount: () => cpuCount,
    cpuSample: () => cpuSample,
    disk: () => disk,
    elapsed: () => [],
    processes: () => processes,
    sessions: () => sessions,
    statRows: () => statRows,
    swapUsage: () => swapText,
    swapfileCount: () => swapfileCount,
    topReport: () => topText,
    watchedTopReport: () => undefined,
  });
}

/** `slopweaver machine capacity <tail>` — the tail starts at argv index 4. */
function run({
  tail,
  log,
  depsFor,
  plans = NO_PLANS,
  planReads = [],
}: {
  tail: readonly string[];
  log: Pick<Logger, "error" | "out">;
  depsFor: () => MachineCapacityDeps;
  plans?: PlanCeilingInputs;
  /** Each plan read's `nowIso`, appended as it happens — the witness a test counts reads by. */
  planReads?: string[];
}): Promise<number> {
  return runMachineCapacityWithDeps({
    argv: ["node", "slopweaver", "machine", "capacity", ...tail],
    depsFor,
    log,
    nowIso: "2026-08-31T00:19:00.000Z",
    readPlans: ({ nowIso }) => {
      planReads.push(nowIso);
      return Promise.resolve(plans);
    },
  });
}

let home = "";
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "slopweaver-machine-capacity-"));
});
afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

describe("runMachineCapacityWithDeps", () => {
  it("prints usage on --help without reading anything", async () => {
    const { log, out } = captureLogger();
    const planReads: string[] = [];
    expect(await run({ depsFor: fakeDepsFor(), log, planReads, tail: ["--help"] })).toBe(EXIT_OK);
    expect(out).toEqual([MACHINE_CAPACITY_USAGE]);
    expect(planReads).toEqual([]);
  });

  it("states the disk floor as the boots burst, the next and one spare — never a tree per live session", () => {
    expect(MACHINE_CAPACITY_USAGE).toContain("5.6 GB seat tree each for the 6-seat boots burst, the next\n");
    expect(MACHINE_CAPACITY_USAGE).not.toContain("every live session");
  });

  it("refuses an unknown flag as a usage error", async () => {
    const { log, errs } = captureLogger();
    expect(await run({ depsFor: fakeDepsFor(), log, tail: ["--nope"] })).toBe(EXIT_USAGE);
    expect(errs[0]).toContain("--nope");
  });

  it("exits ok and publishes nothing when nothing crosses its threshold", async () => {
    const { log, out } = captureLogger();
    const exit = await run({ depsFor: fakeDepsFor(), log, tail: ["--home", home] });
    expect(exit).toBe(EXIT_OK);
    expect(out.at(-1)).toContain("machine capacity: ok on memory and cpu");
    expect(() => readFileSync(stateHomePaths({ home }).live.events.streamJsonl, "utf8")).toThrow();
  });

  it("exits error and publishes one alert onto the supervisor stream when the foreign hog crosses its threshold", async () => {
    const { log } = captureLogger();
    const exit = await run({
      depsFor: fakeDepsFor({ comms: ALERT_COMMS, processes: ALERT_PROCESSES, topText: ALERT_TOP_TEXT }),
      log,
      tail: ["--home", home],
    });
    expect(exit).toBe(EXIT_ERROR);
    const stream = readFileSync(stateHomePaths({ home }).live.events.streamJsonl, "utf8").trim().split("\n");
    expect(stream).toHaveLength(1);
    const event: unknown = JSON.parse(stream[0]!);
    expect(event).toMatchObject({
      atIso: "2026-08-31T00:19:00.000Z",
      kind: "capacity-alert",
      source: "machine",
      topForeignLabel: "mds",
    });
  });

  it("publishes an alert naming a session's spawned child and that session, never the foreign process beside it", async () => {
    const { log } = captureLogger();
    const exit = await run({
      depsFor: fakeDepsFor({
        comms: [
          { comm: "/usr/bin/Python", pid: 300 },
          { comm: "/System/Library/mds", pid: 100 },
        ],
        processes: [
          { argv: "/opt/synthetic/bin/claude", pid: 200, ppid: 1 },
          { argv: "Python -", pid: 300, ppid: 200 },
          { argv: "/System/Library/mds", pid: 100, ppid: 1 },
        ],
        sessions: [{ cwd: "/opt/synthetic/worktrees/live-bot-loop-a", pid: 200, sessionId: "d5546c00" }],
        topText: "Load Avg: 1.0, 1.0, 1.0 \nPID    MEM  \n300    21504M\n100    500M \n",
      }),
      log,
      tail: ["--home", home],
    });
    expect(exit).toBe(EXIT_ERROR);
    const stream = readFileSync(stateHomePaths({ home }).live.events.streamJsonl, "utf8").trim().split("\n");
    expect(stream).toHaveLength(1);
    expect(JSON.parse(stream[0]!)).toMatchObject({
      fleetChildLabel: "Python",
      fleetChildSessionId: "d5546c00",
      kind: "capacity-alert",
      topForeignLabel: "mds",
    });
  });

  it("exits error and publishes one capacity-hold onto the supervisor stream on the panic's own readings, with no foreign hog", async () => {
    const { log, out } = captureLogger();
    const exit = await run({
      depsFor: fakeDepsFor({ compressorText: HOLD_COMPRESSOR_TEXT, swapfileCount: HOLD_SWAPFILE_COUNT }),
      log,
      tail: ["--home", home],
    });
    expect(exit).toBe(EXIT_ERROR);
    expect(out.at(-1)).toContain("machine capacity: HOLD on memory (compressor at 100% of its segments limit");
    const stream = readFileSync(stateHomePaths({ home }).live.events.streamJsonl, "utf8").trim().split("\n");
    expect(stream).toHaveLength(1);
    const event: unknown = JSON.parse(stream[0]!);
    expect(event).toMatchObject({
      atIso: "2026-08-31T00:19:00.000Z",
      kind: "capacity-hold",
      segmentsPct: 100,
      source: "machine",
      swapfileCount: 49,
    });
  });

  it("publishes both a hold and an alert when both thresholds are crossed", async () => {
    const { log } = captureLogger();
    await run({
      depsFor: fakeDepsFor({
        comms: ALERT_COMMS,
        compressorText: HOLD_COMPRESSOR_TEXT,
        processes: ALERT_PROCESSES,
        swapfileCount: HOLD_SWAPFILE_COUNT,
        topText: ALERT_TOP_TEXT,
      }),
      log,
      tail: ["--home", home],
    });
    const kinds = readFileSync(stateHomePaths({ home }).live.events.streamJsonl, "utf8")
      .trim()
      .split("\n")
      .map((line) => (JSON.parse(line) as { kind: string }).kind);
    expect(kinds).toEqual(["capacity-hold", "capacity-alert"]);
  });

  it("exits error and publishes a cpu capacity-hold on a load over the 45 hold with idle unread, every memory gauge healthy", async () => {
    const { log, out } = captureLogger();
    const exit = await run({ depsFor: fakeDepsFor({ topText: HOLD_LOAD_TOP_TEXT }), log, tail: ["--home", home] });
    expect(exit).toBe(EXIT_ERROR);
    expect(out.at(-1)).toBe(
      "machine capacity: HOLD on cpu (1-min load 46.5, hold at 45, idle unmeasured, so load judged alone) — 1-min load 46.5 · idle unmeasured · top foreign hog 'daemon' at 0.5 GB · swap 0.5/4 GB · compressor 15% of segments limit · 3 swapfiles",
    );
    const stream = readFileSync(stateHomePaths({ home }).live.events.streamJsonl, "utf8").trim().split("\n");
    const event: unknown = JSON.parse(stream[0]!);
    expect(event).toMatchObject({
      holdOn: "cpu",
      kind: "capacity-hold",
      load1: 46.5,
      segmentsPct: 15,
      source: "machine",
    });
  });

  it("exits ok, publishes nothing and carries the idle into the machine ceiling when the load is over its hold at 64.35% idle", async () => {
    const { log, out } = captureLogger();
    const deps = fakeDepsFor({ cpuSample: TWO_SAMPLE_TOP_CPU_TEXT, topText: HOLD_LOAD_TOP_TEXT });
    expect(await run({ depsFor: deps, log, tail: ["--home", home] })).toBe(EXIT_OK);
    expect(out.at(-1)).toContain("machine capacity: ok on memory and cpu — 1-min load 46.5 · 64.35% idle ·");
    expect(() => readFileSync(stateHomePaths({ home }).live.events.streamJsonl, "utf8")).toThrow();
    const json = captureLogger();
    await run({ depsFor: deps, log: json.log, tail: ["--home", home, "--json"] });
    const parsed = JSON.parse(json.out[0]!) as { ceilings: { ceilings: { id: string; headroom: number }[] } };
    expect(parsed.ceilings.ceilings.find((ceiling) => ceiling.id === "machine")!.headroom).toBe(0.5544);
  });

  it("publishes the hold when the same load reads under the idle floor", async () => {
    const { log } = captureLogger();
    const busy = TWO_SAMPLE_TOP_CPU_TEXT.replace(
      "CPU usage: 25.47% user, 10.17% sys, 64.35% idle ",
      "CPU usage: 80.00% user, 15.00% sys, 5.00% idle ",
    );
    const exit = await run({
      depsFor: fakeDepsFor({ cpuSample: busy, topText: HOLD_LOAD_TOP_TEXT }),
      log,
      tail: ["--home", home],
    });
    expect(exit).toBe(EXIT_ERROR);
  });

  it("names both subjects in holdOn when the compressor and the load both cross", async () => {
    const { log } = captureLogger();
    await run({
      depsFor: fakeDepsFor({ compressorText: HOLD_COMPRESSOR_TEXT, topText: HOLD_LOAD_TOP_TEXT }),
      log,
      tail: ["--home", home],
    });
    const stream = readFileSync(stateHomePaths({ home }).live.events.streamJsonl, "utf8").trim().split("\n");
    expect(JSON.parse(stream[0]!)).toMatchObject({ holdOn: "memory and cpu", kind: "capacity-hold" });
  });

  it("names a process that refused its stats in the verdict and --json, exiting ok and publishing nothing", async () => {
    const { log, out } = captureLogger();
    const deps = fakeDepsFor({
      cpuSample: TWO_SAMPLE_TOP_CPU_TEXT,
      statRows: parseProcessStatRows({ text: ENDPOINT_PS_STAT_TEXT }),
    });
    expect(await run({ depsFor: deps, log, tail: ["--home", home] })).toBe(EXIT_OK);
    expect(out.at(-1)).toBe(
      "machine capacity: ok on memory and cpu — 1-min load 1 · 64.35% idle · top foreign hog 'daemon' at 0.5 GB · hidden from top: 'com.example.endpoint.Agent' +3 more, 2.8 cores of cpu unattributed · swap 0.5/4 GB · compressor 15% of segments limit · 3 swapfiles",
    );
    expect(() => readFileSync(stateHomePaths({ home }).live.events.streamJsonl, "utf8")).toThrow();
    const json = captureLogger();
    await run({ depsFor: deps, log: json.log, tail: ["--home", home, "--json"] });
    expect(JSON.parse(json.out[0]!)).toMatchObject({
      hiddenCpu: { busyCores: 5.3, idlePct: 64.35, unattributedCores: 2.8, visibleCores: 2.6 },
    });
  });

  it("prints the flattened --json shape with a top-level swapUsedGb and the hold gauge", async () => {
    const { log, out } = captureLogger();
    await run({ depsFor: fakeDepsFor(), log, tail: ["--home", home, "--json"] });
    const parsed: unknown = JSON.parse(out[0]!);
    expect(parsed).toMatchObject({
      alert: false,
      graded: ["memory", "cpu"],
      hold: false,
      holdSubjects: [],
      loadHold: 45,
      segmentsPct: 15,
      swapTotalGb: 4,
      swapUsedGb: 0.5,
      swapfileCount: 3,
      ungraded: [],
    });
  });

  it("carries the ceilings in --json, each plan window as used of 100 and the machine as load of its hold", async () => {
    const { log, out } = captureLogger();
    const planReads: string[] = [];
    await run({ depsFor: fakeDepsFor(), log, planReads, plans: OPEN_PLANS, tail: ["--home", home, "--json"] });
    const parsed = JSON.parse(out[0]!) as { ceilings: unknown };
    expect(out).toHaveLength(1);
    expect(planReads).toEqual(["2026-08-31T00:19:00.000Z"]);
    expect(parsed.ceilings).toEqual({
      ceilings: [
        {
          account: null,
          freeResets: null,
          headroom: 0.9778,
          id: "machine",
          kind: "machine",
          reason: null,
          status: "open",
          windows: [{ available: 45, resetAtIso: null, used: 1, window: "load1" }],
        },
        {
          account: "plan-two@example.test",
          freeResets: null,
          headroom: 0.65,
          id: "claude:plan-two",
          kind: "claude",
          reason: null,
          status: "open",
          windows: [
            { available: 100, resetAtIso: "2026-08-31T03:40:00.000Z", used: 22, window: "five-hour" },
            { available: 100, resetAtIso: "2026-09-03T22:00:00.000Z", used: 35, window: "seven-day" },
          ],
        },
      ],
      lowest: "claude:plan-two",
      observedAtIso: "2026-08-31T00:19:00.000Z",
      problems: [],
      routes: [
        { driver: "claude", headroom: 0.65, limitingCeilingId: "claude:plan-two", planCeilingId: "claude:plan-two" },
      ],
      selectedRoute: {
        driver: "claude",
        headroom: 0.65,
        limitingCeilingId: "claude:plan-two",
        planCeilingId: "claude:plan-two",
      },
    });
  });

  it("prints the ceilings above the machine lines, leaving the machine verdict last", async () => {
    const { log, out } = captureLogger();
    await run({ depsFor: fakeDepsFor(), log, plans: OPEN_PLANS, tail: ["--home", home] });
    expect(out.slice(0, 3)).toEqual([
      "ceilings: lowest unused is claude:plan-two — a seat can start now via claude on claude:plan-two, 65% headroom",
      "  machine open, 98% unused — load1 1/45",
      "  claude:plan-two open, 65% unused — five-hour 22/100 resets 2026-08-31T03:40Z · seven-day 35/100 resets 2026-09-03T22:00Z",
    ]);
    expect(out.at(-1)).toContain("machine capacity: ok on memory and cpu");
  });

  it("counts the processes by default and lists them only under --full", async () => {
    const plain = captureLogger();
    await run({ depsFor: fakeDepsFor(), log: plain.log, plans: OPEN_PLANS, tail: ["--home", home] });
    const full = captureLogger();
    await run({ depsFor: fakeDepsFor(), log: full.log, plans: OPEN_PLANS, tail: ["--home", home, "--full"] });
    const countLines = ({ lines }: { lines: readonly string[] }): number =>
      lines.filter((line) => line.startsWith("processes: ")).length;
    expect([countLines({ lines: plain.out }), countLines({ lines: full.out })]).toEqual([1, 0]);
    const processLines = ({ lines }: { lines: readonly string[] }): number =>
      lines.filter((line) => line.includes(" (pid ")).length;
    expect(processLines({ lines: plain.out })).toBe(0);
    expect(processLines({ lines: full.out })).toBeGreaterThan(0);
    expect(full.out.at(-1)).toBe(plain.out.at(-1));
  });

  it("keeps a clean machine's exit at ok when a provider's plans could not be read", async () => {
    const { log, out } = captureLogger();
    const exit = await run({
      depsFor: fakeDepsFor(),
      log,
      plans: { ...NO_PLANS, problems: ["codex: the plan register could not be read"] },
      tail: ["--home", home],
    });
    expect(exit).toBe(EXIT_OK);
    expect(out).toContain("  could not read: codex: the plan register could not be read");
  });
});
