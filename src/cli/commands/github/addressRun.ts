/**
 * `update`'s address resolution and authorisation — split out of `run.ts` as its own cohesive phase.
 *
 * Every `update` sub-path (`--edit`/`--form`/`--file`, `--pull`, review-only) starts the same way: turn a
 * `--number` or `--base`/`--head` address into a live pull request, then settle whether this caller may act
 * on it. That is a distinct concern from what happens next — merging an edit, replacing wholesale, or just
 * reading the description into a file — so it lives here rather than inside `run.ts`'s create/update dispatch.
 */

import type { GithubWriteApi, WrittenPr } from "../../../corpus/github/write.js";
import { locusOf, readPrRecord } from "../../../outbound/github/prLedger.js";
import type { PrTarget } from "../../../outbound/github/types.js";
import { qualifiedHeadRef } from "./reservationAbsence.js";
import type { GithubPrDeps } from "./run.js";
import { selfReviewAuthorshipRefusal } from "./selfReviewCore.js";
import {
  ALLOW_FOREIGN_PR,
  authorisationFor,
  cachedCandidateUsable,
  type PrAddress,
  selectPrCandidate,
  updateHeadRefusal,
} from "./updateCore.js";

/**
 * Split an `owner/name` full name into its first two `/`-separated segments.
 *
 * GitHub always returns both halves for a pull request's repository, so a missing one is a broken payload
 * rather than something to default. The assertions say that out loud instead of coalescing to an empty string,
 * which would send a request to `/repos//` and fail somewhere less obvious. Only the first two segments are
 * checked: a third one (`owner/name/extra`) is not refused, and is dropped from the result.
 *
 * @param fullName the `owner/name` string GitHub returned
 * @returns the first two segments, as owner and repository
 */
export function ownerRepoOf({ fullName }: { fullName: string }): { owner: string; repo: string } {
  const parts = fullName.split("/");
  const owner = parts[0];
  const repo = parts[1];
  // A THROW rather than a non-null assertion, because an assertion is erased at runtime and asserts nothing —
  // the previous shape's own comment claimed it prevented a request to `/repos//` while actually sending one
  // to `/repos/<owner>/undefined`. GitHub always returns both halves, so reaching here means the payload is
  // broken and stopping loudly is the only honest response.
  if (owner === undefined || owner.length === 0 || repo === undefined || repo.length === 0) {
    throw new Error(`GitHub returned a repository full name that is not owner/name: ${JSON.stringify(fullName)}`);
  }
  return { owner, repo };
}

/**
 * The routing fields of a live pull request, as a form's target.
 *
 * @param pr the live pull request
 * @returns its target
 */
export function liveTargetFor({ pr }: { pr: WrittenPr }): PrTarget {
  const { owner, repo } = ownerRepoOf({ fullName: pr.baseRepoFullName });
  const sameRepo = pr.head.repoFullName?.toLowerCase() === pr.baseRepoFullName.toLowerCase();
  return { base: pr.baseRef, head: sameRepo ? pr.head.ref : pr.head.label, owner, repo };
}

/**
 * The locus a resolved pull request belongs under.
 *
 * Derived from the LIVE pull request rather than from the address, so a record written by a `--number` update
 * lands under the same key a branch-addressed one would. The head is the qualified label when the head
 * repository differs from the base, which is what keeps a fork's pull request from sharing a locus with a
 * same-named branch in the base repository.
 *
 * @param pr the live pull request
 * @returns its locus
 */
export function liveLocusFor({ pr }: { pr: WrittenPr }): string {
  return locusOf({ target: liveTargetFor({ pr }) });
}

/**
 * GitHub's `head` filter wants `owner:ref`, and a bare ref means the base repository's own branch.
 *
 * One spelling, in `./reservationAbsence.ts`, shared with the reservation's own absence check — the filter
 * IGNORES a bare ref rather than refusing it, so two copies that drifted would list a whole repository in
 * silence.
 */
function qualifiedHead({ address }: { address: Extract<PrAddress, { kind: "branch" }> }): string {
  return qualifiedHeadRef({ head: address.head, owner: address.owner });
}

/** The branch locus a branch address describes, for the ledger and the door artifact. */
function addressTarget({ address }: { address: Extract<PrAddress, { kind: "branch" }> }): PrTarget {
  return { base: address.base, head: address.head, owner: address.owner, repo: address.repo };
}

/** The ledger's hint for a branch address, used ONLY when it still names an open pull request with that shape. */
async function cachedCandidate({
  api,
  address,
  home,
}: {
  api: GithubWriteApi;
  address: Extract<PrAddress, { kind: "branch" }>;
  home: string;
}): Promise<WrittenPr | undefined> {
  const record = readPrRecord({ home, locus: locusOf({ target: addressTarget({ address }) }) });
  if (record?.number === undefined) {
    return undefined;
  }
  const live = await api.getPr({ number: record.number, owner: address.owner, repo: address.repo });
  if (live.isErr()) {
    return undefined;
  }
  return cachedCandidateUsable({ address, candidate: live.value }) ? live.value : undefined;
}

/**
 * Which pull request an address names.
 *
 * `--number` is a single GET and nothing else participates — no cache, no list — because a number identifies
 * a pull request outright.
 *
 * A branch pair is RESOLVED rather than trusted, and that is a change. The ledger's record for the locus is
 * still consulted as a hint, but it is only accepted when the pull request it names is still OPEN and still
 * has the requested topology. Otherwise GitHub is listed. The hole this closes: a record naming a MERGED pull
 * request on `main...feature` used to be accepted on topology alone, while a later hand-opened pull request
 * reusing the pair is the one the caller means — same author, so authorisation passes, and the write lands on
 * the closed one.
 *
 * @param api the write API
 * @param address the caller's address
 * @param home the state home, whose ledger supplies the branch-pair hint
 * @returns the resolved pull request, or a refusal reason
 */
async function resolveAddress({
  api,
  address,
  home,
}: {
  api: GithubWriteApi;
  address: PrAddress;
  home: string;
}): Promise<{ pr: WrittenPr } | { reason: string }> {
  if (address.kind === "number") {
    const live = await api.getPr({ number: address.number, owner: address.owner, repo: address.repo });
    if (live.isErr()) {
      return {
        reason: `could not read ${address.owner}/${address.repo}#${String(address.number)}: ${live.error.message}`,
      };
    }
    return { pr: live.value };
  }
  const hinted = await cachedCandidate({ address, api, home });
  if (hinted !== undefined) {
    return { pr: hinted };
  }
  const listed = await api.listPrs({
    base: address.base,
    head: qualifiedHead({ address }),
    owner: address.owner,
    repo: address.repo,
  });
  if (listed.isErr()) {
    return {
      reason: `could not list pull requests for ${locusOf({ target: addressTarget({ address }) })}: ${listed.error.message}`,
    };
  }
  const chosen = selectPrCandidate({ address, candidates: listed.value });
  return chosen.kind === "one" ? { pr: chosen.candidate } : { reason: chosen.reason };
}

/**
 * Resolve the address and settle whether this caller may edit the pull request it names.
 *
 * The identity read is the other half of the authorship comparison, and its FAILURE is carried rather than
 * swallowed: an installation token cannot answer `users.getAuthenticated`, and the decision fails closed on
 * that instead of treating "unknown" as either answer.
 *
 * @param address the caller's address
 * @param api the write API
 * @param deps the injectable edges, for the env override and the diagnostic line
 * @param home the state home
 * @param selfReviewRequested whether this call is only posting a self-review round, which checks strict
 *   authorship rather than the `ALLOW_FOREIGN_PR` override
 * @param expectHead the head the caller derived its edit at (`--expect-head`), refused when the live head differs
 * @returns the resolved, authorised pull request, or a refusal reason
 */
export async function resolveAndAuthorise({
  address,
  api,
  deps,
  home,
  selfReviewRequested,
  expectHead,
}: {
  address: PrAddress;
  api: GithubWriteApi;
  deps: GithubPrDeps;
  home: string;
  selfReviewRequested: boolean;
  expectHead?: string | undefined;
}): Promise<{ live: WrittenPr } | { reason: string }> {
  const resolved = await resolveAddress({ address, api, home });
  if ("reason" in resolved) {
    return resolved;
  }
  const headRefusal = updateHeadRefusal({ expectHead, headSha: resolved.pr.head.sha, number: resolved.pr.number });
  if (headRefusal !== undefined) {
    return { reason: headRefusal };
  }
  const identity = await api.authenticatedUserId();
  if (selfReviewRequested) {
    const refusal = selfReviewAuthorshipRefusal({
      authedUserId: identity.isOk() ? identity.value : undefined,
      prAuthorId: resolved.pr.authorId,
    });
    return refusal === undefined ? { live: resolved.pr } : { reason: refusal };
  }
  const authorised = authorisationFor({
    allowForeign: deps.env({ name: ALLOW_FOREIGN_PR }) === "1",
    authedUserId: identity.isOk() ? identity.value : undefined,
    prAuthorId: resolved.pr.authorId,
    purpose: "description-update",
  });
  if (authorised.kind === "refused") {
    return { reason: authorised.reason };
  }
  if (authorised.kind === "overridden") {
    deps.out({ line: authorised.notice });
  }
  return { live: resolved.pr };
}
