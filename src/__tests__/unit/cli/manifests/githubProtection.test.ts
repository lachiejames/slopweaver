/**
 * The `github` noun's branch-protection rows in `cli/manifests/githubProtection.ts` quote their usage from a leaf
 * module rather than from the command module they describe, so enumerating the surface never loads a command; this
 * pins that every row still carries the very constant the command prints on a usage error, and that the rows reach
 * the noun's manifest.
 */
import { describe, expect, it } from "vitest";

import {
  GITHUB_PUSH_RESTRICTION_USAGE,
  GITHUB_REQUIRED_CONTEXTS_USAGE,
} from "../../../../cli/commands/github/prUsage.js";
import { githubManifest } from "../../../../cli/manifests/github.js";
import { githubProtectionManifest } from "../../../../cli/manifests/githubProtection.js";

describe("githubProtectionManifest", () => {
  it("quotes each verb's usage from its leaf — the constant the command itself prints, so the two cannot drift", () => {
    expect(githubProtectionManifest["push-restriction"]!.meta.usage).toBe(GITHUB_PUSH_RESTRICTION_USAGE);
    expect(githubProtectionManifest["required-contexts"]!.meta.usage).toBe(GITHUB_REQUIRED_CONTEXTS_USAGE);
  });

  it("is spread into the github noun's manifest", () => {
    expect(githubManifest["push-restriction"]).toBe(githubProtectionManifest["push-restriction"]);
    expect(githubManifest["required-contexts"]).toBe(githubProtectionManifest["required-contexts"]);
  });
});
