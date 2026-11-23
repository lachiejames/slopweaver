/**
 * The `github` noun's reviewer rows in `cli/manifests/githubReviewers.ts` quote their usage from leaf modules, so
 * enumerating the surface never loads a command. This pins that each row carries the very text the command prints,
 * that `reviewer` stays `local-state`: it reads the last landing reading and the register, and sends nothing — and
 * that `review-draft`, which does send, declares it and goes through the door.
 */
import { describe, expect, it } from "vitest";

import { githubReviewStateUsage } from "../../../../cli/commands/github/reportUsage.js";
import { githubReviewDraftUsage } from "../../../../cli/commands/github/reviewDraftUsage.js";
import { githubReviewerUsage } from "../../../../cli/commands/github/reviewerUsage.js";
import { githubReviewersManifest } from "../../../../cli/manifests/githubReviewers.js";

describe("githubReviewersManifest", () => {
  it("quotes each verb's usage from its leaf, so the manifest and the command cannot drift", () => {
    expect(githubReviewersManifest["reviewer"]!.meta.usage).toBe(githubReviewerUsage());
    expect(githubReviewersManifest["review-state"]!.meta.usage).toBe(githubReviewStateUsage());
    expect(githubReviewersManifest["review-draft"]!.meta.usage).toBe(githubReviewDraftUsage());
  });

  it("declares review-draft an external write routed through the door", () => {
    expect([
      githubReviewersManifest["review-draft"]!.meta.effect,
      githubReviewersManifest["review-draft"]!.meta.doorRouted,
    ]).toEqual(["external-write", true]);
  });

  it("declares reviewer a local-state verb outside the door, and review-state an external read", () => {
    expect([
      githubReviewersManifest["reviewer"]!.meta.effect,
      githubReviewersManifest["reviewer"]!.meta.doorRouted,
      githubReviewersManifest["review-state"]!.meta.effect,
    ]).toEqual(["local-state", false, "external-read"]);
  });
});
