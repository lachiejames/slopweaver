/**
 * The `github` noun's manifest rows, read through `githubManifest`, quote their usage from a leaf module rather
 * than from the command module they describe, so enumerating the surface never loads a command. That the manifest
 * imports nothing heavier is `../manifestBarrelClosure.test.ts`'s job; this pins that every row still carries the
 * very constant the command prints on a usage error.
 */
import { describe, expect, it } from "vitest";

import { githubBumpDriveUsage } from "../../../../cli/commands/github/bumpDriveUsage.js";
import { GITHUB_HOLD_USAGE, GITHUB_RELEASE_USAGE } from "../../../../cli/commands/github/holdUsage.js";
import { githubLandingUsage } from "../../../../cli/commands/github/landingUsage.js";
import {
  GITHUB_ACTIONS_USAGE,
  GITHUB_ATTACH_USAGE,
  GITHUB_CLOSE_USAGE,
  GITHUB_COMMENT_USAGE,
  GITHUB_ENQUEUE_USAGE,
  GITHUB_LABEL_USAGE,
  GITHUB_PUSH_RESTRICTION_USAGE,
  GITHUB_READY_USAGE,
  GITHUB_REQUIRED_CONTEXTS_USAGE,
  GITHUB_SELF_REVIEW_RELEASE_USAGE,
  GITHUB_THREAD_USAGE,
  GITHUB_VULN_USAGE,
} from "../../../../cli/commands/github/prUsage.js";
import {
  githubReviewStateUsage,
  githubSearchUsage,
  githubTurnPathUsage,
  githubWatchersUsage,
} from "../../../../cli/commands/github/reportUsage.js";
import { GITHUB_REPO_USAGE } from "../../../../cli/commands/github/repoUsage.js";
import { githubReviewDraftUsage } from "../../../../cli/commands/github/reviewDraftUsage.js";
import { githubManifest } from "../../../../cli/manifests/github.js";

describe("githubManifest", () => {
  it("quotes each verb's usage from its leaf — the constant the command itself prints, so the two cannot drift", () => {
    expect(githubManifest["actions"]!.meta.usage).toBe(GITHUB_ACTIONS_USAGE);
    expect(githubManifest["attach"]!.meta.usage).toBe(GITHUB_ATTACH_USAGE);
    expect(githubManifest["bump-drive"]!.meta.usage).toBe(githubBumpDriveUsage());
    expect(githubManifest["close"]!.meta.usage).toBe(GITHUB_CLOSE_USAGE);
    expect(githubManifest["comment"]!.meta.usage).toBe(GITHUB_COMMENT_USAGE);
    expect(githubManifest["enqueue"]!.meta.usage).toBe(GITHUB_ENQUEUE_USAGE);
    expect(githubManifest["hold"]!.meta.usage).toBe(GITHUB_HOLD_USAGE);
    expect(githubManifest["label"]!.meta.usage).toBe(GITHUB_LABEL_USAGE);
    expect(githubManifest["release"]!.meta.usage).toBe(GITHUB_RELEASE_USAGE);
    expect(githubManifest["push-restriction"]!.meta.usage).toBe(GITHUB_PUSH_RESTRICTION_USAGE);
    expect(githubManifest["repo"]!.meta.usage).toBe(GITHUB_REPO_USAGE);
    expect(githubManifest["required-contexts"]!.meta.usage).toBe(GITHUB_REQUIRED_CONTEXTS_USAGE);
    expect(githubManifest["ready"]!.meta.usage).toBe(GITHUB_READY_USAGE);
    expect(githubManifest["landing"]!.meta.usage).toBe(githubLandingUsage());
    expect(githubManifest["review-draft"]!.meta.usage).toBe(githubReviewDraftUsage());
    expect(githubManifest["review-state"]!.meta.usage).toBe(githubReviewStateUsage());
    expect(githubManifest["search"]!.meta.usage).toBe(githubSearchUsage());
    expect(githubManifest["self-review"]!.meta.usage).toBe(GITHUB_SELF_REVIEW_RELEASE_USAGE);
    expect(githubManifest["watchers"]!.meta.usage).toBe(githubWatchersUsage());
    expect(githubManifest["turn-path"]!.meta.usage).toBe(githubTurnPathUsage());
    expect(githubManifest["thread"]!.meta.usage).toBe(GITHUB_THREAD_USAGE);
    expect(githubManifest["vuln"]!.meta.usage).toBe(GITHUB_VULN_USAGE);
  });
});
