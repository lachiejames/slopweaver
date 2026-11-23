/**
 * `session respawn`'s CLI edge — the argument contract and the two refusals it makes before touching
 * anything. The GATE logic is pure and covered in `unit/live/standing/respawn.test.ts`; what is tested here
 * is that a caller cannot reach the acting half by accident.
 *
 * Nothing here can boot a workspace: every case either refuses during argument handling, or refuses at a gate
 * that a fresh home makes impossible to pass (there is no armed listener and no registration, so freshness is
 * unmeasurable and the verdict is `busy`).
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  recordLoopBoot,
  runSessionRespawn,
  runSessionRespawnOver,
} from "../../../../../cli/commands/session/respawn.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import { readSupervisorEventsTail } from "../../../../../events/store.js";
import { unwrap } from "../../../../../lib/result.js";
import type { StandingInspectDeps } from "../../../../../live/standing/inspect.js";
import { readPendingLoopRespawn, writePendingLoopRespawn } from "../../../../../live/standing/respawnStore.js";

// Every fixture directory this file has minted, so `afterEach` can remove them.
const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/** Build an argv the router would hand a verb: `[node, cli, session, respawn, …rest]`. */
function argv({ rest }: { rest: readonly string[] }): readonly string[] {
  return ["node", "slopweaver", "session", "respawn", ...rest];
}

/** A fresh, empty state home. */
function home(): string {
  const dir = mkdtempSync(join(tmpdir(), "session-respawn-home-"));
  fixtureDirs.push(dir);
  return dir;
}

/**
 * A machine with no process running and no git to answer: what a fresh home already implies about the loop, read
 * without the real reads. Those read the whole process table and run git (a fetch included) over every checkout a
 * live `--plugin-dir` names — the operator's own sessions — and on a loaded lap that alone outran the 20-second test
 * timeout. What the reads decide is `standingFreshness`'s subject, not this file's.
 */
const NOTHING_RUNNING: StandingInspectDeps = { git: () => undefined, processes: () => [] };

/** The verb over {@link NOTHING_RUNNING}, for every case that reaches the freshness gate. */
function respawnOver({ rest }: { rest: readonly string[] }): Promise<number> {
  return runSessionRespawnOver({ argv: argv({ rest }), inspect: NOTHING_RUNNING });
}

describe("runSessionRespawn", () => {
  it("prints usage on --help without touching disk", async () => {
    expect(await runSessionRespawn(argv({ rest: ["--help"] }))).toBe(EXIT_OK);
  });

  it("rejects a flag it does not know", async () => {
    expect(await runSessionRespawn(argv({ rest: ["--nope"] }))).toBe(EXIT_USAGE);
  });

  it("refuses when no standing session is named", async () => {
    expect(await runSessionRespawn(argv({ rest: ["--home", home()] }))).toBe(EXIT_USAGE);
  });

  it("refuses a session name that is not the standing session", async () => {
    expect(await runSessionRespawn(argv({ rest: ["supervisor", "--home", home()] }))).toBe(EXIT_USAGE);
  });

  // The owner retired the standing recipe-scheduler, so its name is no longer a target here. A seated
  // session closes when its rows are done and has nothing to respawn.
  it("refuses `scheduler`, which was a target until the standing session was retired", async () => {
    expect(await runSessionRespawn(argv({ rest: ["scheduler", "--home", home()] }))).toBe(EXIT_USAGE);
  });

  it("refuses a loop respawn with no successor doc, rather than inventing one", async () => {
    expect(await runSessionRespawn(argv({ rest: ["loop", "--home", home()] }))).toBe(EXIT_USAGE);
  });

  it("refuses rather than acting when a fresh home makes freshness unmeasurable", async () => {
    expect(await respawnOver({ rest: ["loop", "--home", home(), "--successor", "loop-next"] })).toBe(
      EXIT_EXPECTED_EMPTY,
    );
  });

  // A dry run landed between the predecessor's disarm and the successor's arm. The sentence is
  // pinned in `unit/live/standing/respawn.test.ts`; this pins that the record on disk still refuses, and is
  // left standing for `--confirm` rather than consumed by the dry run.
  it("refuses, leaving the record for --confirm, when an unconfirmed boot of this successor is pending", async () => {
    const dir = home();
    const pending = { bootedAtIso: "2026-10-14T13:57:25.935Z", predecessorArmId: "0aaa37af", successor: "loop-next" };
    unwrap(writePendingLoopRespawn({ home: dir, pending: { ...pending, successorTree: "/wt/loop-next" } }));

    expect(await respawnOver({ rest: ["loop", "--home", dir, "--successor", "loop-next", "--dry-run"] })).toBe(
      EXIT_EXPECTED_EMPTY,
    );
    expect(unwrap(readPendingLoopRespawn({ home: dir }))).toEqual({ ...pending, successorTree: "/wt/loop-next" });
  });

  it("still refuses an unmeasurable session under --force — a guess is not a grade", async () => {
    expect(await respawnOver({ rest: ["loop", "--home", home(), "--successor", "loop-next", "--force"] })).toBe(
      EXIT_EXPECTED_EMPTY,
    );
  });

  // The property, not the case: whatever `--dry-run` prints must be what the real invocation would do. It was
  // measured false — the target-tree check sat past the dry-run's early return, so a dry run
  // reported "every gate passed" for an invocation that refused.
  it("agrees with the real invocation rather than reporting a pass the real run would refuse", async () => {
    const shared = home();
    const rest = ["loop", "--home", shared, "--successor", "loop-next"];

    expect(await respawnOver({ rest: [...rest, "--dry-run"] })).toBe(await respawnOver({ rest }));
  });

  it("refuses before acting even under --dry-run, since the gate is what --dry-run reports on", async () => {
    expect(await respawnOver({ rest: ["loop", "--home", home(), "--successor", "loop-next", "--dry-run"] })).toBe(
      EXIT_EXPECTED_EMPTY,
    );
  });

  it("refuses --confirm combined with --dry-run or --force", async () => {
    expect(await runSessionRespawn(argv({ rest: ["loop", "--home", home(), "--confirm", "--dry-run"] }))).toBe(
      EXIT_USAGE,
    );
    expect(await runSessionRespawn(argv({ rest: ["loop", "--home", home(), "--confirm", "--force"] }))).toBe(
      EXIT_USAGE,
    );
  });

  it("does not need --successor under --confirm — the pending record names it", async () => {
    expect(await runSessionRespawn(argv({ rest: ["loop", "--home", home(), "--confirm"] }))).toBe(EXIT_EXPECTED_EMPTY);
  });
});

describe("runSessionRespawn --confirm", () => {
  const pending = {
    bootedAtIso: "2026-09-03T07:33:00.000Z",
    predecessorArmId: "aaaa1111",
    successor: "live-loop-3sep-a",
    successorTree: "/repo/.claude/worktrees.noindex/live-loop-3sep-a",
  };

  it("reads 'not yet' and publishes nothing when a boot is pending and nothing is armed", async () => {
    const dir = home();
    writePendingLoopRespawn({ home: dir, pending });

    expect(await runSessionRespawn(argv({ rest: ["loop", "--home", dir, "--confirm"] }))).toBe(EXIT_EXPECTED_EMPTY);
    expect(unwrap(readPendingLoopRespawn({ home: dir }))).toStrictEqual(pending);
    expect(unwrap(readSupervisorEventsTail({ home: dir }))).toStrictEqual([]);
  });

  // The record on disk read "confirmed" for an earlier successor, and `--confirm` exited
  // 0 on it while the arm it named was gone — so a successor whose own arm never went live read as respawned. A
  // confirmation is evidence only while the arm it names is the one live now.
  it("refuses a stale confirmation whose arm is no longer live, and republishes nothing", async () => {
    const dir = home();
    const stale = { ...pending, confirmedArmId: "bbbb2222", confirmedAtIso: "2026-09-03T07:40:00.000Z" };
    writePendingLoopRespawn({ home: dir, pending: stale });

    expect(await runSessionRespawn(argv({ rest: ["loop", "--home", dir, "--confirm"] }))).toBe(EXIT_EXPECTED_EMPTY);
    expect(unwrap(readPendingLoopRespawn({ home: dir }))).toStrictEqual(stale);
    expect(unwrap(readSupervisorEventsTail({ home: dir }))).toStrictEqual([]);
  });
});

// The audit's root cause: a boot whose tree could not be resolved recorded nothing and LEFT the previous
// successor's confirmed record standing, while printing that `--confirm` would refuse. It did not; it exited 0.
describe("recordLoopBoot", () => {
  const earlier = {
    bootedAtIso: "2026-10-18T03:04:02.737Z",
    confirmedArmId: "7f55cc50",
    confirmedAtIso: "2026-10-18T03:09:01.300Z",
    predecessorArmId: "9d1accd8",
    successor: "loop-18oct-e",
    successorTree: "/repo/.claude/worktrees.noindex/loop-18oct-e",
  };
  const nowMs = Date.parse("2026-10-18T05:00:00.000Z");

  it("removes the earlier confirmed record when this boot recorded no tree, so --confirm truly refuses", async () => {
    const dir = home();
    unwrap(writePendingLoopRespawn({ home: dir, pending: earlier }));

    expect(
      recordLoopBoot({
        home: dir,
        nowMs,
        predecessorArmId: "7f55cc50",
        successor: "loop-18oct-f",
        successorTree: undefined,
      }),
    ).toBe(EXIT_ERROR);
    expect(unwrap(readPendingLoopRespawn({ home: dir }))).toBeUndefined();
    expect(await runSessionRespawn(argv({ rest: ["loop", "--home", dir, "--confirm"] }))).toBe(EXIT_EXPECTED_EMPTY);
  });

  it("replaces the earlier confirmed record whole with this boot's unconfirmed one", () => {
    const dir = home();
    unwrap(writePendingLoopRespawn({ home: dir, pending: earlier }));

    expect(
      recordLoopBoot({
        home: dir,
        nowMs,
        predecessorArmId: "7f55cc50",
        successor: "loop-18oct-f",
        successorTree: "/repo/.claude/worktrees.noindex/loop-18oct-e",
      }),
    ).toBe(EXIT_OK);
    const record = unwrap(readPendingLoopRespawn({ home: dir }))!;
    expect(record.bootId!.length).toBeGreaterThan(0);
    expect(record).toStrictEqual({
      bootedAtIso: "2026-10-18T05:00:00.000Z",
      bootId: record.bootId,
      predecessorArmId: "7f55cc50",
      successor: "loop-18oct-f",
      successorTree: "/repo/.claude/worktrees.noindex/loop-18oct-e",
    });
  });
});
