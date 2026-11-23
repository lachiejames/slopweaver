/*
 * `codex gauge` and `codex signin` — the parse phase.
 *
 * The runners themselves read `$CODEX_HOME`, so what is exercised here is the half that is provably
 * separable from that read: a `--help` or an unknown flag must answer WITHOUT touching the filesystem, which
 * is exactly what `parseRejectIsIoFree` claims in the manifest. Each verb is pointed at a Codex home that
 * does not exist, so any read it did attempt would resolve to "nothing found" rather than to the operator's
 * real log — and the module is imported, which is what `manifest-loader-tests` asks of a dispatchable
 * command module.
 *
 * `codex route` left these tests because it stopped being a single-home verb: its reading moved from
 * `loadBalance.ts` to the fleet-wide `fleetRead`/`rank`/`fleetAssessment` chain, and its own parse-phase and
 * usage-line cases now sit in `routeRun/parsePhase.test.ts` beside the two REAL temp homes that lane needs.
 */
import { describe, expect, it } from "vitest";
import { GAUGE_USAGE, runCodexSignin, SIGNIN_USAGE } from "../../../../cli/commands/codex/gaugeRun.js";
import { EXIT_OK, EXIT_USAGE } from "../../../../cli/exitCodes.js";
import { runGauge } from "../defaultThresholds.js";
import { emptyCodexHome, useGaugeRunHomes } from "./harness.js";

useGaugeRunHomes();

describe("the two single-home verbs' parse phase", () => {
  it("answers --help with usage and exit 0 for every one of them", async () => {
    expect(await runGauge({ home: emptyCodexHome(), tail: ["--help"] })).toBe(EXIT_OK);
    expect(runCodexSignin(["node", "slopweaver", "codex", "signin", "--help"])).toBe(EXIT_OK);
  });

  it("refuses an unknown flag with EXIT_USAGE rather than ignoring it", async () => {
    expect(await runGauge({ home: emptyCodexHome(), tail: ["--plan"] })).toBe(EXIT_USAGE);
    expect(runCodexSignin(["node", "slopweaver", "codex", "signin", "--enroll"])).toBe(EXIT_USAGE);
  });

  it("runs against an empty Codex home and reports nothing found, rather than failing", async () => {
    process.env["CODEX_HOME"] = emptyCodexHome();

    expect(await runGauge({ home: emptyCodexHome(), tail: [] })).toBe(EXIT_OK);
    expect(runCodexSignin(["node", "slopweaver", "codex", "signin", "--status"])).toBe(EXIT_OK);
  });

  it("keeps each verb's usage line naming its own verb", () => {
    expect(GAUGE_USAGE).toContain("codex gauge");
    expect(SIGNIN_USAGE).toContain("codex signin");
  });
});
