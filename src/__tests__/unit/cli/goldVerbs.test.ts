/**
 * The three `gold` verbs driven end to end against a throwaway state home and recording seams — the same
 * shape as `autonomyVerbs.test.ts`, and the test that satisfies the `manifest-loader-tests` gate for the
 * three modules `../../../cli/manifests/gold.ts` can load.
 */
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { GOLD_DEBTS_FLAG_NAMES, GOLD_OWE_FLAG_NAMES, GOLD_SETTLE_FLAG_NAMES } from "../../../cli/commands/gold/core.js";
import { type GoldDebtsDeps, runGoldDebts } from "../../../cli/commands/gold/debts.js";
import { type GoldOweDeps, runGoldOwe } from "../../../cli/commands/gold/owe.js";
import { type GoldSettleDeps, runGoldSettle } from "../../../cli/commands/gold/settle.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../../cli/exitCodes.js";
import { readGoldDebtLedger } from "../../../goldDebt/store.js";
import { unwrap } from "../../../lib/result.js";

const cleanups: (() => void)[] = [];

afterEach(() => {
  cleanups.splice(0).forEach((clean) => {
    clean();
  });
});

/** A throwaway state home these verbs may write into — never the ambient one. */
function home(): string {
  const root = mkdtempSync(join(tmpdir(), "sw-gold-cli-"));
  cleanups.push(() => {
    rmSync(root, { force: true, recursive: true });
  });
  return root;
}

/** What one verb run wrote to each channel, and what it exited with. */
interface Recorded {
  readonly exit: number;
  readonly out: readonly string[];
  readonly diagnostics: readonly string[];
}

/** The clock every verb in this file runs against. */
const NOW = "2026-09-19T04:00:00.000Z";
const PR = "https://github.com/lachiejames/slopweaver/pull/872";

/** Run `gold owe` with recording seams. */
function owe({ rest }: { rest: readonly string[] }): Recorded {
  const out: string[] = [];
  const diagnostics: string[] = [];
  const deps: GoldOweDeps = {
    now: () => NOW,
    writeDiagnostic: (line) => diagnostics.push(line),
    writeOut: (line) => out.push(line),
  };
  return { diagnostics, exit: runGoldOwe({ deps, rest }), out };
}

/** Run `gold debts` with recording seams. */
function debts({ rest }: { rest: readonly string[] }): Recorded {
  const out: string[] = [];
  const diagnostics: string[] = [];
  const deps: GoldDebtsDeps = {
    writeDiagnostic: (line) => diagnostics.push(line),
    writeOut: (line) => out.push(line),
  };
  return { diagnostics, exit: runGoldDebts({ deps, rest }), out };
}

/** Run `gold settle` with recording seams. */
function settle({ rest }: { rest: readonly string[] }): Recorded {
  const out: string[] = [];
  const diagnostics: string[] = [];
  const deps: GoldSettleDeps = {
    now: () => NOW,
    writeDiagnostic: (line) => diagnostics.push(line),
    writeOut: (line) => out.push(line),
  };
  return { diagnostics, exit: runGoldSettle({ deps, rest }), out };
}

/** The argv that records one silver debt into `dir`. */
function oweArgs({ dir }: { dir: string }): readonly string[] {
  return [
    PR,
    "--grade",
    "silver",
    "--merged-iso",
    "2026-09-18T17:31:52Z",
    "--would-be",
    "post the owner's review ask as the owner into a real team thread",
    "--blocked-on",
    "the owner's own approval — an outward act aimed at people",
    "--by-session",
    "workspace:gold-debt-ledger",
    "--home",
    dir,
  ];
}

describe("gold owe", () => {
  it("records a debt and says gold is OWED rather than waived", () => {
    const dir = home();
    const run = owe({ rest: oweArgs({ dir }) });
    expect(run.exit).toBe(EXIT_OK);
    expect(run.out[0]).toContain("recorded lachiejames/slopweaver#872 at silver — gold is OWED, not waived");
    expect(unwrap(readGoldDebtLedger({ home: dir })).length).toBe(1);
  });

  it("prints what gold would be and what is blocking it, so the row is actionable from the receipt alone", () => {
    const run = owe({ rest: oweArgs({ dir: home() }) });
    expect(run.out[1]).toBe("    would be: post the owner's review ask as the owner into a real team thread");
    expect(run.out[2]).toBe("    blocked on: the owner's own approval — an outward act aimed at people");
  });

  it("emits the receipt and the debt as one JSON object under --json", () => {
    const run = owe({ rest: [...oweArgs({ dir: home() }), "--json"] });
    const emitted = JSON.parse(run.out[0]!) as { appended: boolean; debt: { grade: string; recordedIso: string } };
    expect(emitted.appended).toBe(true);
    expect(emitted.debt.grade).toBe("silver");
    expect(emitted.debt.recordedIso).toBe(NOW);
  });

  it("refuses a gold grade, because a gold merge owes nothing", () => {
    const dir = home();
    const rest = oweArgs({ dir }).map((arg) => (arg === "silver" ? "gold" : arg));
    const run = owe({ rest });
    expect(run.exit).toBe(EXIT_USAGE);
    expect(run.diagnostics[0]).toContain("A pull request merged at `gold` owes nothing");
    expect(unwrap(readGoldDebtLedger({ home: dir }))).toEqual([]);
  });

  it("refuses a run with no pull request named at all", () => {
    const run = owe({ rest: ["--grade", "silver"] });
    expect(run.exit).toBe(EXIT_USAGE);
    expect(run.diagnostics[0]).toBe("gold owe: name the merged pull request, as its full URL");
  });

  it("refuses an unknown flag before touching the register", () => {
    const run = owe({ rest: [...oweArgs({ dir: home() }), "--force"] });
    expect(run.exit).toBe(EXIT_USAGE);
    expect(run.diagnostics.join("\n")).toContain("--force");
  });

  it("prints its usage under --help and writes nothing", () => {
    const dir = home();
    const run = owe({ rest: ["--help", "--home", dir] });
    expect(run.exit).toBe(EXIT_OK);
    expect(run.out[0]).toContain("usage: slopweaver gold owe");
    expect(unwrap(readGoldDebtLedger({ home: dir }))).toEqual([]);
  });
});

describe("gold debts", () => {
  it("says so plainly when nothing is owed", () => {
    const run = debts({ rest: ["--home", home()] });
    expect(run.exit).toBe(EXIT_OK);
    expect(run.out[0]).toBe("gold debts: no open gold debt matches");
  });

  it("prints an open debt, oldest first, with a count that names the settle verb", () => {
    const dir = home();
    owe({ rest: oweArgs({ dir }) });
    const run = debts({ rest: ["--home", dir] });
    expect(run.out[0]).toBe(
      "2026-09-18T17:31:52Z  lachiejames/slopweaver#872  merged silver  https://github.com/lachiejames/slopweaver/pull/872",
    );
    expect(run.out.at(-1)).toBe("1 of 1 still open — settle one with `slopweaver gold settle`");
  });

  it("hides a settled debt from the default view and shows it under --all", () => {
    const dir = home();
    owe({ rest: oweArgs({ dir }) });
    settle({ rest: settleArgs({ dir }) });
    expect(debts({ rest: ["--home", dir] }).out[0]).toBe("gold debts: no open gold debt matches");
    expect(debts({ rest: ["--all", "--home", dir] }).out.at(-1)).toBe(
      "0 of 1 still open — settle one with `slopweaver gold settle`",
    );
  });

  it("narrows to one repository", () => {
    const dir = home();
    owe({ rest: oweArgs({ dir }) });
    const run = debts({ rest: ["--repo", "acme/other", "--home", dir] });
    expect(run.out[0]).toBe("gold debts: no open gold debt matches");
  });

  it("emits one JSON object per line rather than one array", () => {
    const dir = home();
    owe({ rest: oweArgs({ dir }) });
    const run = debts({ rest: ["--json", "--home", dir] });
    expect(run.out.length).toBe(1);
    const emitted = JSON.parse(run.out[0]!) as { debt: { pullRequest: string } };
    expect(emitted.debt.pullRequest).toBe(PR);
  });

  it("refuses to report nothing owed when the register cannot be read", () => {
    // A DIRECTORY where the register belongs: present to a stat, unreadable as a file. The failure a
    // reader must never see is the alternative — an empty list, which would read as owing nothing.
    const dir = home();
    mkdirSync(join(dir, "ledgers", "gold-debt.jsonl"), { recursive: true });
    const run = debts({ rest: ["--home", dir] });
    expect(run.exit).toBe(EXIT_ERROR);
    expect(run.diagnostics[0]).toContain("refusing rather than reporting nothing owed");
  });

  it("prints its usage under --help", () => {
    const run = debts({ rest: ["--help"] });
    expect(run.exit).toBe(EXIT_OK);
    expect(run.out[0]).toContain("usage: slopweaver gold debts");
  });
});

/** The argv that settles the recorded debt in `dir`. */
function settleArgs({ dir }: { dir: string }): readonly string[] {
  return [
    "lachiejames/slopweaver#872",
    "--evidence",
    "the ask as the owner, really sent — <link>",
    "--regrade",
    "the description now reads solved-gold",
    "--by-session",
    "workspace:gold-debt-ledger",
    "--home",
    dir,
  ];
}

describe("gold settle", () => {
  it("settles an open debt and prints the door invocation rather than editing the pull request", () => {
    const dir = home();
    owe({ rest: oweArgs({ dir }) });
    const run = settle({ rest: settleArgs({ dir }) });
    expect(run.exit).toBe(EXIT_OK);
    expect(run.out[0]).toBe("gold settle: settled lachiejames/slopweaver#872 as gathered");
    expect(run.out).toContain(
      "      slopweaver github pr update --repo lachiejames/slopweaver --number 872 --edit " +
        `'{"review":{"grade":"<grade>","reviewer":"<who>","why":"<why>"},"appendClaims":[<claim>]}'`,
    );
    // A re-grade is the reviewer's partial edit, so the whole-description pull-and-replace hint is gone.
    expect(run.out.filter((line) => line.includes("--pull") || line.includes("--file"))).toStrictEqual([]);
  });

  it("refuses a gathered settlement with no re-grade, keeping the post-hoc re-grade OPEN", () => {
    const dir = home();
    owe({ rest: oweArgs({ dir }) });
    const rest = settleArgs({ dir }).filter(
      (arg) => arg !== "--regrade" && arg !== "the description now reads solved-gold",
    );
    const run = settle({ rest });
    expect(run.exit).toBe(EXIT_USAGE);
    expect(run.diagnostics[0]).toContain("re-graded post-hoc OPENLY");
  });

  it("writes off a debt as moot, which pays no proof and asks for no re-grade", () => {
    const dir = home();
    owe({ rest: oweArgs({ dir }) });
    const rest = [
      "lachiejames/slopweaver#872",
      "--as",
      "moot",
      "--evidence",
      "the surface it proved was removed in #900",
      "--by-session",
      "workspace:gold-debt-ledger",
      "--home",
      dir,
    ];
    const run = settle({ rest });
    expect(run.exit).toBe(EXIT_OK);
    expect(run.out).toContain("    nothing to re-grade — a moot debt pays no proof");
  });

  it("refuses a pull request the register holds no debt for, and points at the list", () => {
    const dir = home();
    const run = settle({ rest: settleArgs({ dir }) });
    expect(run.exit).toBe(EXIT_USAGE);
    expect(run.diagnostics[0]).toContain("no gold debt in the ledger names lachiejames/slopweaver#872");
  });

  it("refuses a second, different settlement of a debt already settled", () => {
    const dir = home();
    owe({ rest: oweArgs({ dir }) });
    settle({ rest: settleArgs({ dir }) });
    const rest = settleArgs({ dir }).map((arg) =>
      arg === "the ask as the owner, really sent — <link>" ? "a second account" : arg,
    );
    const run = settle({ rest });
    expect(run.exit).toBe(EXIT_ERROR);
    expect(run.diagnostics[0]).toContain("already settled");
  });

  it("refuses a run naming no debt at all", () => {
    const run = settle({ rest: ["--evidence", "something"] });
    expect(run.exit).toBe(EXIT_USAGE);
    expect(run.diagnostics[0]).toContain("name the debt");
  });

  it("prints its usage under --help", () => {
    const run = settle({ rest: ["--help"] });
    expect(run.exit).toBe(EXIT_OK);
    expect(run.out[0]).toContain("usage: slopweaver gold settle");
  });
});

describe("the flag lists the help-truth ratchet reads", () => {
  it("names every owe flag, sorted", () => {
    expect(GOLD_OWE_FLAG_NAMES).toEqual([
      "--blocked-on",
      "--by-session",
      "--grade",
      "--home",
      "--json",
      "--merged-iso",
      "--pull-request",
      "--recorded-iso",
      "--run",
      "--title",
      "--would-be",
    ]);
  });

  it("names every debts flag, sorted", () => {
    expect(GOLD_DEBTS_FLAG_NAMES).toEqual(["--all", "--home", "--json", "--repo", "--settled"]);
  });

  it("names every settle flag, sorted", () => {
    expect(GOLD_SETTLE_FLAG_NAMES).toEqual([
      "--as",
      "--by-session",
      "--evidence",
      "--home",
      "--json",
      "--proof-commit",
      "--regrade",
      "--settled-iso",
    ]);
  });
});
