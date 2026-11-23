/**
 * The `fleet-ceiling-report` kind: its planner, the morning's page and the Queue card it may earn.
 *
 * Each card is checked against the REAL gates `handover register` runs — the heading, the shape and the scene — so
 * a card that would be refused at the board fails here instead of on a morning nobody is watching.
 *
 * A broken measurement no longer earns a card at all — it names what broke so the firing fails and a repair is
 * seated — so the broken card's text assertions and its reason clip went out with the code that built them.
 */
import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "#lib/result.js";

import type { FleetCeilingReport } from "../../../../capacity/seatCeiling.js";
import { askExampleProblems } from "../../../../handover/askExamples.js";
import { parseAskOptions } from "../../../../handover/askShape.js";
import { askShapeVerdict } from "../../../../handover/askShapeGate.js";
import { cardAlignmentVerdict } from "../../../../handover/cardAlignment.js";
import { RECIPE_DEFINITION_SCHEMA_VERSION, type RecipeDefinition } from "../../../../live/automation/definition.js";
import { runShapeForKind } from "../../../../live/automation/definitionShape.js";
import {
  type FleetCeilingAsk,
  type FleetCeilingWhy,
  fleetCeilingAskArgv,
} from "../../../../live/automation/fleetCeilingAsk.js";
import {
  fleetCeilingDelivery,
  fleetCeilingHeadline,
  fleetCeilingSlugForSlot,
  planFleetCeilingReport,
} from "../../../../live/automation/fleetCeilingReport.js";
import { FLEET_CEILING_REPORT_KIND } from "../../../../live/automation/kinds.js";
import { measuredFleetCeilingReport } from "../../../fleetCeilingReportFixture.js";

/** A parsed `fleet-ceiling-report` row, overridable field by field. */
function row(over: Partial<RecipeDefinition> = {}): RecipeDefinition {
  return {
    cadence: "0 6 * * *",
    destination: { kind: "local-page" },
    effect: "read-write",
    enabled: true,
    kind: FLEET_CEILING_REPORT_KIND,
    onMissed: "skip",
    params: { days: 7 },
    recipeId: "fleet-ceiling-weekly",
    schemaVersion: RECIPE_DEFINITION_SCHEMA_VERSION,
    ...over,
  };
}

/** 06:00 local time in Melbourne on the slot's day, which is still the previous day in UTC. */
const SLOT = "2026-10-04T19:00:00.000Z";

/** What `fleet why` read, one sentence. */
const WHY: FleetCeilingWhy = { kind: "read", sentences: ["The supervisor's seat cap binds now."] };

/** The delivery for a report, unwrapped. */
function delivered({ report, why = WHY }: { report: FleetCeilingReport; why?: FleetCeilingWhy }) {
  return unwrap(fleetCeilingDelivery({ days: 7, report, slotIso: SLOT, why }));
}

/**
 * The measured week with a third plan, `max-c`, newer than its first weekly reset — the live shape: the
 * two counted plans still carry the unused figure, and max-c reads only as uncounted.
 */
function withUncountedPlan(over: Partial<FleetCeilingReport>): FleetCeilingReport {
  const base = measuredFleetCeilingReport();
  return measuredFleetCeilingReport({
    planAliases: [...base.planAliases, "max-c"],
    uncountedPlans: ["max-c: no weekly window was observed resetting in the span, so it is not counted"],
    unusedByPlan: [
      ...base.unusedByPlan,
      { expiredWindows: 0, planAlias: "max-c", unusedPlanWeeksUpperBound: null, widestLastReadingToResetSeconds: null },
    ],
    ...over,
  });
}

/** Every refusal `handover register` would print for this card, empty when it would place it. */
function registerRefusals({ ask }: { ask: FleetCeilingAsk }): readonly string[] {
  const options = parseAskOptions({ text: ask.options.join("\n") });
  const heading = cardAlignmentVerdict({ command: "handover register", env: {}, question: ask.ask });
  const shape = askShapeVerdict({
    blastRadius: ask.blastRadius,
    command: "handover register",
    env: {},
    lean: ask.lean,
    options: options.options,
    parseProblems: options.problems,
    problem: ask.problem,
    required: true,
    risk: ask.risk,
    stillReal: ask.stillReal,
  });
  return [
    ...(heading.kind === "refused" ? heading.lines : []),
    ...(shape.kind === "refused" ? shape.lines : []),
    ...askExampleProblems({ examples: [ask.example], gap: undefined }),
  ];
}

describe("planFleetCeilingReport", () => {
  it("plans a row with its span", () => {
    expect(unwrap(planFleetCeilingReport({ definition: row() }))).toEqual({
      days: 7,
      recipeId: "fleet-ceiling-weekly",
    });
  });

  it("refuses a span past what fleet ceiling measures", () => {
    const planned = planFleetCeilingReport({ definition: row({ params: { days: 29 } }) });
    expect(unwrapErr(planned).code).toBe("PARAMS_INVALID");
    expect(unwrapErr(planned).message).toContain("days:");
  });

  it("refuses a key the kind does not declare", () => {
    const planned = planFleetCeilingReport({ definition: row({ params: { days: 7, postTo: "C0TEAM" } }) });
    expect(unwrapErr(planned).code).toBe("PARAMS_INVALID");
    expect(unwrapErr(planned).message).toContain("postTo");
  });

  it("refuses a Slack destination — the report lands on this install, never as a post", () => {
    const planned = planFleetCeilingReport({ definition: row({ destination: { kind: "slack" } }) });
    expect(unwrapErr(planned).code).toBe("DESTINATION_NOT_LOCAL_PAGE");
    expect(unwrapErr(planned).message).toContain("declares destination 'slack'");
  });

  it("refuses a read-only row, because a run publishes a page", () => {
    expect(unwrapErr(planFleetCeilingReport({ definition: row({ effect: "read" }) })).code).toBe("EFFECT_TOO_NARROW");
  });

  it("runs in this process", () => {
    expect(runShapeForKind({ kind: FLEET_CEILING_REPORT_KIND })).toBe("run-here");
  });
});

describe("fleetCeilingHeadline", () => {
  it("leads with the unused share and the seats that could still run, already subtracted", () => {
    expect(fleetCeilingHeadline({ days: 7, report: measuredFleetCeilingReport() })).toBe(
      "Last 7 days the Claude plans left at most 13% of their week unused. " +
        "4.2 seats worked on average and the plans carry 6, so about 1 more could run.",
    );
  });

  it("says the plans are the limit when the fleet already works at the ceiling", () => {
    const report = measuredFleetCeilingReport({
      seats: { ...measuredFleetCeilingReport().seats, meanWorkingSeats: 5.6 },
    });
    expect(fleetCeilingHeadline({ days: 7, report })).toBe(
      "Last 7 days the Claude plans left at most 13% of their week unused. " +
        "5.6 seats worked on average and the plans carry 6, so the plans are the limit.",
    );
  });

  it("names every unknown rather than guessing", () => {
    const base = measuredFleetCeilingReport();
    const report = measuredFleetCeilingReport({
      combinedUnusedShareUpperBound: null,
      seats: { ...base.seats, meanOpenSeats: null, meanWorkingSeats: null, peakWorkingSeats: null },
    });
    expect(fleetCeilingHeadline({ days: 7, report })).toBe(
      "No Claude plan reset in the last 7 days, so what was left unused is unknown. " +
        "No supervisor tick saw the fleet, so how many seats worked is unknown.",
    );
  });

  it("says over 999 rather than spelling out the N a near-zero burn divides into", () => {
    const report = measuredFleetCeilingReport({
      ceiling: {
        burnPerWorkingSeatHour: 6e-308,
        kind: "measured",
        plans: [],
        seats: 1.6e307,
        sustainablePlanWeeksPerHour: 1,
      },
      combinedUnusedShareUpperBound: 1,
      seats: { ...measuredFleetCeilingReport().seats, meanWorkingSeats: 1 },
    });
    expect(fleetCeilingHeadline({ days: 28, report })).toBe(
      "Last 28 days the Claude plans left at most 100% of their week unused. " +
        "1 seats worked on average and the plans carry over 999, so over 999 more could run.",
    );
  });
});

describe("fleetCeilingDelivery — the page", () => {
  it("names the page by the slot's LOCAL day, and yesterday's card by the day before", () => {
    const delivery = delivered({ report: measuredFleetCeilingReport() });
    expect([delivery.day, delivery.slug, delivery.previousSlug]).toEqual([
      "2026-10-05",
      "fleet-ceiling-2026-10-05",
      "fleet-ceiling-2026-10-04",
    ]);
  });

  it("opens on the day and the headline, then what held it back, each plan and the fleet", () => {
    const { fragment } = delivered({ report: measuredFleetCeilingReport() });
    expect(fragment.split("\n").slice(0, 3)).toEqual([
      "<h1>Fleet ceiling, 2026-10-05</h1>",
      '<p class="lede">Last 7 days the Claude plans left at most 13% of their week unused. ' +
        "4.2 seats worked on average and the plans carry 6, so about 1 more could run.</p>",
      "<section><h2>What held it back this morning</h2><ul><li>The supervisor&#39;s seat cap binds now.</li></ul></section>",
    ]);
    expect(fragment).toContain("<li><code>max-a</code>: at most 20% of its week unused at its reset</li>");
    expect(fragment).toContain("<li>working seats: 4.2 on average, peak 11, out of 9 open</li>");
    expect(fragment).not.toContain("What the readers could not count");
  });

  it("escapes every string it did not write, so journal text that looks like markup stays text", () => {
    const base = measuredFleetCeilingReport();
    const { fragment } = delivered({
      report: measuredFleetCeilingReport({
        problems: ['a tick at "<script>" did not parse'],
        unusedByPlan: [{ ...base.unusedByPlan[0]!, planAlias: "<b>plan</b>" }],
      }),
    });
    expect(fragment).toContain("<code>&lt;b&gt;plan&lt;/b&gt;</code>");
    expect(fragment).toContain("not counted, <code>a tick at &quot;&lt;script&gt;&quot; did not parse</code>");
    expect(fragment).not.toContain("<script>");
  });

  it("refuses a slot that names no instant, rather than publishing a page for no day", () => {
    const planned = fleetCeilingDelivery({
      days: 7,
      report: measuredFleetCeilingReport(),
      slotIso: "not-a-time",
      why: WHY,
    });
    expect(unwrapErr(planned).code).toBe("SLOT_UNREADABLE");
  });
});

describe("fleetCeilingSlugForSlot", () => {
  it("names the slot's local day, the same slug the delivery places under", () => {
    const slotIso = "2026-10-04T19:00:00.000Z";
    expect(fleetCeilingSlugForSlot({ slotIso })).toBe("fleet-ceiling-2026-10-05");
    expect(
      unwrap(fleetCeilingDelivery({ days: 7, report: measuredFleetCeilingReport(), slotIso, why: WHY })).slug,
    ).toBe("fleet-ceiling-2026-10-05");
  });

  it("names nothing for a slot that is no instant", () => {
    expect(fleetCeilingSlugForSlot({ slotIso: "not-a-time" })).toBe(undefined);
  });
});

describe("fleetCeilingDelivery — the Queue card", () => {
  it("cards a whole seat of headroom, asking whether to fill it, and the board would place it", () => {
    const ask = delivered({ report: measuredFleetCeilingReport() }).ask!;
    expect(ask.kind).toBe("headroom");
    expect(ask.slug).toBe("fleet-ceiling-2026-10-05");
    expect(ask.ask).toBe(
      "Should the supervisor run the about 1 more working seat the Claude plans could have carried? " +
        "Last 7 days the Claude plans left at most 13% of their week unused. " +
        "4.2 seats worked on average and the plans carry 6, so about 1 more could run. " +
        "What held it back: The supervisor's seat cap binds now.",
    );
    expect(ask.lean).toBe("fill the headroom");
    expect(registerRefusals({ ask })).toEqual([]);
  });

  it("places NO card when the plans are the limit and every part read — the page alone answers", () => {
    const report = measuredFleetCeilingReport({
      seats: { ...measuredFleetCeilingReport().seats, meanWorkingSeats: 5.6 },
    });
    expect(delivered({ report }).ask).toBe(null);
  });

  it("NEVER cards a broken measurement — it names what broke, so the firing fails and a repair is seated", () => {
    const report = measuredFleetCeilingReport({
      ceiling: { kind: "unmeasurable", reason: "no plan reading is fresh" },
    });
    const { ask, brokenReason } = delivered({ report });
    expect(ask).toBe(null);
    expect(brokenReason).toBe("the plans' ceiling could not be measured, no plan reading is fresh");
  });

  it("names an unmeasurable burn as broken, beside a measured ceiling, with no card", () => {
    const report = measuredFleetCeilingReport({
      burn: { kind: "unmeasurable", reason: "max-c has no run of weekly readings in the span" },
      seats: { ...measuredFleetCeilingReport().seats, meanWorkingSeats: 5.6 },
    });
    const { ask, brokenReason } = delivered({ report });
    expect(ask).toBe(null);
    expect(brokenReason).toBe(
      "the burn per working seat could not be measured, max-c has no run of weekly readings in the span",
    );
  });

  it("names a fleet why it could not read as broken, even when the plans are the limit", () => {
    const report = measuredFleetCeilingReport({
      seats: { ...measuredFleetCeilingReport().seats, meanWorkingSeats: 5.6 },
    });
    const { ask, brokenReason } = delivered({
      report,
      why: { kind: "unreadable", reason: "the readings ledger is unreadable" },
    });
    expect(ask).toBe(null);
    expect(brokenReason).toBe("what held the fleet back could not be read, the readings ledger is unreadable");
  });

  it("names a reader's problem as broken, the first one", () => {
    const report = measuredFleetCeilingReport({
      problems: ["seats: 2 tick ledger line(s) did not parse", "claude: 1 line did not parse"],
      seats: { ...measuredFleetCeilingReport().seats, meanWorkingSeats: 5.6 },
    });
    expect(delivered({ report }).brokenReason).toBe(
      "a reader could not count something, seats: 2 tick ledger line(s) did not parse",
    );
  });

  it("names nothing broken when every part read", () => {
    expect(delivered({ report: measuredFleetCeilingReport() }).brokenReason).toBe(null);
  });

  it("withholds even an earned headroom card when a reader's problem stands beside it", () => {
    const report = measuredFleetCeilingReport({ problems: ["seats: 2 tick ledger line(s) did not parse"] });
    // The same report clean earns a headroom card, so the null below is the broken part withholding it.
    expect(delivered({ report: measuredFleetCeilingReport() }).ask!.kind).toBe("headroom");
    const { ask, brokenReason } = delivered({ report });
    expect(ask).toBe(null);
    expect(brokenReason).toBe("a reader could not count something, seats: 2 tick ledger line(s) did not parse");
  });

  it("places NO card for a plan newer than its first reset while the others counted — the page discloses it", () => {
    const report = withUncountedPlan({ seats: { ...measuredFleetCeilingReport().seats, meanWorkingSeats: 5.6 } });
    const { ask, fragment } = delivered({ report });
    expect(ask).toBe(null);
    expect(fragment).toContain(
      "<li>a plan not counted, <code>max-c: no weekly window was observed resetting in the span, so it is not " +
        "counted</code></li>",
    );
  });

  it("keeps a headroom card clean of a plan newer than its first reset", () => {
    const ask = delivered({ report: withUncountedPlan({}) }).ask!;
    expect(ask.kind).toBe("headroom");
    expect(ask.ask).not.toContain("max-c");
  });

  it("names a measurement broken when NO plan was seen resetting, so what went unused is unknown", () => {
    const report = measuredFleetCeilingReport({
      combinedUnusedShareUpperBound: null,
      observedExpiredPlanWeeks: 0,
      seats: { ...measuredFleetCeilingReport().seats, meanWorkingSeats: 5.6 },
      uncountedPlans: [
        "max-a: no weekly window was observed resetting in the span, so it is not counted",
        "max-b: no weekly window was observed resetting in the span, so it is not counted",
      ],
      unusedByPlan: [
        {
          expiredWindows: 0,
          planAlias: "max-a",
          unusedPlanWeeksUpperBound: null,
          widestLastReadingToResetSeconds: null,
        },
        {
          expiredWindows: 0,
          planAlias: "max-b",
          unusedPlanWeeksUpperBound: null,
          widestLastReadingToResetSeconds: null,
        },
      ],
      unusedPlanWeeksUpperBound: null,
    });
    const { ask, brokenReason } = delivered({ report });
    expect(ask).toBe(null);
    expect(brokenReason).toBe(
      "no Claude plan's weekly reset was observed in the span, so what was left unused is unknown",
    );
  });
});

describe("fleetCeilingAskArgv", () => {
  it("registers the card as the fleet's own work, under the page's slug", () => {
    const ask = delivered({ report: measuredFleetCeilingReport() }).ask!;
    const argv = fleetCeilingAskArgv({ ask, home: "/h" });
    expect(argv.slice(0, 4)).toEqual(["node", "slopweaver", "handover", "register"]);
    expect(argv[argv.indexOf("--slug") + 1]).toBe("fleet-ceiling-2026-10-05");
    expect(argv[argv.indexOf("--workspace") + 1]).toBe("self");
    expect(argv.slice(-2)).toEqual(["--home", "/h"]);
  });
});
