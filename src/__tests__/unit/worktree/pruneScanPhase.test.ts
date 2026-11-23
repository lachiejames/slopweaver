/*
 * `worktree prune`'s scan phase: a run that lost its apply lock while it scanned ends before it moves a cursor or
 * reaches a removal. The witness is the cursor file itself, which a held apply writes.
 */
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { LiveState } from "../../../cli/commands/worktree/pruneLiveState.js";
import { scanPhase } from "../../../cli/commands/worktree/pruneScanPhase.js";
import { stateHomePaths } from "../../../stateHome.js";

/** Every register read whole, holding nothing. */
const LIVE: LiveState = {
  byBranch: new Map(),
  failed: { cwds: false, ledger: false, openHeads: false, workspaces: null },
  index: new Map(),
  unreadable: [],
};

describe("scanPhase — the lock read before the cursors move", () => {
  let home: string;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "scan-phase-"));
  });

  afterEach(() => {
    rmSync(home, { force: true, recursive: true });
  });

  /**
   * Run the phase over no repositories, so the result turns on the lock and the mode alone.
   *
   * @param apply whether this run removes
   * @param ours whether this run still holds the apply lock
   * @returns what the phase answered, and whether the cursor file exists afterwards
   */
  const run = ({ apply, ours }: { apply: boolean; ours: boolean }) => {
    const scanned = scanPhase({
      apply,
      home,
      live: LIVE,
      lockHeld: () => ours,
      nukeAfterMs: 7 * 86_400_000,
      olderThanMs: 86_400_000,
      repos: [],
      scanBudgetMs: 60_000,
    });
    const cursorsWritten = existsSync(join(stateHomePaths({ home }).worktreeBundles, "scan-cursors.json"));
    return { cursorsWritten, scanned };
  };

  it("writes the cursors on an apply that still holds its lock", () => {
    const { scanned, cursorsWritten } = run({ apply: true, ours: true });
    expect(scanned!.queues).toEqual([]);
    expect(cursorsWritten).toBe(true);
  });

  it("ends an apply whose lock another run took over mid-scan, moving no cursor", () => {
    const { scanned, cursorsWritten } = run({ apply: true, ours: false });
    expect(scanned).toBe(null);
    expect(cursorsWritten).toBe(false);
  });

  it("goes on with a dry run and leaves the cursors where the next apply resumes", () => {
    const { scanned, cursorsWritten } = run({ apply: false, ours: true });
    expect(scanned!.queues).toEqual([]);
    expect(cursorsWritten).toBe(false);
  });
});
