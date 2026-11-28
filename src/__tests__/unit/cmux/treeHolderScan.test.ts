/**
 * `cmux/treeHolderScan.ts` over real journal files in a throwaway runs directory: which journals it parses, what it
 * finds, and what it counts as unread.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { scanTreeHolders } from "../../../cmux/treeHolderScan.js";
import { MAX_JOURNAL_BYTES } from "../../../handover/hookJournalScan.js";

const SEAT_TREE = "/repo/.claude/worktrees.noindex/seat-a";

const journal = ({ worktree }: { worktree: string }): string =>
  [
    { atIso: "2026-11-27T12:00:00.000Z", branch: "seat-a-pr-branch", docHash: "abc", kind: "started" },
    {
      atIso: "2026-11-27T12:00:01.000Z",
      host: "claude-code",
      kind: "launched",
      pid: 4242,
      sessionId: "session-a",
      worktree,
    },
  ]
    .map((event) => `${JSON.stringify(event)}\n`)
    .join("");

let runsDir = "";

beforeEach(() => {
  runsDir = mkdtempSync(join(tmpdir(), "tree-holders-"));
});

afterEach(() => {
  rmSync(runsDir, { force: true, recursive: true });
});

describe("scanTreeHolders", () => {
  it("finds the open run recording the tree, and skips a journal naming another tree", () => {
    writeFileSync(join(runsDir, "seat-a.jsonl"), journal({ worktree: SEAT_TREE }));
    writeFileSync(join(runsDir, "seat-z.jsonl"), journal({ worktree: "/repo/.claude/worktrees.noindex/seat-z" }));

    expect(scanTreeHolders({ runsDir, tree: SEAT_TREE })).toEqual({
      holders: [{ path: SEAT_TREE, sessionId: "session-a", slug: "seat-a", via: "run" }],
      unread: 0,
    });
  });

  it("finds a holder recorded under the other spelling of the worktrees directory", () => {
    writeFileSync(join(runsDir, "seat-a.jsonl"), journal({ worktree: "/repo/.claude/worktrees/seat-a" }));

    expect(scanTreeHolders({ runsDir, tree: SEAT_TREE }).holders).toEqual([
      { path: "/repo/.claude/worktrees/seat-a", sessionId: "session-a", slug: "seat-a", via: "run" },
    ]);
  });

  it("holds the tree UNPARSED for a journal over the bound that names it", () => {
    writeFileSync(join(runsDir, "huge.jsonl"), `${journal({ worktree: SEAT_TREE })}${"x".repeat(MAX_JOURNAL_BYTES)}`);

    expect(scanTreeHolders({ runsDir, tree: SEAT_TREE })).toEqual({
      holders: [{ path: SEAT_TREE, sessionId: undefined, slug: "huge", via: "unparsed" }],
      unread: 0,
    });
  });

  it("finds the name in an over-bound journal where it straddles two chunk reads", () => {
    // The first read fills the buffer, MAX_JOURNAL_BYTES + 1 bytes; the name starts three bytes before its end.
    const head = "x".repeat(MAX_JOURNAL_BYTES + 1 - 3);
    writeFileSync(join(runsDir, "huge.jsonl"), `${head}/seat-a"${"x".repeat(100)}`);

    expect(scanTreeHolders({ runsDir, tree: SEAT_TREE }).holders).toEqual([
      { path: SEAT_TREE, sessionId: undefined, slug: "huge", via: "unparsed" },
    ]);
  });

  it("never holds the tree unparsed for an over-bound journal naming only a longer sibling", () => {
    writeFileSync(
      join(runsDir, "huge.jsonl"),
      `${journal({ worktree: "/repo/.claude/worktrees.noindex/seat-ab" })}${"x".repeat(MAX_JOURNAL_BYTES)}`,
    );

    expect(scanTreeHolders({ runsDir, tree: SEAT_TREE })).toEqual({ holders: [], unread: 0 });
  });

  it("never holds the tree unparsed for an over-bound journal naming a sibling whose name continues in an escape", () => {
    writeFileSync(
      join(runsDir, "huge.jsonl"),
      `${journal({ worktree: '/repo/.claude/worktrees.noindex/seat-a"b' })}${"x".repeat(MAX_JOURNAL_BYTES)}`,
    );

    expect(scanTreeHolders({ runsDir, tree: SEAT_TREE })).toEqual({ holders: [], unread: 0 });
  });

  it("skips an over-bound journal that never names the tree, and counts nothing unread", () => {
    writeFileSync(join(runsDir, "huge.jsonl"), "x".repeat(MAX_JOURNAL_BYTES + 1));

    expect(scanTreeHolders({ runsDir, tree: SEAT_TREE })).toEqual({ holders: [], unread: 0 });
  });

  it("finds a tree whose name JSON escapes, in the form the journal writes it", () => {
    const quoted = '/repo/.claude/worktrees.noindex/seat"a';
    writeFileSync(join(runsDir, "seat-q.jsonl"), journal({ worktree: quoted }));

    expect(scanTreeHolders({ runsDir, tree: quoted }).holders).toEqual([
      { path: quoted, sessionId: "session-a", slug: "seat-q", via: "run" },
    ]);
  });

  it("counts a journal that is a directory as unread", () => {
    mkdirSync(join(runsDir, "odd.jsonl"));

    expect(scanTreeHolders({ runsDir, tree: SEAT_TREE })).toEqual({ holders: [], unread: 1 });
  });

  it("finds nothing in a runs directory that does not exist", () => {
    expect(scanTreeHolders({ runsDir: join(runsDir, "absent"), tree: SEAT_TREE })).toEqual({ holders: [], unread: 0 });
  });
});
