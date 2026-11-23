/*
 * A hand step's headline says what a thing is before it names its code (from the
 * Vanta evidence card).
 */
import { describe, expect, it } from "vitest";

import { headlineCode } from "../../../hand/headlineCode.js";
import { postingRefusal } from "../../../hand/posting.js";
import { buildHandStep, type HandStep, type HandStepDraft } from "../../../hand/step.js";
import { unwrap } from "../../../lib/result.js";

/** A Vanta drafts headline in the shape that was posted: codes first, meaning nowhere. */
const VANTA_DRAFTS =
  "Read the CTRL-101, CTRL-102 and CTRL-103 evidence drafts in acme/acme-admin#101, screenshots inline in Files.";

/** A step built by the real builder, with whatever a case overrides. */
function step(over: Partial<HandStepDraft> = {}): HandStep {
  return unwrap(
    buildHandStep({
      draft: {
        id: "headline-code",
        postedBy: "workspace:1",
        postedIso: "2026-10-05T12:00:00.000Z",
        unaddressed: "said on the call",
        unblocks: "board row headline-code",
        what: VANTA_DRAFTS,
        witness: "slopweaver hand done headline-code --did read",
        ...over,
      },
    }),
  );
}

describe("headlineCode", () => {
  it("refuses the Vanta drafts headline, naming each control code", () => {
    const refused = headlineCode({ step: step() })!;
    expect([refused.code, refused.message]).toEqual([
      "INVALID_FIELD",
      expect.stringContaining('it names "CTRL-101" (a team key), "CTRL-102" (a team key), "CTRL-103" (a team key)'),
    ]);
  });

  it("passes the same headline with the meaning first and the codes behind it", () => {
    const what =
      "Read the backup-restore and change-log evidence drafts, so the audit gets them (CTRL-101, CTRL-102, CTRL-103)";
    expect(headlineCode({ step: step({ what }) })).toBe(undefined);
  });

  it("reads a notice too, since the incident page is read first", () => {
    const refused = headlineCode({
      step: step({ notice: true, what: "INC-7 Major · Billing export delay — a new incident" }),
    });
    expect(refused!.code).toBe("INVALID_FIELD");
  });

  it("is asked by the posting form, before the purpose rule", () => {
    expect(
      postingRefusal({ step: step({ cites: ["https://github.com/acme/acme-admin/pull/101"] }) })!.message,
    ).toContain('it names "CTRL-101"');
  });
});
