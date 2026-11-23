/**
 * The `github` noun's manifest rows in `cli/manifests/githubRefs.ts` quote their usage from a leaf module rather than
 * from the command module they describe, so enumerating the surface never loads a command. That the manifest imports
 * nothing heavier is `../manifestBarrelClosure.test.ts`'s job; this pins that every row still carries the very constant
 * the command prints on a usage error.
 */
import { describe, expect, it } from "vitest";

import { GITHUB_BRANCH_USAGE, GITHUB_TAG_USAGE } from "../../../../cli/commands/github/refsUsage.js";
import { githubRefsManifest } from "../../../../cli/manifests/githubRefs.js";

describe("githubRefsManifest", () => {
  it("quotes each verb's usage from its leaf — the constant the command itself prints, so the two cannot drift", () => {
    expect(githubRefsManifest["branch"]!.meta.usage).toBe(GITHUB_BRANCH_USAGE);
    expect(githubRefsManifest["tag"]!.meta.usage).toBe(GITHUB_TAG_USAGE);
  });
});
