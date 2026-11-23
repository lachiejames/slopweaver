import { describe, expect, it } from "vitest";

import { parseRepoSettingsApplyManifest } from "../../../../../cli/commands/github/repoManifestSchema.js";
import { unwrap } from "../../../../../lib/result.js";
import { applyManifestValue } from "../../../../githubRepoManifestWorld.js";

/** The refusal lines for one value, or a sentinel naming that it parsed. */
function problemsOf({ value }: { value: unknown }): readonly string[] {
  const parsed = parseRepoSettingsApplyManifest({ value });
  return parsed.isErr() ? parsed.error : ["(parsed)"];
}

describe("parseRepoSettingsApplyManifest", () => {
  it("parses a complete artifact into its typed settings", () => {
    const parsed = parseRepoSettingsApplyManifest({ value: applyManifestValue() });

    expect(parsed.isOk()).toBe(true);
    const manifest = unwrap(parsed);
    expect(manifest.repository).toBe("acme/widget");
    expect(manifest.settings.topics).toEqual(["cli", "widgets"]);
    expect(manifest.settings.labels.create).toEqual([{ color: "0e8a16", description: "Ready to land", name: "ready" }]);
  });

  it("refuses an unknown field rather than dropping it", () => {
    const value = { ...applyManifestValue(), forking: { allowForking: false } };

    expect(problemsOf({ value })).toEqual([': Unrecognized key: "forking"']);
  });

  it("refuses an artifact that still carries an unresolved owner call", () => {
    const value = applyManifestValue();
    value.provenance["unresolvedOwnerCalls"] = ["merge-style"];

    expect(problemsOf({ value })).toEqual([
      "provenance.unresolvedOwnerCalls: every owner call is ruled before an apply artifact exists",
    ]);
  });

  it("refuses a placeholder copied out of the evidence manifest in place of a ruling", () => {
    const value = applyManifestValue({ description: "OWNER CALL — see ownerCalls.description" });

    expect(problemsOf({ value })).toEqual(["settings.description: a placeholder, not a ruling: rule on it first"]);
  });

  it("refuses a label name GitHub would store trimmed, which could never read back as sent", () => {
    const value = applyManifestValue({
      labels: { create: [{ color: "0e8a16", description: null, name: " ready " }], keepGithubDefaults: true },
    });

    expect(problemsOf({ value })).toEqual([
      "settings.labels.create.0.name: leading or trailing whitespace, which GitHub trims",
    ]);
  });

  it("refuses a required status check named twice, which GitHub stores once", () => {
    const value = applyManifestValue();
    const protection = value.settings["branchProtectionMain"] as Record<string, unknown>;
    protection["requiredStatusChecks"] = { contexts: ["ci", "ci"], strict: true };

    expect(problemsOf({ value })).toEqual([
      'settings.branchProtectionMain.requiredStatusChecks.contexts: "ci" appears more than once, ignoring case',
    ]);
  });

  it("accepts a null description, which clears it", () => {
    const parsed = parseRepoSettingsApplyManifest({ value: applyManifestValue({ description: null }) });

    expect(unwrap(parsed).settings.description).toBe(null);
  });

  it("refuses a topic GitHub would refuse", () => {
    const value = applyManifestValue({ topics: ["Has Spaces"] });

    expect(problemsOf({ value })).toEqual(["settings.topics.0: a GitHub topic: lowercase letters, digits, hyphens"]);
  });

  it("refuses the same topic twice", () => {
    const value = applyManifestValue({ topics: ["cli", "cli"] });

    expect(problemsOf({ value })).toEqual(['settings.topics: "cli" appears more than once']);
  });

  it("refuses two labels whose names differ only in case", () => {
    const label = { color: "0e8a16", description: null };
    const value = applyManifestValue({
      labels: {
        create: [
          { ...label, name: "Ready" },
          { ...label, name: "ready" },
        ],
        keepGithubDefaults: true,
      },
    });

    expect(problemsOf({ value })).toEqual(['settings.labels.create: "ready" appears more than once, ignoring case']);
  });

  it("refuses push protection without secret scanning", () => {
    const value = applyManifestValue({ secretScanning: { pushProtection: true, secretScanning: false } });

    expect(problemsOf({ value })).toEqual(["settings.secretScanning: push protection needs secret scanning on"]);
  });

  it("refuses a squash title and message GitHub does not pair", () => {
    const merge = unwrap(parseRepoSettingsApplyManifest({ value: applyManifestValue() })).settings.mergeSettings;
    const value = applyManifestValue({ mergeSettings: { ...merge, squashMergeCommitMessage: "COMMIT_MESSAGES" } });

    expect(problemsOf({ value })).toEqual([
      "settings.mergeSettings: GitHub pairs COMMIT_OR_PR_TITLE with COMMIT_MESSAGES, and PR_TITLE with PR_BODY or BLANK",
    ]);
  });

  it("refuses a repository that is not owner/name", () => {
    const value = { ...applyManifestValue(), repository: "widget" };

    expect(problemsOf({ value })).toEqual(["repository: owner/name"]);
  });

  it("refuses a pull-request review requirement, which a solo owner could never satisfy", () => {
    const value = applyManifestValue();
    const protection = {
      ...(value.settings["branchProtectionMain"] as object),
      requiredPullRequestReviews: { count: 1 },
    };

    expect(problemsOf({ value: applyManifestValue({ branchProtectionMain: protection }) })).toEqual([
      "settings.branchProtectionMain.requiredPullRequestReviews: Invalid input: expected null, received object",
    ]);
  });
});
