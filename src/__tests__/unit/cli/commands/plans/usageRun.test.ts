/**
 * `plans usage`'s shell over plain injected seams — what it prints, which home it reads, and which exit each outcome
 * carries.
 */
import { describe, expect, it } from "vitest";

import { type PlansUsageDeps, runPlansUsage } from "../../../../../cli/commands/plans/usageRun.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import { err, ok, type Result } from "../../../../../lib/result.js";
import type { PlanUsageReport } from "../../../../../plans/planUsageTypes.js";

const NOW = "2026-11-06T12:00:00.000Z";

const REPORT: PlanUsageReport = {
  observedAtIso: NOW,
  rows: [
    {
      alias: "codex-one",
      allowance: "weekly-window",
      email: "owner@example.com",
      modelHost: "codex",
      signIn: { kind: "ok", observedAtIso: NOW, source: "codex-live-read" },
      usage: {
        kind: "weekly",
        windows: [
          {
            kind: "measured",
            label: "week",
            observedAtIso: "2026-11-06T11:00:00.000Z",
            resetAtIso: "2026-11-09T00:00:00.000Z",
            source: "codex-rollout-log",
            usedPercent: 55,
          },
        ],
      },
      usageLimitPercent: 100,
    },
  ],
};

/** Seams recording every write and every read request. */
function harness({ read }: { read: Result<PlanUsageReport> }): {
  deps: PlansUsageDeps;
  out: string[];
  diagnostics: string[];
  homes: (string | undefined)[];
} {
  const out: string[] = [];
  const diagnostics: string[] = [];
  const homes: (string | undefined)[] = [];
  const deps: PlansUsageDeps = {
    readReport: ({ home }) => {
      homes.push(home);
      return Promise.resolve(read);
    },
    writeDiagnostic: (line) => {
      diagnostics.push(line);
    },
    writeOut: (line) => {
      out.push(line);
    },
  };
  return { deps, diagnostics, homes, out };
}

describe("runPlansUsage", () => {
  it("writes the report as one JSON document under --json", async () => {
    const run = harness({ read: ok(REPORT) });

    const code = await runPlansUsage({ deps: run.deps, rest: ["--json"] });

    expect(code).toBe(EXIT_OK);
    expect(run.out).toEqual([JSON.stringify(REPORT)]);
    expect(run.diagnostics).toEqual([]);
  });

  it("prints a heading and one line per plan without --json", async () => {
    const run = harness({ read: ok(REPORT) });

    const code = await runPlansUsage({ deps: run.deps, rest: [] });

    expect(code).toBe(EXIT_OK);
    expect(run.out).toEqual([
      `plans usage at ${NOW} — recorded readings only, no model host asked`,
      "codex-one    Codex · owner@example.com · week 55% (resets 2026-11-09T00:00:00.000Z; rollout log " +
        "2026-11-06T11:00:00.000Z) · signed in (codex-live-read 2026-11-06T12:00:00.000Z)",
    ]);
  });

  it("reads the home --home names, and the ambient one when none is named", async () => {
    const run = harness({ read: ok(REPORT) });

    await runPlansUsage({ deps: run.deps, rest: ["--home", "/elsewhere"] });
    await runPlansUsage({ deps: run.deps, rest: [] });

    expect(run.homes).toEqual(["/elsewhere", undefined]);
  });

  it("refuses an unknown flag before reading anything", async () => {
    const run = harness({ read: ok(REPORT) });

    const code = await runPlansUsage({ deps: run.deps, rest: ["--provider", "codex"] });

    expect(code).toBe(EXIT_USAGE);
    expect(run.homes).toEqual([]);
    expect(run.diagnostics.at(-1)).toContain("plans usage");
  });

  it("exits 1 naming the failure when the register cannot be read", async () => {
    const run = harness({ read: err(["REGISTER_STORE_UNAVAILABLE"]) });

    const code = await runPlansUsage({ deps: run.deps, rest: ["--json"] });

    expect(code).toBe(EXIT_ERROR);
    expect(run.out).toEqual([]);
    expect(run.diagnostics).toEqual(["plans usage: REGISTER_STORE_UNAVAILABLE"]);
  });

  it("exits 3 on an install with nothing registered, which is the verb working", async () => {
    const run = harness({ read: ok({ observedAtIso: NOW, rows: [] }) });

    const code = await runPlansUsage({ deps: run.deps, rest: [] });

    expect(code).toBe(EXIT_EXPECTED_EMPTY);
    expect(run.out).toEqual(["plans usage: no destination is registered"]);
  });
});
