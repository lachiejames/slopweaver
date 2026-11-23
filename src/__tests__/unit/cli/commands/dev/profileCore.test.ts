import { describe, expect, it } from "vitest";
import {
  DEV_PROFILE_FLAG_NAMES,
  DEV_PROFILE_USAGE,
  failedSubjectLine,
  type ProfileRun,
  parseDevProfileArgs,
  renderProfile,
  splitAtDoubleDash,
} from "../../../../../cli/commands/dev/profileCore.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";
import { comparePerf, type PerfBaseline } from "../../../../../perf/baseline.js";

const PLAN = { args: ["src/devLint/x.entry.ts"], cmd: "/bin/tsx", label: "gate:x" };

const RUN: ProfileRun = {
  allocation: [],
  cpu: [],
  exitCode: 0,
  peakHeapMib: 3830,
  phases: [
    { label: "createProgram", liveMib: 2314, subject: "x" },
    { label: "rule scan", liveMib: 3830, subject: "x" },
  ],
  plan: PLAN,
  skippedDocuments: 0,
  wallMs: 40_000,
};

const NO_BASELINE: PerfBaseline = { subjects: [] };

describe("splitAtDoubleDash", () => {
  it("keeps the whole tail as flags when there is no separator", () => {
    expect(splitAtDoubleDash({ rest: ["--gate", "x", "--cpu"] })).toEqual({
      head: ["--gate", "x", "--cpu"],
      tail: [],
    });
  });

  it("hands everything after the separator to the profiled verb, flags included", () => {
    expect(splitAtDoubleDash({ rest: ["--verb", "--cpu", "--", "catalog", "--json"] })).toEqual({
      head: ["--verb", "--cpu"],
      tail: ["catalog", "--json"],
    });
  });

  it("splits at the FIRST separator, so a verb's own `--` survives into its argv", () => {
    expect(splitAtDoubleDash({ rest: ["--verb", "--", "a", "--", "b"] })).toEqual({
      head: ["--verb"],
      tail: ["a", "--", "b"],
    });
  });

  it("yields an empty verb argv for a trailing separator", () => {
    expect(splitAtDoubleDash({ rest: ["--verb", "--"] })).toEqual({ head: ["--verb"], tail: [] });
  });
});

describe("parseDevProfileArgs", () => {
  it("accepts every flag the usage names", () => {
    const parsed = unwrap(
      parseDevProfileArgs({
        rest: ["--gate", "x", "--cpu", "--heap-prof", "--record", "--check", "--json", "--top", "5"],
      }),
    );
    expect(parsed.values).toEqual({
      check: true,
      cpu: true,
      gate: "x",
      "heap-prof": true,
      json: true,
      record: true,
      top: "5",
    });
  });

  it("names an unknown flag rather than ignoring it", () => {
    expect(unwrapErr(parseDevProfileArgs({ rest: ["--nope"] }))).toEqual(["unknown flag: --nope"]);
  });

  it("declares every flag to the help-truth ratchet", () => {
    expect(DEV_PROFILE_FLAG_NAMES).toEqual([
      "--check",
      "--cpu",
      "--gate",
      "--heap-prof",
      "--interval",
      "--json",
      "--lane",
      "--record",
      "--top",
      "--verb",
    ]);
  });

  it("names peak RSS as deliberately absent, so a reader does not go looking for it", () => {
    expect(DEV_PROFILE_USAGE).toContain("Peak RSS is deliberately not reported");
  });
});

describe("renderProfile", () => {
  it("prints the command, the exit, the wall clock and every phase", () => {
    const lines = renderProfile({
      comparison: comparePerf({ baseline: NO_BASELINE, label: "gate:x", peakHeapMib: 3830, wallMs: 40_000 }),
      run: RUN,
      top: 10,
    });
    expect(lines[0]).toBe("dev profile gate:x");
    expect(lines[1]).toBe("  command  /bin/tsx src/devLint/x.entry.ts");
    expect(lines[2]).toBe("  exit     0");
    expect(lines[3]).toBe("  wall     40.0s");
    expect(lines[4]).toBe("  heap     peak 3830 MiB");
    expect(lines.at(-1)).toBe("  baseline not recorded for this subject — `--record` writes one");
  });

  it("says so plainly when a subject carries no phase instrument", () => {
    const lines = renderProfile({
      comparison: comparePerf({ baseline: NO_BASELINE, label: "gate:x", peakHeapMib: undefined, wallMs: 1000 }),
      run: { ...RUN, peakHeapMib: undefined, phases: [] },
      top: 10,
    });
    expect(lines).toContain("  heap     no phase marks — this subject carries no SLOPWEAVER_HEAP_PHASES instrument");
  });

  it("reports idle as its own number and re-shares the modules over the busy time", () => {
    const lines = renderProfile({
      comparison: comparePerf({ baseline: NO_BASELINE, label: "gate:x", peakHeapMib: 3830, wallMs: 40_000 }),
      run: {
        ...RUN,
        cpu: [
          { module: "(idle)", share: 0.5, value: 1_000_000 },
          { module: "node_modules/typescript", share: 0.4, value: 800_000 },
          { module: "src/devLint", share: 0.1, value: 200_000 },
        ],
      },
      top: 10,
    });
    expect(lines).toContain("  cpu by module (self time; 50.0% of samples were idle — waiting, not computing)");
    expect(lines).toContain("     80.0%  node_modules/typescript              0.8s");
  });

  it("caps each table at --top", () => {
    const lines = renderProfile({
      comparison: comparePerf({ baseline: NO_BASELINE, label: "gate:x", peakHeapMib: 3830, wallMs: 40_000 }),
      run: {
        ...RUN,
        cpu: [
          { module: "a", share: 0.5, value: 500_000 },
          { module: "b", share: 0.3, value: 300_000 },
          { module: "c", share: 0.2, value: 200_000 },
        ],
      },
      top: 1,
    });
    expect(lines.filter((line) => line.startsWith("    "))).toEqual([
      "    phase  createProgram                        2314 MiB",
      "    phase  rule scan                            3830 MiB",
      "     50.0%  a                                    0.5s",
    ]);
  });

  it("calls a heap regression out by name, with the band it broke", () => {
    const baseline: PerfBaseline = {
      subjects: [
        {
          label: "gate:x",
          peakHeapMib: 3000,
          phases: [],
          recordedAt: "2026-09-20",
          topModules: [],
          wallMs: 40_000,
        },
      ],
    };
    const lines = renderProfile({
      comparison: comparePerf({ baseline, label: "gate:x", peakHeapMib: 3500, wallMs: 40_000 }),
      run: RUN,
      top: 10,
    });
    expect(lines).toContain("  REGRESSED heap 3500 MiB is past the 3060 MiB the band allows");
  });
});

describe("renderProfile over an incomplete fold", () => {
  const PARTIAL: ProfileRun = {
    ...RUN,
    cpu: [
      { module: "(idle)", share: 0.5, value: 500_000 },
      { module: "node_modules/typescript", share: 0.5, value: 500_000 },
    ],
    skippedDocuments: 2,
  };

  it("says the cpu table is partial and how many documents went missing", () => {
    const lines = renderProfile({
      comparison: comparePerf({ baseline: NO_BASELINE, label: "gate:x", peakHeapMib: 3830, wallMs: 40_000 }),
      run: PARTIAL,
      top: 10,
    });

    expect(lines.find((line) => line.includes("cpu by module"))).toBe(
      "  cpu by module (self time; 50.0% of samples were idle — waiting, not computing) — PARTIAL: 2 documents too large to read, so these shares are of what was read, not of the run",
    );
  });

  it("says one document in the singular, because a count that reads wrong is a number nobody trusts", () => {
    const lines = renderProfile({
      comparison: comparePerf({ baseline: NO_BASELINE, label: "gate:x", peakHeapMib: 3830, wallMs: 40_000 }),
      run: { ...PARTIAL, skippedDocuments: 1 },
      top: 10,
    });

    expect(lines.find((line) => line.includes("cpu by module"))!).toContain("PARTIAL: 1 document too large");
  });

  it("marks the allocation table too, since the same documents feed it", () => {
    const lines = renderProfile({
      comparison: comparePerf({ baseline: NO_BASELINE, label: "gate:x", peakHeapMib: 3830, wallMs: 40_000 }),
      run: { ...PARTIAL, allocation: [{ module: "src/devLint", share: 1, value: 4_194_304 }] },
      top: 10,
    });

    expect(lines.find((line) => line.startsWith("  allocation by module"))!).toContain("PARTIAL: 2 documents");
  });

  it("says nothing at all when every document was read", () => {
    const lines = renderProfile({
      comparison: comparePerf({ baseline: NO_BASELINE, label: "gate:x", peakHeapMib: 3830, wallMs: 40_000 }),
      run: { ...PARTIAL, skippedDocuments: 0 },
      top: 10,
    });

    expect(lines.find((line) => line.includes("cpu by module"))).toBe(
      "  cpu by module (self time; 50.0% of samples were idle — waiting, not computing)",
    );
  });
});

describe("failedSubjectLine", () => {
  it("passes a run whose subject exited 0", () => {
    expect(failedSubjectLine({ run: RUN })).toBe(undefined);
  });

  it("names a run whose subject exited non-zero as a failure, never its cost", () => {
    expect(failedSubjectLine({ run: { ...RUN, exitCode: 1 } })).toBe(
      "dev profile: gate:x exited 1, so this measured a failure rather than the subject's work — not recorded; " +
        "fix what it printed and re-run",
    );
  });
});
