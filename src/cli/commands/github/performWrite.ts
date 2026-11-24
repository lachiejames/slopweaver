/**
 * The update mutation, already inside the door, and the confirmation both writes share.
 *
 * Split out of `run.ts` to keep that file under this repo's own line ceiling. `performUpdate` is exported because
 * `updateFlow.ts`'s `sendUpdate` calls it; the create is `./performCreate.ts`'s, and it imports
 * `confirmOrUnconfirmed` and `Outgoing` from here. The render-and-gate step both run before sending is
 * `./prRenderGate.ts`'s.
 *
 * ## The door checks the seen day against its own clock
 *
 * No byte of a C3 description depends on the day it is written, so nothing is stamped into it. Both writes still
 * read the UTC day of `deps.now()` here, inside the door, and refuse a problem "seen" on a later day
 * (`../../../outbound/github/stamp.ts`), so a `--pull` then `--file` round trip with no edits stays a no-op.
 */
import { type GithubWriteApi, type WrittenPr } from "../../../corpus/github/write.js";
import type { InstallationIdentifiers } from "../../../hygiene/installationIdentifiers.js";
import type { Result } from "../../../lib/result.js";
import type { DescriptionReviewComment } from "../../../outbound/github/descriptionReviewTypes.js";
import { confirmPr } from "../../../outbound/github/prLedger.js";
import type { TitleShapePolicy } from "../../../outbound/github/titleShape.js";
import type { PrForm, PrFormDraft } from "../../../outbound/github/types.js";
import { ownerRepoOf } from "./addressRun.js";
import type { PrOutcome } from "./core.js";
import { applyKindLabels } from "./kindLabelApply.js";
import type { GithubPrDeps } from "./prDeps.js";
import { type PublicationScan, stampedUpdate, writeGates } from "./prRenderGate.js";
import type { TitleShapePolicyError } from "./titleShapePolicy.js";
import { updateFreshnessFor, writeWouldChangeNothing } from "./updateCore.js";

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

/** What a write sends, or why it sends nothing. */
export type Outgoing =
  | { readonly kind: "send"; readonly form: PrForm; readonly body: string }
  | { readonly kind: "refused"; readonly reason: string };

/**
 * The bytes an update sends: the draft checked against today, rendered, gated, and followed by the third-party
 * trailing region. Pure — the clock reading is passed in.
 */
function outgoingUpdate({
  denylist,
  publicationScan,
  titlePolicy,
  installationIdentifiers,
  draft,
  live,
  today,
  trailing,
}: {
  denylist: readonly string[];
  publicationScan: PublicationScan;
  titlePolicy: Result<TitleShapePolicy, TitleShapePolicyError>;
  installationIdentifiers: InstallationIdentifiers | undefined;
  draft: PrFormDraft;
  live: WrittenPr;
  today: Date;
  trailing: string;
}): Outgoing {
  const checked = stampedUpdate({
    denylist,
    draft,
    installationIdentifiers,
    liveTitle: live.title,
    publicationScan,
    titlePolicy,
    today,
  });
  if (checked.kind === "refused") {
    return checked;
  }
  const { form, rendered } = checked;
  // The trailing region is not this door's words, but this write SENDS it again, so it crosses the same scan. A
  // footer that fails it is dropped by writing the whole form (`--file`), which carries no trailing region.
  const ownRepository = `${form.target.owner}/${form.target.repo}`;
  const footer = trailing === "" ? [] : publicationScan({ body: trailing, ownRepository, title: "" });
  if (footer.length > 0) {
    return {
      kind: "refused",
      reason:
        `the text after the description, which this update would send again, fails the publication scan: ` +
        `${footer.join("; ")}. Write the whole form with --file to drop it`,
    };
  }
  return { body: `${rendered.body}${trailing}`, form, kind: "send" };
}

/**
 * The pull request read AGAIN, immediately before the write, and refused when it moved since the preview.
 *
 * Address resolution, the identity read, recovery and the diff all happened before the door, which would
 * otherwise stretch the known non-atomic GET-to-PATCH window a long way. This puts it back to one round trip.
 * GitHub offers no conditional update for a body, so the window cannot be closed — only kept short and re-checked.
 */
async function freshLive({
  api,
  owner,
  previewed,
  repo,
}: {
  api: GithubWriteApi;
  owner: string;
  previewed: WrittenPr;
  repo: string;
}): Promise<
  { readonly kind: "fresh"; readonly current: WrittenPr } | { readonly kind: "refused"; readonly reason: string }
> {
  const current = await api.getPr({ number: previewed.number, owner, repo });
  if (current.isErr()) {
    return {
      kind: "refused",
      reason: `could not re-read #${String(previewed.number)} before writing: ${current.error.message}`,
    };
  }
  const fresh = updateFreshnessFor({ current: current.value, previewed });
  if (!fresh.fresh) {
    return { kind: "refused", reason: fresh.reason };
  }
  return { current: current.value, kind: "fresh" };
}

/**
 * The update path, already inside the door.
 *
 * No byte of a C3 description depends on the day it is written, so a write that changes nothing renders the live
 * bytes exactly and stays `unchanged`. Either way, a same-repository pull request then gets its missing kind
 * labels (`./kindLabelApply.ts`), read back.
 *
 * @param api the write API
 * @param comments the walkthrough the same update posts after the PATCH, exactly as GitHub receives it; the PATCH's
 *   review binds it, so the one receipt also covers the round's own check
 * @param previewed the pull request as previewed before the door — the base freshness re-read compares
 *   against this
 * @param draft the merged or whole draft the write will send
 * @param trailing third-party bytes after the rendered description, re-appended verbatim
 * @param home the state home whose ledger records the write
 * @param locus the branch locus, used only to label an unconfirmed outcome
 * @param deps the injectable clock and output sink
 * @param installationIdentifiers the installation's own identifiers the scan forgives on this target, the same
 *   value the preview was gated with
 * @returns the update outcome
 */
export async function performUpdate({
  api,
  comments,
  previewed,
  draft,
  trailing,
  home,
  locus,
  deps,
  installationIdentifiers,
}: {
  api: GithubWriteApi;
  comments: readonly DescriptionReviewComment[];
  previewed: WrittenPr;
  draft: PrFormDraft;
  trailing: string;
  home: string;
  locus: string;
  deps: GithubPrDeps;
  installationIdentifiers: InstallationIdentifiers | undefined;
}): Promise<PrOutcome> {
  const { owner, repo } = ownerRepoOf({ fullName: previewed.baseRepoFullName });
  const live = await freshLive({ api, owner, previewed, repo });
  if (live.kind === "refused") {
    return live;
  }
  const { current } = live;
  const outgoing = outgoingUpdate({
    ...writeGates({ home }),
    draft,
    installationIdentifiers,
    live: current,
    today: deps.now(),
    trailing,
  });
  if (outgoing.kind === "refused") {
    return outgoing;
  }
  const { body, form } = outgoing;
  const outcome = await sendUpdate({ api, body, comments, current, deps, form, home, locus });
  if (outcome.kind === "refused") {
    return outcome;
  }
  // The author check ran before the door, so only the fork case is left: a fork's labels are its author's.
  const sameRepository = current.head.repoFullName === current.baseRepoFullName;
  if ((outcome.kind === "updated" || outcome.kind === "unchanged") && sameRepository) {
    const target = { number: current.number, owner, repo, title: form.title };
    for (const line of await applyKindLabels({ api, target })) {
      deps.out({ line });
    }
  }
  return outcome;
}

/** The decided bytes sent: `unchanged` when they match the live pull request, else the reviewed PATCH. */
async function sendUpdate({
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
