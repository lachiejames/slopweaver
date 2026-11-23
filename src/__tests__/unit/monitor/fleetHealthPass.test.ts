/**
 * The fleet-health card through the REAL pass, over a home holding slot attempts: it goes up on news, is held —
 * nothing posted — after the owner's Done when nothing changed, and is re-cut over its own open card when something did.
 *
 * The defect this holds down: ten `mon-health-deaths` notes in one morning, each re-posted because the owner's Done
 * had settled the last, none saying anything new.
 */
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readOpenHandSteps } from "../../../hand/store.js";
import { ok, unwrap } from "../../../lib/result.js";
import { RECIPE_DEFINITION_SCHEMA_VERSION } from "../../../live/automation/definition.js";
import { RECIPE_SLOT_ATTEMPT_SCHEMA_VERSION, type RecipeSlotAttempt } from "../../../live/automation/slotAttempt.js";
import { appendListenerArmEvent } from "../../../live/listen/supervise/store.js";
import { readFleetHealthShown, recordFleetHealthShown } from "../../../monitor/fleetHealthShown.js";
import { type PassOutcome, runMonitorPass } from "../../../monitor/pass.js";
import type { PassAction } from "../../../monitor/passSettle.js";
import { stateHomePaths } from "../../../stateHome.js";
import { memoryPlanHealthPorts } from "../../claudePlanProbesFixture.js";
import { memoryCodexFleetCapPort } from "../../codexFleetCapFixture.js";
import { memoryOrgHealthPort } from "../../orgHealthStoreFixture.js";
import { memoryPagesPublished } from "../../pagesPublishedFixture.js";
import { memoryPlanRegisterPort } from "../../planRegisterFixture.js";
import { NO_FSEVENTSD } from "../../processesFake.js";

/** 09:37 in Melbourne, inside the owner's waking hours. */
const MORNING = "2026-09-29T23:37:00.000Z";

let home = "";

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "fleet-pass-"));
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

/**
 * Write one failed attempt per recipe, and one success, into the home's slot ledger.
 *
 * @param failing the recipes whose run failed
 */
function ledger({ failing }: { failing: readonly string[] }): void {
  const directory = stateHomePaths({ home }).live.recipe.slotAttemptsDir;
  mkdirSync(directory, { recursive: true });
  const attempt = ({ recipeId, failed }: { recipeId: string; failed: boolean }): RecipeSlotAttempt => ({
    attempt: 1,
    holder: "recipe run-due",
    holderPid: null,
    holderToken: "token",
    leaseExpiresIso: "2026-09-29T23:00:00.000Z",
    outcome: failed
      ? {
          detail: "exit 1",
          exitCode: 1,
          kind: "failed",
          retryNotBeforeIso: "2026-09-29T21:00:00.000Z",
          settledAtIso: "2026-09-29T20:00:00.000Z",
        }
      : { exitCode: 0, kind: "succeeded", settledAtIso: "2026-09-29T20:00:00.000Z" },
    recipeId,
    runStartedAtIso: null,
    schemaVersion: RECIPE_SLOT_ATTEMPT_SCHEMA_VERSION,
    slotIso: "2026-09-29T19:00:00.000Z",
    startedAtIso: "2026-09-29T19:00:00.000Z",
  });
  for (const recipeId of failing) {
    writeFileSync(join(directory, `${recipeId}.json`), JSON.stringify(attempt({ failed: true, recipeId })));
  }
  writeFileSync(join(directory, "healthy.json"), JSON.stringify(attempt({ failed: false, recipeId: "healthy" })));
  define({ recipeIds: [...failing, "healthy"] });
}

/**
 * Write a definition for each recipe, so its row still exists — a retired row's attempts are not the fleet's health.
 *
 * @param recipeIds the rows to define
 */
function define({ recipeIds }: { recipeIds: readonly string[] }): void {
  const directory = stateHomePaths({ home }).live.recipe.definitionsDir;
  mkdirSync(directory, { recursive: true });
  for (const recipeId of recipeIds) {
    writeFileSync(
      join(directory, `${recipeId}.json`),
      JSON.stringify({
        cadence: "0 10 * * 1-5",
        destination: { kind: "slack" },
        effect: "read-write",
        kind: "alert-summary",
        params: {},
        recipeId,
        schemaVersion: RECIPE_DEFINITION_SCHEMA_VERSION,
      }),
    );
  }
}

/**
 * One FIRED pass of `fleet-unhealthy` alone, remembering what it posted exactly as `monitor check --fire` does.
 * Unless a case journals one, the home never armed a listener, so this is also the witness that a never-armed install reports no blind spot: a
 * `refused fleet-unhealthy` row here is that defect back.
 *
 * @param nowIso the pass's instant
 * @param openIds the open hand-step ids — `[]` once the owner has pressed Done on the last card
 * @returns the fleet-unhealthy actions, as kind and step id, without the `held` row a pass with no news reports
 */
async function firedPass({
  nowIso,
  openIds,
}: {
  nowIso: string;
  openIds: readonly string[];
}): Promise<readonly string[]> {
  const passed = await runMonitorPass({
    consoleBase: "http://localhost:3000",
    fire: true,
    inputs: {
      claudeProjectsDir: join(home, "claude-projects"),
      fleetCapPort: memoryCodexFleetCapPort(),
      orgHealthPort: memoryOrgHealthPort(),
      pagePublished: memoryPagesPublished(),
      registerPort: memoryPlanRegisterPort(),
      ...memoryPlanHealthPorts(),
      processes: NO_FSEVENTSD,
      home,
      landingPath: undefined,
      nowIso,
      nowMs: Date.parse(nowIso),
      only: "fleet-unhealthy",
    },
    nowIso,
    openIds,
    openWithDecision: new Set(),
    postedBy: "workspace:29",
    postedIds: unwrap(readOpenHandSteps({ home })).postedIds,
    openPage: async () => ok("not opened in this case"),
    raiseNote: () => ok("not drawn in this case"),
  });
  const outcome: PassOutcome = {
    ...passed,
    actions: [...passed.actions, ...recordFleetHealthShown({ home, outcome: passed })],
  };
  return outcome.actions
    .filter((action: PassAction) => action.monitorId === "fleet-unhealthy" && action.kind !== "held")
    .map((action) => `${action.kind} ${action.stepId}: ${action.detail}`);
}

describe("the fleet-health card through the pass", () => {
  it("goes up on news, and is HELD after the owner's Done while the same rows fail", async () => {
    ledger({ failing: ["atlas-hex", "atlas-linear", "resync-corpus-slack"] });
    expect((await firedPass({ nowIso: MORNING, openIds: [] })).map((line) => line.split(":")[0])).toEqual([
      "posted mon-health-syncs",
      "noted mon-health-syncs",
      "noted mon-health-syncs",
    ]);
    expect(await firedPass({ nowIso: MORNING, openIds: ["mon-health-syncs"] })).toEqual([]);
    expect(readFleetHealthShown({ home }).shown!.broken).toEqual(["atlas-hex", "atlas-linear", "resync-corpus-slack"]);
    // The owner pressed Done: the card is settled, so the register holds no open id for it. Nothing changed, so nothing posts.
    expect(await firedPass({ nowIso: "2026-09-29T23:47:00.000Z", openIds: [] })).toEqual([]);
  });

  it("says why it held, on a row the gate and the digest read", async () => {
    ledger({ failing: ["atlas-hex", "atlas-linear", "resync-corpus-slack"] });
    await firedPass({ nowIso: MORNING, openIds: [] });
    const heldPass = await runMonitorPass({
      consoleBase: "http://localhost:3000",
      fire: false,
      inputs: {
        claudeProjectsDir: join(home, "claude-projects"),
        fleetCapPort: memoryCodexFleetCapPort(),
        orgHealthPort: memoryOrgHealthPort(),
        pagePublished: memoryPagesPublished(),
        registerPort: memoryPlanRegisterPort(),
        ...memoryPlanHealthPorts(),
        processes: NO_FSEVENTSD,
        home,
        landingPath: undefined,
        nowIso: MORNING,
        nowMs: Date.parse(MORNING),
        only: "fleet-unhealthy",
      },
      nowIso: MORNING,
      openIds: [],
      openWithDecision: new Set(),
      postedBy: "workspace:29",
      postedIds: [],
      openPage: async () => ok("not opened in this case"),
      raiseNote: () => ok("not drawn in this case"),
    });
    const held = heldPass.actions.filter((action) => action.kind === "held");
    expect(held).toEqual([
      {
        detail: "nothing changed since the note at 23:37Z — the same rows are failing",
        kind: "held",
        monitorId: "fleet-unhealthy",
        stepId: "fleet-unhealthy",
      },
    ]);
  });

  it("re-cuts the card over its own open one when a row newly fails, past the spacing", async () => {
    ledger({ failing: ["atlas-hex", "atlas-linear", "resync-corpus-slack"] });
    await firedPass({ nowIso: MORNING, openIds: [] });
    ledger({ failing: ["atlas-hex", "atlas-linear", "resync-corpus-slack", "atlas-notion"] });
    // Inside the spacing the open card stands and nothing posts.
    expect(await firedPass({ nowIso: "2026-09-29T23:50:00.000Z", openIds: ["mon-health-syncs"] })).toEqual([]);
    const recut = await firedPass({ nowIso: "2026-09-30T00:10:00.000Z", openIds: ["mon-health-syncs"] });
    expect(recut.map((line) => line.split(":")[0])).toEqual([
      "posted mon-health-syncs.2",
      "noted mon-health-syncs.2",
      "settled mon-health-syncs",
      "noted mon-health-syncs.2",
    ]);
    expect(recut.at(-1)).toBe(
      "noted mon-health-syncs.2: remembered 4 failing row(s) as shown, so the next note says what changed",
    );
  });

  it("refuses over a listener that armed and was cleared before its first beat, whose files both read absent", async () => {
    // Only the journal says this listener armed; excusing it as never armed would hide its outage.
    ledger({ failing: ["atlas-hex", "atlas-linear", "resync-corpus-slack"] });
    const at = "2026-09-29T22:00:00.000Z";
    appendListenerArmEvent({ event: { armId: "arm-1", atIso: at, kind: "armed", pid: 4242 }, home });
    appendListenerArmEvent({
      event: { armId: "arm-1", atIso: at, kind: "died", pid: 4242, reason: "heartbeat-missing" },
      home,
    });
    expect(await firedPass({ nowIso: MORNING, openIds: [] })).toEqual([
      "posted mon-health-syncs: Check fleet health — 3 scheduled jobs newly failing",
      "noted mon-health-syncs: not drawn in this case",
      "refused fleet-unhealthy: the listener could not be judged: no listener heartbeat has ever been written on this install",
      "noted mon-health-syncs: remembered 3 failing row(s) as shown, so the next note says what changed",
    ]);
  });

  it("refuses over an arm record that is a dangling symlink, which a followed stat would read as absent", async () => {
    // Something stands at arm.json, so this is not an install that never armed.
    ledger({ failing: ["atlas-hex", "atlas-linear", "resync-corpus-slack"] });
    const arm = stateHomePaths({ home }).live.listener.armJson;
    mkdirSync(dirname(arm), { recursive: true });
    symlinkSync(join(home, "no-such-arm-target"), arm);
    expect(await firedPass({ nowIso: MORNING, openIds: [] })).toEqual([
      "posted mon-health-syncs: Check fleet health — 3 scheduled jobs newly failing",
      "noted mon-health-syncs: not drawn in this case",
      "refused fleet-unhealthy: the listener could not be judged: no listener heartbeat has ever been written on this install",
      "noted mon-health-syncs: remembered 3 failing row(s) as shown, so the next note says what changed",
    ]);
  });

  it.each([
    ["a torn armed event, which the event reader would drop", '{"armId":"arm-1","kind":"armed","pid":\n'],
    ["a lone byte-order mark, which trimming would drop", "﻿\n"],
  ])("refuses over a journal holding only %s", async (_shape, bytes) => {
    // Decoded or trimmed, these journals are empty; any byte is a writer's witness.
    ledger({ failing: ["atlas-hex", "atlas-linear", "resync-corpus-slack"] });
    const journal = stateHomePaths({ home }).live.listener.armsJsonl;
    mkdirSync(dirname(journal), { recursive: true });
    writeFileSync(journal, bytes);
    expect(await firedPass({ nowIso: MORNING, openIds: [] })).toEqual([
      "posted mon-health-syncs: Check fleet health — 3 scheduled jobs newly failing",
      "noted mon-health-syncs: not drawn in this case",
      "refused fleet-unhealthy: the listener could not be judged: no listener heartbeat has ever been written on this install",
      "noted mon-health-syncs: remembered 3 failing row(s) as shown, so the next note says what changed",
    ]);
  });
});
