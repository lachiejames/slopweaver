/**
 * `automation run-due` asks the PRECISE half of the ruling gate about every row it is about to run.
 *
 * `skills/handover/reference/ruling-gates.md` names this verb as the worked case for `rulingGateVerdict`: a gate
 * on `automation run-due` scoped to one automation id is not matched at the dispatch boundary by a scheduled
 * tick, because its argv names no row — so before this, the only caller of the precise half was a test, and a
 * ruling holding ONE automation was carried by nothing.
 *
 * The edges are plain recording functions, never mocks: the contract under test is whether the row's argv
 * reaches the dispatcher at all.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import { CALLER_GATE_HOMES_ENV, encodeCallerGateHomes } from "../../../../../cli/callerGateHomesEnv.js";
import type { CollectedLeg } from "../../../../../cli/commands/automation/collectLeg.js";
import type { RecipeRunDueDeps } from "../../../../../cli/commands/automation/rowRunners.js";
import { verbChildEnv } from "../../../../../cli/commands/automation/runDueVerbProcess.js";
import { EXIT_ERROR } from "../../../../../cli/exitCodes.js";
import { refuseRunnerOnStandingRuling } from "../../../../../cli/rulingGateDoor.js";
import { standingGatesOf } from "../../../../../handover/rulingGate.js";
import { writeStandingGates } from "../../../../../handover/rulingGateStore.js";
import { runUnderHome, slopweaverHome } from "../../../../../homeDir.js";
import { ok, unwrap } from "../../../../../lib/result.js";
import { RECIPE_DEFINITION_SCHEMA_VERSION } from "../../../../../live/automation/definition.js";
import { readRecipeDefinitionRuns } from "../../../../../live/automation/definitionRunStore.js";
import { stateHomePaths } from "../../../../../stateHome.js";
import { measuredFleetCeilingReport } from "../../../../fleetCeilingReportFixture.js";
import { UNREACHED_FLEET_CEILING_SEAMS } from "../../../../fleetCeilingSeamsFake.js";
import { runDueUnderFake } from "../../../../runDueSignalFake.js";

const PLACED = "2026-09-08T11:00:00.000Z";
const NOW = "2026-09-08T12:05:00.000Z";
/** The line a tick prints for `held-row` under the fixture's ruling — the verb's own wording, quoted once. */
const HELD_ROW_LINE = `recipe held-row · HELD · ruling gate a-row#${PLACED} · they said: hold the policy acceptance post until Monday`;

const homes: string[] = [];

afterEach(() => {
  homes.splice(0).forEach((home) => {
    rmSync(home, { force: true, recursive: true });
  });
});

/** One `verb-run` row selecting `atlas freshness`, under the id given. */
function row({ recipeId }: { recipeId: string }): Record<string, unknown> {
  return {
    cadence: "0 * * * *",
    destination: { kind: "local-atlas" },
    effect: "read",
    kind: "verb-run",
    params: { argv: ["atlas", "freshness", "--behind-only"] },
    recipeId,
    schemaVersion: RECIPE_DEFINITION_SCHEMA_VERSION,
  };
}

/** A home carrying these rows, and a projection holding `gated` (`automation run-due` unless named) to `subjects`. */
function homeWith({
  gated = { noun: "automation", verb: "run-due" },
  recipeIds,
  subjects,
}: {
  gated?: { readonly noun: string; readonly verb: string };
  recipeIds: readonly string[];
  subjects: readonly string[];
}): string {
  const home = mkdtempSync(join(tmpdir(), "rdg-"));
  homes.push(home);
  const dir = join(home, "live", "recipe", "definitions");
  mkdirSync(dir, { recursive: true });
  for (const recipeId of recipeIds) {
    writeFileSync(join(dir, `${recipeId}.json`), JSON.stringify(row({ recipeId })), "utf8");
  }
  const gates = standingGatesOf({
    events: [
      {
        anchor: "talk-call:a0000051-0000-4000-8000-000000000054",
        atIso: PLACED,
        decidedIso: PLACED,
        gate: { subjects, verbs: [gated] },
        kind: "ruling",
        ruling: "hold the policy acceptance post until Monday",
      },
    ],
    slug: "a-row",
  });
  unwrap(writeStandingGates({ builtAtIso: PLACED, gates, indexPath: stateHomePaths({ home }).rulingGatesJson }));
  return home;
}

/** Recording edges: every argv the dispatcher was handed, and every line written. */
function deps(): RecipeRunDueDeps & { readonly dispatched: (readonly string[])[]; readonly out: string[] } {
  const dispatched: (readonly string[])[] = [];
  const out: string[] = [];
  const refused = (): Promise<CollectedLeg> => Promise.resolve({ diagnostics: "", exitCode: 1, lines: [] });
  return {
    checkoutFor: () => ok("/checkouts/slopweaver"),
    dispatched,
    doorEnv: () => ({}),
    mintId: () => "tok-1",
    now: () => NOW,
    out,
    processAlive: () => true,
    promptChannel: () => undefined,
    ...UNREACHED_FLEET_CEILING_SEAMS,
    readFleetCeilingReport: () => Promise.resolve(ok(measuredFleetCeilingReport())),
    register: () => Promise.resolve(0),
    runAlertDigestRead: refused,
    runAlertSummaryRead: refused,
    runGithubLandingRead: refused,
    runSlackPost: refused,
    runVerbKeepingDiagnostics: (argv) => {
      dispatched.push(argv);
      return Promise.resolve({ diagnostics: "", exitCode: 0 });
    },
    writeDiagnostic: (line) => out.push(line),
    writeOut: (line) => out.push(line),
  };
}

describe("automation run-due under a ruling gate scoped to one automation", () => {
  it("holds the gated row, runs its sibling, and fails nothing", async () => {
    const home = homeWith({ recipeIds: ["held-row", "free-row"], subjects: ["held-row"] });
    const injected = deps();

    const code = await runDueUnderFake({
      argv: ["node", "slopweaver", "automation", "run-due", "--home", home],
      deps: injected,
    });

    expect(code).toBe(0);
    expect(injected.dispatched).toEqual([["node", "slopweaver", "atlas", "freshness", "--behind-only"]]);
    expect(injected.out).toContain(HELD_ROW_LINE);
  });

  it("stamps nothing for the held row, so it runs on the first tick after the gate lifts", async () => {
    const home = homeWith({ recipeIds: ["held-row"], subjects: ["held-row"] });

    await runDueUnderFake({ argv: ["node", "slopweaver", "automation", "run-due", "--home", home], deps: deps() });

    const runs = unwrap(readRecipeDefinitionRuns({ path: runsPath({ home }) }));
    expect(Object.keys(runs)).toEqual([]);
  });

  it("prints where the owner said it under the held row, so the reader can check the ruling", async () => {
    const home = homeWith({ recipeIds: ["held-row"], subjects: ["held-row"] });
    const injected = deps();

    await runDueUnderFake({ argv: ["node", "slopweaver", "automation", "run-due", "--home", home], deps: injected });

    expect(injected.out).toContain("    where: talk-call:a0000051-0000-4000-8000-000000000054");
  });

  it("holds the row under --dry-run too, and rehearses its sibling", async () => {
    const home = homeWith({ recipeIds: ["held-row", "free-row"], subjects: ["held-row"] });
    const injected = deps();

    await runDueUnderFake({
      argv: ["node", "slopweaver", "automation", "run-due", "--home", home, "--dry-run"],
      deps: injected,
    });

    expect(injected.out.filter((line) => line.startsWith("recipe held-row · HELD · "))).toHaveLength(1);
    expect(injected.out.filter((line) => line.includes(" · would run · "))).toEqual([
      "recipe free-row · would run · slopweaver atlas freshness --behind-only",
    ]);
  });

  it("gives a held row no --limit place, so the next free row still runs", async () => {
    const home = homeWith({ recipeIds: ["a-held-row", "b-free-row"], subjects: ["a-held-row"] });
    const injected = deps();

    const code = await runDueUnderFake({
      argv: ["node", "slopweaver", "automation", "run-due", "--home", home, "--limit", "1"],
      deps: injected,
    });

    expect(code).toBe(0);
    expect(injected.dispatched).toEqual([["node", "slopweaver", "atlas", "freshness", "--behind-only"]]);
    expect(Object.keys(unwrap(readRecipeDefinitionRuns({ path: runsPath({ home }) })))).toEqual(["b-free-row"]);
  });

  it("runs every row when the gate names a different automation", async () => {
    const home = homeWith({ recipeIds: ["free-row"], subjects: ["another-row"] });
    const injected = deps();

    await runDueUnderFake({ argv: ["node", "slopweaver", "automation", "run-due", "--home", home], deps: injected });

    expect(injected.dispatched).toEqual([["node", "slopweaver", "atlas", "freshness", "--behind-only"]]);
    expect(injected.out.filter((line) => line.includes(" · HELD · "))).toEqual([]);
  });
});

describe("automation run-due --home <dir> under a ruling on a verb a row runs", () => {
  it("hands a verb child the tick's home to resolve, and both homes to gate on, in the environment it would launch under", async () => {
    const home = homeWith({ recipeIds: ["free-row"], subjects: ["another-row"] });
    const ambient = slopweaverHome();
    const handed: { gateHomes: string | undefined; home: string | undefined }[] = [];

    await runDueUnderFake({
      argv: ["node", "slopweaver", "automation", "run-due", "--home", home],
      deps: {
        ...deps(),
        // Production's child runner builds its environment here, inside the tick, exactly so.
        runVerbKeepingDiagnostics: () => {
          const env = unwrap(verbChildEnv());
          handed.push({ gateHomes: env[CALLER_GATE_HOMES_ENV], home: env["SLOPWEAVER_HOME"] });
          return Promise.resolve({ diagnostics: "", exitCode: 0 });
        },
      },
    });

    expect(handed).toEqual([{ gateHomes: JSON.stringify([ambient, home]), home }]);
    expect(slopweaverHome()).toBe(ambient);
  });

  it("lets that verb's own gate read the tick's home, though the words it is handed name none", async () => {
    const home = homeWith({ gated: { noun: "atlas", verb: "freshness" }, recipeIds: ["free-row"], subjects: [] });
    const injected = deps();
    const answered: (number | undefined)[] = [];

    const code = await runDueUnderFake({
      argv: ["node", "slopweaver", "automation", "run-due", "--home", home],
      deps: {
        ...injected,
        // The row's verb body as production shapes one: its first statement asks the gate over the words it got.
        runVerbKeepingDiagnostics: (argv) => {
          const refused = refuseRunnerOnStandingRuling({ noun: argv[2]!, rest: argv.slice(4), verb: argv[3]! });
          answered.push(refused);
          if (refused !== undefined) {
            return Promise.resolve({ diagnostics: "", exitCode: refused });
          }
          return Promise.resolve({ diagnostics: "", exitCode: 0 });
        },
      },
    });

    expect(answered).toEqual([EXIT_ERROR]);
    expect(code).toBe(EXIT_ERROR);
  });
});

describe("a nested automation run-due --home <dir>, run in a verb child of another tick", () => {
  const prior = process.env[CALLER_GATE_HOMES_ENV];

  afterEach(() => {
    if (prior === undefined) {
      delete process.env[CALLER_GATE_HOMES_ENV];
      return;
    }
    process.env[CALLER_GATE_HOMES_ENV] = prior;
  });

  it("holds a row a ruling in the PARENT's original home gates, though its own environment names neither home", async () => {
    const parentOriginal = homeWith({ recipeIds: [], subjects: ["held-row"] });
    const home = homeWith({ recipeIds: ["held-row", "free-row"], subjects: ["another-row"] });
    process.env[CALLER_GATE_HOMES_ENV] = encodeCallerGateHomes({ homes: [parentOriginal] });
    const injected = deps();

    const code = await runDueUnderFake({
      argv: ["node", "slopweaver", "automation", "run-due", "--home", home],
      deps: injected,
    });

    expect(code).toBe(0);
    expect(injected.dispatched).toEqual([["node", "slopweaver", "atlas", "freshness", "--behind-only"]]);
    expect(injected.out).toContain(HELD_ROW_LINE);
  });

  it("holds a row the ORIGINAL home gates when it joins a same-home scope another caller already opened", async () => {
    const original = homeWith({ recipeIds: [], subjects: ["held-row"] });
    const home = homeWith({ recipeIds: ["held-row", "free-row"], subjects: ["another-row"] });
    // home-safety-exempt: saves the variable to put it back; the test names its own temp home as the original one.
    const savedHome = process.env["SLOPWEAVER_HOME"];
    process.env["SLOPWEAVER_HOME"] = original;
    const injected = deps();
    try {
      // The other caller opened the scope from its own async context, so this tick inherits no caller homes.
      await runUnderHome({
        home,
        run: () =>
          runDueUnderFake({ argv: ["node", "slopweaver", "automation", "run-due", "--home", home], deps: injected }),
      });
    } finally {
      if (savedHome === undefined) {
        delete process.env["SLOPWEAVER_HOME"];
      } else {
        process.env["SLOPWEAVER_HOME"] = savedHome;
      }
    }

    expect(injected.dispatched).toEqual([["node", "slopweaver", "atlas", "freshness", "--behind-only"]]);
    expect(injected.out).toContain(HELD_ROW_LINE);
  });

  it("holds a row the CURRENT home gates when work inside the open scope moved the variable", async () => {
    const original = homeWith({ recipeIds: [], subjects: ["another-row"] });
    const moved = homeWith({ recipeIds: [], subjects: ["held-row"] });
    const home = homeWith({ recipeIds: ["held-row", "free-row"], subjects: ["another-row"] });
    // home-safety-exempt: saves the variable to put it back; the test names its own temp homes.
    const savedHome = process.env["SLOPWEAVER_HOME"];
    process.env["SLOPWEAVER_HOME"] = original;
    const injected = deps();
    try {
      await runUnderHome({
        home,
        run: () => {
          process.env["SLOPWEAVER_HOME"] = moved;
          return runDueUnderFake({
            argv: ["node", "slopweaver", "automation", "run-due", "--home", home],
            deps: injected,
          });
        },
      });
    } finally {
      if (savedHome === undefined) {
        delete process.env["SLOPWEAVER_HOME"];
      } else {
        process.env["SLOPWEAVER_HOME"] = savedHome;
      }
    }

    expect(injected.dispatched).toEqual([["node", "slopweaver", "atlas", "freshness", "--behind-only"]]);
    expect(injected.out).toContain(HELD_ROW_LINE);
  });

  it("refuses the tick rather than judging rows without the parent's homes, when the hand-down is unreadable", async () => {
    const home = homeWith({ recipeIds: ["free-row"], subjects: ["another-row"] });
    process.env[CALLER_GATE_HOMES_ENV] = "not json";
    const injected = deps();

    const code = await runDueUnderFake({
      argv: ["node", "slopweaver", "automation", "run-due", "--home", home],
      deps: injected,
    });

    expect(code).toBe(EXIT_ERROR);
    expect(injected.dispatched).toEqual([]);
  });
});

/** Where a home's per-row run stamps live. */
function runsPath({ home }: { home: string }): string {
  return stateHomePaths({ home }).live.recipe.definitionRunsJson;
}
