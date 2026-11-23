import { describe, expect, it } from "vitest";

import { LAP_STEP_TIMEOUT_EXIT, type LapStep, lapPlan } from "../../../../../cli/commands/github/lapCore.js";
import { LapErrors } from "../../../../../cli/commands/github/lapErrors.js";
import type { LapStepOutcome } from "../../../../../cli/commands/github/lapStatuses.js";
import { runSteps, runWithRetry } from "../../../../../cli/commands/github/lapSteps.js";
import { type LapReceipt, lapReceipt } from "../../../../../cli/commands/github/lapVerdict.js";
import { err, ok } from "../../../../../lib/result.js";

/** A plan step by id, which must exist. */
function stepNamed({ id }: { id: string }): LapStep {
  return lapPlan().find((step) => step.id === id)!;
}

/** Fakes `runStep`, answering each attempt's exit by its id in order, and records every id it ran. */
function attempts({ exits }: { exits: Readonly<Record<string, number>> }): {
  readonly ran: string[];
  readonly out: string[];
  readonly deps: Parameters<typeof runWithRetry>[0]["deps"];
} {
  const ran: string[] = [];
  const out: string[] = [];
  return {
    deps: {
      cleanTree: ({ keep }) => {
        ran.push(`clean[${keep.join(",")}]`);
        return ok(undefined);
      },
      out: (line) => out.push(line),
      runStep: ({ step }) => {
        ran.push(step.id);
        return Promise.resolve({ context: step.context, exitCode: exits[step.id]!, id: step.id, wallMs: 1000 });
      },
    },
    out,
    ran,
  };
}

/** The keep list a clean spares: the named shards' blobs, comma-joined as the fake `cleanTree` records them. */
const blobs = (...shards: number[]): string =>
  shards.map((at) => `.vitest-reports/blob-${String(at)}-6.json`).join(",");

/** A receipt stand-in: `runSteps` only hands it to `writeReceipt`, which these fakes discard. */
const receiptOf = ({ outcomes }: { outcomes: readonly LapStepOutcome[] }): LapReceipt =>
  lapReceipt({
    env: {},
    outcomes,
    phase: "running",
    plan: [],
    refs: { baseTip: "b", headSha: "h" },
    startedIso: "2026-11-10T00:00:00.000Z",
    subject: "o/r#1@h",
  });

describe("runSteps", () => {
  const plan = ["unit-6", "unit.test-unit-merge", "unit.coverage-ratchet", "cli-build"].map((id) => stepNamed({ id }));

  it("cleans the tree as each new CI job starts, keeping the shards' blobs only while the unit job runs", async () => {
    const events: string[] = [];
    const fake = attempts({
      exits: { "cli-build": 0, "unit-6": 0, "unit.coverage-ratchet": 0, "unit.test-unit-merge": 0 },
    });
    await runSteps({
      deps: {
        ...fake.deps,
        cleanTree: ({ keep }) => {
          events.push(`clean[${keep.join(",")}]`);
          return ok(undefined);
        },
        runStep: (run) => {
          events.push(run.step.id);
          return fake.deps.runStep(run);
        },
        writeReceipt: () => undefined,
      },
      env: {},
      logDir: "/l",
      plan,
      receiptOf,
      store: {},
      tree: "/t",
    });
    expect(events).toEqual([
      `clean[${blobs(1, 2, 3, 4, 5)}]`,
      "unit-6",
      `clean[${blobs(1, 2, 3, 4, 5, 6)}]`,
      "unit.test-unit-merge",
      "unit.coverage-ratchet",
      "clean[]",
      "cli-build",
    ]);
  });

  it("stops red at a step whose tree could not be cleaned, the first one included, never running it", async () => {
    const fake = attempts({ exits: {} });
    const outcomes = await runSteps({
      deps: {
        ...fake.deps,
        cleanTree: () => err(LapErrors.refused({ reason: "git clean failed" })),
        writeReceipt: () => undefined,
      },
      env: {},
      logDir: "/l",
      plan,
      receiptOf,
      store: {},
      tree: "/t",
    });
    expect(fake.ran).toEqual([]);
    expect(outcomes.map((outcome) => [outcome.id, outcome.exitCode])).toEqual([["unit-6", 1]]);
  });
});

describe("runWithRetry", () => {
  it("runs a green step once, with no first exit", async () => {
    const fake = attempts({ exits: { "unit-1": 0 } });
    const outcome = await runWithRetry({
      deps: fake.deps,
      env: {},
      logDir: "/l",
      step: stepNamed({ id: "unit-1" }),
      tree: "/t",
    });
    expect(fake.ran).toEqual(["unit-1"]);
    expect(outcome).toEqual({ context: "build", exitCode: 0, id: "unit-1", wallMs: 1000 });
  });

  it("re-runs a red Vitest lane once under its retry id, keeping the step's id and summing the wall time", async () => {
    const fake = attempts({ exits: { "unit-1": 1, "unit-1.retry": 0 } });
    const outcome = await runWithRetry({
      deps: fake.deps,
      env: {},
      logDir: "/l",
      step: stepNamed({ id: "unit-1" }),
      tree: "/t",
    });
    expect(fake.ran).toEqual(["unit-1", "clean[]", "unit-1.retry"]);
    expect(outcome).toEqual({ context: "build", exitCode: 0, firstExit: 1, id: "unit-1", wallMs: 2000 });
    expect(fake.out).toEqual(["lap: unit-1 RED (exit 1) — log /l/unit-1.log; retrying it once, whole"]);
  });

  it("spares a shard's retry only the earlier shards' blobs, never its own or a later one's", async () => {
    const fake = attempts({ exits: { "unit-3": 1, "unit-3.retry": 0 } });
    await runWithRetry({ deps: fake.deps, env: {}, logDir: "/l", step: stepNamed({ id: "unit-3" }), tree: "/t" });
    expect(fake.ran).toEqual(["unit-3", `clean[${blobs(1, 2)}]`, "unit-3.retry"]);
  });

  it("runs the shards in index order, the order a blob's later jobs are read in", () => {
    const shards = lapPlan()
      .map((step) => step.id)
      .filter((id) => /^unit-\d$/u.test(id));
    expect(shards).toEqual(["unit-1", "unit-2", "unit-3", "unit-4", "unit-5", "unit-6"]);
  });

  it("cleans a lane with no artifact back to a fresh checkout before its retry", async () => {
    const fake = attempts({ exits: { integration: 1, "integration.retry": 1 } });
    await runWithRetry({ deps: fake.deps, env: {}, logDir: "/l", step: stepNamed({ id: "integration" }), tree: "/t" });
    expect(fake.ran).toEqual(["integration", "clean[]", "integration.retry"]);
  });

  it("lets the first red stand, unretried, when the tree cannot be cleaned for the retry", async () => {
    const fake = attempts({ exits: { "unit-1": 1 } });
    const outcome = await runWithRetry({
      deps: { ...fake.deps, cleanTree: () => err(LapErrors.refused({ reason: "git clean failed" })) },
      env: {},
      logDir: "/l",
      step: stepNamed({ id: "unit-1" }),
      tree: "/t",
    });
    expect(fake.ran).toEqual(["unit-1"]);
    expect(outcome).toEqual({ context: "build", exitCode: 1, id: "unit-1", wallMs: 1000 });
  });

  it("never retries a step that is not a Vitest lane", async () => {
    const fake = attempts({ exits: { lint: 1 } });
    const outcome = await runWithRetry({
      deps: fake.deps,
      env: {},
      logDir: "/l",
      step: stepNamed({ id: "lint" }),
      tree: "/t",
    });
    expect(fake.ran).toEqual(["lint"]);
    expect(outcome.exitCode).toBe(1);
  });

  it("never retries a lane killed at its ceiling, whose retry would be another hang", async () => {
    const fake = attempts({ exits: { "unit-1": LAP_STEP_TIMEOUT_EXIT } });
    const outcome = await runWithRetry({
      deps: fake.deps,
      env: {},
      logDir: "/l",
      step: stepNamed({ id: "unit-1" }),
      tree: "/t",
    });
    expect(fake.ran).toEqual(["unit-1"]);
    expect(outcome.exitCode).toBe(LAP_STEP_TIMEOUT_EXIT);
  });
});
