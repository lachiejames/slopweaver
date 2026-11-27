/*
 * The extension register on disk, round-tripped under a throwaway home: absent is empty, an appended row reads back,
 * a damaged line grants nothing and is named beside the rows that did read, with the run it names when one can
 * still be read, the file is owner-only, and a register whose directory is a link is neither read nor written.
 */
import { appendFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { CodexPassExtension } from "../../../codex/passExtension.js";
import { appendPassExtension, readPassExtensions } from "../../../codex/passExtensionStore.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";
import { stateHomePaths } from "../../../stateHome.js";

const homes: string[] = [];

afterEach(() => {
  for (const home of homes.splice(0)) {
    rmSync(home, { force: true, recursive: true });
  }
});

/** A fresh state home under the per-file temp sandbox. */
function freshHome(): string {
  const home = mkdtempSync(join(tmpdir(), "sw-pass-ext-"));
  homes.push(home);
  return home;
}

const ROW: CodexPassExtension = {
  after: undefined,
  atIso: "2026-11-27T01:00:00.000Z",
  branch: "feature",
  diffSha256: "d".repeat(64),
  gitCommonDir: "/repos/acme/.git",
  grantedBy: { host: "codex", id: "019a1b2c-0000-7000-8000-000000000001" },
  id: "aaaaaaaa-0000-0000-0000-000000000001",
  lane: "baseline-bump-witness",
  reason: "the bump changed after the first witness",
  repoRoot: "/repos/acme",
  run: "acme-bump",
  schemaVersion: 1,
};

describe("the pass-extension register", () => {
  it("reads an absent register as empty", () => {
    expect(unwrap(readPassExtensions({ home: freshHome() }))).toEqual({ rows: [], unreadable: [] });
  });

  it("reads back what it appended, in order, owner-only", () => {
    const home = freshHome();
    expect(appendPassExtension({ home, row: ROW }).isOk()).toBe(true);
    expect(appendPassExtension({ home, row: { ...ROW, id: "second" } }).isOk()).toBe(true);
    expect(unwrap(readPassExtensions({ home })).rows.map((row) => row.id)).toEqual([ROW.id, "second"]);
    expect(statSync(stateHomePaths({ home }).codexPassExtensionsJsonl).mode & 0o777).toBe(0o600);
  });

  it("names a damaged line and still reads the rows around it", () => {
    const home = freshHome();
    expect(appendPassExtension({ home, row: ROW }).isOk()).toBe(true);
    appendFileSync(stateHomePaths({ home }).codexPassExtensionsJsonl, "{not json\n");
    appendFileSync(stateHomePaths({ home }).codexPassExtensionsJsonl, `${JSON.stringify({ ...ROW, lane: "x" })}\n`);
    const read = unwrap(readPassExtensions({ home }));
    expect(read.rows.map((row) => row.id)).toEqual([ROW.id]);
    expect(read.unreadable).toEqual([
      { detail: "line 2: not JSON", run: undefined },
      { detail: "line 3: lane x is not a review lane", run: "acme-bump" },
    ]);
  });

  it("refuses to read a register whose directory is a link, naming it rather than reading through it", () => {
    const home = freshHome();
    const elsewhere = freshHome();
    expect(appendPassExtension({ home: elsewhere, row: ROW }).isOk()).toBe(true);
    const path = stateHomePaths({ home }).codexPassExtensionsJsonl;
    mkdirSync(dirname(dirname(path)), { recursive: true });
    symlinkSync(dirname(stateHomePaths({ home: elsewhere }).codexPassExtensionsJsonl), dirname(path));
    expect(unwrapErr(readPassExtensions({ home })).message).toBe(
      `the pass-extension register at ${path} would not read: its directory ${dirname(path)} is a symbolic link, ` +
        "which a register never is",
    );
  });

  it("refuses to append through a linked directory, and writes nothing at the link's target", () => {
    const home = freshHome();
    const target = dirname(stateHomePaths({ home: freshHome() }).codexPassExtensionsJsonl);
    mkdirSync(target, { recursive: true });
    const path = stateHomePaths({ home }).codexPassExtensionsJsonl;
    mkdirSync(dirname(dirname(path)), { recursive: true });
    symlinkSync(target, dirname(path));
    expect(unwrapErr(appendPassExtension({ home, row: ROW })).message).toBe(
      `the extension was not recorded at ${path}: its directory ${dirname(path)} is a symbolic link, which a ` +
        "register never is",
    );
    expect(readdirSync(target)).toEqual([]);
  });
});
