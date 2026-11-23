/**
 * The typed form `slopweaver browser annotate` takes, and the image-record form it hands back for the drawn picture.
 *
 * ## Why annotate DRAWS and never RECORDS
 *
 * A first message in a channel owes a screenshot whose newest image record vouches for a box drawn into its pixels
 * (`../outbound/slack/firstMessageProof.ts`), and `browser image-record` only attests boxes already there. Nothing drew
 * one onto a picture `browser shot` had not produced, so a fresh Vanta capture could never pass.
 *
 * The verb that closes it stops one step short of a record on purpose. An image record says somebody LOOKED at the
 * final bytes (`./types.ts`), and annotating makes new bytes after the source was looked at — so the
 * verb writes the picture and a pre-filled `image-record` form beside it, and only `browser image-record`, run once the
 * session has read the output back, appends the record. A one-step version would vouch for pixels nobody had looked at.
 *
 * ## What the form refuses, and why each
 *
 * - **`captureId`**: a capture record names the bytes IT produced, and annotating changes them, so `image-record`
 *   would refuse the link.
 * - **A `cropped` disposition**: it says the rectangle was cut out of `sourceDigest`, which annotating does not do —
 *   the band below makes the output a different size. `already-framed`, with its reason, is the honest one.
 * - **A failed verdict's fields**: a picture recorded unfit is retaken, never annotated around, so the form only ever describes a picture fit to send.
 *
 * Pure: no filesystem, no clock.
 */

import { z } from "zod";

import { err, ok, type Result } from "#lib/result.js";
import { MAX_ANNOTATIONS } from "./annotateExisting.js";
import { type ImageRecordForm, parseImageRecordForm } from "./recordForm.js";
import { imageAnnotationSchema } from "./schema.js";
import type { ImageAnnotation } from "./types.js";

/** @internal — {@link parseAnnotateForm} is the parse edge; it also runs the image-record form's coherence rules. */
export const annotateFormSchema = z
  .object({
    /** The PNG to draw on. Never written to. */
    source: z.string().min(1),
    /** Where the annotated PNG goes; its pre-filled image-record form lands beside it. */
    out: z.string().min(1),
    /** One to four boxes in the source's pixels, each with the note a reader sees under the picture. */
    annotations: z.array(imageAnnotationSchema).min(1).max(MAX_ANNOTATIONS),
    /** What the observer saw in the source, in words a reader could check against the picture. */
    observedContent: z.string().min(1),
    /** How the session names itself, so the record says who looked. */
    observerSession: z.string().min(1),
    /** Whether the context a reader needs to check the claim survived the capture. */
    contextRetained: z.boolean(),
    /** Whether the thing the claim rests on had rendered. */
    targetState: z.enum(["data", "zero-results"]),
    /** You read the capture back and no pop-up, banner or modal covers what it shows. */
    obstruction: z.literal("none"),
    /** Why the source needed no crop. */
    crop: z.object({ kind: z.literal("already-framed"), reason: z.string().min(1) }).strict(),
  })
  .strict();

/** The parsed form. */
export type AnnotateForm = z.infer<typeof annotateFormSchema>;

/**
 * The image-record form an annotate form becomes once its picture exists.
 *
 * @param form the annotate form
 * @param path the annotated picture's path
 * @param annotations the boxes and notes as drawn
 * @param expectDigest the digest of the drawn bytes, when they exist yet
 * @returns the unvalidated image-record form
 */
function recordFormOf({
  form,
  path,
  annotations,
  expectDigest,
}: {
  form: AnnotateForm;
  path: string;
  annotations: readonly ImageAnnotation[];
  expectDigest: string | undefined;
}): Record<string, unknown> {
  return {
    annotations,
    contextRetained: form.contextRetained,
    crop: form.crop,
    ...(expectDigest === undefined ? {} : { expectDigest }),
    observedContent: form.observedContent,
    observerSession: form.observerSession,
    obstruction: form.obstruction,
    path,
    targetState: form.targetState,
    verdict: "passed",
  };
}

/**
 * Parse an already-decoded annotate form, and refuse what the image-record form it will become would refuse — so a
 * form that can never be recorded is turned away before a picture is drawn for it.
 *
 * @param value the decoded form
 * @returns the parsed form, or every problem with it
 */
export function parseAnnotateForm({ value }: { value: unknown }): Result<AnnotateForm> {
  const parsed = annotateFormSchema.safeParse(value);
  if (!parsed.success) {
    return err(parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`));
  }
  const form = parsed.data;
  const provisional = parseImageRecordForm({
    value: recordFormOf({ annotations: form.annotations, expectDigest: undefined, form, path: form.out }),
  });
  if (provisional.isErr()) {
    return err(provisional.error);
  }
  return ok(form);
}

/**
 * The pre-filled `browser image-record` form for an annotated picture: the drawn boxes and notes, the output's path and
 * the digest its bytes must still have when the session records them.
 *
 * @param form the annotate form the picture was drawn from
 * @param outputPath the absolute path the annotated picture was written to
 * @param outputDigest the `sha256:` digest of those bytes
 * @param annotations the boxes and notes exactly as drawn — the notes as the font printed them
 * @returns the image-record form, validated by the same parser `image-record` reads it with
 */
export function imageRecordFormForAnnotatedImage({
  form,
  outputPath,
  outputDigest,
  annotations,
}: {
  form: AnnotateForm;
  outputPath: string;
  outputDigest: string;
  annotations: readonly ImageAnnotation[];
}): Result<ImageRecordForm> {
  return parseImageRecordForm({
    value: recordFormOf({ annotations, expectDigest: outputDigest, form, path: outputPath }),
  });
}
