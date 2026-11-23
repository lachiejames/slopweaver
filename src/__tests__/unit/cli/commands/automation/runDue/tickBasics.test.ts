/**
 * `slopweaver automation run-due` over a throwaway home — the executor the owner asked for,
 * exercised end to end with the real definition store, the real due judgement and the real plan.
 *
 * This file holds the tick itself: an empty store, a never-run row, the stamp, an owed finding, a hold, a dry
 * run, a failed verb, a refused or rejected row, a row that throws, and `--help`. The recording edges are
 * `./harness.ts`'s, and why none of them is a mock is said there.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { RecipeRunDueDeps } from "../../../../../../cli/commands/automation/rowRunners.js";
import { unwrap } from "../../../../../../lib/result.js";
import { readRecipeDefinitionRuns } from "../../../../../../live/automation/definitionRunStore.js";
import { failureFindingSlug } from "../../../../../../live/automation/failureHold.js";
import { recordFindingDebt } from "../../../../../../live/automation/findingDebt.js";
import { beginSlotAttempt, readSlotAttempt } from "../../../../../../live/automation/slotLedger.js";
import { settleSlotAttempt } from "../../../../../../live/automation/slotSettlement.js";
import { stateHomePaths } from "../../../../../../stateHome.js";
import { runDueUnderFake } from "../../../../../runDueSignalFake.js";
import { alertRow, argvFor, row } from "./fixtures.js";
import { deps, homeWith, removeHomes } from "./harness.js";

afterEach(() => {
  removeHomes();
});

describe("recipe run-due", () => {
  it("says so and exits clean when the store holds nothing", async () => {
    const home = homeWith({ rows: [] });
    const injected = deps();
    const code = await runDueUnderFake({ argv: argvFor({ home }), deps: injected });
    expect(code).toBe(0);
    expect(injected.out.at(-1)).toContain("no definitions in");
    expect(injected.dispatched).toEqual([]);
  });

  it("runs a never-run row and hands the dispatcher the argv the row named", async () => {
    const home = homeWith({ rows: [row()] });
    const injected = deps();
    const code = await runDueUnderFake({ argv: argvFor({ home }), deps: injected });
    expect(code).toBe(0);
    expect(injected.dispatched).toEqual([["node", "slopweaver", "atlas", "freshness", "--behind-only"]]);
    expect(injected.out).toContain(
      "recipe atlas-rolling-window · DUE · has never run · covers slot 2026-09-08T12:00:00.000Z",
    );
  });

  it("stamps the run, so the same row is not due again on the next tick", async () => {
    const home = homeWith({ rows: [row()] });
    await runDueUnderFake({ argv: argvFor({ home }), deps: deps() });
    const runs = unwrap(readRecipeDefinitionRuns({ path: join(home, "live", "recipe", "definition-runs.json") }));
    expect(runs["atlas-rolling-window"]).toEqual({
      exitCode: 0,
      firstSucceededIso: "2026-09-08T12:05:00.000Z",
      lastRunAtIso: "2026-09-08T12:05:00.000Z",
      watermarkIso: "2026-09-08T12:00:00.000Z",
    });

    const second = deps();
    await runDueUnderFake({ argv: argvFor({ home }), deps: second });
    expect(second.dispatched).toEqual([]);
    expect(second.out.at(-1)).toBe("automation run-due · every row is inside its cadence — nothing to run");
  });

  it("retries a finding an earlier failure owes, and fails the tick while it is still not on the board", async () => {
    const home = homeWith({ rows: [] });
    const finding = "recipe-failing-vanta-a1";
    const argv = ["--slug", finding, "--home", home];
    recordFindingDebt({ debt: { argv, finding, recipeId: "vanta", recordedIso: "2026-09-08T11:00:00.000Z" }, home });
    const injected = deps({ registerWritesRow: false });

    const code = await runDueUnderFake({ argv: argvFor({ home }), deps: injected });

    expect(code).toBe(1);
    expect(injected.registered).toEqual([argv]);
    expect(injected.out).toContain(
      `recipe vanta · owed finding ${finding} still could not be registered (handover register exited 0 and still ` +
        "no row by that slug is on the board) — the next run-due retries it",
    );
  });

  it("still retries an owed finding when the runs ledger will not read, and fails the tick", async () => {
    const home = homeWith({ rows: [] });
    writeFileSync(stateHomePaths({ home }).live.recipe.definitionRunsJson, "{", "utf8");
    const finding = "recipe-failing-vanta-a1";
    const argv = ["--slug", finding, "--home", home];
    recordFindingDebt({ debt: { argv, finding, recipeId: "vanta", recordedIso: "2026-09-08T11:00:00.000Z" }, home });
    const injected = deps({ registerWritesRow: true });

    const code = await runDueUnderFake({ argv: argvFor({ home }), deps: injected });

    expect(code).toBe(1);
    expect(injected.registered).toEqual([argv]);
    expect(injected.out).toContain(`recipe vanta · owed finding ${finding} registered on retry`);
  });

  it("fails a tick NAMED for another row on a failure lost beneath the owner's hold — the scan reads the whole roster", async () => {
    const held = row({
      hold: { askedIso: "2026-09-08T11:00:00.000Z", clearedBy: null, reason: "paused while they look" },
      recipeId: "vanta-sync",
    });
    const home = homeWith({ rows: [held, row()] });
    const slotIso = "2026-09-08T10:00:00.000Z";
    const take = { holderPid: null, holderToken: "tok", home, recipeId: "vanta-sync", slotIso } as const;
    unwrap(
      beginSlotAttempt({
        ...take,
        holder: "recipe run-due",
        leaseExpiresIso: "2026-09-09T00:00:00.000Z",
        nowIso: slotIso,
        processAlive: () => true,
      }),
    );
    const settledAtIso = "2026-09-08T11:30:00.000Z";
    const outcome = { detail: "exit 1", kind: "dead", reason: "ATTEMPTS_EXHAUSTED", settledAtIso } as const;
    unwrap(settleSlotAttempt({ ...take, nowIso: settledAtIso, outcome }));
    const injected = deps();

    const code = await runDueUnderFake({
      argv: argvFor({ home, tail: ["--recipe", "atlas-rolling-window"] }),
      deps: injected,
    });

    const finding = failureFindingSlug({ attempt: 1, recipeId: "vanta-sync", slotIso });
    expect(code).toBe(1);
    expect(injected.out).toContain(
      `recipe vanta-sync · slot ${slotIso} attempt 1 failed beneath the owner's hold, and its finding ${finding} is on ` +
        `no board row and owed no retry — register a row by that slug by hand (slopweaver handover register ${finding} …)`,
    );
  });

  it("plans without dispatching under --dry-run, and stamps nothing", async () => {
    const home = homeWith({ rows: [row()] });
    const injected = deps();
    const code = await runDueUnderFake({ argv: argvFor({ home, tail: ["--dry-run"] }), deps: injected });
    expect(code).toBe(0);
    expect(injected.dispatched).toEqual([]);
    expect(injected.out).toContain(
      "recipe atlas-rolling-window · would run · slopweaver atlas freshness --behind-only",
    );
    const runs = unwrap(readRecipeDefinitionRuns({ path: join(home, "live", "recipe", "definition-runs.json") }));
    expect(runs).toEqual({});
  });

  // A failed firing is picked up again and retried in a way that causes no further problem. Stamping a
  // non-zero exit would lose the firing — measured on a throwaway home, a row whose verb exited 1 was stamped
  // `{exitCode: 1, watermarkIso: …}` and read `current` immediately. So the watermark does not move, so the row is judged due for the SAME
  // firing again, and the cadence abandons it at its own next firing with no field expressing that.
  it("does NOT stamp a verb that exited non-zero, so the same firing is picked up again", async () => {
    const home = homeWith({ rows: [row()] });
    const injected = deps({ exitCode: 1 });
    const code = await runDueUnderFake({ argv: argvFor({ home }), deps: injected });
    expect(code).toBe(1);
    const runs = unwrap(readRecipeDefinitionRuns({ path: join(home, "live", "recipe", "definition-runs.json") }));
    expect(runs["atlas-rolling-window"]).toBe(undefined);
  });

  it("records the failed attempt on the firing's own record, so the retry is counted rather than blind", async () => {
    const home = homeWith({ rows: [row()] });
    const code = await runDueUnderFake({ argv: argvFor({ home }), deps: deps({ exitCode: 1 }) });
    expect(code).toBe(1);
    const held = unwrap(
      readSlotAttempt({ home, recipeId: "atlas-rolling-window", slotIso: "2026-09-08T12:00:00.000Z" }),
    );
    expect(held!.attempt).toBe(1);
    expect(held!.outcome!.kind).toBe("failed");
  });

  it("refuses a row whose declared effect is narrower than the verb it selects, without dispatching", async () => {
    const home = homeWith({ rows: [row({ params: { argv: ["slack", "post"] } })] });
    const injected = deps();
    const code = await runDueUnderFake({ argv: argvFor({ home }), deps: injected });
    expect(code).toBe(1);
    expect(injected.dispatched).toEqual([]);
    expect(injected.out.some((line) => line.includes("REFUSED") && line.includes("never less"))).toBe(true);
  });

  it("rejects a row naming a kind this build does not register, dispatching nothing for it", async () => {
    const home = homeWith({
      rows: [row({ destination: { kind: "datadog-push" }, effect: "read", kind: "no-such-kind", params: {} })],
    });
    const injected = deps();
    const code = await runDueUnderFake({ argv: argvFor({ home }), deps: injected });
    expect(code).toBe(1);
    expect(injected.dispatched).toEqual([]);
    expect(injected.diag.some((line) => line.includes("REJECTED") && line.includes("no-such-kind"))).toBe(true);
  });

  it("keeps running the other rows when one file is not a definition at all", async () => {
    const home = homeWith({ rows: [row(), { recipeId: "broken" }] });
    const injected = deps();
    const code = await runDueUnderFake({ argv: argvFor({ home }), deps: injected });
    expect(code).toBe(1);
    expect(injected.dispatched).toEqual([["node", "slopweaver", "atlas", "freshness", "--behind-only"]]);
    expect(injected.diag.some((line) => line.includes("REJECTED"))).toBe(true);
  });

  it("keeps running the other rows when one row THROWS rather than returning an exit code", async () => {
    const home = homeWith({ rows: [alertRow(), row()] });
    const injected = deps();
    const thrower: RecipeRunDueDeps = {
      ...injected,
      runAlertSummaryRead: () => Promise.reject(new Error("slack client blew up")),
    };
    const code = await runDueUnderFake({ argv: argvFor({ home }), deps: thrower });
    expect(code).toBe(1);
    expect(injected.out.some((line) => line.includes("knock-alerts · THREW · slack client blew up"))).toBe(true);
    expect(injected.dispatched).toEqual([["node", "slopweaver", "atlas", "freshness", "--behind-only"]]);
  });

  it("prints its usage and exits clean on --help", async () => {
    const injected = deps();
    const code = await runDueUnderFake({ argv: ["node", "slopweaver", "recipe", "run-due", "--help"], deps: injected });
    expect(code).toBe(0);
    expect(injected.out[0]).toContain("usage: slopweaver automation run-due");
  });
});
