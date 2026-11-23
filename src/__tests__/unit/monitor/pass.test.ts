import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { acquireOperationLock } from "../../../admit/operationLock.js";
import type { HandStep } from "../../../hand/step.js";
import { appendHandRow, readOpenHandSteps } from "../../../hand/store.js";
import { err, ok, unwrap } from "../../../lib/result.js";
import { appendRepairTake } from "../../../live/automation/repairTake.js";
import { RECIPE_STEERS } from "../../../live/automation/steers.js";
import { bootModelForWorkspace } from "../../../monitor/chairOffFableSource.js";
import { openIdsForMonitor } from "../../../monitor/openCards.js";
import { type NoteRaiser, type PageOpener, readingShapeRefusal, runMonitorPass } from "../../../monitor/pass.js";
import { heldWhileFiring, lapsedSettlements, type PassAction } from "../../../monitor/passSettle.js";
import { MONITORS, monitorDefinition } from "../../../monitor/registry.js";
import { projectLandingRows } from "../../../monitor/sources.js";
import type { MonitorSubject } from "../../../monitor/types.js";
import { stateHomePaths } from "../../../stateHome.js";
import { memoryPlanHealthPorts } from "../../claudePlanProbesFixture.js";
import { memoryCodexFleetCapPort } from "../../codexFleetCapFixture.js";
import { memoryOrgHealthPort } from "../../orgHealthStoreFixture.js";
import { memoryPagesPublished } from "../../pagesPublishedFixture.js";
import { memoryPlanRegisterPort } from "../../planRegisterFixture.js";
import { NO_FSEVENTSD } from "../../processesFake.js";
import { dailyRow, stampRecipeRuns, writeRecipeDefinitions } from "../live/automation/recipeHome.js";

const NOW_ISO = "2026-09-19T06:00:00.000Z";
const NOW_MS = Date.parse(NOW_ISO);

/** The console origin `yarn console` binds, which every card posted here opens itself on unless a case says. */
const CONSOLE_BASE = "http://localhost:3000";

let home = "";
let landingPath = "";

/** A raiser for the cases that are not about the note: it draws nothing and says so. */
const quietRaiser: NoteRaiser = () => ok("not drawn in this case");

/** An opener for the cases that are not about a page: no card they post carries one. */
const quietOpener: PageOpener = async () => ok("not opened in this case");

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "monpass-"));
  landingPath = join(home, "landing.json");
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

/** One `github landing --json` document holding a single row waiting on a code owner. */
function landingDocument({ number = 891, action = "blocked-on" }: { number?: number; action?: string } = {}): string {
  return JSON.stringify({
    rows: [
      {
        action,
        blockedOn: ["@acme/platform"],
        number,
        queue: { kind: "not-queued" },
        repoSlug: "lachiejames/slopweaver",
        title: "A step only the owner's hands can take reaches the owner where the owner is looking",
      },
    ],
  });
}

/**
 * Run one pass over a home holding only the landing document — every other source is genuinely absent.
 *
 * A home with no supervisor pin makes `chair-off-fable` fire as well, which is correct behaviour and not
 * this file's subject, so {@link prsSteps} and the filters below scope each assertion to the one monitor
 * under test rather than pretending the other three answered nothing.
 */
async function pass({
  fire,
  openIds = [],
  stillHeld = () => true,
}: {
  fire: boolean;
  openIds?: readonly string[];
  stillHeld?: () => boolean;
}): Promise<readonly PassAction[]> {
  const outcome = await runMonitorPass({
    consoleBase: CONSOLE_BASE,
    fire,
    inputs: {
      claudeProjectsDir: join(home, "claude-projects"),
      fleetCapPort: memoryCodexFleetCapPort(),
      orgHealthPort: memoryOrgHealthPort(),
      pagePublished: memoryPagesPublished(),
      registerPort: memoryPlanRegisterPort(),
      ...memoryPlanHealthPorts(),
      processes: NO_FSEVENTSD,
      home,
      landingPath,
      nowIso: NOW_ISO,
      nowMs: NOW_MS,
    },
    nowIso: NOW_ISO,
    openIds,
    openWithDecision: new Set(),
    openPage: quietOpener,
    postedBy: "workspace:29",
    postedIds: unwrap(readOpenHandSteps({ home })).postedIds,
    raiseNote: quietRaiser,
    stillHeld,
  });
  return outcome.actions.filter((action) => action.monitorId === "prs-backed-up");
}

/** The open steps `prs-backed-up` owns, by its own step prefix. */
function openPrsSteps(): readonly HandStep[] {
  return unwrap(readOpenHandSteps({ home })).steps.filter((step) => step.id.startsWith("mon-prs-"));
}

/** Those steps' sentences, which is what most assertions here are actually about. */
function prsSteps(): readonly string[] {
  return openPrsSteps().map((step) => step.what);
}

describe("openIdsForMonitor", () => {
  it("selects only the ids this monitor owns, so a settle cannot reach another's step", () => {
    const owned = openIdsForMonitor({
      openIds: ["mon-prs-a", "mon-bot-b", "mon-prs-c", "gcloud-signin"],
      prefix: "prs",
    });
    expect([...owned].toSorted()).toEqual(["mon-prs-a", "mon-prs-c"]);
  });

  it("does not match a monitor whose prefix is a prefix of another's", () => {
    expect([...openIdsForMonitor({ openIds: ["mon-prsx-a"], prefix: "prs" })]).toEqual([]);
  });
});

describe("projectLandingRows", () => {
  it("projects every row onto the fields the condition turns on", () => {
    const projected = projectLandingRows({ document: JSON.parse(landingDocument()) });
    expect(projected).toEqual({
      rows: [
        {
          action: "blocked-on",
          blockedOn: ["@acme/platform"],
          ciRed: false,
          number: 891,
          queueKind: "not-queued",
          repoSlug: "lachiejames/slopweaver",
          title: "A step only the owner's hands can take reaches the owner where the owner is looking",
        },
      ],
    });
  });

  it("says why rather than reporting an empty set when the document is not an object", () => {
    expect(projectLandingRows({ document: [] })).toEqual({ because: "the landing document is not a JSON object" });
  });

  it("says why when the document carries no rows array", () => {
    expect(projectLandingRows({ document: { tally: { ready: 0 } } })).toEqual({
      because: "the landing document has no `rows` array",
    });
  });

  it("names the row when a field the condition needs has gone", () => {
    const projected = projectLandingRows({
      document: { rows: [{ number: 891, repoSlug: "lachiejames/slopweaver", title: "t" }] },
    });
    expect(projected).toEqual({ because: "landing row lachiejames/slopweaver#891 has no `action`" });
  });

  it("names the row when the queue state has gone", () => {
    const projected = projectLandingRows({
      document: { rows: [{ action: "blocked-on", number: 891, repoSlug: "lachiejames/slopweaver", title: "t" }] },
    });
    expect(projected).toEqual({ because: "landing row lachiejames/slopweaver#891 has no `queue.kind`" });
  });

  it("projects a failed ci-green test as red", () => {
    const document = {
      rows: [
        {
          action: "blocked-on",
          number: 893,
          queue: { kind: "not-queued" },
          repoSlug: "acme/acme-admin",
          tests: [
            { id: "undrafted", verdict: "pass", why: "it is not a draft" },
            { id: "ci-green", verdict: "fail", why: "94/95 passed, 1 failed, 0 pending" },
          ],
          title: "a red code-owner wait",
        },
      ],
    };
    const projected = projectLandingRows({ document });
    expect(projected).toEqual({
      rows: [
        {
          action: "blocked-on",
          blockedOn: [],
          ciRed: true,
          number: 893,
          queueKind: "not-queued",
          repoSlug: "acme/acme-admin",
          title: "a red code-owner wait",
        },
      ],
    });
  });

  it("projects an advisory-only red as red though its ci-green PASSED, which keeps it off the owner's screen", () => {
    const document = {
      rows: [
        {
          action: "blocked-on",
          ciFailure: { kind: "red", required: false },
          number: 894,
          queue: { kind: "not-queued" },
          repoSlug: "acme/acme-admin",
          tests: [{ id: "ci-green", verdict: "pass", why: "every context staging requires passed" }],
          title: "an advisory-only red waiting on a code owner",
        },
      ],
    };
    const projected = projectLandingRows({ document });
    expect(projected).toEqual({
      rows: [
        {
          action: "blocked-on",
          blockedOn: [],
          ciRed: true,
          number: 894,
          queueKind: "not-queued",
          repoSlug: "acme/acme-admin",
          title: "an advisory-only red waiting on a code owner",
        },
      ],
    });
  });

  it("reads a missing blockedOn as nobody rather than as a broken row", () => {
    const projected = projectLandingRows({
      document: {
        rows: [
          { action: "press", number: 892, queue: { kind: "queued" }, repoSlug: "lachiejames/slopweaver", title: "t" },
        ],
      },
    });
    expect(projected).toEqual({
      rows: [
        {
          action: "press",
          blockedOn: [],
          ciRed: false,
          number: 892,
          queueKind: "queued",
          repoSlug: "lachiejames/slopweaver",
          title: "t",
        },
      ],
    });
  });
});

describe("bootModelForWorkspace", () => {
  const spawned = ({ ref, model }: { ref: string; model: string }): string =>
    JSON.stringify({ bootModel: { kind: "pinned", model }, kind: "spawned", workspaceRef: ref });

  it("reports the model the last spawned row named for that workspace", () => {
    const logText = [
      spawned({ model: "opus", ref: "workspace:29" }),
      spawned({ model: "sonnet", ref: "workspace:30" }),
      spawned({ model: "fable", ref: "workspace:29" }),
    ].join("\n");

    expect(bootModelForWorkspace({ logText, workspaceRef: "workspace:29" })).toEqual({
      kind: "pinned",
      model: "fable",
    });
  });

  it("reports an inherited boot as inherited, carrying no model", () => {
    const logText = JSON.stringify({
      bootModel: { kind: "inherited" },
      kind: "spawned",
      workspaceRef: "workspace:29",
    });

    expect(bootModelForWorkspace({ logText, workspaceRef: "workspace:29" })).toEqual({ kind: "inherited" });
  });

  it("answers undefined when no row names the workspace", () => {
    const logText = spawned({ model: "fable", ref: "workspace:30" });

    expect(bootModelForWorkspace({ logText, workspaceRef: "workspace:29" })).toBe(undefined);
  });

  it("steps over a blank line, an unparseable line and another kind's row", () => {
    const logText = [
      "",
      "{ this is not json",
      JSON.stringify({ kind: "closed", workspaceRef: "workspace:29" }),
      spawned({ model: "fable", ref: "workspace:29" }),
    ].join("\n");

    expect(bootModelForWorkspace({ logText, workspaceRef: "workspace:29" })).toEqual({
      kind: "pinned",
      model: "fable",
    });
  });

  it("keeps the last GOOD answer when a later row's bootModel is a shape it does not know", () => {
    const logText = [
      spawned({ model: "fable", ref: "workspace:29" }),
      JSON.stringify({ bootModel: "fable", kind: "spawned", workspaceRef: "workspace:29" }),
    ].join("\n");

    expect(bootModelForWorkspace({ logText, workspaceRef: "workspace:29" })).toEqual({
      kind: "pinned",
      model: "fable",
    });
  });
});

describe("runMonitorPass", () => {
  beforeEach(() => {
    writeFileSync(landingPath, landingDocument(), "utf8");
    mkdirSync(stateHomePaths({ home }).handovers, { recursive: true });
  });

  it("reports what it WOULD do and writes nothing without --fire", async () => {
    const actions = await pass({ fire: false });
    const posted = actions.filter((action) => action.kind === "posted");
    expect(posted.map((action) => action.detail)).toEqual([
      "would post: Pick a code owner on lachiejames/slopweaver#891, so it can land",
    ]);
    expect(prsSteps()).toEqual([]);
  });

  it("posts one hand step per subject when fired", async () => {
    await pass({ fire: true });
    expect(prsSteps()).toEqual(["Pick a code owner on lachiejames/slopweaver#891, so it can land"]);
  });

  it("writes nothing once a later pass took its fired-pass lease over, and says so", async () => {
    const actions = await pass({ fire: true, stillHeld: () => false });
    expect([actions.map((action) => action.kind), prsSteps()]).toEqual([["refused"], []]);
    expect(actions[0]!.detail).toContain("ran past its fired-pass lease");
  });

  it("ignores the lease on a rehearsal, which writes nothing anyway", async () => {
    const actions = await pass({ fire: false, stillHeld: () => false });
    expect(actions.map((action) => action.kind)).toEqual(["posted"]);
  });

  it("posts NOTHING on a second pass over the same subject, which is the arrival rule", async () => {
    await pass({ fire: true });
    const open = openPrsSteps();
    const second = await pass({ fire: true, openIds: open.map((step) => step.id) });
    expect(second.filter((action) => action.kind === "posted")).toEqual([]);
  });

  it("settles an open step whose pull request has left a document that still carries rows", async () => {
    await pass({ fire: true });
    const open = openPrsSteps();
    writeFileSync(landingPath, landingDocument({ action: "press", number: 892 }), "utf8");
    const second = await pass({ fire: true, openIds: open.map((step) => step.id) });
    expect(second.filter((action) => action.kind === "settled").map((action) => action.detail)).toEqual([
      "the monitor cleared: the code-owner requirement clears, or the row leaves `blocked-on`",
    ]);
    expect(prsSteps()).toEqual([]);
  });

  it("refuses an EMPTY document rather than settling every card it has open over it", async () => {
    await pass({ fire: true });
    const open = openPrsSteps();
    writeFileSync(landingPath, JSON.stringify({ rows: [] }), "utf8");
    const second = await pass({ fire: true, openIds: open.map((step) => step.id) });
    expect(second.map((action) => action.kind)).toEqual(["refused"]);
    expect(second[0]!.detail).toContain("not evidence that anything cleared");
    expect(openPrsSteps().map((step) => step.id)).toEqual(open.map((step) => step.id));
  });

  it("refuses rather than settling when a monitor cannot read its source", async () => {
    rmSync(landingPath);
    const refusals = (await pass({ fire: true })).filter((action) => action.monitorId === "prs-backed-up");
    expect(refusals.map((action) => action.kind)).toEqual(["refused"]);
    expect(refusals[0]!.detail).toContain("could not be read");
  });

  it("leaves an open step alone when its own monitor went unmeasurable", async () => {
    await pass({ fire: true });
    const open = openPrsSteps();
    rmSync(landingPath);
    await pass({ fire: true, openIds: open.map((step) => step.id) });
    expect(openPrsSteps().map((step) => step.id)).toEqual(open.map((step) => step.id));
  });

  it("names the command to run when no landing document was handed in at all", async () => {
    const outcome = await runMonitorPass({
      consoleBase: CONSOLE_BASE,
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
        nowIso: NOW_ISO,
        nowMs: NOW_MS,
      },
      nowIso: NOW_ISO,
      openIds: [],
      openWithDecision: new Set(),
      openPage: quietOpener,
      postedBy: "workspace:29",
      postedIds: [],
      raiseNote: quietRaiser,
    });
    const refusal = outcome.actions.find((action) => action.monitorId === "prs-backed-up")!;
    expect(refusal.detail).toContain("slopweaver github landing --json");
  });

  it("keeps one unreadable source from taking the other monitors down", async () => {
    rmSync(landingPath);
    const outcome = await runMonitorPass({
      consoleBase: CONSOLE_BASE,
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
        landingPath,
        nowIso: NOW_ISO,
        nowMs: NOW_MS,
      },
      nowIso: NOW_ISO,
      openIds: [],
      openWithDecision: new Set(),
      openPage: quietOpener,
      postedBy: "workspace:29",
      postedIds: [],
      raiseNote: quietRaiser,
    });
    // The roster's own order, pinned once in `registry.test.ts`: every declared monitor still answered.
    expect(MONITORS.length).toBeGreaterThan(0);
    expect(outcome.readings.map((reading) => reading.monitorId)).toEqual(MONITORS.map((monitor) => monitor.id));
  });
});

describe("runMonitorPass — recipe-stopped", () => {
  /** Slots of `30 9 * * *` since this watermark have gone by unrun, past the daily threshold. */
  const STALE = "2026-09-15T09:30:00.000Z";
  /** The latest slot before the pass — a row stamped here is current. */
  const FRESH = "2026-09-18T09:30:00.000Z";
  /** The choice a card carried before a card stopped offering the owner a choice. */
  const OLD_CHOICE = {
    lean: "A — restart it",
    options: [
      { option: "Restart it", tradeoff: "fires again on a cause nobody read" },
      { option: "Repair it", tradeoff: "a seat's time on the cause" },
      { option: "Retire it", tradeoff: "the digest stops for good" },
    ],
    problem: "vulnfix-digest-acme-admin stopped firing",
    stakes: { blastRadius: "the owner's DM", risk: "a silent digest", stillReal: "slopweaver automation due" },
  };

  let raised: string[] = [];

  /** Records each step it is asked to float, and answers as the real raise does for a first note. */
  const recordingRaiser: NoteRaiser = ({ step }) => {
    raised.push(step.id);
    return ok("floating, top right");
  };

  beforeEach(() => {
    raised = [];
    mkdirSync(stateHomePaths({ home }).handovers, { recursive: true });
    writeRecipeDefinitions({ home, rows: [dailyRow(), dailyRow({ recipeId: "resync-atlas-datadog" })] });
  });

  /** One pass's recipe-stopped actions, fired, against the note seam given. */
  async function recipePass({
    openIds = [],
    raiseNote = recordingRaiser,
    consoleBase = CONSOLE_BASE,
    monitorIds = ["recipe-stopped"],
  }: {
    openIds?: readonly string[];
    raiseNote?: NoteRaiser;
    consoleBase?: string;
    monitorIds?: readonly string[];
  } = {}): Promise<readonly PassAction[]> {
    const { postedIds, steps } = unwrap(readOpenHandSteps({ home }));
    const outcome = await runMonitorPass({
      consoleBase,
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
        nowIso: NOW_ISO,
        nowMs: NOW_MS,
      },
      nowIso: NOW_ISO,
      openIds,
      // Off the register, as `monitor check` reads it: which open cards were recorded with a decision.
      openWithDecision: new Set(steps.filter((step) => step.decision !== undefined).map((step) => step.id)),
      openPage: quietOpener,
      postedBy: "workspace:29",
      postedIds,
      raiseNote,
    });
    return outcome.actions.filter((action) => monitorIds.includes(action.monitorId));
  }

  /** The open steps recipe-stopped owns. */
  function openRecipeSteps(): readonly HandStep[] {
    return unwrap(readOpenHandSteps({ home })).steps.filter((step) => step.id.startsWith("mon-recipe-"));
  }

  /**
   * Two open cards for one set, as two racing passes left them before a posting was refused beside a card its pass
   * never read (`../../../monitor/passPost.ts`) — a register written then still holds them, so the repair stays.
   */
  async function racedDuplicate(): Promise<void> {
    await recipePass();
    const first = openRecipeSteps()[0]!;
    const id = `${first.id}.2`;
    const second: HandStep = { ...first, id, url: first.url!.replaceAll(first.id, id) };
    unwrap(await appendHandRow({ home, nowIso: NOW_ISO, row: { kind: "posted", step: second } }));
  }

  /** The open steps recipe-repairing owns. */
  function openRepairingSteps(): readonly HandStep[] {
    return unwrap(readOpenHandSteps({ home })).steps.filter((step) => step.id.startsWith("mon-repairing-"));
  }

  /** `row`'s run journal holding these events, one per line. */
  function journal({ row, events }: { row: string; events: readonly Record<string, unknown>[] }): void {
    const runs = stateHomePaths({ home }).runs;
    mkdirSync(runs, { recursive: true });
    writeFileSync(join(runs, `${row}.jsonl`), events.map((event) => `${JSON.stringify(event)}\n`).join(""));
  }

  const STARTED = { atIso: NOW_ISO, branch: "fix", docHash: "h", kind: "started" };

  /** A seat's repair row, live — a ready doc whose run the seat started — and its take of `recipeId`. */
  function takeRepair({ recipeId, row }: { recipeId: string; row: string }): void {
    writeFileSync(
      join(stateHomePaths({ home }).handovers, `${row}.md`),
      `---\nslug: ${row}\nstatus: ready\n---\n# repair\n`,
    );
    journal({ events: [STARTED], row });
    unwrap(appendRepairTake({ home, take: { recipeId, row, takenIso: NOW_ISO } }));
  }

  /** Close `row`'s run, which is what makes its repair done. */
  function closeRun({ row }: { row: string }): void {
    journal({ events: [STARTED, { atIso: NOW_ISO, kind: "closed", residue: [], summary: "fixed" }], row });
  }

  describe("a stop a seat has taken", () => {
    const BOTH = ["recipe-stopped", "recipe-repairing"];

    it("floats a note naming the recipe and the seat, and posts no card asking the owner anything", async () => {
      stampRecipeRuns({ home, stamps: { "resync-atlas-datadog": FRESH, "vulnfix-digest-acme-admin": STALE } });
      takeRepair({ recipeId: "vulnfix-digest-acme-admin", row: "fix-the-digest" });

      const actions = await recipePass({ monitorIds: BOTH });

      expect(actions.map((action) => [action.monitorId, action.kind, action.detail])).toEqual([
        [
          "recipe-repairing",
          "posted",
          "vulnfix-digest-acme-admin stopped firing — seat fix-the-digest is repairing it",
        ],
        ["recipe-repairing", "noted", "floating, top right"],
      ]);
      expect(openRecipeSteps()).toEqual([]);
      const [note] = openRepairingSteps();
      expect([note!.notice, note!.url, note!.decision]).toEqual([true, undefined, undefined]);
      expect(raised).toEqual([note!.id]);
    });

    it("takes the stopped card down as answered, once a seat takes the repair, and floats the note in its place", async () => {
      stampRecipeRuns({ home, stamps: { "resync-atlas-datadog": FRESH, "vulnfix-digest-acme-admin": STALE } });
      await recipePass();
      const [card] = openRecipeSteps();
      takeRepair({ recipeId: "vulnfix-digest-acme-admin", row: "fix-the-digest" });

      const second = await recipePass({ monitorIds: BOTH, openIds: [card!.id] });

      expect(second.map((action) => [action.monitorId, action.kind, action.stepId === card!.id])).toEqual([
        ["recipe-stopped", "settled", true],
        ["recipe-repairing", "posted", false],
        ["recipe-repairing", "noted", false],
      ]);
      expect(openRecipeSteps()).toEqual([]);
      expect(openRepairingSteps().length).toBe(1);
    });

    it("goes loud again when the repair row is done and the recipe still has not fired, and takes the note down", async () => {
      stampRecipeRuns({ home, stamps: { "resync-atlas-datadog": FRESH, "vulnfix-digest-acme-admin": STALE } });
      takeRepair({ recipeId: "vulnfix-digest-acme-admin", row: "fix-the-digest" });
      await recipePass({ monitorIds: BOTH });
      const [note] = openRepairingSteps();
      closeRun({ row: "fix-the-digest" });

      const second = await recipePass({ monitorIds: BOTH, openIds: [note!.id] });

      expect(second.map((action) => [action.monitorId, action.kind])).toEqual([
        ["recipe-stopped", "posted"],
        ["recipe-stopped", "noted"],
        ["recipe-repairing", "settled"],
      ]);
      expect(openRepairingSteps()).toEqual([]);
      expect(openRecipeSteps().map((step) => step.what)).toEqual([
        "Seat a repair for vulnfix-digest-acme-admin — it stopped firing and no seat has it",
      ]);
      expect(readFileSync(join(stateHomePaths({ home }).handNoteDismiss, `${note!.id}.later`), "utf8")).toBe(
        `${NOW_ISO}\n`,
      );
    });

    it("keeps the stop loud when the take names a row that is already done", async () => {
      stampRecipeRuns({ home, stamps: { "resync-atlas-datadog": FRESH, "vulnfix-digest-acme-admin": STALE } });
      takeRepair({ recipeId: "vulnfix-digest-acme-admin", row: "fix-the-digest" });
      closeRun({ row: "fix-the-digest" });

      const actions = await recipePass({ monitorIds: BOTH });

      expect(actions.map((action) => [action.monitorId, action.kind])).toEqual([
        ["recipe-stopped", "posted"],
        ["recipe-stopped", "noted"],
      ]);
      expect(openRepairingSteps()).toEqual([]);
    });
  });

  it("posts one work-context step for a silent row and asks for its note exactly once", async () => {
    stampRecipeRuns({ home, stamps: { "resync-atlas-datadog": FRESH, "vulnfix-digest-acme-admin": STALE } });

    const actions = await recipePass();

    expect(actions.map((action) => [action.kind, action.detail])).toEqual([
      ["posted", "Seat a repair for vulnfix-digest-acme-admin — it stopped firing and no seat has it"],
      ["noted", "floating, top right"],
    ]);
    expect(openRecipeSteps().map((step) => [step.what, step.context])).toEqual([
      ["Seat a repair for vulnfix-digest-acme-admin — it stopped firing and no seat has it", "work"],
    ]);
    expect(raised).toEqual(openRecipeSteps().map((step) => step.id));
  });

  it("posts the card for a recipe whose id reads as two sentences, rather than being refused every pass", async () => {
    writeRecipeDefinitions({ home, rows: [dailyRow({ recipeId: "x. y" })] });
    stampRecipeRuns({ home, stamps: { "x. y": STALE } });

    const actions = await recipePass();

    expect(actions.map((action) => [action.kind, action.detail])).toEqual([
      ["posted", "Seat a repair for x.y — it stopped firing and no seat has it"],
      ["noted", "floating, top right"],
    ]);
    expect(openRecipeSteps()[0]!.unblocks).toContain("x. y — MISSED");
  });

  it("posts the plain sentence for a recipe whose id the register reads as prose, still naming it, rather than going silent", async () => {
    writeRecipeDefinitions({ home, rows: [dailyRow({ recipeId: "the session" })] });
    stampRecipeRuns({ home, stamps: { "the session": STALE } });

    const actions = await recipePass();

    expect(actions.map((action) => [action.kind, action.detail])).toEqual([
      ["posted", "Seat a repair for a stopped recipe — its id is below"],
      ["noted", "floating, top right"],
    ]);
    // The prefix only: how many slots went by depends on the machine's timezone, and the id is what is under test.
    expect(openRecipeSteps().map((step) => [step.unblocks.slice(0, 21), step.context])).toEqual([
      ["the session — MISSED:", "work"],
    ]);
  });

  it("neither re-posts nor re-raises on an identical second pass", async () => {
    stampRecipeRuns({ home, stamps: { "vulnfix-digest-acme-admin": STALE, "resync-atlas-datadog": STALE } });
    await recipePass();
    raised = [];

    const second = await recipePass({ openIds: openRecipeSteps().map((step) => step.id) });

    expect(second).toEqual([]);
    expect(raised).toEqual([]);
  });

  it("posts ONE card for two stopped rows, naming the count and the worst", async () => {
    stampRecipeRuns({ home, stamps: { "vulnfix-digest-acme-admin": STALE, "resync-atlas-datadog": STALE } });

    const actions = await recipePass();

    expect(actions.map((action) => [action.kind, action.detail])).toEqual([
      [
        "posted",
        expect.stringMatching(/^Seat a repair for 2 recipes, worst \S+ — it stopped firing and no seat has it$/),
      ],
      ["noted", "floating, top right"],
    ]);
    expect(openRecipeSteps().length).toBe(1);
  });

  it("replaces the set's card when one row fires again — the smaller set posts, the old card settles", async () => {
    stampRecipeRuns({ home, stamps: { "vulnfix-digest-acme-admin": STALE, "resync-atlas-datadog": STALE } });
    await recipePass();
    const open = openRecipeSteps();
    stampRecipeRuns({ home, stamps: { "resync-atlas-datadog": FRESH, "vulnfix-digest-acme-admin": STALE } });

    const second = await recipePass({ openIds: open.map((step) => step.id) });

    expect(second.map((action) => action.kind)).toEqual(["posted", "noted", "settled"]);
    expect(openRecipeSteps().map((step) => step.what)).toEqual([
      "Seat a repair for vulnfix-digest-acme-admin — it stopped firing and no seat has it",
    ]);
  });

  it("keeps the old card open when its replacement could not be recorded, so a stopped set never has none (Codex review)", async () => {
    stampRecipeRuns({ home, stamps: { "vulnfix-digest-acme-admin": STALE, "resync-atlas-datadog": STALE } });
    await recipePass();
    const open = openRecipeSteps();
    stampRecipeRuns({ home, stamps: { "resync-atlas-datadog": FRESH, "vulnfix-digest-acme-admin": STALE } });
    const held = acquireOperationLock({ home, key: "hand-step-register", nowIso: NOW_ISO });
    expect(held.isOk()).toBe(true);
    let second: readonly PassAction[] = [];
    try {
      second = await recipePass({ openIds: open.map((step) => step.id) });
    } finally {
      unwrap(held).release();
    }

    expect(second.map((action) => action.kind)).toEqual(["refused"]);
    expect(openRecipeSteps().map((step) => step.id)).toEqual(open.map((step) => step.id));
  });

  it("keeps the card up once its stopped row is one a steer covers — a steer answers the choice, never the silence", async () => {
    writeRecipeDefinitions({ home, rows: [dailyRow({ recipeId: "resync-atlas-datadog" })] });
    stampRecipeRuns({ home, stamps: { "resync-atlas-datadog": STALE, "vulnfix-digest-acme-admin": FRESH } });
    await recipePass();
    const open = openRecipeSteps();
    writeRecipeDefinitions({ home, rows: [dailyRow({ kind: "resync", recipeId: "resync-atlas-datadog" })] });

    const second = await recipePass({ openIds: open.map((step) => step.id) });

    expect(RECIPE_STEERS.map((steer) => steer.id)).toEqual(["resync-restart"]);
    expect(second).toEqual([]);
    expect(openRecipeSteps().map((step) => step.id)).toEqual(open.map((step) => step.id));
  });

  it("replaces a card recorded while it still asked restart, repair or retire, so a choice the owner was relieved of never stays up", async () => {
    stampRecipeRuns({ home, stamps: { "resync-atlas-datadog": FRESH, "vulnfix-digest-acme-admin": STALE } });
    await recipePass();
    const [posted] = openRecipeSteps();
    // The line as the monitor wrote it before ruling A: the same card, carrying the choice.
    const path = stateHomePaths({ home }).handStepsJsonl;
    const lines = readFileSync(path, "utf8")
      .trim()
      .split("\n")
      .map((line) => {
        const row = JSON.parse(line) as { step: Record<string, unknown> };
        if (row.step["id"] === posted!.id) {
          row.step["decision"] = OLD_CHOICE;
        }
        return JSON.stringify(row);
      });
    writeFileSync(path, `${lines.join("\n")}\n`);
    raised = [];

    const second = await recipePass({ openIds: [posted!.id] });

    expect(second.map((action) => [action.kind, action.stepId])).toEqual([
      ["posted", `${posted!.id}.2`],
      ["noted", `${posted!.id}.2`],
      ["settled", posted!.id],
    ]);
    expect(openRecipeSteps().map((step) => [step.id, step.decision !== undefined])).toEqual([
      [`${posted!.id}.2`, false],
    ]);
    expect(raised).toEqual([`${posted!.id}.2`]);
  });

  it("leaves a card that carries no decision standing while the set stays stopped", async () => {
    stampRecipeRuns({ home, stamps: { "resync-atlas-datadog": FRESH, "vulnfix-digest-acme-admin": STALE } });
    await recipePass();

    expect(await recipePass({ openIds: openRecipeSteps().map((step) => step.id) })).toEqual([]);
  });

  it("settles the set's one card once every row fires again", async () => {
    stampRecipeRuns({ home, stamps: { "vulnfix-digest-acme-admin": STALE, "resync-atlas-datadog": STALE } });
    await recipePass();
    const open = openRecipeSteps();
    stampRecipeRuns({ home, stamps: { "vulnfix-digest-acme-admin": FRESH, "resync-atlas-datadog": FRESH } });

    const second = await recipePass({ openIds: open.map((step) => step.id) });

    expect(second.map((action) => action.kind)).toEqual(["settled"]);
    expect(openRecipeSteps()).toEqual([]);
  });

  it("posts a fresh card, and raises the note again, when a set that cleared comes back (Codex review)", async () => {
    stampRecipeRuns({ home, stamps: { "resync-atlas-datadog": FRESH, "vulnfix-digest-acme-admin": STALE } });
    await recipePass();
    const first = openRecipeSteps();
    stampRecipeRuns({ home, stamps: { "resync-atlas-datadog": FRESH, "vulnfix-digest-acme-admin": FRESH } });
    await recipePass({ openIds: first.map((step) => step.id) });
    stampRecipeRuns({ home, stamps: { "resync-atlas-datadog": FRESH, "vulnfix-digest-acme-admin": STALE } });

    const third = await recipePass();

    expect(third.map((action) => action.kind)).toEqual(["posted", "noted"]);
    expect(openRecipeSteps().map((step) => step.id)).toEqual([`${first[0]!.id}.2`]);
    // The returning card opens ITSELF — its own `.2` id — never the base card it replaced.
    expect(openRecipeSteps().map((step) => step.url)).toEqual([
      `http://localhost:3000/queue?open=hand%3A${first[0]!.id}.2&context=work`,
    ]);
  });

  it("opens every card it posts on its own queue item, carrying the monitor's context", async () => {
    stampRecipeRuns({ home, stamps: { "resync-atlas-datadog": FRESH, "vulnfix-digest-acme-admin": STALE } });

    await recipePass();

    const [step] = openRecipeSteps();
    expect(step!.url).toBe(`http://localhost:3000/queue?open=hand%3A${step!.id}&context=work`);
  });

  it("posts its card, offering the owner no choice, under a configured console origin that is not this machine", async () => {
    stampRecipeRuns({ home, stamps: { "resync-atlas-datadog": FRESH, "vulnfix-digest-acme-admin": STALE } });

    const actions = await recipePass({ consoleBase: "https://console.example.org" });

    expect(actions.map((action) => action.kind)).toEqual(["posted", "noted"]);
    const [step] = openRecipeSteps();
    expect(step!.decision).toBe(undefined);
    expect(step!.url).toBe(`https://console.example.org/queue?open=hand%3A${step!.id}&context=work`);
  });

  it("refuses, by name, a card whose configured console base would mint a link opening no card", async () => {
    stampRecipeRuns({ home, stamps: { "resync-atlas-datadog": FRESH, "vulnfix-digest-acme-admin": STALE } });

    const actions = await recipePass({ consoleBase: "https://console.example.org/console?tenant=acme" });

    expect(actions.map((action) => action.kind)).toEqual(["refused"]);
    expect(actions[0]!.detail).toContain("does not open hand:");
    expect(openRecipeSteps()).toEqual([]);
  });

  it("refuses a base ending in a query that names a card, which would otherwise mint a link reading as that card", async () => {
    stampRecipeRuns({ home, stamps: { "resync-atlas-datadog": FRESH, "vulnfix-digest-acme-admin": STALE } });

    const actions = await recipePass({ consoleBase: "https://console.example.org/queue?open=hand%3Aanything&" });

    expect(actions.map((action) => action.kind)).toEqual(["refused"]);
    expect(actions[0]!.detail).toContain("carries a query or a fragment");
    expect(openRecipeSteps()).toEqual([]);
  });

  it("posts its card under a second local spelling of the console, on another port", async () => {
    stampRecipeRuns({ home, stamps: { "resync-atlas-datadog": FRESH, "vulnfix-digest-acme-admin": STALE } });

    const actions = await recipePass({ consoleBase: "http://127.0.0.1:3100" });

    expect(actions.map((action) => action.kind)).toEqual(["posted", "noted"]);
    const [step] = openRecipeSteps();
    expect(step!.url).toBe(`http://127.0.0.1:3100/queue?open=hand%3A${step!.id}&context=work`);
  });

  it("matches a second card to its subject by base id, so a still-stopped set neither re-posts nor settles", async () => {
    stampRecipeRuns({ home, stamps: { "resync-atlas-datadog": FRESH, "vulnfix-digest-acme-admin": STALE } });
    await recipePass();
    const first = openRecipeSteps();
    stampRecipeRuns({ home, stamps: { "resync-atlas-datadog": FRESH, "vulnfix-digest-acme-admin": FRESH } });
    await recipePass({ openIds: first.map((step) => step.id) });
    stampRecipeRuns({ home, stamps: { "resync-atlas-datadog": FRESH, "vulnfix-digest-acme-admin": STALE } });
    await recipePass();

    const fourth = await recipePass({ openIds: openRecipeSteps().map((step) => step.id) });

    expect(fourth).toEqual([]);
    expect(openRecipeSteps().map((step) => step.id)).toEqual([`${first[0]!.id}.2`]);
  });

  it("repairs two racing passes' duplicate cards on the next pass, keeping the newest (Codex review)", async () => {
    stampRecipeRuns({ home, stamps: { "resync-atlas-datadog": FRESH, "vulnfix-digest-acme-admin": STALE } });
    await racedDuplicate();
    const racing = openRecipeSteps().map((step) => step.id);

    const next = await recipePass({ openIds: racing });

    expect(racing).toEqual([racing[0]!, `${racing[0]!}.2`]);
    expect(next.map((action) => [action.kind, action.stepId])).toEqual([["settled", racing[0]!]]);
    expect(next[0]!.detail).toBe(`superseded by ${racing[0]!}.2, a newer card for the same subject`);
    expect(openRecipeSteps().map((step) => step.id)).toEqual([`${racing[0]!}.2`]);
  });

  it("re-posts and re-raises a set that comes back while its replacement's card is still open", async () => {
    stampRecipeRuns({ home, stamps: { "vulnfix-digest-acme-admin": STALE, "resync-atlas-datadog": STALE } });
    await recipePass();
    const [both] = openRecipeSteps();
    stampRecipeRuns({ home, stamps: { "resync-atlas-datadog": FRESH, "vulnfix-digest-acme-admin": STALE } });
    // The set changed and its card went up, but settling the old one failed, so both stay open.
    await recipePass();
    const [, smaller] = openRecipeSteps();
    stampRecipeRuns({ home, stamps: { "vulnfix-digest-acme-admin": STALE, "resync-atlas-datadog": STALE } });
    raised = [];

    const back = await recipePass({ openIds: [both!.id, smaller!.id] });

    expect(back.map((action) => [action.kind, action.stepId])).toEqual([
      ["posted", `${both!.id}.2`],
      ["noted", `${both!.id}.2`],
      ["settled", smaller!.id],
      ["settled", both!.id],
    ]);
    expect(back[3]!.detail).toBe(`superseded by ${both!.id}.2, a newer card for the same subject`);
    expect(raised).toEqual([`${both!.id}.2`]);
    expect(openRecipeSteps().map((step) => step.id)).toEqual([`${both!.id}.2`]);
  });

  it("re-posts a set beside a leftover card whichever is older, since --now may record instants out of order", async () => {
    stampRecipeRuns({ home, stamps: { "vulnfix-digest-acme-admin": STALE, "resync-atlas-datadog": STALE } });
    await recipePass();
    const [both] = openRecipeSteps();
    stampRecipeRuns({ home, stamps: { "resync-atlas-datadog": FRESH, "vulnfix-digest-acme-admin": STALE } });
    await recipePass();
    const [, smaller] = openRecipeSteps();
    raised = [];

    const next = await recipePass({ openIds: [smaller!.id, both!.id] });

    expect(next.map((action) => [action.kind, action.stepId])).toEqual([
      ["posted", `${smaller!.id}.2`],
      ["noted", `${smaller!.id}.2`],
      ["settled", both!.id],
      ["settled", smaller!.id],
    ]);
    expect(raised).toEqual([`${smaller!.id}.2`]);
    expect(openRecipeSteps().map((step) => step.id)).toEqual([`${smaller!.id}.2`]);
  });

  it("settles every duplicate card of a set that cleared, not just one (Codex review)", async () => {
    stampRecipeRuns({ home, stamps: { "resync-atlas-datadog": FRESH, "vulnfix-digest-acme-admin": STALE } });
    await racedDuplicate();
    const racing = openRecipeSteps().map((step) => step.id);
    stampRecipeRuns({ home, stamps: { "resync-atlas-datadog": FRESH, "vulnfix-digest-acme-admin": FRESH } });

    const next = await recipePass({ openIds: racing });

    expect(next.map((action) => [action.kind, action.stepId])).toEqual([
      ["settled", racing[0]!],
      ["settled", racing[1]!],
    ]);
    expect(openRecipeSteps()).toEqual([]);
  });

  it("settles nothing when the run stamps become unreadable, and says why", async () => {
    stampRecipeRuns({ home, stamps: { "vulnfix-digest-acme-admin": STALE, "resync-atlas-datadog": STALE } });
    await recipePass();
    const open = openRecipeSteps();
    writeFileSync(stateHomePaths({ home }).live.recipe.definitionRunsJson, "{ not json", "utf8");

    const second = await recipePass({ openIds: open.map((step) => step.id) });

    expect(second.map((action) => action.kind)).toEqual(["refused"]);
    expect(second[0]!.detail).toContain("the recipe run stamps could not be read");
    expect(openRecipeSteps().map((step) => step.id)).toEqual(open.map((step) => step.id));
  });

  it("still cards a stopped row beside a malformed sibling file, and replaces the old card rather than stacking (Codex review)", async () => {
    stampRecipeRuns({ home, stamps: { "vulnfix-digest-acme-admin": STALE, "resync-atlas-datadog": STALE } });
    await recipePass();
    const open = openRecipeSteps();
    stampRecipeRuns({ home, stamps: { "vulnfix-digest-acme-admin": STALE, "resync-atlas-datadog": FRESH } });
    writeFileSync(join(stateHomePaths({ home }).live.recipe.definitionsDir, "broken.json"), "{", "utf8");

    const second = await recipePass({ openIds: open.map((step) => step.id) });

    expect(second.map((action) => [action.kind, action.detail])).toEqual([
      ["posted", "Seat a repair for vulnfix-digest-acme-admin — it stopped firing and no seat has it"],
      ["noted", "floating, top right"],
      ["refused", expect.stringContaining("1 recipe definition file(s) could not be parsed")],
      [
        "settled",
        `the subject cleared, the monitor still fires: the row fires again inside its own threshold, is disabled or held, or a seat takes its repair (\`slopweaver automation repair\`); replaced by ${second[0]!.stepId}`,
      ],
    ]);
    expect(openRecipeSteps().map((step) => step.id)).not.toContain(open[0]!.id);
    expect(openRecipeSteps().length).toBe(1);
  });

  it("settles nothing on a partial read that brought no replacement, since a missing row was not seen clearing", async () => {
    stampRecipeRuns({ home, stamps: { "vulnfix-digest-acme-admin": STALE, "resync-atlas-datadog": STALE } });
    await recipePass();
    const open = openRecipeSteps();
    stampRecipeRuns({ home, stamps: { "vulnfix-digest-acme-admin": STALE, "resync-atlas-datadog": STALE } });
    writeFileSync(join(stateHomePaths({ home }).live.recipe.definitionsDir, "broken.json"), "{", "utf8");

    const second = await recipePass({ openIds: open.map((step) => step.id) });

    expect(second.map((action) => action.kind)).toEqual(["refused"]);
    expect(openRecipeSteps().map((step) => step.id)).toEqual([open[0]!.id]);
  });

  it("keeps the recorded step when its note cannot come up, and reports the failure as its own row", async () => {
    stampRecipeRuns({ home, stamps: { "vulnfix-digest-acme-admin": STALE, "resync-atlas-datadog": STALE } });

    const actions = await recipePass({ raiseNote: () => err("open: could not launch") });

    expect(actions.map((action) => action.kind)).toEqual(["posted", "refused"]);
    expect(actions[1]!.detail).toBe("the floating note did not come up: open: could not launch");
    expect(openRecipeSteps().length).toBe(1);
  });

  it("raises nothing on a rehearsal", async () => {
    stampRecipeRuns({ home, stamps: { "vulnfix-digest-acme-admin": STALE, "resync-atlas-datadog": STALE } });

    await runMonitorPass({
      consoleBase: CONSOLE_BASE,
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
        nowIso: NOW_ISO,
        nowMs: NOW_MS,
      },
      nowIso: NOW_ISO,
      openIds: [],
      openWithDecision: new Set(),
      openPage: quietOpener,
      postedBy: "workspace:29",
      postedIds: [],
      raiseNote: recordingRaiser,
    });

    expect(raised).toEqual([]);
    expect(openRecipeSteps()).toEqual([]);
  });
});

describe("lapsedSettlements", () => {
  const definition = monitorDefinition({ monitorId: "fleet-runs-dry" });
  const openIds = ["mon-dry-until-2026-09-19t05", "mon-dry-until-2026-09-19t07.2", "mon-dry-unended", "mon-codex-x"];

  it("settles only this monitor's steps whose key names an hour already past, with no reading", async () => {
    const actions = await lapsedSettlements({
      definition,
      fire: false,
      home: "/unused-without-fire",
      nowIso: NOW_ISO,
      openIds,
      postedBy: "test",
    });
    expect(actions.map((action) => action.stepId)).toEqual(["mon-dry-until-2026-09-19t05"]);
    expect(actions[0]!.detail).toBe(
      "would settle: the subject it named was over at 2026-09-19T05:00:00.000Z, settled with no reading of its source",
    );
  });

  it("settles nothing for a monitor that declares no lapse", async () => {
    const actions = await lapsedSettlements({
      definition: monitorDefinition({ monitorId: "codex-plan-signed-out" }),
      fire: false,
      home: "/unused-without-fire",
      nowIso: NOW_ISO,
      openIds,
      postedBy: "test",
    });
    expect(actions).toEqual([]);
  });
});

describe("heldWhileFiring", () => {
  const definition = monitorDefinition({ monitorId: "fleet-runs-dry" });

  /** Whether a pass reading `subjectKeys` holds the open cards `openIds`, judged without writing. */
  const holds = async ({
    openIds,
    subjectKeys,
    of = definition,
  }: {
    openIds: readonly string[];
    subjectKeys: readonly string[];
    of?: typeof definition;
  }): Promise<boolean> =>
    (
      await heldWhileFiring({
        definition: of,
        fire: false,
        home: "/unused-without-fire",
        nowIso: NOW_ISO,
        openIds,
        postedBy: "test",
        subjectKeys,
      })
    ).holding;

  it("holds an open card cut for the same fleet, whatever spell the pass now reads", async () => {
    const held = await heldWhileFiring({
      definition,
      fire: false,
      home: "/unused-without-fire",
      nowIso: NOW_ISO,
      openIds: ["mon-dry-until-2026-09-19t07-r1a2b3c4d.2", "mon-codex-x"],
      postedBy: "test",
      subjectKeys: ["until-2026-09-20t11-r1a2b3c4d"],
    });
    expect(held).toEqual({
      holding: true,
      lapsed: [],
      openIds: ["mon-dry-until-2026-09-19t07-r1a2b3c4d.2", "mon-codex-x"],
    });
  });

  it("holds nothing cut for another fleet, or before keys carried one, so the pass re-cuts it", async () => {
    expect(
      await holds({
        openIds: ["mon-dry-until-2026-09-19t07-r1a2b3c4d"],
        subjectKeys: ["until-2026-09-19t07-r99999999"],
      }),
    ).toBe(false);
    expect(
      await holds({ openIds: ["mon-dry-until-2026-09-19t07"], subjectKeys: ["until-2026-09-19t07-r1a2b3c4d"] }),
    ).toBe(false);
  });

  it("holds the current card and supersedes a legacy or stale one still open beside it, rather than holding both", async () => {
    const held = await heldWhileFiring({
      definition,
      fire: false,
      home: "/unused-without-fire",
      nowIso: NOW_ISO,
      openIds: [
        "mon-dry-until-2026-09-19t07",
        "mon-dry-until-2026-09-19t07-r99999999",
        "mon-dry-until-2026-09-19t07-r1a2b3c4d",
      ],
      postedBy: "test",
      subjectKeys: ["until-2026-09-20t11-r1a2b3c4d"],
    });
    expect(held.holding).toBe(true);
    expect(held.lapsed.map((action) => [action.kind, action.stepId, action.detail])).toEqual([
      [
        "settled",
        "mon-dry-until-2026-09-19t07",
        "would settle: superseded by the card cut for the fleet as it stands, which stays open",
      ],
      [
        "settled",
        "mon-dry-until-2026-09-19t07-r99999999",
        "would settle: superseded by the card cut for the fleet as it stands, which stays open",
      ],
    ]);
  });

  it("leaves a monitor that declares no revision holding any open card of its own", async () => {
    const capped = monitorDefinition({ monitorId: "codex-fleet-capped" });
    expect(
      await holds({ of: capped, openIds: [`mon-${capped.prefix}-anything`], subjectKeys: ["something-else"] }),
    ).toBe(true);
  });

  it("settles a lapsed card and holds nothing, so the pass re-cuts on the spell then forecast", async () => {
    const held = await heldWhileFiring({
      definition,
      fire: false,
      home: "/unused-without-fire",
      nowIso: NOW_ISO,
      openIds: ["mon-dry-until-2026-09-19t05", "mon-codex-x"],
      postedBy: "test",
      subjectKeys: ["until-2026-09-20t11-r1a2b3c4d"],
    });
    expect(held.holding).toBe(false);
    expect(held.lapsed.map((action) => [action.kind, action.stepId])).toEqual([
      ["settled", "mon-dry-until-2026-09-19t05"],
    ]);
    expect(held.openIds).toEqual(["mon-codex-x"]);
  });

  it("keeps holding a lapsed card the register refused to settle, rather than opening a second", async () => {
    const held = await heldWhileFiring({
      definition,
      fire: true,
      home,
      nowIso: NOW_ISO,
      openIds: ["mon-dry-until-2026-09-19t05"],
      postedBy: "test",
      subjectKeys: ["until-2026-09-20t11-r1a2b3c4d"],
    });
    expect(held.lapsed.map((action) => action.kind)).toEqual(["refused"]);
    expect(held.holding).toBe(true);
  });
});

describe("readingShapeRefusal", () => {
  const two: readonly MonitorSubject[] = [
    { id: "a", key: "a-1", label: "first" },
    { id: "b", key: "b-2", label: "second" },
  ];

  it("refuses a set monitor's reading that carries more than one subject, naming the count", () => {
    expect(
      readingShapeRefusal({
        definition: monitorDefinition({ monitorId: "bot-off-the-air" }),
        reading: { monitorId: "bot-off-the-air", state: "firing", subjects: two },
      }),
    ).toBe(
      "bot-off-the-air posts one card for its whole set and read 2 subjects — nothing posted or settled (rule 6: one note per step the owner can take)",
    );
  });

  it("lets a per-subject monitor carry many, and a set monitor carry one", () => {
    expect(
      readingShapeRefusal({
        definition: monitorDefinition({ monitorId: "prs-backed-up" }),
        reading: { monitorId: "prs-backed-up", state: "firing", subjects: two },
      }),
    ).toBe(undefined);
    expect(
      readingShapeRefusal({
        definition: monitorDefinition({ monitorId: "bot-off-the-air" }),
        reading: { monitorId: "bot-off-the-air", state: "firing", subjects: two.slice(0, 1) },
      }),
    ).toBe(undefined);
  });
});
