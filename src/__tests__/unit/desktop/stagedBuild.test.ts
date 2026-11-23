/**
 * The prebuilt update's pure decisions: where a staged build lives, when HEAD is worth building, and when the ready
 * build may be installed in place of a fresh one.
 */
import { describe, expect, it } from "vitest";

import type { ShellStamp } from "../../../desktop/buildStamp.js";
import {
  caseCollidingPaths,
  type PrebuildFacts,
  prebuildDecision,
  type StageFacts,
  stagedBundle,
  stagePaths,
  stageVerdict,
  trackedSymlinks,
} from "../../../desktop/stagedBuild.js";

const HEAD: ShellStamp = { committedIso: "2026-10-10T18:00:00+11:00", sha: "a".repeat(40), tree: "clean" };
const OLDER: ShellStamp = { committedIso: "2026-10-09T18:00:00+11:00", sha: "b".repeat(40), tree: "clean" };

/** A main checkout with a keychain, an installed app whose source differs from HEAD, and no ready build. */
const facts = (over: Partial<PrebuildFacts> = {}): PrebuildFacts => ({
  head: HEAD,
  installed: OLDER,
  installedDiffers: true,
  isMain: true,
  keychain: true,
  ready: undefined,
  ...over,
});

describe("stagePaths", () => {
  it("keeps every stage folder under staged/, a build in progress named for its run", () => {
    expect(stagePaths({ appSupport: "/s", nonce: "42" })).toEqual({
      building: "/s/staged/building-42",
      claimed: "/s/staged/claimed-42",
      log: "/s/staged/prebuild.log",
      ready: "/s/staged/ready",
      root: "/s/staged",
      source: "/s/staged/source-42",
    });
  });

  it("finds the bundle where yarn app puts it", () => {
    expect(stagedBundle({ folder: "/s/staged/ready" })).toBe("/s/staged/ready/mac-arm64/Slopweaver.app");
  });
});

describe("prebuildDecision", () => {
  it("builds HEAD when the installed app's source differs from it", () => {
    expect(prebuildDecision({ facts: facts() })).toEqual({
      due: true,
      why: "building aaaaaaaaa so Update now has it ready",
    });
  });

  it("builds HEAD when the installed app carries no stamp", () => {
    expect(prebuildDecision({ facts: facts({ installed: undefined }) }).due).toBe(true);
  });

  it("builds HEAD over a ready build of an older commit", () => {
    expect(prebuildDecision({ facts: facts({ ready: OLDER }) }).due).toBe(true);
  });

  it("never builds outside a declared main checkout", () => {
    expect(prebuildDecision({ facts: facts({ isMain: false }) })).toEqual({
      due: false,
      why: "not a declared main checkout",
    });
  });

  it("never mints the signing identity", () => {
    expect(prebuildDecision({ facts: facts({ keychain: false }) })).toEqual({
      due: false,
      why: "no signing keychain yet — the first `slopweaver desktop install` makes it",
    });
  });

  it("never stages local desktop/ edits", () => {
    expect(prebuildDecision({ facts: facts({ head: { ...HEAD, tree: "dirty" } }) })).toEqual({
      due: false,
      why: "aaaaaaaaa has local desktop/ edits, so it is not a build of main",
    });
  });

  it("does nothing when HEAD is already built and waiting", () => {
    expect(prebuildDecision({ facts: facts({ ready: HEAD }) })).toEqual({
      due: false,
      why: "aaaaaaaaa is already built and waiting",
    });
  });

  it("rebuilds over a ready build of HEAD that carried local edits", () => {
    expect(prebuildDecision({ facts: facts({ ready: { ...HEAD, tree: "dirty" } }) }).due).toBe(true);
  });

  it("does nothing when the installed app's source already matches HEAD", () => {
    expect(prebuildDecision({ facts: facts({ installedDiffers: false }) })).toEqual({
      due: false,
      why: "the installed app already matches aaaaaaaaa",
    });
  });

  it("builds when the installed app matches HEAD's source but was built with local edits", () => {
    expect(
      prebuildDecision({ facts: facts({ installed: { ...OLDER, tree: "dirty" }, installedDiffers: false }) }).due,
    ).toBe(true);
  });
});

/** A ready build of exactly HEAD, signed with the identity and verified. */
const stage = (over: Partial<StageFacts> = {}): StageFacts => ({
  expected: 'identifier x and certificate leaf = H"ab"',
  head: HEAD,
  requirement: 'identifier x and certificate leaf = H"ab"',
  stamp: HEAD,
  verified: true,
  ...over,
});

describe("stageVerdict", () => {
  it("installs a clean, signed, verified build of exactly HEAD", () => {
    expect(stageVerdict({ facts: stage() })).toEqual({ usable: true });
  });

  it("refuses a build with no stamp", () => {
    expect(stageVerdict({ facts: stage({ stamp: undefined }) })).toEqual({
      usable: false,
      why: "it carries no stamp",
    });
  });

  it("refuses a build of another commit, so a stage never installs anything but HEAD", () => {
    expect(stageVerdict({ facts: stage({ stamp: OLDER }) })).toEqual({
      usable: false,
      why: "it is bbbbbbbbb, not a clean aaaaaaaaa",
    });
  });

  it("refuses a build carrying local edits", () => {
    expect(stageVerdict({ facts: stage({ stamp: { ...HEAD, tree: "dirty" } }) }).usable).toBe(false);
  });

  it("refuses when HEAD itself carries local edits, which only a fresh build includes", () => {
    expect(stageVerdict({ facts: stage({ head: { ...HEAD, tree: "dirty" } }) }).usable).toBe(false);
  });

  it("refuses a stamp naming HEAD's sha with another commit time, which no build of HEAD wrote", () => {
    expect(stageVerdict({ facts: stage({ stamp: { ...HEAD, committedIso: "2000-01-01T00:00:00Z" } }) })).toEqual({
      usable: false,
      why: "its stamp names 2000-01-01T00:00:00Z, not HEAD's 2026-10-10T18:00:00+11:00",
    });
  });

  it("refuses a build signed with another identity", () => {
    expect(stageVerdict({ facts: stage({ requirement: 'cdhash H"00"' }) })).toEqual({
      usable: false,
      why: "it is not signed with the app's identity",
    });
  });

  it("refuses a build whose signature does not verify", () => {
    expect(stageVerdict({ facts: stage({ verified: false }) })).toEqual({
      usable: false,
      why: "its signature did not verify",
    });
  });
});

describe("trackedSymlinks", () => {
  it("names every symlink the tree tracks, and nothing else", () => {
    const tree = [
      "100644 blob 1111111111111111111111111111111111111111\tdesktop/package.json",
      "120000 blob 2222222222222222222222222222222222222222\tdesktop/src/main.ts",
      "100755 blob 3333333333333333333333333333333333333333\tdesktop/scripts/run.sh",
      "120000 blob 4444444444444444444444444444444444444444\tdesktop/link with space",
    ].join("\n");
    expect(trackedSymlinks({ tree })).toEqual(["desktop/src/main.ts", "desktop/link with space"]);
  });

  it("finds none in a tree of plain files, or in an empty one", () => {
    expect(trackedSymlinks({ tree: "100644 blob 1111111111111111111111111111111111111111\tdesktop/a.ts\n" })).toEqual(
      [],
    );
    expect(trackedSymlinks({ tree: "" })).toEqual([]);
  });
});

describe("caseCollidingPaths", () => {
  it("names both paths of every pair that differ only in case or Unicode normalisation", () => {
    const tree = [
      "100644 blob 1111111111111111111111111111111111111111\tscripts/Foo.sh",
      "100644 blob 2222222222222222222222222222222222222222\tdesktop/package.json",
      "100644 blob 3333333333333333333333333333333333333333\tscripts/foo.sh",
      "100644 blob 4444444444444444444444444444444444444444\tdesktop/café.ts",
      "100644 blob 5555555555555555555555555555555555555555\tdesktop/café.ts",
    ].join("\n");
    expect(caseCollidingPaths({ tree })).toEqual([
      "scripts/Foo.sh",
      "scripts/foo.sh",
      "desktop/café.ts",
      "desktop/café.ts",
    ]);
  });

  it("finds none in a tree of distinct paths, or in an empty one", () => {
    const tree = [
      "100644 blob 1111111111111111111111111111111111111111\tdesktop/package.json",
      "100755 blob 2222222222222222222222222222222222222222\tscripts/tsc-owner.sh",
    ].join("\n");
    expect(caseCollidingPaths({ tree })).toEqual([]);
    expect(caseCollidingPaths({ tree: "" })).toEqual([]);
  });
});
