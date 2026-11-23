import { describe, expect, it } from "vitest";
import { githubChecksUsage, githubCiRunsUsage, githubCiTimingUsage } from "../../../../cli/commands/github/ciUsage.js";
import { GITHUB_CYCLE_USAGE } from "../../../../cli/commands/github/cycleUsage.js";
import { GITHUB_RERUN_USAGE } from "../../../../cli/commands/github/rerunUsage.js";
import { GITHUB_RUN_LOG_USAGE } from "../../../../cli/commands/github/runLogUsage.js";
import { githubManifest } from "../../../../cli/manifests/github.js";
import { githubCiManifest } from "../../../../cli/manifests/githubCi.js";

/*
 * The split is only correct if it changed WHICH FILE the rows live in and nothing else, so these cases
 * assert the two properties a move can break: every verb is still reachable through `githubManifest`, and
 * it still sits where it sat. A spread placed at the wrong index silently reorders `--help` and `catalog`.
 */
describe("githubCiManifest", () => {
  it("declares the four CI-reading verbs and the two CI writes", () => {
    expect(Object.keys(githubCiManifest)).toEqual(["checks", "ci-timing", "ci-runs", "run-log", "rerun", "cycle"]);
  });

  // `external-read` is a claim about the WORLD, not about the local disk, and these four read GitHub and
  // write nothing there.
  it("declares the four reads external-read and door-routed nowhere", () => {
    const reads = ["checks", "ci-timing", "ci-runs", "run-log"].map((verb) => githubCiManifest[verb]!);
    expect(reads.length).toBe(4);
    expect(reads.filter((entry) => entry.meta.doorRouted)).toEqual([]);
    expect(reads.filter((entry) => entry.meta.effect !== "external-read")).toEqual([]);
  });

  it("declares rerun and cycle external writes that go through the door", () => {
    const writes = ["rerun", "cycle"].map((verb) => githubCiManifest[verb]!.meta);
    expect(writes.map((meta) => [meta.effect, meta.doorRouted])).toEqual([
      ["external-write", true],
      ["external-write", true],
    ]);
  });

  it("is spread into the github noun, so every verb is still dispatchable by name", () => {
    expect(Object.keys(githubManifest)).toContain("ci-timing");
    expect(githubManifest["ci-timing"]).toBe(githubCiManifest["ci-timing"]);
    expect(githubManifest["run-log"]).toBe(githubCiManifest["run-log"]);
    expect(githubManifest["rerun"]).toBe(githubCiManifest["rerun"]);
    expect(githubManifest["cycle"]).toBe(githubCiManifest["cycle"]);
  });

  it("keeps the six at the position they were typed at, so help and catalog order is unchanged", () => {
    const names = Object.keys(githubManifest);
    expect(names.slice(names.indexOf("bump-drive"), names.indexOf("bump-drive") + 8)).toEqual([
      "bump-drive",
      "checks",
      "ci-timing",
      "ci-runs",
      "run-log",
      "rerun",
      "cycle",
      "close",
    ]);
  });

  it("quotes each verb's usage from its leaf — the constant the command itself prints, so the two cannot drift", () => {
    expect(githubCiManifest["checks"]!.meta.usage).toBe(githubChecksUsage());
    expect(githubCiManifest["ci-timing"]!.meta.usage).toBe(githubCiTimingUsage());
    expect(githubCiManifest["ci-runs"]!.meta.usage).toBe(githubCiRunsUsage());
    expect(githubCiManifest["run-log"]!.meta.usage).toBe(GITHUB_RUN_LOG_USAGE);
    expect(githubCiManifest["rerun"]!.meta.usage).toBe(GITHUB_RERUN_USAGE);
    expect(githubCiManifest["cycle"]!.meta.usage).toBe(GITHUB_CYCLE_USAGE);
  });
});
