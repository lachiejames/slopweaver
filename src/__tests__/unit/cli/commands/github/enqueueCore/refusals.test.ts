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

  it("refuses a base branch with no merge queue, and names the whole command that lands it instead", () => {
    const refusals = enqueueRefusals({
      target: ORDINARY,
      requiredContexts: ["build"],
      pr: pr(),
      queue: undefined,
      repo: "acme/widget",
    });
    expect(refusals).toEqual([
      "acme/widget has no merge queue on main, so there is no 'Merge when ready' to press. Land it with " +
        "`slopweaver github merge --repo acme/widget --base origin/main --head feature --description - --admin " +
        "--number 9 < body.md` instead, or enable a merge queue on that branch.",
    ]);
  });
});
