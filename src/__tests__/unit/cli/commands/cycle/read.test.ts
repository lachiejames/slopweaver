/**
 * `readLinearScan` and `readReleaseInstants` count a line that names itself an issue, project or project update and does not parse, so a reconcile
 * missing it says so in `couldNotSee` rather than publishing looking whole.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { readLinearScan, readReleaseInstants } from "../../../../../cli/commands/cycle/read.js";
import { bronzeSourceDir } from "../../../../../corpus/corpusPaths.js";

const homes: string[] = [];

afterEach(() => {
  homes.splice(0).forEach((home) => {
    rmSync(home, { force: true, recursive: true });
  });
});

/** A home whose `source` bronze holds exactly `lines`, each a record or a raw string written as is. */
function homeWith({ source, lines }: { source: "linear" | "github"; lines: readonly unknown[] }): string {
  const home = mkdtempSync(`${tmpdir()}/cycle-scan-`);
  homes.push(home);
  const dir = bronzeSourceDir({ home, source });
  mkdirSync(dir, { recursive: true });
  const text = lines.map((line) => (typeof line === "string" ? line : JSON.stringify(line))).join("\n");
  writeFileSync(join(dir, "2026-09.jsonl"), `${text}\n`, "utf8");
  return home;
}

/** A home whose Linear bronze holds exactly `lines`. */
function homeWithLinear({ lines }: { lines: readonly unknown[] }): string {
  return homeWith({ lines, source: "linear" });
}

const TS = "2026-09-20T00:00:00.000Z";
const GOOD_ISSUE = { kind: "issue", raw: { state: { name: "Todo", type: "unstarted" } }, sourceId: "ENG-1", tsIso: TS };
const STATELESS_ISSUE = { kind: "issue", raw: {}, sourceId: "ENG-2", tsIso: TS };
const PROJECT = { kind: "project", raw: {}, sourceId: "project:p1", tsIso: TS };
const IDLESS_PROJECT = { kind: "project", raw: {}, tsIso: TS };
const UPDATE = {
  kind: "update",
  raw: { createdAt: TS, project: { id: "p1" } },
  sourceId: "projectUpdate:u1",
  tsIso: TS,
};
const ARCHIVED_UPDATE = {
  kind: "update",
  raw: { archivedAt: TS, createdAt: TS },
  sourceId: "projectUpdate:u2",
  tsIso: TS,
};
const DATELESS_UPDATE = { kind: "update", raw: { project: { id: "p1" } }, sourceId: "projectUpdate:u3", tsIso: TS };
const COMMENT = { kind: "comment", raw: {}, sourceId: "comment:c1", tsIso: TS };

describe("readLinearScan", () => {
  it("counts each issue or project line it could not read, and nothing else", async () => {
    const home = homeWithLinear({ lines: [GOOD_ISSUE, STATELESS_ISSUE, PROJECT, IDLESS_PROJECT, COMMENT] });
    const scan = await readLinearScan({ home });
    expect(scan.issues.map((issue) => issue.identifier)).toEqual(["ENG-1"]);
    expect(scan.projects.map((project) => project.id)).toEqual(["project:p1"]);
    expect(scan.unreadable).toBe(2);
  });

  it("counts a project update it could not read, and never an archived one it skipped on purpose", async () => {
    const home = homeWithLinear({ lines: [GOOD_ISSUE, UPDATE, ARCHIVED_UPDATE, DATELESS_UPDATE] });
    const scan = await readLinearScan({ home });
    expect(scan.unreadable).toBe(1);
  });

  it("counts a project update under another id it could not read, and never an initiative update", async () => {
    const renamed = { kind: "update", raw: { project: { id: "p1" } }, sourceId: "update:u-bad", tsIso: TS };
    const initiative = { kind: "update", raw: {}, sourceId: "initiativeUpdate:i1", tsIso: TS };
    const legacy = {
      kind: "update",
      raw: {},
      sourceId: "update:u-legacy",
      tsIso: TS,
      url: "https://linear.app/acme/project/backend-92f14fe7e9a9/activity",
    };
    const home = homeWithLinear({ lines: [GOOD_ISSUE, renamed, legacy, initiative] });
    expect((await readLinearScan({ home })).unreadable).toBe(2);
  });

  it("counts a spaced project update it could not read, which a compact substring match would miss", async () => {
    const spaced = `{"kind": "update", "sourceId": "projectUpdate:u-bad", "tsIso": "${TS}", "raw": {"project": {"id": "p1"}}}`;
    const home = homeWithLinear({ lines: [GOOD_ISSUE, spaced] });
    expect((await readLinearScan({ home })).unreadable).toBe(1);
  });

  it("counts a line cut off before its kind was written, even one ending in a nested object's brace", async () => {
    const home = homeWithLinear({ lines: [GOOD_ISSUE, '{"attrs":{"a":1},"au', '{"attrs":{"a":1}'] });
    expect((await readLinearScan({ home })).unreadable).toBe(2);
  });

  it("reads zero unreadable over a corpus where every record parses", async () => {
    const home = homeWithLinear({ lines: [GOOD_ISSUE, PROJECT, UPDATE, ARCHIVED_UPDATE, COMMENT] });
    expect((await readLinearScan({ home })).unreadable).toBe(0);
  });
});

const RELEASE = { container: "lachiejames/slopweaver", kind: "release", sourceId: "release:1", tsIso: TS };
const DATELESS_RELEASE = { container: "lachiejames/slopweaver", kind: "release", sourceId: "release:2" };
const STATELESS_PR = { kind: "pr", sourceId: "pr:1", url: "https://github.com/lachiejames/slopweaver/pull/1" };

describe("readReleaseInstants", () => {
  it("counts a release it could not read and a cut-off line, and never a record of another kind", async () => {
    const spaced = '{"kind": "release", "sourceId": "release:3"}';
    const lines = [RELEASE, DATELESS_RELEASE, STATELESS_PR, '{"kind":"rel', spaced];
    const home = homeWith({ lines, source: "github" });
    const scan = await readReleaseInstants({ home });
    expect([...scan.instants]).toEqual([["lachiejames/slopweaver", [TS]]]);
    expect(scan.unreadable).toBe(3);
  });

  it("reads zero unreadable when every release parses", async () => {
    const home = homeWith({ lines: [RELEASE, STATELESS_PR], source: "github" });
    expect((await readReleaseInstants({ home })).unreadable).toBe(0);
  });
});
