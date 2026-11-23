/*
 * `runOwnership` — whether a run is unowned, this session's, held elsewhere or released, including when this session
 * cannot identify itself. It moved here when `runOwner.test.ts` was split by behaviour.
 */
import { describe, expect, it } from "vitest";

import type { RunEvent } from "../../../../handover/ledger.js";
import { runOwnership } from "../../../../handover/runOwner.js";
import { AT, launched, MINE, STARTED, THEIRS } from "./harness.js";

describe("runOwnership", () => {
  it("is unowned when nothing recorded a writer, which keeps the gate's original behaviour", () => {
    expect(runOwnership({ events: [STARTED], sessionId: MINE })).toEqual({ kind: "unowned" });
  });

  it("is mine when the recorded session is this one", () => {
    const ownership = runOwnership({ events: [STARTED, launched({ sessionId: MINE })], sessionId: MINE });

    expect(ownership.kind).toBe("mine");
  });

  it("is elsewhere when another session recorded itself, and remembers which session asked", () => {
    const events = [STARTED, launched({ atIso: AT, sessionId: THEIRS })];

    expect(runOwnership({ events, sessionId: MINE })).toEqual({
      kind: "elsewhere",
      thisSession: MINE,
      writer: { atIso: AT, pid: 65036, sessionId: THEIRS, worktree: "/tmp/fleet/a-doc" },
    });
  });

  /**
   * The rule that decides which way to be wrong. A missed interrupt costs a turn; claiming a run that is not
   * yours costs another session's branch — measured, twice, as competing all-green PRs for one fix.
   */
  it("is elsewhere, NOT mine, when this session cannot be identified", () => {
    const events = [STARTED, launched({ atIso: AT, sessionId: THEIRS })];

    expect(runOwnership({ events, sessionId: undefined })).toEqual({
      kind: "elsewhere",
      thisSession: undefined,
      writer: { atIso: AT, pid: 65036, sessionId: THEIRS, worktree: "/tmp/fleet/a-doc" },
    });
  });

  it("is unowned rather than elsewhere when nobody claimed it and this session is unidentifiable", () => {
    expect(runOwnership({ events: [STARTED], sessionId: undefined })).toEqual({ kind: "unowned" });
  });

  /**
   * The confirmed incident: a released run collapsed to `unowned`, which `mayMutate` treats exactly
   * like `mine`, and an unrelated session's `handover ask` sailed straight through. A released run had a real,
   * live owner who made a deliberate handoff — not a run that never had one.
   */
  it("is released, not unowned, when the current writer explicitly let the run go and nobody claimed it since", () => {
    const released: RunEvent = {
      atIso: "2026-08-13T02:00:00.000Z",
      kind: "released",
      sessionId: THEIRS,
      why: "handing off",
    };
    const events = [STARTED, launched({ atIso: AT, sessionId: THEIRS }), released];

    expect(runOwnership({ events, sessionId: MINE })).toEqual({
      kind: "released",
      releasedAtIso: "2026-08-13T02:00:00.000Z",
      why: "handing off",
      writer: { atIso: AT, pid: 65036, sessionId: THEIRS, worktree: "/tmp/fleet/a-doc" },
    });
  });

  it("stays released regardless of who is asking, including the session that released it and an unidentifiable one", () => {
    const released: RunEvent = { atIso: AT, kind: "released", sessionId: THEIRS, why: "handing off" };
    const events = [STARTED, launched({ sessionId: THEIRS }), released];

    expect(runOwnership({ events, sessionId: THEIRS }).kind).toBe("released");
    expect(runOwnership({ events, sessionId: undefined }).kind).toBe("released");
  });

  it("returns to mine for whichever session explicitly claims a released run", () => {
    const events: readonly RunEvent[] = [
      STARTED,
      launched({ sessionId: THEIRS }),
      { atIso: AT, kind: "released", sessionId: THEIRS, why: "handing off" },
      {
        atIso: AT,
        host: "claude-code",
        kind: "claimed",
        pid: 1,
        sessionId: MINE,
        why: "taking over",
        worktree: "/wt/mine",
      },
    ];

    expect(runOwnership({ events, sessionId: MINE }).kind).toBe("mine");
  });
});
