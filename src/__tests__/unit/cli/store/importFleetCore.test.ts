/**
 * `store import-fleet`'s argument parsing and its report.
 *
 * The cases that matter are the two the shell's exit code turns on: an ABSENT source prints as a fact and
 * a REFUSED record prints its own message. Those are different things, and a verb that conflated them
 * would exit non-zero on a correct state — the grants journal does not exist on a fresh install.
 */
import { describe, expect, it } from "vitest";

import { parseImportFleetArgs } from "../../../../cli/commands/store/importFleetArgs.js";
import { FLEET_LEGS, importFleetLines } from "../../../../cli/commands/store/importFleetCore.js";
import { unwrap, unwrapErr } from "../../../../lib/result.js";
import { FleetImportErrors } from "../../../../store/fleet/errors.js";

/** One leg's outcome, with the fields a case does not care about defaulted. */
function outcome(over: Partial<Parameters<typeof importFleetLines>[0]["report"]["legs"][number]> = {}) {
  return {
    absentSource: undefined,
    leg: "door" as const,
    projected: 0,
    refused: [],
    unreadableLines: 0,
    written: 0,
    ...over,
  };
}

describe("parseImportFleetArgs", () => {
  it("runs every leg when --only is absent", () => {
    const parsed = parseImportFleetArgs({ argv: [] });

    expect(parsed.isOk()).toBe(true);
    expect(unwrap(parsed).legs).toEqual([...FLEET_LEGS]);
  });

  it("accepts the owner-turns leg on its own", () => {
    expect(unwrap(parseImportFleetArgs({ argv: ["--only", "owner-turns"] })).legs).toEqual(["owner-turns"]);
  });

  it("accepts the codex-fallback leg on its own", () => {
    expect(unwrap(parseImportFleetArgs({ argv: ["--only", "codex-fallback"] })).legs).toEqual(["codex-fallback"]);
  });

  it("accepts the authored leg on its own, and runs it last", () => {
    expect(unwrap(parseImportFleetArgs({ argv: ["--only", "authored"] })).legs).toEqual(["authored"]);
    expect(FLEET_LEGS.at(-1)).toBe("authored");
  });

  it("accepts the measurements leg on its own", () => {
    expect(unwrap(parseImportFleetArgs({ argv: ["--only", "measurements"] })).legs).toEqual(["measurements"]);
  });

  it("collects repeated --only flags in the order they were given", () => {
    const parsed = parseImportFleetArgs({ argv: ["--only", "door", "--only", "board"] });

    expect(unwrap(parsed).legs).toEqual(["door", "board"]);
  });

  it("reads --dry-run, --json and --home", () => {
    const parsed = parseImportFleetArgs({ argv: ["--dry-run", "--json", "--home", "/tmp/home"] });

    expect(unwrap(parsed).dryRun).toBe(true);
    expect(unwrap(parsed).json).toBe(true);
    expect(unwrap(parsed).home).toBe("/tmp/home");
  });

  it("refuses a leg it does not have, listing the ones it does", () => {
    const parsed = parseImportFleetArgs({ argv: ["--only", "atlas"] });

    expect(parsed.isOk()).toBe(false);
    expect(unwrapErr(parsed)[0]).toContain("is not a leg");
    expect(unwrapErr(parsed)[0]).toContain(
      "board, runs, codex, dictations, codex-messages, door, autonomy, grants, owner-turns",
    );
  });

  it("reads each captured-turn source flag beside its own leg, and leaves both unset without one", () => {
    const parsed = parseImportFleetArgs({
      argv: ["--only", "dictations", "--dictations", "/r", "--only", "codex-messages", "--codex-home", "/c"],
    });

    expect(unwrap(parsed).dictations).toBe("/r");
    expect(unwrap(parsed).codexHome).toBe("/c");
    expect(unwrap(parseImportFleetArgs({ argv: [] })).dictations).toBe(undefined);
    expect(unwrap(parseImportFleetArgs({ argv: [] })).codexHome).toBe(undefined);
  });

  it("accepts a source flag when every leg runs, which includes its own", () => {
    expect(unwrap(parseImportFleetArgs({ argv: ["--codex-home", "/c"] })).codexHome).toBe("/c");
  });

  it("refuses a source flag whose leg is not running, rather than ignoring it", () => {
    expect(unwrapErr(parseImportFleetArgs({ argv: ["--only", "board", "--dictations", "/r"] }))).toEqual([
      "--dictations names the dictations leg's source, and that leg is not running",
    ]);
    expect(unwrapErr(parseImportFleetArgs({ argv: ["--only", "dictations", "--codex-home", "/c"] }))).toEqual([
      "--codex-home names the codex-messages leg's source, and that leg is not running",
    ]);
  });

  it("refuses a source flag with no directory after it", () => {
    expect(unwrapErr(parseImportFleetArgs({ argv: ["--codex-home"] }))).toEqual(["--codex-home needs a directory"]);
  });

  it("refuses an empty directory, which would read the source relative to the working directory", () => {
    expect(unwrapErr(parseImportFleetArgs({ argv: ["--codex-home", "", "--dictations", ""] }))).toEqual([
      "--codex-home needs a directory",
      "--dictations needs a directory",
    ]);
  });

  it("refuses --home with no directory after it", () => {
    const parsed = parseImportFleetArgs({ argv: ["--home"] });

    expect(unwrapErr(parsed)).toEqual(["--home needs a directory"]);
  });

  it("refuses an argument it does not know, naming it", () => {
    const parsed = parseImportFleetArgs({ argv: ["--force"] });

    expect(unwrapErr(parsed)).toEqual(["unexpected argument: --force"]);
  });

  it("leaves adoption off unless the flag is given", () => {
    expect(unwrap(parseImportFleetArgs({ argv: ["--only", "door"] })).adoptUnmatchedDoorLines).toBe(false);
  });

  it("accepts --adopt-unmatched-door-lines with --only door alone", () => {
    const parsed = parseImportFleetArgs({ argv: ["--only", "door", "--adopt-unmatched-door-lines"] });

    expect(unwrap(parsed).adoptUnmatchedDoorLines).toBe(true);
    expect(unwrap(parsed).legs).toEqual(["door"]);
  });

  it("refuses --adopt-unmatched-door-lines without --only door, or beside another leg", () => {
    const refusal = "--adopt-unmatched-door-lines needs --only door, and no other leg";

    expect(unwrapErr(parseImportFleetArgs({ argv: ["--adopt-unmatched-door-lines"] }))).toEqual([refusal]);
    expect(
      unwrapErr(parseImportFleetArgs({ argv: ["--only", "door", "--only", "board", "--adopt-unmatched-door-lines"] })),
    ).toEqual([refusal]);
  });

  it("refuses --adopt-unmatched-door-lines with --dry-run, which could never find the lines", () => {
    const parsed = parseImportFleetArgs({ argv: ["--only", "door", "--adopt-unmatched-door-lines", "--dry-run"] });

    expect(unwrapErr(parsed)).toEqual([
      "--adopt-unmatched-door-lines cannot run with --dry-run, which opens no connection to find the unmatched lines",
    ]);
  });
});

describe("importFleetLines", () => {
  it("says a dry run wrote nothing, before any leg", () => {
    const lines = importFleetLines({ report: { dryRun: true, legs: [] } });

    expect(lines[0]).toContain("DRY RUN — nothing was written and no connection was opened");
  });

  it("prints a leg's three counts", () => {
    const lines = importFleetLines({
      report: { dryRun: false, legs: [outcome({ projected: 198_099, written: 198_099 })] },
    });

    expect(lines[0]).toBe("door: 198099 projected, 198099 written, 0 refused");
  });

  it("prints an absent source as a fact rather than as a refusal", () => {
    const lines = importFleetLines({
      report: { dryRun: false, legs: [outcome({ absentSource: "/x/grants/journal.jsonl", leg: "grants" })] },
    });

    expect(lines[0]).toBe("grants: nothing to import — /x/grants/journal.jsonl does not exist");
  });

  it("spells each refusal's own message rather than counting them", () => {
    const lines = importFleetLines({
      report: {
        dryRun: false,
        legs: [
          outcome({
            projected: 1,
            refused: [FleetImportErrors.unreadableLine({ lineNumber: 4, path: "/x/door.jsonl" })],
          }),
        ],
      },
    });

    expect(lines[1]).toContain("UNREADABLE_LINE");
    expect(lines[1]).toContain("/x/door.jsonl:4");
  });

  it("caps the spelled refusals and says how many it held back", () => {
    const refused = [1, 2, 3, 4, 5].map((lineNumber) =>
      FleetImportErrors.unreadableLine({ lineNumber, path: "/x/door.jsonl" }),
    );

    const lines = importFleetLines({ report: { dryRun: false, legs: [outcome({ refused })] }, refusalCap: 2 });

    expect(lines.filter((line) => line.includes("UNREADABLE_LINE")).length).toBe(2);
    expect(lines.some((line) => line.includes("and 3 more refusal(s)"))).toBe(true);
  });

  it("prints a leg's own notes under its counts", () => {
    const lines = importFleetLines({
      report: {
        dryRun: false,
        legs: [outcome({ leg: "authored", notes: ["3 authored director(ies), 12 byte(s) read"], projected: 5 })],
      },
    });

    expect(lines.slice(0, 2)).toEqual([
      "authored: 5 projected, 0 written, 0 refused",
      "  3 authored director(ies), 12 byte(s) read",
    ]);
  });

  it("reports journal lines that did not decode, so a truncated journal is never silent", () => {
    const lines = importFleetLines({
      report: { dryRun: false, legs: [outcome({ leg: "runs", projected: 3, unreadableLines: 2 })] },
    });

    expect(lines[1]).toBe("  2 journal line(s) did not decode and were not imported");
  });

  it("totals the rows across every leg on the last line", () => {
    const lines = importFleetLines({
      report: {
        dryRun: false,
        legs: [outcome({ leg: "board", written: 2099 }), outcome({ leg: "autonomy", written: 228 })],
      },
    });

    expect(lines[lines.length - 1]).toBe("store import-fleet: 2327 row(s) written across 2 leg(s)");
  });
});
