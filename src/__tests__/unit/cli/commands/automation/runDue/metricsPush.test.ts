/**
 * `slopweaver automation run-due` over a `metrics-push` row: its two legs — produce the slot day, then submit
 * through the door — and every refusal and failure that stops the second leg.
 */
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { EXIT_EXPECTED_EMPTY } from "../../../../../../cli/exitCodes.js";
import { unwrap } from "../../../../../../lib/result.js";
import { readRecipeDefinitionRuns } from "../../../../../../live/automation/definitionRunStore.js";
import { runDueUnderFake } from "../../../../../runDueSignalFake.js";
import { argvFor, firingAt, row } from "./fixtures.js";
import { deps, homeWith, removeHomes } from "./harness.js";

afterEach(() => {
  removeHomes();
});

describe("recipe run-due", () => {
  /** The stamped runs of one home. */
  function readRuns({ home }: { home: string }): Record<string, { readonly watermarkIso: string } | undefined> {
    return unwrap(readRecipeDefinitionRuns({ path: join(home, "live", "recipe", "definition-runs.json") }));
  }

  /** A `metrics-push` row pushing one declared producer. */
  function metricsPushRow(over: Record<string, unknown> = {}): Record<string, unknown> {
    return row({
      cadence: "0 13 * * *",
      destination: { kind: "datadog-push" },
      effect: "read-write",
      kind: "metrics-push",
      onMissed: "backfill",
      params: { producer: "daily-delivery" },
      recipeId: "delivery-metrics",
      ...over,
    });
  }

  it("runs a metrics-push row as its two legs — produce the slot day, then submit through the door — and stamps it", async () => {
    const home = homeWith({ rows: [metricsPushRow()] });
    const injected = deps();
    const code = await runDueUnderFake({ argv: argvFor({ home }), deps: injected });
    expect(code).toBe(0);
    expect(injected.dispatched).toHaveLength(2);
    const [produce, submit] = injected.dispatched;
    // The cadence is read in the installation's LOCAL time, so the slot's UTC day depends on the runner's
    // zone. Derived here rather than written as a literal: a literal passed at UTC+10 and failed on CI.
    const slotIso = firingAt({ cadence: "0 13 * * *", nowIso: "2026-09-08T12:05:00.000Z" });
    const slotDay = slotIso.slice(0, 10);
    const payload = join(home, "live", "recipe", "metrics-push", "delivery-metrics", `${slotDay}.json`);
    expect(produce!.slice(2)).toEqual([
      "datadog",
      "produce",
      "--producer",
      "daily-delivery",
      "--day",
      slotDay,
      "--out",
      payload,
      "--home",
      home,
    ]);
    expect(submit!.slice(2)).toEqual(["datadog", "submit", "--series", payload, "--allow-late", "--home", home]);
    expect(
      injected.out.some((line) =>
        line.includes(
          `recipe delivery-metrics · ran · datadog produce --producer daily-delivery --day ${slotDay} → ` +
            "datadog submit --allow-late · exit 0",
        ),
      ),
    ).toBe(true);
    expect(readRuns({ home })["delivery-metrics"]!.watermarkIso).toBe(slotIso);
  });

  it("submits nothing when the produce leg fails, reports it, and leaves the firing to be retried", async () => {
    const home = homeWith({ rows: [metricsPushRow()] });
    const injected = deps({ exitCode: 1 });
    const code = await runDueUnderFake({ argv: argvFor({ home }), deps: injected });
    expect(code).toBe(1);
    expect(injected.dispatched).toHaveLength(1);
    expect(injected.out.some((line) => line.includes("PRODUCE FAILED") && line.includes("nothing was submitted"))).toBe(
      true,
    );
    expect(readRuns({ home })["delivery-metrics"]).toBe(undefined);
  });

  it("never stamps a firing whose produce leg refused with exit 3 — an undeclared producer sent nothing", async () => {
    const home = homeWith({ rows: [metricsPushRow()] });
    const injected = deps({ exitCode: EXIT_EXPECTED_EMPTY });
    await runDueUnderFake({ argv: argvFor({ home }), deps: injected });
    expect(injected.dispatched).toHaveLength(1);
    expect(injected.out.some((line) => line.includes("PRODUCE FAILED") && line.includes("exit 3"))).toBe(true);
    expect(readRuns({ home })["delivery-metrics"]).toBe(undefined);
  });

  it("runs the produce leg for real under --dry-run and stops at datadog submit --dry-run, stamping nothing", async () => {
    const home = homeWith({ rows: [metricsPushRow()] });
    const injected = deps();
    const code = await runDueUnderFake({ argv: argvFor({ home, tail: ["--dry-run"] }), deps: injected });
    expect(code).toBe(0);
    expect(injected.dispatched).toHaveLength(2);
    expect(injected.dispatched[1]!.at(-1)).toBe("--dry-run");
    expect(injected.out.some((line) => line.includes("recipe delivery-metrics · would submit"))).toBe(true);
    expect(readRuns({ home })["delivery-metrics"]).toBe(undefined);
  });

  it("refuses a read-only metrics-push row without dispatching either leg", async () => {
    const home = homeWith({ rows: [metricsPushRow({ effect: "read" })] });
    const injected = deps();
    const code = await runDueUnderFake({ argv: argvFor({ home }), deps: injected });
    expect(code).toBe(1);
    expect(injected.dispatched).toEqual([]);
    expect(injected.out.some((line) => line.includes("REFUSED") && line.includes("SUBMITS the points"))).toBe(true);
  });

  it("refuses a metrics-push row that names a command in its params, without dispatching", async () => {
    const home = homeWith({
      rows: [metricsPushRow({ params: { command: ["sh", "-c", "true"], producer: "daily-delivery" } })],
    });
    const injected = deps();
    const code = await runDueUnderFake({ argv: argvFor({ home }), deps: injected });
    expect(code).toBe(1);
    expect(injected.dispatched).toEqual([]);
    expect(
      injected.out.some((line) => line.includes("REFUSED") && line.includes("not a runnable metrics-push row")),
    ).toBe(true);
  });
});
