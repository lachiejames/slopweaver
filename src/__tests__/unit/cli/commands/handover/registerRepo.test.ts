/**
 * `handover register --repo` — the REAL verb over a throwaway board and a real `git init`.
 *
 * MEASURED: `--repo slopweaver` reached the board verbatim, and the row's seat died on
 * `git worktree list --porcelain failed` twice. What this file pins is that a value naming no checkout never
 * reaches a row, and that a value naming one lands as the checkout's absolute top.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { runHandoverRegister } from "../../../../../cli/commands/handover/askRowRun.js";
import { EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import { parseHandoverDoc } from "../../../../../handover/doc.js";
import { gitInTemp } from "../../../../tempGitRepo.js";

describe("handover register --repo against a real temp board and a real git checkout", () => {
  const dirs: string[] = [];
  afterEach(() => {
    while (dirs.length > 0) {
      rmSync(dirs.pop()!, { force: true, recursive: true });
    }
  });

  function fixture(): { home: string; checkout: string } {
    const home = mkdtempSync(join(tmpdir(), "register-repo-home-"));
    const checkout = realpathSync(mkdtempSync(join(tmpdir(), "register-repo-checkout-")));
    dirs.push(home, checkout);
    gitInTemp({ args: ["init", "--quiet"], cwd: checkout });
    mkdirSync(join(home, "handovers"), { recursive: true });
    return { checkout, home };
  }

  const argv = ({ home, repo }: { home: string; repo: string }): readonly string[] => [
    "node",
    "slopweaver",
    "handover",
    "register",
    "--ask",
    "a dispatched row",
    "--slug",
    "a-row",
    "--dispatch",
    "--branch",
    "a-branch",
    "--asked-iso",
    "2026-09-19T11:53:24.482Z",
    "--repo",
    repo,
    "--home",
    home,
  ];

  it("refuses a bare repository name no declared checkout carries, and writes no row (tick 188)", async () => {
    const { home } = fixture();
    expect(await runHandoverRegister(argv({ home, repo: "slopweaver" }))).toBe(EXIT_USAGE);
    expect(existsSync(join(home, "handovers", "a-row.md"))).toBe(false);
  });

  it("refuses a subdirectory of a checkout, and writes no row", async () => {
    const { checkout, home } = fixture();
    mkdirSync(join(checkout, "src"));
    expect(await runHandoverRegister(argv({ home, repo: join(checkout, "src") }))).toBe(EXIT_USAGE);
    expect(existsSync(join(home, "handovers", "a-row.md"))).toBe(false);
  });

  it("refuses an empty --repo rather than recording the checkout the process happens to stand in", async () => {
    const { home } = fixture();
    expect(await runHandoverRegister(argv({ home, repo: "" }))).toBe(EXIT_USAGE);
    expect(existsSync(join(home, "handovers", "a-row.md"))).toBe(false);
  });

  it("trims a padded path, as the row's own parser always did, and records the top", async () => {
    const { checkout, home } = fixture();
    expect(await runHandoverRegister(argv({ home, repo: ` ${checkout} ` }))).toBe(EXIT_OK);
    const rowPath = join(home, "handovers", "a-row.md");
    expect(parseHandoverDoc({ path: rowPath, text: readFileSync(rowPath, "utf8") }).repo).toBe(checkout);
  });

  it("refuses a padded value whose untrimmed path exists, rather than trimming it into the sibling checkout", async () => {
    const { checkout, home } = fixture();
    mkdirSync(`${checkout} `);
    dirs.push(`${checkout} `);
    expect(await runHandoverRegister(argv({ home, repo: `${checkout} ` }))).toBe(EXIT_USAGE);
    expect(existsSync(join(home, "handovers", "a-row.md"))).toBe(false);
  });

  it("records the checkout's absolute top, which parses back as the row's repo", async () => {
    const { checkout, home } = fixture();
    expect(await runHandoverRegister(argv({ home, repo: `${checkout}/` }))).toBe(EXIT_OK);
    const rowPath = join(home, "handovers", "a-row.md");
    const doc = parseHandoverDoc({ path: rowPath, text: readFileSync(rowPath, "utf8") });
    expect(doc.problems).toEqual([]);
    expect(doc.repo).toBe(checkout);
  });
});
