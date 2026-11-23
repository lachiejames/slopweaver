/**
 * The ONE boundary every image crosses on its way to Slack: read the bytes, name them, find what was
 * recorded about them, judge the whole batch, and hand back the exact bytes that were judged.
 *
 * ## Why this returns the bytes rather than a yes/no
 *
 * Because a yes/no leaves a re-read, and a re-read is a hole. `answerDigestOf` hashes the answer's JSON, so
 * before attachments carried digests the reviewed digest covered only the PATHS — replace the PNG at the
 * same path and every verdict about it still bound. If this function said "admitted" and its caller then
 * called `readFile` again, the same gap would reopen one layer down. So the bytes admitted here are the
 * bytes sent, and no caller reopens a path between the two. `lockUploads` already learned this once; its
 * header says "a path alone is not a proof".
 *
 * ## The whole batch, before the first upload
 *
 * `uploadAll` in `../corpus/slack/writeSend.ts` uploads members one at a time, so a batch judged per member
 * could put a good first image in the channel and then refuse. A reader would see half an evidence set and
 * no refusal at all. Everything is therefore read, hashed and judged before anything is offered to Slack.
 *
 * ## The hatch is consulted LAST, and only for the missing arm
 *
 * {@link imageAdmissionVerdict} returns the ARM, and this function branches on it: only `missing` ever
 * reaches `hatchOpen`. A `known-bad` verdict returns before the environment is read at all, which is what
 * makes "an image you have written down as bad has no way out" true of the control flow rather than of a
 * comment. The `unread-image` row is `journalled`, so the one route is `slopweaver hatch open
 * unread-image --reason "<why>"`, a grant `hatchOpen` reads off the journal and no variable can stand in for.
 *
 * ## An attachment that is not a picture is carried, and is asked nothing
 *
 * {@link resolveBatch} has three arms, not two, and their ORDER is the property. `identifyImageBytes` runs
 * FIRST, so a buffer that decodes is an image whatever its first bytes say and nothing can sniff its way
 * past the record store. Only what Jimp refuses is offered to `attachmentKindOf`
 * (`./attachmentKind.ts`), which identifies a closed set of non-pictures — a PDF, a zip container, a
 * markdown deliverable, an MP4 or QuickTime video — from their bytes. Those are pushed to `uploads` and contribute **no**
 * {@link ResolvedImageEvidence}, so {@link imageAdmissionVerdict} is never asked a question about them and
 * the `missing` arm cannot fire for one: a PDF goes out on `exceptionOpened: false`, never on the hatch.
 * Bytes that neither decode nor identify keep today's refusal, which is what leaves a WebP, an AVIF, a HEIC
 * and an SVG unsendable — every one of them a picture Jimp cannot read and Slack can render.
 *
 * **So `uploads` and `evidence` are NOT positionally aligned.** `uploads` holds every input in the caller's
 * order; `evidence` holds one entry per IMAGE, in image order. Zipping them is a defect.
 */

import { readFile } from "node:fs/promises";
import { basename } from "node:path";

import { err, ok, type Result } from "#lib/result.js";
import type { SlackUpload } from "../corpus/slack/writeTransport.js";
import { hatchOpen } from "../hatch/open.js";
import { admissionErrorOf, imageAdmissionVerdict, type ResolvedImageEvidence } from "./admission.js";
import type { ImageAdmit } from "./admitUploads.js";
import { attachmentKindOf } from "./attachmentKind.js";
import { type ImageAdmissionError, ImageAdmissionErrors } from "./errors.js";
import { identifyImageBytes } from "./imageIo.js";
import { readImageRecords } from "./store.js";
import type { ImageRef } from "./types.js";

/**
 * One attachment offered for admission.
 *
 * A closed union of the two ways bytes arrive, and neither carries an "approved" flag: a caller can say
 * where the bytes are or hand them over, never that they are fine.
 */
export type ImageUploadInput =
  /** A file on disk the composer named, with the reference the form carried. */
  | { readonly kind: "path"; readonly ref: ImageRef }
  /** Bytes restored from a held draft, whose reference travelled with them. */
  | { readonly kind: "bytes"; readonly ref: ImageRef; readonly bytes: Uint8Array; readonly filename: string };

/** The admitted batch: the exact bytes judged, ready to hand to the send transport unchanged. */
export interface PreparedImageBatch {
  readonly uploads: readonly SlackUpload[];
  /**
   * What admission resolved per IMAGE, for the caller's own record of why this went out.
   *
   * One entry per image in image order, so it is SHORTER than {@link uploads} whenever the batch carried a
   * document — see this module's header on why a non-picture is asked nothing. Never zip the two.
   */
  readonly evidence: readonly ResolvedImageEvidence[];
  /** Set when the batch went out on the missing-record exception rather than on records. */
  readonly exceptionOpened: boolean;
}

/**
 * Read one input's bytes.
 *
 * @param input the attachment
 * @returns its bytes and the filename Slack would show, or why they could not be read
 */
async function bytesOf({ input }: { input: ImageUploadInput }): Promise<Result<SlackUpload, ImageAdmissionError>> {
  if (input.kind === "bytes") {
    return ok({ bytes: input.bytes, filename: input.filename });
  }
  try {
    // A fresh copy rather than a view: `readFile` already allocates one, and nothing else holds it, so the
    // bytes hashed below are the bytes sent and no caller can mutate them in between.
    return ok({ bytes: await readFile(input.ref.path), filename: basename(input.ref.path) });
  } catch (error) {
    return err(ImageAdmissionErrors.storeFailed({ cause: error }));
  }
}

/**
 * Read, name and look up every attachment, before anything is judged.
 *
 * Split from {@link prepareImageUploads} so that reading the world and deciding about it stay separate:
 * this function has no opinion about what it found, and the caller reads no files.
 *
 * @param home the state home the records live under
 * @param inputs every attachment this send would upload, in attach order
 * @returns every input's bytes in attach order, and what the store holds about the IMAGES among them — the
 *   two arrays do not correspond, see this module's header — or why the batch could not be resolved
 */
async function resolveBatch({
  home,
  inputs,
}: {
  home: string;
  inputs: readonly ImageUploadInput[];
}): Promise<
  Result<{ uploads: readonly SlackUpload[]; evidence: readonly ResolvedImageEvidence[] }, ImageAdmissionError>
> {
  const uploads: SlackUpload[] = [];
  const evidence: ResolvedImageEvidence[] = [];
  const undecodable: string[] = [];
  for (const input of inputs) {
    const read = await bytesOf({ input });
    if (read.isErr()) {
      return err(read.error);
    }
    const identified = await identifyImageBytes({ bytes: read.value.bytes });
    if (identified.isErr()) {
      // Undecodable is not a "not an image, so not governed" bypass. It is one of two things, and only the
      // IDENTIFIED one is carried: a document this door recognises has no read-back to ask about, while
      // bytes nothing here can name may well be a picture in a format Jimp lacks, so they stay refused.
      if (attachmentKindOf({ bytes: read.value.bytes, filename: read.value.filename }) === undefined) {
        undecodable.push(`${input.ref.path}: ${identified.error.message}`);
      } else {
        uploads.push(read.value);
      }
      continue;
    }
    const records = readImageRecords({ digest: identified.value.digest, home });
    if (records.isErr()) {
      return err(records.error);
    }
    uploads.push(read.value);
    evidence.push({ artifact: identified.value, records: records.value, ref: input.ref });
  }
  if (undecodable.length > 0) {
    return err(ImageAdmissionErrors.evidenceInvalid({ issues: undecodable }));
  }
  return ok({ evidence, uploads });
}

/**
 * Which of these uploads are DOCUMENTS rather than pictures — the answer form's lane check.
 *
 * Admission carrying a document (see this module's header) is right for `--media`, which has one lane and
 * must take both. It would be a loosening on the bot answer, which has two: a PDF placed in the form's
 * `images` array used to be refused outright here, and without this would instead reach
 * `../admit/imageObservationCoverage.ts` as an unobserved attachment — a `warn` an operator can waive. So
 * the answer lanes ask this before they send and refuse the misplacement themselves, naming the lane that
 * takes it, and stay exactly as strict as they were.
 *
 * Same two steps in the same order as {@link resolveBatch}, for the same reason: a buffer that DECODES is a
 * picture and is never reported here, whatever its first bytes say.
 *
 * @param uploads the bytes the caller is about to offer as images
 * @returns the filenames that are not pictures, in the caller's order, empty when every one is
 */
export async function documentsAmongUploads({
  uploads,
}: {
  uploads: readonly SlackUpload[];
}): Promise<readonly string[]> {
  const misplaced: string[] = [];
  for (const upload of uploads) {
    const identified = await identifyImageBytes({ bytes: upload.bytes });
    if (identified.isErr() && attachmentKindOf({ bytes: upload.bytes, filename: upload.filename }) !== undefined) {
      misplaced.push(upload.filename);
    }
  }
  return misplaced;
}

/**
 * Admit a whole batch of attachments, or say why none of them may go.
 *
 * @param home the state home the records live under — explicit, never the ambient one
 * @param inputs every attachment this send would upload, in attach order
 * @param env where the missing-record hatch is read from
 * @param nowIso the instant a journalled grant is judged against
 * @returns the admitted bytes, or the typed refusal
 */
export async function prepareImageUploads({
  home,
  inputs,
  env,
  nowIso,
}: {
  home: string;
  inputs: readonly ImageUploadInput[];
  env: Readonly<Record<string, string | undefined>>;
  nowIso: string;
}): Promise<Result<PreparedImageBatch, ImageAdmissionError>> {
  const resolved = await resolveBatch({ home, inputs });
  if (resolved.isErr()) {
    return err(resolved.error);
  }
  const { uploads, evidence } = resolved.value;
  const verdict = imageAdmissionVerdict({ evidence });
  if (verdict.kind === "admitted") {
    return ok({ evidence, exceptionOpened: false, uploads });
  }
  // Only the missing arm is hatchable. A hold returns above the environment read, by control flow.
  if (verdict.kind === "missing") {
    const open = hatchOpen({ env, home, id: "unread-image", nowIso });
    if (open) {
      return ok({ evidence, exceptionOpened: true, uploads });
    }
  }
  const error = admissionErrorOf({ verdict });
  if (error === undefined) {
    return ok({ evidence, exceptionOpened: false, uploads });
  }
  return err(error);
}

/**
 * Build the {@link ImageAdmit} the Slack send boundary calls, for one home.
 *
 * ## Byte-keyed, because the boundary has nothing else
 *
 * By the time bytes reach `runCompositeSend` and its three siblings, the form's own `images` references are
 * long gone — the drip lane keyed them by path, `--media` never had any, and a held release restored raw
 * bytes. That is fine, and it is the reason the record store is indexed by digest: this seam hashes what it
 * is about to send and asks the store about THOSE bytes. A caller cannot route around it by omitting a
 * reference, because it never reads one.
 *
 * The reference handed to the pure judge is therefore synthesised from the bytes themselves, so the
 * reference-agreement checks are trivially satisfied and what actually decides is the part that matters: is
 * there a record for these exact bytes, does it describe them, and does it say they may be sent.
 *
 * @param home the state home the records live under
 * @param env where the missing-record hatch is read from
 * @param nowIso the instant a journalled grant is judged against
 * @returns the seam to hand to a composite send
 */
export function imageAdmitFor({
  home,
  env,
  nowIso,
}: {
  home: string;
  env: Readonly<Record<string, string | undefined>>;
  nowIso: string;
}): ImageAdmit {
  return async ({ uploads }) => {
    const prepared = await prepareUploadBytes({ env, home, nowIso, uploads });
    if (prepared.isErr()) {
      return err(prepared.error);
    }
    return ok(null);
  };
}

/**
 * Admit bytes that are already in hand — the one judgement {@link imageAdmitFor} runs at the Slack send
 * boundary, returned whole so a caller that must KEEP the admitted bytes (a parked draft) holds exactly
 * the batch the send boundary would have judged.
 *
 * @param home the state home the records live under
 * @param env where the missing-record hatch is read from
 * @param nowIso the instant a journalled grant is judged against
 * @param uploads every attachment, in attach order, with the filename Slack would show
 * @returns the admitted batch, or the typed refusal
 */
export async function prepareUploadBytes({
  home,
  env,
  nowIso,
  uploads,
}: {
  home: string;
  env: Readonly<Record<string, string | undefined>>;
  nowIso: string;
  uploads: readonly SlackUpload[];
}): Promise<Result<PreparedImageBatch, ImageAdmissionError>> {
  const inputs = await Promise.all(
    uploads.map(async (upload) => {
      const identified = await identifyImageBytes({ bytes: upload.bytes });
      const digest = identified.isOk() ? identified.value.digest : "";
      return {
        bytes: upload.bytes,
        filename: upload.filename,
        kind: "bytes" as const,
        ref: { artifactDigest: digest, path: upload.filename },
      };
    }),
  );
  return prepareImageUploads({ env, home, inputs, nowIso });
}

/**
 * Read every path ONCE and admit the bytes read, exactly as `slack post --media` would judge them at its
 * send boundary: the same `readFile` + `basename` its media read performs, then {@link prepareUploadBytes}.
 *
 * @param home the state home the records live under
 * @param env where the missing-record hatch is read from
 * @param nowIso the instant a journalled grant is judged against
 * @param paths the files the caller named, in attach order
 * @returns the admitted batch holding the exact bytes read, or the first unreadable path's refusal
 */
export async function prepareMediaPaths({
  home,
  env,
  nowIso,
  paths,
}: {
  home: string;
  env: Readonly<Record<string, string | undefined>>;
  nowIso: string;
  paths: readonly string[];
}): Promise<Result<PreparedImageBatch, ImageAdmissionError>> {
  const uploads: SlackUpload[] = [];
  for (const path of paths) {
    const read = await bytesOf({ input: { kind: "path", ref: { artifactDigest: "", path } } });
    if (read.isErr()) {
      return err(read.error);
    }
    uploads.push(read.value);
  }
  return prepareUploadBytes({ env, home, nowIso, uploads });
}
