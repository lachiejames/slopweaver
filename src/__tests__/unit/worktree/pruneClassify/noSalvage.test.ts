/*
 * `--no-salvage`: the waiver `salvageWaiverMs` hands the classifier when salvage is off. The trees that would
 * otherwise be salvaged — and so pushed — are held under their own reason, and everything else classifies exactly
 * as it does with salvage on.
 */
import { describe, expect, it } from "vitest";

import { classifyWorktree, type WorktreeFacts } from "../../../../worktree/pruneClassify.js";
import { salvageWaiverMs } from "../../../../worktree/pruneOptions.js";
import { DAY_MS, facts, NOW_MS, NUKE_AFTER_MS, OLDER_THAN_MS } from "./harness.js";

/** Classify under the waiver a run with or without `--no-salvage` would pass. */
const classifyWith = ({ noSalvage, over }: { noSalvage: boolean; over: Partial<WorktreeFacts> }) =>
  classifyWorktree({
    facts: facts(over),
    nowMs: NOW_MS,
    nukeAfterMs: salvageWaiverMs({ noSalvage, nukeAfterMs: NUKE_AFTER_MS }),
    olderThanMs: OLDER_THAN_MS,
  });

const FOURTEEN_DAYS_OLD = NOW_MS - 14 * DAY_MS;

describe("salvageWaiverMs", () => {
  it("passes --nuke-after through when salvage is on", () => {
    expect(salvageWaiverMs({ noSalvage: false, nukeAfterMs: NUKE_AFTER_MS })).toBe(NUKE_AFTER_MS);
  });

  it("answers never when salvage is off, whatever --nuke-after parsed to", () => {
    expect(salvageWaiverMs({ noSalvage: true, nukeAfterMs: NUKE_AFTER_MS })).toBe(Number.POSITIVE_INFINITY);
  });
});

describe("--no-salvage over the classifier", () => {
  const unpushed = { lastActivityMs: FOURTEEN_DAYS_OLD, mergedIntoTrunk: false, unbackedCommits: 5 };

  it("salvages a fortnight-old tree with commits on no remote when salvage is on — the control", () => {
    expect(classifyWith({ noSalvage: false, over: unpushed }).cls).toBe("salvaged");
  });

  it("HOLDS that same tree under its own reason when salvage is off, so nothing is pushed", () => {
    const verdict = classifyWith({ noSalvage: true, over: unpushed });
    expect(verdict.cls).toBe("hold");
    expect(verdict.reason).toBe("5 commit(s) on no remote");
    expect(verdict.deleteBranch).toBe(false);
  });

  it("still drops that held tree's node_modules, which touches no commit", () => {
    expect(classifyWith({ noSalvage: true, over: unpushed }).dropsDeps).toBe(true);
  });

  it("HOLDS a fortnight-old dirty tree rather than capturing and pushing its changes", () => {
    const verdict = classifyWith({
      noSalvage: true,
      over: { dirtyCount: 3, lastActivityMs: FOURTEEN_DAYS_OLD, mergedIntoTrunk: false },
    });
    expect(verdict.cls).toBe("hold");
    expect(verdict.reason).toBe("3 uncommitted change(s)");
  });

  it("leaves a clean, pushed, cold tree in the class that removes it", () => {
    const verdict = classifyWith({
      noSalvage: true,
      over: { lastActivityMs: FOURTEEN_DAYS_OLD, mergedIntoTrunk: false },
    });
    expect(verdict.cls).toBe("pushed");
  });
});
