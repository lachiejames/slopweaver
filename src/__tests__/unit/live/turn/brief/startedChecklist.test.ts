/**
 * `reconcileStartedChecklist` — the brief's `started` pair reconciled between an explicit flag and the
 * recorded ref: either alone is used, agreement is used, and any disagreement is refused by name.
 */
import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../../../lib/result.js";
import { reconcileStartedChecklist } from "../../../../../live/turn/startedReconcile.js";

describe("reconcileStartedChecklist", () => {
  it("is undefined when neither source has one", () => {
    expect(unwrap(reconcileStartedChecklist({ explicit: undefined, recorded: undefined }))).toBe(undefined);
  });

  it("uses the recorded ref alone when no explicit pair was passed", () => {
    const recorded = { turnId: "turn-1", workingTs: "1.1" };
    expect(unwrap(reconcileStartedChecklist({ explicit: undefined, recorded }))).toEqual(recorded);
  });

  it("uses the explicit pair alone when no recorded ref exists", () => {
    const explicit = { turnId: "turn-1", workingTs: "1.1" };
    expect(unwrap(reconcileStartedChecklist({ explicit, recorded: undefined }))).toEqual(explicit);
  });

  it("uses the shared value when both sources agree exactly", () => {
    const both = { turnId: "turn-1", workingTs: "1.1" };
    expect(unwrap(reconcileStartedChecklist({ explicit: { ...both }, recorded: { ...both } }))).toEqual(both);
  });

  it("REFUSES when the turnId disagrees, rather than trusting either source silently", () => {
    const result = reconcileStartedChecklist({
      explicit: { turnId: "turn-explicit", workingTs: "1.1" },
      recorded: { turnId: "turn-recorded", workingTs: "1.1" },
    });
    expect(result.isErr()).toBe(true);
    const error = unwrapErr(result);
    expect(error.code).toBe("STARTED_CHECKLIST_MISMATCH");
    expect(error.message).toContain("turn-explicit");
    expect(error.message).toContain("turn-recorded");
  });

  it("REFUSES when the workingTs disagrees, rather than trusting either source silently", () => {
    const result = reconcileStartedChecklist({
      explicit: { turnId: "turn-1", workingTs: "1.1" },
      recorded: { turnId: "turn-1", workingTs: "2.2" },
    });
    const error = unwrapErr(result);
    expect(error.code).toBe("STARTED_CHECKLIST_MISMATCH");
    expect(error.message).toContain("1.1");
    expect(error.message).toContain("2.2");
  });
});
