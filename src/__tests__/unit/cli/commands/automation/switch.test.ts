/**
 * `automation enable` and `automation disable` over a throwaway home seeded by the real `register-standing`: a switch
 * writes ONE key and journals one line, a dry run and a repeat write nothing, a held row refuses an enable and takes a
 * disable, and `register-standing` leaves a switched row as it stands. `readRecord` is a plain function returning a
 * fixed record, never a mock.
 */
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { registerStandingRows } from "../../../../../cli/commands/automation/registerStanding.js";
import { type SwitchDeps, switchAutomation } from "../../../../../cli/commands/automation/switch.js";
import { parseSwitchArgs, type SwitchOptions } from "../../../../../cli/commands/automation/switchArgs.js";
import { err, ok, unwrap } from "../../../../../lib/result.js";
import { parseRecipeDefinition } from "../../../../../live/automation/definition.js";
import { judgeRecipeDue } from "../../../../../live/automation/definitionDue.js";
import { placeFailureHold } from "../../../../../live/automation/failureHoldStore.js";
import { addAutomationRetirement, writeAutomationRetirements } from "../../../../../live/automation/retirementStore.js";
import { stateHomePaths } from "../../../../../stateHome.js";

const ANCHOR = "talk-call:acme#typed-owner-1";
const RECORD = "Yes, turn the publication audit on. It should run every morning.";
const WORDS = "Yes, turn the publication audit on";
const WHY = "the owner asked for the daily publication audit to run";
const NOW = "2026-11-21T10:30:00.000Z";
const ROW = "publication-audit-daily";

/** No home here declares a checkout, so no `origin` is ever asked. */
const NO_ORIGIN = (): undefined => undefined;

let home = "";

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "switch-"));
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

/** Plain recording edges over a fixed record. */
function edges({ record = ok(RECORD) }: { record?: ReturnType<SwitchDeps["readRecord"]> } = {}): {
  readonly deps: SwitchDeps;
  readonly out: string[];
  readonly diagnostics: string[];
} {
  const out: string[] = [];
  const diagnostics: string[] = [];
  return {
    deps: {
      now: () => NOW,
      readRecord: () => record,
      writeDiagnostic: (line) => diagnostics.push(line),
      writeOut: (line) => out.push(line),
    },
    diagnostics,
    out,
  };
}

/** Seed the home with every declared standing row, as `register-standing` writes them. */
function seed(): void {
  const sink: string[] = [];
  registerStandingRows({
    deps: { originOf: NO_ORIGIN, writeDiagnostic: (line) => sink.push(line), writeOut: (line) => sink.push(line) },
    options: { dryRun: false, home, json: false },
  });
}

/** The row's definition file under the test home. */
function rowFile({ recipeId = ROW }: { recipeId?: string } = {}): string {
  return join(stateHomePaths({ home }).live.recipe.definitionsDir, `${recipeId}.json`);
}

/** The row's definition as a parsed object. */
function rowJson(): Record<string, unknown> {
  return JSON.parse(readFileSync(rowFile(), "utf8")) as Record<string, unknown>;
}

/** Every path under the home, in one fixed order. */
function homeListing(): readonly string[] {
  return readdirSync(home, { encoding: "utf8", recursive: true }).toSorted((a, b) => a.localeCompare(b));
}

/** The journal's lines, decoded. */
function journal(): readonly unknown[] {
  const path = stateHomePaths({ home }).live.recipe.switchesJsonl;
  if (!existsSync(path)) {
    return [];
  }
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as unknown);
}

/** Switch one row with the fixed word. */
function run({
  deps,
  direction,
  recipeId = ROW,
  dryRun = false,
}: {
  deps: SwitchDeps;
  direction: SwitchOptions["direction"];
  recipeId?: string;
  dryRun?: boolean;
}): number {
  return switchAutomation({
    deps,
    options: { anchor: ANCHOR, direction, dryRun, home, recipeId, why: WHY, words: WORDS },
  });
}

describe("parseSwitchArgs", () => {
  it("reads one switch with its word, honouring --home and --dry-run", () => {
    const parsed = parseSwitchArgs({
      defaultHome: "/h",
      direction: "enable",
      rest: [ROW, "--anchor", ANCHOR, "--words", WORDS, "--why", WHY, "--dry-run", "--home", "/x"],
    });
    expect(unwrap(parsed)).toEqual({
      anchor: ANCHOR,
      direction: "enable",
      dryRun: true,
      home: "/x",
      recipeId: ROW,
      why: WHY,
      words: WORDS,
    });
  });

  it("refuses a switch missing --why, naming the verb", () => {
    const parsed = parseSwitchArgs({
      defaultHome: "/h",
      direction: "disable",
      rest: [ROW, "--anchor", ANCHOR, "--words", WORDS],
    });
    expect(parsed._unsafeUnwrapErr().code).toBe("ARGUMENT_MISSING");
    expect(parsed._unsafeUnwrapErr().message).toContain("automation disable needs --why");
  });

  it("refuses no recipe id, and two of them", () => {
    const flags = ["--anchor", ANCHOR, "--words", WORDS, "--why", WHY];
    expect(parseSwitchArgs({ defaultHome: "/h", direction: "enable", rest: flags })._unsafeUnwrapErr().code).toBe(
      "ARGUMENT_MISSING",
    );
    expect(
      parseSwitchArgs({ defaultHome: "/h", direction: "enable", rest: ["a", "b", ...flags] })._unsafeUnwrapErr()
        .message,
    ).toBe("automation enable needs the recipe id to switch, as its one positional argument");
  });
});

describe("switchAutomation", () => {
  it("enables a declared-off row by writing only `enabled`, and journals who asked", () => {
    seed();
    const before = rowJson();
    const edge = edges();

    expect(run({ deps: edge.deps, direction: "enable" })).toBe(0);

    expect(before["enabled"]).toBe(false);
    expect(rowJson()).toEqual({ ...before, enabled: true });
    expect(journal()).toEqual([
      { anchor: ANCHOR, enabled: true, recipeId: ROW, switchedAtIso: NOW, why: WHY, words: WORDS },
    ]);
    expect(edge.out).toEqual([
      `automation enable · ${ROW} · enabled: false → true · on ${ANCHOR} ("${WORDS}") · ${WHY}`,
      `automation enable · ENABLED ${ROW} · \`automation due\` then reads it on its cadence \`45 5 * * *\``,
    ]);
  });

  it("moves the real due verdict off `disabled` on enable, and back onto it on disable", () => {
    seed();
    const dueOf = (): ReturnType<typeof judgeRecipeDue> =>
      judgeRecipeDue({ definition: unwrap(parseRecipeDefinition({ value: rowJson() })), nowIso: NOW, run: null });
    expect(dueOf().offReason).toBe("disabled");

    run({ deps: edges().deps, direction: "enable" });
    expect(dueOf().offReason).toBe(undefined);

    run({ deps: edges().deps, direction: "disable" });
    expect(dueOf().offReason).toBe("disabled");
    expect(dueOf().line).toBe(`recipe ${ROW} · parked · the row is disabled`);
  });

  it("previews a dry run and writes nothing", () => {
    seed();
    const bytes = readFileSync(rowFile(), "utf8");
    const listing = homeListing();
    const edge = edges();

    expect(run({ deps: edge.deps, direction: "enable", dryRun: true })).toBe(0);

    expect(readFileSync(rowFile(), "utf8")).toBe(bytes);
    expect(journal()).toEqual([]);
    expect(homeListing()).toEqual(listing);
    expect(edge.out[1]).toBe(
      "automation enable · dry run: nothing written; once written, `automation due` then reads it on its cadence " +
        "`45 5 * * *`",
    );
  });

  it("changes and journals nothing when the row is already in that state", () => {
    seed();
    run({ deps: edges().deps, direction: "enable" });
    rmSync(join(home, "ledgers"), { force: true, recursive: true });
    const listing = homeListing();
    const edge = edges();

    expect(run({ deps: edge.deps, direction: "enable" })).toBe(0);

    expect(homeListing()).toEqual(listing);
    expect(journal().length).toBe(1);
    expect(edge.out).toEqual([`automation enable · ALREADY ENABLED ${ROW} · nothing written, nothing journalled`]);
  });

  it("disables an enabled row, and register-standing leaves the switched row as it stands", () => {
    seed();
    run({ deps: edges().deps, direction: "enable" });
    const edge = edges();

    expect(run({ deps: edge.deps, direction: "disable" })).toBe(0);
    run({ deps: edges().deps, direction: "enable" });
    seed();

    expect(edge.out[1]).toBe(`automation disable · DISABLED ${ROW} · \`automation due\` then reads it OFF · disabled`);
    expect(rowJson()["enabled"]).toBe(true);
    expect(journal().map((line) => (line as { enabled: boolean }).enabled)).toEqual([true, false, true]);
  });

  it("refuses to enable a held row, changing nothing, and disables it", () => {
    seed();
    unwrap(
      placeFailureHold({
        finding: "recipe-failing-audit",
        home,
        nowIso: NOW,
        reason: "a firing failed",
        recipeId: ROW,
      }),
    );
    const bytes = readFileSync(rowFile(), "utf8");
    rmSync(join(home, "ledgers"), { force: true, recursive: true });
    const listing = homeListing();
    const refused = edges();

    expect(run({ deps: refused.deps, direction: "enable" })).toBe(1);
    expect(readFileSync(rowFile(), "utf8")).toBe(bytes);
    expect(homeListing()).toEqual(listing);
    expect(refused.diagnostics[0]).toContain(`automation enable · ${ROW} carries a standing hold, which outranks`);

    run({ deps: edges().deps, direction: "enable", recipeId: "worktree-prune" });
    const held = edges();
    unwrap(
      placeFailureHold({
        finding: "recipe-failing-prune",
        home,
        nowIso: NOW,
        reason: "a firing failed",
        recipeId: "worktree-prune",
      }),
    );
    expect(run({ deps: held.deps, direction: "disable", recipeId: "worktree-prune" })).toBe(0);
    expect(held.out[1]).toBe(
      "automation disable · DISABLED worktree-prune · `automation due` still reads it OFF · HELD, and it stays off " +
        "once that hold lifts",
    );
  });

  it("refuses words the owner's record does not hold, changing nothing", () => {
    seed();
    const bytes = readFileSync(rowFile(), "utf8");
    const edge = edges({ record: ok("something else entirely") });

    expect(run({ deps: edge.deps, direction: "enable" })).toBe(1);

    expect(readFileSync(rowFile(), "utf8")).toBe(bytes);
    expect(journal()).toEqual([]);
    expect(edge.diagnostics[0]).toContain("--words is not, byte for byte, in the owner's record at");
  });

  it("refuses when the record does not read", () => {
    seed();
    const edge = edges({ record: err("no such turn") });

    expect(run({ deps: edge.deps, direction: "enable" })).toBe(1);

    expect(edge.diagnostics).toEqual([`automation enable · their record at ${ANCHOR} did not read: no such turn`]);
  });

  it("refuses a row with no definition, naming register-standing", () => {
    const edge = edges();

    expect(run({ deps: edge.deps, direction: "enable" })).toBe(1);

    expect(edge.diagnostics[0]).toBe(
      `automation enable · ${ROW} has no definition on this install, so there is nothing to switch — a declared ` +
        "row is written by `slopweaver automation register-standing`; nothing changed",
    );
  });

  it("refuses a retired row, naming its undo", () => {
    seed();
    const retired = addAutomationRetirement({
      current: [],
      retirement: { anchor: ANCHOR, recipeId: ROW, retiredAtIso: NOW, why: WHY, words: WORDS },
    });
    unwrap(writeAutomationRetirements({ home, retirements: retired.retirements }));
    const edge = edges();

    expect(run({ deps: edge.deps, direction: "disable" })).toBe(1);

    expect(edge.diagnostics[0]).toContain(`\`slopweaver automation retire ${ROW} --undo\` gives it back`);
  });
});
