/**
 * Pins the re-cut leaf's verbs to the usage strings their commands print, so `--help` and the verb cannot drift.
 */
import { describe, expect, it } from "vitest";

import {
  GITHUB_PUSH_ROOT_USAGE,
  GITHUB_REPOINT_PLAN_USAGE,
} from "../../../../cli/commands/github/repositoryRecutUsage.js";
import { githubRecutManifest } from "../../../../cli/manifests/githubRecut.js";

describe("githubRecutManifest", () => {
  it("declares exactly the two re-cut verbs", () => {
    expect(Object.keys(githubRecutManifest).toSorted()).toEqual(["push-root", "repoint-plan"]);
  });

  it("quotes push-root's usage from its leaf", () => {
    expect(githubRecutManifest["push-root"]!.meta.usage).toBe(GITHUB_PUSH_ROOT_USAGE);
  });

  it("quotes repoint-plan's usage from its leaf", () => {
    expect(githubRecutManifest["repoint-plan"]!.meta.usage).toBe(GITHUB_REPOINT_PLAN_USAGE);
  });

  it("marks repoint-plan diagnostic and push-root not, because only push-root writes state", () => {
    expect(githubRecutManifest["repoint-plan"]!.meta.diagnostic).toBe(true);
    expect(githubRecutManifest["push-root"]!.meta.diagnostic).toBe(false);
  });
});
