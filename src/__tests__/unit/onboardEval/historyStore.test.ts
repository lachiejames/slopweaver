import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { unwrap } from "../../../lib/result.js";
import type { FrictionReport } from "../../../onboardEval/frictionReport.js";
import {
  appendReportEntry,
  evalHandoversDir,
  mostRecentReport,
  readReportHistory,
  reportHistoryPath,
  writeFindingDoc,
} from "../../../onboardEval/historyStore.js";

function report({ runId }: { runId: string }): FrictionReport {
  return { findings: [], runId, totalDurationSeconds: 1, totalSteps: 1, unprovenSteps: [] };
}

const tempDirs: string[] = [];
function tempEvalHome(): string {
  const dir = mkdtempSync(join(tmpdir(), "onboard-eval-test-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

describe("readReportHistory", () => {
  it("is empty for a home with no history file yet", () => {
    const history = unwrap(readReportHistory({ evalHome: tempEvalHome() }));
    expect(history).toEqual([]);
  });

  it("round-trips an appended entry", () => {
    const evalHome = tempEvalHome();
    const entry = { recordedAt: "2026-08-29T00:00:00Z", report: report({ runId: "r1" }) };
    unwrap(appendReportEntry({ entry, evalHome }));
    const history = unwrap(readReportHistory({ evalHome }));
    expect(history).toEqual([entry]);
  });

  it("keeps appended entries in order, oldest first", () => {
    const evalHome = tempEvalHome();
    unwrap(appendReportEntry({ entry: { recordedAt: "t1", report: report({ runId: "r1" }) }, evalHome }));
    unwrap(appendReportEntry({ entry: { recordedAt: "t2", report: report({ runId: "r2" }) }, evalHome }));
    const history = unwrap(readReportHistory({ evalHome }));
    expect(history.map((entry) => entry.report.runId)).toEqual(["r1", "r2"]);
  });
});

describe("mostRecentReport", () => {
  it("is undefined for an empty history", () => {
    expect(mostRecentReport({ history: [] })).toBeUndefined();
  });

  it("is the last entry's report", () => {
    const history = [
      { recordedAt: "t1", report: report({ runId: "r1" }) },
      { recordedAt: "t2", report: report({ runId: "r2" }) },
    ];
    expect(mostRecentReport({ history })?.runId).toBe("r2");
  });
});

describe("writeFindingDoc", () => {
  it("writes the markdown under <evalHome>/handovers/<slug>.md", () => {
    const evalHome = tempEvalHome();
    const written = unwrap(writeFindingDoc({ evalHome, markdown: "---\nslug: x\n---\nbody\n", slug: "x" }));
    expect(written).toBe(join(evalHandoversDir({ evalHome }), "x.md"));
    expect(readFileSync(written, "utf8")).toBe("---\nslug: x\n---\nbody\n");
  });
});

describe("reportHistoryPath", () => {
  it("lives under <evalHome>/onboard-eval/reports.jsonl", () => {
    expect(reportHistoryPath({ evalHome: "/home" })).toBe(join("/home", "onboard-eval", "reports.jsonl"));
  });
});
