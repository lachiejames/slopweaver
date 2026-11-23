/*
 * A hand step's headline leads with the discussion, never a pull request.
 */
import { describe, expect, it } from "vitest";

import { postingRefusal } from "../../../hand/posting.js";
import { prLedHeadline } from "../../../hand/prLedHeadline.js";
import { buildHandStep, type HandStep, type HandStepDraft } from "../../../hand/step.js";
import { unwrap } from "../../../lib/result.js";

/** A step built by the real builder, with whatever a case overrides. */
function step(over: Partial<HandStepDraft> = {}): HandStep {
  return unwrap(
    buildHandStep({
      draft: {
        id: "pr-led-headline",
        postedBy: "workspace:1",
        postedIso: "2026-10-16T06:00:00.000Z",
        unaddressed: "said on the call",
        unblocks: "board row pr-led-headline",
        what: "Approve the fix PR for the gateway outage, so events recover",
        witness: "slopweaver hand done pr-led-headline --did read",
        ...over,
      },
    }),
  );
}

describe("prLedHeadline", () => {
  it("refuses a headline asking the owner to approve a fix PR", () => {
    const refused = prLedHeadline({ step: step() })!;
    expect([refused.code, refused.message]).toEqual([
      "INVALID_FIELD",
      expect.stringContaining('leads with a pull request ("Approve the fix") instead of the discussion'),
    ]);
  });

  it("passes the same card led by the evidence", () => {
    const what =
      "Read what the gateway errors look like on the test dashboard, so you can decide whether to raise it with the team";
    expect(prLedHeadline({ step: step({ what }) })).toBe(undefined);
  });

  it("is asked by the posting form, before the purpose rule", () => {
    // A published page as its address, so the approval-page rule (`proofLink.ts`) is satisfied and this one is asked.
    const url = "http://localhost:3000/view?src=%2Fapi%2Fpage%2Fgateway-receipts%2Findex.html&back=%2Fqueue";
    const refused = postingRefusal({
      step: unwrap(
        buildHandStep({
          draft: {
            id: "pr-led-headline",
            postedBy: "workspace:1",
            postedIso: "2026-10-16T06:00:00.000Z",
            unblocks: "board row pr-led-headline",
            url,
            what: "Approve the fix PR for the gateway outage",
            witness: "slopweaver hand done pr-led-headline --did read",
          },
        }),
      ),
    });
    expect(refused!.message).toContain('leads with a pull request ("Approve the fix")');
  });
});
