/**
 * The typed form `slopweaver browser image-record` takes, and the pure decisions about it.
 *
 * ## Why this is a FORM rather than a pile of flags
 *
 * What a session is asserting here is a paragraph — what it saw in the picture, whether the thing the claim
 * rests on had rendered, whether the crop kept the axes — and a flag per field would invite the one-word
 * answer the record exists to refuse. `observedContent` is `.min(1)` and the schema is `.strict()`, so
 * "looks fine" is expressible but an omission is not.
 *
 * ## This verb is the first production producer, and that is the point
 *
 * Before it, the `failed` arm of image admission was unreachable: nothing in the tree wrote a record at all,
 * so the hold could not fire and a check that cannot fail reports clean. `image-record` is what makes the
 * no-hatch arm real, and `prepareUploads.test.ts` drives the whole path through it.
 *
 * A `failed` form is RECORDED, successfully, and the verb exits non-zero to say the picture may not be sent.
 * Those are two different things and the record is never rolled back on the strength of the refusal: the
 * durable fact is that somebody looked, and the refusal is a consequence of what they saw.
 */

import { randomUUID } from "node:crypto";
import { z } from "zod";

import { err, ok, type Result } from "#lib/result.js";
import { IMAGE_FAILURE_REASONS, imageAnnotationSchema } from "./schema.js";
import type { ArtifactIdentity, ImageRecord } from "./types.js";
import { IMAGE_POLICY_VERSION } from "./types.js";

/**
 * `sha256:<64 lowercase hex>` — the SAME spelling and message as `./schema.ts`'s read edge, on purpose.
 *
 * MEASURED on a scheduled automation slot: `crop.sourceDigest` was `z.string().min(1)`,
 * so `image-record` admitted a bare hex digest, wrote it and printed `passed` — and the next
 * `readImageRecords` refused the whole file at line 1 with "expected sha256:<64 hex>", so `automation run-due
 * --media` REFUSED and the slot attempt was spent. A write edge looser than its read edge writes records
 * the store cannot believe back; every digest this form carries goes through this one constant.
 */
const digestSchema = z.string().regex(/^sha256:[0-9a-f]{64}$/, "expected sha256:<64 hex>");

const rectSchema = z
  .object({
    height: z.number().int().positive(),
    width: z.number().int().positive(),
    x: z.number().int().min(0),
    y: z.number().int().min(0),
  })
  .strict();

/**
 * The form a session writes to record what it saw in one image.
 *
 * @internal — {@link parseImageRecordForm} is the parse edge; it adds the coherence rules a schema cannot.
 */
export const imageRecordFormSchema = z
  .object({
    /**
     * How framing was decided. `cropped` names the rectangle taken out of `sourceDigest`'s image;
     * `already-framed` has to argue in words why no crop was needed.
     */
    crop: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("cropped"), rect: rectSchema, sourceDigest: digestSchema }).strict(),
      z.object({ kind: z.literal("already-framed"), reason: z.string().min(1) }).strict(),
    ]),
    /** What the observer actually saw, in words a reader could check against the picture. */
    observedContent: z.string().min(1),
    /** How the recording session names itself, so a record says who looked. */
    observerSession: z.string().min(1),
    /** The absolute path of the FINAL image — the bytes Slack would show. */
    path: z.string().min(1),
    /** The `browser shot` capture record the image came out of, when it came out of one. */
    captureId: z.string().min(1).optional(),
    /** Whether the axes, query and time range a reader needs survived the crop. */
    contextRetained: z.boolean(),
    /** Required when `verdict` is `failed`: what to do about it. */
    correction: z.string().min(1).optional(),
    /** Required when `verdict` is `failed`: which closed reason. */
    reason: z.enum(IMAGE_FAILURE_REASONS).optional(),
    /**
     * The boxes ALREADY drawn into these final pixels, each with its note — what a first channel message owes. This
     * records them; it never draws them. A `passed` verdict only.
     */
    annotations: z.array(imageAnnotationSchema).min(1).optional(),
    /** `none`: you read the capture back and no pop-up, banner or modal covers what it shows. A `passed` verdict only. */
    obstruction: z.literal("none").optional(),
    /** The digest the caller believes these bytes have, cross-checked against the decode. */
    expectDigest: digestSchema.optional(),
    /** Whether the thing the claim rests on had rendered. */
    targetState: z.enum(["data", "zero-results", "unloaded", "empty-panel"]),
    /** The observer's own call on whether these bytes may be sent. */
    verdict: z.enum(["passed", "failed"]),
  })
  .strict();

/** The parsed form. */
export type ImageRecordForm = z.infer<typeof imageRecordFormSchema>;

/**
 * Parse an already-decoded form value, and refuse the combinations the schema alone cannot express.
 *
 * Two coherence rules, both of which a plain schema would let through:
 *
 * - a `failed` verdict needs both a `reason` and a `correction`, because a refusal that says neither is the
 *   unhelpful block the owner ruled against;
 * - a `passed` verdict may NOT claim a `targetState` of `unloaded` or `empty-panel`. A form saying "the
 *   panel never rendered, and this is fine to send" is the incident restated as a record, and it is refused
 *   here rather than admitted and then puzzled over.
 *
 * @param value the decoded form
 * @returns the parsed form, or every problem with it
 */
export function parseImageRecordForm({ value }: { value: unknown }): Result<ImageRecordForm> {
  const parsed = imageRecordFormSchema.safeParse(value);
  if (!parsed.success) {
    return err(parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`));
  }
  const form = parsed.data;
  const problems: string[] = form.verdict === "failed" ? failedFormProblems({ form }) : [];
  const unrendered = form.targetState === "unloaded" || form.targetState === "empty-panel";
  if (form.verdict === "passed" && unrendered) {
    problems.push(
      `a record cannot pass while its targetState is \`${form.targetState}\` — ` +
        "the thing the claim rests on had not rendered, so the picture is not evidence for it",
    );
  }
  if (form.verdict === "passed" && !form.contextRetained) {
    problems.push(
      "a record cannot pass while `contextRetained` is false — a crop that dropped the axes, the query or " +
        "the time range leaves a reader nothing to check the claim against (reason `context-lost`)",
    );
  }
  if (problems.length > 0) {
    return err(problems);
  }
  return ok(form);
}

/**
 * What a `failed` form owes and may not carry: a `reason` and a `correction`, and none of the fields that vouch for a
 * picture fit to send.
 *
 * @param form the parsed form, whose verdict is `failed`
 * @returns each problem, empty when there is none
 */
function failedFormProblems({ form }: { form: ImageRecordForm }): string[] {
  const problems: string[] = [];
  if (form.reason === undefined) {
    problems.push("a failed record needs `reason`: unloaded, empty-panel, illegible, context-lost or obscured");
  }
  if (form.correction === undefined) {
    problems.push("a failed record needs `correction` — what to do about it, per the escape-hatch contract");
  }
  if (form.annotations !== undefined || form.obstruction !== undefined) {
    problems.push(
      "a failed record carries no `annotations` or `obstruction` — those vouch for a picture fit to send; an " +
        "obscured one is `reason: obscured`",
    );
  }
  return problems;
}

/**
 * Build the durable record for one looked-at image.
 *
 * The artifact's identity comes from DECODING the bytes, never from the form: a form that names its own
 * dimensions could name any, and the whole value of the record is that it is checkable against the file.
 *
 * @param form the validated form
 * @param artifact what the bytes actually decode to
 * @param receiptId the minted identity for this record
 * @returns the record to append
 */
export function imageRecordOf({
  form,
  artifact,
  receiptId,
}: {
  form: ImageRecordForm;
  artifact: ArtifactIdentity;
  receiptId: string;
}): ImageRecord {
  const shared = {
    artifact,
    ...(form.captureId === undefined ? {} : { captureId: form.captureId }),
    crop: form.crop,
    policyVersion: IMAGE_POLICY_VERSION,
    readBack: {
      contextRetained: form.contextRetained,
      observedAtIso: new Date().toISOString(),
      observedContent: form.observedContent,
      observerSession: form.observerSession,
      targetState: form.targetState,
    },
    receiptId,
    schemaVersion: 1,
  } as const;
  if (form.verdict === "failed") {
    return {
      ...shared,
      // `parseImageRecordForm` refuses a failed form missing either, so neither assertion can be reached
      // with an absent value.
      correction: form.correction!,
      outcome: "failed",
      reason: form.reason!,
    };
  }
  return {
    ...shared,
    ...(form.annotations === undefined ? {} : { annotations: form.annotations }),
    ...(form.obstruction === undefined ? {} : { obstruction: form.obstruction }),
    outcome: "passed",
  };
}

/**
 * Mint a receipt identity.
 *
 * Random rather than derived from the digest, because one artifact may legitimately carry two records — a
 * first look and a later one that found a defect — and a digest-derived id would collide between them.
 *
 * @returns the new receipt id
 */
export function mintReceiptId(): string {
  return `img-${randomUUID()}`;
}
