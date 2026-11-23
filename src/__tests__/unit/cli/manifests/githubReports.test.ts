/**
 * The `github` noun's manifest rows in `cli/manifests/githubReports.ts` quote their usage from a leaf module rather
 * than from the command module they describe, so enumerating the surface never loads a command. That the manifest
 * imports nothing heavier is `../manifestBarrelClosure.test.ts`'s job; this pins that every row still carries the very
 * constant the command prints on a usage error.
 */
import { describe, expect, it } from "vitest";

import { githubBottleneckUsage } from "../../../../cli/commands/github/bottleneckUsage.js";
import { githubCoderabbitYieldUsage } from "../../../../cli/commands/github/coderabbitYieldUsage.js";
import { githubReportsManifest } from "../../../../cli/manifests/githubReports.js";

describe("githubReportsManifest", () => {
  it("quotes each verb's usage from its leaf — the constant the command itself prints, so the two cannot drift", () => {
    expect(githubReportsManifest["bottleneck"]!.meta.usage).toBe(githubBottleneckUsage());
    expect(githubReportsManifest["coderabbit-yield"]!.meta.usage).toBe(githubCoderabbitYieldUsage());
  });
});
