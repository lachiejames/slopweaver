/**
 * The velocity verb's PARSE-ONLY paths — everything past a valid parse resolves a real repository (via
 * `--repo`/`process.cwd()`) and shells real git, which belongs in the subprocess lane
 * (`src/__tests__/subprocess/velocity/run.test.ts`), never here.
 */
import { describe, expect, it } from "vitest";

import { runVelocity, velocityRunCommand } from "../../../../../cli/commands/velocity/run.js";
import { EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";

function argv({ tail }: { tail: readonly string[] }): readonly string[] {
  return ["node", "slopweaver", "velocity", ...tail];
}

describe("runVelocity", () => {
  it("exits OK on --help without touching a repository", () => {
    expect(runVelocity(argv({ tail: ["--help"] }))).toBe(EXIT_OK);
  });

  it("refuses an unknown flag with EXIT_USAGE", () => {
    expect(runVelocity(argv({ tail: ["--not-a-flag"] }))).toBe(EXIT_USAGE);
  });

  it("refuses a non-integer --days with EXIT_USAGE", () => {
    expect(runVelocity(argv({ tail: ["--days", "zero"] }))).toBe(EXIT_USAGE);
  });

  it("refuses a negative --days with EXIT_USAGE", () => {
    expect(runVelocity(argv({ tail: ["--days", "-1"] }))).toBe(EXIT_USAGE);
  });
});

describe("the manifest-selected handler", () => {
  it("is the run function itself, carrying no metadata of its own", () => {
    expect(velocityRunCommand).toBe(runVelocity);
    expect(Object.hasOwn(velocityRunCommand, "meta")).toBe(false);
  });
});
