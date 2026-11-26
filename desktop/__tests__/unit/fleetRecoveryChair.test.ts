/**
 * The supervisor's half of a Recovery result as the app reads and draws it: read strictly, the chair's line first,
 * then why each plan or vendor that fell back did.
 */
import { describe, expect, it } from "vitest";

import { parseRecoveryChair, recoveryChairLines } from "../../src/fleetRecoveryChair";

const CHAIR = {
  outcome: "restarted",
  reason: "the supervisor restarted on Codex plan codex-1",
  restarts: [
    { alias: "claude-1", outcome: "spawn-refused", reason: "the spawn refused claude-1", vendor: "claude" },
    {
      alias: "codex-1",
      outcome: "restarted",
      reason: "it took the supervisor pin",
      sessionId: "chair-2",
      slug: "fresh-supervisor-handoff-9042",
      vendor: "codex",
    },
  ],
};

describe("parseRecoveryChair", () => {
  it("reads the chair the verb prints", () => {
    expect(parseRecoveryChair({ value: CHAIR })).toEqual(CHAIR);
  });

  it("reads a chair that took the pin and then ended as lost", () => {
    const lost = {
      outcome: "not-restarted",
      reason:
        "no supervisor is pinned; the last chair tried, on Claude plan claude-1, the new chair took the pin, then was failed",
      restarts: [
        { alias: "claude-1", outcome: "lost", reason: "the new chair took the pin, then was failed", vendor: "claude" },
      ],
    };
    expect(parseRecoveryChair({ value: lost })).toEqual(lost);
  });

  it("refuses a chair or any restart that is malformed", () => {
    const restart = CHAIR.restarts[1]!;
    const malformed: readonly unknown[] = [
      undefined,
      { ...CHAIR, outcome: "fine" },
      { ...CHAIR, reason: 3 },
      { ...CHAIR, restarts: "none" },
      { ...CHAIR, restarts: [{ ...restart, vendor: "other" }] },
      { ...CHAIR, restarts: [{ ...restart, outcome: "maybe" }] },
      { ...CHAIR, restarts: [{ ...restart, slug: 7 }] },
      { ...CHAIR, restarts: [{ ...restart, alias: undefined }] },
    ];
    expect(malformed.map((value) => parseRecoveryChair({ value }))).toEqual(malformed.map(() => undefined));
  });
});

describe("recoveryChairLines", () => {
  it("opens on the chair's outcome, then says why each plan before the last fell back", () => {
    expect(recoveryChairLines({ chair: parseRecoveryChair({ value: CHAIR })! })).toEqual([
      "Supervisor: restarted. The supervisor restarted on Codex plan codex-1",
      "Tried Claude plan claude-1 first: the spawn refused claude-1",
    ]);
  });

  it("draws a running supervisor as one line", () => {
    const chair = {
      outcome: "live",
      reason: "the supervisor is running on app:c, so nothing was restarted",
      restarts: [],
    };
    expect(recoveryChairLines({ chair: parseRecoveryChair({ value: chair })! })).toEqual([
      "Supervisor: running. The supervisor is running on app:c, so nothing was restarted",
    ]);
  });
});
