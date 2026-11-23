import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { initRunCommand, runInitCommand } from "../../../../../cli/commands/init/run.js";
import { EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import { homeFingerprint } from "../../../../homeFingerprint.js";

// Every fixture directory this file has minted, so `afterEach` can remove them.
const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

function freshHome(): string {
  const home = mkdtempSync(join(tmpdir(), "init-run-"));
  fixtureDirs.push(home);
  return home;
}

function argv({ tail }: { tail: readonly string[] }): readonly string[] {
  return ["node", "slopweaver", "init", ...tail];
}

describe("runInitCommand", () => {
  it("exits OK on --help and scaffolds nothing", () => {
    const home = freshHome();
    expect(runInitCommand(argv({ tail: ["--help", "--home", home] }))).toBe(EXIT_OK);
    expect(readdirSync(home)).toEqual([]);
  });

  it("scaffolds the state home", () => {
    const home = freshHome();
    expect(runInitCommand(argv({ tail: ["--home", home] }))).toBe(EXIT_OK);
    expect(readdirSync(home).length > 0).toBe(true);
  });

  it("is idempotent — a second run changes nothing", () => {
    // Fingerprinted recursively, not by a top-level listing. A listing cannot see a scaffolded file being
    // rewritten or appended to, so it stays green while idempotency regresses — a review pass produced
    // exactly that counterexample for this test after the identical flaw had been fixed in the seed suite.
    const home = freshHome();
    runInitCommand(argv({ tail: ["--home", home] }));
    const first = homeFingerprint({ home });
    expect(runInitCommand(argv({ tail: ["--home", home] }))).toBe(EXIT_OK);
    expect(homeFingerprint({ home })).toEqual(first);
  });

  it("tolerates the bare-noun alias token as a positional", () => {
    const home = freshHome();
    expect(runInitCommand(argv({ tail: ["run", "--home", home] }))).toBe(EXIT_OK);
  });

  it("REFUSES an unknown flag rather than scaffolding anyway", () => {
    const home = freshHome();
    expect(runInitCommand(argv({ tail: ["--nope", "--home", home] }))).toBe(EXIT_USAGE);
    expect(readdirSync(home)).toEqual([]);
  });
});

describe("the manifest-selected handler", () => {
  it("is the run function itself, carrying no metadata of its own", () => {
    expect(initRunCommand).toBe(runInitCommand);
    expect(Object.hasOwn(initRunCommand, "meta")).toBe(false);
  });
});
