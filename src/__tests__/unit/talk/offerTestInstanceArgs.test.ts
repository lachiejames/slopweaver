/*
 * `talk offer --test-instance e2e`: the console's `e2e-voice` mint marks the desktop test's call, so the verb judges a
 * reopen against the test instance's own calls alone (`src/talk/e2eReopenProbe.ts`). Absent, the call is the owner's.
 */
import { describe, expect, it } from "vitest";

import { parseOfferArgs } from "../../../cli/commands/talk/args.js";
import { TalkOfferArgsErrors } from "../../../cli/commands/talk/offerArgsErrors.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";

describe("parseOfferArgs --test-instance", () => {
  it("marks a call the desktop test instance placed, and refuses any other instance", () => {
    expect(unwrap(parseOfferArgs({ rest: ["--test-instance", "e2e"] })).testInstance).toBe("e2e");
    expect(unwrap(parseOfferArgs({ rest: [] })).testInstance).toBe(undefined);
    expect(unwrapErr(parseOfferArgs({ rest: ["--test-instance", "staging"] }))).toEqual(
      TalkOfferArgsErrors.testInstanceUnknown({ value: "staging" }),
    );
  });
});
