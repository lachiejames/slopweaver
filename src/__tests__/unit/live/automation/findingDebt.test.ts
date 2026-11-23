/**
 * The owed-finding store over a throwaway home: a debt round-trips, a missing directory owes nothing, a file that
 * is not a debt is named rather than skipped, a directory that will not list says so, and the board — a row that
 * READS as this slug's, never an exit code or a bare path — says whether a finding landed.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { unwrapErr } from "../../../../lib/result.js";
import {
  clearFindingDebt,
  type FindingDebt,
  findingDebtDir,
  findingOnBoard,
  readFindingDebts,
  recordFindingDebt,
} from "../../../../live/automation/findingDebt.js";
import { stateHomePaths } from "../../../../stateHome.js";

const DEBT: FindingDebt = {
  argv: ["--ask", "a recipe failed", "--slug", "recipe-failing-vanta-a1", "--home", "/h"],
  finding: "recipe-failing-vanta-a1",
  recipeId: "vanta",
  recordedIso: "2026-10-13T03:00:00.000Z",
};

let home = "";

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "finding-debt-"));
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

/** Put a row file at the finding's path in `dir`, its front matter naming `slug`. */
function writeRow({ dir, slug = DEBT.finding }: { dir: string; slug?: string }): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${DEBT.finding}.md`), `---\nslug: ${slug}\nstatus: ready\n---\n# finding\n`, "utf8");
}

describe("findingDebt", () => {
  it("owes nothing when the directory does not exist", () => {
    expect(readFindingDebts({ home })).toEqual({ debts: [], unlisted: null, unread: [] });
  });

  it("round-trips a recorded debt, and clears it", () => {
    expect(recordFindingDebt({ debt: DEBT, home }).isOk()).toBe(true);
    expect(readFindingDebts({ home })).toEqual({ debts: [DEBT], unlisted: null, unread: [] });

    expect(clearFindingDebt({ finding: DEBT.finding, home }).isOk()).toBe(true);
    expect(readFindingDebts({ home })).toEqual({ debts: [], unlisted: null, unread: [] });
  });

  it("names a file that is not a debt, and one whose name is not its finding", () => {
    mkdirSync(findingDebtDir({ home }), { recursive: true });
    writeFileSync(join(findingDebtDir({ home }), "broken.json"), "{not json", "utf8");
    writeFileSync(join(findingDebtDir({ home }), "renamed.json"), JSON.stringify(DEBT), "utf8");
    writeFileSync(join(findingDebtDir({ home }), "half.json"), JSON.stringify({ ...DEBT, argv: [1] }), "utf8");

    expect(readFindingDebts({ home })).toEqual({
      debts: [],
      unlisted: null,
      unread: ["broken.json", "half.json", "renamed.json"],
    });
  });

  it("says why when the directory will not list, rather than throwing", () => {
    mkdirSync(stateHomePaths({ home }).live.recipe.root, { recursive: true });
    writeFileSync(findingDebtDir({ home }), "", "utf8");

    const read = readFindingDebts({ home });

    expect({ debts: read.debts, unread: read.unread }).toEqual({ debts: [], unread: [] });
    expect(read.unlisted).toContain(`${findingDebtDir({ home })} would not list: ENOTDIR`);
  });

  it("names a debt file that is a FIFO rather than hanging on it", () => {
    mkdirSync(findingDebtDir({ home }), { recursive: true });
    execFileSync("mkfifo", [join(findingDebtDir({ home }), "blocked.json")]);

    expect(readFindingDebts({ home })).toEqual({ debts: [], unlisted: null, unread: ["blocked.json"] });
  });

  it("names a directory that is there but unreachable, never reading it as absent", () => {
    mkdirSync(stateHomePaths({ home }).live.recipe.root, { recursive: true });
    symlinkSync(join(home, "moved-away"), findingDebtDir({ home }));

    const read = readFindingDebts({ home });

    expect({ debts: read.debts, unread: read.unread }).toEqual({ debts: [], unread: [] });
    expect(read.unlisted).toContain(`${findingDebtDir({ home })} would not list: ENOENT`);
  });

  it("refuses a finding that is not a safe slug, naming why", () => {
    const refused = unwrapErr(recordFindingDebt({ debt: { ...DEBT, finding: "../escape" }, home }));
    expect(refused.code).toBe("FINDING_DEBT_NOT_WRITTEN");
    expect(refused.message).toContain("not a safe slug");
  });

  it("reads a finding as landed only when the board holds its row", () => {
    expect(findingOnBoard({ finding: DEBT.finding, home })).toBe(false);

    writeRow({ dir: stateHomePaths({ home }).handovers });

    expect(findingOnBoard({ finding: DEBT.finding, home })).toBe(true);
  });

  it("reads an ARCHIVED row as on the board, so finished work is never registered again", () => {
    writeRow({ dir: stateHomePaths({ home }).handoverArchive });

    expect(findingOnBoard({ finding: DEBT.finding, home })).toBe(true);
  });

  it("reads a path that holds no readable row by this slug as NOT landed — a directory, or another slug", () => {
    mkdirSync(join(stateHomePaths({ home }).handovers, `${DEBT.finding}.md`), { recursive: true });
    const directory = findingOnBoard({ finding: DEBT.finding, home });
    rmSync(join(stateHomePaths({ home }).handovers, `${DEBT.finding}.md`), { recursive: true });
    writeRow({ dir: stateHomePaths({ home }).handovers, slug: "some-other-row" });
    const otherSlug = findingOnBoard({ finding: DEBT.finding, home });

    expect({ directory, otherSlug }).toEqual({ directory: false, otherSlug: false });
  });

  it("reads a whole doc whose run journal will not decode as NOT landed — the hold reads it the same way", () => {
    writeRow({ dir: stateHomePaths({ home }).handovers });
    mkdirSync(stateHomePaths({ home }).runs, { recursive: true });
    writeFileSync(join(stateHomePaths({ home }).runs, `${DEBT.finding}.jsonl`), "{torn\n", "utf8");

    expect(findingOnBoard({ finding: DEBT.finding, home })).toBe(false);
  });
});
