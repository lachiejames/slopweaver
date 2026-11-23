/**
 * `machine capacity --brief` — the reading the sweep contract's step 8 acts on, projected from the same report and
 * ceilings the full document renders, so the two can never disagree about a hold.
 */
import { describe, expect, it } from "vitest";
import { buildCeilingsReading } from "../../../../capacity/ceilings.js";
import { buildMachineCapacityReport } from "../../../../live/machine/capacity.js";
import { briefCapacityJson, renderBriefMachineCapacityLines } from "../../../../live/machine/capacityBrief.js";
import { type DispatchBlock, machineCapacityJson } from "../../../../live/machine/capacityRender.js";
import { DEFAULT_THRESHOLDS } from "../../../../plans/thresholds.js";

const NOW = "2026-10-26T08:00:00.000Z";

/** The hidden-cpu shape: the Docker VM tops the footprint table on an otherwise healthy machine. */
const REPORT = buildMachineCapacityReport({
  chairSessionId: undefined,
  comms: [
    { comm: "/System/Library/Frameworks/Virtualization.framework/com.apple.Virtualization.VirtualMachine", pid: 100 },
  ],
  compressorText: [
    "vm.compressor.segment.total: 182761",
    "vm.compressor.segment.limit: 1234946",
    "vm.compressor_segment_pages_compressed: 738386",
    "vm.compressor_segment_pages_compressed_limit: 19759136",
    "",
  ].join("\n"),
  cores: 15,
  processes: [
    {
      argv: "/System/Library/Frameworks/Virtualization.framework/com.apple.Virtualization.VirtualMachine",
      pid: 100,
      ppid: 1,
    },
  ],
  sessions: [],
  swapText: "vm.swapusage: total = 4096.00M  used = 6348.80M  free = -2252.80M  (encrypted)",
  swapfileCount: 3,
  topText: "Load Avg: 8.38, 8.76, 10.23 \nPID    MEM  \n100    6144M\n",
});

/** A machine-only ceilings reading with one plan read that failed, so `problems` is not empty. */
const CEILINGS = buildCeilingsReading({
  machine: { hold: false, holdSubjects: [], idlePct: null, load1: 8.38, loadHold: 45 },
  observedAtIso: NOW,
  plans: {
    claude: [],
    claudeThresholds: DEFAULT_THRESHOLDS.claude,
    codex: [],
    codexRoutedAlias: null,
    problems: ["codex fleet: app-server did not answer"],
  },
});

/** Two covering investigations, one listed and one counted past the list. */
const DISPATCH: DispatchBlock = {
  backoffSeconds: 120,
  covering: 2,
  investigations: [
    {
      id: "anomaly-1",
      observedIso: NOW,
      slug: "anomalous-load-1",
      subject: { label: "node", why: "3 cores sustained" },
      triggers: ["cpu"],
    },
  ],
  investigationsOmitted: 1,
  open: 3,
  subject: "node",
};

const HELD_BACKOFF = {
  consecutiveHolds: 3,
  holdSubjects: ["cpu"],
  phase: "held",
  untilIso: "2026-10-26T08:10:00.000Z",
} as const;

describe("briefCapacityJson", () => {
  const brief = briefCapacityJson({
    ceilings: CEILINGS,
    dispatch: DISPATCH,
    report: REPORT,
    spawnBackoff: { phase: "clear" },
  });

  it("carries exactly the fields step 8 reads, and no process table, ceiling window or investigation list", () => {
    expect(Object.keys(brief).toSorted()).toStrictEqual([
      "alert",
      "ceilings",
      "culprit",
      "diskFreeGb",
      "diskHoldFreeGb",
      "dispatch",
      "hold",
      "holdSubjects",
      "load",
      "segmentsPct",
      "spawnBackoff",
      "swapUsedGb",
      "swapfileCount",
      "topForeign",
      "verdict",
    ]);
  });

  it("takes every gauge from the same report the full document renders", () => {
    const full = machineCapacityJson({ ceilings: CEILINGS, dispatch: DISPATCH, report: REPORT });
    expect(brief.hold).toBe(full.hold);
    expect(brief.holdSubjects).toStrictEqual(full.holdSubjects);
    expect(brief.verdict).toBe(full.verdict);
    expect(brief.segmentsPct).toBe(15);
    expect(brief.swapfileCount).toBe(3);
    expect(brief.swapUsedGb).toBe(6.2);
    expect(brief.load).toStrictEqual({ load1: 8.38, load15: 10.23, load5: 8.76 });
    expect(brief.diskHoldFreeGb).toBe(full.diskHoldFreeGb);
  });

  it("names the top foreign hog by label and size only", () => {
    expect(brief.topForeign).toStrictEqual({ footprintGb: 6, label: "com.apple.Virtualization.VirtualMachine" });
  });

  it("keeps the dispatch standing and its omission count, and drops only the investigation list", () => {
    expect(brief.dispatch).toStrictEqual({
      backoffSeconds: 120,
      covering: 2,
      investigationsOmitted: 1,
      open: 3,
      subject: "node",
    });
  });

  it("reduces the ceilings to the lowest, the route, the problems and the briefing's one clause", () => {
    expect(brief.ceilings).toStrictEqual({
      lowest: CEILINGS.lowest,
      problems: ["codex fleet: app-server did not answer"],
      selectedRoute: null,
      unusedNow: "unused now: machine 81% (load1 8.38/45); lowest machine",
    });
  });
});

describe("renderBriefMachineCapacityLines", () => {
  it("prints the clause and the verdict while the spawn backoff is open", () => {
    expect(
      renderBriefMachineCapacityLines({ ceilings: CEILINGS, report: REPORT, spawnBackoff: { phase: "clear" } }),
    ).toStrictEqual(["unused now: machine 81% (load1 8.38/45); lowest machine", REPORT.verdict]);
  });

  it("puts the backoff line between them while the backoff is closing the door", () => {
    expect(
      renderBriefMachineCapacityLines({ ceilings: CEILINGS, report: REPORT, spawnBackoff: HELD_BACKOFF }),
    ).toStrictEqual([
      "unused now: machine 81% (load1 8.38/45); lowest machine",
      "spawn backoff: HELD on cpu — held reading 3 in a row, no spawn reads the gauge before 2026-10-26T08:10:00.000Z",
      REPORT.verdict,
    ]);
  });
});
