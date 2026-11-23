/**
 * The scheduled recovery sweep's durable cadence rules — `isMigrating`, `nextSweepState`, `startingCheckpoints`.
 * Pure over `RecoverySweepState`, except `startingCheckpoints`'s migrating arm, which reads the corpus thread
 * cursor store from an explicit temp home.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  isMigrating,
  nextSweepState,
  startingCheckpoints,
} from "../../../../../cli/commands/listen/scheduledRecoverState.js";
import { threadKey, writeThreadCursors } from "../../../../../corpus/slack/threadCursors.js";
import { unwrap } from "../../../../../lib/result.js";
import {
  RECOVERY_INTERVAL_MS,
  type RecoverySweepState,
  type RecoveryWindow,
} from "../../../../../live/listen/recoverSchedule.js";

const NOW_MS = Date.parse("2026-10-02T08:00:00.000Z");
const NEXT_DUE = new Date(NOW_MS + RECOVERY_INTERVAL_MS).toISOString();
const V1: RecoverySweepState = {
  completedThroughTs: "1790900000.000000",
  nextDueAtIso: "2026-10-02T07:00:00.000Z",
  version: 1,
};
const V2: RecoverySweepState = {
  completedThroughTs: "1790900000.000000",
  nextDueAtIso: "2026-10-02T07:00:00.000Z",
  threadCheckpoints: { "C1:1.1": { cursorTs: "1790899999.000000" } },
  version: 2,
};
const WINDOW: RecoveryWindow = {
  latestExclusiveTs: "1790924298.000000",
  oldestExclusiveTs: "1790320000.000000",
  sinceIso: "2026-09-25T08:00:00.000Z",
  untilIso: "2026-10-02T08:00:00.000Z",
};

describe("isMigrating", () => {
  it("is true before any sweep has run", () => {
    expect(isMigrating({ state: undefined })).toBe(true);
  });

  it("is true for a V1 state, whose checkpoint inventory was never established", () => {
    expect(isMigrating({ state: V1 })).toBe(true);
  });

  it("is false for a V2 state", () => {
    expect(isMigrating({ state: V2 })).toBe(false);
  });
});

describe("nextSweepState", () => {
  it("advances the watermark and the checkpoints on a complete sweep", () => {
    const threadCheckpoints = { "C2:2.2": { cursorTs: "1790924000.000000" } };

    expect(
      nextSweepState({
        complete: true,
        latestExclusiveTs: "1790924298.000000",
        migrating: false,
        nowMs: NOW_MS,
        previous: V2,
        threadCheckpoints,
      }),
    ).toEqual({
      completedThroughTs: "1790924298.000000",
      nextDueAtIso: NEXT_DUE,
      threadCheckpoints,
      version: 2,
    });
  });

  it("retains both the watermark and the previous checkpoints on a partial sweep", () => {
    expect(
      nextSweepState({
        complete: false,
        latestExclusiveTs: "1790924298.000000",
        migrating: false,
        nowMs: NOW_MS,
        previous: V2,
        threadCheckpoints: { "C2:2.2": { cursorTs: "1790924000.000000" } },
      }),
    ).toEqual({
      completedThroughTs: "1790900000.000000",
      nextDueAtIso: NEXT_DUE,
      threadCheckpoints: { "C1:1.1": { cursorTs: "1790899999.000000" } },
      version: 2,
    });
  });

  it("omits a watermark a partial first sweep never had", () => {
    expect(
      nextSweepState({
        complete: false,
        latestExclusiveTs: "1790924298.000000",
        migrating: false,
        nowMs: NOW_MS,
        previous: undefined,
        threadCheckpoints: {},
      }),
    ).toEqual({ nextDueAtIso: NEXT_DUE, threadCheckpoints: {}, version: 2 });
  });

  it("writes a real V1 state back untouched, due date included, after a partial migrating sweep", () => {
    expect(
      nextSweepState({
        complete: false,
        latestExclusiveTs: "1790924298.000000",
        migrating: true,
        nowMs: NOW_MS,
        previous: V1,
        threadCheckpoints: { "C2:2.2": { cursorTs: "1790924000.000000" } },
      }),
    ).toBe(V1);
  });

  it("writes a fresh V1 state after a partial migrating first sweep with nothing to preserve", () => {
    expect(
      nextSweepState({
        complete: false,
        latestExclusiveTs: "1790924298.000000",
        migrating: true,
        nowMs: NOW_MS,
        previous: undefined,
        threadCheckpoints: {},
      }),
    ).toEqual({ nextDueAtIso: NEXT_DUE, version: 1 });
  });

  it("completes a migration into V2 once the migrating sweep is complete", () => {
    const threadCheckpoints = { "C2:2.2": { cursorTs: "1790924000.000000" } };

    expect(
      nextSweepState({
        complete: true,
        latestExclusiveTs: "1790924298.000000",
        migrating: true,
        nowMs: NOW_MS,
        previous: V1,
        threadCheckpoints,
      }),
    ).toEqual({
      completedThroughTs: "1790924298.000000",
      nextDueAtIso: NEXT_DUE,
      threadCheckpoints,
      version: 2,
    });
  });
});

describe("startingCheckpoints", () => {
  let home = "";
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "slop-sched-state-"));
  });
  afterEach(() => {
    rmSync(home, { force: true, recursive: true });
  });

  it("carries a V2 state's own inventory forward on an ordinary sweep", () => {
    expect(startingCheckpoints({ home, migrating: false, previous: V2, window: WINDOW })).toEqual({
      "C1:1.1": { cursorTs: "1790899999.000000" },
    });
  });

  it("starts empty on an ordinary sweep that has no V2 state", () => {
    expect(startingCheckpoints({ home, migrating: false, previous: V1, window: WINDOW })).toEqual({});
  });

  it("starts empty on a migration when the corpus knows no threads", () => {
    expect(startingCheckpoints({ home, migrating: true, previous: undefined, window: WINDOW })).toEqual({});
  });

  it("seeds only the corpus's thread KEYS on a migration, each at the wide window's lower bound", () => {
    const key = threadKey({ channel: "C9", threadTs: "9.9" });
    unwrap(writeThreadCursors({ cursors: { [key]: { ts: "1790923999.000000" } }, home }));

    expect(startingCheckpoints({ home, migrating: true, previous: V1, window: WINDOW })).toEqual({
      [key]: { cursorTs: WINDOW.oldestExclusiveTs },
    });
  });
});
