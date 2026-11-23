/**
 * A closed seat's reclaim outcome reads git's refusal against whether the tree actually went, and the trash
 * pass prints one line only when it had something to do.
 */
import { describe, expect, it } from "vitest";

import { reclaimOutcome } from "../../../../../cli/commands/session/closeDoneReclaim.js";
import { listedEntry } from "../../../../../cli/commands/session/closeDoneRepoContext.js";
import { renderTrash } from "../../../../../cli/commands/session/closeDoneTrash.js";

const base = { name: "seat", path: "/r/.claude/worktrees.noindex/seat", removed: false };

describe("listedEntry", () => {
  it("keeps a lock git printed, so the close-time scan holds the tree on it", () => {
    expect(listedEntry({ entry: { branch: "feat", locked: true, path: base.path } })).toEqual({
      branch: "feat",
      locked: true,
      path: base.path,
    });
  });

  it("carries no lock for an unlocked tree, and nothing the scan does not read", () => {
    expect(listedEntry({ entry: { branch: null, heldBranches: ["feat"], path: base.path } })).toEqual({
      branch: null,
      path: base.path,
    });
  });
});

describe("reclaimOutcome", () => {
  it("reports a removed tree whose branch git kept as removed, with the branch kept", () => {
    expect(
      reclaimOutcome({
        base,
        outcome: { declined: "error: the branch 'seat' is not fully merged", failed: false, treeRemoved: true },
        reason: "merged into the trunk",
      }),
    ).toEqual({
      ...base,
      reason: "merged into the trunk; branch kept — error: the branch 'seat' is not fully merged",
      removed: true,
    });
  });

  it("reports a tree git refused to remove as kept, in git's words", () => {
    expect(
      reclaimOutcome({
        base,
        outcome: { declined: "fatal: cannot remove a locked working tree", failed: false, treeRemoved: false },
        reason: "merged into the trunk",
      }),
    ).toEqual({ ...base, reason: "git declined the removal — fatal: cannot remove a locked working tree" });
  });

  it("reports a removal that failed part-way as FAILED, never as a decline or a reclaim", () => {
    expect(
      reclaimOutcome({
        base,
        outcome: { declined: "error: failed to delete: Directory not empty", failed: true, treeRemoved: false },
        reason: "merged into the trunk",
      }),
    ).toEqual({
      ...base,
      reason: "the removal FAILED part-way and left the directory — error: failed to delete: Directory not empty",
    });
  });

  it("reports a clean removal with the verdict's own reason", () => {
    expect(
      reclaimOutcome({
        base,
        outcome: { declined: null, failed: false, treeRemoved: true },
        reason: "merged into the trunk",
      }),
    ).toEqual({ ...base, reason: "merged into the trunk", removed: true });
  });
});

describe("renderTrash", () => {
  it("prints nothing when the trash is empty", () => {
    expect(renderTrash({ trash: { restored: 0, waiting: 0 } })).toBe(undefined);
  });

  it("names what waits for the prune to delete, since this sweep deletes nothing", () => {
    expect(renderTrash({ trash: { restored: 0, waiting: 3 } })).toBe(
      "reclaim trash: 3 batch(es) wait for `worktree prune --apply` to delete",
    );
  });

  it("names a batch put back into the tree git kept", () => {
    expect(renderTrash({ trash: { restored: 1, waiting: 0 } })).toBe(
      "reclaim trash: put 1 back into a tree git kept, 0 batch(es) wait for `worktree prune --apply` to delete",
    );
  });
});
