/**
 * The PURE half of `linear attach upload`: which files this door will send, what content type each one is
 * stored as, and the markdown that embeds the asset Linear hands back.
 *
 * ## Why there is no local size ceiling here, when `../github/attachment.ts` has two
 *
 * GitHub's upload endpoint documents no limit at all, so the ceiling there had to be measured against the
 * live endpoint and pinned in a table. Linear's does not need that: `mutation.fileUpload` takes `size` as a
 * REQUIRED argument and refuses the reservation itself when the file is too big — so the server states the
 * limit on every call, before a single byte is sent, and a number copied into this file could only ever go
 * stale against it. `src/__tests__/integration/linearAttach.test.ts` pins what the live refusal looks like
 * by asking for an absurd reservation, which is the check a hard-coded constant would have replaced.
 *
 * ## The content-type table IS the door's decision, not Linear's
 *
 * Linear's workspace carries its own `Organization.allowedFileUploadContentTypes`, which is the provider's
 * answer and can be wider than this. This table is what the door is willing to send, and it is narrower on
 * purpose: every entry renders inline in a Linear comment or description. The integration test asserts each
 * one is inside the live workspace's allowed set, so a divergence fails a test rather than a real send.
 */
import { err, ok, type Result } from "../../lib/result.js";

import { type LinearAttachError, LinearAttachErrors } from "./attach.errors.js";

/**
 * Extension → the content type Linear stores the asset as.
 *
 * `.svg` is deliberately ABSENT, and that is the one entry worth explaining: Linear renders an SVG asset as
 * a download link rather than inline, so uploading one produces a comment with a broken-looking attachment
 * where the author expected a picture. GitHub's own table keeps it because GitHub does render it.
 */
export const LINEAR_ATTACHABLE_MEDIA: Readonly<Record<string, string>> = {
  ".gif": "image/gif",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".mov": "video/quicktime",
  ".mp4": "video/mp4",
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".webm": "video/webm",
  ".webp": "image/webp",
};

/** A file classified against {@link LINEAR_ATTACHABLE_MEDIA} and ready to reserve a slot for. */
export interface ClassifiedLinearAttachment {
  readonly contentType: string;
  readonly byteLength: number;
  /** The file's base name exactly as it is on disk — Linear stores it and echoes it back. */
  readonly fileName: string;
}

/** The lowercased final extension of a path, `""` when there is none after the last separator. */
function extensionOf({ fileName }: { fileName: string }): string {
  const dot = fileName.lastIndexOf(".");
  return dot <= 0 ? "" : fileName.slice(dot).toLowerCase();
}

/**
 * Classify a file by extension. The whole local half of the upload — no network, so `--dry-run` reports
 * exactly what a live run would send.
 *
 * @param fileName the file's base name, whose extension picks the content type
 * @param byteLength the file's exact size, which rides to Linear as the reservation's `size`
 * @returns the content type and the name to send, or why this door will not send the file
 */
export function classifyLinearAttachment({
  fileName,
  byteLength,
}: {
  fileName: string;
  byteLength: number;
}): Result<ClassifiedLinearAttachment, LinearAttachError> {
  const contentType = LINEAR_ATTACHABLE_MEDIA[extensionOf({ fileName })];
  if (contentType === undefined) {
    return err(LinearAttachErrors.unsupportedMedia({ extension: extensionOf({ fileName }) }));
  }
  return ok({ byteLength, contentType, fileName });
}

/**
 * Whether a content type embeds as a picture rather than linking as a file — the `media` block's rule.
 *
 * @param contentType what the asset is stored as
 * @returns true when Linear renders it inline, false when it renders as a file link
 */
export function embedsInline({ contentType }: { contentType: string }): boolean {
  return contentType.startsWith("image/");
}

/**
 * The `media` block a caller pastes into a comment, issue or project-update form for an uploaded asset.
 *
 * Returned as the block rather than as rendered markdown on purpose: `./render.ts` owns how a `media` block
 * becomes text, and a verb that printed its own `![](…)` would be a second renderer to keep in step. The
 * printed markdown in the report is for a human reading the terminal; THIS is what goes in a form.
 *
 * @param assetUrl the URL Linear handed back for the stored asset
 * @param alt the label — the image's alt text, or the file link's text
 * @param contentType what the asset was stored as, which decides embed versus link
 * @returns the block, ready to drop into a form's `detail`
 */
export function mediaBlockFor({ assetUrl, alt, contentType }: { assetUrl: string; alt: string; contentType: string }): {
  readonly kind: "media";
  readonly url: string;
  readonly alt: string;
  readonly mime: string;
} {
  return { alt, kind: "media", mime: contentType, url: assetUrl };
}

/**
 * Which of the door's own content types the workspace would REFUSE.
 *
 * The staleness check on {@link LINEAR_ATTACHABLE_MEDIA}, kept pure so both of its arms are testable: this
 * table is narrower than the provider's on purpose, and the only way it can go wrong silently is a workspace
 * narrowing its own allowed set under one of these types.
 *
 * `undefined` means the workspace declares NO restriction, which is what Linear answers when none is
 * configured — so nothing is forbidden and the answer is empty. That is a different fact from an empty
 * DECLARED list, which forbids everything, and the two must not collapse: see
 * `../../corpus/linear/writeAssets.ts`'s `allowedUploadTypesFrom` for the measurement behind that.
 *
 * @param restriction the workspace's declared list, or undefined when it declares none
 * @returns every type this door would send that the workspace would refuse, in table order
 */
export function typesTheWorkspaceForbids({
  restriction,
}: {
  restriction: readonly string[] | undefined;
}): readonly string[] {
  if (restriction === undefined) {
    return [];
  }
  const permitted = new Set(restriction);
  return Object.values(LINEAR_ATTACHABLE_MEDIA).filter((type) => !permitted.has(type));
}
