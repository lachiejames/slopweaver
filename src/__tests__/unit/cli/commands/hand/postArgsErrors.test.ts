import { describe, expect, it } from "vitest";

import { HandPostArgsErrors, handPostArgsLines } from "../../../../../cli/commands/hand/postArgsErrors.js";

describe("handPostArgsLines", () => {
  it("prints each problem the link minter named on its own line", () => {
    const error = HandPostArgsErrors.linkUnmintable({ problems: ["first problem", "second problem"] });
    expect(handPostArgsLines({ error })).toEqual(["first problem", "second problem"]);
  });

  it("joins the minter's problems into the one message a caller displays", () => {
    const error = HandPostArgsErrors.linkUnmintable({ problems: ["first problem", "second problem"] });
    expect([error.code, error.message]).toEqual(["LINK_UNMINTABLE", "first problem; second problem"]);
  });

  it("prints any other refusal as its one message", () => {
    expect(handPostArgsLines({ error: HandPostArgsErrors.tiersBoth() })).toEqual([
      "--check-in and --blocks are the two tiers — pass exactly one, never both",
    ]);
  });

  it("names both tier flags when neither was passed", () => {
    const error = HandPostArgsErrors.tierMissing();
    expect([error.code, error.message.startsWith("say which tier this step is in: --blocks")]).toEqual([
      "TIER_MISSING",
      true,
    ]);
  });
});
