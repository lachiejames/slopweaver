/** The one reading of which row a live workspace stands in (`../../../../../cli/commands/handover/seatName.ts`). */
import { describe, expect, it } from "vitest";

import { seatNameOf } from "../../../../../cli/commands/handover/seatName.js";

describe("seatNameOf", () => {
  it("names the outermost worktree on the path, wherever the shell moved under it, else the basename", () => {
    expect(
      [
        "/w/repo/.claude/worktrees.noindex/their-seat",
        "/w/repo/.claude/worktrees.noindex/their-seat/src/handover",
        "/w/repo/.claude/worktrees.noindex/their-seat/tmp/.claude/worktrees/handover",
        "/w/repo/.claude/worktrees/acme-row/docs",
        "/w/repo/.CLAUDE/Worktrees.NoIndex/acme-row/src",
        "/w/repo/plain-dir",
      ].map((directory) => seatNameOf({ directory })),
    ).toEqual(["their-seat", "their-seat", "their-seat", "acme-row", "acme-row", "plain-dir"]);
  });
});
