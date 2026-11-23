/**
 * The hold reasons live in a leaf the console's mirror test can import, and the register re-exports that very list
 * rather than a second copy of it. A stored hold reads back only under a reason in that set.
 */
import { describe, expect, it } from "vitest";

import { DRAFT_HOLD_REASONS, NOT_OWNER_YES_REASON } from "../../../../outbound/slack/draftHoldReasons.js";
import { parseSlackDraftLog } from "../../../../outbound/slack/draftLog.js";
import { DRAFT_HOLD_REASONS as REGISTER_REASONS } from "../../../../outbound/slack/draftRegister.js";

describe("DRAFT_HOLD_REASONS", () => {
  it("is the closed set, in the order the Queue card and the verbs name it", () => {
    expect([...DRAFT_HOLD_REASONS]).toEqual([
      "not-owner-yes",
      "meaning-changed",
      "thread-moved",
      "no-fleet-slot",
      "slack-refused",
    ]);
  });

  it("is the same list the register exports", () => {
    expect(REGISTER_REASONS).toBe(DRAFT_HOLD_REASONS);
  });
});

describe("a stored hold", () => {
  const held = {
    id: "sd-11111111",
    kind: "held",
    reason: NOT_OWNER_YES_REASON,
    schemaVersion: 1,
    tsIso: "2026-10-08T02:00:00.000Z",
    why: "the words on its card were not a yes",
  };

  it("is skipped when its reason is outside the closed set", () => {
    const { events, skipped } = parseSlackDraftLog({ lines: [JSON.stringify({ ...held, reason: "not-a-reason" })] });
    expect(events).toEqual([]);
    expect(skipped.map((line) => line.line)).toEqual([1]);
  });

  it("reads back under the owner-yes reason as written", () => {
    expect(NOT_OWNER_YES_REASON).toBe("not-owner-yes");
    const { events, skipped } = parseSlackDraftLog({ lines: [JSON.stringify(held)] });
    expect(skipped).toEqual([]);
    expect(events).toEqual([
      {
        id: "sd-11111111",
        kind: "held",
        reason: "not-owner-yes",
        tsIso: "2026-10-08T02:00:00.000Z",
        why: "the words on its card were not a yes",
      },
    ]);
  });
});
