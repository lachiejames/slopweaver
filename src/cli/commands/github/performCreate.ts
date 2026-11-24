/**
 * The create mutation, already inside the door: stamp, render and gate, cover the exact bytes with a CLEAN
 * description review, then reserve → create → confirm.
 *
 * Exported so `stackPushSend.ts` runs the exact sequence rather than reimplementing it. The update mutation, and the
 * confirmation both writes share, are `./performWrite.ts`'s.
 */
import type { GithubWriteApi } from "../../../corpus/github/write.js";
import type { InstallationIdentifiers } from "../../../hygiene/installationIdentifiers.js";
import type { DescriptionReviewComment } from "../../../outbound/github/descriptionReviewTypes.js";
import { releasePrRecord } from "../../../outbound/github/prLedger.js";
import type { PrFormDraft } from "../../../outbound/github/types.js";
import type { PrOutcome } from "./core.js";
import { confirmOrUnconfirmed, type Outgoing } from "./performWrite.js";
import type { GithubPrDeps } from "./prDeps.js";
import type { DescriptionPullRequest } from "./prDescriptionReviewCore.js";
import { renderAndCheck, stampToday, writeGates } from "./prRenderGate.js";
import { resolvedReservation } from "./reservation.js";

/**
 * The bytes a create sends: the draft checked against today, rendered, gated, then covered by a CLEAN description
 * review — last, so nothing is reserved or sent for a body that has none.
 */
async function outgoingCreate({
  comments,
  deps,
  draft,
  home,
  installationIdentifiers,
  pullRequest,
}: {
  comments: readonly DescriptionReviewComment[];
  deps: GithubPrDeps;
  draft: PrFormDraft;
  home: string;
  installationIdentifiers: InstallationIdentifiers | undefined;
  pullRequest: DescriptionPullRequest;
}): Promise<
  Extract<Outgoing, { kind: "refused" }> | (Extract<Outgoing, { kind: "send" }> & { boundHead: string | undefined })
> {
  const stamped = stampToday({ draft, now: deps.now });
  if (stamped.isErr()) {
    return { kind: "refused", reason: stamped.error.message };
  }
  const form = stamped.value;
  const rendered = renderAndCheck({ ...writeGates({ home }), form, installationIdentifiers, liveTitle: undefined });
  if (!rendered.ok) {
    return { kind: "refused", reason: `the rendered body fails the PR gate: ${rendered.errors.join("; ")}` };
  }
  const review = {
    body: rendered.body,
    comments,
    form,
    headRef: form.target.head,
    home,
    // The pull request the caller resolved: `new` reads no existing comments, while an open one already on this
    // branch binds them, exactly as the early check did. The walkthrough this push posts is `comments`.
    pullRequest,
    repoDir: deps.cwd(),
  };
  const reviewed = await deps.descriptionReview(review);
  if (reviewed.kind === "refused") {
    return { kind: "refused", reason: reviewed.lines.join("\n") };
  }
  if (reviewed.notice !== undefined) {
    deps.err({ line: reviewed.notice });
  }
  return { body: rendered.body, boundHead: reviewed.boundHead, form, kind: "send" };
}

/**
 * A create names only the head BRANCH, so a force-push between the review check and the POST opens the pull request
 * at a commit the review never read. GitHub offers no create conditional on a commit, so it is seen, not refused:
 * the same warning `pr update` prints when its head moves (`./performWrite.ts`, `patchAndConfirm`).
 *
 * @param boundHead the commit the review's change set was read at; undefined when the check bound none
 * @param createdHead the head commit GitHub reports the new pull request at
 * @param number the new pull request's number
 * @returns the warning line, or undefined when the heads agree or nothing was bound
 */
export function createdHeadWarning({
  boundHead,
  createdHead,
  number,
}: {
  boundHead: string | undefined;
  createdHead: string;
  number: number;
}): string | undefined {
  if (boundHead === undefined || boundHead === createdHead) {
    return undefined;
  }
  return (
    `warning: #${String(number)} was opened at ${createdHead}, but its description's review bound ${boundHead}. ` +
    "Prepare and record a review of it again."
  );
}

/**
 * Why a create whose review bound an OPEN pull request must not go ahead once the reservation came back fresh: the
 * review read that pull request's comments, and the create would open a different one. Either the open pull request
 * closed after the review, or this machine's ledger never recorded it; both end here, never at a create.
 *
 * @returns the refusal reason, or undefined when the review described a new pull request
 */
function reviewedAnotherPullRequest({ pullRequest }: { pullRequest: DescriptionPullRequest }): string | undefined {
  if (pullRequest.kind === "new") {
    return undefined;
  }
  const number = String(pullRequest.number);
  return (
    `both description reviews named open pull request #${number}, but no reservation here records it, so nothing ` +
    `was created. Update #${number} with \`github push\` then \`github pr update --number ${number}\`, or re-run ` +
    "if it has closed."
  );
}

/** The form target's `owner/name` as the caller spelled it, which a duplicate's update command prints. */
function targetRepo({ owner, repo }: { owner: string; repo: string }): string {
  return `${owner}/${repo}`;
}

/**
 * The create path, already inside the door: stamp, render and gate, then reserve → create → confirm.
 *
 * The stamp is taken HERE, from `deps.now()`, so the seen day is checked against the day it was actually sent; a
 * body the gate or the review refuses is refused before anything is reserved.
 *
 * @param api the write API
 * @param comments the walkthrough the same push posts once the pull request reads back, exactly as GitHub receives it
 * @param draft the validated, linkified draft, carrying no review
 * @param home the state home whose ledger records the reservation and the stored form
 * @param locus the branch locus — the create-guard key
 * @param deps the injectable clock and output sink
 * @param installationIdentifiers the installation's own identifiers the scan forgives on this target
 * @param pullRequest the pull request the description review binds: `new`, or the branch's open one, which then
 *   ends at the reservation's duplicate refusal, or at a refusal that releases a fresh reservation
 * @returns the create outcome
 */
export async function performCreate({
  api,
  comments,
  draft,
  home,
  locus,
  deps,
  installationIdentifiers,
  pullRequest,
}: {
  api: GithubWriteApi;
  comments: readonly DescriptionReviewComment[];
  draft: PrFormDraft;
  home: string;
  locus: string;
  deps: GithubPrDeps;
  installationIdentifiers: InstallationIdentifiers | undefined;
  pullRequest: DescriptionPullRequest;
}): Promise<PrOutcome> {
  const outgoing = await outgoingCreate({ comments, deps, draft, home, installationIdentifiers, pullRequest });
  if (outgoing.kind === "refused") {
    return outgoing;
  }
  const { form } = outgoing;
  const reservation = await resolvedReservation({
    api,
    form,
    home,
    locus,
    nowIso: deps.now().toISOString(),
    out: deps.out,
  });
  if (reservation.kind === "taken") {
    return { existing: reservation.record.number, kind: "duplicate", locus, repo: targetRepo(form.target) };
  }
  const elsewhere = reviewedAnotherPullRequest({ pullRequest });
  if (elsewhere !== undefined) {
    releasePrRecord({ home, locus });
    return { kind: "refused", reason: elsewhere };
  }
  return createAndConfirm({ api, deps, home, locus, outgoing });
}

/**
 * The create itself, once the locus is reserved: POST, warn when the head moved past the review, then confirm.
 *
 * @param outgoing the reviewed bytes and the commit the review bound
 * @returns the create outcome
 */
async function createAndConfirm({
  api,
  deps,
  home,
  locus,
  outgoing,
}: {
  api: GithubWriteApi;
  deps: GithubPrDeps;
  home: string;
  locus: string;
  outgoing: Extract<Outgoing, { kind: "send" }> & { boundHead: string | undefined };
}): Promise<PrOutcome> {
  const { body, form } = outgoing;
  const created = await api.createPr({
    base: form.target.base,
    body,
    draft: form.draft,
    head: form.target.head,
    owner: form.target.owner,
    repo: form.target.repo,
    title: form.title,
  });
  if (created.isErr()) {
    return {
      detail: `the create call failed (${created.error.message}). Whether GitHub committed it is unknown.`,
      kind: "unconfirmed",
      locus,
    };
  }
  const pr = created.value;
  const moved = createdHeadWarning({ boundHead: outgoing.boundHead, createdHead: pr.head.sha, number: pr.number });
  if (moved !== undefined) {
    deps.err({ line: moved });
  }
  const failed = confirmOrUnconfirmed({ form, home, locus, nowIso: deps.now().toISOString(), pr });
  if (failed !== undefined) {
    return failed;
  }
  return { kind: "created", number: pr.number, url: pr.htmlUrl };
}
