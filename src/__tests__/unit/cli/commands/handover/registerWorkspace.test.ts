/**
 * `handover register --workspace` — the REAL verb over a throwaway board, read back through the board's own parser.
 *
 * MEASURED: all 33 open asks had to be placed by
 * hand with `handover set-workspace`, because `register` could not state whose work a row was and every verb
 * registering rows minted more that showed in both Queue views as findings. What this file pins is that a stated
 * workspace lands as the same `workspace:` / `workspaceBecause:` pair `set-workspace` writes, and that half a
 * statement, or a misspelt one, never reaches a row.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { runHandoverRegister } from "../../../../../cli/commands/handover/askRowRun.js";
import { registerWorkspace } from "../../../../../cli/commands/handover/registerWorkspace.js";
import { EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import { parseHandoverDoc } from "../../../../../handover/doc.js";

describe("registerWorkspace", () => {
  it("states nothing when neither flag is passed", () => {
    expect(registerWorkspace({ values: {} })).toEqual({ stated: undefined });
  });

  it("states the workspace and its reason, the reason flattened to one line", () => {
    expect(
      registerWorkspace({ values: { workspace: "team", "workspace-because": "  a pull request\n in acme-admin " } }),
    ).toEqual({ stated: { because: "a pull request in acme-admin", workspace: "team" } });
  });

  it("reads an old spelling as its role and states the ROLE, as a pre-rename console still sends it", () => {
    expect(
      ["acme", "slopweaver"].map((workspace) => registerWorkspace({ values: { workspace, "workspace-because": "x" } })),
    ).toEqual([{ stated: { because: "x", workspace: "team" } }, { stated: { because: "x", workspace: "self" } }]);
  });

  it("refuses a workspace with no reason", () => {
    expect(registerWorkspace({ values: { workspace: "self" } })).toEqual({
      refusal: "--workspace needs --workspace-because <why>: the row carries the reason it is this workspace's",
    });
  });

  it("refuses a blank reason", () => {
    expect(registerWorkspace({ values: { workspace: "self", "workspace-because": "  " } })).toEqual({
      refusal: "--workspace needs --workspace-because <why>: the row carries the reason it is this workspace's",
    });
  });

  it("refuses a reason with no workspace", () => {
    expect(registerWorkspace({ values: { "workspace-because": "it is ours" } })).toEqual({
      refusal: "--workspace-because needs --workspace team|self — it is the reason for one",
    });
  });

  it("refuses a misspelt workspace, naming what it got", () => {
    expect(registerWorkspace({ values: { workspace: "everalb", "workspace-because": "the team's" } })).toEqual({
      refusal: '--workspace must be one of team|self, got "everalb"',
    });
  });
});

describe("handover register --workspace against a real temp board", () => {
  const dirs: string[] = [];
  afterEach(() => {
    while (dirs.length > 0) {
      rmSync(dirs.pop()!, { force: true, recursive: true });
    }
  });

  function freshHome(): string {
    const home = mkdtempSync(join(tmpdir(), "register-workspace-home-"));
    dirs.push(home);
    mkdirSync(join(home, "handovers"), { recursive: true });
    return home;
  }

  const argv = ({ home, extra }: { home: string; extra: readonly string[] }): readonly string[] => [
    "node",
    "slopweaver",
    "handover",
    "register",
    "--ask",
    "a dispatched row",
    "--slug",
    "a-row",
    "--dispatch",
    "--asked-iso",
    "2026-10-05T02:46:43.556Z",
    "--home",
    home,
    ...extra,
  ];

  it("writes the stated workspace and its reason, read back by the board's own parser", async () => {
    const home = freshHome();
    const code = await runHandoverRegister(
      argv({ extra: ["--workspace", "team", "--workspace-because", "a pull request in acme-admin"], home }),
    );
    expect(code).toBe(EXIT_OK);
    const path = join(home, "handovers", "a-row.md");
    const text = readFileSync(path, "utf8");
    const doc = parseHandoverDoc({ path, text });
    expect(doc.problems).toEqual([]);
    expect(doc.workspace).toBe("team");
    expect(text).toContain('\nworkspace: team\nworkspaceBecause: "a pull request in acme-admin"\n');
  });

  it("writes no workspace line when none is stated", async () => {
    const home = freshHome();
    expect(await runHandoverRegister(argv({ extra: [], home }))).toBe(EXIT_OK);
    const path = join(home, "handovers", "a-row.md");
    const text = readFileSync(path, "utf8");
    expect(parseHandoverDoc({ path, text }).workspace).toBeUndefined();
    expect(text).not.toContain("workspace");
  });

  it("refuses half a statement, and writes no row", async () => {
    const home = freshHome();
    expect(await runHandoverRegister(argv({ extra: ["--workspace", "self"], home }))).toBe(EXIT_USAGE);
    expect(existsSync(join(home, "handovers", "a-row.md"))).toBe(false);
  });

  it("refuses a --workspace value carrying a newline before it can author a key", async () => {
    const home = freshHome();
    const code = await runHandoverRegister(
      argv({ extra: ["--workspace", "acme\npriority: p0", "--workspace-because", "x"], home }),
    );
    expect(code).toBe(EXIT_USAGE);
    expect(existsSync(join(home, "handovers", "a-row.md"))).toBe(false);
  });
});
