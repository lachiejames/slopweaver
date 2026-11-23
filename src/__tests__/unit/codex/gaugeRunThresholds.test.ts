/**
 * `codex gauge` over a plan register that names its own Codex thresholds, and over one that cannot be read.
 *
 * The verb prints on the process-wide logger, so what is asserted here is the exit code and the thresholds the
 * register hands the verb; the human line the thresholds produce is asserted through the renderer the verb calls.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { runCodexGaugeWith } from "../../../cli/commands/codex/gaugeRun.js";
import { EXIT_ERROR, EXIT_OK } from "../../../cli/exitCodes.js";
import { parseGaugeLine } from "../../../codex/gauge.js";
import { renderCodexGauge } from "../../../codex/gaugeRender.js";
import { unwrap } from "../../../lib/result.js";
import { DEFAULT_THRESHOLDS } from "../../../plans/thresholds.js";
import { REAL_HEALTHY_WEEKLY_LINE } from "../../codexRolloutLines.js";
import { memoryPlanRegisterPort, unavailablePlanRegisterPort } from "../../planRegisterFixture.js";

const dirs: string[] = [];

/** A throwaway directory this file removes after each test. */
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "codex-gauge-thresholds-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  delete process.env["CODEX_HOME"];
  dirs.splice(0).forEach((dir) => {
    rmSync(dir, { force: true, recursive: true });
  });
});

/** A Slopweaver home whose legacy `plans.json` names non-default Codex thresholds. */
function homeWithCodexThresholds(): string {
  const home = tempDir();
  writeFileSync(
    join(home, "plans.json"),
    JSON.stringify({
      rows: [{ alias: "codex-one", provider: "codex", storeDir: join(home, "codex-one") }],
      thresholds: { codex: { alertAtPercent: 60, pauseAtPercent: 90 } },
      version: 1,
    }),
    "utf8",
  );
  return home;
}

describe("codex gauge reads its bars from the plan register", () => {
  it("hands the verb the register's own non-default Codex thresholds, and exits 0", async () => {
    const home = homeWithCodexThresholds();
    process.env["CODEX_HOME"] = tempDir();
    const port = memoryPlanRegisterPort();

    const snapshot = unwrap(await port.read({ home }));
    const code = await runCodexGaugeWith({
      argv: ["node", "slopweaver", "codex", "gauge", "--json"],
      deps: { home, port },
    });

    expect(snapshot.thresholds.codex).toEqual({ alertAtPercent: 60, pauseAtPercent: 90 });
    expect(code).toBe(EXIT_OK);
  });

  it("prints the register's bars in the human line, not the defaults", () => {
    const gauge = parseGaugeLine({ line: REAL_HEALTHY_WEEKLY_LINE });
    const lines = renderCodexGauge({
      gauge,
      nowIso: "2026-09-13T12:00:00.000Z",
      thresholds: { alertAtPercent: 60, pauseAtPercent: 90 },
    });
    const defaults = renderCodexGauge({
      gauge,
      nowIso: "2026-09-13T12:00:00.000Z",
      thresholds: DEFAULT_THRESHOLDS.codex,
    });

    expect(lines).toContain("  react-now threshold: 60% of a window; paused for new work at 90%");
    expect(defaults).toContain("  react-now threshold: 75% of a window; paused for new work at 99%");
  });

  it("exits EXIT_ERROR when the plan register cannot be read, rather than falling back to defaults", async () => {
    process.env["CODEX_HOME"] = tempDir();

    const code = await runCodexGaugeWith({
      argv: ["node", "slopweaver", "codex", "gauge"],
      deps: { home: tempDir(), port: unavailablePlanRegisterPort() },
    });

    expect(code).toBe(EXIT_ERROR);
  });
});
