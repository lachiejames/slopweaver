/**
 * The git half of `github exposure inventory`: every ref, the pull refs a deleted branch leaves behind, every
 * commit reachable from them with its identities, and every blob in every commit's tree.
 *
 * ## A deleted branch's pull request still publishes its commits
 *
 * `refs/pull/<n>/head` outlives the branch it was opened from, so a commit pushed only to a branch since deleted
 * is still served once the repository is public. The pull refs are therefore read two ways: listed under
 * `refs/pull`, and probed one at a time for every pull request the listing did not return. A probe answering 404
 * is counted as "no head ref", never dropped.
 *
 * ## What reachable means here
 *
 * Commits are listed from every ref tip. An object no ref reaches (a force-pushed-over commit, say) can still sit in
 * GitHub's object store, and no API enumerates it, so that is stated as a limit on every count here rather than
 * claimed absent. A tip already reached by a COMPLETE listing from another tip is skipped: its ancestry was listed.
 */

import { isRecord } from "../../lib/parsers.js";
import { type GithubExposureSeam, listAll, listingGaps, stringAt, surfaceState } from "./exposureListing.js";
import type { GithubExposureSurfaceResult } from "./exposureModel.js";

/** The ref namespaces listed. A ref outside them is a gap the report names. */
const REF_PREFIXES = ["heads", "tags", "pull"] as const;

const UNREACHABLE_LIMIT = "an object no ref reaches is held by GitHub and enumerated by no API";

/** What the git half hands on to the rest of the inventory. */
export interface GithubExposureGitReading {
  readonly results: readonly GithubExposureSurfaceResult[];
  /** Every distinct commit read, for the per-commit status and check-run reads. */
  readonly commitShas: readonly string[];
  /** Why {@link commitShas} is not every reachable commit, or nothing when it is — a per-commit read inherits it. */
  readonly commitGaps: readonly string[];
}

/** One pull request, as much of it as the ref reads need. */
export interface GithubExposurePull {
  readonly number: number;
  readonly headBranch: string | undefined;
}

/** Whether an address is GitHub's own no-reply form rather than a real mailbox. */
function isNoReply({ email }: { email: string }): boolean {
  return email.endsWith("@users.noreply.github.com") || email === "noreply@github.com";
}

/** The refs under every listed namespace, by full name. */
async function readRefs({
  seam,
  owner,
  repo,
  maxPages,
}: {
  seam: GithubExposureSeam;
  owner: string;
  repo: string;
  maxPages: number;
}): Promise<{ refs: Map<string, { sha: string; type: string }>; gaps: string[] }> {
  const refs = new Map<string, { sha: string; type: string }>();
  const gaps: string[] = [];
  for (const prefix of REF_PREFIXES) {
    const listing = await listAll({ call: "matching-refs", maxPages, params: { owner, ref: prefix, repo }, seam });
    gaps.push(...listingGaps({ label: `refs/${prefix}`, listing }));
    for (const item of listing.items) {
      const name = stringAt({ path: ["ref"], value: item });
      const sha = stringAt({ path: ["object", "sha"], value: item });
      const type = stringAt({ path: ["object", "type"], value: item });
      if (name !== undefined && sha !== undefined && type !== undefined) {
        refs.set(name, { sha, type });
      }
    }
  }
  return { gaps, refs };
}

/** Probe each pull request whose head ref the listing did not return. */
async function probePullHeads({
  seam,
  owner,
  repo,
  pulls,
  refs,
}: {
  seam: GithubExposureSeam;
  owner: string;
  repo: string;
  pulls: readonly GithubExposurePull[];
  refs: Map<string, { sha: string; type: string }>;
}): Promise<{ missing: number; gaps: string[] }> {
  let missing = 0;
  const gaps: string[] = [];
  for (const pull of pulls) {
    const name = `refs/pull/${String(pull.number)}/head`;
    if (refs.has(name)) {
      continue;
    }
    const probe = await seam.get({ call: "git-ref", params: { owner, ref: `pull/${String(pull.number)}/head`, repo } });
    if (probe.isErr()) {
      if (probe.error.status === 404) {
        missing += 1;
      } else {
        gaps.push(`pull ${String(pull.number)} head ref: ${probe.error.message}`);
      }
      continue;
    }
    const sha = stringAt({ path: ["object", "sha"], value: probe.value });
    if (sha === undefined) {
      gaps.push(`pull ${String(pull.number)} head ref: the answer named no object`);
      continue;
    }
    refs.set(name, { sha, type: "commit" });
  }
  return { gaps, missing };
}

/** The ref counts by namespace, as one safe line. */
function refsDetail({ refs }: { refs: Map<string, { sha: string; type: string }> }): string {
  const names = [...refs.keys()];
  const heads = names.filter((name) => name.startsWith("refs/heads/")).length;
  const tags = names.filter((name) => name.startsWith("refs/tags/")).length;
  const pullHeads = names.filter((name) => name.startsWith("refs/pull/") && name.endsWith("/head")).length;
  const pullOther = names.filter((name) => name.startsWith("refs/pull/")).length - pullHeads;
  return `${String(heads)} branch(es), ${String(tags)} tag(s), ${String(pullHeads)} pull head(s), ${String(pullOther)} other pull ref(s)`;
}

/** One commit, as much as the identity and tree counts need. */
interface CommitFacts {
  readonly authorEmail: string | undefined;
  readonly committerEmail: string | undefined;
  readonly treeSha: string | undefined;
}

/** List every commit reachable from every tip, skipping a tip a complete listing already covered. */
async function readCommits({
  seam,
  owner,
  repo,
  tips,
  maxPages,
}: {
  seam: GithubExposureSeam;
  owner: string;
  repo: string;
  tips: readonly string[];
  maxPages: number;
}): Promise<{ commits: Map<string, CommitFacts>; gaps: string[] }> {
  const commits = new Map<string, CommitFacts>();
  const covered = new Set<string>();
  const gaps: string[] = [];
  for (const tip of tips) {
    if (covered.has(tip)) {
      continue;
    }
    const listing = await listAll({ call: "commits", maxPages, params: { owner, repo, sha: tip }, seam });
    gaps.push(...listingGaps({ label: `commits from a ref tip`, listing }));
    for (const item of listing.items) {
      const sha = stringAt({ path: ["sha"], value: item });
      if (sha === undefined) {
        continue;
      }
      commits.set(sha, {
        authorEmail: stringAt({ path: ["commit", "author", "email"], value: item }),
        committerEmail: stringAt({ path: ["commit", "committer", "email"], value: item }),
        treeSha: stringAt({ path: ["commit", "tree", "sha"], value: item }),
      });
      if (listing.outcome === "complete") {
        covered.add(sha);
      }
    }
  }
  return { commits, gaps };
}

/** The identity counts: distinct addresses only, never one of them. */
function identityResult({
  commits,
  gaps,
}: {
  commits: Map<string, CommitFacts>;
  gaps: readonly string[];
}): GithubExposureSurfaceResult {
  const authors = new Set<string>();
  const committers = new Set<string>();
  let realMailbox = 0;
  for (const facts of commits.values()) {
    if (facts.authorEmail !== undefined) {
      authors.add(facts.authorEmail);
    }
    if (facts.committerEmail !== undefined) {
      committers.add(facts.committerEmail);
    }
    const emails = [facts.authorEmail, facts.committerEmail].filter((email) => email !== undefined);
    if (emails.some((email) => !isNoReply({ email }))) {
      realMailbox += 1;
    }
  }
  return {
    state: surfaceState({
      count: new Set([...authors, ...committers]).size,
      detail: `${String(authors.size)} distinct author address(es), ${String(committers.size)} distinct committer address(es); ${String(realMailbox)} commit(s) carry an address that is not a GitHub no-reply`,
      gaps,
      limits: [UNREACHABLE_LIMIT],
    }),
    surface: "commit-identities",
  };
}

/** One root tree answer's blobs, or why it carried none it could be trusted for. */
function treeAnswerBlobs({ value }: { value: unknown }): { blobs: readonly string[]; gaps: readonly string[] } {
  const entries = isRecord(value) ? value["tree"] : undefined;
  if (!isRecord(value) || !Array.isArray(entries)) {
    return { blobs: [], gaps: ["a root tree answer carried no entry list"] };
  }
  const blobs = entries.flatMap((entry) => {
    const sha = stringAt({ path: ["sha"], value: entry });
    return sha !== undefined && stringAt({ path: ["type"], value: entry }) === "blob" ? [sha] : [];
  });
  return { blobs, gaps: value["truncated"] === true ? ["a root tree answer was truncated by GitHub"] : [] };
}

/** Every distinct blob in every distinct root tree, each tree read recursively and its truncation honoured. */
async function fileHistoryResult({
  seam,
  owner,
  repo,
  commits,
  commitGaps,
}: {
  seam: GithubExposureSeam;
  owner: string;
  repo: string;
  commits: Map<string, CommitFacts>;
  commitGaps: readonly string[];
}): Promise<GithubExposureSurfaceResult> {
  const trees = new Set([...commits.values()].flatMap((facts) => (facts.treeSha === undefined ? [] : [facts.treeSha])));
  const blobs = new Set<string>();
  const gaps: string[] = [...commitGaps];
  for (const treeSha of trees) {
    const read = await seam.get({ call: "git-tree", params: { owner, recursive: "1", repo, tree_sha: treeSha } });
    if (read.isErr()) {
      gaps.push(`a root tree read failed: ${read.error.message}`);
      continue;
    }
    const answer = treeAnswerBlobs({ value: read.value });
    gaps.push(...answer.gaps);
    for (const sha of answer.blobs) {
      blobs.add(sha);
    }
  }
  return {
    state: surfaceState({
      count: blobs.size,
      detail: `${String(blobs.size)} distinct file version(s) across ${String(trees.size)} root tree(s)`,
      gaps,
      limits: [UNREACHABLE_LIMIT],
    }),
    surface: "file-history",
  };
}

/**
 * Read the git half of the inventory.
 *
 * @param seam the read seam
 * @param owner the repository owner
 * @param repo the repository name
 * @param pulls every pull request, from the pull listing the caller already made
 * @param pullsComplete whether that listing was complete; an incomplete one leaves pull refs unprobed
 * @param maxPages the page ceiling per listing
 * @returns the git surfaces and every commit read
 */
export async function readGithubExposureGit({
  seam,
  owner,
  repo,
  pulls,
  pullsComplete,
  maxPages,
}: {
  seam: GithubExposureSeam;
  owner: string;
  repo: string;
  pulls: readonly GithubExposurePull[];
  pullsComplete: boolean;
  maxPages: number;
}): Promise<GithubExposureGitReading> {
  const listed = await readRefs({ maxPages, owner, repo, seam });
  const probed = await probePullHeads({ owner, pulls, refs: listed.refs, repo, seam });
  const refGaps = [...listed.gaps, ...probed.gaps, ...(pullsComplete ? [] : ["the pull listing was incomplete"])];
  const orphaned = orphanedPullRefs({ pulls, refs: listed.refs });
  const tips = refTips({ refs: listed.refs });
  const read = await readCommits({ maxPages, owner, repo, seam, tips });
  const commitGaps = [...refGaps, ...read.gaps];
  return {
    commitGaps,
    commitShas: [...read.commits.keys()],
    results: [
      {
        state: surfaceState({ count: listed.refs.size, detail: refsDetail({ refs: listed.refs }), gaps: refGaps }),
        surface: "refs",
      },
      {
        state: surfaceState({
          count: orphaned,
          detail: `${String(orphaned)} pull head ref(s) whose source branch is gone; ${String(probed.missing)} pull request(s) carry no head ref`,
          gaps: refGaps,
        }),
        surface: "pull-refs-of-deleted-branches",
      },
      {
        state: surfaceState({
          count: read.commits.size,
          detail: `${String(read.commits.size)} distinct commit(s) from ${String(tips.length)} ref tip(s)`,
          gaps: commitGaps,
          limits: [UNREACHABLE_LIMIT],
        }),
        surface: "commits",
      },
      identityResult({ commits: read.commits, gaps: commitGaps }),
      await fileHistoryResult({ commitGaps, commits: read.commits, owner, repo, seam }),
    ],
  };
}

/** How many pull head refs survive their source branch: published once public, and invisible on the branch list. */
function orphanedPullRefs({
  pulls,
  refs,
}: {
  pulls: readonly GithubExposurePull[];
  refs: ReadonlyMap<string, unknown>;
}): number {
  const branches = new Set([...refs.keys()].filter((name) => name.startsWith("refs/heads/")));
  return pulls.filter(
    (pull) =>
      refs.has(`refs/pull/${String(pull.number)}/head`) &&
      (pull.headBranch === undefined || !branches.has(`refs/heads/${pull.headBranch}`)),
  ).length;
}

/** Every distinct place a commit listing starts from: a tag by name (so an annotated one peels), else the sha. */
function refTips({ refs }: { refs: ReadonlyMap<string, { type: string; sha: string }> }): readonly string[] {
  return [
    ...new Set(
      [...refs.entries()].map(([name, target]) =>
        target.type === "tag" ? name.replace(/^refs\/tags\//u, "") : target.sha,
      ),
    ),
  ];
}
