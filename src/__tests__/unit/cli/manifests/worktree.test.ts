/**
 * The `worktree` noun's manifest: only `create` refuses a bare run before it resolves the repository, so it is the
 * one `dryParseSafe` verb; `remove` and `status` spawn git to find the repository root before they check the slug,
 * so their missing-slug reject is the only one that is not I/O-free. Nothing here reaches a provider or a work item.
 * That the manifest imports nothing heavier is `../manifestBarrelClosure.test.ts`'s job.
 */
import { describe, expect, it } from "vitest";

import { worktreeManifest } from "../../../../cli/manifests/worktree.js";

import { classificationsOf } from "./_classification.js";

describe("worktreeManifest", () => {
  it("declares exactly the nine worktree verbs", () => {
    expect(Object.keys(worktreeManifest).toSorted()).toEqual([
      "create",
      "here",
      "list",
      "mirror-prune",
      "noindex",
      "prune",
      "remove",
      "status",
      "unshare",
    ]);
  });

  it("classifies each verb by what a bare run does and whether its missing-slug reject spawns git", () => {
    expect(classificationsOf({ manifest: worktreeManifest })).toEqual({
      create: {
        createsWorkItem: false,
        diagnostic: false,
        doorRouted: false,
        dryParseSafe: true,
        effect: "local-state",
        parseRejectIsIoFree: true,
      },
      here: {
        createsWorkItem: false,
        diagnostic: true,
        doorRouted: false,
        dryParseSafe: false,
        effect: "external-read",
        parseRejectIsIoFree: true,
      },
      list: {
        createsWorkItem: false,
        diagnostic: true,
        doorRouted: false,
        dryParseSafe: false,
        effect: "external-read",
        parseRejectIsIoFree: true,
      },
      "mirror-prune": {
        createsWorkItem: false,
        diagnostic: false,
        doorRouted: false,
        dryParseSafe: false,
        effect: "local-state",
        parseRejectIsIoFree: true,
      },
      noindex: {
        createsWorkItem: false,
        diagnostic: false,
        doorRouted: false,
        dryParseSafe: false,
        effect: "local-state",
        parseRejectIsIoFree: true,
      },
      prune: {
        createsWorkItem: false,
        diagnostic: false,
        doorRouted: false,
        dryParseSafe: false,
        effect: "local-state",
        parseRejectIsIoFree: true,
      },
      remove: {
        createsWorkItem: false,
        diagnostic: false,
        doorRouted: false,
        dryParseSafe: false,
        effect: "local-state",
        parseRejectIsIoFree: false,
      },
      status: {
        createsWorkItem: false,
        diagnostic: true,
        doorRouted: false,
        dryParseSafe: false,
        effect: "external-read",
        parseRejectIsIoFree: false,
      },
      unshare: {
        createsWorkItem: false,
        diagnostic: true,
        doorRouted: false,
        dryParseSafe: false,
        effect: "local-state",
        parseRejectIsIoFree: true,
      },
    });
  });
});
