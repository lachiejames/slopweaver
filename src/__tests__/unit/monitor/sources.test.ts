/*
 * The pass reads exactly the declared monitors, in the registry's order — or only the one `--only` names. A parked
 * run is not one of them: each is already a shaped ask on the owner's queue, and fanning it into a hand note would post
 * a card per run.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type CodexFleetCapPort, fileCodexFleetCapRecord } from "../../../codex/fleetCapPort.js";
import { unwrap } from "../../../lib/result.js";
import { appendRepairTake } from "../../../live/automation/repairTake.js";
import type { SilentRow } from "../../../live/automation/silentRows.js";
import { evaluateRecipeRepairing, evaluateRecipeStopped } from "../../../monitor/evaluateStopped.js";
import { MONITORS } from "../../../monitor/registry.js";
import { readAllMonitors } from "../../../monitor/sources.js";
import { mergeHeldStops, readRepairs } from "../../../monitor/stoppedSource.js";
import type { MonitorReading } from "../../../monitor/types.js";
import { stateHomePaths } from "../../../stateHome.js";
import { memoryPlanHealthPorts } from "../../claudePlanProbesFixture.js";
import { memoryCodexFleetCapPort, unavailableCodexFleetCapPort } from "../../codexFleetCapFixture.js";
import { memoryOrgHealthPort } from "../../orgHealthStoreFixture.js";
import { memoryPagesPublished } from "../../pagesPublishedFixture.js";
import { memoryPlanRegisterPort } from "../../planRegisterFixture.js";
import { NO_FSEVENTSD } from "../../processesFake.js";

import { firing, unmeasurable } from "./readings.js";

const NOW_ISO = "2026-09-27T02:00:00.000Z";

let home = "";

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "monitor-sources-"));
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

/** Every monitor read over the home. */
function readAll({
  fleetCapPort = memoryCodexFleetCapPort(),
}: {
  fleetCapPort?: CodexFleetCapPort;
} = {}): Promise<readonly MonitorReading[]> {
  return readAllMonitors({
    inputs: {
      claudeProjectsDir: join(home, "claude-projects"),
      fleetCapPort,
      orgHealthPort: memoryOrgHealthPort(),
      pagePublished: memoryPagesPublished(),
      registerPort: memoryPlanRegisterPort(),
      ...memoryPlanHealthPorts(),
      processes: NO_FSEVENTSD,
      home,
      landingPath: undefined,
      nowIso: NOW_ISO,
      nowMs: Date.parse(NOW_ISO),
    },
  });
}

describe("readAllMonitors", () => {
  it("reads only the monitor --only names, and answers it unmeasurable on a home with no capacity reading", async () => {
    const readings = await readAllMonitors({
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
        nowIso: NOW_ISO,
        nowMs: Date.parse(NOW_ISO),
        only: "fleet-runs-dry",
      },
    });
    expect(readings).toEqual([
      {
        because:
          "no machine capacity reading could be read: the readings ledger holds no reading by `machine capacity` yet — record one with `slopweaver reading record`",
        monitorId: "fleet-runs-dry",
        state: "unmeasurable",
      },
    ]);
  });

  it("reads every declared monitor, in the registry's own order, and no other", async () => {
    const readings = await readAll();

    expect(readings.map((reading) => reading.monitorId)).toEqual([
      "automation-held-on-you",
      "recipe-stopped",
      "recipe-repairing",
      "corpus-sync-stopped",
      "codex-plan-signed-out",
      "claude-plan-unusable",
      "secret-absent",
      "turn-signed-out",
      "resync-signed-out",
      "publication-leak",
      "codex-fleet-capped",
      "codex-reset-failed",
      "prs-backed-up",
      "bot-off-the-air",
      "chair-off-fable",
      "fseventsd-bloated",
      "store-rehearsal-failed",
      "fleet-runs-dry",
      "host-week-runs-out",
      "fleet-unhealthy",
      "console-sync-failed",
      "org-health",
      "profile-unloaded",
      "steer-at-risk",
      "meeting-prep-due",
    ]);
    expect(readings.map((reading) => reading.monitorId)).toEqual(MONITORS.map((monitor) => monitor.id));
  });

  it("reads a Codex store with no auth.json off disk as a plan to sign back in, and a signed-in one as clear", async () => {
    const codexHome = join(home, "codex");
    mkdirSync(codexHome);
    // A plan comes only from the register, so the store is registered explicitly rather than discovered.
    const plansJson = stateHomePaths({ home }).plansJson;
    mkdirSync(dirname(plansJson), { recursive: true });
    writeFileSync(
      plansJson,
      JSON.stringify({ rows: [{ alias: "codex-a", provider: "codex", storeDir: codexHome }], version: 1 }),
      "utf8",
    );
    const codexReading = async (): Promise<MonitorReading> =>
      (await readAll()).find((reading) => reading.monitorId === "codex-plan-signed-out")!;
    const signedOut = firing({ reading: await codexReading() });
    writeFileSync(join(codexHome, "auth.json"), JSON.stringify({ tokens: { id: "stand-in" } }));
    expect([signedOut.subjects.map((subject) => subject.label), (await codexReading()).state]).toEqual([
      ["no auth.json is in its store"],
      "clear",
    ]);
  });

  it("reads the fleet record a Codex read filed in the store, and is unmeasurable before one has", async () => {
    const fleetCapPort = memoryCodexFleetCapPort();
    const capped = async (): Promise<MonitorReading> =>
      (await readAll({ fleetCapPort })).find((reading) => reading.monitorId === "codex-fleet-capped")!;
    const before = (await capped()).state;
    await fileCodexFleetCapRecord({
      home,
      port: fleetCapPort,
      record: {
        readAtIso: "2026-09-18T00:00:00.000Z",
        rows: [{ alias: "codex-one", resetAtIso: "2026-10-03T17:09:58.000Z", state: "near-cap" }],
      },
    });
    expect([before, firing({ reading: await capped() }).subjects.map((subject) => subject.key)]).toEqual([
      "unmeasurable",
      ["until-2026-10-03t1710"],
    ]);
  });

  it("reads a fleet record store it cannot reach as unmeasurable, naming the outage", async () => {
    const reading = (await readAll({ fleetCapPort: unavailableCodexFleetCapPort() })).find(
      (candidate) => candidate.monitorId === "codex-fleet-capped",
    )!;
    expect(unmeasurable({ reading }).because).toBe(
      "the Codex fleet record in the store is unreadable: the store could not open the Codex fleet-cap record: " +
        "connect ECONNREFUSED 127.0.0.1:54322 (a fixture outage)",
    );
  });
});

describe("readAllMonitors — secret-absent", () => {
  /** The one reading `--only secret-absent` answers over the home. */
  async function secretReading(): Promise<MonitorReading> {
    const [reading] = await readAllMonitors({
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
        nowIso: NOW_ISO,
        nowMs: Date.parse(NOW_ISO),
        only: "secret-absent",
      },
    });
    return reading!;
  }

  it("reads a home with no secrets directory as clear — an install that connected nothing", async () => {
    expect(await secretReading()).toEqual({ monitorId: "secret-absent", state: "clear" });
  });

  it("is unmeasurable, never clear, when the secrets path cannot be listed", async () => {
    writeFileSync(stateHomePaths({ home }).secrets, "not a directory");
    const reading = unmeasurable({ reading: await secretReading() });
    expect(reading.because).toContain("the secrets store could not be listed: could not list the secrets store at");
    expect(reading.because).toContain("ENOTDIR");
  });

  it("fires on the admin client pair when the user-data Google pair is stored and it is not", async () => {
    const dir = stateHomePaths({ home }).secrets;
    mkdirSync(dir);
    writeFileSync(join(dir, "google-client-id"), "id");
    writeFileSync(join(dir, "google-client-secret"), "secret");
    expect(firing({ reading: await secretReading() }).subjects.map((subject) => subject.id)).toEqual([
      "google-admin-client-id",
      "google-admin-client-secret",
    ]);
  });
});

describe("readRepairs", () => {
  /** A ready doc for `row`, with its run started — a seat working it. */
  function liveRow({ row }: { row: string }): void {
    const paths = stateHomePaths({ home });
    mkdirSync(paths.handovers, { recursive: true });
    mkdirSync(paths.runs, { recursive: true });
    writeFileSync(join(paths.handovers, `${row}.md`), `---\nslug: ${row}\nstatus: ready\n---\n# repair\n`);
    writeFileSync(
      join(paths.runs, `${row}.jsonl`),
      `${JSON.stringify({ atIso: NOW_ISO, branch: "b", docHash: "h", kind: "started" })}\n`,
    );
  }

  it("names the live row repairing each stopped recipe, and reads no take for a recipe that is not stopped", () => {
    liveRow({ row: "fix-a" });
    unwrap(appendRepairTake({ home, take: { recipeId: "a", row: "fix-a", takenIso: NOW_ISO } }));
    unwrap(appendRepairTake({ home, take: { recipeId: "b", row: "no-such-row", takenIso: NOW_ISO } }));

    const reading = readRepairs({ home, stopped: new Set(["a"]) });

    expect([[...reading.taken], reading.problem]).toEqual([[["a", "fix-a"]], undefined]);
  });

  it("keeps every take that reads, and names the register line that did not", () => {
    liveRow({ row: "fix-a" });
    const path = stateHomePaths({ home }).live.recipe.repairsJsonl;
    unwrap(appendRepairTake({ home, take: { recipeId: "a", row: "fix-a", takenIso: NOW_ISO } }));
    writeFileSync(path, "{ not json\n", { flag: "a" });

    const reading = readRepairs({ home, stopped: new Set(["a"]) });

    expect([[...reading.taken], reading.problem]).toEqual([
      [["a", "fix-a"]],
      "repairs register line(s) 2 did not read",
    ]);
  });
});

describe("mergeHeldStops", () => {
  const TAKEN = "2026-09-27T01:13:20.286Z";

  /** A stopped row, with the seat holding its current firing when `holder` is given. */
  function stopped({ recipeId, holder }: { recipeId: string; holder?: string }): SilentRow {
    return {
      cadence: "15 8 * * *",
      currentSlotHold: holder === undefined ? null : { holder, startedAtIso: TAKEN },
      detail: "1 slot(s) went by unrun",
      lastRunAtIso: "2026-09-25T16:57:21.433Z",
      missedSlots: 1,
      reason: "MISSED",
      recipeId,
    };
  }

  it("owns a held row by its holder and the instant it took the firing, and leaves an unheld row nobody's", () => {
    const merged = mergeHeldStops({
      repairTaken: new Map(),
      repairTakenIso: new Map(),
      rows: [
        stopped({ holder: "automations-seat-40cae177", recipeId: "bump-fix-slopweaver" }),
        stopped({ recipeId: "b" }),
      ],
    });

    expect([[...merged.taken], [...merged.takenIso]]).toEqual([
      [["bump-fix-slopweaver", "automations-seat-40cae177"]],
      [["bump-fix-slopweaver", TAKEN]],
    ]);
  });

  it("lets a repair take win as a pair — its row and its instant — over the seat holding the firing", () => {
    const merged = mergeHeldStops({
      repairTaken: new Map([["a", "fix-a"]]),
      repairTakenIso: new Map([["a", NOW_ISO]]),
      rows: [stopped({ holder: "automations-seat-x", recipeId: "a" })],
    });

    expect([[...merged.taken], [...merged.takenIso]]).toEqual([[["a", "fix-a"]], [["a", NOW_ISO]]]);
  });

  it("owns no recipe id one of whose stopped definitions nobody holds — a held duplicate never silences it", () => {
    const rows = [stopped({ holder: "seat-a", recipeId: "dup" }), stopped({ recipeId: "dup" })];
    const merged = mergeHeldStops({ repairTaken: new Map(), repairTakenIso: new Map(), rows });

    expect([[...merged.taken], evaluateRecipeStopped({ rows, taken: merged.taken }).state]).toEqual([[], "firing"]);
  });

  it("THE 14 OCT CASE — a stop a seat is running is no card and no repair set, and its notice names the seat", () => {
    const rows = [
      stopped({ holder: "automations-seat-40cae177", recipeId: "bump-fix-slopweaver" }),
      stopped({ holder: "automations-seat-b41b8c85", recipeId: "slack-owed-daily" }),
    ];
    const owners = mergeHeldStops({ repairTaken: new Map(), repairTakenIso: new Map(), rows });

    const stoppedReading = evaluateRecipeStopped({ rows, taken: owners.taken });
    const repairing = firing({ reading: evaluateRecipeRepairing({ rows, ...owners }) });

    expect([stoppedReading.state, repairing.subjects.map((subject) => subject.label)]).toEqual([
      "steered",
      ["bump-fix-slopweaver → seat automations-seat-40cae177; slack-owed-daily → seat automations-seat-b41b8c85"],
    ]);
  });
});
