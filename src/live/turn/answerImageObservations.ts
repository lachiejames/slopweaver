/**
 * The effectful half of the reviewer's image observations: which bytes each attachment really is, and
 * writing a reviewer's "I opened it and it is unreadable" into the durable store before anything is sent.
 *
 * ## Why the reviewer's refusal has to become a RECORD rather than only a finding
 *
 * A door finding governs one send. The owner's rule is stronger: the mistake must be structurally impossible to repeat, so
 * any
 * `failed` `ImageRecord` for a digest refuses those bytes through every upload lane, forever, with no hatch
 * (`../../visualEvidence/admission.ts`). So when a verdict says a picture is unfit, the same sentence that
 * refuses this send is written down against the picture's own bytes, and re-attaching the identical file
 * from a different path, a different verb or a later turn is refused by PR1 without this module running at
 * all.
 *
 * The write happens BEFORE the door decides, and the ordering is the property: a refusal that is not
 * durable is a refusal that only holds while somebody is watching.
 *
 * ## The correspondence between an answer's paths and its uploads, stated rather than assumed
 *
 * `SlackUpload` is `{ filename, bytes }` and nothing more — `loadSlackUploads`
 * (`../../corpus/slack/uploadFiles.ts`) reads `answer.images` in order and names each by `basename`, so the
 * path a picture came from is not carried on the upload. {@link bindAnswerUploads} re-establishes it
 * POSITIONALLY, refusing a length mismatch and a filename that is not the basename of its path, rather than
 * matching on filename — two attachments legitimately share a basename, and identity by filename would
 * silently swap their observations.
 *
 * Every digest here is computed from the bytes being UPLOADED, never by re-reading the path: the file could
 * change between the read and the send, and a check against bytes nobody is sending proves nothing about
 * the send. The bytes are copied once on entry for the same reason — the copy that is hashed is the copy
 * that goes out.
 *
 * ## What this does NOT make durable, stated rather than left to be found
 *
 * Four cases end the send without leaving a record behind. In every one of them nothing is posted — the
 * whole answer is refused rather than the one attachment, which is the stricter outcome — so what is lost
 * is durability, never containment. All four were found by Codex reviews of this change and all four are
 * left as they are:
 *
 * - **A verdict FILE that will not parse never reaches here.** `../../admit/reviewVerdictFile.ts` refuses an
 *   incoherent observation — one that recorded a defect and named no `unfitReason`, say — and
 *   `../../cli/commands/turn/postAnswer.ts` returns before `offerAnswer` runs. Loosening the parse so a
 *   half-written observation could reach the store would trade a real refusal for a durable record of
 *   something nobody stated completely.
 * - **A corrupt or unreadable record file for the picture's own digest**, and **an append that fails**.
 *   Both are operational failures, and claiming the bytes were terminally refused when nothing was written
 *   is the shape this domain exists to close.
 * - **An attachment nothing can decode AND nothing can name** — a WebP, say, which the pinned Jimp does not
 *   read. A record needs the dimensions the bytes actually decode to, and there is no honest way to write
 *   one without them. This costs nothing, because `../../visualEvidence/prepareUploads.ts` reports those
 *   bytes as `evidenceInvalid` on every one of the six upload lanes rather than waving them through: they
 *   are already unsendable everywhere, by a mechanism that needs no record. The qualifier is load-bearing —
 *   an undecodable attachment that `../../visualEvidence/attachmentKind.ts` positively identifies as a
 *   DOCUMENT is carried rather than refused, and it reaches this module on the images lane only if a
 *   composer misfiled it, which `documentsAmongUploads` refuses at `../../cli/commands/turn/postAnswer.ts`
 *   before any of this runs.
 */

import { randomUUID } from "node:crypto";
import { basename } from "node:path";

import { err, ok, type Result } from "#lib/result.js";
import type { AttachedReviewImage } from "../../admit/imageObservationCoverage.js";
import { imageObservationUnfitReasons } from "../../admit/imageObservationCoverage.js";
import type { ReviewedImage } from "../../admit/reviewVerdict.js";
import type { SlackUpload } from "../../corpus/slack/writeTransport.js";
import { identifyImageBytes, imageDigestOf } from "../../visualEvidence/imageIo.js";
import { appendImageRecord, readImageRecords } from "../../visualEvidence/store.js";
import type { ImageFailureReason, ImageRecord } from "../../visualEvidence/types.js";
import { IMAGE_POLICY_VERSION } from "../../visualEvidence/types.js";
import { type TurnError, TurnErrors } from "./turnErrors.js";

/**
 * One upload this module owns a copy of, named by what its bytes hash to.
 *
 * It carries no path on purpose. Which file a picture came from is a question about the ANSWER, and
 * {@link bindAnswerUploads} answers it; what these bytes ARE is a question about the bytes, and persisting
 * a reviewer's failure is only ever about that. Keeping them separate is what stops a broken path
 * correspondence deciding whether an unreadable picture gets condemned.
 */
export interface OwnedUpload {
  /** `sha256:<64 hex>` over {@link upload}'s bytes. */
  readonly digest: string;
  /** The upload itself, holding this module's own copy of the bytes. */
  readonly upload: SlackUpload;
}

/** One owned upload, plus the path the answer's `images` named it at. */
export interface BoundAnswerUpload extends OwnedUpload {
  /** The path from the answer's `images`, in attach order. */
  readonly path: string;
}

/**
 * Take this module's own copy of every upload and name it by its digest.
 *
 * A copy, not a view: the bytes that are hashed must be the bytes that go out, and a caller holding the
 * original could otherwise mutate it between the check and the send. Runs before anything can fail, so a
 * later refusal still has the real bytes to write a record about.
 *
 * @param uploads the bytes this send would upload, in attach order
 * @returns one owned copy per upload, in the same order
 */
export function ownedUploads({ uploads }: { uploads: readonly SlackUpload[] }): readonly OwnedUpload[] {
  return uploads.map((upload) => {
    const bytes = Uint8Array.from(upload.bytes);
    return { digest: imageDigestOf({ bytes }), upload: { bytes, filename: upload.filename } };
  });
}

/**
 * Pair every image path with the upload carrying its bytes, and say so if they do not correspond.
 *
 * Positional, because that is the only correspondence the two lists actually have; a filename match would
 * pair two same-named attachments the wrong way round without anything noticing. The basename check is
 * what makes the positional assumption falsifiable rather than a comment.
 *
 * @param paths the answer's `images`, in attach order
 * @param owned the owned copies of the bytes read for them, in the same order
 * @returns the bound attachments, or every way the two lists disagree
 */
export function bindAnswerUploads({
  paths,
  owned,
}: {
  paths: readonly string[];
  owned: readonly OwnedUpload[];
}): Result<readonly BoundAnswerUpload[], TurnError> {
  if (paths.length !== owned.length) {
    return err(TurnErrors.uploadCountMismatch({ paths: paths.length, uploads: owned.length }));
  }
  const bound: BoundAnswerUpload[] = [];
  const mismatches: { index: number; filename: string; path: string }[] = [];
  for (const [index, path] of paths.entries()) {
    const attachment = owned[index]!;
    if (attachment.upload.filename !== basename(path)) {
      mismatches.push({ filename: attachment.upload.filename, index, path });
      continue;
    }
    bound.push({ ...attachment, path });
  }
  return mismatches.length > 0 ? err(TurnErrors.uploadsOutOfOrder({ mismatches })) : ok(bound);
}

/**
 * The attachments as the coverage gate sees them — the path named and the bytes found, nothing else.
 *
 * @param bound the bound attachments
 * @returns one `AttachedReviewImage` per attachment, in attach order
 */
export function attachedReviewImages({
  bound,
}: {
  bound: readonly BoundAnswerUpload[];
}): readonly AttachedReviewImage[] {
  return bound.map((attachment) => ({ digest: attachment.digest, path: attachment.path }));
}

/** What to do about each closed reason — the `correction` half of the four-line refusal contract. */
const CORRECTION: Readonly<Record<ImageFailureReason, string>> = {
  "context-lost":
    "crop again so the axes, the query and the time range stay in frame, then have the new bytes reviewed",
  illegible:
    "capture the target region rather than the whole page so the picture reads at preview size, then have " +
    "the new bytes reviewed",
  "empty-panel":
    "capture again once the panel the claim rests on has actually rendered, then have the new bytes reviewed",
  obscured: "dismiss the pop-up, banner or modal and capture again, then have the new bytes reviewed",
  unloaded: "capture again once the page has finished rendering, then have the new bytes reviewed",
};

/**
 * The reason to record for one unfit observation.
 *
 * Prefers what the reviewer declared, and falls back to the first defect its own fields show. The fallback
 * is not decoration: the parse edge refuses a verdict FILE whose reason and observations disagree, but this
 * module is also reachable from a typed caller that built a `ReviewedImage` directly, and a missing optional
 * field must never be able to turn an unfit picture into a fit one.
 *
 * @param observation the reviewer's observation, already known to be unfit
 * @param reasons every defect its observed fields show, never empty here
 * @returns the reason the record carries
 */
function recordedReason({
  observation,
  reasons,
}: {
  observation: ReviewedImage;
  reasons: readonly ImageFailureReason[];
}): ImageFailureReason {
  if (observation.unfitReason !== undefined && reasons.includes(observation.unfitReason)) {
    return observation.unfitReason;
  }
  return reasons[0]!;
}

/**
 * Build the durable failure for one unfit attachment.
 *
 * The framing arm is `reviewer-unobserved`, which exists for exactly this record: a reviewer did not take
 * the picture and has no honest way to describe how it was cropped, while `already-framed` would be a lie
 * whenever the composer cropped. `captureId` is omitted — this is a look at existing bytes, not a new
 * capture attestation.
 *
 * @param artifact what the uploaded bytes actually decode to
 * @param observation the reviewer's observation of them
 * @param reviewerSession how the reviewing session named itself
 * @param nowIso the instant this observation is recorded at
 * @returns the record to append
 */
function reviewerFailureRecord({
  artifact,
  observation,
  reviewerSession,
  nowIso,
}: {
  artifact: ImageRecord["artifact"];
  observation: ReviewedImage;
  reviewerSession: string;
  nowIso: string;
}): ImageRecord {
  const reason = recordedReason({ observation, reasons: imageObservationUnfitReasons({ observation }) });
  return {
    artifact,
    correction: CORRECTION[reason],
    crop: {
      kind: "reviewer-unobserved",
      reason: "recorded by the answer's reviewer, which did not take the picture and did not see how it was framed",
    },
    outcome: "failed",
    policyVersion: IMAGE_POLICY_VERSION,
    readBack: {
      contextRetained: observation.contextRetained,
      observedAtIso: nowIso,
      observedContent: observation.observedContent,
      observerSession: reviewerSession,
      targetState: observation.targetState,
    },
    reason,
    receiptId: `img-${randomUUID()}`,
    schemaVersion: 1,
  };
}

/**
 * Write a `failed` record for every attached picture this verdict recorded unfit.
 *
 * Selected by attached DIGEST, which is a different question from coverage and deliberately a weaker one.
 * Coverage asks whether the reviewer looked at the picture the answer NAMES, so it matches the
 * `(path, digest)` pair; this asks whether the reviewer looked at these BYTES, and the path it wrote them
 * down under cannot change what it saw. Matching the pair here was a defect a Codex review found: the same
 * unreadable PNG re-attached from a second path produced the hold and no durable record, so the bytes were
 * refused this once and admissible the next time anybody quoted the right path.
 *
 * An observation whose digest is NOT attached — a stale one, left behind when the file at a reviewed path
 * was replaced — still condemns nothing: those are different bytes, nobody has looked at them, and a
 * failure recorded against them would be a lie. The coverage gate reports that as `stale`.
 *
 * Runs whatever else the verdict says. A `clean` outcome, a stale answer digest or a coverage warning must
 * not suppress a negative observation about bytes that are actually present — those are questions about the
 * verdict, and this is a fact about a picture.
 *
 * **A store failure is an operational failure, not a durable refusal.** When a record cannot be built or
 * appended this returns the error and the caller must send nothing: reporting the bytes terminally refused
 * when nothing was written would be the "a check that cannot fail reports clean" shape this domain exists to
 * close. Every observation is still processed — one unreadable record file must not decide whether a second,
 * unrelated picture gets condemned — and the errors come back together. Records already appended stay
 * written; there is no rollback, and none is wanted.
 *
 * Existing failures are read first and skipped, so a re-offered answer does not pile identical rows up.
 * That read and the append are not atomic: two sessions offering the same answer at once can both find no
 * failure and both append. The window is named rather than closed, because its outcome is two valid audit
 * rows about the same true fact, never an admitted picture.
 *
 * @param attached every picture this send carries, as owned copies named by their digests — no path, because
 *   binding a path is a question about the ANSWER and a failure to bind one must not decide whether an
 *   unreadable picture is condemned
 * @param observations what the reviewer wrote down, empty when it wrote nothing
 * @param reviewerSession how the reviewing session named itself, recorded as the observer
 * @param home the state home the records live under — explicit, never the ambient one
 * @param nowIso the instant each record is stamped with
 * @returns nothing once every required failure is durable, or why one could not be written
 */
export async function persistUnfitImageObservations({
  attached,
  observations,
  reviewerSession,
  home,
  nowIso,
}: {
  attached: readonly OwnedUpload[];
  observations: readonly ReviewedImage[];
  reviewerSession: string;
  home: string;
  nowIso: string;
}): Promise<Result<null, TurnError>> {
  const recorded = new Set<string>();
  const failures: TurnError[] = [];
  for (const observation of observations) {
    if (imageObservationUnfitReasons({ observation }).length === 0) {
      continue;
    }
    const match = attached.find((attachment) => attachment.digest === observation.artifactDigest);
    if (match === undefined || recorded.has(match.digest)) {
      continue;
    }
    recorded.add(match.digest);
    const written = await recordOneFailure({ home, match, nowIso, observation, reviewerSession });
    if (written.isErr()) {
      // Collected, never returned early. Returning on the FIRST failure left every later unfit picture
      // unrecorded even where its own store was perfectly writable — so one corrupt record file decided
      // whether a second, unrelated picture was condemned. Found by a Codex review of this change; the
      // whole sequence runs, and the caller still refuses the send because the list is non-empty.
      failures.push(written.error);
    }
  }
  return failures.length > 0 ? err(TurnErrors.imageObservationsUnrecorded({ failures })) : ok(null);
}

/**
 * Read what the store already holds for one digest, and append the reviewer's failure when none stands.
 *
 * Split out so {@link persistUnfitImageObservations} stays the selection rule and this stays the write.
 *
 * @param home the state home the records live under
 * @param match the owned upload being condemned
 * @param nowIso the instant the record is stamped with
 * @param observation the reviewer's observation of it
 * @param reviewerSession how the reviewing session named itself
 * @returns nothing once the failure is durable, or why it is not
 */
async function recordOneFailure({
  home,
  match,
  nowIso,
  observation,
  reviewerSession,
}: {
  home: string;
  match: OwnedUpload;
  nowIso: string;
  observation: ReviewedImage;
  reviewerSession: string;
}): Promise<Result<null, TurnError>> {
  const existing = readImageRecords({ digest: match.digest, home });
  if (existing.isErr()) {
    return err(
      TurnErrors.imageRecordFailed({ cause: existing.error.message, filename: match.upload.filename, stage: "read" }),
    );
  }
  // The row's OWN digest has to match, not just the file it was found in. `readImageRecords` validates each
  // row against the schema and never against the filename, so a record misfiled under another digest would
  // otherwise read as "these bytes already failed" and suppress the append that should have happened. Found
  // by a Codex review of this change; `admission.ts` catches a misfiled record separately, as unbelievable.
  const alreadyFailed = existing.value.some(
    (record) => record.outcome === "failed" && record.artifact.digest === match.digest,
  );
  if (alreadyFailed) {
    return ok(null);
  }
  const identified = await identifyImageBytes({ bytes: match.upload.bytes });
  if (identified.isErr()) {
    return err(
      TurnErrors.imageRecordFailed({
        cause: identified.error.message,
        filename: match.upload.filename,
        stage: "decode",
      }),
    );
  }
  const record = reviewerFailureRecord({ artifact: identified.value, nowIso, observation, reviewerSession });
  // `appendImageRecord` runs the read schema before it writes, so a record the store could not believe
  // back is refused there as IMAGE_EVIDENCE_INVALID rather than landing and handing these bytes the
  // missing-record exception.
  const appended = appendImageRecord({ home, record });
  return appended.isErr()
    ? err(
        TurnErrors.imageRecordFailed({
          cause: appended.error.message,
          filename: match.upload.filename,
          stage: "append",
        }),
      )
    : ok(null);
}
