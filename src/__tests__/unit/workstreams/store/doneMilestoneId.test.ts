import { describe, expect, it } from "vitest";

import { DONE_MILESTONE_ID } from "../../../../workstreams/store/doneMilestoneId.js";

describe("DONE_MILESTONE_ID", () => {
  it("is the one stable id every definition of done carries, whatever it is renamed to", () => {
    expect(DONE_MILESTONE_ID).toBe("done");
  });
});
