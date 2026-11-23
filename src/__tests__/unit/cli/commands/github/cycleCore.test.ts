import { describe, expect, it } from "vitest";

import {
  cycleDoorRequest,
  cycleStateRefusal,
  mergeMovedSinceJudged,
  mergeRefFreshness,
  parseGithubCycleArgs,
} from "../../../../../cli/commands/github/cycleCore.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";
import type { CyclePr } from "../../../../../outbound/github/cycle.js";

const BASE_TIP = "a8a47c9aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const OLD_BASE = "0ae199dbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const HEAD = "f362faffcccccccccccccccccccccccccccccccc";
const MERGE = "22f1fc39dddddddddddddddddddddddddddddddd";

/** An open, mergeable pull request whose merge ref GitHub has computed, varying only what a case cares about. */
function pr(over: Partial<CyclePr> = {}): CyclePr {
  return {
    autoMerge: false,
    baseRef: "staging",
    headRepoFullName: "acme/acme-admin",
    headSha: HEAD,
    inMergeQueue: false,
    mergeCommitSha: MERGE,
    mergeable: true,
    mergedAtIso: undefined,
    number: 9876,
    stacked: false,
    state: "open",
    url: "https://github.com/acme/acme-admin/pull/9876",
    ...over,
  };
}

describe("parseGithubCycleArgs", () => {
  it("resolves the repository, number and modes", () => {
    const parsed = parseGithubCycleArgs({
      rest: ["--repo", "acme/acme-admin", "--number", "9876", "--dry-run", "--prime", "--home", "/h"],
    });
    expect(unwrap(parsed)).toEqual({
      dryRun: true,
      home: "/h",
      json: false,
      number: 9876,
      owner: "acme",
      prime: true,
      repo: "acme-admin",
    });
  });

  it("collects every usage problem at once", () => {
    expect(unwrapErr(parseGithubCycleArgs({ rest: ["--number", "0"] }))).toEqual([
      "--repo owner/name is required",
      "--number must be a positive whole number",
    ]);
  });

  it("refuses a missing or non-decimal number", () => {
    expect(unwrapErr(parseGithubCycleArgs({ rest: ["--repo", "o/r"] }))).toEqual([
      "--number must be a positive whole number",
    ]);
    expect(unwrapErr(parseGithubCycleArgs({ rest: ["--repo", "o/r", "--number", "1e3"] }))).toEqual([
      "--number must be a positive whole number",
    ]);
  });
});

describe("cycleStateRefusal", () => {
  it("lets an open, mergeable pull request through", () => {
    expect(cycleStateRefusal({ pr: pr() })).toBeUndefined();
  });

  it("lets one GitHub is still computing through, since the freshness verdict owns that", () => {
    expect(cycleStateRefusal({ pr: pr({ mergeable: null }) })).toBeUndefined();
  });

  it("names each state a close-and-reopen must not touch", () => {
    expect(
      [
        pr({ mergedAtIso: "2026-10-02T04:00:00Z", state: "closed" }),
        pr({ state: "closed" }),
        pr({ headRepoFullName: undefined }),
        pr({ autoMerge: true }),
        pr({ inMergeQueue: true }),
        pr({ stacked: true }),
        pr({ mergeable: false }),
      ].map((each) => cycleStateRefusal({ pr: each })),
    ).toEqual([
      "#9876 was merged at 2026-10-02T04:00:00Z — there is nothing to re-run CI on",
      "#9876 is closed; this verb cycles an OPEN pull request and never reopens a closed one",
      "#9876's head repository is gone, so a reopen would fail and leave it closed",
      "#9876 has auto-merge enabled, and closing it would switch that off; disable it first if a cycle is still wanted",
      "#9876 is in the merge queue, and closing it would drop it out; dequeue it first if a cycle is still wanted",
      "#9876 is in a native GitHub stack, and closing a stack member has effects this verb does not model",
      "#9876 conflicts with staging, so there is no merge commit for CI to run on; rebase it first",
    ]);
  });
});

describe("mergeRefFreshness", () => {
  it("is fresh when the ref is the named merge of the current head onto the live base tip", () => {
    expect(mergeRefFreshness({ baseTip: BASE_TIP, mergeRef: MERGE, parents: [BASE_TIP, HEAD], pr: pr() })).toEqual({
      mergeSha: MERGE,
      verdict: "fresh",
    });
  });

  it("is SETTLED on the measured acme-admin shape: a finished merge onto the base the branch has left", () => {
    expect(mergeRefFreshness({ baseTip: BASE_TIP, mergeRef: MERGE, parents: [OLD_BASE, HEAD], pr: pr() })).toEqual({
      mergeSha: MERGE,
      reason: "22f1fc39dddd merges onto 0ae199dbbbbb, but staging is now at a8a47c9aaaaa",
      verdict: "settled",
    });
  });

  it("is computing while GitHub has not finished, whatever the ref says", () => {
    expect(
      mergeRefFreshness({ baseTip: BASE_TIP, mergeRef: MERGE, parents: [OLD_BASE, HEAD], pr: pr({ mergeable: null }) }),
    ).toEqual({ reason: "GitHub has not finished computing the test merge (mergeable is null)", verdict: "computing" });
  });

  it("is computing when there is no merge ref", () => {
    expect(mergeRefFreshness({ baseTip: BASE_TIP, mergeRef: undefined, parents: undefined, pr: pr() })).toEqual({
      reason: "refs/pull/9876/merge does not exist yet",
      verdict: "computing",
    });
  });

  it("is computing when the ref and the pull request name different merge commits", () => {
    expect(
      mergeRefFreshness({
        baseTip: BASE_TIP,
        mergeRef: MERGE,
        parents: [BASE_TIP, HEAD],
        pr: pr({ mergeCommitSha: null }),
      }),
    ).toEqual({ reason: "refs/pull/9876/merge is 22f1fc39dddd but the pull request names none", verdict: "computing" });
  });

  it("is computing when the merge carries an old head, even onto an old base, since a push starts a recompute", () => {
    expect(mergeRefFreshness({ baseTip: BASE_TIP, mergeRef: MERGE, parents: [OLD_BASE, OLD_BASE], pr: pr() })).toEqual({
      reason: "22f1fc39dddd merges head 0ae199dbbbbb, but the head is now f362faffcccc",
      verdict: "computing",
    });
  });

  it("is not fresh when the parents are swapped, since order is what says which side is the base", () => {
    expect(mergeRefFreshness({ baseTip: BASE_TIP, mergeRef: MERGE, parents: [HEAD, BASE_TIP], pr: pr() }).verdict).toBe(
      "computing",
    );
  });

  it("is settled when the ref names a commit that is not a two-parent merge", () => {
    expect(mergeRefFreshness({ baseTip: BASE_TIP, mergeRef: MERGE, parents: [BASE_TIP], pr: pr() })).toEqual({
      mergeSha: MERGE,
      reason: "22f1fc39dddd has 1 parent(s), not a test merge's two",
      verdict: "settled",
    });
  });
});

describe("mergeMovedSinceJudged", () => {
  it("passes a pull request still carrying the judged head, base and merge", () => {
    expect(mergeMovedSinceJudged({ judged: pr(), latest: pr() })).toBe(undefined);
  });

  it("names each move: a recompute, a head push, a retarget, a new merge commit", () => {
    const judged = pr();
    expect([
      mergeMovedSinceJudged({ judged, latest: pr({ mergeable: null }) }),
      mergeMovedSinceJudged({ judged, latest: pr({ headSha: "9999999eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee" }) }),
      mergeMovedSinceJudged({ judged, latest: pr({ baseRef: "main" }) }),
      mergeMovedSinceJudged({ judged, latest: pr({ mergeCommitSha: null }) }),
    ]).toEqual([
      "GitHub is computing the test merge again (mergeable is null)",
      "the head moved from f362faffcccc to 9999999eeeee",
      "the base was retargeted from staging to main",
      "the pull request's merge commit moved from 22f1fc39dddd to none",
    ]);
  });
});

describe("cycleDoorRequest", () => {
  it("names the verb and the one pull request as an external write", () => {
    const args = unwrap(parseGithubCycleArgs({ rest: ["--repo", "o/r", "--number", "7"] }));
    expect(cycleDoorRequest({ args, home: "/h" })).toEqual({
      action: { kind: "verb", noun: "github", verb: "cycle" },
      artifact: { id: "o/r#7" },
      meta: { createsWorkItem: false, effect: "external-write", home: "/h", requiresApproval: false },
    });
  });
});
