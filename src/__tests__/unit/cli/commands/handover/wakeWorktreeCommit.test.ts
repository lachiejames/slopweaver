/**
 * `git status --porcelain=v2 --branch` read as the commit a parked worktree stands on, the branch `HEAD` names and
 * whether anything sits beside it — the half of the question pass that holds a worktree to a merged head's commit on
 * that very branch, never its name alone.
 */
import { describe, expect, it } from "vitest";

import { unwrap } from "#lib/result.js";

import { parseWorktreeStatus } from "../../../../../cli/commands/handover/wakeWorktreeCommit.js";

const OID = "0123456789abcdef0123456789abcdef01234567";
const HEADER = [`# branch.oid ${OID}`, "# branch.head asked", "# branch.upstream origin/asked", "# branch.ab +0 -0"];

describe("parseWorktreeStatus", () => {
  it("reads a clean worktree's commit and branch", () => {
    expect(unwrap(parseWorktreeStatus({ output: `${HEADER.join("\n")}\n` }))).toEqual({
      branch: "asked",
      dirty: false,
      oid: OID,
    });
  });

  it("reads a changed tracked file as dirty", () => {
    const output = [...HEADER, `1 .M N... 100644 100644 100644 ${OID} ${OID} src/a.ts`].join("\n");
    expect(unwrap(parseWorktreeStatus({ output }))).toEqual({ branch: "asked", dirty: true, oid: OID });
  });

  it("reads an untracked file as dirty", () => {
    expect(unwrap(parseWorktreeStatus({ output: [...HEADER, "? notes.md"].join("\n") }))).toEqual({
      branch: "asked",
      dirty: true,
      oid: OID,
    });
  });

  // A paused interactive rebase prints only these two headers, clean, on the right commit.
  it("reads a paused rebase's detached HEAD as the branch it names, `(detached)`, though nothing is dirty", () => {
    expect(unwrap(parseWorktreeStatus({ output: `# branch.oid ${OID}\n# branch.head (detached)\n` }))).toEqual({
      branch: "(detached)",
      dirty: false,
      oid: OID,
    });
  });

  it("refuses a branch with no commit yet", () => {
    const result = parseWorktreeStatus({ output: "# branch.oid (initial)\n# branch.head asked\n" });
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr()).toEqual({
      code: "WORKTREE_NO_COMMIT",
      message: "git status named no commit for HEAD ((initial))",
      oid: "(initial)",
    });
  });

  it("refuses output naming no commit at all", () => {
    expect(parseWorktreeStatus({ output: "" })._unsafeUnwrapErr()).toEqual({
      code: "WORKTREE_NO_COMMIT",
      message: "git status named no commit for HEAD (undefined)",
      oid: undefined,
    });
  });

  it("refuses output naming no branch", () => {
    expect(parseWorktreeStatus({ output: `# branch.oid ${OID}\n` })._unsafeUnwrapErr()).toEqual({
      code: "WORKTREE_NO_BRANCH",
      message: "git status named no branch for HEAD",
    });
  });
});
