/**
 * `confirmLoopRespawn`, phase two of a loop respawn, called directly over a temp home. Its verb-level twin is
 * `respawn.test.ts`'s `--confirm` block; this pins the exported function itself, so a caller other than the
 * router is held to the same answer: exit 0 only while the arm a record names is the one live now.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { confirmLoopRespawn } from "../../../../../cli/commands/session/respawnConfirm.js";
import { EXIT_EXPECTED_EMPTY } from "../../../../../cli/exitCodes.js";
import { readSupervisorEventsTail } from "../../../../../events/store.js";
import { unwrap } from "../../../../../lib/result.js";
import { readPendingLoopRespawn, writePendingLoopRespawn } from "../../../../../live/standing/respawnStore.js";

// Every fixture directory this file has minted, so `afterEach` can remove them.
const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/** A fresh, empty state home. */
function home(): string {
  const dir = mkdtempSync(join(tmpdir(), "respawn-confirm-home-"));
  fixtureDirs.push(dir);
  return dir;
}

describe("confirmLoopRespawn", () => {
  const nowMs = Date.parse("2026-10-18T05:00:00.000Z");
  const pending = {
    bootedAtIso: "2026-10-18T04:55:00.000Z",
    bootId: "boot-1",
    predecessorArmId: "aaaa1111",
    successor: "live-loop-18oct-a",
    successorTree: "/repo/.claude/worktrees.noindex/live-loop-18oct-a",
  };

  it("reads 'nothing pending' with no record, and writes none", () => {
    const dir = home();

    expect(confirmLoopRespawn({ home: dir, nowMs })).toBe(EXIT_EXPECTED_EMPTY);
    expect(unwrap(readPendingLoopRespawn({ home: dir }))).toBe(undefined);
    expect(unwrap(readSupervisorEventsTail({ home: dir }))).toStrictEqual([]);
  });

  it("reads 'not yet' on an unconfirmed boot with nothing armed, leaving the record unstamped", () => {
    const dir = home();
    unwrap(writePendingLoopRespawn({ home: dir, pending }));

    expect(confirmLoopRespawn({ home: dir, nowMs })).toBe(EXIT_EXPECTED_EMPTY);
    expect(unwrap(readPendingLoopRespawn({ home: dir }))).toStrictEqual(pending);
    expect(unwrap(readSupervisorEventsTail({ home: dir }))).toStrictEqual([]);
  });

  // Audit L6-1: a confirmation on record answered 0 though the arm it named was gone.
  it("refuses a confirmation whose arm is not live, neither re-stamping nor republishing", () => {
    const dir = home();
    const stale = { ...pending, confirmedArmId: "bbbb2222", confirmedAtIso: "2026-10-18T04:58:00.000Z" };
    unwrap(writePendingLoopRespawn({ home: dir, pending: stale }));

    expect(confirmLoopRespawn({ home: dir, nowMs })).toBe(EXIT_EXPECTED_EMPTY);
    expect(unwrap(readPendingLoopRespawn({ home: dir }))).toStrictEqual(stale);
    expect(unwrap(readSupervisorEventsTail({ home: dir }))).toStrictEqual([]);
  });
});
