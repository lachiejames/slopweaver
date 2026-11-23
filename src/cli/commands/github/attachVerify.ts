/**
 * The two halves of `github attach upload` that bracket the send: the picture checks run over the exact bytes about
 * to go, and the read-back that proves GitHub serves those same bytes before an upload receipt is filed — plus the
 * `--acknowledge` handling between them, which folds a waiver into the door's environment and prints what it waived.
 *
 * Split from `./attachRun.ts`, which owns the session, the door and the output; this file owns what makes an upload
 * citable. Both halves key on ONE buffer: the digest the checks resolved the capture receipt by is the digest the
 * read-back must match.
 */
import { ATTACHMENT_OVERRIDES } from "../../../admit/attachmentGates.js";
import type { DoorFinding } from "../../../admit/types.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { type GithubAttachError, GithubAttachErrors } from "../../../outbound/github/attach.errors.js";
import {
  type AttachEvidence,
  type AttachTextScan,
  attachEvidenceFindings,
  resolveAttachEvidence,
} from "../../../outbound/github/attachEvidence.js";
import type { ClassifiedAttachment } from "../../../outbound/github/attachment.js";
import { readBackAsset, readBackVerdict } from "../../../outbound/github/attachReadBack.js";
import { type GithubUploadReceipt, writeUploadReceipt } from "../../../outbound/github/attachReceipt.js";
import type { UploadedAsset } from "../../../outbound/github/attachUpload.js";
import type { ImageTextError, RecognisedImageText } from "../../../visualEvidence/imageTextRecognition.js";
import { embedAltText, type GithubAttachUploadArgs } from "./attachCore.js";
import type { GithubAttachDeps } from "./attachDeps.js";

/** What the picture checks found for one buffer: its evidence, every hold, and the alt text that was scanned. */
export interface PictureChecks {
  readonly evidence: AttachEvidence;
  readonly findings: readonly DoorFinding[];
  readonly alt: string;
}

/**
 * The picture checks for the exact bytes about to be sent: the evidence the store holds for them, and every hold the
 * capture receipt, the scan, the image checks, the crop rule and the metadata strip raise.
 *
 * @param home the state home the capture receipt and image records are read from
 * @param bytes the buffer that will be uploaded, never a re-read of the path
 * @param pixelText the text recognised in that buffer's pixels, or why it could not be read; `undefined` for a
 *   recording
 * @param scan the publication scan, built from a hygiene policy that loaded before anything was sent
 * @returns the evidence found and the findings, empty when the picture may go
 */
function pictureChecks({
  args,
  home,
  bytes,
  classified,
  pixelText,
  scan,
}: {
  args: GithubAttachUploadArgs;
  home: string;
  bytes: Uint8Array;
  classified: ClassifiedAttachment;
  pixelText: Result<RecognisedImageText, ImageTextError> | undefined;
  scan: AttachTextScan;
}): PictureChecks {
  const evidence = resolveAttachEvidence({ bytes, home });
  const alt = embedAltText({ args, uploadName: classified.fileName });
  const findings = attachEvidenceFindings({
    alt,
    bytes,
    contentType: classified.contentType,
    evidence,
    pixelText,
    proves: args.proves,
    scan,
  });
  return { alt, evidence, findings };
}

/** The one picture type a capture verb writes, and so the one whose pixels are read for text before it uploads. */
const PICTURE_CONTENT_TYPE = "image/png";

/**
 * The one buffer an upload checks and sends, read once before GitHub is contacted, with everything judged over it:
 * the text its pixels show and every picture check. The dry run prints these same checks.
 */
export interface PreparedUpload {
  readonly bytes: Uint8Array;
  readonly file: { readonly bytes: Uint8Array; readonly ref: string; readonly siblings: readonly string[] };
  /** The text recognised in a picture's pixels, or why it could not be read; `undefined` for a recording. */
  readonly pixelText: Result<RecognisedImageText, ImageTextError> | undefined;
  readonly checks: PictureChecks;
}

/**
 * Read the file once and judge that buffer: recognise a picture's text on this machine, then run every picture check
 * over it. A recording is not recognised — its screens are the transcript its receipt already carries.
 *
 * @param args the parsed upload
 * @param deps the injected edges
 * @param home the state home the evidence is read from
 * @param classified what the file was classified as, from its name and size
 * @param scan the publication scan, built before anything was read
 * @returns the prepared upload, or why the file could not be read
 */
export function prepareUpload({
  args,
  deps,
  home,
  classified,
  scan,
}: {
  args: GithubAttachUploadArgs;
  deps: GithubAttachDeps;
  home: string;
  classified: ClassifiedAttachment;
  scan: AttachTextScan;
}): Result<PreparedUpload, GithubAttachError> {
  const bytes = deps.readFileBytes({ path: args.file });
  if (bytes.isErr()) {
    return err(bytes.error);
  }
  const pixelText =
    classified.contentType === PICTURE_CONTENT_TYPE ? deps.recogniseImageText({ bytes: bytes.value }) : undefined;
  // Checked and sent are ONE buffer: the digest the checks resolved the receipt by is the digest of what uploads.
  const checks = pictureChecks({ args, bytes: bytes.value, classified, home, pixelText, scan });
  const file = { bytes: bytes.value, ref: args.file, siblings: deps.listSiblings({ path: args.file }) };
  return ok({ bytes: bytes.value, checks, file, pixelText });
}

/**
 * The environment the door reads, with this call's acknowledgement folded into the override list.
 *
 * `--acknowledge` becomes the gate's own override token for THIS invocation rather than an ambient
 * `SLOPWEAVER_DOOR_OVERRIDE` export: an env var set once waives every later call in the same shell and
 * leaves no trace of which one meant it, while a flag waives exactly the upload it is typed on. The door
 * still writes the waived code to the ledger, so an acknowledged send stays findable afterwards.
 *
 * The reason itself does not reach the ledger, and that is `./attachCore.ts`'s stated property rather than
 * an oversight — `../../../admit/ledger.ts` records the action, the effect, the status and the codes, and
 * deliberately nothing else. It is printed instead, where the person taking the decision reads it.
 *
 * @param acknowledge the reason the caller gave, when they gave one
 * @param env the environment to extend, the process's own in production
 * @returns the environment, with the override token appended when this call is acknowledged
 */
export function acknowledgedEnv({
  acknowledge,
  env,
}: {
  acknowledge: string | undefined;
  env: Readonly<Record<string, string | undefined>>;
}): Readonly<Record<string, string | undefined>> {
  if (acknowledge === undefined) {
    return env;
  }
  const existing = env["SLOPWEAVER_DOOR_OVERRIDE"];
  const tokens = existing === undefined ? ATTACHMENT_OVERRIDES : `${existing},${ATTACHMENT_OVERRIDES}`;
  return { ...env, SLOPWEAVER_DOOR_OVERRIDE: tokens };
}

/**
 * Print each finding `--acknowledge` waived, beside the reason given, where the person deciding reads it — the
 * ledger records the waived code and never the reason.
 *
 * @param acknowledged the reason the caller gave, when they gave one
 * @param overridden the findings the door waived for this call
 */
export function reportWaivers({
  deps,
  acknowledged,
  overridden,
}: {
  deps: Pick<GithubAttachDeps, "writeDiagnostic">;
  acknowledged: string | undefined;
  overridden: readonly DoorFinding[];
}): void {
  if (acknowledged === undefined) {
    return;
  }
  for (const finding of overridden) {
    deps.writeDiagnostic(`${finding.code} waived: ${acknowledged}`);
  }
}

/** An upload GitHub served back byte-identical, and the receipt filed for it. */
export interface VerifiedUpload {
  readonly asset: UploadedAsset;
  readonly receipt: GithubUploadReceipt;
}

/**
 * Fetch the uploaded asset back, require its digest to be the digest checked and sent, and file the upload receipt.
 *
 * @param sentDigest the digest of the one buffer that was checked and uploaded
 * @param checks what the picture checks found for that buffer
 * @param cookieHeader the session the upload went through, which the read-back reuses
 * @returns the verified upload, or why the asset must not be embedded
 */
export async function verifyAndRecord({
  args,
  deps,
  home,
  asset,
  sentDigest,
  checks,
  cookieHeader,
}: {
  args: GithubAttachUploadArgs;
  deps: GithubAttachDeps;
  home: string;
  asset: UploadedAsset;
  sentDigest: string;
  checks: PictureChecks;
  cookieHeader: string;
}): Promise<Result<VerifiedUpload, GithubAttachError>> {
  const served = await readBackAsset({ cookieHeader, fetchAsset: deps.fetchAsset, href: asset.href });
  if (served.isErr()) {
    return err(served.error);
  }
  const verdict = readBackVerdict({ href: asset.href, sentDigest, served: served.value });
  if (verdict.isErr()) {
    return err(verdict.error);
  }
  const { evidence, alt } = checks;
  // The door holds on missing evidence and on a deciding record that did not pass, so this is an invariant guard.
  const deciding = evidence.kind === "found" ? evidence.records.at(-1) : undefined;
  if (evidence.kind === "missing" || deciding?.outcome !== "passed") {
    const cause = new Error("the upload went through with no passed image record behind it");
    return err(GithubAttachErrors.uploadReceiptFailed({ cause, href: asset.href }));
  }
  const receipt: GithubUploadReceipt = {
    asset: { ...asset },
    image: {
      alt,
      captureId: evidence.receipt.captureId,
      captureVerb: evidence.receipt.verb,
      digest: sentDigest,
      heightPx: evidence.receipt.final.artifact.heightPx,
      imageReceiptId: deciding.receiptId,
      proves: args.proves,
      widthPx: evidence.receipt.final.artifact.widthPx,
    },
    readBack: { byteLength: served.value.byteLength, digest: verdict.value, fetchedAtIso: deps.nowIso() },
    schemaVersion: 1,
    target: { number: args.number, owner: args.owner, repo: args.repo },
    uploadedAtIso: deps.nowIso(),
    uploadReceiptId: deps.newUploadReceiptId(),
  };
  const written = writeUploadReceipt({ home, receipt });
  if (written.isErr()) {
    return err(written.error);
  }
  return ok({ asset, receipt });
}
