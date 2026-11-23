/**
 * `runFleetCeilingRow` — the daily unused-usage report, called directly over its four edges. It reads no prompt
 * channel and has no Slack leg: its deps type carries neither, so "posts nothing" is a compile-time property here.
 */
import { describe, expect, it } from "vitest";

import type { FleetCeilingReport } from "../../../../../capacity/seatCeiling.js";
import {
  type FleetCeilingCardReceipt,
  type FleetCeilingDeliveryError,
  FleetCeilingDeliveryErrors,
} from "../../../../../cli/commands/automation/fleetCeilingDeliveryErrors.js";
import { runFleetCeilingRow } from "../../../../../cli/commands/automation/fleetCeilingRowRunner.js";
import { err, ok, type Result } from "../../../../../lib/result.js";
import { RECIPE_DEFINITION_SCHEMA_VERSION, type RecipeDefinition } from "../../../../../live/automation/definition.js";
import type { FleetCeilingDelivery } from "../../../../../live/automation/fleetCeilingReport.js";
import { measuredFleetCeilingReport } from "../../../../fleetCeilingReportFixture.js";

/** The 06:00 Melbourne firing these cases cover — already the next calendar day there, still the previous one in UTC. */
const SLOT = "2026-10-04T19:00:00.000Z";

/** The not-yet-run outcome fields `runOneRow` spreads over every arm. */
const BASE = { detail: [], exitCode: null, failed: false, ran: false, recipeId: "fleet-ceiling-weekly" } as const;

/** A parsed `fleet-ceiling-report` row, overridable field by field. */
function ceilingRow(over: Partial<RecipeDefinition> = {}): RecipeDefinition {
  return {
    cadence: "0 6 * * *",
    destination: { kind: "local-page" },
    effect: "read-write",
    enabled: true,
    kind: "fleet-ceiling-report",
    onMissed: "skip",
    params: { days: 7 },
    recipeId: "fleet-ceiling-weekly",
    schemaVersion: RECIPE_DEFINITION_SCHEMA_VERSION,
    ...over,
  };
}

/** The runner's four edges as recording functions, with what each was handed. */
function edges({
  ceilingReport = ok(measuredFleetCeilingReport()),
  withdrawal = ok("none"),
}: {
  ceilingReport?: Result<FleetCeilingReport>;
  withdrawal?: Result<FleetCeilingCardReceipt, FleetCeilingDeliveryError>;
} = {}): Parameters<typeof runFleetCeilingRow>[0]["deps"] & {
  readonly ceilingReads: { readonly home: string; readonly days: number; readonly nowIso: string }[];
  readonly deliveries: FleetCeilingDelivery[];
  readonly withdrawals: { readonly home: string; readonly slug: string }[];
} {
  const ceilingReads: { readonly home: string; readonly days: number; readonly nowIso: string }[] = [];
  const deliveries: FleetCeilingDelivery[] = [];
  const withdrawals: { readonly home: string; readonly slug: string }[] = [];
  return {
    withdrawFleetCeilingCard: (options) => {
      withdrawals.push(options);
      return Promise.resolve(withdrawal);
    },
    withdrawals,
    ceilingReads,
    deliverFleetCeiling: ({ delivery }) => {
      deliveries.push(delivery);
      return Promise.resolve(
        ok({
          card: delivery.ask === null ? "none" : "placed",
          pageUrl: `file:///home/pages/${delivery.slug}/index.html`,
          previous: { kind: "withdrawn" },
        }),
      );
    },
    deliveries,
    now: () => SLOT,
    readFleetCeilingReport: (options) => {
      ceilingReads.push(options);
      return Promise.resolve(ceilingReport);
    },
    readFleetWhy: () => ({ kind: "read", sentences: ["The supervisor's seat cap binds now."] }),
  };
}

describe("runFleetCeilingRow — the daily unused-usage report, called directly", () => {
  it("measures the span ending at its own slot and delivers the local day's page and its card", async () => {
    const deps = edges();
    const outcome = await runFleetCeilingRow({
      base: BASE,
      definition: ceilingRow(),
      deps,
      dryRun: false,
      home: "/tmp/home",
      slotIso: SLOT,
    });
    expect(deps.ceilingReads).toEqual([{ days: 7, home: "/tmp/home", nowIso: SLOT }]);
    expect(deps.deliveries.map((delivery) => [delivery.slug, delivery.previousSlug, delivery.ask!.kind])).toEqual([
      ["fleet-ceiling-2026-10-05", "fleet-ceiling-2026-10-04", "headroom"],
    ]);
    expect(outcome).toEqual({
      ...BASE,
      exitCode: 0,
      line:
        "recipe fleet-ceiling-weekly · ran · fleet ceiling --days 7 → page fleet-ceiling-2026-10-05 · " +
        "file:///home/pages/fleet-ceiling-2026-10-05/index.html · card placed on the Queue · yesterday's card withdrawn",
      ran: true,
    });
  });

  it("reads for real and delivers nothing on a dry run", async () => {
    const deps = edges();
    const outcome = await runFleetCeilingRow({
      base: BASE,
      definition: ceilingRow(),
      deps,
      dryRun: true,
      home: "/tmp/home",
      slotIso: SLOT,
    });
    expect(deps.ceilingReads.length).toBe(1);
    expect(deps.deliveries).toEqual([]);
    expect(outcome).toEqual({
      ...BASE,
      line:
        "recipe fleet-ceiling-weekly · would publish · fleet ceiling --days 7 → page fleet-ceiling-2026-10-05 · " +
        "a headroom card on the Queue",
    });
  });

  it("refuses the old Slack-destination row before reading anything", async () => {
    const deps = edges();
    const outcome = await runFleetCeilingRow({
      base: BASE,
      definition: ceilingRow({ destination: { kind: "slack" } }),
      deps,
      dryRun: false,
      home: "/tmp/home",
      slotIso: SLOT,
    });
    expect([outcome.exitCode, outcome.failed]).toEqual([1, true]);
    expect(outcome.line).toContain("declares destination 'slack'");
    expect([deps.ceilingReads, deps.deliveries]).toEqual([[], []]);
  });

  it("refuses a read-only row before reading anything", async () => {
    const deps = edges();
    const outcome = await runFleetCeilingRow({
      base: BASE,
      definition: ceilingRow({ effect: "read" }),
      deps,
      dryRun: false,
      home: "/tmp/home",
      slotIso: SLOT,
    });
    expect(outcome.failed).toBe(true);
    expect(outcome.line).toContain("recipe fleet-ceiling-weekly · REFUSED ·");
    expect([deps.ceilingReads, deps.deliveries]).toEqual([[], []]);
  });

  it("fails the firing, naming why, when a source the report must read is unreadable", async () => {
    const deps = edges({ ceilingReport: err(["the drawdown journal could not be read: EACCES"]) });
    const outcome = await runFleetCeilingRow({
      base: BASE,
      definition: ceilingRow(),
      deps,
      dryRun: false,
      home: "/tmp/home",
      slotIso: SLOT,
    });
    expect(outcome).toEqual({
      ...BASE,
      exitCode: 1,
      failed: true,
      line:
        "recipe fleet-ceiling-weekly · fleet ceiling could not be read · " +
        "the drawdown journal could not be read: EACCES",
    });
    expect(deps.deliveries).toEqual([]);
    expect(deps.withdrawals).toEqual([{ home: "/tmp/home", slug: "fleet-ceiling-2026-10-05" }]);
  });

  it("withdraws the card an earlier attempt left when a retry cannot read its report, still failing the firing", async () => {
    const deps = edges({
      ceilingReport: err(["the drawdown journal could not be read: EACCES"]),
      withdrawal: ok("withdrawn"),
    });
    const outcome = await runFleetCeilingRow({
      base: BASE,
      definition: ceilingRow(),
      deps,
      dryRun: false,
      home: "/tmp/home",
      slotIso: SLOT,
    });
    expect(outcome).toEqual({
      ...BASE,
      exitCode: 1,
      failed: true,
      line:
        "recipe fleet-ceiling-weekly · fleet ceiling could not be read · " +
        "the drawdown journal could not be read: EACCES · an earlier attempt's card withdrawn",
    });
  });

  it("names a card it could not withdraw beside an unreadable report", async () => {
    const deps = edges({
      ceilingReport: err(["the drawdown journal could not be read: EACCES"]),
      withdrawal: err(
        FleetCeilingDeliveryErrors.cardNotWithdrawn({
          slug: "fleet-ceiling-2026-10-05",
          why: "handover withdraw exited 1",
        }),
      ),
    });
    const outcome = await runFleetCeilingRow({
      base: BASE,
      definition: ceilingRow(),
      deps,
      dryRun: false,
      home: "/tmp/home",
      slotIso: SLOT,
    });
    expect(outcome).toEqual({
      ...BASE,
      exitCode: 1,
      failed: true,
      line:
        "recipe fleet-ceiling-weekly · fleet ceiling could not be read · " +
        "the drawdown journal could not be read: EACCES · the Queue card fleet-ceiling-2026-10-05 an earlier " +
        "attempt left may still be open, NOT withdrawn: handover withdraw exited 1",
    });
  });

  it("treats a reader that THROWS like one that answered err: exit 1, and the earlier card withdrawn", async () => {
    const deps = {
      ...edges({ withdrawal: ok("withdrawn") }),
      readFleetCeilingReport: () => Promise.reject(new Error("EISDIR: illegal operation on a directory, read")),
    };
    const outcome = await runFleetCeilingRow({
      base: BASE,
      definition: ceilingRow(),
      deps,
      dryRun: false,
      home: "/tmp/home",
      slotIso: SLOT,
    });
    expect(outcome).toEqual({
      ...BASE,
      exitCode: 1,
      failed: true,
      line:
        "recipe fleet-ceiling-weekly · fleet ceiling could not be read · the report reader threw: " +
        "EISDIR: illegal operation on a directory, read · an earlier attempt's card withdrawn",
    });
    expect(deps.withdrawals).toEqual([{ home: "/tmp/home", slug: "fleet-ceiling-2026-10-05" }]);
  });

  it("withdraws nothing on a dry run whose report cannot be read", async () => {
    const deps = edges({ ceilingReport: err(["the drawdown journal could not be read: EACCES"]) });
    const outcome = await runFleetCeilingRow({
      base: BASE,
      definition: ceilingRow(),
      deps,
      dryRun: true,
      home: "/tmp/home",
      slotIso: SLOT,
    });
    expect([outcome.exitCode, outcome.failed]).toEqual([1, true]);
    expect(deps.withdrawals).toEqual([]);
  });

  /** The measurement whose ceiling could not be read, with the plans the limit so no headroom card is earned. */
  const brokenCeiling = (): FleetCeilingReport =>
    measuredFleetCeilingReport({
      ceiling: { kind: "unmeasurable", reason: "plan-three has no seven-day sample whose reset is still ahead" },
      seats: { ...measuredFleetCeilingReport().seats, meanWorkingSeats: 5.6 },
    });

  it("publishes a broken measurement's page, places NO card, and FAILS the firing with exit 1 so a repair is seated", async () => {
    const deps = edges({ ceilingReport: ok(brokenCeiling()) });
    const outcome = await runFleetCeilingRow({
      base: BASE,
      definition: ceilingRow(),
      deps,
      dryRun: false,
      home: "/tmp/home",
      slotIso: SLOT,
    });
    expect(deps.deliveries.map((delivery) => [delivery.slug, delivery.ask])).toEqual([
      ["fleet-ceiling-2026-10-05", null],
    ]);
    expect(outcome).toEqual({
      ...BASE,
      exitCode: 1,
      failed: true,
      line:
        "recipe fleet-ceiling-weekly · ran · fleet ceiling --days 7 → page fleet-ceiling-2026-10-05 · " +
        "file:///home/pages/fleet-ceiling-2026-10-05/index.html · no card, nothing needs them · " +
        "yesterday's card withdrawn · the measurement BROKE: the plans' ceiling could not be measured, " +
        "plan-three has no seven-day sample whose reset is still ahead",
      ran: true,
    });
  });

  it("withholds even an earned headroom card when part of the reading broke, and fails the firing", async () => {
    const deps = edges({
      ceilingReport: ok(measuredFleetCeilingReport({ problems: ["claude: 1 line did not parse"] })),
    });
    const outcome = await runFleetCeilingRow({
      base: BASE,
      definition: ceilingRow(),
      deps,
      dryRun: false,
      home: "/tmp/home",
      slotIso: SLOT,
    });
    expect(deps.deliveries.map((delivery) => delivery.ask)).toEqual([null]);
    expect([outcome.exitCode, outcome.failed, outcome.ran]).toEqual([1, true, true]);
    expect(outcome.line).toContain(
      "no card, nothing needs them · yesterday's card withdrawn · the measurement BROKE: a reader could not count " +
        "something, claude: 1 line did not parse",
    );
  });

  it("fails the firing with exit 1 when a broken retry cannot withdraw the card an earlier attempt left", async () => {
    const deps = {
      ...edges({ ceilingReport: ok(brokenCeiling()) }),
      deliverFleetCeiling: () =>
        Promise.resolve(
          err(
            FleetCeilingDeliveryErrors.cardNotWithdrawn({
              slug: "fleet-ceiling-2026-10-05",
              why: "handover withdraw exited 1",
            }),
          ),
        ),
    };
    const outcome = await runFleetCeilingRow({
      base: BASE,
      definition: ceilingRow(),
      deps,
      dryRun: false,
      home: "/tmp/home",
      slotIso: SLOT,
    });
    expect([outcome.exitCode, outcome.failed, outcome.ran]).toEqual([1, true, true]);
    expect(outcome.line).toBe(
      "recipe fleet-ceiling-weekly · fleet ceiling --days 7 → page fleet-ceiling-2026-10-05 · the Queue card " +
        "fleet-ceiling-2026-10-05 an earlier attempt left may still be open, NOT withdrawn: handover withdraw exited 1",
    );
  });

  it("says on a dry run that a broken measurement would fail and hold, delivering nothing", async () => {
    const deps = edges({ ceilingReport: ok(brokenCeiling()) });
    const outcome = await runFleetCeilingRow({
      base: BASE,
      definition: ceilingRow(),
      deps,
      dryRun: true,
      home: "/tmp/home",
      slotIso: SLOT,
    });
    expect(deps.deliveries).toEqual([]);
    expect(outcome).toEqual({
      ...BASE,
      line:
        "recipe fleet-ceiling-weekly · would publish · fleet ceiling --days 7 → page fleet-ceiling-2026-10-05 · " +
        "no card, nothing needs them · would FAIL and hold for a seated repair: the plans' ceiling could not be " +
        "measured, plan-three has no seven-day sample whose reset is still ahead",
    });
  });
});
