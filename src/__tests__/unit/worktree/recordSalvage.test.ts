/**
 * The salvage ledger, written and read back through a real temp home.
 *
 * A genuine fixture round-trip rather than a mock: the ledger's whole job is to be findable later, by
 * somebody who does not have the run that wrote it, so asserting on the bytes that reach disk is asserting
 * the actual contract. Most of what the week-old waiver removes belongs to a run that closed weeks ago and
 * has no board row left to update, which is why this file exists at all.
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { recordSalvage } from "../../../worktree/salvageLedger.js";

const homes: string[] = [];

afterEach(() => {
  homes.forEach((home) => {
    rmSync(home, { force: true, recursive: true });
  });
  homes.length = 0;
});

/** A throwaway state home, removed after each test. */
function freshHome(): string {
  const home = mkdtempSync(join(tmpdir(), "salvage-ledger-"));
  homes.push(home);
  return home;
}

/** Every record the ledger holds, parsed back out of the file. */
function ledgerRows({ home }: { home: string }): readonly Record<string, unknown>[] {
  const text = readFileSync(join(home, "worktree-bundles", "salvaged.jsonl"), "utf8");
  return text
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

describe("recordSalvage", () => {
  it("writes the branch, the tree it came from and the remote, so the work is findable without the run", () => {
    const home = freshHome();
    recordSalvage({
      branch: "salvage/old-work-2ba73fd1",
      home,
      remote: "origin",
      repoRoot: "/dev/slopweaver",
      worktreePath: "/dev/slopweaver/.claude/worktrees/old-work",
    });

    const rows = ledgerRows({ home });
    expect(rows.length).toBe(1);
    expect(rows[0]!["branch"]).toBe("salvage/old-work-2ba73fd1");
    expect(rows[0]!["worktreePath"]).toBe("/dev/slopweaver/.claude/worktrees/old-work");
    expect(rows[0]!["repoRoot"]).toBe("/dev/slopweaver");
    expect(rows[0]!["remote"]).toBe("origin");
  });

  it("stamps each row with an instant, so a reader can tell an old capture from today's", () => {
    const home = freshHome();
    const before = new Date().toISOString();
    recordSalvage({ branch: "salvage/a-0000aaaa", home, remote: "origin", repoRoot: "/r", worktreePath: "/r/w/a" });

    const stamped = String(ledgerRows({ home })[0]!["atIso"]);
    expect(stamped >= before).toBe(true);
    expect(stamped.endsWith("Z")).toBe(true);
  });

  it("APPENDS, so a run capturing several trees does not overwrite its own earlier rows", () => {
    const home = freshHome();
    recordSalvage({ branch: "salvage/a-0000aaaa", home, remote: "origin", repoRoot: "/r", worktreePath: "/r/w/a" });
    recordSalvage({ branch: "salvage/b-0000bbbb", home, remote: "origin", repoRoot: "/r", worktreePath: "/r/w/b" });

    expect(ledgerRows({ home }).map((row) => row["branch"])).toEqual(["salvage/a-0000aaaa", "salvage/b-0000bbbb"]);
  });

  it("creates the directory it writes into, so the FIRST capture on a machine is not the one that fails", () => {
    const home = freshHome();
    recordSalvage({ branch: "salvage/a-0000aaaa", home, remote: "origin", repoRoot: "/r", worktreePath: "/r/w/a" });

    expect(ledgerRows({ home }).length).toBe(1);
  });
});
