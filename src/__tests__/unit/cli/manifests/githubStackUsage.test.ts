/**
 * `githubStackUsage.ts` is a usage leaf, not a manifest: it holds `github stack`'s help out of `github.ts`. This pins
 * that the `stack` row quotes that very constant, and that the block opens with the invocation it documents. That the
 * manifest imports nothing heavier is `../manifestBarrelClosure.test.ts`'s job.
 */
import { describe, expect, it } from "vitest";

import { githubManifest } from "../../../../cli/manifests/github.js";
import { STACK_USAGE } from "../../../../cli/manifests/githubStackUsage.js";

describe("githubStackUsage", () => {
  it("is the usage the `github stack` row carries, so the leaf and its consumer cannot drift", () => {
    expect(githubManifest["stack"]!.meta.usage).toBe(STACK_USAGE);
  });

  it("opens with the invocation it documents, naming every stack sub-verb", () => {
    expect(STACK_USAGE.split("\n")[0]!.startsWith("usage: slopweaver github stack <")).toBe(true);
    expect(STACK_USAGE.split("\n")[0]!).toContain("<push|sync|restack|submit|adopt|audit|remove|dissolve>");
  });
});
