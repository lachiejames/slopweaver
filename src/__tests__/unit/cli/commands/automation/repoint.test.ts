/**
 * `automation repoint` over a real throwaway home: a store holding both own-repository rows turned off and on an
 * earlier slug reads as REPOSITORY DRIFT in `automation due`, each repoint moves one row's `--repo` and keeps
 * `enabled: false`, and the report is clean afterwards. Nothing touches the ambient `$SLOPWEAVER_HOME`, and no
 * automation is toggled or run: the rows are read, never fired.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { type RecipeDueDeps, reportDueAsks } from "../../../../../cli/commands/automation/due.js";
import {
  type RepointDeps,
  repointAutomation,
  runRecipeRepoint,
  writePlan,
} from "../../../../../cli/commands/automation/repoint.js";
import { RepointRunErrors } from "../../../../../cli/commands/automation/repointRunErrors.js";
import { unwrapErr } from "../../../../../lib/result.js";
import { ownRepositoryStandingRows } from "../../../../../live/automation/standingOwnRepositoryRows.js";
import { stateHomePaths } from "../../../../../stateHome.js";
import { declareMainCheckouts, originsAt, plainCheckout } from "../../../../ownRepositoryFixture.js";

const NOW_ISO = "2026-11-21T16:06:00.000Z";

/** The slug this install's rows were written on before its checkout moved. */
const EARLIER = "acme-old-org/slopweaver";

let home = "";
let checkout = "";
let out: string[] = [];
let diagnostics: string[] = [];
let origin = "acme/slopweaver";

beforeAll(() => {
  checkout = plainCheckout();
});

afterAll(() => {
  rmSync(checkout, { force: true, recursive: true });
});

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "recipe-repoint-"));
  out = [];
  diagnostics = [];
  origin = "acme/slopweaver";
  declareMainCheckouts({ home, paths: [checkout] });
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

/** The checkout's origin, read through the fake so a test can move it. */
function originOf({ cwd }: { cwd: string }): string | undefined {
  return originsAt({ origins: [{ path: checkout, slug: origin }] })({ cwd });
}

/** The repoint's injected edges: a frozen clock, the fake origin and two collectors. */
function deps(): RepointDeps {
  return {
    now: () => NOW_ISO,
    originOf,
    writeDiagnostic: (line) => {
      diagnostics.push(line);
    },
    writeOut: (line) => {
      out.push(line);
    },
  };
}

/** What `automation due` prints for each own row that is drift or superseded, as `<recipeId> <verdict>`. */
function dueVerdicts(): readonly string[] {
  const lines: string[] = [];
  const dueDeps: RecipeDueDeps = {
    now: () => NOW_ISO,
    originOf,
    processAlive: () => true,
    tickResyncIds: [],
    writeDiagnostic: () => undefined,
    writeOut: (line) => {
      lines.push(line);
    },
  };
  reportDueAsks({ deps: dueDeps, options: { home, json: false } });
  return lines.flatMap((line) => {
    const verdict = /^!! (bump-(?:drive|fix)-slopweaver) · (REPOSITORY DRIFT|SUPERSEDED) —/u.exec(line);
    return verdict === null ? [] : [`${verdict[1]!} ${verdict[2]!}`];
  });
}

/** The definitions directory. */
function definitionsDir(): string {
  return stateHomePaths({ home }).live.recipe.definitionsDir;
}

/** Hold both own rows on one slug, turned on or off, exactly as a person's edit would leave them. */
function holdOwnRows({ repository, enabled }: { readonly repository: string; readonly enabled: boolean }): void {
  mkdirSync(definitionsDir(), { recursive: true });
  for (const row of ownRepositoryStandingRows({ repository, supersededRepositories: [] })) {
    const value = { ...row.definition, enabled };
    writeFileSync(join(definitionsDir(), `${row.definition.recipeId}.json`), `${JSON.stringify(value)}\n`, "utf8");
  }
}

/** One stored row's file, parsed. */
function stored({ recipeId }: { readonly recipeId: string }): Record<string, unknown> {
  return JSON.parse(readFileSync(join(definitionsDir(), `${recipeId}.json`), "utf8")) as Record<string, unknown>;
}

/** Repoint one row, as a real or a dry run. */
function repoint({ recipeId, dryRun = false }: { readonly recipeId: string; readonly dryRun?: boolean }): number {
  return repointAutomation({ deps: deps(), options: { dryRun, home, json: false, recipeId } });
}

describe("automation repoint", () => {
  it("corrects both drifted rows turned off on an earlier slug, keeping them off, and due reads clean after", () => {
    holdOwnRows({ enabled: false, repository: EARLIER });
    expect(dueVerdicts()).toEqual(["bump-drive-slopweaver REPOSITORY DRIFT", "bump-fix-slopweaver REPOSITORY DRIFT"]);

    expect(repoint({ recipeId: "bump-drive-slopweaver" })).toBe(0);
    expect(repoint({ recipeId: "bump-fix-slopweaver" })).toBe(0);
    expect(out).toEqual([
      "automation repoint · REPOINTED bump-drive-slopweaver · `acme-old-org/slopweaver` → `acme/slopweaver` in " +
        "bump-drive-slopweaver.json, every other field kept",
      "automation repoint · REPOINTED bump-fix-slopweaver · `acme-old-org/slopweaver` → `acme/slopweaver` in " +
        "bump-fix-slopweaver.json, every other field kept",
    ]);

    expect(dueVerdicts()).toEqual([]);
    const fix = stored({ recipeId: "bump-fix-slopweaver" });
    expect(fix["enabled"]).toBe(false);
    expect(fix["params"]).toEqual({ argv: ["github", "bump-drive", "--repo", "acme/slopweaver", "--dry-run"] });
    expect(fix["cadence"]).toBe("15 8 * * *");
    expect(stored({ recipeId: "bump-drive-slopweaver" })["enabled"]).toBe(false);
  });

  it("previews a dry run and writes nothing, neither the row nor the address history", () => {
    holdOwnRows({ enabled: false, repository: EARLIER });
    const path = join(definitionsDir(), "bump-drive-slopweaver.json");
    const before = readFileSync(path, "utf8");
    expect(repoint({ dryRun: true, recipeId: "bump-drive-slopweaver" })).toBe(0);
    expect(out[0]!.split(" · ")[1]).toBe("WOULD REPOINT bump-drive-slopweaver");
    expect(readFileSync(path, "utf8")).toBe(before);
    expect(existsSync(stateHomePaths({ home }).live.recipe.ownRepositoriesJson)).toBe(false);
  });

  it("records the address it wrote, so a later origin move reads the row as SUPERSEDED, not drift", () => {
    holdOwnRows({ enabled: true, repository: EARLIER });
    expect(repoint({ recipeId: "bump-drive-slopweaver" })).toBe(0);
    origin = "acme-next/slopweaver";
    expect(dueVerdicts()).toEqual(["bump-drive-slopweaver SUPERSEDED", "bump-fix-slopweaver REPOSITORY DRIFT"]);
  });

  it("writes nothing once the lock was taken over, and stops between the history and the row if it goes then", () => {
    holdOwnRows({ enabled: false, repository: EARLIER });
    const path = join(definitionsDir(), "bump-drive-slopweaver.json");
    const before = readFileSync(path, "utf8");
    const plan = {
      afterRepository: "acme/slopweaver",
      beforeRepository: EARLIER,
      contents: "{}\n",
      file: "bump-drive-slopweaver.json",
      recipeId: "bump-drive-slopweaver",
    };
    const history = stateHomePaths({ home }).live.recipe.ownRepositoriesJson;

    const lostFirst = unwrapErr(writePlan({ home, plan, stillHeld: () => false }));
    expect(lostFirst).toEqual(RepointRunErrors.lockLostBeforeHistory());
    expect(existsSync(history)).toBe(false);

    const answers = [true, false];
    const lostSecond = unwrapErr(writePlan({ home, plan, stillHeld: () => answers.shift()! }));
    expect(lostSecond.message).toBe(
      "the definition hold lock was taken over before the write, so another pass holds the store — " +
        "acme/slopweaver is recorded, the row is unchanged; run this again",
    );
    expect(existsSync(history)).toBe(true);
    expect(readFileSync(path, "utf8")).toBe(before);
  });

  it("exits 0 when the report cannot print after the row is written, and says so on stderr", () => {
    holdOwnRows({ enabled: false, repository: EARLIER });
    const closedStdout: RepointDeps = {
      ...deps(),
      writeOut: () => {
        throw new Error("EBADF: bad file descriptor, write");
      },
    };
    const options = { dryRun: false, home, json: false, recipeId: "bump-drive-slopweaver" };
    expect(repointAutomation({ deps: closedStdout, options })).toBe(0);
    expect(diagnostics).toEqual([
      "automation repoint · REPOINTED bump-drive-slopweaver · `acme-old-org/slopweaver` → `acme/slopweaver` in " +
        "bump-drive-slopweaver.json, every other field kept — the report did not print on stdout " +
        "(EBADF: bad file descriptor, write)",
    ]);
    expect(dueVerdicts()).toEqual(["bump-fix-slopweaver REPOSITORY DRIFT"]);
  });

  it("refuses a row already on the declared repository and changes nothing", () => {
    holdOwnRows({ enabled: false, repository: "acme/slopweaver" });
    const before = readFileSync(join(definitionsDir(), "bump-drive-slopweaver.json"), "utf8");
    expect(repoint({ recipeId: "bump-drive-slopweaver" })).toBe(1);
    expect(diagnostics[0]).toContain("automation repoint · bump-drive-slopweaver is not REPOSITORY DRIFT");
    expect(readFileSync(join(definitionsDir(), "bump-drive-slopweaver.json"), "utf8")).toBe(before);
  });

  it("refuses when no checkout resolves, naming why neither row is declared", () => {
    holdOwnRows({ enabled: false, repository: EARLIER });
    declareMainCheckouts({ home, paths: [] });
    expect(repoint({ recipeId: "bump-drive-slopweaver" })).toBe(1);
    expect(diagnostics[0]).toContain("automation repoint · OWN REPOSITORY UNRESOLVED");
  });

  it("answers --json with the move, and usage with exit 2 when no recipe id is given", () => {
    holdOwnRows({ enabled: false, repository: EARLIER });
    const options = { dryRun: true, home, json: true, recipeId: "bump-fix-slopweaver" };
    expect(repointAutomation({ deps: deps(), options })).toBe(0);
    expect(JSON.parse(out[0]!)).toEqual({
      afterRepository: "acme/slopweaver",
      beforeRepository: "acme-old-org/slopweaver",
      dryRun: true,
      file: "bump-fix-slopweaver.json",
      recipeId: "bump-fix-slopweaver",
    });
    expect(
      runRecipeRepoint({ argv: ["node", "slopweaver", "automation", "repoint", "--home", home], deps: deps() }),
    ).toBe(2);
    expect(diagnostics[0]).toBe("automation repoint needs the drifted row's recipe id, as its one positional argument");
  });
});
