/**
 * A PULL-REQUEST DESCRIPTION IS REVIEWED BEFORE IT REACHES GITHUB — the pure half: what one review is bound to,
 * whether a cited review judged this packet, whether its reviewer was fresh, and whether a write may go out on it.
 *
 * Modelled on the page review (`../../pages/review.ts`): a packet repository whose base commit holds only what a
 * diff cannot carry (the images) and whose head commit adds every text file, the evidence and the thing under
 * review alike, and a review bound to those two commits by the diff digest it recorded. Two things differ, both deliberately. A page may publish over a changed or BROKEN review once the
 * author says what changed; a description may not, because the verb is the only check standing between those
 * bytes and a public surface. And a page review binds to a fragment alone; a description review also binds the
 * images, the written rules and the change set, so editing any of them asks for a new review while a pure rebase
 * does not.
 *
 * Everything here is decided from values; the reads are `./descriptionReviewStore.ts`'s.
 */
import { createHash } from "node:crypto";

import { err, ok, type Result } from "#lib/result.js";
import { stableStringify } from "#lib/stableStringify.js";

import type { PageReviewCandidate } from "../../pages/review.js";
import { type SupervisorSession, sameSupervisorSession, supervisorSessionLabel } from "../../supervisor/session.js";
import { descriptionCommentsText, existingCommentsDigestText } from "./descriptionReviewCommentText.js";
import { type DescriptionReviewError, DescriptionReviewErrors } from "./descriptionReviewErrors.js";
import {
  DESCRIPTION_REVIEW_PROPERTY,
  DESCRIPTION_REVIEW_PROPERTY_ID,
  type DescriptionImage,
  type DescriptionReviewComment,
  type DescriptionReviewer,
  type DescriptionReviewManifest,
  type DescriptionReviewPreparation,
  type DescriptionReviewReceipt,
  type ExistingPullRequestComment,
  type HistoryBoundReceipt,
  type StoredDescriptionReviewPreparation,
} from "./descriptionReviewTypes.js";

/** What the shell read back from a packet repository at a candidate's commits. */
export interface PacketCommitFacts {
  /** The digest of the commit-to-commit diff, in the review's own form. */
  readonly diffSha256: string;
  /** sha256 of `description/title.txt` at the head commit. */
  readonly titleSha256: string;
  /** sha256 of `description/body.md` at the head commit. */
  readonly bodySha256: string;
  /** sha256 of `description/comments.json` at the head commit. */
  readonly commentsSha256: string;
}

/**
 * sha256 of a string's UTF-8 bytes, lowercase hex — the one digest a title, a body or a rule file is bound by.
 *
 * @returns the digest
 */
export function textSha256({ text }: { text: string }): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/**
 * The digest of the written rules, over each file's path and exact bytes, in the order given.
 *
 * @param files every rule file the packet carries, as read from the selected tree (`./descriptionReviewRules.ts`)
 * @returns the digest
 */
export function rulesSha256Of({ files }: { files: readonly { path: string; contents: string }[] }): string {
  const entries = files.map((file) => [file.path, textSha256({ text: file.contents })]);
  return textSha256({ text: stableStringify({ value: entries }) });
}

/**
 * Images in canonical order, so the same set given in another order is the same manifest.
 *
 * @returns a sorted copy
 */
export function canonicalImages({ images }: { images: readonly DescriptionImage[] }): readonly DescriptionImage[] {
  const key = (image: DescriptionImage): string => `${image.url}\n${image.sha256}`;
  return images.toSorted((left, right) => (key(left) < key(right) ? -1 : Number(key(left) > key(right))));
}

/**
 * The manifest one review is bound to.
 *
 * @param repository `owner/name`
 * @param baseBranch the branch the pull request merges into
 * @param title the exact title the write sends
 * @param body the exact body bytes the write sends
 * @param changeDigest the change set's digest (`./descriptionChangeDigest.ts`)
 * @param rulesSha256 the written rules' digest ({@link rulesSha256Of})
 * @param images every image the body shows
 * @param comments every inline comment the same write posts, exactly as GitHub receives it
 * @param existingComments every comment already on the pull request; `[]` for one not yet opened
 * @returns the manifest
 */
export function buildDescriptionManifest({
  repository,
  baseBranch,
  title,
  body,
  comments,
  existingComments,
  changeDigest,
  rulesSha256,
  images,
}: {
  repository: string;
  baseBranch: string;
  title: string;
  body: string;
  comments: readonly DescriptionReviewComment[];
  existingComments: readonly ExistingPullRequestComment[];
  changeDigest: string;
  rulesSha256: string;
  images: readonly DescriptionImage[];
}): DescriptionReviewManifest {
  return {
    baseBranch,
    bodySha256: textSha256({ text: body }),
    changeDigest,
    commentsSha256: textSha256({ text: descriptionCommentsText({ comments }) }),
    existingCommentsSha256: textSha256({ text: existingCommentsDigestText({ comments: existingComments }) }),
    images: canonicalImages({ images }),
    repository,
    rulesSha256,
    schemaVersion: 2,
    titleSha256: textSha256({ text: title }),
  };
}

/**
 * The digest a manifest is stored and found under.
 *
 * @returns the lowercase hex digest of the manifest's stable serialisation
 */
export function manifestSha256Of({ manifest }: { manifest: DescriptionReviewManifest }): string {
  return textSha256({ text: stableStringify({ value: manifest }) });
}

/**
 * What changed between a reviewed manifest and the one a write would send, in a reader's words.
 *
 * @param want the manifest the write would send
 * @param have a manifest an earlier review covered
 * @returns one clause per part that differs, empty when they are the same packet
 */
export function manifestDifferences({
  want,
  have,
}: {
  want: DescriptionReviewManifest;
  have: DescriptionReviewManifest;
}): readonly string[] {
  const differences: string[] = [];
  const parts: readonly [boolean, string][] = [
    [want.repository !== have.repository || want.baseBranch !== have.baseBranch, "the repository or base changed"],
    [want.titleSha256 !== have.titleSha256, "the title changed"],
    [want.bodySha256 !== have.bodySha256, "the body changed"],
    [want.commentsSha256 !== have.commentsSha256, "the comments this write would post changed"],
    [want.existingCommentsSha256 !== have.existingCommentsSha256, "the pull request's existing comments changed"],
    [stableStringify({ value: want.images }) !== stableStringify({ value: have.images }), "the images changed"],
    [want.rulesSha256 !== have.rulesSha256, "the written rules changed"],
    [want.changeDigest !== have.changeDigest, "the change set's content changed"],
  ];
  for (const [differs, clause] of parts) {
    if (differs) {
      differences.push(clause);
    }
  }
  return differences;
}

/** A review proven to have judged a packet prepared under the current schema. */
export interface BoundDescriptionReview {
  readonly candidate: PageReviewCandidate;
  readonly preparation: DescriptionReviewPreparation;
}

/**
 * Prove a candidate review judged this packet, or say which binding failed.
 *
 * @param candidate the review as its record states it
 * @param preparation the packet its repository root resolved to
 * @param facts what the shell read from that packet repository at the candidate's commits
 * @returns the candidate with the current-schema preparation it bound to, or the binding that failed
 */
export function bindDescriptionReview({
  candidate,
  preparation,
  facts,
}: {
  candidate: PageReviewCandidate;
  preparation: StoredDescriptionReviewPreparation;
  facts: PacketCommitFacts;
}): Result<BoundDescriptionReview, DescriptionReviewError> {
  const wrong = ({ why }: { why: string }): Result<BoundDescriptionReview, DescriptionReviewError> =>
    err(DescriptionReviewErrors.wrongPacket({ reviewId: candidate.id, why }));
  // A schema-2 packet holds its evidence at the base, so the property `review-prepare` prints now, which tells the
  // reviewer every text file is in the diff, is false of it; a schema-3 packet shows no thread's history, so the
  // property's history clause is false of it. Their receipts still carry, but a new review binds only to a packet
  // prepared now.
  if (preparation.schemaVersion === 2) {
    return wrong({
      why: `its packet ${preparation.preparationId} keeps its evidence at the base commit, outside the diff; run \`github pr review-prepare\` again`,
    });
  }
  if (preparation.schemaVersion === 3) {
    return wrong({
      why: `its packet ${preparation.preparationId} shows no review thread's history, so a resolved comment reads as live; run \`github pr review-prepare\` again`,
    });
  }
  if (
    candidate.property.id !== DESCRIPTION_REVIEW_PROPERTY_ID ||
    candidate.property.statement !== DESCRIPTION_REVIEW_PROPERTY
  ) {
    return wrong({
      why: `it answered property "${candidate.property.id}", not the five-question property \`review-prepare\` prints`,
    });
  }
  if (candidate.baseSha !== preparation.baseSha || candidate.headSha !== preparation.headSha) {
    return wrong({ why: "its base and head commits are not the ones `github pr review-prepare` committed" });
  }
  if (facts.diffSha256 !== candidate.diffSha256) {
    return wrong({
      why: "the diff it judged does not reproduce from the packet's commits — the packet was edited before the review ran",
    });
  }
  if (facts.titleSha256 !== preparation.manifest.titleSha256 || facts.bodySha256 !== preparation.manifest.bodySha256) {
    return wrong({ why: "the title or body at its head commit is not the description that was prepared" });
  }
  if (facts.commentsSha256 !== preparation.manifest.commentsSha256) {
    return wrong({ why: "the comments at its head commit are not the ones that were prepared" });
  }
  return ok({ candidate, preparation });
}

/**
 * Whether the reviewer was fresh: never the session that wrote the description.
 *
 * A Codex review is fresh by construction — Codex runs its own thread and writes the verdict itself, so who copies
 * that verdict into a receipt adds nothing. A Claude fallback review is recorded by the reviewing session, so the
 * recorder IS the reviewer, and it must be a visible session that can be named and that is not the one that
 * prepared the packet. Residue, stated: a session id is read from the environment and compared as an opaque value
 * (`../../hatch/grantSession.ts` names the same limit), so this catches the honest mistake of a writer reviewing
 * its own description, not a process that sets another session's id.
 *
 * @param reviewer who the cited review says took it
 * @param preparedBy the session that prepared the packet
 * @param recordedBy the session recording the receipt now
 * @returns the reviewer, or why it is not fresh
 */
export function decideReviewerFreshness({
  reviewer,
  preparedBy,
  recordedBy,
}: {
  reviewer: DescriptionReviewer;
  preparedBy: SupervisorSession | null;
  recordedBy: SupervisorSession | null;
}): Result<DescriptionReviewer, DescriptionReviewError> {
  if (reviewer === "codex") {
    return ok(reviewer);
  }
  if (recordedBy === null) {
    return err(
      DescriptionReviewErrors.notFresh({
        why: "a Claude fallback review is recorded by the session that took it, and this environment names no visible session",
      }),
    );
  }
  if (preparedBy === null) {
    return err(
      DescriptionReviewErrors.notFresh({
        why: "the packet was prepared outside any visible session, so a Claude reviewer cannot be shown to be a different one; prepare it again from the writing session",
      }),
    );
  }
  if (sameSupervisorSession({ left: preparedBy, right: recordedBy })) {
    return err(
      DescriptionReviewErrors.notFresh({
        why: `session ${supervisorSessionLabel({ session: recordedBy })} prepared this packet and is recording its own review; a separate visible session takes the fallback pass`,
      }),
    );
  }
  return ok(reviewer);
}

/**
 * The receipt a bound, fresh review becomes.
 *
 * @returns the receipt to store under its manifest digest
 */
export function descriptionReceiptOf({
  candidate,
  preparation,
  recordedBy,
  receiptId,
  recordedAtIso,
}: {
  candidate: PageReviewCandidate;
  preparation: DescriptionReviewPreparation;
  recordedBy: SupervisorSession | null;
  receiptId: string;
  recordedAtIso: string;
}): HistoryBoundReceipt {
  return {
    historicalReviewThreadIds: preparation.historicalReviewThreadIds,
    manifest: preparation.manifest,
    manifestSha256: preparation.manifestSha256,
    preparationId: preparation.preparationId,
    preparedBy: preparation.preparedBy,
    receiptId,
    recordedAtIso,
    recordedBy,
    reviewId: candidate.id,
    reviewer: candidate.reviewer,
    schemaVersion: 3,
    summary: candidate.summary,
    verdict: candidate.verdict,
  };
}

/**
 * The earlier review a refusal compares against: the newest receipt for the same repository and base, preferring
 * one over the same title and body, then one over the same change set.
 *
 * @param want the manifest the write would send
 * @param receipts every receipt the store holds
 * @returns the nearest receipt, or undefined when this repository's description was never reviewed
 */
export function nearestReceipt({
  want,
  receipts,
}: {
  want: DescriptionReviewManifest;
  receipts: readonly DescriptionReviewReceipt[];
}): DescriptionReviewReceipt | undefined {
  const sameBase = receipts
    .filter((one) => one.manifest.repository === want.repository && one.manifest.baseBranch === want.baseBranch)
    .toSorted((left, right) => right.recordedAtIso.localeCompare(left.recordedAtIso));
  const sameText = sameBase.find(
    (one) => one.manifest.titleSha256 === want.titleSha256 && one.manifest.bodySha256 === want.bodySha256,
  );
  if (sameText !== undefined) {
    return sameText;
  }
  const sameChange = sameBase.find((one) => one.manifest.changeDigest === want.changeDigest);
  if (sameChange !== undefined) {
    return sameChange;
  }
  return sameBase[0];
}

/**
 * Decide whether a write may send the description a manifest describes.
 *
 * @param want the manifest of exactly what the write would send
 * @param receipt the receipt stored under that manifest's digest, or undefined when there is none
 * @param receipts every receipt the store holds, read only to explain a refusal
 * @returns the CLEAN receipt, or why the write may not go out
 */
export function decideDescriptionWrite({
  want,
  receipt,
  receipts,
}: {
  want: DescriptionReviewManifest;
  receipt: DescriptionReviewReceipt | undefined;
  receipts: readonly DescriptionReviewReceipt[];
}): Result<DescriptionReviewReceipt, DescriptionReviewError> {
  const manifestSha256 = manifestSha256Of({ manifest: want });
  if (receipt === undefined) {
    const nearest = nearestReceipt({ receipts, want });
    const differences = nearest === undefined ? [] : manifestDifferences({ have: nearest.manifest, want });
    return err(DescriptionReviewErrors.missing({ differences, manifestSha256 }));
  }
  if (receipt.verdict !== "CLEAN") {
    return err(DescriptionReviewErrors.broken({ receiptId: receipt.receiptId, summary: receipt.summary }));
  }
  return ok(receipt);
}
