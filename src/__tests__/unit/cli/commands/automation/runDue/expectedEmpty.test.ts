/**
 * `slopweaver automation run-due` over a verb that exits EXPECTED-EMPTY: the tick stays clean and the row is
 * stamped, exactly as the slot settlement already treats it.
 */
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { EXIT_EXPECTED_EMPTY } from "../../../../../../cli/exitCodes.js";
import { unwrap } from "../../../../../../lib/result.js";
import { readRecipeDefinitionRuns } from "../../../../../../live/automation/definitionRunStore.js";
import { runDueUnderFake } from "../../../../../runDueSignalFake.js";
import { argvFor, row } from "./fixtures.js";
import { deps, homeWith, removeHomes } from "./harness.js";

afterEach(() => {
  removeHomes();
});

describe("recipe run-due over an EXPECTED-EMPTY verb", () => {
  // MEASURED: `resync-corpus-fathom` ran `refresh --source fathom --store`, the fetch walked one
  // page and deduped its one transcript, and the verb exited 3 — its own designed signal for a quiet
  // window. `settleSlot` retired the firing as succeeded; the row outcome graded the same 3 as FAILED, so
  // the tick exited 1 and reported a hard failure over a store that matched bronze exactly.
  it("keeps the tick clean and stamps the row, exactly as the slot settlement already does", async () => {
    const home = homeWith({ rows: [row()] });
    const injected = deps({ exitCode: EXIT_EXPECTED_EMPTY });

    const code = await runDueUnderFake({ argv: argvFor({ home }), deps: injected });

    expect(code).toBe(0);
    expect(injected.out).toContain(
      "recipe atlas-rolling-window · ran · slopweaver atlas freshness --behind-only · exit 3 (nothing to do)",
    );
    const runs = unwrap(readRecipeDefinitionRuns({ path: join(home, "live", "recipe", "definition-runs.json") }));
    // Stamped, so the row is not due again — and NOT marked delivered: `firstSucceededIso` is the first exit 0,
    // the instant a card row first posted, and a run that found nothing to post has not (`firstFiring.ts`).
    expect(runs["atlas-rolling-window"]).toEqual({
      exitCode: EXIT_EXPECTED_EMPTY,
      lastRunAtIso: "2026-09-08T12:05:00.000Z",
      watermarkIso: "2026-09-08T12:00:00.000Z",
    });
  });
});
