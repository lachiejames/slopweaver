/**
 * `automation retire` over a throwaway home seeded by the real `register-standing`: a retirement records the entry
 * and removes the file, a repeat converges, `register-standing` does not write a retired row back, and `--undo`
 * gives it back. `readRecord` is a plain function returning a fixed record, never a mock.
 */
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { operationLockPath } from "../../../../../admit/operationLockPath.js";
import { registerStandingRows } from "../../../../../cli/commands/automation/registerStanding.js";
import { type RetireDeps, retireAutomation, wholeRecordText } from "../../../../../cli/commands/automation/retire.js";
import { parseRetireArgs } from "../../../../../cli/commands/automation/retireArgs.js";
import type { RawWords } from "../../../../../handover/hisWordsResolve.js";
import { err, ok, unwrap } from "../../../../../lib/result.js";
import { RECIPE_DEFINITION_HOLDS_LOCK_KEY } from "../../../../../live/automation/failureHoldStore.js";
import { findingDebtDir } from "../../../../../live/automation/findingDebt.js";
import { readAutomationRetirements } from "../../../../../live/automation/retirementStore.js";
import { stateHomePaths } from "../../../../../stateHome.js";

const ANCHOR = "talk-call:acme#turn_1";
const RECORD = "Thread chase only made sense for the acme install. So I'd expect all of those to be switched off.";
const WORDS = "So I'd expect all of those to be switched off";
const WHY = "chases threads in a workspace this install no longer serves";

/** No home here declares a checkout, so no `origin` is ever asked. */
const NO_ORIGIN = (): undefined => undefined;

let home = "";

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "retire-"));
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

/** Plain recording edges over a fixed record. */
function edges({ record = ok(RECORD) }: { record?: ReturnType<RetireDeps["readRecord"]> } = {}): {
  readonly deps: RetireDeps;
  readonly out: string[];
  readonly diagnostics: string[];
} {
  const out: string[] = [];
  const diagnostics: string[] = [];
  return {
    deps: {
      now: () => "2026-11-03T08:00:00.000Z",
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

/** The chase row's definition file under the test home. */
function chaseFile(): string {
  return join(stateHomePaths({ home }).live.recipe.definitionsDir, "thread-chase-daily.json");
}

/** Retire the chase row. */
function retireChase({ deps }: { deps: RetireDeps }): number {
  return retireAutomation({
    deps,
    options: { anchor: ANCHOR, home, kind: "retire", recipeId: "thread-chase-daily", why: WHY, words: WORDS },
  });
}

// The record's text was kept whole whatever it said about cuts, so a relay made mid-stretch retired a row.
describe("wholeRecordText", () => {
  const WHOLE: RawWords = {
    atIso: "2026-11-03T07:59:00.000Z",
    context: { about: "", kind: "relay", triageRuling: null },
    headKnown: true,
    headLost: false,
    tailKnown: true,
    tailLost: false,
    text: RECORD,
    where: "console-voice",
  };
  const PART = "the record holds only part of what the owner said there — name the call's own stretch instead";
  const UNSAID = "the record predates saying whether the words were cut — name the call's own stretch instead";

  it("keeps a record that kept both ends, and refuses one that cut either end or does not say", () => {
    expect([
      wholeRecordText({ raw: WHOLE }),
      wholeRecordText({ raw: { ...WHOLE, tailLost: true } }),
      wholeRecordText({ raw: { ...WHOLE, headLost: true } }),
      wholeRecordText({ raw: { ...WHOLE, tailKnown: false } }),
      wholeRecordText({ raw: { ...WHOLE, headKnown: false } }),
    ]).toEqual([ok(RECORD), err(PART), err(PART), err(UNSAID), err(UNSAID)]);
  });
});

describe("parseRetireArgs", () => {
  it("reads a retirement with its word", () => {
    const parsed = parseRetireArgs({
      defaultHome: "/h",
      rest: ["thread-chase-daily", "--anchor", ANCHOR, "--words", WORDS, "--why", WHY],
    });
    expect(unwrap(parsed)).toEqual({
      anchor: ANCHOR,
      home: "/h",
      kind: "retire",
      recipeId: "thread-chase-daily",
      why: WHY,
      words: WORDS,
    });
  });

  it("reads an undo, honouring --home", () => {
    const parsed = parseRetireArgs({ defaultHome: "/h", rest: ["thread-chase-daily", "--undo", "--home", "/x"] });
    expect(unwrap(parsed)).toEqual({ home: "/x", kind: "undo", recipeId: "thread-chase-daily" });
  });

  it("refuses an undo carrying a word", () => {
    const parsed = parseRetireArgs({ defaultHome: "/h", rest: ["a", "--undo", "--why", WHY] });
    expect(parsed._unsafeUnwrapErr().code).toBe("FLAG_CONFLICT");
  });

  it("refuses a retirement missing --words", () => {
    const parsed = parseRetireArgs({ defaultHome: "/h", rest: ["a", "--anchor", ANCHOR, "--why", WHY] });
    expect(parsed._unsafeUnwrapErr().code).toBe("ARGUMENT_MISSING");
    expect(parsed._unsafeUnwrapErr().message).toContain("automation retire needs --words");
  });

  it("refuses no recipe id, and two of them", () => {
    expect(parseRetireArgs({ defaultHome: "/h", rest: ["--undo"] })._unsafeUnwrapErr().code).toBe("ARGUMENT_MISSING");
    expect(parseRetireArgs({ defaultHome: "/h", rest: ["a", "b", "--undo"] })._unsafeUnwrapErr().code).toBe(
      "ARGUMENT_MISSING",
    );
  });
});

describe("retireAutomation", () => {
  it("records the retirement and removes the row's file", () => {
    seed();
    expect(existsSync(chaseFile())).toBe(true);
    const edge = edges();

    expect(retireChase({ deps: edge.deps })).toBe(0);

    expect(existsSync(chaseFile())).toBe(false);
    expect(unwrap(readAutomationRetirements({ home })).retirements).toEqual([
      {
        anchor: ANCHOR,
        recipeId: "thread-chase-daily",
        retiredAtIso: "2026-11-03T08:00:00.000Z",
        why: WHY,
        words: WORDS,
      },
    ]);
    expect(edge.out[0]).toBe(
      `automation retire · RETIRED thread-chase-daily on this install · on ${ANCHOR} ("${WORDS}") · ${WHY}`,
    );
  });

  type Pick = (where: { readonly at: string }) => string;
  const recipeRoot: Pick = ({ at }) => stateHomePaths({ home: at }).live.recipe.root;
  const definitionsDir: Pick = ({ at }) => stateHomePaths({ home: at }).live.recipe.definitionsDir;
  const debtDir: Pick = ({ at }) => findingDebtDir({ home: at });
  const holdLock: Pick = ({ at }) => operationLockPath({ home: at, key: RECIPE_DEFINITION_HOLDS_LOCK_KEY });
  it.each([
    { link: "definitions directory", nested: false, pick: definitionsDir },
    { link: "recipe tree", nested: false, pick: recipeRoot },
    { link: "finding-debt directory", nested: false, pick: debtDir },
    { link: "recipe tree, into a home nested inside it,", nested: true, pick: recipeRoot },
    { link: "definition hold lock", nested: false, pick: holdLock },
  ])("changes nothing in another home when its $link is a symlink into it", ({ nested, pick }) => {
    const other = nested ? join(home, "other") : mkdtempSync(join(tmpdir(), "retire-other-"));
    mkdirSync(other, { recursive: true });
    try {
      const sink: string[] = [];
      registerStandingRows({
        deps: { originOf: NO_ORIGIN, writeDiagnostic: (line) => sink.push(line), writeOut: (line) => sink.push(line) },
        options: { dryRun: false, home: other, json: false },
      });
      mkdirSync(pick({ at: other }), { recursive: true });
      mkdirSync(dirname(pick({ at: home })), { recursive: true });
      symlinkSync(pick({ at: other }), pick({ at: home }));
      const otherChase = join(stateHomePaths({ home: other }).live.recipe.definitionsDir, "thread-chase-daily.json");
      const otherRegistry = stateHomePaths({ home: other }).live.recipe.retirementsJson;
      const chaseBefore = existsSync(otherChase);
      const edge = edges();

      expect(retireChase({ deps: edge.deps })).toBe(1);

      expect(chaseBefore).toBe(true);
      expect(existsSync(otherChase)).toBe(true);
      expect(existsSync(otherRegistry)).toBe(false);
      expect(edge.diagnostics[0]).toContain("not its own place in this home — nothing changed");
    } finally {
      rmSync(other, { force: true, recursive: true });
    }
  });

  it("converges on a repeat, keeping the first entry", () => {
    seed();
    retireChase({ deps: edges().deps });
    const edge = edges();

    expect(retireChase({ deps: edge.deps })).toBe(0);

    expect(edge.out).toEqual([
      `automation retire · ALREADY RETIRED thread-chase-daily on this install · on ${ANCHOR} ("${WORDS}") · ${WHY}`,
      "automation retire · thread-chase-daily had no definition file on this install",
    ]);
  });

  it("is not undone by register-standing, which no longer declares the row", () => {
    seed();
    retireChase({ deps: edges().deps });

    seed();

    expect(existsSync(chaseFile())).toBe(false);
  });

  it("refuses words the owner's record does not hold, changing nothing", () => {
    seed();
    const edge = edges({ record: ok("something else entirely") });

    expect(retireChase({ deps: edge.deps })).toBe(1);

    expect(existsSync(chaseFile())).toBe(true);
    expect(unwrap(readAutomationRetirements({ home })).kind).toBe("absent");
    expect(edge.diagnostics[0]).toContain("--words is not, byte for byte, in the owner's record at");
  });

  it("refuses when the record does not read, changing nothing", () => {
    seed();
    const edge = edges({ record: err("no such turn") });

    expect(retireChase({ deps: edge.deps })).toBe(1);

    expect(existsSync(chaseFile())).toBe(true);
    expect(edge.diagnostics).toEqual([`automation retire · their record at ${ANCHOR} did not read: no such turn`]);
  });

  it("refuses a row the install does not declare", () => {
    const edge = edges();
    const exit = retireAutomation({
      deps: edge.deps,
      options: { anchor: ANCHOR, home, kind: "retire", recipeId: "hand-written", why: WHY, words: WORDS },
    });
    expect(exit).toBe(1);
    expect(edge.diagnostics[0]).toContain("hand-written is not a standing row this install declares");
  });

  it("undoes a retirement, and register-standing writes the row back", () => {
    seed();
    retireChase({ deps: edges().deps });
    const edge = edges();

    expect(retireAutomation({ deps: edge.deps, options: { home, kind: "undo", recipeId: "thread-chase-daily" } })).toBe(
      0,
    );
    expect(unwrap(readAutomationRetirements({ home })).retirements).toEqual([]);
    seed();

    expect(existsSync(chaseFile())).toBe(true);
  });

  it("refuses to undo a row that is not retired", () => {
    const edge = edges();
    const exit = retireAutomation({ deps: edge.deps, options: { home, kind: "undo", recipeId: "thread-chase-daily" } });
    expect(exit).toBe(1);
    expect(edge.diagnostics).toEqual([
      "automation retire --undo · thread-chase-daily is not retired on this install, so there is nothing to undo",
    ]);
  });
});
