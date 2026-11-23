/**
 * `reviewBaseRefs`: the base refs a branch's reviews in this checkout were judged against, each once, with any
 * value that could not safely reach git's argv dropped.
 */
import { describe, expect, it } from "vitest";

import { reviewBaseRefs } from "../../../../codex/diffCarry.js";
import type { CodexArtifactRecord } from "../../../../codex/types.js";
import { anyPassRecord, HEAD, REPO, treeOn } from "./fixtures.js";

describe("reviewBaseRefs", () => {
  const onFeature = treeOn({ branch: "feature", headSha: HEAD, patch: "" });
  const withBase = ({ record, baseRef }: { record: CodexArtifactRecord; baseRef: unknown }): CodexArtifactRecord =>
    ({ ...record, scope: { ...record.scope, baseRef } }) as unknown as CodexArtifactRecord;

  it("names each base ref of this checkout's reviews on the branch once, and nothing else", () => {
    const records = [
      anyPassRecord({ artifactId: "a", pass: "r1", tree: onFeature }),
      anyPassRecord({ artifactId: "b", pass: "r2", tree: onFeature }),
      withBase({ baseRef: "origin/dev", record: anyPassRecord({ artifactId: "c", pass: "r3", tree: onFeature }) }),
      anyPassRecord({ artifactId: "plan", pass: "p1", tree: onFeature }),
      anyPassRecord({
        artifactId: "other-branch",
        pass: "r1",
        tree: treeOn({ branch: "x", headSha: HEAD, patch: "" }),
      }),
      { ...anyPassRecord({ artifactId: "other-root", pass: "r1", tree: onFeature }), repoRoot: "/w/elsewhere" },
    ];

    expect(reviewBaseRefs({ branch: "feature", records, repoRoot: REPO })).toEqual(["origin/main", "origin/dev"]);
  });

  /** The value comes off disk shallow-decoded and is about to reach git's argv. */
  it("drops a base ref that is empty, not a string, or would read as a flag", () => {
    const records = ["", null, "--output=/tmp/x"].map((baseRef, index) =>
      withBase({ baseRef, record: anyPassRecord({ artifactId: `bad-${String(index)}`, pass: "r1", tree: onFeature }) }),
    );

    expect(reviewBaseRefs({ branch: "feature", records, repoRoot: REPO })).toEqual([]);
  });
});
