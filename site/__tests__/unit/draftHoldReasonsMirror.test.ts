/*
 * The draft register and the console agree on why a held draft is not sent.
 *
 * `site/components/live/draftJudgement.ts` restates `src/outbound/slack/draftRegister.ts`'s `DRAFT_HOLD_REASONS`
 * because `site/` never imports `src/`; this file, in the lane that reaches both roots, binds the copy. A reason added
 * to the register alone would make the console refuse the whole draft register the first time a session recorded it.
 */

import { describe, expect, it } from "vitest";

import {
  NOT_OWNER_YES_REASON as REGISTER_REASON,
  DRAFT_HOLD_REASONS as REGISTER_REASONS,
} from "../../../src/outbound/slack/draftHoldReasons";
import {
  NOT_OWNER_YES_REASON as CONSOLE_REASON,
  DRAFT_HOLD_REASONS as CONSOLE_REASONS,
  draftJudgementOf,
} from "../../components/live/draftJudgement";

describe("the register's and the console's hold reasons agree", () => {
  it("on every reason, in order, and on the first reason", () => {
    expect(REGISTER_REASONS.length).toBeGreaterThan(0);
    expect([...CONSOLE_REASONS]).toEqual([...REGISTER_REASONS]);
    expect(CONSOLE_REASON).toBe(REGISTER_REASON);
  });
});

describe("draftJudgementOf under the owner-neutral hold reason", () => {
  it("reads a hold carrying it", () => {
    const item: Record<string, unknown> = {
      hold: { atIso: "2026-10-08T02:00:00.000Z", reason: CONSOLE_REASON, why: "a person has not said yes" },
    };
    expect(draftJudgementOf({ draft: {}, item })).toEqual({
      approval: undefined,
      hold: {
        atIso: "2026-10-08T02:00:00.000Z",
        reason: CONSOLE_REASON,
        why: "a person has not said yes",
      },
      judgedIso: undefined,
      meaningChanged: undefined,
    });
  });
});
