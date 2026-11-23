import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { runSeed, seedRunCommand } from "../../../../../cli/commands/seed/run.js";
import { EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import { cacheDir } from "../../../../../corpus/corpusPaths.js";
import { homeFingerprint } from "../../../../homeFingerprint.js";

// Every fixture directory this file has minted, so `afterEach` can remove them.
const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

function freshHome(): string {
  const dir = mkdtempSync(join(tmpdir(), "seed-run-"));
  fixtureDirs.push(dir);
  return dir;
}

function argv({ tail }: { tail: readonly string[] }): readonly string[] {
  return ["node", "slopweaver", "seed", ...tail];
}

describe("runSeed", () => {
  it("exits OK on --help and writes nothing", () => {
    const home = freshHome();
    expect(runSeed(argv({ tail: ["--help", "--home", home] }))).toBe(EXIT_OK);
    expect(readdirSync(home)).toEqual([]);
  });

  it("REFUSES a bare invocation rather than guessing that you meant --demo", () => {
    const home = freshHome();
    expect(runSeed(argv({ tail: ["--home", home] }))).toBe(EXIT_USAGE);
    expect(readdirSync(home)).toEqual([]);
  });

  it("REFUSES an unknown flag and writes nothing", () => {
    const home = freshHome();
    expect(runSeed(argv({ tail: ["--demo", "--nope", "--home", home] }))).toBe(EXIT_USAGE);
    expect(readdirSync(home)).toEqual([]);
  });

  it("writes the demo corpus into the home it was given", () => {
    const home = freshHome();
    expect(runSeed(argv({ tail: ["--demo", "--home", home] }))).toBe(EXIT_OK);
    expect(readdirSync(home).length > 0).toBe(true);
  });

  it("builds NO index, because an owner ruling left none to build", () => {
    // The cache directory is where the retired lexical and vector artefacts used to land. `runInit`
    // scaffolds it, so the property is that `seed` leaves it EMPTY: writing an artefact now would be
    // writing something no reader opens — the demo's reading half goes through the store.
    const home = freshHome();
    expect(runSeed(argv({ tail: ["--demo", "--home", home] }))).toBe(EXIT_OK);
    expect(readdirSync(cacheDir({ home }))).toEqual([]);
  });

  it("DEDUPES on a second run rather than doubling the corpus", () => {
    // The demo records are fixed, so a second seed must add nothing. If it appended blindly, every re-seed
    // would silently inflate the corpus the rest of the pipeline is measured against.
    //
    // Observed as recursive file SIZES, not a top-level directory listing. The first version of this test
    // compared `readdirSync(home)` before and after, which cannot see records appended inside an existing
    // nested file — it would have stayed green while the corpus doubled. A review pass produced exactly that
    // counterexample.
    const home = freshHome();
    runSeed(argv({ tail: ["--demo", "--home", home] }));
    const before = homeFingerprint({ home });
    expect(runSeed(argv({ tail: ["--demo", "--home", home] }))).toBe(EXIT_OK);
    expect(homeFingerprint({ home })).toEqual(before);
  });
});

describe("the manifest-selected handler", () => {
  it("is the run function itself, carrying no metadata of its own", () => {
    expect(seedRunCommand).toBe(runSeed);
    expect(Object.hasOwn(seedRunCommand, "meta")).toBe(false);
  });
});
