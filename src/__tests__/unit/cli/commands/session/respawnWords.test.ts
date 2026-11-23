/** The successor's tree, and the word `session respawn loop` prints for each value a record may lack. */
import { describe, expect, it } from "vitest";
import {
  confirmedAtWords,
  holderWorktreeWords,
  predecessorArmWords,
  spawnedSuccessorTree,
  successorWorktree,
  supersededBootWords,
} from "../../../../../cli/commands/session/respawnWords.js";
import { conventionalWorktreePath } from "../../../../../cmux/plan.js";
import type { RunWriter } from "../../../../../handover/runOwner.js";
import type { PendingLoopRespawn } from "../../../../../live/standing/respawnStore.js";
import type { SessionEvent } from "../../../../../sessions/session.js";

const REPO = "/repo";
const CONVENTIONAL = conventionalWorktreePath({ repoRoot: REPO, slug: "loop-next" });

/** A run writer with the worktree under test, every other field fixed. */
function writer({ worktree }: { worktree: string | undefined }): RunWriter {
  return { atIso: "2026-10-01T00:00:00.000Z", pid: undefined, sessionId: "s-1", worktree };
}

/** A pending record already confirmed on an arm, with or without its instant. */
function confirmed({ confirmedAtIso }: { confirmedAtIso?: string }): PendingLoopRespawn {
  return {
    bootedAtIso: "2026-10-01T00:00:00.000Z",
    confirmedArmId: "arm-2",
    ...(confirmedAtIso === undefined ? {} : { confirmedAtIso }),
    successor: "loop-next",
    successorTree: "/repo/.claude/worktrees/loop-next",
  };
}

describe("successorWorktree", () => {
  it("finds the worktree holding the successor's branch first, wherever it lives", () => {
    const worktrees = [
      { branch: "something-else", path: CONVENTIONAL },
      { branch: "loop-next", path: "/elsewhere/loop-next" },
    ];
    expect(successorWorktree({ repoRoot: REPO, successor: "loop-next", worktrees })).toEqual({
      branch: "loop-next",
      path: "/elsewhere/loop-next",
    });
  });

  it("falls to whatever is registered at the conventional path when no worktree holds the branch", () => {
    const worktrees = [{ branch: null, path: CONVENTIONAL }];
    expect(successorWorktree({ repoRoot: REPO, successor: "loop-next", worktrees })).toEqual({
      branch: null,
      path: CONVENTIONAL,
    });
  });

  it("finds nothing when neither key matches", () => {
    const worktrees = [{ branch: "main", path: REPO }];
    expect(successorWorktree({ repoRoot: REPO, successor: "loop-next", worktrees })).toBe(undefined);
  });
});

describe("holderWorktreeWords", () => {
  it("names the holder's recorded worktree", () => {
    expect(holderWorktreeWords({ writer: writer({ worktree: "/repo/.claude/worktrees/x" }) })).toBe(
      "/repo/.claude/worktrees/x",
    );
  });

  it("says the journal recorded none", () => {
    expect(holderWorktreeWords({ writer: writer({ worktree: undefined }) })).toBe("an unrecorded worktree");
  });
});

describe("predecessorArmWords", () => {
  it("names the predecessor's arm", () => {
    expect(predecessorArmWords({ predecessorArmId: "arm-1" })).toBe("arm-1");
  });

  it("names whichever arm stands when no arm was live at the gates", () => {
    expect(predecessorArmWords({ predecessorArmId: undefined })).toBe("the one standing now");
  });
});

describe("confirmedAtWords", () => {
  it("names the confirmation instant", () => {
    expect(confirmedAtWords({ record: confirmed({ confirmedAtIso: "2026-10-01T00:05:00.000Z" }) })).toBe(
      "2026-10-01T00:05:00.000Z",
    );
  });

  it("says the record carries none", () => {
    expect(confirmedAtWords({ record: confirmed({}) })).toBe("an unrecorded instant");
  });
});

// A phase one could replace the record between `--confirm`'s read and its answer.
describe("supersededBootWords", () => {
  const before = confirmed({ confirmedAtIso: "2026-10-01T00:05:00.000Z" });

  it("is the same boot when only a confirmation was stamped on it meanwhile", () => {
    const unstamped = {
      bootedAtIso: before.bootedAtIso,
      successor: before.successor,
      successorTree: before.successorTree,
    };

    expect(
      supersededBootWords({ before: unstamped, now: before, judgedArmId: "arm-2", unreadable: false }),
    ).toBeUndefined();
  });

  it("names the boot that replaced the one judged", () => {
    const now = { bootedAtIso: "2026-10-01T01:00:00.000Z", successor: "loop-later", successorTree: "/wt/later" };

    expect(supersededBootWords({ before, now, judgedArmId: "arm-2", unreadable: false })).toBe(
      "the respawn to loop-next booted 2026-10-01T00:00:00.000Z was replaced while this read ran by a respawn to " +
        "loop-later booted 2026-10-01T01:00:00.000Z; that boot confirms its own arm. Not respawned.",
    );
  });

  // Two boots can share instant, slug and tree; the boot id tells them apart.
  it("names a boot that shares instant, slug and tree but carries a different boot id", () => {
    const first = { ...before, bootId: "boot-a" };
    const second = { ...before, bootId: "boot-b" };

    expect(supersededBootWords({ before: first, now: second, judgedArmId: "arm-2", unreadable: false })).toBe(
      "the respawn to loop-next booted 2026-10-01T00:00:00.000Z was replaced while this read ran by a respawn to " +
        "loop-next booted 2026-10-01T00:00:00.000Z; that boot confirms its own arm. Not respawned.",
    );
  });

  it("is the same boot when the boot id matches and only a confirmation was stamped meanwhile", () => {
    const unstamped = {
      bootedAtIso: before.bootedAtIso,
      bootId: "boot-a",
      successor: before.successor,
      successorTree: before.successorTree,
    };

    expect(
      supersededBootWords({
        before: unstamped,
        now: { ...before, bootId: "boot-a" },
        judgedArmId: "arm-2",
        unreadable: false,
      }),
    ).toBe(undefined);
  });

  // Two records written before the boot id existed, equal on instant, slug and tree, are still two
  // boots when they were measured against different predecessor arms.
  it("names an id-less boot that shares instant, slug and tree but not the predecessor arm", () => {
    const first = { ...before, predecessorArmId: "arm-p1" };
    const second = { ...before, predecessorArmId: "arm-p2" };

    expect(supersededBootWords({ before: first, now: second, judgedArmId: "arm-2", unreadable: false })).toBe(
      "the respawn to loop-next booted 2026-10-01T00:00:00.000Z was replaced while this read ran by a respawn to " +
        "loop-next booted 2026-10-01T00:00:00.000Z; that boot confirms its own arm. Not respawned.",
    );
  });

  it("names a boot carrying an id where the judged record carried none", () => {
    expect(
      supersededBootWords({ before, now: { ...before, bootId: "boot-b" }, judgedArmId: "arm-2", unreadable: false }),
    ).toBe(
      "the respawn to loop-next booted 2026-10-01T00:00:00.000Z was replaced while this read ran by a respawn to " +
        "loop-next booted 2026-10-01T00:00:00.000Z; that boot confirms its own arm. Not respawned.",
    );
  });

  // Concurrent `--confirm`s around a re-arm each judged a different arm of the same boot.
  it("refuses when another --confirm confirmed the same boot on a different arm meanwhile", () => {
    expect(supersededBootWords({ before, judgedArmId: "arm-1", now: before, unreadable: false })).toBe(
      "the respawn to loop-next booted 2026-10-01T00:00:00.000Z was confirmed on arm arm-2 by another `--confirm` " +
        "while this one judged arm arm-1, so this answer is stale. Not respawned.",
    );
  });

  it("is the same boot when it is still unconfirmed at the re-read", () => {
    const unstamped = {
      bootedAtIso: before.bootedAtIso,
      successor: before.successor,
      successorTree: before.successorTree,
    };

    expect(supersededBootWords({ before: unstamped, judgedArmId: "arm-1", now: unstamped, unreadable: false })).toBe(
      undefined,
    );
  });

  it("refuses when the record was removed meanwhile", () => {
    expect(supersededBootWords({ before, now: undefined, judgedArmId: "arm-2", unreadable: false })).toBe(
      "the respawn to loop-next booted 2026-10-01T00:00:00.000Z was removed while this read ran — a later boot " +
        "replaced it. Not respawned.",
    );
  });

  it("refuses when the re-read failed, rather than reading that as the same boot", () => {
    expect(supersededBootWords({ before, judgedArmId: "arm-2", now: undefined, unreadable: true })).toBe(
      "the pending record could not be re-read after judging the respawn to loop-next booted " +
        "2026-10-01T00:00:00.000Z, so it is not confirmed. Not respawned.",
    );
  });
});

/** A `spawned` session-ledger row for one slug, landed in one tree at one instant. */
function spawned({ slug, cwd, tsIso }: { slug: string | undefined; cwd: string; tsIso: string }): SessionEvent {
  return {
    branch: "some-branch",
    cwd,
    kind: "spawned",
    sessionKey: "session-key",
    slug,
    surfaceRef: "surface:1",
    tsIso,
    workspaceRef: "workspace:1",
  };
}

// A loop doc that declares the PREDECESSOR's branch boots into the predecessor's tree,
// which no slug key finds. The boot's own `spawned` row names it.
describe("spawnedSuccessorTree", () => {
  const sinceMs = Date.parse("2026-10-18T03:04:02.737Z");

  it("names the tree this boot's own row landed in, even when no slug key could find it", () => {
    const events = [spawned({ cwd: "/wt/loop-18oct-e", slug: "loop-18oct-f", tsIso: "2026-10-18T03:04:09.000Z" })];

    expect(spawnedSuccessorTree({ events, sinceMs, successor: "loop-18oct-f" })).toBe("/wt/loop-18oct-e");
  });

  it("ignores a row from an earlier boot of the same slug", () => {
    const events = [spawned({ cwd: "/wt/old", slug: "loop-18oct-f", tsIso: "2026-10-18T02:00:00.000Z" })];

    expect(spawnedSuccessorTree({ events, sinceMs, successor: "loop-18oct-f" })).toBeUndefined();
  });

  it("ignores another slug's row and a worker's slugless row, and takes the latest of this boot's", () => {
    const events = [
      spawned({ cwd: "/wt/first", slug: "loop-18oct-f", tsIso: "2026-10-18T03:04:05.000Z" }),
      spawned({ cwd: "/wt/other", slug: "loop-18oct-g", tsIso: "2026-10-18T03:04:06.000Z" }),
      spawned({ cwd: "/wt/worker", slug: undefined, tsIso: "2026-10-18T03:04:07.000Z" }),
      spawned({ cwd: "/wt/second", slug: "loop-18oct-f", tsIso: "2026-10-18T03:04:08.000Z" }),
    ];

    expect(spawnedSuccessorTree({ events, sinceMs, successor: "loop-18oct-f" })).toBe("/wt/second");
  });

  it("takes a row at the boundary instant, and ignores noted, closed and malformed-time rows", () => {
    const events: SessionEvent[] = [
      spawned({ cwd: "/wt/boundary", slug: "loop-18oct-f", tsIso: "2026-10-18T03:04:02.737Z" }),
      { kind: "noted", note: "n", sessionKey: "loop-18oct-f", tsIso: "2026-10-18T03:05:00.000Z" },
      { kind: "closed", sessionKey: "loop-18oct-f", tsIso: "2026-10-18T03:06:00.000Z" },
      spawned({ cwd: "/wt/garbled", slug: "loop-18oct-f", tsIso: "not-a-time" }),
    ];

    expect(spawnedSuccessorTree({ events, sinceMs, successor: "loop-18oct-f" })).toBe("/wt/boundary");
  });

  it("answers undefined on an empty ledger", () => {
    expect(spawnedSuccessorTree({ events: [], sinceMs, successor: "loop-18oct-f" })).toBeUndefined();
  });
});
