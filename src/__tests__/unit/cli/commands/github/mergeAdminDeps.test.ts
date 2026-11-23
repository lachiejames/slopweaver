/**
 * `github merge --admin`'s composition root: the edges it hands the merge are the production ones, built
 * without touching the network, the clock or the state home.
 */
import { describe, expect, it } from "vitest";

import { productionGithubAdminMergeDeps } from "../../../../../cli/commands/github/mergeAdminDeps.js";
import { productionProbePostMergeDocsBudget } from "../../../../../cli/commands/github/mergeAdminProbe.js";

describe("productionGithubAdminMergeDeps", () => {
  it("wires the post-merge docs-budget probe to the production probe itself", () => {
    expect(productionGithubAdminMergeDeps().probePostMergeDocsBudget).toBe(productionProbePostMergeDocsBudget);
  });
});
