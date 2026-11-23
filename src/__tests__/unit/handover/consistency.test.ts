import { describe, expect, it } from "vitest";

import type { RunDisposition } from "../../../handover/boardTypes.js";
import { consistencyOf } from "../../../handover/consistency.js";
import type { DocStatus } from "../../../handover/doc.js";

const NEVER: RunDisposition = { kind: "never-started" };
const ACTIVE: RunDisposition = { kind: "active" };
const WAITING: RunDisposition = {
  action: undefined,
  actionUnreadable: false,
  askedIso: "2026-09-04T07:00:00.000Z",
  kind: "waiting-on-owner",
  question: "which repo?",
  shape: undefined,
  shapeIso: undefined,
};
const FINISHED: RunDisposition = { atIso: "2026-09-04T07:30:00.000Z", kind: "finished", residue: [] };
const ABANDONED: RunDisposition = { kind: "abandoned", why: "superseded" };
const UNREADABLE: RunDisposition = { kind: "unreadable", reason: "truncated line 3" };

describe("consistencyOf", () => {
  it.each<[DocStatus, RunDisposition, "consistent" | "transition" | "contradiction"]>([
    ["draft", NEVER, "consistent"],
    ["draft", ACTIVE, "contradiction"],
    ["draft", WAITING, "contradiction"],
    ["draft", FINISHED, "consistent"],
    ["draft", ABANDONED, "consistent"],
    ["ready", NEVER, "consistent"],
    ["ready", ACTIVE, "transition"],
    ["ready", WAITING, "transition"],
    ["ready", FINISHED, "transition"],
    ["ready", ABANDONED, "consistent"],
    ["in-progress", NEVER, "transition"],
    ["in-progress", ACTIVE, "consistent"],
    ["in-progress", WAITING, "consistent"],
    ["in-progress", FINISHED, "transition"],
    ["in-progress", ABANDONED, "transition"],
    ["paused", NEVER, "consistent"],
    ["paused", ACTIVE, "transition"],
    ["paused", WAITING, "transition"],
    ["paused", FINISHED, "transition"],
    ["paused", ABANDONED, "consistent"],
    ["done", NEVER, "consistent"],
    ["done", ACTIVE, "contradiction"],
    ["done", WAITING, "contradiction"],
    ["done", FINISHED, "consistent"],
    ["done", ABANDONED, "contradiction"],
    ["cancelled", NEVER, "consistent"],
    ["cancelled", ACTIVE, "contradiction"],
    ["cancelled", WAITING, "contradiction"],
    ["cancelled", FINISHED, "contradiction"],
    ["cancelled", ABANDONED, "consistent"],
    ["rejected", NEVER, "consistent"],
    ["rejected", ACTIVE, "contradiction"],
    ["rejected", WAITING, "contradiction"],
    ["rejected", FINISHED, "contradiction"],
    ["rejected", ABANDONED, "consistent"],
    ["unknown", NEVER, "contradiction"],
    ["unknown", ACTIVE, "contradiction"],
    ["unknown", WAITING, "contradiction"],
    ["unknown", FINISHED, "contradiction"],
    ["unknown", ABANDONED, "contradiction"],
  ])("status=%s run=%o -> %s", (status, run, kind) => {
    expect(consistencyOf({ run, status }).kind).toBe(kind);
  });

  it("treats an unreadable journal as a contradiction regardless of status", () => {
    expect(consistencyOf({ run: UNREADABLE, status: "ready" }).kind).toBe("contradiction");
    expect(consistencyOf({ run: UNREADABLE, status: "done" }).kind).toBe("contradiction");
  });

  it("carries a non-empty reason on every verdict", () => {
    const verdict = consistencyOf({ run: ACTIVE, status: "done" });
    expect(verdict.reason.length).toBeGreaterThan(0);
  });
});

/**
 * The whole point of the row, stated as its own test rather than left implicit in the table above.
 *
 * MEASURED: `in-progress` plus a `blockedBy:` sentence naming a person was the only spelling the
 * board had for "waiting on somebody", and this grader called that pair a TRANSITION — "work done outside a
 * run". A workstream deliberately parked is neither of those things, and every reader of consistency was
 * being told it was both.
 */
describe("a workstream parked on a person", () => {
  it("is consistent when paused, where the old spelling was a transition", () => {
    expect(consistencyOf({ run: NEVER, status: "paused" }).kind).toBe("consistent");
    expect(consistencyOf({ run: NEVER, status: "in-progress" }).kind).toBe("transition");
  });

  it("says WHY it is consistent, in words that name the person rather than the journal", () => {
    expect(consistencyOf({ run: NEVER, status: "paused" }).reason).toBe(
      "declared paused, waiting on a person, with no live run in the way",
    );
  });
});
