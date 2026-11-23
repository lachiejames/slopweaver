/**
 * The `notion` noun's manifest: the two writers (`attach`, `page`) are door-routed external writes, `page` alone
 * creates a work item, `read` is an external read, and `verify` is `local-state` because judging an observation
 * creates its output directory (it launches no browser). That the manifest imports nothing heavier is
 * `../manifestBarrelClosure.test.ts`'s job.
 */
import { describe, expect, it } from "vitest";

import { notionManifest } from "../../../../cli/manifests/notion.js";

import { classificationsOf } from "./_classification.js";

describe("notionManifest", () => {
  it("declares exactly `attach`, `page`, `read` and `verify`", () => {
    expect(Object.keys(notionManifest).toSorted()).toEqual(["attach", "page", "read", "verify"]);
  });

  it("pins every verb's six classification fields", () => {
    expect(classificationsOf({ manifest: notionManifest })).toEqual({
      attach: {
        createsWorkItem: false,
        diagnostic: false,
        doorRouted: true,
        dryParseSafe: true,
        effect: "external-write",
        parseRejectIsIoFree: true,
      },
      page: {
        createsWorkItem: true,
        diagnostic: false,
        doorRouted: true,
        dryParseSafe: true,
        effect: "external-write",
        parseRejectIsIoFree: true,
      },
      read: {
        createsWorkItem: false,
        diagnostic: false,
        doorRouted: false,
        dryParseSafe: true,
        effect: "external-read",
        parseRejectIsIoFree: true,
      },
      verify: {
        createsWorkItem: false,
        diagnostic: true,
        doorRouted: false,
        dryParseSafe: true,
        effect: "local-state",
        parseRejectIsIoFree: true,
      },
    });
  });

  it("describes `verify` as a brief for the owner's own Chrome, not a launched browser", () => {
    expect(notionManifest["verify"]!.meta.summary).toBe(
      "Brief a published page's render check for your own Chrome, then judge the observation it returns",
    );
  });
});
