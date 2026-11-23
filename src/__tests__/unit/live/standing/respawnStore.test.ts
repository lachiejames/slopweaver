/**
 * The pending-respawn record round-trips, reads as absent when unwritten, refuses a corrupt file, and clears.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { unwrap } from "../../../../lib/result.js";
import {
  clearPendingLoopRespawn,
  readPendingLoopRespawn,
  writePendingLoopRespawn,
} from "../../../../live/standing/respawnStore.js";
import { stateHomePaths } from "../../../../stateHome.js";

const homes: string[] = [];

afterEach(() => {
  for (const dir of homes.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

function home(): string {
  const dir = mkdtempSync(join(tmpdir(), "respawn-store-"));
  homes.push(dir);
  return dir;
}

describe("readPendingLoopRespawn", () => {
  it("reads back exactly what was written, confirmation fields included", () => {
    const dir = home();
    const pending = {
      bootedAtIso: "2026-09-03T07:33:00.000Z",
      confirmedArmId: "bbbb2222",
      confirmedAtIso: "2026-09-03T07:40:00.000Z",
      predecessorArmId: "aaaa1111",
      successor: "live-loop-3sep-a",
      successorTree: "/repo/.claude/worktrees.noindex/live-loop-3sep-a",
    };

    expect(writePendingLoopRespawn({ home: dir, pending }).isOk()).toBe(true);
    const read = readPendingLoopRespawn({ home: dir });

    expect(read.isOk()).toBe(true);
    expect(unwrap(read)).toStrictEqual(pending);
  });

  it("omits an absent predecessor arm rather than writing null", () => {
    const dir = home();
    const pending = {
      bootedAtIso: "2026-09-03T07:33:00.000Z",
      successor: "live-loop-3sep-a",
      successorTree: "/repo/.claude/worktrees.noindex/live-loop-3sep-a",
    };
    writePendingLoopRespawn({ home: dir, pending });

    expect(unwrap(readPendingLoopRespawn({ home: dir }))).toStrictEqual(pending);
  });

  it("reads undefined when nothing was ever written", () => {
    expect(unwrap(readPendingLoopRespawn({ home: home() }))).toBeUndefined();
  });

  it("refuses a file that is not a pending respawn", () => {
    const dir = home();
    const path = stateHomePaths({ home: dir }).live.standing.respawnPendingJson;
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify({ successor: "x" }));
    const read = readPendingLoopRespawn({ home: dir });

    expect(read.isErr()).toBe(true);
    expect(read._unsafeUnwrapErr()[0]!.includes("does not describe a pending respawn")).toBe(true);
  });

  it("refuses a file that is not JSON", () => {
    const dir = home();
    const path = stateHomePaths({ home: dir }).live.standing.respawnPendingJson;
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, "{not json");
    const read = readPendingLoopRespawn({ home: dir });

    expect(read.isErr()).toBe(true);
    expect(read._unsafeUnwrapErr()[0]!.includes("is not JSON")).toBe(true);
  });
});

describe("clearPendingLoopRespawn", () => {
  it("removes a confirmed record, so nothing of an earlier boot reads back", () => {
    const dir = home();
    writePendingLoopRespawn({
      home: dir,
      pending: {
        bootedAtIso: "2026-10-18T03:04:02.737Z",
        confirmedArmId: "7f55cc50",
        successor: "loop-18oct-e",
        successorTree: "/repo/.claude/worktrees.noindex/loop-18oct-e",
      },
    });

    expect(unwrap(clearPendingLoopRespawn({ home: dir }))).toBeUndefined();
    expect(unwrap(readPendingLoopRespawn({ home: dir }))).toBeUndefined();
  });

  it("clears a corrupt record without parsing it", () => {
    const dir = home();
    const path = stateHomePaths({ home: dir }).live.standing.respawnPendingJson;
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, "{not json");

    expect(unwrap(clearPendingLoopRespawn({ home: dir }))).toBeUndefined();
    expect(unwrap(readPendingLoopRespawn({ home: dir }))).toBeUndefined();
  });

  it("reports a record it could not remove rather than claiming it is gone", () => {
    const dir = home();
    const path = stateHomePaths({ home: dir }).live.standing.respawnPendingJson;
    mkdirSync(path, { recursive: true });
    writeFileSync(join(path, "inside"), "a directory where the record should be");
    const cleared = clearPendingLoopRespawn({ home: dir });

    expect(cleared.isErr()).toBe(true);
    expect(cleared._unsafeUnwrapErr()).toHaveLength(1);
    expect(cleared._unsafeUnwrapErr()[0]).toContain(" clearPendingLoopRespawn");
    expect(cleared._unsafeUnwrapErr()[0]).toContain(path);
  });

  it("treats an absent record as already cleared", () => {
    const dir = home();

    expect(unwrap(clearPendingLoopRespawn({ home: dir }))).toBeUndefined();
    expect(unwrap(readPendingLoopRespawn({ home: dir }))).toBeUndefined();
  });
});
