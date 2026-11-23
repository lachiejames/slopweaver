/**
 * `automation due` over a real throwaway home and a declared checkout whose origin a fake answers: what the report says about this install's
 * own repository, on every way the declaration can stand. Nothing touches the ambient `$SLOPWEAVER_HOME`.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { type RecipeDueDeps, reportDueAsks } from "../../../../../cli/commands/automation/due.js";
import { ownRepositoryState } from "../../../../../cli/commands/automation/dueDeclared.js";
import { SOURCE_REPOSITORY } from "../../../../../hygiene/ownRepository.js";
import { declaredStandingRows } from "../../../../../live/automation/declaredStandingRows.js";
import { ownRepositoryStandingRows } from "../../../../../live/automation/standingOwnRepositoryRows.js";
import { stateHomePaths } from "../../../../../stateHome.js";
import { declareMainCheckouts, originsAt, plainCheckout } from "../../../../ownRepositoryFixture.js";

const NOW_ISO = "2026-09-08T12:05:00.000Z";

/** How the report opens when no single checkout of this repository resolves. */
const OWN_REPOSITORY_UNRESOLVED = "!! OWN REPOSITORY UNRESOLVED";

let home = "";
let lines: string[] = [];

/**
 * One declared checkout every case reads and none writes, its origin answered by a fake: git is exercised by
 * `live/automation/ownRepository.test.ts`'s one real witness, and a git spawn per read is what made this file flake.
 */
let acmeCheckout = "";
let ORIGINS: (args: { cwd: string }) => string | undefined = () => undefined;

beforeAll(() => {
  acmeCheckout = plainCheckout();
  ORIGINS = originsAt({ origins: [{ path: acmeCheckout, slug: "acme/slopweaver" }] });
});

afterAll(() => {
  rmSync(acmeCheckout, { force: true, recursive: true });
});

/** The injected edges: a frozen clock, the fake origins and one collector. */
function deps(): RecipeDueDeps {
  return {
    now: () => NOW_ISO,
    originOf: ORIGINS,
    processAlive: () => true,
    tickResyncIds: [],
    writeDiagnostic: () => undefined,
    writeOut: (line) => {
      lines.push(line);
    },
  };
}

/** Hold the two rows as a pass on one address wrote them, under a home whose checkout resolves elsewhere. */
function holdOwnRowsOn({ repository }: { readonly repository: string }): void {
  declareMainCheckouts({ home, paths: [acmeCheckout] });
  const dir = stateHomePaths({ home }).live.recipe.definitionsDir;
  mkdirSync(dir, { recursive: true });
  for (const row of ownRepositoryStandingRows({ repository, supersededRepositories: [] })) {
    writeFileSync(join(dir, `${row.definition.recipeId}.json`), JSON.stringify(row.definition), "utf8");
  }
}

/** Put malformed bytes at one registry's path in the throwaway home. */
function corrupt({ path }: { readonly path: string }): void {
  mkdirSync(stateHomePaths({ home }).live.recipe.root, { recursive: true });
  writeFileSync(path, "{", "utf8");
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "recipe-due-own-"));
  lines = [];
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

describe("recipe due and this install's own repository", () => {
  it("opens on why neither row is declared when no checkout resolves, and carries it in the JSON", () => {
    reportDueAsks({ deps: deps(), options: { home, json: false } });
    expect(lines[0]).toBe(
      "!! OWN REPOSITORY UNRESOLVED — bump-drive-slopweaver and bump-fix-slopweaver are not declared on this " +
        "install, and a stored copy of either still fires as written, compared with nothing: no declared main checkout has a repository named " +
        "slopweaver as its `origin`, and a bare name is never read as a directory — pass an absolute path, or " +
        "./slopweaver for one relative to here. Declared: none",
    );

    lines = [];
    reportDueAsks({ deps: deps(), options: { home, json: true } });
    expect((JSON.parse(lines[0]!) as { ownRepository: { code: string; kind: string } }).ownRepository.code).toBe(
      "CHECKOUT_NAME_UNDECLARED",
    );
  });

  it("still opens on the unresolved line when the team registry refuses the whole declaration", () => {
    corrupt({ path: stateHomePaths({ home }).live.recipe.teamRepositoriesJson });
    expect(reportDueAsks({ deps: deps(), options: { home, json: false } })).toBe(0);
    expect(lines.filter((line) => line.startsWith(OWN_REPOSITORY_UNRESOLVED)).length).toBe(1);
    expect(lines.filter((line) => line.startsWith("!! team repositories · ")).length).toBe(1);
  });

  it("still opens on the unresolved line when the retirement registry refuses the whole declaration", () => {
    corrupt({ path: stateHomePaths({ home }).live.recipe.retirementsJson });
    expect(reportDueAsks({ deps: deps(), options: { home, json: false } })).toBe(0);
    expect(lines.filter((line) => line.startsWith(OWN_REPOSITORY_UNRESOLVED)).length).toBe(1);
    expect(lines.filter((line) => line.startsWith("!! retirements · ")).length).toBe(1);
  });

  it("reads the own repository alone when the whole declaration refuses, so the report's field still says why", () => {
    corrupt({ path: stateHomePaths({ home }).live.recipe.teamRepositoriesJson });
    const declared = declaredStandingRows({ home, originOf: ORIGINS });
    expect(declared.isErr()).toBe(true);
    expect(ownRepositoryState({ declared, home, originOf: ORIGINS }).ownRepository).toEqual({
      code: "CHECKOUT_NAME_UNDECLARED",
      kind: "unresolved",
      message:
        "no declared main checkout has a repository named slopweaver as its `origin`, and a bare name is never read " +
        "as a directory — pass an absolute path, or ./slopweaver for one relative to here. Declared: none",
    });

    declareMainCheckouts({ home, paths: [acmeCheckout] });
    expect(ownRepositoryState({ declared, home, originOf: ORIGINS }).ownRepository).toEqual({
      kind: "resolved",
      repository: "acme/slopweaver",
    });
  });

  it("says nothing of the own repository when it resolves and only the team registry refuses", () => {
    declareMainCheckouts({ home, paths: [acmeCheckout] });
    corrupt({ path: stateHomePaths({ home }).live.recipe.teamRepositoriesJson });
    reportDueAsks({ deps: deps(), options: { home, json: false } });
    expect(lines.filter((line) => line.startsWith(OWN_REPOSITORY_UNRESOLVED))).toEqual([]);
    expect(lines.filter((line) => line.startsWith("!! own repositories · "))).toEqual([]);
    expect(lines.filter((line) => line.startsWith("!! team repositories · ")).length).toBe(1);
  });

  it("names both rows ABSENT once a checkout resolves, without the unresolved line", () => {
    declareMainCheckouts({ home, paths: [acmeCheckout] });
    reportDueAsks({ deps: deps(), options: { home, json: false } });
    expect(lines.filter((line) => line.startsWith(OWN_REPOSITORY_UNRESOLVED))).toEqual([]);
    expect(lines.filter((line) => /^!! bump-(drive|fix)-slopweaver · DECLARED/u.test(line)).length).toBe(2);
  });

  it("reads rows on the compiled-in address as SUPERSEDED, the pass's to bring forward, and never as drift", () => {
    holdOwnRowsOn({ repository: SOURCE_REPOSITORY });
    reportDueAsks({ deps: deps(), options: { home, json: false } });
    expect(lines.filter((line) => line.includes("SUPERSEDED —")).map((line) => line.split(" · ")[0])).toEqual([
      "!! bump-drive-slopweaver",
      "!! bump-fix-slopweaver",
    ]);
    expect(lines.filter((line) => line.includes("REPOSITORY DRIFT"))).toEqual([]);
  });

  it("reads rows on a repository no build wrote as REPOSITORY DRIFT, in the lines, the tally and the JSON", () => {
    holdOwnRowsOn({ repository: "someone/slopweaver" });
    reportDueAsks({ deps: deps(), options: { home, json: false } });
    expect(lines.filter((line) => line.includes("REPOSITORY DRIFT —")).map((line) => line.split(" · ")[0])).toEqual([
      "!! bump-drive-slopweaver",
      "!! bump-fix-slopweaver",
    ]);
    expect(lines.at(-1)).toContain(" · 2 REPOSITORY DRIFT");

    lines = [];
    reportDueAsks({ deps: deps(), options: { home, json: true } });
    const report = JSON.parse(lines[0]!) as {
      ownRepository: unknown;
      repositoryDrift: readonly { recipeId: string; storedRepository: string }[];
    };
    expect(report.ownRepository).toEqual({ kind: "resolved", repository: "acme/slopweaver" });
    expect(report.repositoryDrift.map((drift) => [drift.recipeId, drift.storedRepository])).toEqual([
      ["bump-drive-slopweaver", "someone/slopweaver"],
      ["bump-fix-slopweaver", "someone/slopweaver"],
    ]);
  });

  it("says nothing of rows on the resolved address", () => {
    holdOwnRowsOn({ repository: "acme/slopweaver" });
    reportDueAsks({ deps: deps(), options: { home, json: false } });
    expect(lines.filter((line) => line.includes("SUPERSEDED") || line.includes("REPOSITORY DRIFT"))).toEqual([]);
  });

  it("says at the top that an unreadable history left the declaration unknown, and exits 0", () => {
    declareMainCheckouts({ home, paths: [acmeCheckout] });
    const history = stateHomePaths({ home }).live.recipe.ownRepositoriesJson;
    corrupt({ path: history });
    expect(reportDueAsks({ deps: deps(), options: { home, json: false } })).toBe(0);
    expect(lines[0]).toContain(`!! own repositories · the own-repository history at ${history}`);
  });
});
