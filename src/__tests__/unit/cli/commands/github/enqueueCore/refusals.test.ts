/* The enqueue door's hard refusals: a pull request that is not open, a draft, and a base with no queue. */
import { describe, expect, it } from "vitest";

import { enqueueRefusals } from "../../../../../../cli/commands/github/enqueueFindings.js";
import { ORDINARY, pr, QUEUE } from "./fixtures.js";

describe("enqueueRefusals", () => {
  it("finds nothing wrong with an open, undrafted pull request on a queued branch", () => {
    expect(
      enqueueRefusals({ target: ORDINARY, requiredContexts: ["build"], pr: pr(), queue: QUEUE, repo: "acme/widget" }),
    ).toEqual([]);
  });

  it("refuses a pull request that is not open", () => {
    const refusals = enqueueRefusals({
      target: ORDINARY,
      requiredContexts: ["build"],
      pr: pr({ state: "MERGED" }),
      queue: QUEUE,
      repo: "acme/widget",
    });
    expect(refusals.length).toBe(1);
    expect(refusals[0]).toContain("is MERGED, not open");
  });

  it("refuses a draft, and names the verb that undrafts it", () => {
    const refusals = enqueueRefusals({
      target: ORDINARY,
      requiredContexts: ["build"],
      pr: pr({ isDraft: true }),
      queue: QUEUE,
      repo: "acme/widget",
    });
    expect(refusals.length).toBe(1);
    expect(refusals[0]).toContain("slopweaver github ready");
  });

  it("refuses a base branch with no merge queue, and names the verb that lands it instead", () => {
    const refusals = enqueueRefusals({
      target: ORDINARY,
      requiredContexts: ["build"],
      pr: pr(),
      queue: undefined,
      repo: "acme/widget",
    });
    expect(refusals.length).toBe(1);
    expect(refusals[0]).toContain("has no merge queue on main");
    expect(refusals[0]).toContain("slopweaver github merge --admin");
  });
});
