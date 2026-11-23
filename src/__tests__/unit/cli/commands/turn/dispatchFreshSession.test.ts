import { describe, expect, it } from "vitest";

import { neverCalled } from "../../../../../cli/commands/turn/dispatchFreshSession.js";

describe("neverCalled", () => {
  it("rejects naming the subagent field it stands in for", async () => {
    await expect(neverCalled({ what: "subagent" })()).rejects.toThrow(
      new Error("subagent should never be called from this dispatch path"),
    );
  });

  it("rejects naming whichever field it was given, so the diagnostic is not one fixed sentence", async () => {
    await expect(neverCalled({ what: "launchVisibleSession" })()).rejects.toThrow(
      new Error("launchVisibleSession should never be called from this dispatch path"),
    );
  });
});
