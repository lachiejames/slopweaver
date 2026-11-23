/**
 * `handover set-workspace` — the verb that states whose work a board row is, which the console's workspace
 * selector reads beside the row's pull requests and Slack destinations.
 *
 * The parse half is `handover/workspace.ts` (a misspelt value is a PROBLEM, never an absence). The round trip
 * runs the REAL verb over a throwaway board, because what this verb exists to produce is a doc whose
 * `workspace:` parses back, with the reason beside it. `--respell` runs the same way, over a board holding the
 * organisation-named spellings a role replaced.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { runHandoverSetWorkspace } from "../../../../../cli/commands/handover/setWorkspaceRun.js";
import { respellWorkspace, writeWorkspace } from "../../../../../cli/commands/handover/setWorkspaceWrite.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import { parseHandoverDoc } from "../../../../../handover/doc.js";
import { workspaceField, workspaceProblems } from "../../../../../handover/workspace.js";

/** A whole-second instant in the past, stamped on a row so any later write to it shows as a moved mtime. */
const PINNED_MTIME = new Date("2020-01-01T00:00:00.000Z");

/**
 * What any write to a file moves: a rename its inode, an in-place write its mtime off the pin, and a write that
 * puts its mtime back its ctime, which no caller can set.
 */
function fileIdentity({ path }: { path: string }): { ctimeNs: bigint; ino: bigint; mtimeNs: bigint } {
  const stat = statSync(path, { bigint: true });
  return { ctimeNs: stat.ctimeNs, ino: stat.ino, mtimeNs: stat.mtimeNs };
}

/** A clean row's text, optionally stating a workspace line exactly as given. */
function rowText({ slug, workspace }: { slug: string; workspace: string | undefined }): string {
  return [
    "---",
    `slug: ${slug}`,
    "kind: ask",
    "summary: an ISO ask run from the Slopweaver checkout",
    "status: ready",
    "askedIso: 2026-09-27T08:05:36.467Z",
    "artifact: null",
    "repo: /Users/x/dev/personal/slopweaver",
    ...(workspace === undefined ? [] : [`workspace: ${workspace}`]),
    "---",
    "",
    "# body",
    "",
  ].join("\n");
}

describe("the workspace: field on a parsed doc", () => {
  it("reads a real workspace, with no problem", () => {
    const doc = parseHandoverDoc({ path: "/h/a.md", text: rowText({ slug: "a", workspace: "team" }) });
    expect(doc.workspace).toBe("team");
    expect(doc.workspaceAlias).toBeUndefined();
    expect(doc.problems).toEqual([]);
  });

  it("reads each old organisation-named spelling as the role it became, and says which spelling it read", () => {
    const docs = ["acme", "slopweaver"].map((workspace) =>
      parseHandoverDoc({ path: "/h/a.md", text: rowText({ slug: "a", workspace }) }),
    );
    expect(docs.map((doc) => [doc.workspace, doc.workspaceAlias, doc.problems])).toEqual([
      ["team", "acme", []],
      ["self", "slopweaver", []],
    ]);
  });

  it("reads no workspace from a doc with no line — the checkout it names is not one", () => {
    const doc = parseHandoverDoc({ path: "/h/a.md", text: rowText({ slug: "a", workspace: undefined }) });
    expect(doc.workspace).toBeUndefined();
    expect(doc.problems).toEqual([]);
  });

  it("makes a misspelt value a problem, never an absence the console would place some other way", () => {
    const doc = parseHandoverDoc({ path: "/h/a.md", text: rowText({ slug: "a", workspace: "everalb" }) });
    expect([doc.workspace, doc.workspaceUnread]).toEqual([undefined, "everalb"]);
    expect(doc.problems).toContain('workspace must be one of team|self, got "everalb"');
  });

  it("answers the same through its two pure halves", () => {
    expect(workspaceProblems({ declared: undefined })).toEqual([]);
    expect(workspaceField({ declared: "self", twice: false })).toEqual({ workspace: "self" });
    expect(workspaceField({ declared: "slopweaver", twice: false })).toEqual({
      workspace: "self",
      workspaceAlias: "slopweaver",
    });
    expect(workspaceField({ declared: "work", twice: false })).toEqual({ workspaceUnread: "work" });
    expect(workspaceField({ declared: undefined, twice: false })).toEqual({});
  });

  it("unreads a workspace: line declared twice, rather than placing the row by the first", () => {
    const text = rowText({ slug: "a", workspace: "team" }).replace(
      "workspace: team",
      "workspace: team\nworkspace: self",
    );
    const doc = parseHandoverDoc({ path: "/h/a.md", text });
    expect([doc.workspace, doc.workspaceUnread]).toEqual([undefined, "team, then another workspace: line"]);
    expect(doc.problems).toContain('front-matter declares "workspace" more than once — which one is meant?');
  });
});

describe("handover set-workspace against a real temp board", () => {
  const dirs: string[] = [];
  afterEach(() => {
    while (dirs.length > 0) {
      rmSync(dirs.pop()!, { force: true, recursive: true });
    }
  });

  function fixture({ workspace }: { workspace: string | undefined }): { home: string; rowPath: string } {
    const home = mkdtempSync(join(tmpdir(), "set-workspace-home-"));
    dirs.push(home);
    mkdirSync(join(home, "handovers"), { recursive: true });
    const rowPath = join(home, "handovers", "a-row.md");
    writeFileSync(rowPath, rowText({ slug: "a-row", workspace }), "utf8");
    return { home, rowPath };
  }

  const argv = ({ home, rest }: { home: string; rest: readonly string[] }): readonly string[] => [
    "node",
    "slopweaver",
    "handover",
    "set-workspace",
    ...rest,
    "--home",
    home,
  ];

  it("writes a workspace: that parses back, with its reason beside it", async () => {
    const { home, rowPath } = fixture({ workspace: undefined });
    const code = await runHandoverSetWorkspace(
      argv({ home, rest: ["a-row", "--workspace", "team", "--because", "the ISO audit is Acme's"] }),
    );
    expect(code).toBe(EXIT_OK);
    const text = readFileSync(rowPath, "utf8");
    const doc = parseHandoverDoc({ path: rowPath, text });
    expect(doc.problems).toEqual([]);
    expect(doc.workspace).toBe("team");
    expect(text).toContain(`workspaceBecause: "the ISO audit is Acme's"`);
  });

  it("corrects a wrong workspace — a judgement, so it may replace one — and reports what it was", () => {
    const { rowPath } = fixture({ workspace: "self" });
    const doc = parseHandoverDoc({ path: rowPath, text: readFileSync(rowPath, "utf8") });
    expect(writeWorkspace({ because: "its pull requests are acme-admin's", doc, workspace: "team" })).toEqual({
      from: "self",
      kind: "written",
    });
    expect(parseHandoverDoc({ path: rowPath, text: readFileSync(rowPath, "utf8") }).workspace).toBe("team");
  });

  it("rewrites an old spelling of the same workspace rather than calling it unchanged, naming the spelling", () => {
    const { rowPath } = fixture({ workspace: "acme" });
    const doc = parseHandoverDoc({ path: rowPath, text: readFileSync(rowPath, "utf8") });
    expect(writeWorkspace({ because: "the organisation's audit", doc, workspace: "team" })).toEqual({
      from: "acme",
      kind: "written",
    });
    const after = parseHandoverDoc({ path: rowPath, text: readFileSync(rowPath, "utf8") });
    expect([after.workspace, after.workspaceAlias]).toEqual(["team", undefined]);
  });

  it("writes nothing when the row already states that workspace", () => {
    const { rowPath } = fixture({ workspace: "team" });
    const before = readFileSync(rowPath, "utf8");
    const doc = parseHandoverDoc({ path: rowPath, text: before });
    expect(writeWorkspace({ because: "again", doc, workspace: "team" })).toEqual({ kind: "unchanged" });
    expect(readFileSync(rowPath, "utf8")).toBe(before);
  });

  it("refuses a row that does not parse cleanly, and leaves it untouched", () => {
    const { rowPath } = fixture({ workspace: "everalb" });
    const before = readFileSync(rowPath, "utf8");
    const doc = parseHandoverDoc({ path: rowPath, text: before });
    expect(writeWorkspace({ because: "fix it", doc, workspace: "team" })).toEqual({
      kind: "refused",
      problems: [
        'a-row does not parse cleanly, so nothing may be written to it: workspace must be one of team|self, got "everalb"',
      ],
    });
    expect(readFileSync(rowPath, "utf8")).toBe(before);
  });

  it("refuses a value that is not a workspace, and a missing --because, before touching the board", async () => {
    const { home, rowPath } = fixture({ workspace: undefined });
    const before = readFileSync(rowPath, "utf8");
    expect(
      await runHandoverSetWorkspace(argv({ home, rest: ["a-row", "--workspace", "work", "--because", "x"] })),
    ).toBe(EXIT_USAGE);
    expect(await runHandoverSetWorkspace(argv({ home, rest: ["a-row", "--workspace", "team"] }))).toBe(EXIT_USAGE);
    expect(await runHandoverSetWorkspace(argv({ home, rest: ["--workspace", "team", "--because", "x"] }))).toBe(
      EXIT_USAGE,
    );
    expect(readFileSync(rowPath, "utf8")).toBe(before);
  });

  it("refuses a slug no row claims", async () => {
    const { home } = fixture({ workspace: undefined });
    expect(
      await runHandoverSetWorkspace(argv({ home, rest: ["no-such-row", "--workspace", "team", "--because", "x"] })),
    ).toBe(EXIT_ERROR);
  });

  it("--respell rewrites every old spelling to its role, keeps each reason, and touches no row already a role", async () => {
    const { home, rowPath } = fixture({ workspace: "acme" });
    writeFileSync(
      rowPath,
      readFileSync(rowPath, "utf8").replace("workspace: acme", `workspace: acme\nworkspaceBecause: "the audit"`),
    );
    const selfPath = join(home, "handovers", "b-row.md");
    writeFileSync(
      selfPath,
      rowText({ slug: "b-row", workspace: "slopweaver" }).replace(
        "workspace: slopweaver",
        `workspace: slopweaver\nworkspaceBecause: "this installation owns it"`,
      ),
      "utf8",
    );
    const rolePath = join(home, "handovers", "c-row.md");
    writeFileSync(rolePath, rowText({ slug: "c-row", workspace: "team" }), "utf8");
    const roleBefore = readFileSync(rolePath, "utf8");
    utimesSync(rolePath, PINNED_MTIME, PINNED_MTIME);
    const roleIdentity = fileIdentity({ path: rolePath });

    expect(await runHandoverSetWorkspace(argv({ home, rest: ["--respell"] }))).toBe(EXIT_OK);

    const docs = [rowPath, selfPath].map((path) => parseHandoverDoc({ path, text: readFileSync(path, "utf8") }));
    expect(docs.map((doc) => [doc.workspace, doc.workspaceAlias])).toEqual([
      ["team", undefined],
      ["self", undefined],
    ]);
    expect(readFileSync(rowPath, "utf8")).toContain(`workspaceBecause: "the audit"`);
    expect(readFileSync(selfPath, "utf8")).toContain(`workspaceBecause: "this installation owns it"`);
    expect(readFileSync(rolePath, "utf8")).toBe(roleBefore);
    expect(fileIdentity({ path: rolePath })).toEqual(roleIdentity);
  });

  it("--respell still respells what it read, but exits non-zero over a doc it could not read", async () => {
    const { home, rowPath } = fixture({ workspace: "acme" });
    mkdirSync(join(home, "handovers", "z-row.md"));
    expect(await runHandoverSetWorkspace(argv({ home, rest: ["--respell"] }))).toBe(EXIT_ERROR);
    expect(readFileSync(rowPath, "utf8")).toContain("workspace: team");
  });

  it("--respell run twice writes nothing the second time", async () => {
    const { home, rowPath } = fixture({ workspace: "slopweaver" });
    expect(await runHandoverSetWorkspace(argv({ home, rest: ["--respell"] }))).toBe(EXIT_OK);
    const once = readFileSync(rowPath, "utf8");
    expect(await runHandoverSetWorkspace(argv({ home, rest: ["--respell"] }))).toBe(EXIT_OK);
    expect(readFileSync(rowPath, "utf8")).toBe(once);
    expect(once).toContain("workspace: self");
  });

  it("--respell refuses a slug, a --workspace or a --because beside it, before touching the board", async () => {
    const { home, rowPath } = fixture({ workspace: "acme" });
    const before = readFileSync(rowPath, "utf8");
    expect([
      await runHandoverSetWorkspace(argv({ home, rest: ["--respell", "a-row"] })),
      await runHandoverSetWorkspace(argv({ home, rest: ["--respell", "--workspace", "team"] })),
      await runHandoverSetWorkspace(argv({ home, rest: ["--respell", "--because", "x"] })),
    ]).toEqual([EXIT_USAGE, EXIT_USAGE, EXIT_USAGE]);
    expect(readFileSync(rowPath, "utf8")).toBe(before);
  });

  it("respellWorkspace refuses a row another writer moved to a different old spelling since the scan", () => {
    const { rowPath } = fixture({ workspace: "acme" });
    const doc = parseHandoverDoc({ path: rowPath, text: readFileSync(rowPath, "utf8") });
    writeFileSync(rowPath, rowText({ slug: "a-row", workspace: "slopweaver" }), "utf8");
    const moved = readFileSync(rowPath, "utf8");
    expect(respellWorkspace({ doc })).toEqual({
      kind: "refused",
      problems: [
        "a-row: workspace: changed from acme to slopweaver since the board was read — nothing written; run --respell again",
      ],
    });
    expect(readFileSync(rowPath, "utf8")).toBe(moved);
  });

  it("respellWorkspace calls a row already spelling its role unchanged, and leaves the file itself in place", () => {
    const { rowPath } = fixture({ workspace: "self" });
    const doc = parseHandoverDoc({ path: rowPath, text: readFileSync(rowPath, "utf8") });
    utimesSync(rowPath, PINNED_MTIME, PINNED_MTIME);
    const identity = fileIdentity({ path: rowPath });
    expect(respellWorkspace({ doc })).toEqual({ kind: "unchanged" });
    expect(fileIdentity({ path: rowPath })).toEqual(identity);
  });
});
