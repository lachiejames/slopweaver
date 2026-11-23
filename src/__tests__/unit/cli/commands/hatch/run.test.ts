import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runHatch } from "../../../../../cli/commands/hatch/run.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import { readHatchGrants } from "../../../../../hatch/grantStore.js";

const homes: string[] = [];

/** A throwaway state home, removed after the test that minted it. */
function newHome(): string {
  const home = mkdtempSync(join(tmpdir(), "slopweaver-hatch-"));
  homes.push(home);
  return home;
}

/** The argv shape the runtime hands a verb: `[node, bin, <noun>, <verb>, …]`. */
function argv({ tail }: { tail: readonly string[] }): readonly string[] {
  return ["node", "bin/slopweaver", "hatch", ...tail];
}

afterEach(() => {
  process.env["CLAUDE_CODE_SESSION_ID"] = undefined;
  for (const home of homes.splice(0)) {
    rmSync(home, { force: true, recursive: true });
  }
});

describe("slopweaver hatch", () => {
  it("records a grant for a journalled row, naming the session and the reason", () => {
    const home = newHome();
    process.env["CLAUDE_CODE_SESSION_ID"] = "session-under-test";
    const code = runHatch(argv({ tail: ["open", "wall", "--reason", "they asked for this sequence", "--home", home] }));
    expect(code).toBe(EXIT_OK);
    const grants = readHatchGrants({ home });
    expect(grants.length).toBe(1);
    expect(grants[0]!.hatchId).toBe("wall");
    expect(grants[0]!.claudeSessionId).toBe("session-under-test");
    expect(grants[0]!.reason).toBe("they asked for this sequence");
  });

  it("refuses an ambient row, and names how to open that one instead", () => {
    const home = newHome();
    process.env["CLAUDE_CODE_SESSION_ID"] = "session-under-test";
    expect(runHatch(argv({ tail: ["open", "dirty-tree", "--reason", "why", "--home", home] }))).toBe(EXIT_ERROR);
    expect(readHatchGrants({ home })).toEqual([]);
  });

  it("refuses a grant with no reason, because the reason is what the lane buys", () => {
    const home = newHome();
    process.env["CLAUDE_CODE_SESSION_ID"] = "session-under-test";
    expect(runHatch(argv({ tail: ["open", "wall", "--home", home] }))).toBe(EXIT_USAGE);
    expect(readHatchGrants({ home })).toEqual([]);
  });

  it("refuses an id the register does not carry", () => {
    const home = newHome();
    process.env["CLAUDE_CODE_SESSION_ID"] = "session-under-test";
    expect(runHatch(argv({ tail: ["open", "not-a-hatch", "--reason", "why", "--home", home] }))).toBe(EXIT_ERROR);
  });

  it("refuses to issue a grant no session can hold", () => {
    const home = newHome();
    delete process.env["CLAUDE_CODE_SESSION_ID"];
    expect(runHatch(argv({ tail: ["open", "wall", "--reason", "why", "--home", home] }))).toBe(EXIT_ERROR);
    expect(readHatchGrants({ home })).toEqual([]);
  });

  it("lists the journalled rows without writing anything", () => {
    const home = newHome();
    process.env["CLAUDE_CODE_SESSION_ID"] = "session-under-test";
    expect(runHatch(argv({ tail: ["list", "--home", home] }))).toBe(EXIT_OK);
    expect(readHatchGrants({ home })).toEqual([]);
  });

  it("answers --help without touching the journal", () => {
    expect(runHatch(argv({ tail: ["open", "--help"] }))).toBe(EXIT_OK);
  });
});
