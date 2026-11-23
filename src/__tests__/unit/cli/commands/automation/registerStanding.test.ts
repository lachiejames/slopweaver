import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  registerStandingRows,
  runRecipeRegisterStanding,
} from "../../../../../cli/commands/automation/registerStanding.js";
import { registerPass } from "../../../../../cli/commands/automation/registerStandingPass.js";
import { SOURCE_REPOSITORY } from "../../../../../hygiene/ownRepository.js";
import { unwrap } from "../../../../../lib/result.js";
import { loadRecipeDefinitions } from "../../../../../live/automation/definitionStore.js";
import { readOwnRepositories } from "../../../../../live/automation/ownRepositoryStore.js";
import { ownRepositoryStandingRows } from "../../../../../live/automation/standingOwnRepositoryRows.js";
import { supersededStandingRows } from "../../../../../live/automation/standingRowSupersession.js";
import { GENERIC_STANDING_ROWS } from "../../../../../live/automation/standingRows.js";
import { teamStandingRows } from "../../../../../live/automation/teamStandingRows.js";
import { stateHomePaths } from "../../../../../stateHome.js";
import { declareMainCheckouts, originsAt, plainCheckout } from "../../../../ownRepositoryFixture.js";

/** The daily row an install holds from before the hourly declaration, exactly as it stands on disk. */
const DAILY_BYTES =
  '{"cadence":"0 4 * * *","destination":{"kind":"local-atlas"},"effect":"read-write","enabled":true,' +
  '"kind":"verb-run","onMissed":"skip","params":{"argv":["worktree","prune","--apply"]},' +
  '"recipeId":"worktree-prune","schemaVersion":1}\n';

let home = "";

/**
 * Two declared checkouts every case reads and none writes, their origins answered by a fake: git is exercised by
 * `live/automation/ownRepository.test.ts`'s one real witness, and a git spawn per read is what made this file flake.
 */
let acmeCheckout = "";
let widgetsCheckout = "";
let ORIGINS: (args: { cwd: string }) => string | undefined = () => undefined;

beforeAll(() => {
  acmeCheckout = plainCheckout();
  widgetsCheckout = plainCheckout();
  ORIGINS = originsAt({
    origins: [
      { path: acmeCheckout, slug: "acme/slopweaver" },
      { path: widgetsCheckout, slug: "widgets/slopweaver" },
    ],
  });
});

afterAll(() => {
  rmSync(acmeCheckout, { force: true, recursive: true });
  rmSync(widgetsCheckout, { force: true, recursive: true });
});

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "register-standing-"));
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

describe("registerStandingRows over a store holding the daily worktree-prune row", () => {
  beforeEach(() => {
    declareMainCheckouts({ home, paths: [acmeCheckout] });
  });

  it("leaves the store holding the hourly declaration, which the store's own parser reads back", () => {
    const definitionsDir = stateHomePaths({ home }).live.recipe.definitionsDir;
    mkdirSync(definitionsDir, { recursive: true });
    writeFileSync(join(definitionsDir, "worktree-prune.json"), DAILY_BYTES, "utf8");
    const out: string[] = [];
    const exit = registerStandingRows({
      deps: { originOf: ORIGINS, writeDiagnostic: (line) => out.push(line), writeOut: (line) => out.push(line) },
      options: { dryRun: false, home, json: false },
    });
    expect(exit).toBe(0);
    const store = loadRecipeDefinitions({ board: null, directory: definitionsDir });
    const prune = store.definitions.find((definition) => definition.recipeId === "worktree-prune")!;
    expect(prune.cadence).toBe("0 * * * *");
    expect(
      supersededStandingRows({
        declared: GENERIC_STANDING_ROWS,
        existing: store.definitions,
        files: store.definitionFiles,
      }),
    ).toEqual([]);
    expect(out).toContain(
      `wrote worktree-prune · ${join(definitionsDir, "worktree-prune.json")} · over an earlier build's untouched row`,
    );
  });

  it("names the daily row as superseded before the pass — the parsed store matches the earlier shape", () => {
    const definitionsDir = stateHomePaths({ home }).live.recipe.definitionsDir;
    mkdirSync(definitionsDir, { recursive: true });
    writeFileSync(join(definitionsDir, "worktree-prune.json"), DAILY_BYTES, "utf8");
    const store = loadRecipeDefinitions({ board: null, directory: definitionsDir });
    expect(
      supersededStandingRows({
        declared: GENERIC_STANDING_ROWS,
        existing: store.definitions,
        files: store.definitionFiles,
      }),
    ).toEqual([
      { ambiguousFiles: [], declaredCadence: "0 * * * *", recipeId: "worktree-prune", storedCadence: "0 4 * * *" },
    ]);
  });

  it("leaves a paused daily row exactly as it is", () => {
    const definitionsDir = stateHomePaths({ home }).live.recipe.definitionsDir;
    mkdirSync(definitionsDir, { recursive: true });
    const paused = DAILY_BYTES.replace('"enabled":true', '"enabled":false');
    writeFileSync(join(definitionsDir, "worktree-prune.json"), paused, "utf8");
    registerStandingRows({
      deps: { originOf: ORIGINS, writeDiagnostic: () => undefined, writeOut: () => undefined },
      options: { dryRun: false, home, json: false },
    });
    expect(readFileSync(join(definitionsDir, "worktree-prune.json"), "utf8")).toBe(paused);
  });

  it("leaves a daily copy beside the canonical file alone and exits non-zero, the same on every pass", () => {
    const definitionsDir = stateHomePaths({ home }).live.recipe.definitionsDir;
    mkdirSync(definitionsDir, { recursive: true });
    writeFileSync(join(definitionsDir, "worktree-prune.json"), DAILY_BYTES, "utf8");
    writeFileSync(join(definitionsDir, "zz-copy.json"), DAILY_BYTES, "utf8");
    const pass = (): number =>
      registerStandingRows({
        deps: { originOf: ORIGINS, writeDiagnostic: () => undefined, writeOut: () => undefined },
        options: { dryRun: false, home, json: false },
      });
    expect([pass(), pass()]).toEqual([1, 1]);
    expect(readFileSync(join(definitionsDir, "worktree-prune.json"), "utf8")).toBe(DAILY_BYTES);
    expect(readFileSync(join(definitionsDir, "zz-copy.json"), "utf8")).toBe(DAILY_BYTES);
  });
});

/** One entry-point run against the temp home, every line it printed captured. */
function run({ flags }: { flags: readonly string[] }): { exit: number; out: string[]; diagnostics: string[] } {
  const out: string[] = [];
  const diagnostics: string[] = [];
  const exit = runRecipeRegisterStanding({
    argv: ["node", "slopweaver", "automation", "register-standing", ...flags, "--home", home],
    deps: { originOf: ORIGINS, writeDiagnostic: (line) => diagnostics.push(line), writeOut: (line) => out.push(line) },
  });
  return { diagnostics, exit, out };
}

const REGISTER_ACME = ["--repo", "acme/acme-admin"];

/** The registry bytes a registration of the synthetic team repository writes. */
const ACME_REGISTRY =
  '{\n  "schemaVersion": 2,\n  "repositories": [\n    {\n      "repository": "acme/acme-admin"\n    }\n  ]\n}\n';

/** Every definition file the temp home holds, sorted. */
function definitionFiles(): readonly string[] {
  return readdirSync(stateHomePaths({ home }).live.recipe.definitionsDir).toSorted();
}

/** The argv a stored own-repository row carries, read from the file a pass wrote. */
function storedArgv({ recipeId }: { readonly recipeId: string }): unknown {
  const path = join(stateHomePaths({ home }).live.recipe.definitionsDir, `${recipeId}.json`);
  return (JSON.parse(readFileSync(path, "utf8")) as { params: { argv: unknown } }).params.argv;
}

/** Write the two own-repository rows as a pass on one address would have, byte for byte. */
function seedOwnRows({ repository }: { readonly repository: string }): void {
  const definitionsDir = stateHomePaths({ home }).live.recipe.definitionsDir;
  mkdirSync(definitionsDir, { recursive: true });
  for (const row of ownRepositoryStandingRows({ repository, supersededRepositories: [] })) {
    writeFileSync(
      join(definitionsDir, `${row.definition.recipeId}.json`),
      `${JSON.stringify(row.definition)}\n`,
      "utf8",
    );
  }
}

describe("automation register-standing and this install's own repository", () => {
  it("writes every other row on a home declaring no checkout, says why, and exits non-zero", () => {
    const result = run({ flags: [] });
    expect(result.exit).toBe(1);
    expect(definitionFiles()).toEqual(GENERIC_STANDING_ROWS.map((row) => `${row.definition.recipeId}.json`).toSorted());
    expect(result.diagnostics).toEqual([
      "automation register-standing · OWN REPOSITORY UNRESOLVED — bump-drive-slopweaver and bump-fix-slopweaver are " +
        "not declared on this install, and a stored copy of either still fires as written, compared with nothing: no declared main checkout has a " +
        "repository named slopweaver as its `origin`, and a bare name is never read as a directory — pass an " +
        "absolute path, or ./slopweaver for one relative to here. Declared: none",
    ]);
    expect(existsSync(stateHomePaths({ home }).live.recipe.ownRepositoriesJson)).toBe(false);
  });

  it("still says why neither row is declared when the team registry refuses the pass, and writes nothing", () => {
    mkdirSync(stateHomePaths({ home }).live.recipe.root, { recursive: true });
    writeFileSync(stateHomePaths({ home }).live.recipe.teamRepositoriesJson, "{", "utf8");
    const result = run({ flags: [] });
    expect(result.exit).toBe(1);
    expect(existsSync(stateHomePaths({ home }).live.recipe.definitionsDir)).toBe(false);
    expect(
      result.diagnostics.filter((line) =>
        line.startsWith("automation register-standing · OWN REPOSITORY UNRESOLVED — "),
      ).length,
    ).toBe(1);
    expect(result.diagnostics.length).toBe(2);
  });

  it("says the own repository first in the pass itself, then the registry refusal that ends it", () => {
    mkdirSync(stateHomePaths({ home }).live.recipe.root, { recursive: true });
    writeFileSync(stateHomePaths({ home }).live.recipe.retirementsJson, "{", "utf8");
    const diagnostics: string[] = [];
    const exit = registerPass({
      deps: { originOf: ORIGINS, writeDiagnostic: (line) => diagnostics.push(line), writeOut: () => undefined },
      options: { dryRun: false, home, json: false },
    });
    expect(exit).toBe(1);
    expect(diagnostics.length).toBe(2);
    expect(diagnostics[0]).toMatch(/^automation register-standing · OWN REPOSITORY UNRESOLVED — /u);
    expect(diagnostics[1]).toContain(stateHomePaths({ home }).live.recipe.retirementsJson);
  });

  it("writes both rows on the declared checkout's origin and records the address", () => {
    declareMainCheckouts({ home, paths: [acmeCheckout] });
    expect(run({ flags: [] }).exit).toBe(0);
    expect(storedArgv({ recipeId: "bump-drive-slopweaver" })).toEqual([
      "github",
      "bump-drive",
      "--repo",
      "acme/slopweaver",
    ]);
    expect(storedArgv({ recipeId: "bump-fix-slopweaver" })).toEqual([
      "github",
      "bump-drive",
      "--repo",
      "acme/slopweaver",
      "--dry-run",
    ]);
    expect(unwrap(readOwnRepositories({ home }))).toEqual(["acme/slopweaver"]);
  });

  it("brings a row holding the compiled-in address forward, the install this defect was found on", () => {
    seedOwnRows({ repository: SOURCE_REPOSITORY });
    declareMainCheckouts({ home, paths: [acmeCheckout] });
    const result = run({ flags: [] });
    expect(result.exit).toBe(0);
    expect(storedArgv({ recipeId: "bump-fix-slopweaver" })).toEqual([
      "github",
      "bump-drive",
      "--repo",
      "acme/slopweaver",
      "--dry-run",
    ]);
    expect(result.out).toContain(
      `wrote bump-fix-slopweaver · ${join(stateHomePaths({ home }).live.recipe.definitionsDir, "bump-fix-slopweaver.json")} · over an earlier build's untouched row`,
    );
  });

  it("follows a later origin move from the recorded address, and settles on a repeat", () => {
    declareMainCheckouts({ home, paths: [acmeCheckout] });
    expect(run({ flags: [] }).exit).toBe(0);
    declareMainCheckouts({ home, paths: [widgetsCheckout] });
    expect(run({ flags: [] }).exit).toBe(0);
    expect(storedArgv({ recipeId: "bump-drive-slopweaver" })).toEqual([
      "github",
      "bump-drive",
      "--repo",
      "widgets/slopweaver",
    ]);
    expect(unwrap(readOwnRepositories({ home }))).toEqual(["acme/slopweaver", "widgets/slopweaver"]);
    expect(run({ flags: [] }).out).toContain("-- bump-drive-slopweaver · already in the store");
  });

  it("records no address for rows it found rather than wrote, so a later move leaves them alone", () => {
    seedOwnRows({ repository: "acme/slopweaver" });
    declareMainCheckouts({ home, paths: [acmeCheckout] });
    expect(run({ flags: [] }).exit).toBe(0);
    expect(existsSync(stateHomePaths({ home }).live.recipe.ownRepositoriesJson)).toBe(false);

    declareMainCheckouts({ home, paths: [widgetsCheckout] });
    expect(run({ flags: [] }).exit).toBe(0);
    expect(storedArgv({ recipeId: "bump-drive-slopweaver" })).toEqual([
      "github",
      "bump-drive",
      "--repo",
      "acme/slopweaver",
    ]);
  });

  it("leaves a row on a repository no build wrote exactly as it is", () => {
    seedOwnRows({ repository: "someone/slopweaver" });
    const path = join(stateHomePaths({ home }).live.recipe.definitionsDir, "bump-drive-slopweaver.json");
    const before = readFileSync(path, "utf8");
    declareMainCheckouts({ home, paths: [acmeCheckout] });
    run({ flags: [] });
    expect(readFileSync(path, "utf8")).toBe(before);
    expect(before).toContain("someone/slopweaver");
  });

  it("records no address on --dry-run, and names the row it would write", () => {
    declareMainCheckouts({ home, paths: [acmeCheckout] });
    const result = run({ flags: ["--dry-run"] });
    expect(result.exit).toBe(0);
    expect(result.out).toContain(
      `would write bump-fix-slopweaver · ${join(stateHomePaths({ home }).live.recipe.definitionsDir, "bump-fix-slopweaver.json")}`,
    );
    expect(existsSync(stateHomePaths({ home }).live.recipe.root)).toBe(false);
  });
});

describe("automation register-standing with a team repository", () => {
  beforeEach(() => {
    declareMainCheckouts({ home, paths: [acmeCheckout] });
  });

  it("writes the generic and own-repository rows on a home with no registration, and no registry", () => {
    const result = run({ flags: [] });
    expect(result.exit).toBe(0);
    expect(definitionFiles()).toEqual(
      [
        ...GENERIC_STANDING_ROWS.map((row) => `${row.definition.recipeId}.json`),
        "bump-drive-slopweaver.json",
        "bump-fix-slopweaver.json",
      ].toSorted(),
    );
    expect(existsSync(stateHomePaths({ home }).live.recipe.teamRepositoriesJson)).toBe(false);
  });

  it("registers the repository, then writes its two rows beside the generic ones and no top-up", () => {
    const result = run({ flags: REGISTER_ACME });
    expect(result.exit).toBe(0);
    expect(result.out[0]).toBe("automation register-standing · registered team repository acme/acme-admin");
    expect(readFileSync(stateHomePaths({ home }).live.recipe.teamRepositoriesJson, "utf8")).toBe(ACME_REGISTRY);
    expect(definitionFiles().filter((file) => file.includes("acme-admin"))).toEqual([
      "bump-drive-acme-admin.json",
      "error-tracking-batch-acme-admin.json",
    ]);
  });

  it("is a no-op on a repeat, the registry's bytes unchanged", () => {
    run({ flags: REGISTER_ACME });
    const again = run({ flags: REGISTER_ACME });
    expect(again.exit).toBe(0);
    expect(again.out[0]).toBe("automation register-standing · already registered team repository acme/acme-admin");
    expect(readFileSync(stateHomePaths({ home }).live.recipe.teamRepositoriesJson, "utf8")).toBe(ACME_REGISTRY);
  });

  it("writes neither the registry nor a definition on --dry-run, and says what it would register", () => {
    const result = run({ flags: [...REGISTER_ACME, "--dry-run"] });
    expect(result.exit).toBe(0);
    expect(result.out[0]).toBe("automation register-standing · would register team repository acme/acme-admin");
    expect(result.out).toContain(
      `would write bump-drive-acme-admin · ${join(stateHomePaths({ home }).live.recipe.definitionsDir, "bump-drive-acme-admin.json")}`,
    );
    expect(existsSync(stateHomePaths({ home }).live.recipe.root)).toBe(false);
  });

  it("refuses a malformed registry with nothing written, never reading it as none registered", () => {
    const registry = stateHomePaths({ home }).live.recipe.teamRepositoriesJson;
    mkdirSync(stateHomePaths({ home }).live.recipe.root, { recursive: true });
    writeFileSync(registry, "{", "utf8");
    const result = run({ flags: REGISTER_ACME });
    expect(result.exit).toBe(1);
    expect(result.diagnostics.length).toBe(1);
    expect(result.diagnostics[0]).toContain(
      `automation register-standing · the team repository registry at ${registry} is malformed: `,
    );
    expect(readFileSync(registry, "utf8")).toBe("{");
    expect(existsSync(stateHomePaths({ home }).live.recipe.definitionsDir)).toBe(false);
  });

  it("refuses the retired top-up actor flags as unknown, before touching the filesystem", () => {
    const author = run({ flags: [...REGISTER_ACME, "--author", "someone"] });
    const renovate = run({ flags: [...REGISTER_ACME, "--renovate-author", "app/renovate"] });
    expect([author.exit, renovate.exit]).toEqual([2, 2]);
    expect(author.diagnostics[0]).toBe("unknown flag: --author");
    expect(renovate.diagnostics[0]).toBe("unknown flag: --renovate-author");
    expect(existsSync(stateHomePaths({ home }).live.recipe.root)).toBe(false);
  });

  it("refuses a repository that is not one owner/name pair before touching the filesystem", () => {
    const result = run({ flags: ["--repo", "acme-admin"] });
    expect(result.exit).toBe(2);
    expect(result.diagnostics[0]).toBe("--repo: one `owner/name` pair with no whitespace");
    expect(existsSync(stateHomePaths({ home }).live.recipe.root)).toBe(false);
  });

  it("leaves an install's existing team rows, and its own top-up definition, byte for byte as they were", () => {
    const definitionsDir = stateHomePaths({ home }).live.recipe.definitionsDir;
    mkdirSync(definitionsDir, { recursive: true });
    const [drive] = teamStandingRows({ repository: "acme/acme-admin" });
    const topup = {
      ...drive!.definition,
      params: { argv: ["vulnerability-fix", "topup", "--repo", "acme/acme-admin", "--title-contains", "(CVSS "] },
      recipeId: "vulnerability-fix-topup-acme-admin",
    };
    const seeded = [...teamStandingRows({ repository: "acme/acme-admin" }).map((row) => row.definition), topup].map(
      (definition) => {
        const path = join(definitionsDir, `${definition.recipeId}.json`);
        const bytes = `${JSON.stringify(definition)}\n`;
        writeFileSync(path, bytes, "utf8");
        return { bytes, path, recipeId: definition.recipeId };
      },
    );
    const result = run({ flags: REGISTER_ACME });
    expect(result.exit).toBe(0);
    expect(seeded.map((file) => readFileSync(file.path, "utf8"))).toEqual(seeded.map((file) => file.bytes));
    expect(seeded.map((file) => result.out.includes(`-- ${file.recipeId} · already in the store`))).toEqual([
      true,
      true,
      false,
    ]);
  });
});
