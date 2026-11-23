/**
 * The `subset` verbs' shells: the exit codes, and the two refusals that are the only thing standing between
 * a mistyped `--out` and the corpus it was slicing.
 */
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  runSubsetBuild,
  runSubsetStatus,
  subsetBuildCommand,
  subsetStatusCommand,
} from "../../../../../cli/commands/subset/run.js";
import { EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import { bronzeSourceDir } from "../../../../../corpus/corpusPaths.js";

// Every fixture directory this file has minted, so `afterEach` can remove them.
const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

function freshHome(): string {
  const dir = mkdtempSync(join(tmpdir(), "subset-run-"));
  fixtureDirs.push(dir);
  return dir;
}

/** A source home carrying one real bronze line, so a build has something to slice. */
function homeWithBronze(): string {
  const home = freshHome();
  mkdirSync(bronzeSourceDir({ home, source: "github" }), { recursive: true });
  writeFileSync(
    join(bronzeSourceDir({ home, source: "github" }), "w.jsonl"),
    `${JSON.stringify({
      container: "o/r",
      kind: "pr",
      refs: [],
      source: "github",
      sourceId: "#1",
      text: "body",
      tsIso: new Date().toISOString(),
      url: "https://example.invalid/1",
    })}\n`,
    "utf8",
  );
  return home;
}

function buildArgv({ tail }: { tail: readonly string[] }): readonly string[] {
  return ["node", "slopweaver", "subset", "build", ...tail];
}

function statusArgv({ tail }: { tail: readonly string[] }): readonly string[] {
  return ["node", "slopweaver", "subset", "status", ...tail];
}

describe("runSubsetBuild", () => {
  it("exits OK on --help", () => {
    expect(runSubsetBuild(buildArgv({ tail: ["--help"] }))).toBe(EXIT_OK);
  });

  it("REFUSES a build with no --out", () => {
    expect(runSubsetBuild(buildArgv({ tail: ["--home", freshHome()] }))).toBe(EXIT_USAGE);
  });

  it("REFUSES an unknown flag", () => {
    expect(runSubsetBuild(buildArgv({ tail: ["--definitely-not-a-real-flag"] }))).toBe(EXIT_USAGE);
  });

  it("reports a source home with no bronze as EXPECTED_EMPTY, not as success and not as an error", () => {
    const out = join(freshHome(), "sub");
    expect(runSubsetBuild(buildArgv({ tail: ["--home", freshHome(), "--out", out] }))).toBe(EXIT_EXPECTED_EMPTY);
    expect(existsSync(out)).toBe(false);
  });

  it("REFUSES to write into the home it is slicing", () => {
    const home = homeWithBronze();
    expect(runSubsetBuild(buildArgv({ tail: ["--home", home, "--out", home] }))).toBe(EXIT_USAGE);
  });

  it("REFUSES a destination that already holds a corpus", () => {
    const home = homeWithBronze();
    const out = homeWithBronze();
    expect(runSubsetBuild(buildArgv({ tail: ["--home", home, "--out", out] }))).toBe(EXIT_USAGE);
  });

  it("builds a subset home and leaves the source home untouched", () => {
    const home = homeWithBronze();
    const before = readdirSync(home);
    const out = join(freshHome(), "sub");
    expect(runSubsetBuild(buildArgv({ tail: ["--home", home, "--out", out, "--limit", "1"] }))).toBe(EXIT_OK);
    expect(existsSync(join(out, "corpus", ".subset.json"))).toBe(true);
    expect(readdirSync(home)).toEqual(before);
  });
});

describe("runSubsetStatus", () => {
  it("exits OK on --help", () => {
    expect(runSubsetStatus(statusArgv({ tail: ["--help"] }))).toBe(EXIT_OK);
  });

  it("exits OK on a FULL corpus home — not being a subset is an answer, not a failure", () => {
    expect(runSubsetStatus(statusArgv({ tail: ["--home", freshHome()] }))).toBe(EXIT_OK);
  });

  it("exits OK on a real subset home", () => {
    const out = join(freshHome(), "sub");
    runSubsetBuild(buildArgv({ tail: ["--home", homeWithBronze(), "--out", out, "--limit", "1"] }));
    expect(runSubsetStatus(statusArgv({ tail: ["--home", out, "--json"] }))).toBe(EXIT_OK);
  });

  it("REFUSES an unknown flag", () => {
    expect(runSubsetStatus(statusArgv({ tail: ["--definitely-not-a-real-flag"] }))).toBe(EXIT_USAGE);
  });
});

describe("the manifest-selected handlers", () => {
  it("are the run functions themselves, carrying no metadata of their own", () => {
    expect(subsetBuildCommand).toBe(runSubsetBuild);
    expect(subsetStatusCommand).toBe(runSubsetStatus);
    expect(Object.hasOwn(subsetBuildCommand, "meta")).toBe(false);
  });
});
