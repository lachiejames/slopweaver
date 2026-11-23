import { describe, expect, it } from "vitest";
import { GITHUB_ALERT_USAGE } from "../../../../cli/commands/github/alertUsage.js";
import { GITHUB_CODE_SCANNING_USAGE } from "../../../../cli/commands/github/codeScanningUsage.js";
import { githubManifest } from "../../../../cli/manifests/github.js";
import { githubCodeScanningManifest } from "../../../../cli/manifests/githubCodeScanning.js";

/*
 * Same two properties as `./githubCi.test.ts`: the split moved WHICH FILE the rows live in and nothing else,
 * so both verbs are still dispatchable through `githubManifest`, and `alert` still leads the DECLARATION order
 * (help sorts verbs by name on its own, in `router.ts`, so declaration order is what a spread can move).
 */
describe("githubCodeScanningManifest", () => {
  it("declares exactly the two code-scanning verbs", () => {
    expect(Object.keys(githubCodeScanningManifest)).toEqual(["alert", "code-scanning"]);
  });

  it("declares both of them external-write and door-routed", () => {
    const entries = Object.values(githubCodeScanningManifest);
    expect(entries.length).toBe(2);
    expect(entries.map((entry) => entry.meta.effect)).toEqual(["external-write", "external-write"]);
    expect(entries.map((entry) => entry.meta.doorRouted)).toEqual([true, true]);
  });

  it("is spread into the github noun, so both verbs are still dispatchable by name", () => {
    expect(githubManifest["alert"]).toBe(githubCodeScanningManifest["alert"]);
    expect(githubManifest["code-scanning"]).toBe(githubCodeScanningManifest["code-scanning"]);
  });

  it("keeps alert first in declaration order, where it was typed, with code-scanning beside it", () => {
    expect(Object.keys(githubManifest).slice(0, 3)).toEqual(["alert", "code-scanning", "attach"]);
  });

  it("quotes each verb's usage from its leaf — the constant the command itself prints, so the two cannot drift", () => {
    expect(githubCodeScanningManifest["alert"]!.meta.usage).toBe(GITHUB_ALERT_USAGE);
    expect(githubCodeScanningManifest["code-scanning"]!.meta.usage).toBe(GITHUB_CODE_SCANNING_USAGE);
  });
});
