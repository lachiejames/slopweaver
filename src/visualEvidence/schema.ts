/**
 * The parse edge for image evidence — every record and every attachment reference crosses it.
 *
 * Strict throughout (`.strict()`), so a field a producer stopped writing, or one a future build added, is
 * a refusal rather than a silently-ignored key. That matters more here than in most stores: the thing a
 * record asserts is that somebody LOOKED, and a record that parses while missing the observation is the
 * exact "a check that cannot fail reports clean" shape this domain exists to close.
 *
 * A record that will not parse is reported as unbelievable, never as absent — see `./store.ts`. Absence is
 * hatchable and a corrupt record is not, so conflating them would hand a bad record the missing-record
 * exception.
 */

import { z } from "zod";

import type { ImageRecord, ImageRef } from "./types.js";

/** `sha256:<64 lowercase hex>` — the same spelling `ReviewVerdict.answerDigest` uses. */
const digestSchema = z.string().regex(/^sha256:[0-9a-f]{64}$/, "expected sha256:<64 hex>");

/** A rectangle in image pixels; every edge a non-negative integer, width and height positive. */
const pixelRectSchema = z
  .object({
    height: z.number().int().positive(),
    width: z.number().int().positive(),
    x: z.number().int().min(0),
    y: z.number().int().min(0),
  })
  .strict();

const artifactIdentitySchema = z
  .object({
    digest: digestSchema,
    heightPx: z.number().int().positive(),
    widthPx: z.number().int().positive(),
  })
  .strict();

const croppedArm = z.object({ kind: z.literal("cropped"), rect: pixelRectSchema, sourceDigest: digestSchema }).strict();
// `reason` is `.min(1)` so "already framed" has to be argued rather than asserted — an empty string here
// would be the silence the whole record exists to prevent.
const alreadyFramedArm = z.object({ kind: z.literal("already-framed"), reason: z.string().min(1) }).strict();

const cropDispositionSchema = z.discriminatedUnion("kind", [croppedArm, alreadyFramedArm]);

/*
 * The third framing arm, and why it is spliced into the FAILED record only rather than into the shared one.
 *
 * A reviewing session writes a record about bytes it did not produce, so it has no honest way to describe
 * their framing. Letting it say so is right; letting a PASSING record say so would mean a record could
 * assert an image is fine to send while stating it never saw how the image was framed, which is a weaker
 * contract than the passing record ships. Splitting the two schemas is what makes that unrepresentable rather than
 * merely discouraged.
 */
const failedCropDispositionSchema = z.discriminatedUnion("kind", [
  croppedArm,
  alreadyFramedArm,
  z.object({ kind: z.literal("reviewer-unobserved"), reason: z.string().min(1) }).strict(),
]);

const readBackSchema = z
  .object({
    contextRetained: z.boolean(),
    observedAtIso: z.string().min(1),
    observedContent: z.string().min(1),
    observerSession: z.string().min(1),
    targetState: z.enum(["data", "zero-results", "unloaded", "empty-panel"]),
  })
  .strict();

const recordBase = {
  artifact: artifactIdentitySchema,
  captureId: z.string().min(1).optional(),
  policyVersion: z.number().int().positive(),
  readBack: readBackSchema,
  receiptId: z.string().min(1),
  schemaVersion: z.literal(1),
};

/** The closed failure reasons, one spelling for the record and the form (`./recordForm.ts`). */
export const IMAGE_FAILURE_REASONS = ["unloaded", "empty-panel", "illegible", "context-lost", "obscured"] as const;

/**
 * One box drawn into the final pixels with its note: a note a reader SEES (not only whitespace), a rect with positive
 * area. That the rect lies inside the image is a cross-field rule, {@link annotationBoundsIssues}.
 */
export const imageAnnotationSchema = z
  .object({ note: z.string().regex(/\S/u, "a note says what the box marks"), rect: pixelRectSchema })
  .strict();

/**
 * Every box that does not lie wholly inside the picture it claims to mark — a box past the edge marks nothing a reader
 * sees.
 *
 * @param annotations the boxes, absent on a record carrying none
 * @param artifact what the bytes decode to
 * @returns one issue per box out of bounds, empty when every box fits
 */
export function annotationBoundsIssues({
  annotations,
  artifact,
}: {
  annotations: readonly { readonly rect: { x: number; y: number; width: number; height: number } }[] | undefined;
  artifact: { readonly widthPx: number; readonly heightPx: number };
}): readonly string[] {
  if (annotations === undefined) {
    return [];
  }
  return annotations.flatMap(({ rect }, index) =>
    rect.x + rect.width > artifact.widthPx || rect.y + rect.height > artifact.heightPx
      ? [
          `annotations.${String(index)}: the box ${String(rect.width)}x${String(rect.height)} at ` +
            `${String(rect.x)},${String(rect.y)} runs past the ${String(artifact.widthPx)}x${String(artifact.heightPx)} picture`,
        ]
      : [],
  );
}

const passedArm = z
  .object({
    ...recordBase,
    annotations: z.array(imageAnnotationSchema).min(1).readonly().optional(),
    crop: cropDispositionSchema,
    obstruction: z.literal("none").optional(),
    outcome: z.literal("passed"),
  })
  .strict()
  .superRefine((record, context) => {
    for (const issue of annotationBoundsIssues({ annotations: record.annotations, artifact: record.artifact })) {
      context.addIssue({ code: "custom", message: issue });
    }
  });

/** The strict schema for one durable image record. */
export const imageRecordSchema = z.discriminatedUnion("outcome", [
  passedArm,
  z
    .object({
      ...recordBase,
      correction: z.string().min(1),
      crop: failedCropDispositionSchema,
      outcome: z.literal("failed"),
      reason: z.enum(IMAGE_FAILURE_REASONS),
    })
    .strict(),
]) satisfies z.ZodType<ImageRecord>;

/**
 * The strict schema for one attachment reference, replacing the bare path string every outbound form used
 * to carry.
 *
 * `receiptId` is optional here and nowhere else — the missing-record exception has to be expressible, and
 * admission never looks a record up by it (`./admission.ts`).
 *
 * @internal — the outbound forms compose this into their own `images` field rather than parsing it alone.
 */
export const imageRefSchema = z
  .object({
    artifactDigest: digestSchema,
    path: z.string().min(1),
    receiptId: z.string().min(1).optional(),
  })
  .strict() satisfies z.ZodType<ImageRef>;
