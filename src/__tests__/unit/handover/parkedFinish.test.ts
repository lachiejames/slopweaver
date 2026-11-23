/**
 * The narrow exception that lets `handover finish` reach its own gates on a run released by a park — and only
 * that verb, only on an open run, and only while the park still stands.
 */
import { describe, expect, it } from "vitest";

import type { RunEvent } from "../../../handover/ledger.js";
import {
  boundParkFlags,
  finishOwnershipPrecondition,
  parkedReleaseOpensFinish,
  probedRepoMoved,
} from "../../../handover/parkedFinish.js";
import type { RunOwnership } from "../../../handover/runOwner.js";

const WRITER = { atIso: "2026-11-05T01:00:01.000Z", pid: 7, sessionId: "s-1", worktree: "/wt/a" } as const;

const RELEASED: RunOwnership = {
  kind: "released",
  releasedAtIso: "2026-11-05T02:00:00.000Z",
  why: "parked",
  writer: WRITER,
};

const STARTED: RunEvent = { atIso: "2026-11-05T01:00:00.000Z", branch: "a", docHash: "h", kind: "started" };

/** The seat the park names as its holder: a park naming nobody who held the run is no checkpoint. */
const LAUNCHED: RunEvent = {
  atIso: "2026-11-05T01:00:01.000Z",
  kind: "launched",
  pid: 7,
  sessionId: "s-1",
  worktree: "/wt/a",
};

const PARKED: RunEvent = {
  atIso: "2026-11-05T02:00:00.000Z",
  branch: "a",
  kind: "parked",
  screenTail: "❯ ",
  sessionId: "s-1",
  wake: { kind: "checks", number: 7, repo: "o/r" },
  workspaceRef: "workspace:1",
  worktree: "/wt/a",
};

const DISPATCHED: RunEvent = {
  atIso: "2026-11-05T03:00:00.000Z",
  by: "cmux spawn",
  kind: "dispatched",
  target: "workspace:2",
};

describe("parkedReleaseOpensFinish", () => {
  it("opens finish on an open run released by a park that still stands", () => {
    expect(
      parkedReleaseOpensFinish({
        events: [STARTED, LAUNCHED, PARKED],
        ownership: RELEASED,
        phase: "open",
        verb: "finish",
      }),
    ).toBe(true);
  });

  it("opens no other verb on the same run", () => {
    const verbs = ["ask", "amend", "correct", "offer", "withdraw", "settle"];
    expect(
      verbs.map((verb) =>
        parkedReleaseOpensFinish({
          events: [STARTED, LAUNCHED, PARKED],
          ownership: RELEASED,
          phase: "open",
          verb,
        }),
      ),
    ).toEqual(verbs.map(() => false));
  });

  it("stays shut once a reseat's dispatch cleared the park", () => {
    expect(
      parkedReleaseOpensFinish({
        events: [STARTED, LAUNCHED, PARKED, DISPATCHED],
        ownership: RELEASED,
        phase: "open",
        verb: "finish",
      }),
    ).toBe(false);
  });

  it("stays shut on a run released with no park at all", () => {
    expect(parkedReleaseOpensFinish({ events: [STARTED], ownership: RELEASED, phase: "open", verb: "finish" })).toBe(
      false,
    );
  });

  it("stays shut on a closed run", () => {
    expect(
      parkedReleaseOpensFinish({
        events: [STARTED, LAUNCHED, PARKED],
        ownership: RELEASED,
        phase: "closed",
        verb: "finish",
      }),
    ).toBe(false);
  });

  it("stays shut on a run another session holds", () => {
    const elsewhere: RunOwnership = { kind: "elsewhere", thisSession: "s-2", writer: WRITER };
    expect(
      parkedReleaseOpensFinish({
        events: [STARTED, LAUNCHED, PARKED],
        ownership: elsewhere,
        phase: "open",
        verb: "finish",
      }),
    ).toBe(false);
  });
});

/** A reseat's seat taking the run after its dispatch cleared the park. */
const RESEATED: RunEvent = {
  atIso: "2026-11-05T03:00:05.000Z",
  kind: "launched",
  pid: 8,
  sessionId: "s-2",
  worktree: "/wt/a",
};

describe("finishOwnershipPrecondition", () => {
  const precondition = finishOwnershipPrecondition({ phase: "open", sessionId: "s-wake" });

  it("lets the append through while the park that released the run still stands", () => {
    expect(precondition({ events: [STARTED, LAUNCHED, PARKED] })).toBeUndefined();
  });

  // A claim landing while finish ran its gates must not be closed underneath its new owner.
  it("refuses the append once another session took the run during the gates", () => {
    expect(precondition({ events: [STARTED, LAUNCHED, PARKED, DISPATCHED, RESEATED] })).toBe(
      "session s-2 took the run while finish was running its gates, so finish will not close it underneath them",
    );
  });

  it("lets the session that holds the run append", () => {
    const held = finishOwnershipPrecondition({ phase: "open", sessionId: "s-2" });
    expect(held({ events: [STARTED, LAUNCHED, PARKED, DISPATCHED, RESEATED] })).toBeUndefined();
  });
});

describe("finishOwnershipPrecondition bound to one park", () => {
  const bound = finishOwnershipPrecondition({
    park: { atIso: "2026-11-05T02:00:00Z", index: 2 },
    phase: "open",
    sessionId: "s-wake",
  });

  it("lets the append through while that very park stands, however its instant is spelled", () => {
    expect(bound({ events: [STARTED, LAUNCHED, PARKED] })).toBeUndefined();
  });

  // A reseat and a fresh park landing while finish ran leave a released run with A park
  // standing — not the one the wake asked about.
  it("refuses the append once the run re-parked after a reseat, though a park stands again", () => {
    const reparked: RunEvent = { ...PARKED, atIso: "2026-11-05T03:10:00.000Z", sessionId: "s-2" };
    expect(bound({ events: [STARTED, LAUNCHED, PARKED, DISPATCHED, RESEATED, reparked] })).toBe(
      "the park of 2026-11-05T02:00:00Z at journal position 2 this finish was asked about no longer stands, so finish will not close the run on its behalf",
    );
  });

  // An instant alone matched a re-park that carried the same one.
  it("refuses the append once the run re-parked at the very same instant", () => {
    const sameInstant: RunEvent = { ...PARKED, sessionId: "s-2" };
    expect(bound({ events: [STARTED, LAUNCHED, PARKED, DISPATCHED, RESEATED, sameInstant] })).toContain(
      "at journal position 2 this finish was asked about no longer stands",
    );
  });

  it("refuses the append when the park at the bound position carries another instant", () => {
    const other = finishOwnershipPrecondition({
      park: { atIso: "2026-11-05T02:00:01Z", index: 2 },
      phase: "open",
      sessionId: "s-wake",
    });
    expect(other({ events: [STARTED, LAUNCHED, PARKED] })).toContain("no longer stands");
  });

  it("refuses the append once no park stands at all", () => {
    expect(bound({ events: [STARTED, LAUNCHED, PARKED, DISPATCHED] })).toContain("no longer stands");
  });
});

describe("boundParkFlags", () => {
  it("binds the park both flags name", () => {
    expect(boundParkFlags({ parkIndex: "2", parkedAt: "2026-11-05T02:00:00Z" })).toEqual({
      kind: "bound",
      park: { atIso: "2026-11-05T02:00:00Z", index: 2 },
    });
  });

  it("binds nothing when neither flag is given", () => {
    expect(boundParkFlags({ parkIndex: undefined, parkedAt: undefined })).toEqual({ kind: "unbound" });
  });

  it("refuses one flag without the other, either way round", () => {
    expect([
      boundParkFlags({ parkIndex: "2", parkedAt: undefined }),
      boundParkFlags({ parkIndex: undefined, parkedAt: "2026-11-05T02:00:00Z" }),
    ]).toEqual([
      { kind: "invalid", why: "--park-index and --parked-at bind one park together; give both or neither" },
      { kind: "invalid", why: "--park-index and --parked-at bind one park together; give both or neither" },
    ]);
  });

  it("refuses an index that is no journal position, and an instant that is not UTC", () => {
    expect([
      boundParkFlags({ parkIndex: "-1", parkedAt: "2026-11-05T02:00:00Z" }),
      boundParkFlags({ parkIndex: "2", parkedAt: "2026-11-05T02:00:00+10:00" }),
    ]).toEqual([
      { kind: "invalid", why: '--park-index must be a journal position, not "-1"' },
      { kind: "invalid", why: '--parked-at must be a UTC instant ending in Z, not "2026-11-05T02:00:00+10:00"' },
    ]);
  });
});

// A doc rewritten between the wake's proof and finish's own read must not be probed.
describe("probedRepoMoved", () => {
  it("lets a finish through with no repo named, or the very repo the doc still names", () => {
    expect([
      probedRepoMoved({ docRepo: "/repo/acme", probedRepo: undefined }),
      probedRepoMoved({ docRepo: "/repo/acme", probedRepo: "/repo/acme" }),
    ]).toEqual([undefined, undefined]);
  });

  it("refuses once the doc names another repo, or none", () => {
    expect([
      probedRepoMoved({ docRepo: "/repo/other", probedRepo: "/repo/acme" }),
      probedRepoMoved({ docRepo: undefined, probedRepo: "/repo/acme" }),
    ]).toEqual([
      "--probed-repo /repo/acme was proved, but the doc now names /repo/other, so finish will not probe a tree nobody " +
        "proved",
      "--probed-repo /repo/acme was proved, but the doc now names no repo:, so finish will not probe a tree nobody " +
        "proved",
    ]);
  });
});
