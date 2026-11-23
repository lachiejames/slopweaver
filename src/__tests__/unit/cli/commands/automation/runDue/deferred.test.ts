/**
 * `slopweaver automation run-due` over a verb that exits DEFERRED: nothing is stamped, so the row stays due and the
 * next tick takes it, and the deferral is reported as such rather than as a failure.
 */
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { EXIT_DEFERRED } from "../../../../../../cli/exitCodes.js";
import { unwrap } from "../../../../../../lib/result.js";
import { readRecipeDefinitionRuns } from "../../../../../../live/automation/definitionRunStore.js";
import { runDueUnderFake } from "../../../../../runDueSignalFake.js";
import { argvFor, row } from "./fixtures.js";
import { deps, homeWith, removeHomes } from "./harness.js";

afterEach(() => {
  removeHomes();
});

describe("recipe run-due over a DEFERRED verb", () => {
  it("stamps nothing, so the row is still due and the next tick takes it", async () => {
    const home = homeWith({ rows: [row()] });
    const injected = deps({ exitCode: EXIT_DEFERRED });

    const code = await runDueUnderFake({ argv: argvFor({ home }), deps: injected });

    expect(code).toBe(0);
    const runs = unwrap(readRecipeDefinitionRuns({ path: join(home, "live", "recipe", "definition-runs.json") }));
    expect(runs).toEqual({});
  });

  it("really does run again on the next tick, which is the whole property", async () => {
    const home = homeWith({ rows: [row()] });
    await runDueUnderFake({ argv: argvFor({ home }), deps: deps({ exitCode: EXIT_DEFERRED }) });

    const second = deps({ exitCode: EXIT_DEFERRED });
    await runDueUnderFake({ argv: argvFor({ home }), deps: second });

    expect(second.dispatched).toEqual([["node", "slopweaver", "atlas", "freshness", "--behind-only"]]);
  });

  it("stamps the row once the deferral clears, so it stops being due", async () => {
    const home = homeWith({ rows: [row()] });
    await runDueUnderFake({ argv: argvFor({ home }), deps: deps({ exitCode: EXIT_DEFERRED }) });

    await runDueUnderFake({ argv: argvFor({ home }), deps: deps({ exitCode: 0 }) });

    const runs = unwrap(readRecipeDefinitionRuns({ path: join(home, "live", "recipe", "definition-runs.json") }));
    expect(runs["atlas-rolling-window"]).toEqual({
      exitCode: 0,
      firstSucceededIso: "2026-09-08T12:05:00.000Z",
      lastRunAtIso: "2026-09-08T12:05:00.000Z",
      watermarkIso: "2026-09-08T12:00:00.000Z",
    });
  });

  it("reports the deferral as DEFERRED rather than as a failure, and keeps the tick clean", async () => {
    const home = homeWith({ rows: [row()] });
    const injected = deps({ exitCode: EXIT_DEFERRED });

    const code = await runDueUnderFake({ argv: argvFor({ home }), deps: injected });

    expect(code).toBe(0);
    expect(injected.out).toContain(
      "recipe atlas-rolling-window · DEFERRED · slopweaver atlas freshness --behind-only · not stamped, still due",
    );
  });
});
