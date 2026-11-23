import { describe, expect, it } from "vitest";

import { largestPullInSubjects } from "../../../cli/commands/handover/repoPullScale.js";

describe("largestPullInSubjects", () => {
  it("reads the largest squash-merge number off acme-admin's default-branch subjects", () => {
    // Invented subjects in the shape `git log -n 5 --format=%s refs/remotes/origin/HEAD` prints.
    const subjects = [
      "fix(ABC-11): retry the nightly export once per batch, not per row (#4102)",
      "feat(ABC-12): show the build number in the settings footer (#4517)",
      "feat(XYZ-3): accept a CSV upload on the bulk-invite page (#4560)",
      "feat(ABC-14): group the usage chart by week, and keep the zoom across reloads (#4588)",
      "",
    ];

    expect(largestPullInSubjects({ subjects })).toBe(4588);
  });

  it("reads only a subject's trailing number, never one it quotes mid-sentence", () => {
    expect(largestPullInSubjects({ subjects: ['Revert "feat: x (#99999)" (#1554)', "wip (#77777) later"] })).toBe(1554);
  });

  it("attests nothing when no subject ends in a pull-request number", () => {
    expect(largestPullInSubjects({ subjects: ["Merge branch 'main'", "chore: bump"] })).toBeUndefined();
    expect(largestPullInSubjects({ subjects: [] })).toBeUndefined();
  });
});
