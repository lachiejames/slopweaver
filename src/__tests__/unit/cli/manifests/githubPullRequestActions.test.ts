import { describe, expect, it } from "vitest";
import { GITHUB_HOLD_USAGE } from "../../../../cli/commands/github/holdUsage.js";
import { GITHUB_LAP_SEAT_USAGE } from "../../../../cli/commands/github/lapSeatUsage.js";
import { GITHUB_LAP_USAGE } from "../../../../cli/commands/github/lapUsage.js";
import {
  GITHUB_CLOSE_USAGE,
  GITHUB_COMMENT_USAGE,
  GITHUB_ENQUEUE_USAGE,
  GITHUB_LABEL_USAGE,
} from "../../../../cli/commands/github/prUsage.js";
import { githubManifest } from "../../../../cli/manifests/github.js";
import { MERGE_USAGE, USAGE } from "../../../../cli/manifests/githubNounUsage.js";
import { githubPullRequestActionsManifest } from "../../../../cli/manifests/githubPullRequestActions.js";

/*
 * The nine verbs that act on one pull request: which ones the leaf declares, in what order, that each still
 * quotes its usage from the leaf the command prints, and that the github noun spreads them in between the CI
 * verbs and the ref verbs, so `catalog` reads them in the same declaration order.
 */
describe("githubPullRequestActionsManifest", () => {
  it("declares exactly the nine pull-request action verbs, in order", () => {
    expect(Object.keys(githubPullRequestActionsManifest)).toEqual([
      "close",
      "comment",
      "enqueue",
      "hold",
      "label",
      "lap",
      "lap-seat",
      "merge",
      "pr",
    ]);
  });

  it("quotes each verb's usage from its leaf — the constant the command itself prints, so the two cannot drift", () => {
    expect(githubPullRequestActionsManifest["close"]!.meta.usage).toBe(GITHUB_CLOSE_USAGE);
    expect(githubPullRequestActionsManifest["comment"]!.meta.usage).toBe(GITHUB_COMMENT_USAGE);
    expect(githubPullRequestActionsManifest["enqueue"]!.meta.usage).toBe(GITHUB_ENQUEUE_USAGE);
    expect(githubPullRequestActionsManifest["hold"]!.meta.usage).toBe(GITHUB_HOLD_USAGE);
    expect(githubPullRequestActionsManifest["label"]!.meta.usage).toBe(GITHUB_LABEL_USAGE);
    expect(githubPullRequestActionsManifest["lap"]!.meta.usage).toBe(GITHUB_LAP_USAGE);
    expect(githubPullRequestActionsManifest["lap-seat"]!.meta.usage).toBe(GITHUB_LAP_SEAT_USAGE);
    expect(githubPullRequestActionsManifest["merge"]!.meta.usage).toBe(MERGE_USAGE);
    expect(githubPullRequestActionsManifest["pr"]!.meta.usage).toBe(USAGE);
  });

  it("is spread into the github noun, so every verb is still dispatchable by name", () => {
    expect(githubManifest["close"]).toBe(githubPullRequestActionsManifest["close"]);
    expect(githubManifest["hold"]).toBe(githubPullRequestActionsManifest["hold"]);
    expect(githubManifest["lap"]).toBe(githubPullRequestActionsManifest["lap"]);
    expect(githubManifest["pr"]).toBe(githubPullRequestActionsManifest["pr"]);
  });

  it("keeps the nine between cycle and the ref verbs, where they were typed", () => {
    const names = Object.keys(githubManifest);
    expect(names.slice(names.indexOf("cycle"), names.indexOf("cycle") + 13)).toEqual([
      "cycle",
      "close",
      "comment",
      "enqueue",
      "hold",
      "label",
      "lap",
      "lap-seat",
      "merge",
      "pr",
      "branch",
      "push",
      "tag",
    ]);
  });
});
