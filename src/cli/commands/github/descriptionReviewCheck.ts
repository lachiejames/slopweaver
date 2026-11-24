/**
 * The write verbs' last check before a description reaches GitHub: a CLEAN description review must cover the exact
 * title, body, the inline comments the same write posts, the comments already on the pull request, the images, the
 * written rules and the change set about to go out
 * (`../../../outbound/github/descriptionReviewGate.ts`). `performCreate` (behind `stack push`) and `performUpdate`
 * (behind `pr update`) call the {@link DescriptionReviewCheck} port after every other gate has passed and
 * immediately before the provider mutation. There is no hatch.
 *
 * ## The images come from upload receipts, never from the author
 *
 * Each screenshot slot's address is matched to the upload receipt `github attach upload` wrote after it scanned the
 * picture, uploaded it and read it back (`../../../outbound/github/attachReceipt.ts`). An address no receipt names
 * is refused here: a picture reaches a description only through the image check. The digest bound is the
 * read-back's, and the local file the reviewer opens is the capture receipt's final bytes.
 *
 * ## A refusal leaves the reviewer exactly what will be sent
 *
 * When no review covers the bytes, the check writes the exact body, the comments and the image list under the home and prints
 * the one `review-prepare` command over them. Re-deriving the bytes by hand is how a reviewed description and a
 * sent one drift apart; printing them removes the step.
 */

import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { ok, type Result } from "#lib/result.js";
import { safeJsonStringify } from "#lib/safeJson.js";
import { shellCommandLine } from "#lib/shellCommandLine.js";

import { type GithubUploadReceipt, readUploadReceipt } from "../../../outbound/github/attachReceipt.js";
import { computeChangeDigest } from "../../../outbound/github/descriptionChangeDigest.js";
import { descriptionCommentsText } from "../../../outbound/github/descriptionReview.js";
import {
  type DescriptionReviewCommentsReader,
  readDescriptionComments,
} from "../../../outbound/github/descriptionReviewComments.js";
import type { DescriptionReviewError } from "../../../outbound/github/descriptionReviewErrors.js";
import { requireCleanDescriptionReview } from "../../../outbound/github/descriptionReviewGate.js";
import { installedRulesRoot } from "../../../outbound/github/descriptionReviewRules.js";
import type {
  DescriptionReviewComment,
  ExistingPullRequestComment,
} from "../../../outbound/github/descriptionReviewTypes.js";
import type { PrForm, ProofSlot } from "../../../outbound/github/types.js";
import { stateHomePaths } from "../../../stateHome.js";
import { readCaptureRecord } from "../../../visualEvidence/captureRecord.js";
import type { DescriptionImageInput, DescriptionPullRequest } from "./prDescriptionReviewCore.js";

/**
 * What the check decided: the write may go, or the lines saying why not and what to run.
 *
 * @internal — named only through {@link DescriptionReviewCheck}'s signature
 */
export type DescriptionReviewVerdict =
  | {
      readonly kind: "clear";
      /**
       * The commit the reviewed change set was read at, so a create can see GitHub open the pull request at another
       * one. `undefined` only from {@link clearDescriptionReview}, a test's check that binds no commit at all.
       */
      readonly boundHead: string | undefined;
    }
  | { readonly kind: "refused"; readonly lines: readonly string[] };

/** What a write is about to send, and where the change set it describes is read from. */
export interface DescriptionWrite {
  readonly home: string;
  readonly form: PrForm;
  /** The exact body bytes the mutation sends. */
  readonly body: string;
  /** The commit the description describes: the pushed branch on a create, the live head SHA on an update. */
  readonly headRef: string;
  /** A checkout of the pull request's repository, holding `headRef` and `origin/<base>`. */
  readonly repoDir: string;
  /** The inline comments the same write posts, exactly as GitHub receives them; `[]` when it posts none. */
  readonly comments: readonly DescriptionReviewComment[];
  /** The pull request written: one being opened (no comments yet), or an open one whose comments the check reads. */
  readonly pullRequest: DescriptionPullRequest;
}

/**
 * The port both write paths call immediately before the mutation. Async because, for an open pull request, the
 * comments already on it are read at this moment: the later the read, the narrower the window for one to arrive
 * unreviewed.
 */
export type DescriptionReviewCheck = (write: DescriptionWrite) => Promise<DescriptionReviewVerdict>;

/** Every upload receipt under the home, keyed by the asset address it uploaded. */
function uploadReceiptsByHref({ home }: { home: string }): ReadonlyMap<string, GithubUploadReceipt> {
  const dir = stateHomePaths({ home }).visualEvidenceUploads;
  let names: readonly string[];
  try {
    names = readdirSync(dir);
  } catch {
    // No uploads directory means no picture has passed the image check: every address is then unmatched.
    return new Map();
  }
  const byHref = new Map<string, GithubUploadReceipt>();
  for (const name of names.filter((entry) => entry.endsWith(".json"))) {
    const receipt = readUploadReceipt({ home, uploadReceiptId: name.slice(0, -".json".length) });
    if (receipt.isOk()) {
      byHref.set(receipt.value.asset.href, receipt.value);
    }
  }
  return byHref;
}

/** One screenshot slot as the image a review binds, or why it cannot be shown. */
function slotImage({
  home,
  receipts,
  slot,
  which,
}: {
  home: string;
  receipts: ReadonlyMap<string, GithubUploadReceipt>;
  slot: ProofSlot;
  which: string;
}): DescriptionImageInput | string | undefined {
  if (slot.kind !== "screenshot") {
    return undefined;
  }
  const receipt = receipts.get(slot.image.url);
  if (receipt === undefined) {
    return (
      `the ${which} screenshot ${slot.image.url} has no upload receipt: a picture reaches a description only ` +
      "through `slopweaver github attach upload`, which checks, uploads and reads it back first"
    );
  }
  const capture = readCaptureRecord({ captureId: receipt.image.captureId, home });
  if (capture.isErr() || capture.value === null) {
    return `the ${which} screenshot's capture receipt ${receipt.image.captureId} cannot be read, so the reviewer has no file to open`;
  }
  return {
    file: capture.value.final.path,
    image: {
      proves: receipt.image.proves,
      receiptId: receipt.uploadReceiptId,
      sha256: receipt.readBack.digest.slice("sha256:".length),
      url: slot.image.url,
    },
  };
}

/**
 * The images a form's body shows, each matched to its upload receipt.
 *
 * @param home the state home holding the upload and capture receipts
 * @param form the form whose proof slots are read
 * @returns each image with its local file, or one line per screenshot that cannot be shown
 */
export function descriptionImagesOf({ home, form }: { home: string; form: PrForm }): {
  readonly images: readonly DescriptionImageInput[];
  readonly problems: readonly string[];
} {
  const receipts = uploadReceiptsByHref({ home });
  const images: DescriptionImageInput[] = [];
  const problems: string[] = [];
  const slots = [
    { slot: form.problemProof, which: "problem" },
    { slot: form.solutionProof, which: "solution" },
  ];
  for (const { slot, which } of slots) {
    const found = slotImage({ home, receipts, slot, which });
    if (typeof found === "string") {
      problems.push(found);
    } else if (found !== undefined) {
      images.push(found);
    }
  }
  return { images, problems };
}

/** The files a refused write leaves for its reviewer. */
interface PendingPacket {
  readonly bodyFile: string;
  readonly commentsFile: string;
  readonly imagesFile: string | undefined;
}

/** Write the exact body, comments and image list a reviewer must see, and return the paths. */
function writePendingPacket({
  home,
  body,
  comments,
  images,
}: {
  home: string;
  body: string;
  comments: readonly DescriptionReviewComment[];
  images: readonly DescriptionImageInput[];
}): PendingPacket {
  const dir = join(stateHomePaths({ home }).prDescriptionReviews, "pending");
  mkdirSync(dir, { recursive: true });
  const commentsText = descriptionCommentsText({ comments });
  // The stem covers the comments too, so two writes with one body and different comments never share a file.
  const stem = createHash("sha256").update(body).update("\0").update(commentsText).digest("hex").slice(0, 16);
  const bodyFile = join(dir, `${stem}.md`);
  writeFileSync(bodyFile, body, "utf8");
  const commentsFile = join(dir, `${stem}.comments.json`);
  writeFileSync(commentsFile, commentsText, "utf8");
  if (images.length === 0) {
    return { bodyFile, commentsFile, imagesFile: undefined };
  }
  const imagesFile = join(dir, `${stem}.images.json`);
  const listed = images.map(({ file, image }) => ({ ...image, file }));
  writeFileSync(imagesFile, safeJsonStringify({ label: "description images", value: listed }), "utf8");
  return { bodyFile, commentsFile, imagesFile };
}

/**
 * The command that prepares a review of exactly these bytes.
 *
 * @returns the shell-quoted `review-prepare` command line
 */
export function reviewPrepareCommand({
  write,
  bodyFile,
  commentsFile,
  imagesFile,
}: {
  write: DescriptionWrite;
  bodyFile: string;
  commentsFile: string;
  imagesFile: string | undefined;
}): string {
  const { form } = write;
  const command = [
    "slopweaver",
    "github",
    "pr",
    "review-prepare",
    "--repo",
    `${form.target.owner}/${form.target.repo}`,
    "--base",
    form.target.base,
    "--head",
    write.headRef,
    "--branch",
    form.target.head,
    "--cwd",
    write.repoDir,
    "--title",
    form.title,
    "--body-file",
    bodyFile,
    "--comments",
    commentsFile,
    ...(write.pullRequest.kind === "new" ? ["--new"] : ["--number", String(write.pullRequest.number)]),
    ...(imagesFile === undefined ? [] : ["--images", imagesFile]),
  ];
  return shellCommandLine({ command });
}

/** The comments already on the pull request a write names: none for one being opened, else read whole. */
async function existingCommentsOf({
  readComments,
  write,
}: {
  readComments: DescriptionReviewCommentsReader;
  write: DescriptionWrite;
}): Promise<Result<readonly ExistingPullRequestComment[], DescriptionReviewError>> {
  if (write.pullRequest.kind === "new") {
    return ok([]);
  }
  const { owner, repo } = write.form.target;
  return readComments({ home: write.home, number: write.pullRequest.number, owner, repo });
}

/**
 * The check over one comment reader: match the images, read the existing comments, ask the gate, and on a refusal
 * leave the exact packet behind.
 *
 * @param readComments reads the comments already on an open pull request; a test passes a plain function
 * @returns the check
 */
export function makeDescriptionReviewCheck({
  readComments,
}: {
  readComments: DescriptionReviewCommentsReader;
}): DescriptionReviewCheck {
  return async (write) => {
    const { images, problems } = descriptionImagesOf({ form: write.form, home: write.home });
    if (problems.length > 0) {
      return { kind: "refused", lines: problems };
    }
    const existing = await existingCommentsOf({ readComments, write });
    if (existing.isErr()) {
      return { kind: "refused", lines: [existing.error.message] };
    }
    return checkReviewed({ existingComments: existing.value, images, write });
  };
}

/** The gate over everything the write sends and everything already on the pull request. */
function checkReviewed({
  existingComments,
  images,
  write,
}: {
  existingComments: readonly ExistingPullRequestComment[];
  images: readonly DescriptionImageInput[];
  write: DescriptionWrite;
}): DescriptionReviewVerdict {
  const { home, form, body } = write;
  const verdict = requireCleanDescriptionReview({
    description: {
      baseBranch: form.target.base,
      baseRef: `origin/${form.target.base}`,
      body,
      comments: write.comments,
      existingComments,
      headRef: write.headRef,
      images: images.map(({ image }) => image),
      installedRulesRoot: installedRulesRoot(),
      repoDir: write.repoDir,
      repository: `${form.target.owner}/${form.target.repo}`,
      title: form.title,
    },
    home,
  });
  if (verdict.isOk()) {
    // The receipt binds a change digest, not a commit, so the commit it was read at is resolved here, from the same
    // checkout and ref the gate just digested.
    const change = computeChangeDigest({
      baseRef: `origin/${form.target.base}`,
      headRef: write.headRef,
      repoDir: write.repoDir,
    });
    if (change.isErr()) {
      return { kind: "refused", lines: [change.error.message] };
    }
    return { boundHead: change.value.headSha, kind: "clear" };
  }
  const pending = writePendingPacket({ body, comments: write.comments, home, images });
  return {
    kind: "refused",
    lines: [
      verdict.error.message,
      `the exact body this write sends is at ${pending.bodyFile}, its comments at ${pending.commentsFile}; prepare its review with:`,
      `  ${reviewPrepareCommand({ ...pending, write })}`,
    ],
  };
}

/** The production check, reading an open pull request's comments from GitHub. */
export const productionDescriptionReviewCheck: DescriptionReviewCheck = makeDescriptionReviewCheck({
  readComments: readDescriptionComments,
});

/**
 * A check that always clears, for a test exercising another part of a write.
 * @internal — production writes take {@link productionDescriptionReviewCheck}.
 *
 * @returns clear
 */
export const clearDescriptionReview: DescriptionReviewCheck = () =>
  Promise.resolve({ boundHead: undefined, kind: "clear" });
