/**
 * {@link evidenceAfterClear} — the pure filter that makes `slopweaver codex quota clear` lift a refusal standing
 * on evidence it cannot delete. An UNSCOPED cap in Codex's own rollout log can be superseded by no healthy
 * reading (`quotaGate.ts` § Recovery is SCOPED), so before this filter the clear the refusal names changed
 * nothing. These cases hold its boundary and its fail-closed direction.
 */
import { describe, expect, it } from "vitest";
import { evidenceAfterClear } from "../../../codex/quotaGate.js";
import type { CodexQuotaEvidence } from "../../../codex/quotaTypes.js";

const CLEARED = "2026-09-14T09:00:00.000Z";

/** An unscoped spend cap observed at `iso`, the shape a rollout `task_complete` produces. */
const capAt = ({ iso }: { iso: string }): CodexQuotaEvidence => ({ kind: "usage-limit", observedAtIso: iso });

describe("evidenceAfterClear", () => {
  it("keeps every present candidate when no clear was ever recorded", () => {
    const cap = capAt({ iso: "2026-09-11T07:31:24.321Z" });
    expect(evidenceAfterClear({ candidates: [cap, undefined], clearedAtIso: undefined })).toEqual([cap]);
  });

  it("drops a candidate observed before the clear", () => {
    expect(
      evidenceAfterClear({ candidates: [capAt({ iso: "2026-09-11T07:31:24.321Z" })], clearedAtIso: CLEARED }),
    ).toEqual([]);
  });

  it("drops a candidate a millisecond before the clear, spelled with a different offset", () => {
    expect(
      evidenceAfterClear({ candidates: [capAt({ iso: "2026-09-14T09:59:59.999+01:00" })], clearedAtIso: CLEARED }),
    ).toEqual([]);
  });

  it("keeps a candidate at the clear's own instant, spelled with a different offset — a tie refuses", () => {
    const tie = capAt({ iso: "2026-09-14T10:00:00.000+01:00" });
    expect(evidenceAfterClear({ candidates: [tie], clearedAtIso: CLEARED })).toEqual([tie]);
  });

  it("keeps a candidate observed strictly after the clear", () => {
    const later = capAt({ iso: "2026-09-14T09:00:00.001Z" });
    expect(evidenceAfterClear({ candidates: [later], clearedAtIso: CLEARED })).toEqual([later]);
  });

  // `Date.parse` keeps whole milliseconds, so every one of these reads as the clear's own millisecond.
  it("keeps every candidate in the clear's own millisecond, whatever its sub-millisecond digits or separator", () => {
    const tenth = capAt({ iso: "2026-09-14T09:00:00.0001Z" });
    const deep = capAt({ iso: "2026-09-14T09:00:00.0000000000001Z" });
    const lower = capAt({ iso: "2026-09-14t09:00:00.0001Z" });
    const spaced = capAt({ iso: "2026-09-14 09:00:00.0001Z" });
    expect(
      evidenceAfterClear({ candidates: [tenth, deep, lower, spaced], clearedAtIso: "2026-09-14T09:00:00.0009Z" }),
    ).toEqual([tenth, deep, lower, spaced]);
  });

  it("drops a sub-millisecond candidate in a millisecond strictly before a sub-millisecond clear", () => {
    expect(
      evidenceAfterClear({
        candidates: [capAt({ iso: "2026-09-14t08:59:59.9999Z" })],
        clearedAtIso: "2026-09-14T09:00:00.0005Z",
      }),
    ).toEqual([]);
  });

  it("keeps a candidate whose instant will not parse — unreadable is not cleared", () => {
    const unreadable = capAt({ iso: "not-an-instant" });
    expect(evidenceAfterClear({ candidates: [unreadable], clearedAtIso: CLEARED })).toEqual([unreadable]);
  });

  it("clears nothing on a clear instant that will not parse", () => {
    const cap = capAt({ iso: "2026-09-11T07:31:24.321Z" });
    expect(evidenceAfterClear({ candidates: [cap], clearedAtIso: "garbage" })).toEqual([cap]);
  });

  it("drops a SCOPED cap before the clear too, and keeps the later of two in order", () => {
    const scopedOld: CodexQuotaEvidence = {
      kind: "window-limit",
      limitId: "codex",
      observedAtIso: "2026-09-12T09:00:00.000Z",
      resetAtIso: "2026-09-17T09:00:00.000Z",
    };
    const later = capAt({ iso: "2026-09-14T09:30:00.000Z" });
    expect(evidenceAfterClear({ candidates: [scopedOld, later], clearedAtIso: CLEARED })).toEqual([later]);
  });
});
