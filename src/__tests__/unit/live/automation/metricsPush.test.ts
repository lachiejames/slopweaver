/**
 * `planMetricsPush` and its two argv builders — the `metrics-push` kind's executor, which pushes whatever one
 * install-declared metrics producer prints.
 *
 * What has to be falsifiable: the refusal that keeps a read-only row from stamping a namespace, the refusal of any
 * params beyond `{ producer }` (a row never names a command), the slot → UTC-day mapping (a local-time cadence
 * covers the UTC day its instant falls on), and the exact argv each leg gets — `--allow-late` is built in, never a
 * row's choice.
 *
 * deleted-with-code: BORROWED_SDLC_PRODUCER
 */
import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../../lib/result.js";
import { RECIPE_DEFINITION_SCHEMA_VERSION, type RecipeDefinition } from "../../../../live/automation/definition.js";
import {
  METRICS_PUSH_KIND,
  MetricsPushPlanErrors,
  metricsPushPayloadPath,
  metricsPushProduceArgv,
  metricsPushSubmitArgv,
  planMetricsPush,
  slotUtcDay,
} from "../../../../live/automation/metricsPush.js";

/** A `metrics-push` row pushing one declared producer, overridable field by field. */
function row(over: Partial<RecipeDefinition> = {}): RecipeDefinition {
  return {
    cadence: "0 13 * * *",
    destination: { kind: "datadog-push" },
    effect: "read-write",
    enabled: true,
    kind: METRICS_PUSH_KIND,
    onMissed: "backfill",
    params: { producer: "daily-delivery" },
    recipeId: "delivery-metrics",
    schemaVersion: RECIPE_DEFINITION_SCHEMA_VERSION,
    ...over,
  };
}

const SLOT = "2026-09-16T03:00:00.000Z";
const HOME = "/home/x";

describe("planMetricsPush", () => {
  it("plans a row naming a producer", () => {
    expect(unwrap(planMetricsPush({ definition: row() }))).toEqual({
      producer: "daily-delivery",
      recipeId: "delivery-metrics",
    });
  });

  it("refuses a read-only row, because every run submits points", () => {
    const error = unwrapErr(planMetricsPush({ definition: row({ effect: "read" }) }));
    expect(error).toEqual(MetricsPushPlanErrors.effectTooNarrow({ declared: "read", recipeId: "delivery-metrics" }));
    expect(error.message).toContain("declare 'write' or 'read-write'");
  });

  it("refuses a row that names no producer", () => {
    const error = unwrapErr(planMetricsPush({ definition: row({ params: {} }) }));
    expect(error.code).toBe("PARAMS_INVALID");
    expect(error.message).toContain("producer:");
  });

  it.each([
    ["a command", { command: ["sh", "-c", "true"], producer: "daily-delivery" }, "command"],
    ["a checkout", { checkout: "/work/acme-metrics", producer: "daily-delivery" }, "checkout"],
    ["a field from the producer that was removed", { producer: "daily-delivery", repo: "/c" }, "repo"],
  ])("refuses %s in params, so the profile stays the one place a producer's command lives", (_label, params, key) => {
    const error = unwrapErr(planMetricsPush({ definition: row({ params }) }));
    expect(error.code).toBe("PARAMS_INVALID");
    expect(error.message).toContain(key);
  });
});

describe("slotUtcDay", () => {
  it("is the UTC calendar day the firing instant falls on", () => {
    expect(slotUtcDay({ slotIso: SLOT })).toBe("2026-09-16");
    expect(slotUtcDay({ slotIso: "2026-09-16T23:30:00.000Z" })).toBe("2026-09-16");
    expect(slotUtcDay({ slotIso: "2026-09-17T00:00:00.000Z" })).toBe("2026-09-17");
  });
});

describe("the two legs", () => {
  const plan = unwrap(planMetricsPush({ definition: row() }));

  it("writes the payload under the state home, named for the row and the day", () => {
    expect(metricsPushPayloadPath({ home: HOME, recipeId: "delivery-metrics", slotIso: SLOT })).toBe(
      "/home/x/live/recipe/metrics-push/delivery-metrics/2026-09-16.json",
    );
  });

  it("produces exactly the slot's day for the row's producer into that file", () => {
    expect(metricsPushProduceArgv({ home: HOME, plan, slotIso: SLOT })).toEqual([
      "node",
      "slopweaver",
      "datadog",
      "produce",
      "--producer",
      "daily-delivery",
      "--day",
      "2026-09-16",
      "--out",
      "/home/x/live/recipe/metrics-push/delivery-metrics/2026-09-16.json",
      "--home",
      HOME,
    ]);
  });

  it("submits that file with --allow-late built in, and --dry-run only when asked", () => {
    expect(metricsPushSubmitArgv({ dryRun: false, home: HOME, plan, slotIso: SLOT })).toEqual([
      "node",
      "slopweaver",
      "datadog",
      "submit",
      "--series",
      "/home/x/live/recipe/metrics-push/delivery-metrics/2026-09-16.json",
      "--allow-late",
      "--home",
      HOME,
    ]);
    expect(metricsPushSubmitArgv({ dryRun: true, home: HOME, plan, slotIso: SLOT }).at(-1)).toBe("--dry-run");
  });
});
