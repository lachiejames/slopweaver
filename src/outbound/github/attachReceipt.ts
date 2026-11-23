/**
 * The upload receipt: the one record a pull-request description cites when it embeds a picture.
 *
 * Written by `github attach upload` only after the asset was fetched back from GitHub and its digest equalled the
 * digest of the bytes sent (`./attachReadBack.ts`). It joins what the description form needs and nothing it does
 * not: the asset address to embed, the alt text and the one-line statement of what the picture proves, the capture
 * receipt and the image record (the session's viewing) the picture rests on, and the read-back's digest. A form that
 * cites `upl-<id>` can therefore embed exactly the checked picture, with the words that were scanned beside it.
 *
 * One JSON document per receipt under `visual-evidence/uploads`, strict on read so an edited one is refused rather
 * than believed.
 */
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

import { err, ok, type Result } from "#lib/result.js";
import { safeJsonParse, safeJsonStringify } from "#lib/safeJson.js";
import { writeFileAtomic } from "#lib/writeAtomic.js";
import { stateHomePaths } from "../../stateHome.js";
import { type GithubAttachError, GithubAttachErrors } from "./attach.errors.js";

const digestSchema = z.string().regex(/^sha256:[0-9a-f]{64}$/u);

/** An upload receipt's id: `upl-` and a v4 UUID. */
const uploadReceiptIdSchema = z.string().regex(/^upl-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u);

/**
 * The strict schema for one upload receipt.
 * @internal — parsed only by {@link readUploadReceipt}; exported so the type is inferable and a form can embed it.
 */
export const uploadReceiptSchema = z
  .object({
    asset: z
      .object({
        assetId: z.number().int().positive(),
        byteLength: z.number().int().positive(),
        contentType: z.string().min(1),
        href: z.url(),
        uploadName: z.string().min(1),
      })
      .strict(),
    image: z
      .object({
        alt: z.string().min(1),
        captureId: z.string().min(1),
        captureVerb: z.enum([
          "browser shot",
          "browser terminal-shot",
          "browser console-shot",
          "browser redact",
          "proof cassette",
        ]),
        digest: digestSchema,
        heightPx: z.number().int().positive(),
        /** The passed image record that says a session opened these bytes and what it saw. */
        imageReceiptId: z.string().min(1),
        proves: z.string().min(1),
        widthPx: z.number().int().positive(),
      })
      .strict(),
    readBack: z
      .object({ byteLength: z.number().int().positive(), digest: digestSchema, fetchedAtIso: z.string().min(1) })
      .strict(),
    schemaVersion: z.literal(1),
    target: z
      .object({ number: z.number().int().positive(), owner: z.string().min(1), repo: z.string().min(1) })
      .strict(),
    uploadedAtIso: z.string().min(1),
    uploadReceiptId: uploadReceiptIdSchema,
  })
  .strict();

/** One verified upload, as the description form cites it. */
export type GithubUploadReceipt = z.infer<typeof uploadReceiptSchema>;

/**
 * Whether a string is shaped like an upload receipt id — what a form checks before it reads one.
 *
 * @param value the candidate id
 * @returns whether it is `upl-<uuid>`
 */
export function isUploadReceiptId({ value }: { value: string }): boolean {
  return uploadReceiptIdSchema.safeParse(value).success;
}

/**
 * Where one upload receipt lives.
 *
 * @param home the state home
 * @param uploadReceiptId the `upl-<uuid>` naming the file
 * @returns the JSON path
 */
export function uploadReceiptPath({ home, uploadReceiptId }: { home: string; uploadReceiptId: string }): string {
  return join(stateHomePaths({ home }).visualEvidenceUploads, `${uploadReceiptId}.json`);
}

/**
 * Write one upload receipt, atomically, after checking it against its own schema.
 *
 * @param home the state home
 * @param receipt the verified upload
 * @returns the path written, or why the receipt could not be written
 */
export function writeUploadReceipt({
  home,
  receipt,
}: {
  home: string;
  receipt: GithubUploadReceipt;
}): Result<string, GithubAttachError> {
  const checked = uploadReceiptSchema.safeParse(receipt);
  if (!checked.success) {
    const detail = checked.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ");
    return err(GithubAttachErrors.uploadReceiptFailed({ cause: new Error(detail), href: receipt.asset.href }));
  }
  const path = uploadReceiptPath({ home, uploadReceiptId: receipt.uploadReceiptId });
  try {
    mkdirSync(stateHomePaths({ home }).visualEvidenceUploads, { recursive: true });
    writeFileAtomic({ contents: safeJsonStringify({ label: "upload receipt", value: checked.data }), path });
  } catch (cause) {
    return err(GithubAttachErrors.uploadReceiptFailed({ cause, href: receipt.asset.href }));
  }
  return ok(path);
}

/**
 * Read one upload receipt. A malformed id, a missing file and a document that fails the schema are all refusals:
 * a description citing a receipt that is not there must not embed anything.
 *
 * @param home the state home
 * @param uploadReceiptId the id the description cites
 * @returns the receipt, or why it cannot be believed
 */
export function readUploadReceipt({
  home,
  uploadReceiptId,
}: {
  home: string;
  uploadReceiptId: string;
}): Result<GithubUploadReceipt, GithubAttachError> {
  if (!isUploadReceiptId({ value: uploadReceiptId })) {
    return err(GithubAttachErrors.uploadReceiptUnreadable({ detail: "not an upl-<uuid> id", uploadReceiptId }));
  }
  const path = uploadReceiptPath({ home, uploadReceiptId });
  let decoded: unknown;
  try {
    decoded = safeJsonParse({ label: `upload receipt at ${path}`, text: readFileSync(path, "utf8") });
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    return err(GithubAttachErrors.uploadReceiptUnreadable({ detail, uploadReceiptId }));
  }
  const parsed = uploadReceiptSchema.safeParse(decoded);
  if (!parsed.success) {
    const detail = parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ");
    return err(GithubAttachErrors.uploadReceiptUnreadable({ detail, uploadReceiptId }));
  }
  if (parsed.data.uploadReceiptId !== uploadReceiptId) {
    return err(
      GithubAttachErrors.uploadReceiptUnreadable({
        detail: `the document at ${path} names ${parsed.data.uploadReceiptId}`,
        uploadReceiptId,
      }),
    );
  }
  return ok(parsed.data);
}
