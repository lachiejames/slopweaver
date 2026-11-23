/*
 * `atlas linear report` and `atlas linear reset`: the branches that end BEFORE the published generation is
 * read or archived. Help succeeds, and an unknown flag or a missing or wrong `--confirm archive` is a usage
 * refusal, so none of these reaches the home, the clock or the filesystem. The registry rows are held to these
 * exact exports. Exit codes are asserted as literals, because a harness reads the number, not the constant's
 * name.
 */
import { describe, expect, it } from "vitest";

import { LINEAR_ATLAS_REGISTRATION } from "../../../../../atlas/linear/registration.js";
import { linearReportCommand, linearResetCommand } from "../../../../../cli/commands/atlas/linearGenerationRun.js";

/** The full process argv the router hands the verb, ending in the given tail. */
const argvWith = ({ verb, tail }: { verb: "report" | "reset"; tail: readonly string[] }): readonly string[] => [
  "node",
  "slopweaver",
  "atlas",
  "linear",
  verb,
  ...tail,
];

describe("linearReportCommand", () => {
  it("answers --help with exit 0", () => {
    expect(linearReportCommand(argvWith({ tail: ["--help"], verb: "report" }))).toBe(0);
  });

  it("refuses an unknown flag as a usage error, exit 2", () => {
    expect(linearReportCommand(argvWith({ tail: ["--force"], verb: "report" }))).toBe(2);
  });
});

describe("linearResetCommand", () => {
  it("answers -h with exit 0, even beside an otherwise-complete confirmation", () => {
    expect(linearResetCommand(argvWith({ tail: ["--confirm", "archive", "-h"], verb: "reset" }))).toBe(0);
  });

  it("refuses a run with no --confirm as a usage error, exit 2", () => {
    expect(linearResetCommand(argvWith({ tail: [], verb: "reset" }))).toBe(2);
  });

  it("refuses a --confirm value other than archive as a usage error, exit 2", () => {
    expect(linearResetCommand(argvWith({ tail: ["--confirm", "yes"], verb: "reset" }))).toBe(2);
  });

  it("refuses an unknown flag as a usage error even beside a valid confirmation, exit 2", () => {
    expect(linearResetCommand(argvWith({ tail: ["--confirm", "archive", "--force"], verb: "reset" }))).toBe(2);
  });
});

describe("the linear registry rows for report and reset", () => {
  it("load exactly these two commands", async () => {
    const loaded = await Promise.all(
      LINEAR_ATLAS_REGISTRATION.verbs
        .filter((row) => row.verb === "report" || row.verb === "reset")
        .map(async (row) => ({ command: await row.load(), verb: row.verb })),
    );
    expect(loaded).toEqual([
      { command: linearReportCommand, verb: "report" },
      { command: linearResetCommand, verb: "reset" },
    ]);
  });
});
