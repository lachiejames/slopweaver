/**
 * The live reads behind a review ask's code-owner slice (`../../../review/codeOwnerSlice.ts`): the pull request's
 * facts, the base branch's tip commit, its whole file list against that commit with line counts, that commit's CODEOWNERS, its directory's
 * listing to prove it a plain file, and the lines GitHub reports an error on, then the facts and the base tip again so a pull request or base that moved under the read is refused rather than described.
 *
 * Every read reuses `../github/prReviewersReads.ts`, the same reads `github pr reviewers` derives its table from,
 * so a slice and that table can never disagree about which files a pull request changes.
 *
 * Every READ is counted, pages included, against the bound the caller hands in, and the reader refuses a read past
 * it: `session-start`'s verify pass promises a bound in live reads, and a slice charged as one read while it made
 * thirty would make that promise false. A read is one call through the door, counted exactly as the pass counts a
 * pull request's state check: a retry the shared GitHub client makes inside one read is that client's policy and
 * is not counted separately, there or here.
 */
import { err } from "#lib/result.js";

import { isRecord } from "../../../lib/parsers.js";
import { GithubLiveErrors } from "../../../live/github/errors.js";
import type { GithubReadRest } from "../../../live/github/read.js";
import { type CodeOwnerSlice, codeOwnerSlice } from "../../../review/codeOwnerSlice.js";
import { reviewErrorLines } from "../../../review/errors.js";
import type { PrReviewersFacts } from "../github/prReviewersCore.js";
import {
  COMPARE_FILES_MAX,
  changedFiles,
  codeownersAt,
  codeownersErrorLines,
  factsAt,
  movedSince,
  type PrAt,
} from "../github/prReviewersReads.js";

/** What one slice read established, and how many reads it spent either way. */
export type CodeOwnerSliceRead =
  | { readonly kind: "read"; readonly slice: CodeOwnerSlice; readonly reads: number }
  | { readonly kind: "notChecked"; readonly reason: string; readonly reads: number };

/**
 * The commit a branch points at now, so CODEOWNERS and its errors are read at ONE commit. Read by branch name, each
 * read could see a different commit, and a base pushed away and back between them would pass the facts re-read.
 *
 * @param branch the base branch
 * @returns the tip commit, or the reason it could not be read
 */
async function branchTipAt({ at, branch }: { at: PrAt; branch: string }): Promise<{ readonly sha: string } | string> {
  const read = await at.rest({
    params: { branch, owner: at.owner, repo: at.repo },
    route: "GET /repos/{owner}/{repo}/branches/{branch}",
  });
  if (read.isErr()) {
    return read.error.message;
  }
  const data = isRecord(read.value) ? read.value["data"] : undefined;
  const commit = isRecord(data) ? data["commit"] : undefined;
  const sha = isRecord(commit) ? commit["sha"] : undefined;
  return typeof sha === "string" && /^[0-9a-f]{40}$/.test(sha) ? { sha } : `${branch} did not read as a branch`;
}

/**
 * Whether the CODEOWNERS file is a plain file in its directory's own listing. The Contents API answers a symlink to
 * a file with the target's text at the requested path, so only the listing, which types each entry, tells a link
 * apart — and whether GitHub applies a linked CODEOWNERS is not documented.
 *
 * @param path the CODEOWNERS path that was read
 * @param ref the commit it was read at
 * @returns undefined for a plain file, or the reason it is not known to be one
 */
async function plainFileAt({ at, path, ref }: { at: PrAt; path: string; ref: string }): Promise<string | undefined> {
  const directory = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
  const read = await at.rest({
    params: { owner: at.owner, path: directory, ref, repo: at.repo },
    route: "GET /repos/{owner}/{repo}/contents/{path}",
  });
  if (read.isErr()) {
    return read.error.message;
  }
  const data = isRecord(read.value) ? read.value["data"] : undefined;
  const entry = Array.isArray(data) ? data.find((one) => isRecord(one) && one["path"] === path) : undefined;
  if (!isRecord(entry)) {
    return `${path} on ${ref} is not in its directory's listing`;
  }
  return entry["type"] === "file"
    ? undefined
    : `${path} on ${ref} is listed as a ${String(entry["type"])}, and whether GitHub applies a linked CODEOWNERS is unknown`;
}

/**
 * Read the owner's code-owner slice of one pull request.
 *
 * A repository with no CODEOWNERS is a slice (none of its files), never a failure. A file list GitHub could not
 * give whole, a line GitHub reports as an error deciding a changed file, an exhausted bound, or a pull request
 * that moved between the reads are each `notChecked` — never the "none of the files" line, which only a complete
 * read may print.
 *
 * @param repo the `owner/name` slug
 * @param number the pull request
 * @param viewerLogin the owner's GitHub login, without the `@`
 * @param maxReads the reads it may make before it refuses
 * @param rest the REST read seam
 * @returns the slice, or why there is none, with the reads spent
 */
export async function readCodeOwnerSlice({
  repo,
  number,
  viewerLogin,
  maxReads,
  rest,
}: {
  repo: string;
  number: number;
  viewerLogin: string;
  maxReads: number;
  rest: GithubReadRest;
}): Promise<CodeOwnerSliceRead> {
  const counter = countedRest({ maxReads, rest });
  const notChecked = ({ reason }: { reason: string }): CodeOwnerSliceRead => ({
    kind: "notChecked",
    reads: counter.reads(),
    reason,
  });
  const slug = repositorySlug({ repo });
  if (slug === undefined) {
    return notChecked({ reason: `${repo} is not an owner/name repository slug` });
  }
  const at = { number, owner: slug.owner, repo: slug.name, rest: counter.rest };
  const url = `https://github.com/${repo}/pull/${String(number)}`;

  const facts = await sliceableFactsAt({ at, url });
  if (typeof facts === "string") {
    return notChecked({ reason: facts });
  }
  const tip = await branchTipAt({ at, branch: facts.base });
  if (typeof tip === "string") {
    return notChecked({ reason: tip });
  }
  // The files are compared against the SAME tip commit CODEOWNERS is read at, never the base commit the pull request
  // reported: two commits, each re-checked on its own, could pair one base's files with another base's owners.
  const files = await changedFiles({ at, facts: { ...facts, baseSha: tip.sha } });
  if (typeof files === "string") {
    return notChecked({ reason: files });
  }
  const rules = await codeownersRulesAt({ at, ref: tip.sha });
  if (typeof rules === "string") {
    return notChecked({ reason: rules });
  }
  const slice = codeOwnerSlice({ ...rules, files, viewerLogin });
  if (slice.isErr()) {
    return notChecked({ reason: reviewErrorLines({ error: slice.error }).join("; ") });
  }
  if (movedSince({ first: facts, now: await factsAt({ at, url }) })) {
    return notChecked({ reason: `${url} moved, closed, or could not be re-read, while its files were read` });
  }
  // The pull request's own facts do not follow its base branch, so the tip is read again, last.
  const tipAgain = await branchTipAt({ at, branch: facts.base });
  if (typeof tipAgain === "string" || tipAgain.sha !== tip.sha) {
    return notChecked({ reason: `${facts.base} moved, or could not be re-read, while its CODEOWNERS was read` });
  }
  return { kind: "read", reads: counter.reads(), slice: slice.value };
}

/**
 * The pull request's facts, once it is proven open and small enough to list pinned to one commit.
 *
 * @param url the pull request's address, quoted in each reason
 * @returns the facts, or the reason a slice cannot be read
 */
async function sliceableFactsAt({ at, url }: { at: PrAt; url: string }): Promise<PrReviewersFacts | string> {
  const facts = await factsAt({ at, url });
  if (typeof facts === "string") {
    return facts;
  }
  if (!facts.open) {
    return `${url} is no longer open`;
  }
  // Past the compare's limit the file list is paged unpinned, and a head pushed away and back between pages would
  // pass the facts re-read with a list no commit ever had. `github pr reviewers` accepts that; a morning line need not.
  // AT the limit is refused too: a compare truncated to exactly that many files matches a stale count of that many,
  // so only a list shorter than the limit proves it was not cut.
  if (facts.changedFiles >= COMPARE_FILES_MAX) {
    return `${url} changes ${String(facts.changedFiles)} files, at or past the ${String(COMPARE_FILES_MAX)} GitHub lists pinned to one commit`;
  }
  return facts;
}

/**
 * A REST seam that counts every read and refuses one past the bound.
 *
 * @param maxReads the reads it may make before it refuses
 * @param rest the seam it counts
 * @returns the counted seam, and a reader of how many reads it has made
 */
function countedRest({ maxReads, rest }: { maxReads: number; rest: GithubReadRest }): {
  readonly rest: GithubReadRest;
  readonly reads: () => number;
} {
  let reads = 0;
  const counted: GithubReadRest = async (args) => {
    if (reads >= maxReads) {
      return err(
        GithubLiveErrors.readFailed({ message: `the live check's bound of reads ran out after ${String(reads)}` }),
      );
    }
    reads += 1;
    return rest(args);
  };
  return { reads: () => reads, rest: counted };
}

/**
 * Split an `owner/name` slug.
 *
 * @param repo the slug
 * @returns its two halves, or undefined when it is not exactly two non-empty segments
 */
function repositorySlug({ repo }: { repo: string }): { readonly owner: string; readonly name: string } | undefined {
  const [owner, name, ...beyond] = repo.split("/");
  const wellFormed = owner !== undefined && name !== undefined && owner !== "" && name !== "" && beyond.length === 0;
  return wellFormed ? { name, owner } : undefined;
}

/**
 * The base commit's CODEOWNERS text and the lines GitHub reports an error on, once the file is proven plain.
 *
 * @param ref the base branch's tip commit
 * @returns the text (empty when the repository has none) and its errored lines, or the reason they could not be read
 */
async function codeownersRulesAt({
  at,
  ref,
}: {
  at: PrAt;
  ref: string;
}): Promise<{ readonly codeowners: string; readonly erroredLines: readonly number[] } | string> {
  const codeowners = await codeownersAt({ at, ref });
  if (typeof codeowners === "string") {
    return codeowners;
  }
  // A 404 at all three paths is how the Contents API says there is no CODEOWNERS, so absence is taken from it. The
  // residue, stated: a 404 for a file that exists, on a token that has just read this repository's branch and
  // compare, would print "none of the files". Only listing all three directories could close it, at three more reads.
  if (codeowners === undefined) {
    return { codeowners: "", erroredLines: [] };
  }
  const linked = await plainFileAt({ at, path: codeowners.path, ref });
  if (linked !== undefined) {
    return linked;
  }
  const errored = await codeownersErrorLines({ at, path: codeowners.path, ref });
  return typeof errored === "string" ? errored : { codeowners: codeowners.text, erroredLines: errored };
}
