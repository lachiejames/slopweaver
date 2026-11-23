/**
 * `slopweaver automation run-due` over a `fleet-ceiling-report` row whose measurement broke — the seam the direct
 * runner test cannot prove: that the broken reading's exit code reaches the failure hold, so ONE repo-backed
 * `recipe-failing-*` finding is filed, the row is held on it, and a second tick files nothing more.
 *
 * A broken measurement is repaired automatically, never put to the owner as a question.
 * MEASURED: an evening firing whose span ended on a plan's own reset minted a "repair it now?" card.
 */
import { afterEach, describe, expect, it } from "vitest";

import type { FleetCeilingReport } from "../../../../../../capacity/seatCeiling.js";
import { ok, unwrap } from "../../../../../../lib/result.js";
import { RECIPE_DEFINITION_SCHEMA_VERSION } from "../../../../../../live/automation/definition.js";
import { failureFindingSlug } from "../../../../../../live/automation/failureHold.js";
import type { FleetCeilingDelivery } from "../../../../../../live/automation/fleetCeilingReport.js";
import { readSlotAttempt } from "../../../../../../live/automation/slotLedger.js";
import { measuredFleetCeilingReport } from "../../../../../fleetCeilingReportFixture.js";
import { runDueUnderFake } from "../../../../../runDueSignalFake.js";
import { argvFor } from "./fixtures.js";
import { deps, homeWith, removeHomes } from "./harness.js";

afterEach(() => {
  removeHomes();
});

/** The firing the harness clock makes due for an hourly row. */
const SLOT = "2026-09-08T12:00:00.000Z";

/** An hourly `fleet-ceiling-report` row, as its definition file holds it. */
const CEILING_ROW = {
  cadence: "0 * * * *",
  destination: { kind: "local-page" },
  effect: "read-write",
  enabled: true,
  kind: "fleet-ceiling-report",
  onMissed: "skip",
  params: { days: 7 },
  recipeId: "fleet-ceiling-weekly",
  schemaVersion: RECIPE_DEFINITION_SCHEMA_VERSION,
} as const;

/** A measurement whose ceiling could not be read, with the plans the limit so no headroom card is earned. */
function brokenReport(): FleetCeilingReport {
  return measuredFleetCeilingReport({
    ceiling: { kind: "unmeasurable", reason: "plan-three has no seven-day sample whose reset is still ahead" },
    seats: { ...measuredFleetCeilingReport().seats, meanWorkingSeats: 5.6 },
  });
}

/** The harness edges over a broken reading, with a delivery that publishes and records what it was handed. */
function brokenDeps(): ReturnType<typeof deps> & { readonly deliveries: FleetCeilingDelivery[] } {
  const deliveries: FleetCeilingDelivery[] = [];
  return {
    ...deps({ ceilingReport: ok(brokenReport()) }),
    deliverFleetCeiling: ({ delivery }) => {
      deliveries.push(delivery);
      return Promise.resolve(
        ok({ card: "none", pageUrl: `file:///p/${delivery.slug}/index.html`, previous: { kind: "none" } }),
      );
    },
    deliveries,
    readFleetWhy: () => ({ kind: "read", sentences: [] }),
  };
}

describe("recipe run-due — a broken fleet-ceiling measurement", () => {
  it("publishes the page with no card, fails the firing, files ONE repo-backed finding, and holds the row on it", async () => {
    const home = homeWith({ rows: [CEILING_ROW] });
    const first = brokenDeps();

    const code = await runDueUnderFake({ argv: argvFor({ home }), deps: first });

    expect(code).toBe(1);
    expect(first.deliveries.map((delivery) => [delivery.ask, delivery.brokenReason])).toEqual([
      [null, "the plans' ceiling could not be measured, plan-three has no seven-day sample whose reset is still ahead"],
    ]);
    const attempt = unwrap(readSlotAttempt({ home, recipeId: "fleet-ceiling-weekly", slotIso: SLOT }));
    expect(attempt!.outcome!.kind).toBe("failed");
    const finding = failureFindingSlug({ attempt: 1, recipeId: "fleet-ceiling-weekly", slotIso: SLOT });
    expect(first.registered.length).toBe(1);
    const argv = first.registered[0]!;
    expect([argv[argv.indexOf("--slug") + 1], argv[argv.indexOf("--repo") + 1]]).toEqual([
      finding,
      "/checkouts/slopweaver",
    ]);

    const second = brokenDeps();
    await runDueUnderFake({ argv: argvFor({ home }), deps: second });
    expect([second.deliveries, second.registered]).toEqual([[], []]);
  });
});
