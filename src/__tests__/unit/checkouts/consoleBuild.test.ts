import { describe, expect, it } from "vitest";

import {
  CLAIM_FETCHED,
  CLAIM_SKIPPED,
  carriesPort,
  claimBucketOf,
  consoleRecordKey,
  FETCH_EVERY_MS,
  fetchClaims,
  fetchClaimsDirName,
  fetchDue,
  fetchedStampName,
  isRefreshRound,
  LOG_FIELD,
  parseConsoleRunRecord,
  parseHeldBuild,
  parseMainline,
  parseUpstreamSource,
  previousClaimHolds,
  repositoryUrlOf,
  servedOf,
  titleAndPullRequest,
} from "../../../checkouts/consoleBuild.js";

const SHA_A = "a".repeat(40);
const SHA_B = "b".repeat(40);
const SHA_C = "c".repeat(40);
const REPO = "https://github.com/lachiejames/slopweaver";

/** One `git log --format=%H%x1f%cI%x1f%s` line. */
const logLine = ({ sha, subject }: { sha: string; subject: string }): string =>
  [sha, "2026-09-28T06:00:00+00:00", subject].join(LOG_FIELD);

describe("consoleRecordKey", () => {
  it("names the record exactly as scripts/docs-site.sh does", () => {
    // The witness is the script's own derivation, run outside this code: printf '%s' "$root" | shasum | cut -c1-8
    expect(consoleRecordKey({ root: "/Users/ada.owner/dev/personal/slopweaver" })).toBe("slopweaver-e28fe0b6");
  });
});

describe("fetchClaimsDirName", () => {
  it("keeps apart two checkouts whose run-record keys collide", () => {
    // A colliding pair: both map to the run record key `tree-90e3e204`.
    const one = "/tmp/r3-parent-19061/tree";
    const two = "/tmp/r3-parent-108943/tree";
    expect(consoleRecordKey({ root: one })).toBe(consoleRecordKey({ root: two }));
    expect(fetchClaimsDirName({ root: one })).not.toBe(fetchClaimsDirName({ root: two }));
    expect(fetchClaimsDirName({ root: one })).toMatch(/^tree-[0-9a-f]{40}\.fetch-claims$/u);
  });
});

describe("parseUpstreamSource", () => {
  it("takes the remote from git's config, so a slash in it never moves into the branch", () => {
    expect(
      parseUpstreamSource({ text: "refs/remotes/corp/team/main\tcorp/team/main\tcorp/team\trefs/heads/main" }),
    ).toEqual({
      fetch: { refspec: "+refs/heads/main:refs/remotes/corp/team/main", remote: "corp/team" },
      ref: "corp/team/main",
      trackingRef: "refs/remotes/corp/team/main",
    });
  });

  it("fetches nothing for a local upstream, whether git's trim kept its trailing fields or not", () => {
    const local = { fetch: undefined, ref: "trunk", trackingRef: "refs/heads/trunk" };
    expect(parseUpstreamSource({ text: "refs/heads/trunk\ttrunk\t.\trefs/heads/trunk" })).toEqual(local);
    expect(parseUpstreamSource({ text: "refs/heads/trunk\ttrunk" })).toEqual(local);
  });

  it("reads no upstream from an empty answer, or from two branches' lines", () => {
    expect(parseUpstreamSource({ text: "" })).toBe(undefined);
    expect(parseUpstreamSource({ text: "a\tb\tc\td\ne\tf\tg\th" })).toBe(undefined);
  });
});

describe("fetchedStampName", () => {
  it("gives two upstreams differing only in case two names no filesystem folds together", () => {
    const upper = fetchedStampName({ refspec: "+refs/heads/Main:refs/remotes/origin/Main", remote: "origin" });
    const lower = fetchedStampName({ refspec: "+refs/heads/main:refs/remotes/origin/main", remote: "origin" });
    expect(upper.toLowerCase()).toBe(upper);
    expect(lower.toLowerCase()).toBe(lower);
    expect(upper).not.toBe(lower);
    expect(lower).toMatch(/^fetched\.[0-9a-f]{40}$/u);
  });

  it("gives one tracking ref filled from two remotes two stamps", () => {
    const refspec = "+refs/heads/main:refs/remotes/origin/main";
    expect(fetchedStampName({ refspec, remote: "origin" })).not.toBe(fetchedStampName({ refspec, remote: "fork" }));
  });
});

describe("parseConsoleRunRecord", () => {
  const production = {
    mode: "production",
    pid: 90533,
    port: 3000,
    sha: SHA_A,
    slot: ".next-serve-a",
    startedIso: "2026-09-28T06:54:34Z",
    worktree: "/work/slopweaver",
  };

  it("reads a production record with its sha and slot", () => {
    expect(parseConsoleRunRecord({ text: JSON.stringify(production) })).toEqual({
      pid: 90533,
      port: 3000,
      production: { sha: SHA_A, slot: ".next-serve-a" },
      startedIso: "2026-09-28T06:54:34Z",
      worktree: "/work/slopweaver",
    });
  });

  it("reads a record with no mode as a dev server", () => {
    const { mode: _mode, sha: _sha, slot: _slot, ...dev } = production;
    expect(parseConsoleRunRecord({ text: JSON.stringify(dev) })!.production).toBe(undefined);
  });

  it("refuses a production record missing its sha", () => {
    const { sha: _sha, ...noSha } = production;
    expect(parseConsoleRunRecord({ text: JSON.stringify(noSha) })).toBe(undefined);
  });

  it("refuses text that is not JSON", () => {
    expect(parseConsoleRunRecord({ text: "{" })).toBe(undefined);
  });
});

describe("servedOf", () => {
  it("says none when there is no record", () => {
    expect(servedOf({ live: false, record: undefined })).toEqual({ kind: "none" });
  });

  it("carries a production record's sha and liveness", () => {
    const record = {
      pid: 1,
      port: 3000,
      production: { sha: SHA_A, slot: ".next-serve-b" },
      startedIso: "2026-09-28T06:54:34Z",
      worktree: "/w",
    };
    expect(servedOf({ live: true, record })).toEqual({
      kind: "production",
      live: true,
      port: 3000,
      sha: SHA_A,
      slot: ".next-serve-b",
      startedIso: "2026-09-28T06:54:34Z",
    });
  });
});

describe("parseHeldBuild", () => {
  it("reads waiting.json as the refresh round writes it", () => {
    const text = JSON.stringify({ pid: 42, sha: SHA_B, sinceIso: "2026-09-28T07:00:00Z" });
    expect(parseHeldBuild({ text })).toEqual({ pid: 42, sha: SHA_B, sinceIso: "2026-09-28T07:00:00Z" });
  });

  it("refuses a non-positive pid", () => {
    const text = JSON.stringify({ pid: 0, sha: SHA_B, sinceIso: "2026-09-28T07:00:00Z" });
    expect(parseHeldBuild({ text })).toBe(undefined);
  });
});

describe("repositoryUrlOf", () => {
  it("reads an https remote with .git", () => {
    expect(repositoryUrlOf({ remote: "https://github.com/lachiejames/slopweaver.git\n" })).toBe(REPO);
  });

  it("reads an ssh remote", () => {
    expect(repositoryUrlOf({ remote: "git@github.com:lachiejames/slopweaver.git" })).toBe(REPO);
  });

  it("says nothing for a remote that is not GitHub", () => {
    expect(repositoryUrlOf({ remote: "https://gitlab.com/a/b.git" })).toBe(undefined);
  });
});

describe("titleAndPullRequest", () => {
  it("splits a squash subject into its title and pull request", () => {
    expect(titleAndPullRequest({ repositoryUrl: REPO, subject: "A chip shows its title (#1476)" })).toEqual({
      pullRequest: { number: 1476, url: `${REPO}/pull/1476` },
      title: "A chip shows its title",
    });
  });

  it("keeps the number without a link when the remote is not GitHub", () => {
    expect(titleAndPullRequest({ repositoryUrl: undefined, subject: "x (#9)" }).pullRequest).toEqual({
      number: 9,
      url: undefined,
    });
  });

  it("leaves a subject with no trailing number whole", () => {
    expect(titleAndPullRequest({ repositoryUrl: REPO, subject: "Merge (#12) into main" })).toEqual({
      pullRequest: undefined,
      title: "Merge (#12) into main",
    });
  });
});

describe("parseMainline", () => {
  const text = [
    logLine({ sha: SHA_A, subject: "newest (#3)" }),
    logLine({ sha: SHA_B, subject: "middle (#2)" }),
    logLine({ sha: SHA_C, subject: "oldest" }),
    "",
  ].join("\n");

  it("keeps every commit newest first when the log fits the limit", () => {
    const mainline = parseMainline({ limit: 3, repositoryUrl: REPO, text })!;
    expect(mainline.truncated).toBe(false);
    expect(mainline.commits.map((commit) => commit.sha)).toEqual([SHA_A, SHA_B, SHA_C]);
  });

  it("cuts to the limit and says older commits exist", () => {
    const mainline = parseMainline({ limit: 2, repositoryUrl: REPO, text })!;
    expect(mainline.truncated).toBe(true);
    expect(mainline.commits.map((commit) => commit.title)).toEqual(["newest", "middle"]);
  });

  it("refuses a line that is not a commit", () => {
    expect(parseMainline({ limit: 3, repositoryUrl: REPO, text: "not a log line" })).toBe(undefined);
  });

  it("reads an empty log as no commits", () => {
    expect(parseMainline({ limit: 3, repositoryUrl: REPO, text: "" })).toEqual({ commits: [], truncated: false });
  });

  it("leaves whether each commit changes the desktop app, or the console, unread", () => {
    const mainline = parseMainline({ limit: 3, repositoryUrl: REPO, text })!;
    expect(mainline.commits.map((commit) => commit.changesShell)).toEqual([undefined, undefined, undefined]);
    expect(mainline.commits.map((commit) => commit.changesConsole)).toEqual([undefined, undefined, undefined]);
  });
});

describe("fetchDue", () => {
  it("fetches when the checkout never has", () => {
    expect(fetchDue({ fetchedAtMs: undefined, nowMs: 1_000 })).toBe(true);
  });

  it("holds inside the interval", () => {
    expect(fetchDue({ fetchedAtMs: 1_000, nowMs: 1_000 + FETCH_EVERY_MS - 1 })).toBe(false);
  });

  it("fetches when the last fetch is dated after now, as a clock set back leaves it", () => {
    expect(fetchDue({ fetchedAtMs: 10_000, nowMs: 5_000 })).toBe(true);
  });

  it("fetches once the interval has passed", () => {
    expect(fetchDue({ fetchedAtMs: 1_000, nowMs: 1_000 + FETCH_EVERY_MS })).toBe(true);
  });
});

describe("fetchClaims", () => {
  it("claims this minute, respects the last one and keeps ten minutes of claims", () => {
    expect(fetchClaims({ nowMs: 20 * FETCH_EVERY_MS + 5 })).toEqual({
      previous: "19.claim",
      sweepBelow: 10,
      take: "20.claim",
    });
  });

  it("never sweeps the claim a reading stalled a whole minute still reads", () => {
    const stalled = fetchClaims({ nowMs: 20 * FETCH_EVERY_MS });
    const later = fetchClaims({ nowMs: 21 * FETCH_EVERY_MS });
    expect(claimBucketOf({ name: stalled.previous })! >= later.sweepBelow).toBe(true);
  });

  it("gives two readings in one minute the same claim, so only one can create it", () => {
    const first = fetchClaims({ nowMs: 10 * FETCH_EVERY_MS });
    const last = fetchClaims({ nowMs: 11 * FETCH_EVERY_MS - 1 });
    expect(last.take).toBe(first.take);
  });
});

describe("previousClaimHolds", () => {
  const nowMs = 100 * FETCH_EVERY_MS;

  it("holds off behind a fetch under a minute old", () => {
    expect(previousClaimHolds({ atMs: nowMs - FETCH_EVERY_MS + 5, nowMs, text: CLAIM_FETCHED })).toBe(true);
  });

  it("holds off behind a holder that has not written its decision yet", () => {
    expect(previousClaimHolds({ atMs: nowMs - 10, nowMs, text: "" })).toBe(true);
  });

  it("never holds off behind a claim that itself held off, so a failed fetch cannot chain", () => {
    expect(previousClaimHolds({ atMs: nowMs - 10, nowMs, text: CLAIM_SKIPPED })).toBe(false);
  });

  it("lets a fetch through once the previous one is a minute old", () => {
    expect(previousClaimHolds({ atMs: nowMs - FETCH_EVERY_MS, nowMs, text: CLAIM_FETCHED })).toBe(false);
  });

  it("lets a fetch through when there is no previous claim", () => {
    expect(previousClaimHolds({ atMs: undefined, nowMs, text: undefined })).toBe(false);
  });
});

describe("claimBucketOf", () => {
  it("reads a claim's bucket back from its name", () => {
    expect(claimBucketOf({ name: fetchClaims({ nowMs: 42 * FETCH_EVERY_MS }).take })).toBe(42);
  });

  it("says a file that is not a claim has no bucket, so a sweep leaves it", () => {
    expect(claimBucketOf({ name: "notes.txt" })).toBe(undefined);
  });
});

describe("carriesPort", () => {
  it("matches the server's own port flag", () => {
    expect(carriesPort({ args: "node next start --port 3000", port: 3000 })).toBe(true);
  });

  it("does not match a longer port that starts with the same digits", () => {
    expect(carriesPort({ args: "node next start --port 30001", port: 3000 })).toBe(false);
  });

  it("says a gone pid carries nothing", () => {
    expect(carriesPort({ args: undefined, port: 3000 })).toBe(false);
  });
});

describe("isRefreshRound", () => {
  it("recognises a round, as locked_round execs it", () => {
    expect(isRefreshRound({ args: "bash /work/slopweaver/scripts/docs-site.sh --refresh-round" })).toBe(true);
    expect(isRefreshRound({ args: "bash scripts/docs-site.sh --refresh-round" })).toBe(true);
  });

  it("refuses a recycled pid running something else", () => {
    expect(isRefreshRound({ args: "/usr/bin/vim" })).toBe(false);
  });

  it("refuses a recycled pid that only mentions the script", () => {
    expect(isRefreshRound({ args: "vim scripts/docs-site.sh" })).toBe(false);
    expect(isRefreshRound({ args: "bash scripts/docs-site.sh --serve" })).toBe(false);
    expect(isRefreshRound({ args: "node monitor.js /work/scripts/docs-site.sh --refresh-round" })).toBe(false);
    expect(isRefreshRound({ args: "/bin/bash /work/scripts/docs-site.sh --refresh-round" })).toBe(true);
  });
});
