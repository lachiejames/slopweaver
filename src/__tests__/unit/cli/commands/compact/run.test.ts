import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { compactRunCommand, runCompact } from "../../../../../cli/commands/compact/run.js";
import { EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";

// Every fixture directory this file has minted, so `afterEach` can remove them.
const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

function freshHome(): string {
  const dir = mkdtempSync(join(tmpdir(), "compact-run-"));
  fixtureDirs.push(dir);
  return dir;
}

function argv({ tail }: { tail: readonly string[] }): readonly string[] {
  return ["node", "slopweaver", "compact", ...tail];
}

describe("runCompact", () => {
  it("exits OK on --help", () => {
    expect(runCompact(argv({ tail: ["--help"] }))).toBe(EXIT_OK);
  });

  it("reports an empty corpus as EXPECTED_EMPTY, not as success and not as an error", () => {
    // The distinction is the point: "nothing to compact" is a true, uninteresting answer, and collapsing it
    // into EXIT_OK would make a no-op indistinguishable from real work having happened.
    const home = freshHome();
    expect(runCompact(argv({ tail: ["--home", home] }))).toBe(EXIT_EXPECTED_EMPTY);
  });

  it("writes nothing into a home with no bronze", () => {
    const home = freshHome();
    runCompact(argv({ tail: ["--home", home] }));
    expect(readdirSync(home)).toEqual([]);
  });

  it("REFUSES an unknown flag", () => {
    expect(runCompact(argv({ tail: ["--definitely-not-a-real-flag"] }))).toBe(EXIT_USAGE);
  });
});

describe("the manifest-selected handler", () => {
  it("is the run function itself, carrying no metadata of its own", () => {
    expect(compactRunCommand).toBe(runCompact);
    expect(Object.hasOwn(compactRunCommand, "meta")).toBe(false);
  });
});
