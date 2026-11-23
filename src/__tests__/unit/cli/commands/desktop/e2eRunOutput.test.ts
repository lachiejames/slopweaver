import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { proofDirOf, writeRunFiles } from "../../../../../cli/commands/desktop/e2eRunOutput.js";
import { e2eReport } from "../../../../../desktop/e2eReport.js";

describe("proofDirOf", () => {
  it("takes --out as named, and otherwise a folder named for the run's start under the home's proof", () => {
    expect([
      proofDirOf({ home: "/h", out: "/elsewhere", startedIso: "2026-11-20T08:00:00.123Z" }),
      proofDirOf({ home: "/h", out: undefined, startedIso: "2026-11-20T08:00:00.123Z" }),
    ]).toEqual(["/elsewhere", join("/h", "proof", "desktop-e2e", "2026-11-20T080000Z")]);
  });
});

describe("writeRunFiles", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  it("writes the report alone when no card was judged and no microphone comparison was asked for", () => {
    const out = mkdtempSync(join(tmpdir(), "e2e-out-"));
    dirs.push(out);
    const report = e2eReport({
      app: "/A.app",
      checkout: "/c",
      fatal: undefined,
      out,
      startedIso: "2026-11-20T08:00:00.000Z",
      steps: [],
    });
    writeRunFiles({ calls: [], out, report, steps: [], trials: [] });
    expect([readdirSync(out), existsSync(join(out, "card-fidelity.json"))]).toEqual([["report.json"], false]);
  });
});
