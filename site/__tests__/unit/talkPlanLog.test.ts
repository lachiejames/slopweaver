/*
 * The console server's line for each plan call opened and ended (`site/lib/talkPlanLog.ts`), so a call that ended
 * after the voice window crashed says on the server side when, why and how long it lived.
 */
import { describe, expect, it } from "vitest";

import { planCallLogLine } from "../../lib/talkPlanLog";

const ID = "6f1c2d3e-4a5b-4c6d-8e7f-901234567890";

describe("planCallLogLine", () => {
  it("names an opened call and its handshake's outcome", () => {
    expect(
      planCallLogLine({ atIso: "2026-10-25T12:41:10.000Z", event: { kind: "opened", outcome: "open" }, id: ID }),
    ).toBe(`2026-10-25T12:41:10.000Z talk plan call ${ID} opened: open`);
  });

  it("names an ended call's reason and its lifetime in whole seconds", () => {
    const event = { kind: "ended", livedMs: 133_499, reason: "the voice window's renderer crashed" } as const;
    expect(planCallLogLine({ atIso: "2026-10-25T12:43:23.000Z", event, id: ID })).toBe(
      `2026-10-25T12:43:23.000Z talk plan call ${ID} ended after 133s: the voice window's renderer crashed`,
    );
  });
});
