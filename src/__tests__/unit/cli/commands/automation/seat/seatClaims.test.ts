/**
 * `claimPlannedRows` and `releaseSeatedRows`, the slot-ledger half of a seat: a row a failure held after the plan
 * is passed over, and an unheld row's claim is given back when no session opens for it.
 */
import { afterEach, describe, expect, it } from "vitest";

import { claimPlannedRows, releaseSeatedRows } from "../../../../../../cli/commands/automation/seatClaims.js";
import { unwrap } from "../../../../../../lib/result.js";
import { reportRow, resyncRow } from "./fixtures.js";
import { holdOnDisk, homeWith, removeHomes, seatDeps } from "./harness.js";

afterEach(() => {
  removeHomes();
});

describe("claimPlannedRows and releaseSeatedRows — the ledger half of a seat", () => {
  const PLAN = { rows: [reportRow()], skipped: [], slug: "automations-seat-claims" };

  it("passes over a row a failure held after the plan was judged, claiming nothing and aborting nothing", async () => {
    const home = homeWith({ rows: [resyncRow()] });
    holdOnDisk({ home, recipeId: "resync-atlas-trelica" });
    const deps = seatDeps();

    const claimed = await claimPlannedRows({ deps, home, plan: PLAN });

    expect(unwrap(claimed)).toEqual([]);
    expect(deps.out).toHaveLength(1);
    expect(deps.out[0]).toContain("recipe resync-atlas-trelica · HELD since this seat was planned, so not seated");
  });

  it("claims an unheld row, and gives the claim back when no session opens for it", async () => {
    const home = homeWith({ rows: [resyncRow()] });
    const deps = seatDeps();

    const taken = unwrap(await claimPlannedRows({ deps, home, plan: PLAN }));
    releaseSeatedRows({ deps, home, taken });

    expect(taken.map((row) => row.recipeId)).toEqual(["resync-atlas-trelica"]);
    expect(deps.out).toEqual(["recipe resync-atlas-trelica · claim released — no session was opened for it"]);
    expect(deps.diag).toEqual([]);
  });
});
