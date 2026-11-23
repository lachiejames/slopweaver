import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { runSessionStartLockIn, sessionStartLockInCommand } from "../../../cli/commands/sessionStart/lockInRun.js";
import { EXIT_OK, EXIT_USAGE } from "../../../cli/exitCodes.js";
import { lockInLedgerPath, parseLockInRows } from "../../../sessionStart/lockIn.js";

const homes: string[] = [];

/** A throwaway state home, removed after the test that minted it. */
function scratchHome(): string {
  const home = mkdtempSync(join(tmpdir(), "slopweaver-lockin-"));
  homes.push(home);
  return home;
}

afterEach(() => {
  for (const home of homes.splice(0)) {
    rmSync(home, { force: true, recursive: true });
  }
});

// Each flag is passed once and a case overrides it by name: the parser refuses a repeated value flag, so
// appending a second `--item` would test that refusal instead of the case's own subject.
const argv = ({
  home,
  item = "linear:AAA-1",
  reply = "do",
  outcome = "approved-as-proposed",
}: {
  home: string;
  item?: string;
  reply?: string;
  outcome?: string;
}): readonly string[] => [
  "node",
  "slopweaver",
  "session-start",
  "lock-in",
  "--item",
  item,
  "--against",
  "2026-08-20T00:00:00.000Z",
  "--proposed",
  "close it, the work shipped",
  "--reply",
  reply,
  "--outcome",
  outcome,
  "--now",
  "2026-08-30T12:00:00.000Z",
  "--home",
  home,
];

describe("runSessionStartLockIn", () => {
  it("appends one row a later run can read back", () => {
    const home = scratchHome();
    expect(runSessionStartLockIn(argv({ home }))).toBe(EXIT_OK);
    const rows = parseLockInRows({ text: readFileSync(lockInLedgerPath({ home }), "utf8") });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.identity).toBe("linear:AAA-1");
    expect(rows[0]!.outcome).toBe("approved-as-proposed");
    expect(rows[0]!.tsIso).toBe("2026-08-30T12:00:00.000Z");
  });

  it("appends rather than replacing, so a walk of several rows keeps them all", () => {
    const home = scratchHome();
    runSessionStartLockIn(argv({ home }));
    runSessionStartLockIn(argv({ home, item: "handover:a-run" }));
    const rows = parseLockInRows({ text: readFileSync(lockInLedgerPath({ home }), "utf8") });
    expect(rows.map((one) => one.identity)).toStrictEqual(["linear:AAA-1", "handover:a-run"]);
  });

  it("refuses a deferral with no date rather than hiding the item forever", () => {
    const home = scratchHome();
    const code = runSessionStartLockIn(argv({ home, outcome: "deferred", reply: "defer" }));
    expect(code).toBe(EXIT_USAGE);
  });

  it("prints its usage and writes nothing on --help", () => {
    expect(runSessionStartLockIn(["node", "slopweaver", "session-start", "lock-in", "--help"])).toBe(EXIT_OK);
  });
});

describe("sessionStartLockInCommand", () => {
  it("is the handler the manifest loads, and it runs", () => {
    expect(sessionStartLockInCommand(["node", "slopweaver", "session-start", "lock-in", "--help"])).toBe(EXIT_OK);
  });
});
