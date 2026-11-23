import { describe, expect, it } from "vitest";

import { shellDiffArgs } from "../../../../checkouts/installedApp.js";
import { STAMP_KEYS } from "../../../../desktop/buildStamp.js";
import { read, SHA_A, UPSTREAM_READ, useConsoleBuildRoots, worldAt } from "./harness.js";

/** The commit an installed app was built from, off the upstream's line. */
const SHA_APP = "c".repeat(40);
const SHA_FORK = "d".repeat(40);

/**
 * An installed bundle's `Info.plist` carrying a stamp.
 *
 * @returns the XML
 */
function stampedPlist({ sha, tree }: { sha: string; tree: string }): string {
  return [
    `<key>${STAMP_KEYS.sha}</key><string>${sha}</string>`,
    `<key>${STAMP_KEYS.committedIso}</key><string>2026-09-28T05:00:00Z</string>`,
    `<key>${STAMP_KEYS.tree}</key><string>${tree}</string>`,
  ].join("\n");
}

useConsoleBuildRoots();

describe("readConsoleBuild", () => {
  it("reads no installed app as absent, with no problem", () => {
    const report = read({ world: worldAt() });
    expect(report.installedApp).toEqual({ kind: "absent" });
    expect(report.problems).toEqual([]);
  });

  it("calls an installed app current by its source, though its commit is on no line — the pre-squash build", () => {
    const world = worldAt();
    world.plist = { kind: "read", text: stampedPlist({ sha: SHA_APP, tree: "clean" }) };
    world.git.set(shellDiffArgs({ from: SHA_APP, to: SHA_A }).join(" "), "");
    const report = read({ world });
    expect(report.installedApp).toEqual({
      forkSha: undefined,
      kind: "read",
      shellDiffers: false,
      stamp: { committedIso: "2026-09-28T05:00:00Z", sha: SHA_APP, tree: "clean" },
    });
    expect(report.problems).toEqual([]);
  });

  it("names an app whose source differs, with the fork point the page places it by", () => {
    const world = worldAt();
    world.plist = { kind: "read", text: stampedPlist({ sha: SHA_APP, tree: "clean" }) };
    world.git.set(shellDiffArgs({ from: SHA_APP, to: SHA_A }).join(" "), "desktop/src/main.ts");
    world.git.set(`merge-base ${SHA_APP} ${SHA_A}`, SHA_FORK);
    const report = read({ world });
    expect(report.installedApp).toEqual({
      forkSha: SHA_FORK,
      kind: "read",
      shellDiffers: true,
      stamp: { committedIso: "2026-09-28T05:00:00Z", sha: SHA_APP, tree: "clean" },
    });
    expect(report.problems).toEqual([]);
  });

  it("still names a new version when the fork cannot be read, and says which landings are not listed", () => {
    const world = worldAt();
    world.plist = { kind: "read", text: stampedPlist({ sha: SHA_APP, tree: "clean" }) };
    world.git.set(shellDiffArgs({ from: SHA_APP, to: SHA_A }).join(" "), "desktop/src/main.ts");
    const report = read({ world });
    expect(report.installedApp).toEqual({
      forkSha: undefined,
      kind: "read",
      shellDiffers: true,
      stamp: { committedIso: "2026-09-28T05:00:00Z", sha: SHA_APP, tree: "clean" },
    });
    expect(report.problems).toEqual([
      "where the installed app ccccccccc forked from origin/main could not be read — which landings it lacks are not listed",
    ]);
  });

  it("names an app commit this checkout cannot compare, and claims nothing about it", () => {
    const world = worldAt();
    world.plist = { kind: "read", text: stampedPlist({ sha: SHA_APP, tree: "clean" }) };
    const report = read({ world });
    expect(report.installedApp).toEqual({
      forkSha: undefined,
      kind: "read",
      shellDiffers: undefined,
      stamp: { committedIso: "2026-09-28T05:00:00Z", sha: SHA_APP, tree: "clean" },
    });
    expect(report.problems).toEqual([
      "whether origin/main changes the installed app could not be read — its commit ccccccccc may not be in this checkout",
    ]);
  });

  it("never compares a build that carried uncommitted app changes", () => {
    const world = worldAt();
    world.plist = { kind: "read", text: stampedPlist({ sha: SHA_APP, tree: "dirty" }) };
    world.git.set(shellDiffArgs({ from: SHA_APP, to: SHA_A }).join(" "), "");
    const report = read({ world });
    expect(report.installedApp).toEqual({
      forkSha: undefined,
      kind: "read",
      shellDiffers: undefined,
      stamp: { committedIso: "2026-09-28T05:00:00Z", sha: SHA_APP, tree: "dirty" },
    });
    expect(report.problems).toEqual([]);
  });

  it("keeps an app that is there but will not read apart from no app at all", () => {
    const world = worldAt();
    world.plist = { kind: "failed", why: "EACCES" };
    expect(read({ world }).installedApp).toEqual({
      kind: "unreadable",
      why: "the installed app's Info.plist could not be read: EACCES",
    });
    world.plist = { kind: "read", text: "<plist></plist>" };
    const report = read({ world });
    expect(report.installedApp.kind).toBe("unreadable");
    expect(report.problems).toEqual([
      "the installed app's Info.plist carries no build stamp this reading parses — one `slopweaver desktop install` writes one",
    ]);
  });

  it("reads the app but compares nothing when there is no upstream to compare it with", () => {
    const world = worldAt();
    world.plist = { kind: "read", text: stampedPlist({ sha: SHA_APP, tree: "clean" }) };
    world.git.set(UPSTREAM_READ, "");
    expect(read({ world }).installedApp).toEqual({
      forkSha: undefined,
      kind: "read",
      shellDiffers: undefined,
      stamp: { committedIso: "2026-09-28T05:00:00Z", sha: SHA_APP, tree: "clean" },
    });
  });
});
