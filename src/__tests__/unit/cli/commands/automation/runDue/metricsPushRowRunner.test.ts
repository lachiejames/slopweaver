/**
 * `runMetricsPushRow` — the metrics-push runner `automation run-due` dispatches to, called directly, and
 * `metricsPushSettleCode`, which maps each leg's exit to the code its firing settles with.
 */
import { describe, expect, it } from "vitest";

import {
  metricsPushSettleCode,
  runMetricsPushRow,
} from "../../../../../../cli/commands/automation/metricsPushRowRunner.js";
import {
  EXIT_DEFERRED,
  EXIT_ERROR,
  EXIT_EXPECTED_EMPTY,
  EXIT_OK,
  EXIT_USAGE,
} from "../../../../../../cli/exitCodes.js";
import {
  RECIPE_DEFINITION_SCHEMA_VERSION,
  type RecipeDefinition,
} from "../../../../../../live/automation/definition.js";
import { deps } from "./harness.js";

/** The not-yet-run outcome fields `runOneRow` spreads over every arm. */
const BASE = { detail: [], exitCode: null, failed: false, ran: false, recipeId: "delivery-metrics" } as const;

/** A `metrics-push` row allowed to submit. */
const READ_WRITE_ROW: RecipeDefinition = {
  cadence: "0 13 * * *",
  destination: { kind: "datadog-push" },
  effect: "read-write",
  enabled: true,
  kind: "metrics-push",
  onMissed: "backfill",
  params: { producer: "daily-delivery" },
  recipeId: "delivery-metrics",
  schemaVersion: RECIPE_DEFINITION_SCHEMA_VERSION,
};

describe("runMetricsPushRow — the metrics-push runner, called directly", () => {
  it("refuses a read-only row before either leg, and names the effect that would submit", async () => {
    const edges = deps();
    const outcome = await runMetricsPushRow({
      base: { detail: [], exitCode: null, failed: false, ran: false, recipeId: "delivery-metrics" },
      definition: {
        cadence: "0 13 * * *",
        destination: { kind: "datadog-push" },
        effect: "read",
        enabled: true,
        kind: "metrics-push",
        onMissed: "backfill",
        params: { producer: "daily-delivery" },
        recipeId: "delivery-metrics",
        schemaVersion: RECIPE_DEFINITION_SCHEMA_VERSION,
      },
      deps: edges,
      dryRun: false,
      home: "/tmp/home",
      slotIso: "2026-09-08T03:00:00.000Z",
    });
    expect(outcome.failed).toBe(true);
    expect(outcome.ran).toBe(false);
    expect(outcome.line).toContain("recipe delivery-metrics · REFUSED ·");
    expect(outcome.line).toContain("SUBMITS the points");
    expect(edges.dispatched).toEqual([]);
  });

  it("settles a submit leg's exit 3 (no credentials, a door refusal) as a failure, never a retirement", async () => {
    const edges = deps({
      verbRuns: [
        { diagnostics: "", exitCode: EXIT_OK },
        { diagnostics: "", exitCode: EXIT_EXPECTED_EMPTY },
      ],
    });
    const outcome = await runMetricsPushRow({
      base: BASE,
      definition: READ_WRITE_ROW,
      deps: edges,
      dryRun: false,
      home: "/tmp/home",
      slotIso: "2026-09-08T03:00:00.000Z",
    });
    expect(outcome.exitCode).toBe(EXIT_ERROR);
    expect(outcome.failed).toBe(true);
    expect(outcome.ran).toBe(true);
    expect(outcome.line).toContain("· exit 3");
  });

  it("carries a failed produce leg's stderr tail on its line, so the finding says why nothing was submitted", async () => {
    const edges = deps({
      verbRuns: [
        { diagnostics: "progress: 3 series\ndatadog produce: secret DD_SOURCE_TOKEN is absent\n", exitCode: 1 },
      ],
    });
    const outcome = await runMetricsPushRow({
      base: BASE,
      definition: READ_WRITE_ROW,
      deps: edges,
      dryRun: false,
      home: "/tmp/home",
      slotIso: "2026-09-08T03:00:00.000Z",
    });
    expect(outcome.line).toBe(
      "recipe delivery-metrics · PRODUCE FAILED · datadog produce --producer daily-delivery --day 2026-09-08 · " +
        "exit 1 · nothing was submitted · why: progress: 3 series / datadog produce: secret DD_SOURCE_TOKEN is absent",
    );
    expect(edges.dispatched.length).toBe(1);
  });

  it("names only the SUBMIT leg's own stderr when submit fails after a produce that chattered", async () => {
    const edges = deps({
      verbRuns: [
        { diagnostics: "datadog produce: wrote 12 series\n", exitCode: EXIT_OK },
        { diagnostics: "datadog submit: Datadog answered 403 Forbidden\n", exitCode: 1 },
      ],
    });
    const outcome = await runMetricsPushRow({
      base: BASE,
      definition: READ_WRITE_ROW,
      deps: edges,
      dryRun: false,
      home: "/tmp/home",
      slotIso: "2026-09-08T03:00:00.000Z",
    });
    expect(outcome.line).toBe(
      "recipe delivery-metrics · ran · datadog produce --producer daily-delivery --day 2026-09-08 → " +
        "datadog submit --allow-late · exit 1 · why: datadog submit: Datadog answered 403 Forbidden",
    );
  });

  it("leaves a submit that succeeded unannotated, whatever either leg wrote to stderr", async () => {
    const edges = deps({
      verbRuns: [
        { diagnostics: "datadog produce: wrote 12 series\n", exitCode: EXIT_OK },
        { diagnostics: "datadog submit: 12 points accepted\n", exitCode: EXIT_OK },
      ],
    });
    const outcome = await runMetricsPushRow({
      base: BASE,
      definition: READ_WRITE_ROW,
      deps: edges,
      dryRun: false,
      home: "/tmp/home",
      slotIso: "2026-09-08T03:00:00.000Z",
    });
    expect(outcome.line).toBe(
      "recipe delivery-metrics · ran · datadog produce --producer daily-delivery --day 2026-09-08 → " +
        "datadog submit --allow-late · exit 0",
    );
  });

  it("maps each leg exit to the code its firing settles with — only a zero retires, a deferral passes through", () => {
    expect(metricsPushSettleCode({ exit: EXIT_OK })).toBe(EXIT_OK);
    expect(metricsPushSettleCode({ exit: EXIT_DEFERRED })).toBe(EXIT_DEFERRED);
    expect(metricsPushSettleCode({ exit: EXIT_EXPECTED_EMPTY })).toBe(EXIT_ERROR);
    expect(metricsPushSettleCode({ exit: EXIT_USAGE })).toBe(EXIT_ERROR);
    expect(metricsPushSettleCode({ exit: EXIT_ERROR })).toBe(EXIT_ERROR);
  });
});
