/**
 * The update's bytes, once decided, sent: `unchanged` when they match the live pull request, else a reviewed PATCH
 * and its local confirmation — and the confirmation the create shares.
 *
 * Split out of `./performWrite.ts` along that seam: that module decides WHAT an update sends (the freshness re-read,
 * the render with any pasted media put back, the gates); this one owns how the decided bytes reach GitHub. The
 * create imports `confirmOrUnconfirmed` from here.
 */
import type { GithubWriteApi, WrittenPr } from "../../../corpus/github/write.js";
import type { DescriptionReviewComment } from "../../../outbound/github/descriptionReviewTypes.js";
import { confirmPr } from "../../../outbound/github/prLedger.js";
import type { PrForm } from "../../../outbound/github/types.js";
import { ownerRepoOf } from "./addressRun.js";
import type { PrOutcome } from "./core.js";
import type { GithubPrDeps } from "./prDeps.js";
import { writeWouldChangeNothing } from "./updateCore.js";

/**
 * Write the confirmation, and report UNCONFIRMED if even that fails.
 *
 * @param locus the branch locus, named in an unconfirmed outcome
 * @param pr the pull request the provider returned, whose stored body is the ledger's conflict signal
 * @param nowIso when the confirmation is recorded
 * @returns undefined once recorded, or the unconfirmed outcome
 */
export function confirmOrUnconfirmed({
  home,
  locus,
  form,
  pr,
  nowIso,
}: {
  home: string;
  locus: string;
  form: PrForm;
  pr: WrittenPr;
  nowIso: string;
}): PrOutcome | undefined {
  try {
    confirmPr({ form, home, locus, nodeId: pr.nodeId, nowIso, number: pr.number, storedBody: pr.body });
    return undefined;
  } catch (cause) {
    return {
      detail:
        `pull request #${String(pr.number)} WAS created at ${pr.htmlUrl}, but recording it locally failed ` +
        `(${cause instanceof Error ? cause.message : "unknown"}). Without that record, update cannot own it.`,
      kind: "unconfirmed",
      locus,
    };
  }
}

/**
 * The decided bytes sent: `unchanged` when they match the live pull request, else the reviewed PATCH.
 *
 * @param body the exact description to send, any pasted media and trailing region already in it
 * @param comments the walkthrough round posted after the write, which the same review must cover
 * @param current the pull request as re-read just before this write
 * @param form the accepted form, whose title is sent and whose copy the ledger keeps
 * @param home the state home whose ledger records the write
 * @param locus the branch locus, used only to label an unconfirmed outcome
 * @returns `unchanged`, `updated`, or the refusal or unconfirmed outcome
 */
export async function sendDecidedUpdate({
  api,
  body,
  comments,
  current,
  deps,
  form,
  home,
  locus,
}: {
  api: GithubWriteApi;
  body: string;
  comments: readonly DescriptionReviewComment[];
  current: WrittenPr;
  deps: GithubPrDeps;
  form: PrForm;
  home: string;
  locus: string;
}): Promise<PrOutcome> {
  // Decided HERE, after the freshness re-read, and that placement is the whole fix. A no-op used to PATCH
  // identical bytes and print `updated` — a change reported that never happened, which is the silent-success
  // class this verb exists to remove. Behind `updateFreshnessFor` a concurrent edit is already a refusal by
  // the time control reaches this line, so `unchanged` is never claimed about a description that has moved.
  // The residual window — an edit landing after that GET — is the same accepted race the PATCH path carries.
  const unchanged = writeWouldChangeNothing({ live: current, renderedBody: body, renderedTitle: form.title });
  if (!unchanged) {
    return reviewedPatch({ api, body, comments, current, deps, form, home, locus });
  }
  if (comments.length > 0) {
    // A no-op PATCH sends nothing, but the round posted after it does, and it answers to the same review: checked
    // HERE, so a round no CLEAN review covers is refused before the caller's kind labels reach GitHub.
    const refusal = await reviewRefusal({ body, comments, current, deps, form, home });
    if (refusal !== undefined) {
      return refusal;
    }
  }
  return { kind: "unchanged", number: current.number, url: current.htmlUrl };
}

/** The refusal when no CLEAN description review covers these bytes and this round at the head just re-read. */
async function reviewRefusal({
  body,
  comments,
  current,
  deps,
  form,
  home,
}: {
  body: string;
  comments: readonly DescriptionReviewComment[];
  current: WrittenPr;
  deps: GithubPrDeps;
  form: PrForm;
  home: string;
}): Promise<PrOutcome | undefined> {
  const reviewed = await deps.descriptionReview({
    body,
    comments,
    form,
    headRef: current.head.sha,
    home,
    pullRequest: { kind: "existing", number: current.number },
    repoDir: deps.cwd(),
  });
  if (reviewed.kind === "refused") {
    return { kind: "refused", reason: reviewed.lines.join("\n") };
  }
  if (reviewed.notice !== undefined) {
    deps.err({ line: reviewed.notice });
  }
  return undefined;
}

/**
 * A write that changes something: last, immediately before the PATCH, a CLEAN description review must cover these
 * exact bytes against the head just re-read. A no-op with no round to post sends nothing and owes none.
 */
async function reviewedPatch({
  api,
  body,
  comments,
  current,
  deps,
  form,
  home,
  locus,
}: {
  api: GithubWriteApi;
  body: string;
  comments: readonly DescriptionReviewComment[];
  current: WrittenPr;
  deps: GithubPrDeps;
  form: PrForm;
  home: string;
  locus: string;
}): Promise<PrOutcome> {
  const reviewedHead = current.head.sha;
  const refusal = await reviewRefusal({ body, comments, current, deps, form, home });
  if (refusal !== undefined) {
    return refusal;
  }
  const { owner, repo } = ownerRepoOf({ fullName: current.baseRepoFullName });
  const target = { number: current.number, owner, repo, reviewedHead };
  return patchAndConfirm({ api, body, deps, form, home, locus, ...target });
}

/**
 * The PATCH itself, then the local confirmation of what it wrote.
 *
 * GitHub offers no update conditional on the head SHA, so a force-push between the review check and this PATCH
 * cannot be refused, only seen: the PATCH's own response carries the head it landed on, and a head other than the
 * one the review bound is printed so the description is reviewed again.
 */
async function patchAndConfirm({
  api,
  body,
  deps,
  form,
  home,
  locus,
  number,
  owner,
  repo,
  reviewedHead,
}: {
  api: GithubWriteApi;
  body: string;
  deps: GithubPrDeps;
  form: PrForm;
  home: string;
  locus: string;
  number: number;
  owner: string;
  repo: string;
  reviewedHead: string;
}): Promise<PrOutcome> {
  const written = await api.updatePr({ body, number, owner, repo, title: form.title });
  if (written.isErr()) {
    return { detail: `the update call failed (${written.error.message}).`, kind: "unconfirmed", locus };
  }
  if (written.value.head.sha !== reviewedHead) {
    deps.err({
      line:
        `warning: #${String(number)}'s head moved to ${written.value.head.sha} while the description was being ` +
        `written; its review bound ${reviewedHead}. Prepare and record a review of it again.`,
    });
  }
  const failed = confirmOrUnconfirmed({ form, home, locus, nowIso: deps.now().toISOString(), pr: written.value });
  if (failed !== undefined) {
    return failed;
  }
  return { kind: "updated", number: written.value.number, url: written.value.htmlUrl };
}
