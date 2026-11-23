/**
 * Which of the owner's open dependency bumps are superseded, and why — the pure rule `github bump-drive`'s
 * `close-superseded` act closes on. The anchor case is the owner's own bump (`@ai-sdk/openai` to v3.0.119) left
 * open after Renovate's bump (to v3.0.124) merged into `staging`.
 */
import { describe, expect, it } from "vitest";

import {
  changesOnlyDependencies,
  isOwnBumpTitle,
  type MergedRenovatePr,
  mergeEffect,
  type OwnOpenPr,
  parseTargetVersion,
  recheckSupersede,
  renovateMergeSupersedes,
  supersedeComment,
  supersedeEvidence,
  type TestMergeReading,
  versionAtLeast,
} from "../../../review/bumpSupersede.js";

const BASE_TIP = "b".repeat(40);
const HEAD = "h".repeat(40);
const BASE_TREE = "t".repeat(40);

/** A test merge of the current head into the current tip that CHANGES the tree. */
const changing = (over: Partial<TestMergeReading> = {}): TestMergeReading => ({
  baseTipOid: BASE_TIP,
  baseTipTreeOid: BASE_TREE,
  mergeTreeOid: "m".repeat(40),
  mergeable: "MERGEABLE",
  parentOids: [BASE_TIP, HEAD],
  ...over,
});

const own = (over: Partial<OwnOpenPr> = {}): OwnOpenPr => ({
  baseRefName: "staging",
  changedPaths: ["yarn.lock"],
  createdAtIso: "2026-10-05T23:00:00Z",
  headOid: HEAD,
  labels: [],
  number: 18243,
  repoSlug: "acme/acme-admin",
  testMerge: changing(),
  title: "chore(deps): update dependency @ai-sdk/openai to v3.0.119",
  url: "https://github.com/acme/acme-admin/pull/18243",
  ...over,
});

const merged = (over: Partial<MergedRenovatePr> = {}): MergedRenovatePr => ({
  baseRefName: "staging",
  mergedAtIso: "2026-10-06T02:04:26Z",
  number: 16761,
  title: "chore(deps): update dependency @ai-sdk/openai to v3.0.124",
  url: "https://github.com/acme/acme-admin/pull/16761",
  ...over,
});

describe("isOwnBumpTitle", () => {
  it("reads a Renovate-worded title as a bump", () => {
    expect(isOwnBumpTitle({ title: "chore(deps): update dependency @ai-sdk/openai to v3.0.119" })).toBe(true);
  });

  it("reads the security family's ticketed title as a bump", () => {
    expect(isOwnBumpTitle({ title: "[SUP-9005] fix(security): re-resolve joi to 17.13.8" })).toBe(true);
  });

  it("reads the security family's past-the-advisory wording as a bump", () => {
    expect(isOwnBumpTitle({ title: "fix(security): bump protobufjs past the arbitrary-code-execution advisory" })).toBe(
      true,
    );
  });

  it("reads the live acme-admin security wordings as bumps — a moved pin, a removed dependency", () => {
    expect(
      [
        "[SUP-9999] fix(security): move our own seroval pin from 1.5.6 to 1.6.8, past the fromJSON thenable advisory",
        "[SUP-9992] fix(security): remove the unused jspdf dependency from @acme/backend",
        "[SUP-9001] fix(security): bump @knocklabs/cli to 1.3.0 and drop our liquidjs pin, past the join-filter bypass",
      ].map((title) => isOwnBumpTitle({ title })),
    ).toEqual([true, true, true]);
  });

  it("never reads a fix(security): title that bumps nothing as a bump", () => {
    expect(
      [
        "fix(security): document the incident-response process",
        "fix(security): update the CSP header for the admin app",
        "fix(security):",
      ].map((title) => isOwnBumpTitle({ title })),
    ).toEqual([false, false, false]);
  });

  it("peels every ticket prefix, not only the first", () => {
    expect(isOwnBumpTitle({ title: "[ENGX-1] [SUP-2] fix(security): move undici to 7.30.0" })).toBe(true);
  });

  it("never reads a [DO NOT MERGE] title as a bump, whatever follows it", () => {
    expect(
      isOwnBumpTitle({ title: "[DO NOT MERGE] [FFFF-3932] chore(deps): knip removes 311 unused dependencies" }),
    ).toBe(false);
  });

  it("does not read a feature title as a bump", () => {
    expect(isOwnBumpTitle({ title: "feat(JJJJ-1715): log an error as Datadog's error.*" })).toBe(false);
  });

  it("reads the ticketed security title the vulnerability form now writes as a bump", () => {
    expect([
      isOwnBumpTitle({
        title: "fix(SUP-9010): clear the critical protobufjs code-execution advisory from our gRPC loader (CVSS 9.8)",
      }),
      isOwnBumpTitle({ title: "fix(SUP-9010, ENGX-1): bump undici past the request-smuggling advisory (CVSS 7.5)" }),
      isOwnBumpTitle({ title: "fix(SUP-9010): clear the protobufjs advisory from our gRPC loader" }),
      isOwnBumpTitle({ title: "fix(SUP-9010): stop the age guard firing (CVSS 9.8)" }),
    ]).toEqual([true, true, false, false]);
  });
});

describe("parseTargetVersion", () => {
  it("reads a v-prefixed version", () => {
    expect(parseTargetVersion({ target: "v3.0.124" })).toEqual([3, 0, 124]);
  });

  it("reads a caret range as its floor", () => {
    expect(parseTargetVersion({ target: "^0.13.0" })).toEqual([0, 13, 0]);
  });

  it("reads a tilde range and a bare major", () => {
    expect(parseTargetVersion({ target: "~1.2" })).toEqual([1, 2]);
    expect(parseTargetVersion({ target: "v3" })).toEqual([3]);
  });

  it("refuses a prerelease and a digest", () => {
    expect(parseTargetVersion({ target: "v3.0.0-beta.1" })).toBe(undefined);
    expect(parseTargetVersion({ target: "a1b2c3d" })).toBe(undefined);
  });

  it("refuses a part past a safe integer", () => {
    expect(parseTargetVersion({ target: "1.99999999999999999999" })).toBe(undefined);
  });
});

describe("versionAtLeast", () => {
  it("compares part by part", () => {
    expect(versionAtLeast({ a: [3, 0, 124], b: [3, 0, 119] })).toBe(true);
    expect(versionAtLeast({ a: [3, 0, 119], b: [3, 0, 124] })).toBe(false);
  });

  it("answers true for equal versions", () => {
    expect(versionAtLeast({ a: [1, 2, 3], b: [1, 2, 3] })).toBe(true);
  });

  it("reads a missing part as zero", () => {
    expect(versionAtLeast({ a: [3], b: [3, 0, 0] })).toBe(true);
    expect(versionAtLeast({ a: [3], b: [3, 0, 1] })).toBe(false);
  });

  it("orders by major before minor", () => {
    expect(versionAtLeast({ a: [4, 0], b: [3, 99] })).toBe(true);
  });
});

describe("renovateMergeSupersedes", () => {
  it("closes the owner's bump on Renovate's merge: same subject, same base, merged after, at a newer version", () => {
    expect(renovateMergeSupersedes({ merged: merged(), own: own() })).toBe(true);
  });

  it("holds when Renovate merged an OLDER version than the owner's", () => {
    expect(
      renovateMergeSupersedes({
        merged: merged({ title: "chore(deps): update dependency @ai-sdk/openai to v3.0.110" }),
        own: own(),
      }),
    ).toBe(false);
  });

  it("closes on the exact same version", () => {
    expect(
      renovateMergeSupersedes({
        merged: merged({ title: "chore(deps): update dependency @ai-sdk/openai to v3.0.119" }),
        own: own(),
      }),
    ).toBe(true);
  });

  it("holds when the merge landed before the owner's pull request was opened", () => {
    expect(renovateMergeSupersedes({ merged: merged({ mergedAtIso: "2026-10-05T22:00:00Z" }), own: own() })).toBe(
      false,
    );
  });

  it("holds when the merge went into a different base", () => {
    expect(renovateMergeSupersedes({ merged: merged({ baseRefName: "main" }), own: own() })).toBe(false);
  });

  it("holds for a different subject at a newer version", () => {
    expect(
      renovateMergeSupersedes({
        merged: merged({ title: "chore(deps): update dependency @ai-sdk/anthropic to v3.0.124" }),
        own: own(),
      }),
    ).toBe(false);
  });

  it("matches the subject regardless of case and a [security] tag", () => {
    expect(
      renovateMergeSupersedes({
        merged: merged({ title: "chore(deps): update dependency @AI-SDK/openai to v3.0.124 [security]" }),
        own: own(),
      }),
    ).toBe(true);
  });

  it("closes a caret range Renovate merged at the same floor", () => {
    expect(
      renovateMergeSupersedes({
        merged: merged({ title: "fix(deps): update dependency @knocklabs/react to ^0.13.0" }),
        own: own({ title: "fix(deps): update dependency @knocklabs/react to ^0.13.0" }),
      }),
    ).toBe(true);
  });

  it("closes a group with no target only on an identical title", () => {
    const group = own({ title: "chore(deps): update github actions" });
    expect(
      renovateMergeSupersedes({ merged: merged({ title: "chore(deps): update  GitHub Actions" }), own: group }),
    ).toBe(true);
    expect(
      renovateMergeSupersedes({ merged: merged({ title: "chore(deps): update github actions (major)" }), own: group }),
    ).toBe(false);
  });

  it("falls back to the identical title when one side's target is a digest", () => {
    expect(
      renovateMergeSupersedes({
        merged: merged({ title: "chore(deps): update dependency @ai-sdk/openai to a1b2c3d" }),
        own: own(),
      }),
    ).toBe(false);
  });

  it("never matches a title Renovate did not word", () => {
    expect(
      renovateMergeSupersedes({ merged: merged(), own: own({ title: "[SUP-9005] fix(security): re-resolve joi" }) }),
    ).toBe(false);
  });
});

describe("mergeEffect", () => {
  it("answers no-diff when the current test merge has the base tip's own tree", () => {
    expect(mergeEffect({ headOid: HEAD, reading: changing({ mergeTreeOid: BASE_TREE }) })).toEqual({
      baseOid: BASE_TIP,
      kind: "no-diff",
    });
  });

  it("accepts the parents in either order", () => {
    expect(
      mergeEffect({ headOid: HEAD, reading: changing({ mergeTreeOid: BASE_TREE, parentOids: [HEAD, BASE_TIP] }) }),
    ).toEqual({ baseOid: BASE_TIP, kind: "no-diff" });
  });

  it("answers changes when the trees differ", () => {
    expect(mergeEffect({ headOid: HEAD, reading: changing() })).toEqual({ kind: "changes" });
  });

  it("is unanswerable for a conflicting pull request", () => {
    expect(mergeEffect({ headOid: HEAD, reading: changing({ mergeable: "CONFLICTING" }) })).toEqual({
      kind: "unanswerable",
      why: "GitHub reads it conflicting",
    });
  });

  it("is unanswerable when the test merge was of an older head", () => {
    expect(
      mergeEffect({
        headOid: HEAD,
        reading: changing({ mergeTreeOid: BASE_TREE, parentOids: [BASE_TIP, "o".repeat(40)] }),
      }),
    ).toEqual({
      kind: "unanswerable",
      why: "GitHub's test merge is not of the current head into the current base tip",
    });
  });

  it("is unanswerable when the test merge was into an older base tip", () => {
    expect(
      mergeEffect({ headOid: HEAD, reading: changing({ mergeTreeOid: BASE_TREE, parentOids: ["o".repeat(40), HEAD] }) })
        .kind,
    ).toBe("unanswerable");
  });

  it("is unanswerable for a test merge with three parents or a repeated one", () => {
    expect(
      mergeEffect({
        headOid: HEAD,
        reading: changing({ mergeTreeOid: BASE_TREE, parentOids: [BASE_TIP, HEAD, "o".repeat(40)] }),
      }).kind,
    ).toBe("unanswerable");
    expect(
      mergeEffect({ headOid: HEAD, reading: changing({ mergeTreeOid: BASE_TREE, parentOids: [HEAD, HEAD] }) }).kind,
    ).toBe("unanswerable");
  });

  it("is unanswerable with no test merge commit or no base tip", () => {
    expect(mergeEffect({ headOid: HEAD, reading: changing({ mergeTreeOid: undefined }) })).toEqual({
      kind: "unanswerable",
      why: "GitHub gave no test merge commit or no base tip",
    });
    expect(mergeEffect({ headOid: HEAD, reading: changing({ baseTipTreeOid: undefined }) }).kind).toBe("unanswerable");
  });
});

describe("supersedeEvidence", () => {
  it("names the Renovate merge", () => {
    expect(supersedeEvidence({ merged: [merged()], own: own() })).toEqual({ by: merged(), kind: "renovate-merged" });
  });

  it("names the LATEST of several matching merges", () => {
    const later = merged({ mergedAtIso: "2026-10-07T00:00:00Z", number: 16800 });
    expect(supersedeEvidence({ merged: [merged(), later], own: own() })).toEqual({
      by: later,
      kind: "renovate-merged",
    });
  });

  it("prefers the Renovate merge over no-diff when both hold", () => {
    const evidence = supersedeEvidence({
      merged: [merged()],
      own: own({ testMerge: changing({ mergeTreeOid: BASE_TREE }) }),
    });
    expect(evidence!.kind).toBe("renovate-merged");
  });

  it("answers no-diff for a security bump whose merge changes nothing", () => {
    const security = own({
      testMerge: changing({ mergeTreeOid: BASE_TREE }),
      title: "[SUP-9005] fix(security): re-resolve joi to 17.13.8",
    });
    expect(supersedeEvidence({ merged: [], own: security })).toEqual({ baseOid: BASE_TIP, kind: "no-diff" });
  });

  it("answers nothing for a bump still carrying a change", () => {
    expect(supersedeEvidence({ merged: [], own: own() })).toBe(undefined);
  });

  it("never closes a pull request that is not a bump, even one whose merge changes nothing", () => {
    const feature = own({ testMerge: changing({ mergeTreeOid: BASE_TREE }), title: "feat(JJJJ-1715): a change" });
    expect(supersedeEvidence({ merged: [merged()], own: feature })).toBe(undefined);
  });
});

describe("supersedeComment", () => {
  it("names the Renovate merge, its base and its instant", () => {
    expect(supersedeComment({ evidence: { by: merged(), kind: "renovate-merged" }, own: own() })).toBe(
      "Superseded by #16761 (chore(deps): update dependency @ai-sdk/openai to v3.0.124), which Renovate merged into " +
        "`staging` at 2026-10-06T02:04:26Z, so `staging` already carries this bump. Closed by the bump drive; reopen " +
        "it if this is wrong.",
    );
  });

  it("names the head and base tip a no-diff close was judged at", () => {
    expect(supersedeComment({ evidence: { baseOid: BASE_TIP, kind: "no-diff" }, own: own() })).toBe(
      "Merging this into `staging` would change nothing: GitHub's test merge of hhhhhhh into `staging` at bbbbbbb " +
        "has exactly that tip's tree, so the bump is already there. Closed by the bump drive; reopen it if this is wrong.",
    );
  });
});

describe("changesOnlyDependencies", () => {
  it("reads manifests, lockfiles and package-manager config at any depth as dependency files", () => {
    expect(
      changesOnlyDependencies({
        changedPaths: ["package.json", "packages/backend/package.json", "yarn.lock", ".yarnrc.yml"],
      }),
    ).toBe(true);
  });

  it("refuses a change carrying any other file", () => {
    expect(changesOnlyDependencies({ changedPaths: ["yarn.lock", "docs/dependencies.md"] })).toBe(false);
  });

  it("never reads a lookalike name as a manifest", () => {
    expect(changesOnlyDependencies({ changedPaths: ["src/package.json.ts"] })).toBe(false);
  });

  it("refuses a change too long to have been read whole", () => {
    expect(changesOnlyDependencies({ changedPaths: "past-one-page" })).toBe(false);
  });

  it("reads an empty change as carrying nothing", () => {
    expect(changesOnlyDependencies({ changedPaths: [] })).toBe(true);
  });
});

describe("supersedeEvidence's no-diff arm rests on the files, not the title", () => {
  const empty = changing({ mergeTreeOid: BASE_TREE });

  it("closes nothing on an empty merge of a bump-worded pull request that changes a document", () => {
    const docs = own({
      changedPaths: ["docs/dependencies.md"],
      testMerge: empty,
      title: "fix(security): update dependency documentation to 2 pages",
    });
    expect(supersedeEvidence({ merged: [], own: docs })).toBe(undefined);
  });

  it("never closes on a Renovate merge a bump of the owner's that also carries code, since that merge did not", () => {
    const withCode = own({ changedPaths: ["yarn.lock", "src/hooks/useKnockSteps.ts"] });
    expect(supersedeEvidence({ merged: [merged()], own: withCode })).toBe(undefined);
  });

  it("closes an empty merge of a bump that changes only its lockfile", () => {
    expect(supersedeEvidence({ merged: [], own: own({ testMerge: empty }) })).toEqual({
      baseOid: BASE_TIP,
      kind: "no-diff",
    });
  });
});

describe("recheckSupersede", () => {
  const byRenovate = { by: merged(), kind: "renovate-merged" } as const;
  const empty = changing({ mergeTreeOid: BASE_TREE });

  it("still stands when the same Renovate merge supersedes the same head", () => {
    expect(recheckSupersede({ evidence: byRenovate, fresh: own(), planned: own() })).toEqual({
      evidence: byRenovate,
      kind: "still",
    });
  });

  it("refuses a moved head on either arm, since the owner may have pushed more than the bump", () => {
    const moved = own({ headOid: "9".repeat(40) });
    expect(recheckSupersede({ evidence: byRenovate, fresh: moved, planned: own() })).toEqual({
      kind: "moved",
      why: "its head moved since the pass read it",
    });
  });

  it("refuses a no-diff close whose base moved so the merge would change something again", () => {
    const planned = own({ testMerge: empty });
    const evidence = supersedeEvidence({ merged: [], own: planned })!;
    expect(recheckSupersede({ evidence, fresh: own(), planned })).toEqual({
      kind: "moved",
      why: "the evidence no longer holds on a fresh read",
    });
  });

  it("carries the fresh base into a no-diff close that still holds after the base moved", () => {
    const planned = own({ testMerge: empty });
    const evidence = supersedeEvidence({ merged: [], own: planned })!;
    const newTip = "c".repeat(40);
    const fresh = own({
      testMerge: changing({ baseTipOid: newTip, mergeTreeOid: BASE_TREE, parentOids: [newTip, HEAD] }),
    });
    const verdict = recheckSupersede({ evidence, fresh, planned });
    expect(verdict).toEqual({ evidence: supersedeEvidence({ merged: [], own: fresh }), kind: "still" });
  });

  it("refuses a re-read that answered about another pull request", () => {
    const other = own({ number: 999, url: "https://github.com/acme/acme-admin/pull/999" });
    expect(recheckSupersede({ evidence: byRenovate, fresh: other, planned: own() })).toEqual({
      kind: "moved",
      why: "the re-read answered about another pull request, https://github.com/acme/acme-admin/pull/999",
    });
  });

  it("refuses a pull request no longer open", () => {
    expect(recheckSupersede({ evidence: byRenovate, fresh: undefined, planned: own() })).toEqual({
      kind: "moved",
      why: "it is no longer open",
    });
  });
});
