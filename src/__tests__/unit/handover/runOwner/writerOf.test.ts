/*
 * `writerOf` — which session a run's journal names as its writer: the last claim in the current cycle, a release
 * clearing it, and the worktree and pid carried across a resume. It moved here when `runOwner.test.ts` was split by
 * behaviour.
 */
import { describe, expect, it } from "vitest";

import type { RunEvent } from "../../../../handover/ledger.js";
import { writerOf } from "../../../../handover/runOwner.js";
import { AT, launched, MINE, STARTED, THEIRS } from "./harness.js";

describe("writerOf", () => {
  it("reads the writer from the launched entry the fleet driver wrote", () => {
    const writer = writerOf({ events: [STARTED, launched({ sessionId: THEIRS })] })!;

    expect(writer.sessionId).toBe(THEIRS);
    expect(writer.worktree).toBe("/tmp/fleet/a-doc");
    expect(writer.pid).toBe(65036);
  });

  it("is undefined for a run whose journal names nobody — every run predating identity", () => {
    expect(writerOf({ events: [STARTED] })).toBeUndefined();
  });

  it("is undefined when nothing ever started, so an orphan entry cannot name an owner", () => {
    expect(writerOf({ events: [launched({ sessionId: THEIRS })] })).toBeUndefined();
  });

  /**
   * A driver that re-launches a run onto a fresh session writes a new entry. Reading the FIRST would name a dead
   * session as the owner and hand the gate a stranger for every live one.
   */
  it("takes the LAST claim, so a re-launch onto a new session transfers ownership", () => {
    const events = [STARTED, launched({ sessionId: THEIRS }), launched({ atIso: AT, sessionId: MINE })];

    expect(writerOf({ events })!.sessionId).toBe(MINE);
  });

  it("transfers to a typed cross-host claim and records its host", () => {
    const events: readonly RunEvent[] = [
      STARTED,
      launched({ sessionId: THEIRS }),
      {
        atIso: AT,
        host: "codex",
        kind: "claimed",
        pid: 77,
        sessionId: MINE,
        why: "moving into Codex",
        worktree: "/wt/codex",
      },
    ];

    expect(writerOf({ events })).toEqual({
      atIso: AT,
      host: "codex",
      pid: 77,
      sessionId: MINE,
      worktree: "/wt/codex",
    });
  });

  it("clears ownership only when the current writer releases its own claim", () => {
    const released: RunEvent = { atIso: AT, kind: "released", sessionId: THEIRS, why: "moving hosts" };

    expect(writerOf({ events: [STARTED, launched({ sessionId: THEIRS }), released] })).toBeUndefined();
    expect(
      writerOf({
        events: [STARTED, launched({ sessionId: MINE }), released],
      })!.sessionId,
    ).toBe(MINE);
  });

  it("carries the worktree forward across a resumed entry for the same session", () => {
    const events: readonly RunEvent[] = [
      STARTED,
      launched({ sessionId: THEIRS }),
      { atIso: AT, attempt: 3, kind: "resumed", pid: undefined, sessionId: THEIRS },
    ];
    const writer = writerOf({ events })!;

    expect(writer.sessionId).toBe(THEIRS);
    expect(writer.worktree).toBe("/tmp/fleet/a-doc");
  });

  /** A different session means a different checkout, and reporting the old one would point a reader wrong. */
  it("drops the worktree when a resumed entry names a DIFFERENT session", () => {
    const events: readonly RunEvent[] = [
      STARTED,
      launched({ sessionId: THEIRS }),
      { atIso: AT, attempt: 2, kind: "resumed", pid: undefined, sessionId: MINE },
    ];
    const writer = writerOf({ events })!;

    expect(writer.sessionId).toBe(MINE);
    expect(writer.worktree).toBeUndefined();
    expect(writer.pid).toBeUndefined();
  });

  /** Only the current cycle counts: a previous run's driver is not this one's. */
  it("ignores a writer from a cycle that has already ended", () => {
    const events: readonly RunEvent[] = [
      STARTED,
      launched({ sessionId: THEIRS }),
      { atIso: AT, kind: "finished", residue: [] },
      STARTED,
    ];

    expect(writerOf({ events })).toBeUndefined();
  });
});
