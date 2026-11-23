/**
 * The check a write verb makes immediately before it sends a pull-request description: does a CLEAN description
 * review cover exactly the title, body, the inline comments the same write posts, the comments already on the pull
 * request, the images, the written rules and the change set about to go out?
 *
 * `github stack push` and `github pr update` call {@link requireCleanDescriptionReview} after the body is rendered
 * and every gate on it has passed, and before the provider mutation. It recomputes the manifest from what the
 * verb is about to send rather than trusting any id the author passes, so there is nothing to cite and nothing to
 * get wrong: the receipt is found by the digest of the exact bytes, or it is not there. There is no hatch. A
 * review of these bytes that came back BROKEN refuses exactly like a missing one, because acknowledging a broken
 * review would publish the very thing the review found.
 */
import { err, ok, type Result } from "#lib/result.js";

import { type ChangeDigestReading, computeChangeDigest } from "./descriptionChangeDigest.js";
import {
  buildDescriptionManifest,
  decideDescriptionWrite,
  manifestSha256Of,
  rulesSha256Of,
} from "./descriptionReview.js";
import type { DescriptionReviewError } from "./descriptionReviewErrors.js";
import { listReadableReceipts, readDescriptionRules, readReceipt } from "./descriptionReviewStore.js";
import type {
  DescriptionImage,
  DescriptionReviewComment,
  DescriptionReviewManifest,
  DescriptionReviewReceipt,
  ExistingPullRequestComment,
} from "./descriptionReviewTypes.js";

/** What a description about to be written is, in the terms a review binds. */
export interface DescriptionUnderReview {
  /** `owner/name`. */
  readonly repository: string;
  /** The branch the pull request merges into. */
  readonly baseBranch: string;
  /** The checkout holding the pull request's branch. */
  readonly repoDir: string;
  /** A ref `repoDir` resolves for the base (e.g. `origin/main`); the merge base is taken against it. */
  readonly baseRef: string;
  /** The commit the description describes (e.g. `HEAD`, or the stack entry's branch). */
  readonly headRef: string;
  /** The exact title the write sends. */
  readonly title: string;
  /** The exact body bytes the write sends. */
  readonly body: string;
  /** Every image the body shows. */
  readonly images: readonly DescriptionImage[];
  /** Every inline comment the same write posts, exactly as GitHub receives it; `[]` when it posts none. */
  readonly comments: readonly DescriptionReviewComment[];
  /** Every comment already on the pull request, read whole; `[]` for one not yet opened. */
  readonly existingComments: readonly ExistingPullRequestComment[];
  /** The tree the written rules are read from: `installedRulesRoot()` in production. */
  readonly rulesRoot: string;
}

/** The manifest of a description, with the readings it was built from. */
export interface DescriptionManifestReading {
  readonly manifest: DescriptionReviewManifest;
  readonly manifestSha256: string;
  readonly change: ChangeDigestReading;
  readonly rules: readonly { readonly path: string; readonly contents: string }[];
}

/**
 * Read the rules and the change set, and build the manifest a review of this description is bound to.
 *
 * @param description what is about to be written, and where its change set lives
 * @returns the manifest and the readings behind it, or why one could not be read
 */
export function descriptionManifestFor({
  description,
}: {
  description: DescriptionUnderReview;
}): Result<DescriptionManifestReading, DescriptionReviewError> {
  const rules = readDescriptionRules({ rulesRoot: description.rulesRoot });
  if (rules.isErr()) {
    return err(rules.error);
  }
  const change = computeChangeDigest({
    baseRef: description.baseRef,
    headRef: description.headRef,
    repoDir: description.repoDir,
  });
  if (change.isErr()) {
    return err(change.error);
  }
  const manifest = buildDescriptionManifest({
    baseBranch: description.baseBranch,
    body: description.body,
    changeDigest: change.value.changeDigest,
    comments: description.comments,
    existingComments: description.existingComments,
    images: description.images,
    repository: description.repository,
    rulesSha256: rulesSha256Of({ files: rules.value }),
    title: description.title,
  });
  return ok({ change: change.value, manifest, manifestSha256: manifestSha256Of({ manifest }), rules: rules.value });
}

/**
 * Refuse a description write that no CLEAN description review covers.
 *
 * Call it immediately before the provider mutation, with the exact title and body bytes the mutation sends.
 *
 * @param home the state home holding the receipts
 * @param description what is about to be written, and where its change set lives
 * @returns the CLEAN receipt that opens the write, or why the write may not go out
 */
export function requireCleanDescriptionReview({
  home,
  description,
}: {
  home: string;
  description: DescriptionUnderReview;
}): Result<DescriptionReviewReceipt, DescriptionReviewError> {
  const reading = descriptionManifestFor({ description });
  if (reading.isErr()) {
    return err(reading.error);
  }
  const { manifest, manifestSha256 } = reading.value;
  const receipt = readReceipt({ home, manifestSha256 });
  if (receipt.isErr()) {
    return err(receipt.error);
  }
  const receipts = receipt.value === undefined ? listReadableReceipts({ home }) : [];
  return decideDescriptionWrite({ receipt: receipt.value, receipts, want: manifest });
}
